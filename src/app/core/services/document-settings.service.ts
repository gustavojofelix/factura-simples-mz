import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuditLogService } from './audit-log.service';

export type DocumentTemplateCode = 'classico' | 'moderno' | 'minimalista';

export interface DocumentBranding {
  template_code: DocumentTemplateCode;
  primary_color: string;
  accent_color: string;
  show_logo: boolean;
  show_bank_details: boolean;
  thank_you_message: string;
  default_observations: string;
  footer_text: string;
  invoice_copies: number;
  receipt_copies: number;
  email_subject: string;
  email_greeting: string;
  email_body: string;
  email_signature: string;
  receipt_email_subject: string;
  receipt_email_body: string;
  statement_email_subject: string;
  statement_email_body: string;
  email_reply_to: string | null;
}

/**
 * Valores por omissão. Reproduzem o aspecto actual dos documentos: a cor é a
 * mesma que a classe Tailwind usada hoje na factura, e os textos novos nascem
 * vazios para que nada apareça sem ter sido pedido.
 *
 * Atenção: a marca está definida em dois sítios com valores diferentes. A
 * classe Tailwind vale #f16c39 e a variável CSS global vale #f97316. O
 * documento usa a classe, por isso é esse o valor correcto aqui.
 */
export const DEFAULT_DOCUMENT_BRANDING: DocumentBranding = {
  template_code: 'classico',
  primary_color: '#f16c39',
  accent_color: '#332d2a',
  show_logo: true,
  show_bank_details: true,
  thank_you_message: '',
  default_observations: '',
  footer_text: '',
  invoice_copies: 1,
  receipt_copies: 1,
  email_subject: 'Factura {{numero_factura}} - {{empresa}}',
  email_greeting: 'Olá {{cliente}},',
  email_body: 'Confirmamos a emissão do documento {{numero_factura}}. Segue em anexo a sua factura em formato PDF com todos os detalhes de facturação.',
  email_signature: 'Com os melhores cumprimentos,',
  receipt_email_subject: 'Recibo de pagamento - {{empresa}}',
  receipt_email_body: 'Confirmamos a recepção do pagamento de {{valor_pago}} referente à factura {{numero_factura}}. Segue o recibo em anexo.',
  statement_email_subject: 'Extracto de conta {{periodo}} - {{empresa}}',
  statement_email_body: 'Segue em anexo o extracto da sua conta referente ao período {{periodo}}. O saldo em dívida à data final é de {{saldo}}.',
  email_reply_to: null
};

export interface DocumentTemplateOption {
  code: DocumentTemplateCode;
  label: string;
  description: string;
}

export const DOCUMENT_TEMPLATES: DocumentTemplateOption[] = [
  {
    code: 'classico',
    label: 'Clássico',
    description: 'Logótipo à esquerda e tabela com cabeçalho cinzento. É o aspecto actual das suas facturas.'
  },
  {
    code: 'moderno',
    label: 'Moderno',
    description: 'Faixa superior na cor da marca, com o logótipo centrado e tabela às riscas.'
  },
  {
    code: 'minimalista',
    label: 'Minimalista',
    description: 'Sem fundos nem faixas. Apenas um filete na cor da marca e tabela sem grelha.'
  }
];

@Injectable({
  providedIn: 'root'
})
export class DocumentSettingsService {
  /**
   * Definições já lidas, por empresa. Um sinal para que o documento e a
   * pré-visualização reajam a uma gravação sem terem de voltar a pedir.
   */
  private cache = signal<Record<string, DocumentBranding>>({});

  /** Pedidos em curso, para não repetir a mesma leitura em paralelo. */
  private pending = new Map<string, Promise<DocumentBranding>>();

  isSaving = signal(false);

  constructor(
    private supabase: SupabaseService,
    private auditLogService: AuditLogService
  ) {}

