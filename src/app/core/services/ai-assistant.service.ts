import { Injectable, signal, computed } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CompanyService } from './company.service';
import { environment } from '../../../environments/environment';

export interface AiAttachment {
  tipo: 'tabela';
  origem: string;
  titulo: string;
  colunas: string[];
  linhas: Record<string, any>[];
}

export interface AiMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: AiAttachment[];
  tools?: string[];
  created_at?: string;
  /** Verdadeiro enquanto a resposta ainda está a chegar do servidor. */
  streaming?: boolean;
  error?: string | null;
}

export interface AiConversation {
  id: string;
  title: string;
  last_message_at: string;
}

export interface AiQuota {
  enabled: boolean;
  used: number;
  limit_value: number | null;
  alerts_enabled: boolean;
}

export interface AiAlert {
  id: string;
  rule_code: string;
  severity: 'info' | 'aviso' | 'critico';
  title: string;
  body: string;
  metric: Record<string, any>;
  action_label: string | null;
  action_route: string | null;
  status: 'nova' | 'lida' | 'resolvida' | 'dispensada';
  created_at: string;
}

export interface AiSearchResult {
  tipo: 'cliente' | 'produto' | 'factura';
  id: string;
  titulo: string;
  subtitulo: string;
  rota: string;
  total?: number;
  preco?: number;
  estado?: string;
}

/** Nomes técnicos das ferramentas traduzidos para o que a UI mostra. */
const TOOL_LABELS: Record<string, string> = {
  estatisticas_facturacao: 'A somar as facturas do período',
  evolucao_vendas: 'A analisar a evolução das vendas',
  produtos_mais_vendidos: 'A ordenar os produtos mais vendidos',
  melhores_clientes: 'A ordenar os clientes por facturação',
  clientes_inactivos: 'A procurar clientes sem compras recentes',
  contas_a_receber: 'A calcular o valor por receber',
  posicao_fiscal: 'A consultar as declarações de ISPC',
  listar_facturas: 'A listar as facturas',
  pesquisar: 'A pesquisar nos seus registos',
  consultar_base_fiscal: 'A consultar a base de conhecimento fiscal'
};

export function toolLabel(nome: string): string {
  return TOOL_LABELS[nome] ?? 'A consultar os seus dados';
}

@Injectable({ providedIn: 'root' })
export class AiAssistantService {
  messages = signal<AiMessage[]>([]);
  conversations = signal<AiConversation[]>([]);
  activeConversationId = signal<string | null>(null);
  isStreaming = signal(false);
  /** Ferramenta a correr neste momento, para dar sinal de vida ao utilizador. */
  currentTool = signal<string | null>(null);
  quota = signal<AiQuota | null>(null);
  alerts = signal<AiAlert[]>([]);

  isAvailable = computed(() => this.quota()?.enabled === true);

  quotaRemaining = computed(() => {
    const q = this.quota();
    if (!q || q.limit_value === null) return null;
    return Math.max(q.limit_value - q.used, 0);
  });

  unreadAlerts = computed(() => this.alerts().filter(a => a.status === 'nova'));

  criticalAlerts = computed(() =>
    this.alerts().filter(a => a.severity === 'critico' && a.status !== 'dispensada')
  );

  private abortController: AbortController | null = null;

  constructor(
    private supabase: SupabaseService,
    private companyService: CompanyService
  ) {}

  // -------------------------------------------------------------------------
  // Quota
  // -------------------------------------------------------------------------

  async loadQuota(): Promise<void> {
    const company = this.companyService.activeCompany();
    if (!company) {
      this.quota.set(null);
      return;
    }

    const { data, error } = await this.supabase.db.rpc('ai_quota_status', {
      p_company_id: company.id
    });

    if (error) {
      this.quota.set(null);
      return;
    }

    const row = Array.isArray(data) ? data[0] : data;
    this.quota.set(
      row
        ? {
            enabled: row.enabled,
            used: Number(row.used ?? 0),
            limit_value: row.limit_value === null ? null : Number(row.limit_value),
            alerts_enabled: row.alerts_enabled
          }
        : null
    );
  }

