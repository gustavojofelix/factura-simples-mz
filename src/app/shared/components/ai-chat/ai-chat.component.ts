import {
  Component,
  ElementRef,
  ViewChild,
  input,
  signal,
  computed,
  effect,
  inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import {
  AiAssistantService,
  AiAttachment,
  toolLabel
} from '../../../core/services/ai-assistant.service';
import { CompanyService } from '../../../core/services/company.service';
import { ExportService } from '../../../core/services/export.service';
import { PdfService } from '../../../core/services/pdf.service';
import { ToastService } from '../../../core/services/toast.service';
import { AiMarkdownPipe } from './markdown.pipe';

/** Perguntas de arranque, mostradas apenas numa conversa vazia. */
const SUGESTOES = [
  { icon: 'receipt_long', texto: 'Quantas facturas emiti este mês?' },
  { icon: 'payments', texto: 'Qual é o total pendente por receber?' },
  { icon: 'trending_up', texto: 'Qual é o meu produto mais vendido?' },
  { icon: 'person_off', texto: 'Que clientes deixaram de comprar?' },
  { icon: 'description', texto: 'O que é o Modelo 30?' },
  { icon: 'event', texto: 'Quando devo pagar o ISPC?' }
];

@Component({
  selector: 'app-ai-chat',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    AiMarkdownPipe
  ],
  templateUrl: './ai-chat.component.html',
  styleUrls: ['./ai-chat.component.css']
})
export class AiChatComponent {
  /** 'widget' desenha-se dentro do painel flutuante; 'page' ocupa o ecrã. */
  variant = input<'widget' | 'page'>('widget');

  ai = inject(AiAssistantService);
  companyService = inject(CompanyService);
  private exportService = inject(ExportService);
  private pdfService = inject(PdfService);
  private toast = inject(ToastService);

  @ViewChild('scroller') scroller?: ElementRef<HTMLElement>;

  rascunho = signal('');
  mostrarHistorico = signal(false);

  sugestoes = SUGESTOES;
  toolLabel = toolLabel;

  conversaVazia = computed(() => this.ai.messages().length === 0);

  podeEnviar = computed(
    () => this.rascunho().trim().length > 0 && !this.ai.isStreaming()
  );

  quotaEsgotada = computed(() => {
    const restante = this.ai.quotaRemaining();
    return restante !== null && restante <= 0;
  });

  /** Empresa para a qual o chat já está sincronizado. */
  private empresaCarregada: string | null = null;

  constructor() {
    // Recarrega quando o utilizador TROCA de empresa: as conversas e a quota são
    // por empresa, e mostrar as da anterior seria enganador.
    //
    // A comparação com a empresa anterior é essencial. Sem ela, a primeira
    // passagem do efeito — que corre depois do ngOnInit do componente pai —
    // limparia uma pergunta já enviada pela página do assistente através do
    // parâmetro ?q=, e o utilizador veria o chat esvaziar-se sozinho.
    effect(() => {
      const empresa = this.companyService.activeCompany();
      if (!empresa || empresa.id === this.empresaCarregada) return;

      const primeiraVez = this.empresaCarregada === null;
      this.empresaCarregada = empresa.id;

      if (!primeiraVez) this.ai.startNewConversation();
      this.ai.loadQuota();
      this.ai.loadConversations();
    });

    // Mantém a vista colada ao fim enquanto a resposta vai crescendo.
    effect(() => {
      this.ai.messages();
      this.ai.currentTool();
      queueMicrotask(() => this.scrollParaBaixo());
    });
  }

  private scrollParaBaixo(): void {
    const el = this.scroller?.nativeElement;
    if (el) el.scrollTop = el.scrollHeight;
  }

  async enviar(): Promise<void> {
    if (!this.podeEnviar()) return;
    const texto = this.rascunho();
    this.rascunho.set('');
    await this.ai.ask(texto);
  }

  async enviarSugestao(texto: string): Promise<void> {
    if (this.ai.isStreaming()) return;
    await this.ai.ask(texto);
  }

  aoTeclar(evento: KeyboardEvent): void {
    // Enter envia; Shift+Enter muda de linha. Num telemóvel a tecla de envio do
    // teclado virtual também cai aqui, que é o comportamento esperado.
    if (evento.key === 'Enter' && !evento.shiftKey) {
      evento.preventDefault();
      this.enviar();
    }
  }

  novaConversa(): void {
    this.ai.startNewConversation();
    this.mostrarHistorico.set(false);
  }

  async abrirConversa(id: string): Promise<void> {
    await this.ai.openConversation(id);
    this.mostrarHistorico.set(false);
  }

  // ---------------------------------------------------------------------------
  // Exportação de relatórios
  // ---------------------------------------------------------------------------

  exportarExcel(anexo: AiAttachment): void {
    if (!anexo.linhas?.length) return;
    const nome = this.nomeFicheiro(anexo);
    this.exportService.exportToExcel(anexo.linhas, nome, anexo.titulo.slice(0, 30));
    this.toast.success('Relatório exportado', `${nome}.xlsx`);
  }

  async exportarPdf(anexo: AiAttachment, indice: number): Promise<void> {
    const elementId = `ai-anexo-${indice}`;
    try {
      const blob = await this.pdfService.generatePdf(elementId, this.nomeFicheiro(anexo));
      this.pdfService.downloadPdf(blob, this.nomeFicheiro(anexo));
      this.toast.success('Relatório exportado', 'PDF gerado com sucesso.');
    } catch {
      this.toast.error('Não foi possível gerar o PDF', 'Tente exportar para Excel.');
    }
  }

  private nomeFicheiro(anexo: AiAttachment): string {
    const empresa = this.companyService.activeCompany()?.name ?? 'relatorio';
    const data = new Date().toISOString().slice(0, 10);
    return `${empresa}-${anexo.titulo}-${data}`
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  /** Formata um valor de célula respeitando números e datas. */
  formatarCelula(valor: unknown): string {
    if (valor === null || valor === undefined || valor === '') return '—';
    if (typeof valor === 'number') {
      return valor.toLocaleString('pt-MZ', {
        minimumFractionDigits: Number.isInteger(valor) ? 0 : 2,
        maximumFractionDigits: 2
      });
    }
    if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)) {
      const [a, m, d] = valor.split('-');
      return `${d}/${m}/${a}`;
    }
    return String(valor);
  }

  rotularColuna(coluna: string): string {
    const texto = coluna.replace(/_/g, ' ');
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }
}