  /**
   * Devolve as definições já conhecidas de uma empresa, ou os valores por
   * omissão enquanto a leitura não terminar. Nunca devolve nulo, para que o
   * documento nunca fique sem marca.
   */
  brandingFor(companyId: string | null | undefined): DocumentBranding {
    if (!companyId) return DEFAULT_DOCUMENT_BRANDING;
    return this.cache()[companyId] ?? DEFAULT_DOCUMENT_BRANDING;
  }

  /**
   * Lê as definições de uma empresa. O que vier da base de dados é fundido por
   * cima dos valores por omissão, por isso uma linha em falta ou incompleta não
   * deixa o documento sem marca.
   */
  async resolve(companyId: string): Promise<DocumentBranding> {
    if (!companyId) return DEFAULT_DOCUMENT_BRANDING;

    const cached = this.cache()[companyId];
    if (cached) return cached;

    const inFlight = this.pending.get(companyId);
    if (inFlight) return inFlight;

    const request = this.fetch(companyId);
    this.pending.set(companyId, request);

    try {
      return await request;
    } finally {
      this.pending.delete(companyId);
    }
  }

  /** Força uma nova leitura, ignorando o que estiver em memória. */
  async reload(companyId: string): Promise<DocumentBranding> {
    this.cache.update(current => {
      const next = { ...current };
      delete next[companyId];
      return next;
    });
    return this.resolve(companyId);
  }

  private async fetch(companyId: string): Promise<DocumentBranding> {
    try {
      const { data, error } = await this.supabase.db
        .from('document_settings')
        .select('*')
        .eq('company_id', companyId)
        .maybeSingle();

      if (error) throw error;

      const branding = this.merge(data);
      this.cache.update(current => ({ ...current, [companyId]: branding }));
      return branding;
    } catch (error) {
      console.error('Erro ao carregar as definições de documento:', error);
      return DEFAULT_DOCUMENT_BRANDING;
    }
  }

  /**
   * Grava as definições de uma empresa.
   *
   * Usa inserção com actualização em conflito em vez de actualização simples,
   * para funcionar mesmo que a linha não tenha sido provisionada pelo gatilho.
   */
  async update(companyId: string, patch: Partial<DocumentBranding>): Promise<boolean> {
    if (!companyId) return false;

    this.isSaving.set(true);

    try {
      const anterior = this.brandingFor(companyId);

      const { data, error } = await this.supabase.db
        .from('document_settings')
        .upsert(
          { company_id: companyId, ...patch, updated_at: new Date().toISOString() },
          { onConflict: 'company_id' }
        )
        .select()
        .single();

      if (error) throw error;

      const branding = this.merge(data);
      this.cache.update(current => ({ ...current, [companyId]: branding }));

      await this.auditLogService.log(
        'Actualizou a Personalização de Documentos',
        'settings',
        { updates: patch, old: this.subset(anterior, patch) },
        companyId,
        undefined,
        companyId
      );

      return true;
    } catch (error) {
      console.error('Erro ao gravar as definições de documento:', error);
      return false;
    } finally {
      this.isSaving.set(false);
    }
  }

  /** Recorta os valores anteriores dos campos alterados, para o registo de auditoria. */
  private subset(
    branding: DocumentBranding,
    patch: Partial<DocumentBranding>
  ): Partial<DocumentBranding> {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(patch)) {
      result[key] = (branding as unknown as Record<string, unknown>)[key];
    }
    return result as Partial<DocumentBranding>;
  }

  private merge(row: any): DocumentBranding {
    if (!row) return DEFAULT_DOCUMENT_BRANDING;

    return {
      ...DEFAULT_DOCUMENT_BRANDING,
      ...Object.fromEntries(
        Object.entries(row).filter(([key, value]) =>
          key in DEFAULT_DOCUMENT_BRANDING && value !== null && value !== undefined
        )
      ),
      // O endereço de resposta é o único campo em que o nulo é significativo.
      email_reply_to: row.email_reply_to ?? null
    } as DocumentBranding;
  }
}