  // -------------------------------------------------------------------------
  // Conversas
  // -------------------------------------------------------------------------

  async loadConversations(): Promise<void> {
    const company = this.companyService.activeCompany();
    if (!company) return;

    const { data } = await this.supabase.db
      .from('ai_conversations')
      .select('id, title, last_message_at')
      .eq('company_id', company.id)
      .eq('is_archived', false)
      .order('last_message_at', { ascending: false })
      .limit(30);

    this.conversations.set(data ?? []);
  }

  async openConversation(id: string): Promise<void> {
    this.activeConversationId.set(id);

    const { data } = await this.supabase.db
      .from('ai_messages')
      .select('id, role, content, attachments, tool_calls, created_at, error')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true });

    this.messages.set(
      (data ?? []).map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        attachments: (m.attachments ?? []) as AiAttachment[],
        tools: ((m.tool_calls ?? []) as { nome: string }[]).map(t => t.nome),
        created_at: m.created_at,
        error: m.error
      }))
    );
  }

  startNewConversation(): void {
    this.activeConversationId.set(null);
    this.messages.set([]);
  }

  async deleteConversation(id: string): Promise<void> {
    await this.supabase.db.from('ai_conversations').delete().eq('id', id);
    if (this.activeConversationId() === id) this.startNewConversation();
    await this.loadConversations();
  }

  // -------------------------------------------------------------------------
  // Pergunta ao assistente
  // -------------------------------------------------------------------------

  /**
   * Envia a pergunta e consome a resposta em streaming.
   *
   * O texto é desenhado à medida que chega em vez de aparecer de uma vez no
   * fim: com ligações móveis lentas, uma resposta que demora oito segundos a
   * surgir parece uma avaria.
   */
  async ask(pergunta: string, surface: 'chat' | 'search' = 'chat'): Promise<void> {
    const company = this.companyService.activeCompany();
    if (!company || this.isStreaming()) return;

    const texto = pergunta.trim();
    if (!texto) return;

    const { data: sessionData } = await this.supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return;

    this.messages.update(m => [...m, { role: 'user', content: texto }]);
    this.messages.update(m => [
      ...m,
      { role: 'assistant', content: '', streaming: true }
    ]);
    this.isStreaming.set(true);
    this.currentTool.set(null);

    const indiceResposta = this.messages().length - 1;
    const actualizarResposta = (patch: Partial<AiMessage>) => {
      this.messages.update(lista => {
        const copia = [...lista];
        copia[indiceResposta] = { ...copia[indiceResposta], ...patch };
        return copia;
      });
    };

    this.abortController = new AbortController();

    try {
      const resposta = await fetch(
        `${environment.supabaseUrl}/functions/v1/ai-assistant`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            apikey: environment.supabaseKey
          },
          body: JSON.stringify({
            company_id: company.id,
            conversation_id: this.activeConversationId(),
            message: texto,
            surface
          }),
          signal: this.abortController.signal
        }
      );

      if (!resposta.ok) {
        const erro = await resposta.json().catch(() => null);
        actualizarResposta({
          content: erro?.error ?? 'Não foi possível contactar o assistente.',
          streaming: false,
          error: erro?.code ?? 'HTTP_' + resposta.status
        });
        return;
      }

      await this.consumirSse(resposta, actualizarResposta);
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        actualizarResposta({ streaming: false });
      } else {
        actualizarResposta({
          content: 'Ocorreu um erro de ligação. Verifique a Internet e tente novamente.',
          streaming: false,
          error: 'NETWORK'
        });
      }
    } finally {
      this.isStreaming.set(false);
      this.currentTool.set(null);
      this.abortController = null;
      await this.loadQuota();
    }
  }

  /** Interrompe a resposta em curso. */
  stop(): void {
    this.abortController?.abort();
  }

  private async consumirSse(
    resposta: Response,
    actualizar: (patch: Partial<AiMessage>) => void
  ): Promise<void> {
    const reader = resposta.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = '';
    let acumulado = '';
    const ferramentas: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Os eventos SSE terminam numa linha em branco. Um chunk da rede pode
      // cortar um evento a meio, por isso só se processa o que estiver completo
      // e o resto fica no buffer para o chunk seguinte.
      const blocos = buffer.split('\n\n');
      buffer = blocos.pop() ?? '';

      for (const bloco of blocos) {
        const linhaEvento = bloco.split('\n').find(l => l.startsWith('event: '));
        const linhaDados = bloco.split('\n').find(l => l.startsWith('data: '));
        if (!linhaEvento || !linhaDados) continue;

        const evento = linhaEvento.slice(7).trim();
        let dados: any;
        try {
          dados = JSON.parse(linhaDados.slice(6));
        } catch {
          continue;
        }

        switch (evento) {
          case 'meta':
            if (dados.conversation_id) {
              this.activeConversationId.set(dados.conversation_id);
            }
            break;

          case 'tool':
            this.currentTool.set(dados.nome);
            if (!ferramentas.includes(dados.nome)) ferramentas.push(dados.nome);
            break;

          case 'delta':
            acumulado += dados.text ?? '';
            this.currentTool.set(null);
            actualizar({ content: acumulado });
            break;

          case 'error':
            actualizar({ content: dados.message, streaming: false, error: dados.code });
            break;

          case 'done':
            actualizar({
              content: acumulado,
              attachments: dados.anexos ?? [],
              tools: ferramentas,
              streaming: false
            });
            await this.loadConversations();
            break;
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Pesquisa inteligente
  // -------------------------------------------------------------------------

  /**
   * Pesquisa directa na base de dados, sem passar pelo modelo. É instantânea e
   * não consome quota; o assistente só entra quando o utilizador faz uma
   * pergunta em vez de procurar um nome.
   */
  async search(termo: string): Promise<AiSearchResult[]> {
    const company = this.companyService.activeCompany();
    if (!company || termo.trim().length < 2) return [];

    const { data, error } = await this.supabase.db.rpc('ai_search', {
      p_company_id: company.id,
      p_query: termo.trim(),
      p_limit: 5
    });

    if (error || !data) return [];

    return [
      ...(data.clientes ?? []),
      ...(data.facturas ?? []),
      ...(data.produtos ?? [])
    ] as AiSearchResult[];
  }

  // -------------------------------------------------------------------------
  // Alertas
  // -------------------------------------------------------------------------

  async loadAlerts(): Promise<void> {
    const company = this.companyService.activeCompany();
    if (!company) {
      this.alerts.set([]);
      return;
    }

    const { data } = await this.supabase.db
      .from('ai_alerts')
      .select('*')
      .eq('company_id', company.id)
      .in('status', ['nova', 'lida'])
      .order('created_at', { ascending: false })
      .limit(20);

    // A ordenação por gravidade faz-se aqui e não em SQL: 'severity' é texto e
    // por ordem alfabética daria aviso → critico → info, que é o inverso do
    // que o utilizador precisa de ver primeiro.
    const prioridade = { critico: 0, aviso: 1, info: 2 } as const;
    this.alerts.set(
      ((data ?? []) as AiAlert[]).sort(
        (a, b) => prioridade[a.severity] - prioridade[b.severity]
      )
    );
  }

  /** Recalcula os alertas da empresa activa a pedido do utilizador. */
  async refreshAlerts(): Promise<void> {
    const company = this.companyService.activeCompany();
    if (!company) return;

    await this.supabase.client.functions.invoke('ai-alerts', {
      body: { company_id: company.id }
    });
    await this.loadAlerts();
  }

  async markAlertRead(id: string): Promise<void> {
    await this.supabase.db
      .from('ai_alerts')
      .update({ status: 'lida', read_at: new Date().toISOString() })
      .eq('id', id);
    this.alerts.update(lista =>
      lista.map(a => (a.id === id ? { ...a, status: 'lida' as const } : a))
    );
  }

  async dismissAlert(id: string): Promise<void> {
    await this.supabase.db.from('ai_alerts').update({ status: 'dispensada' }).eq('id', id);
    this.alerts.update(lista => lista.filter(a => a.id !== id));
  }
}
