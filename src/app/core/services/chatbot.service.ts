import { Injectable, signal, effect } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CompanyService } from './company.service';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  suggestions?: string[];
  actions?: AIAction[];
}

export interface AIAction {
  type: 'CREATE_PRODUCTS' | 'CREATE_CLIENTS' | 'NAVIGATE' | 'FILTER_DATA' | 'GENERATE_REPORT';
  label: string;
  requiresConfirmation: boolean;
  payload: any;
  status?: 'pending' | 'executing' | 'done' | 'error';
}

@Injectable({
  providedIn: 'root'
})
export class ChatbotService {
  isOpen = signal<boolean>(false);
  isLoading = signal<boolean>(false);
  messages = signal<ChatMessage[]>([]);
  currentPageContext = signal<string>('painel');
  pendingActions = signal<AIAction[]>([]);

  private readonly STORAGE_KEY = 'fs_chatbot_history';

  constructor(
    private supabase: SupabaseService,
    private companyService: CompanyService,
    private router: Router
  ) {
    this.loadHistory();

    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe((event: any) => {
        const url = event.urlAfterRedirects || event.url;
        this.updateContextFromUrl(url);
      });
  }

  toggleOpen() {
    this.isOpen.update(v => !v);
  }

  setOpen(open: boolean) {
    this.isOpen.set(open);
  }

  private updateContextFromUrl(url: string) {
    let context = 'painel';
    if (url.includes('/facturas')) context = 'facturas';
    else if (url.includes('/clientes')) context = 'clientes';
    else if (url.includes('/produtos')) context = 'produtos';
    else if (url.includes('/impostos')) context = 'impostos';
    else if (url.includes('/relatorios')) context = 'relatorios';
    else if (url.includes('/configuracoes')) context = 'configuracoes';
    else if (url.includes('/perfil')) context = 'perfil';
    else if (url.includes('/auditoria')) context = 'auditoria';
    else if (url.includes('/assistente')) context = 'assistente';
    else if (url.includes('/designer-de-facturas')) context = 'designer-de-facturas';
    else if (url.includes('/insights-ia')) context = 'insights-ia';

    this.currentPageContext.set(context);

    if (this.messages().length === 0) {
      this.sendWelcomeMessage();
    }
  }

  sendWelcomeMessage() {
    const context = this.currentPageContext();
    let content = 'Olá! Sou o seu assistente inteligente. Diga-me o que quer fazer e eu faço por si. Por exemplo: *"Cria produtos de electrónica"* ou *"Emite uma factura para o cliente João"*.';
    let suggestions: string[] = [
      'Cria produtos de electrónica para a minha empresa',
      'Como emitir uma factura?',
      'Analisa as minhas vendas deste mês'
    ];

    switch (context) {
      case 'facturas':
        content = 'Está na secção de **Facturas**. Posso criar facturas, anular, ou ajudar a gerir facturas pendentes. O que deseja?';
        suggestions = ['Cria uma factura de teste', 'Ver facturas em atraso', 'Como anular uma factura?'];
        break;
      case 'clientes':
        content = 'Está nos **Clientes**. Posso adicionar clientes, verificar NUITs ou criar clientes de exemplo. O que precisa?';
        suggestions = ['Cria 3 clientes de teste', 'Como validar um NUIT?', 'Ver clientes com mais dívida'];
        break;
      case 'produtos':
        content = 'Está nos **Produtos e Serviços**. Posso criar um catálogo completo para o seu sector com um único comando!';
        suggestions = ['Cria produtos de electrónica', 'Cria serviços de construção civil', 'Cria produtos de alimentação'];
        break;
      case 'impostos':
        content = 'Está nos **Impostos**. Posso calcular o ISPC, explicar os prazos e ajudar com declarações. O que precisa?';
        suggestions = ['Calcula o ISPC deste trimestre', 'Quando vence o próximo ISPC?', 'Explica o ISPC progressivo'];
        break;
      case 'relatorios':
        content = 'Está nos **Relatórios**. Posso resumir as suas vendas, analisar o fluxo de caixa e identificar tendências.';
        suggestions = ['Resume as minhas vendas', 'Análise de fluxo de caixa', 'Exportar dados para contabilidade'];
        break;
      case 'assistente':
        content = '# Olá! Sou o seu Assistente de IA 🤖\n\nPosso **fazer coisas** por si, não apenas explicar. Experimente:\n\n- *"Tenho uma empresa de TI, cria o meu catálogo de serviços"*\n- *"Cria 5 clientes de teste com dados reais"*\n- *"Explica-me como funciona o ISPC"*\n\nO que posso fazer por si hoje?';
        suggestions = ['Cria catálogo de produtos de electrónica', 'Cria 5 clientes de teste', 'Analisa a minha situação fiscal'];
        break;
      case 'designer-de-facturas':
        content = 'Está no **Designer de Facturas**. Escolha um tema, personalize as cores com o seu logotipo e activa o design para todas as suas facturas!';
        suggestions = ['Que tema combina com tecnologia?', 'Como adicionar o logotipo?', 'Qual é o melhor tema para serviços?'];
        break;
      case 'insights-ia':
        content = 'Está nos **Insights de IA**. Analisei os dados da sua empresa e tenho sugestões importantes para si!';
        suggestions = ['Quais são os meus riscos financeiros?', 'Como melhorar o fluxo de caixa?', 'Quando devo pagar o ISPC?'];
        break;
      case 'configuracoes':
        content = 'Está nas **Configurações**. Posso ajudar a configurar a empresa, gerir utilizadores ou actualizar a subscrição.';
        suggestions = ['Adicionar utilizador', 'Configurar SMTP de email', 'Alterar dados de faturação'];
        break;
    }

    const welcomeMsg: ChatMessage = {
      id: 'welcome',
      role: 'assistant',
      content,
      timestamp: new Date(),
      suggestions,
      actions: []
    };

    this.messages.set([welcomeMsg]);
    this.saveHistory();
  }

