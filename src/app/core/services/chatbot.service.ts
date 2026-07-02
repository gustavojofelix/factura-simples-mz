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
}

@Injectable({
  providedIn: 'root'
})
export class ChatbotService {
  isOpen = signal<boolean>(false);
  isLoading = signal<boolean>(false);
  messages = signal<ChatMessage[]>([]);
  currentPageContext = signal<string>('painel');

  private readonly STORAGE_KEY = 'fs_chatbot_history';

  constructor(
    private supabase: SupabaseService,
    private companyService: CompanyService,
    private router: Router
  ) {
    this.loadHistory();

    // Listen to route changes to dynamically update context
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
    if (url.includes('/facturas')) {
      context = 'facturas';
    } else if (url.includes('/clientes')) {
      context = 'clientes';
    } else if (url.includes('/produtos')) {
      context = 'produtos';
    } else if (url.includes('/impostos')) {
      context = 'impostos';
    } else if (url.includes('/relatorios')) {
      context = 'relatorios';
    } else if (url.includes('/configuracoes')) {
      context = 'configuracoes';
    } else if (url.includes('/perfil')) {
      context = 'perfil';
    } else if (url.includes('/auditoria')) {
      context = 'auditoria';
    }
    
    this.currentPageContext.set(context);

    // If chat is open and empty, generate a context-aware welcome message
    if (this.messages().length === 0) {
      this.sendWelcomeMessage();
    }
  }

  sendWelcomeMessage() {
    const context = this.currentPageContext();
    let content = 'Olá! Sou o seu assistente inteligente do ISPC Fácil. Como posso ajudar com as finanças da sua empresa hoje?';
    let suggestions: string[] = [
      'Como funciona o ISPC?',
      'Como emitir uma factura?',
      'Como consultar relatórios?'
    ];

    switch (context) {
      case 'facturas':
        content = 'Olá! Vejo que está na secção de Facturas. Deseja que eu explique como emitir uma factura certificada pela AT ou como gerir faturas pendentes?';
        suggestions = ['Como emitir factura?', 'Como anular factura?', 'Ver faturas atrasadas'];
        break;
      case 'clientes':
        content = 'Olá! Está na lista de Clientes. Deseja saber como verificar um NUIT de Moçambique ou como ver o histórico de facturação de um cliente específico?';
        suggestions = ['Como validar NUIT?', 'Clientes com mais dívida', 'Cadastrar cliente estrangeiro'];
        break;
      case 'produtos':
        content = 'Olá! Está na secção de Produtos e Serviços. Precisa de ajuda para cadastrar um produto ou gerir códigos de produtos por empresa?';
        suggestions = ['Cadastrar produto novo', 'Isenção de IVA em produtos', 'Como associar código'];
        break;
      case 'impostos':
        content = 'Olá! Está na secção de Impostos. Precisa de ajuda para simular ou calcular as parcelas progressivas do ISPC (3%, 4%, 5% ou 20%) para este período?';
        suggestions = ['Calcular ISPC deste trimestre', 'Limites do ISPC em Moçambique', 'Como funciona a retenção de 20%?'];
        break;
      case 'relatorios':
        content = 'Olá! Está na área de Relatórios. Deseja que eu faça uma análise inteligente das suas vendas ou resuma o desempenho financeiro do trimestre?';
        suggestions = ['Resumir minhas vendas', 'Análise de fluxo de caixa', 'Exportar dados para contabilidade'];
        break;
      case 'configuracoes':
        content = 'Olá! Está nas Configurações. Quer ajuda para configurar os dados da empresa, gerir utilizadores ou atualizar a subscrição?';
        suggestions = ['Adicionar utilizador', 'Configurar SMTP do email', 'Alterar dados de faturação'];
        break;
    }

    const welcomeMsg: ChatMessage = {
      id: 'welcome',
      role: 'assistant',
      content,
      timestamp: new Date(),
      suggestions
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

    // Add user message to history
    this.messages.update(msgs => [...msgs, userMessage]);
    this.saveHistory();
    this.isLoading.set(true);

    try {
      const activeCompany = this.companyService.activeCompany();
      const activeRole = this.companyService.activeRole();

      // Invoke Supabase Edge Function
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

      const assistantMessage: ChatMessage = {
        id: Math.random().toString(36).substring(7),
        role: 'assistant',
        content: data?.reply || 'Desculpe, ocorreu um erro ao processar a resposta.',
        timestamp: new Date(),
        suggestions: data?.suggestions || []
      };

      this.messages.update(msgs => [...msgs, assistantMessage]);
      this.saveHistory();
    } catch (err) {
      console.error('Error calling chat-assistant Edge Function:', err);
      const errorMessage: ChatMessage = {
        id: Math.random().toString(36).substring(7),
        role: 'assistant',
        content: 'Desculpe, de momento não consegui ligar-me ao servidor do assistente inteligente. Por favor, tente novamente.',
        timestamp: new Date()
      };
      this.messages.update(msgs => [...msgs, errorMessage]);
    } finally {
      this.isLoading.set(false);
    }
  }

  clearChat() {
    this.messages.set([]);
    this.sendWelcomeMessage();
    this.saveHistory();
  }

  private saveHistory() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.messages()));
    } catch (e) {
      console.error('Error saving chat history to localStorage:', e);
    }
  }

  private loadHistory() {
    try {
      const historyStr = localStorage.getItem(this.STORAGE_KEY);
      if (historyStr) {
        const loadedMsgs = JSON.parse(historyStr);
        // Map string dates back to Date objects
        const msgs = loadedMsgs.map((m: any) => ({
          ...m,
          timestamp: new Date(m.timestamp)
        }));
        this.messages.set(msgs);
      } else {
        this.sendWelcomeMessage();
      }
    } catch (e) {
      console.error('Error loading chat history from localStorage:', e);
      this.sendWelcomeMessage();
    }
  }
}