  async sendMessage(content: string) {
    if (!content.trim() || this.isLoading()) return;

    const userMessage: ChatMessage = {
      id: Math.random().toString(36).substring(7),
      role: 'user',
      content,
      timestamp: new Date()
    };

    this.messages.update(msgs => [...msgs, userMessage]);
    this.saveHistory();
    this.isLoading.set(true);

    try {
      const activeCompany = this.companyService.activeCompany();
      const activeRole = this.companyService.activeRole();

      const { data, error } = await this.supabase.client.functions.invoke('chat-assistant', {
        body: {
          message: content,
          history: this.messages().slice(0, -1).map(m => ({ role: m.role, content: m.content })),
          context: {
            page: this.currentPageContext(),
            companyId: activeCompany?.id || null,
            companyName: activeCompany?.name || null,
            userRole: activeRole || null
          }
        }
      });

      if (error) throw error;

      const actions: AIAction[] = (data?.actions || []).map((a: any) => ({
        ...a,
        status: 'pending' as const
      }));

      // Set pending actions for the AI Action Panel
      if (actions.length > 0) {
        this.pendingActions.set(actions);
      }

      const assistantMessage: ChatMessage = {
        id: Math.random().toString(36).substring(7),
        role: 'assistant',
        content: data?.reply || 'Desculpe, ocorreu um erro ao processar a resposta.',
        timestamp: new Date(),
        suggestions: data?.suggestions || [],
        actions
      };

      this.messages.update(msgs => [...msgs, assistantMessage]);
      this.saveHistory();
    } catch (err) {
      console.error('Error calling chat-assistant:', err);
      const errorMessage: ChatMessage = {
        id: Math.random().toString(36).substring(7),
        role: 'assistant',
        content: 'Desculpe, de momento não consegui ligar-me ao servidor do assistente. Por favor, tente novamente.',
        timestamp: new Date(),
        actions: []
      };
      this.messages.update(msgs => [...msgs, errorMessage]);
    } finally {
      this.isLoading.set(false);
    }
  }

  clearPendingActions() {
    this.pendingActions.set([]);
  }

  clearChat() {
    this.messages.set([]);
    this.pendingActions.set([]);
    this.sendWelcomeMessage();
    this.saveHistory();
  }

  private saveHistory() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.messages()));
    } catch (e) {
      console.error('Error saving chat history:', e);
    }
  }

  private loadHistory() {
    try {
      const historyStr = localStorage.getItem(this.STORAGE_KEY);
      if (historyStr) {
        const msgs = JSON.parse(historyStr).map((m: any) => ({
          ...m,
          timestamp: new Date(m.timestamp)
        }));
        this.messages.set(msgs);
      } else {
        this.sendWelcomeMessage();
      }
    } catch (e) {
      console.error('Error loading chat history:', e);
      this.sendWelcomeMessage();
    }
  }
}
