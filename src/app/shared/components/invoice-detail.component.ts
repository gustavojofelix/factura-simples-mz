import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatTableModule } from '@angular/material/table';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { InvoiceService, Invoice } from '../../core/services/invoice.service';
import { PaymentService, Payment } from '../../core/services/payment.service';
import { CompanyService, Company } from '../../core/services/company.service';
import {
  DocumentSettingsService,
  DocumentBranding,
  DEFAULT_DOCUMENT_BRANDING
} from '../../core/services/document-settings.service';
import { InvoiceDocumentComponent } from './documents/invoice-document.component';
import { PaymentDialogComponent } from './payment-dialog.component';
import { ReceiptDetailComponent } from './receipt-detail.component';
import { InvoiceDialogComponent } from './invoice-dialog.component';
import { PdfService } from '../../core/services/pdf.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { SupabaseService } from '../../core/services/supabase.service';

@Component({
  selector: 'app-invoice-detail',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatChipsModule,
    MatTableModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    InvoiceDocumentComponent
  ],
  template: `
    <div class="max-w-5xl mx-auto p-6 printable-content">
      @if (isLoading()) {
        <div class="text-center py-8">
          <mat-spinner diameter="40" class="mx-auto mb-4"></mat-spinner>
          <p class="text-gray-500">A carregar...</p>
        </div>
      } @else if (invoice()) {
        <!-- Barra de acções e estado. É interface da aplicação e fica de fora
             do documento, para não aparecer no PDF enviado ao cliente. -->
        <div class="bg-white rounded-lg shadow-sm p-4 sm:p-6 mb-4 no-print">
          <div class="flex flex-col lg:flex-row lg:justify-between lg:items-start gap-4 mb-4">
              <div>
                <div class="flex items-center gap-3">
                  <h1 class="text-xl sm:text-2xl font-bold text-gray-900">Factura {{ invoice()!.invoice_number }}</h1>
                  @if ((invoice()!.print_count || 0) > 1) {
                    <span class="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-amber-100 text-amber-900 border border-amber-300 shadow-xs">
                      2ª VIA
                    </span>
                  } @else {
                    <span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                      ORIGINAL
                    </span>
                  }
                </div>
                <div class="flex flex-col gap-0.5 mt-1">
                  <p class="text-sm font-medium text-slate-700">Data e Hora de Emissão: {{ formatDateTime(invoice()!.created_at || invoice()!.date) }}</p>
                  <p class="text-xs text-slate-400">Emitido por: {{ invoice()!.issuer_name || '-' }}</p>
                </div>
              </div>
              <div class="grid grid-cols-2 lg:flex lg:flex-wrap lg:flex-row gap-2 w-full lg:w-auto">
                @if (invoice()!.status === 'rascunho') {
                  <button mat-raised-button class="!bg-ispc-orange !text-white col-span-2 lg:col-span-1 w-full lg:w-auto !text-xs sm:!text-sm" (click)="emitDraft()">
                    <mat-icon class="!text-xs mr-1">check_circle</mat-icon>
                    Validar e Emitir
                  </button>
                }
                <button mat-stroked-button class="col-span-1 w-full lg:w-auto !text-xs sm:!text-sm" (click)="goBack()">
                  <mat-icon class="!text-xs mr-1">arrow_back</mat-icon>
                  Voltar
                </button>
                <button mat-stroked-button class="col-span-1 w-full lg:w-auto !text-xs sm:!text-sm" (click)="downloadInvoicePdf()" [disabled]="invoice()!.status === 'rascunho' || isGeneratingPdf()">
                  <mat-icon class="!text-xs mr-1">file_download</mat-icon>
                  PDF
                </button>
                <button mat-stroked-button class="col-span-1 w-full lg:w-auto !text-xs sm:!text-sm" (click)="printInvoice()" [disabled]="invoice()!.status === 'rascunho' || isGeneratingPdf()">
                  <mat-icon class="!text-xs mr-1">print</mat-icon>
                  Imprimir
                </button>
                <button mat-stroked-button class="col-span-1 w-full lg:w-auto !text-xs sm:!text-sm" (click)="sendEmail()" [disabled]="!invoice()!.client?.email || invoice()!.status === 'rascunho'">
                  <mat-icon class="!text-xs mr-1">email</mat-icon>
                  Email
                </button>
                @if (invoiceService.canEditInvoice(invoice()!)) {
                  <button mat-raised-button class="!bg-ispc-orange !text-white col-span-2 lg:col-span-1 w-full lg:w-auto !text-xs sm:!text-sm" (click)="editInvoice()">
                    <mat-icon class="!text-xs mr-1">edit</mat-icon>
                    Editar
                  </button>
                }
                @if (invoiceService.canAnnulInvoice(invoice()!)) {
                  <button mat-raised-button color="warn" class="col-span-2 w-full lg:w-auto !text-xs sm:!text-sm" (click)="annulInvoice()">
                    <mat-icon class="!text-xs mr-1">block</mat-icon>
                    Anular Factura
                  </button>
                }
              </div>
            </div>

            <div class="flex items-center gap-2">
              <span 
                class="px-3 py-1 rounded-full text-xs font-semibold"
                [class]="invoiceService.getStatusColor(invoice()!.status)"
              >
                {{ invoiceService.getStatusLabel(invoice()!.status).toUpperCase() }}
              </span>
              @if (invoice()!.due_date) {
                <span class="text-sm text-gray-600">
                  Vencimento: {{ formatDate(invoice()!.due_date!) }}
                </span>
              }
            </div>
          </div>

          <!-- Documento fiscal. É exactamente isto que sai em PDF e segue
               anexo ao e-mail do cliente. Nada de interface da aplicação
               daqui para dentro. -->
          <div id="invoice-document" class="bg-white rounded-lg shadow-sm relative overflow-hidden">
            @if (isGeneratingPdf()) {
              <div class="absolute inset-0 bg-white/80 z-50 flex flex-col items-center justify-center no-print">
                <mat-spinner diameter="40" class="mb-2"></mat-spinner>
                <p class="text-sm font-medium text-gray-600">A gerar PDF...</p>
              </div>
            }
            <app-invoice-document
              [invoice]="invoice()!"
              [company]="documentCompany()"
              [branding]="branding()">
            </app-invoice-document>
          </div>

          <!-- Histórico de pagamentos. Interface da aplicação, fora do documento. -->
          <div class="bg-white rounded-lg shadow-sm mt-4 no-print">
            <div class="p-4 sm:p-6">
            <div class="flex justify-between items-center mb-4">
              <h3 class="text-base sm:text-lg font-semibold">Pagamentos</h3>
              @if (invoice()!.status !== 'rascunho' && invoiceService.canManagePayments(invoice()!)) {
                <button mat-raised-button color="primary" (click)="openPaymentDialog()" class="no-print !h-10 !rounded-lg !text-xs sm:!text-sm">
                  <mat-icon>add</mat-icon>
                  Registar Pagamento
                </button>
              }
            </div>

            @if (payments().length > 0) {
              <div class="overflow-x-auto custom-scrollbar border border-slate-100 rounded-xl">
                <table class="w-full text-sm">
                  <thead class="bg-gray-50">
                    <tr class="text-xs sm:text-sm">
                      <th class="text-left p-3 font-semibold text-gray-700 whitespace-nowrap">Data</th>
                      <th class="text-left p-3 font-semibold text-gray-700 whitespace-nowrap">Método</th>
                      <th class="text-left p-3 font-semibold text-gray-700 whitespace-nowrap">Referência</th>
                      <th class="text-right p-3 font-semibold text-gray-700 whitespace-nowrap">Valor</th>
                      <th class="text-right p-3 font-semibold text-gray-700 no-print whitespace-nowrap">Ações</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-100">
                    @for (payment of payments(); track payment.id) {
                      <tr class="text-xs sm:text-sm">
                        <td class="p-3 whitespace-nowrap">{{ formatDate(payment.payment_date) }}</td>
                        <td class="p-3 whitespace-nowrap">{{ paymentService.getPaymentMethodLabel(payment.payment_method) }}</td>
                        <td class="p-3 whitespace-nowrap">{{ payment.reference || '-' }}</td>
                        <td class="p-3 text-right font-medium text-ispc-orange whitespace-nowrap">{{ formatCurrency(payment.amount) }}</td>
                        <td class="p-3 text-right no-print whitespace-nowrap">
                          <button mat-icon-button (click)="viewReceipt(payment.id)">
                            <mat-icon>receipt</mat-icon>
                          </button>
                          @if (invoiceService.canManagePayments(invoice()!)) {
                            <button mat-icon-button (click)="deletePayment(payment.id)" color="warn">
                              <mat-icon>delete</mat-icon>
                            </button>
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <p class="text-gray-500 text-center py-4 text-xs sm:text-sm">Nenhum pagamento registado</p>
            }
          </div>
        </div>
      } @else {
        <div class="text-center py-8">
          <p class="text-gray-500">Factura não encontrada</p>
        </div>
      }
    </div>
  `,
  styles: [`
    @media print {
      /* Hide everything except the invoice container */
      :host ::ng-deep body, 
      :host ::ng-deep .mat-drawer-container,
      :host ::ng-deep .mat-drawer-content {
        background: white !important;
        margin: 0 !important;
        padding: 0 !important;
        height: auto !important;
        min-height: auto !important;
      }

      .no-print {
        display: none !important;
      }

      .printable-content {
        visibility: visible;
        position: absolute;
        left: 0;
        top: 0;
        width: 100% !important;
        max-width: none !important;
        margin: 0 !important;
        padding: 0 !important;
        box-shadow: none !important;
        border: none !important;
      }

      /* Reset card styles for print */
      mat-card {
        box-shadow: none !important;
        border: none !important;
        border-radius: 0 !important;
      }

      .bg-white {
        background: white !important;
      }

      .bg-gray-50 {
        background: white !important;
        border-top: 1px solid #e5e7eb !important;
      }

      .border-b {
        border-bottom: 1px solid #e5e7eb !important;
      }

      .border-t {
        border-top: 1px solid #e5e7eb !important;
      }

      /* Table styles for print */
      table {
        width: 100% !important;
        border-collapse: collapse !important;
      }

      th {
        background-color: #f9fafb !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
        border-bottom: 2px solid #e5e7eb !important;
        padding: 8px !important;
      }

      td {
        border-bottom: 1px solid #f3f4f6 !important;
        padding: 8px !important;
      }

      /* Force background colors to print */
      .mat-mdc-chip {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }

    }

    /* As marcas de água vivem agora no componente do documento, que é o que
       sai em PDF. Ver documents/document-skins.css. */
  `]
})
export class InvoiceDetailComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);

  invoiceService = inject(InvoiceService);
  paymentService = inject(PaymentService);
  private companyService = inject(CompanyService);
  private pdfService = inject(PdfService);
  private supabase = inject(SupabaseService);
  private documentSettings = inject(DocumentSettingsService);

  invoice = signal<Invoice | null>(null);
  payments = signal<Payment[]>([]);

  /**
   * A empresa que emitiu esta factura, que não é necessariamente a empresa
   * activa. Quem tem mais do que uma empresa e abre uma factura de outra via
   * pesquisa ou ligação directa veria, de outro modo, a marca e o NUIT errados
   * num documento fiscal.
   */
  documentCompany = signal<Company | null>(null);

  /** Personalização da empresa emissora. */
  branding = signal<DocumentBranding>(DEFAULT_DOCUMENT_BRANDING);
  isLoading = signal(true);
  isGeneratingPdf = signal(false);

  displayedColumns = ['product', 'quantity', 'price', 'subtotal', 'total'];
  paymentColumns = ['date', 'method', 'reference', 'amount', 'actions'];

  async ngOnInit() {
    const invoiceId = this.route.snapshot.paramMap.get('id');
    if (invoiceId) {
      await this.loadInvoice(invoiceId);
    }
  }

  async loadInvoice(invoiceId: string) {
    this.isLoading.set(true);
    const invoice = await this.invoiceService.getInvoiceWithItems(invoiceId);
    this.invoice.set(invoice);

    if (invoice) {
      const payments = await this.paymentService.loadPaymentsByInvoice(invoiceId);
      this.payments.set(payments);

      await this.loadIssuingCompany(invoice);

      // Check for print parameter
      const print = this.route.snapshot.queryParamMap.get('print');
      if (print) {
        setTimeout(() => this.printInvoice(), 800);
      }
    }

    this.isLoading.set(false);
  }

  /**
   * Carrega a empresa emissora e a respectiva personalização. Usa a empresa
   * que já está em memória quando possível e só vai à base de dados se a
   * factura for de uma empresa que não esteja na lista carregada.
   */
  private async loadIssuingCompany(invoice: Invoice) {
    const knownCompany = this.companyService.companies().find(c => c.id === invoice.company_id)
      ?? (this.companyService.activeCompany()?.id === invoice.company_id
        ? this.companyService.activeCompany()
        : null);

    if (knownCompany) {
      this.documentCompany.set(knownCompany);
    } else {
      try {
        const { data } = await this.supabase.db
          .from('companies')
          .select('*')
          .eq('id', invoice.company_id)
          .maybeSingle();
        this.documentCompany.set((data as Company) ?? null);
      } catch (error) {
        console.error('Erro ao carregar a empresa emissora:', error);
        this.documentCompany.set(null);
      }
    }

    this.branding.set(await this.documentSettings.resolve(invoice.company_id));
  }

  openPaymentDialog() {
    const invoice = this.invoice();
    if (!invoice) return;

    const dialogRef = this.dialog.open(PaymentDialogComponent, {
      width: '500px',
      data: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoice_number,
        totalAmount: invoice.total,
        amountPaid: invoice.amount_paid,
        amountPending: invoice.amount_pending,
        invoiceDate: invoice.date
      }
    });

    dialogRef.afterClosed().subscribe(async (result) => {
      if (result) {
        await this.loadInvoice(invoice.id);
        await this.invoiceService.loadInvoices();
      }
    });
  }

  viewReceipt(paymentId: string) {
    const invoice = this.invoice();
    if (!invoice) return;

    this.dialog.open(ReceiptDetailComponent, {
      width: '800px',
      maxWidth: '95vw',
      data: {
        paymentId: paymentId,
        invoiceId: invoice.id
      }
    });
  }

  async deletePayment(paymentId: string) {
    if (confirm('Tem certeza que deseja eliminar este pagamento?')) {
      const success = await this.paymentService.deletePayment(paymentId);
      if (success && this.invoice()) {
        await this.loadInvoice(this.invoice()!.id);
        await this.invoiceService.loadInvoices();
      }
    }
  }

  async editInvoice() {
    const invoice = this.invoice();
    if (!invoice || !this.invoiceService.canEditInvoice(invoice)) return;

    const dialogRef = this.dialog.open(InvoiceDialogComponent, {
      width: '900px',
      maxWidth: '95vw',
      disableClose: true,
      data: { invoice }
    });

    dialogRef.afterClosed().subscribe(async (result) => {
      if (result) {
        await this.loadInvoice(invoice.id);
        await this.invoiceService.loadInvoices();
      }
    });
  }

  async trackPrint() {
    const currentInvoice = this.invoice();
    if (!currentInvoice) return;
    const newCount = await this.invoiceService.incrementPrintCount(currentInvoice.id);
    this.invoice.update(inv => inv ? { ...inv, print_count: newCount } : null);
  }

  /**
   * Opções de geração do PDF para impressão e descarregamento.
   *
   * As vias e o contador de reimpressões são coisas diferentes e ambas têm de
   * continuar legíveis. As vias dizem quantas cópias saem numa emissão. O
   * contador diz quantas vezes a factura já foi materializada, e é o que faz
   * aparecer a marca de água de segunda via. Emitir em triplicado conta como
   * uma impressão, não três.
   */
  private pdfOptionsForPrinting() {
    const copies = Math.min(3, Math.max(1, this.branding().invoice_copies || 1));
    const isReprint = (this.invoice()?.print_count || 0) > 1;
    const base = ['ORIGINAL', 'DUPLICADO', 'TRIPLICADO'];

    return {
      copies,
      copyLabels: copies > 1 || isReprint
        ? base.slice(0, copies).map(label => isReprint ? `2ª VIA — ${label}` : label)
        : undefined
    };
  }

  async printInvoice() {
    try {
      this.isGeneratingPdf.set(true);
      await this.trackPrint();
      const blob = await this.pdfService.generatePdf(
        'invoice-document',
        this.invoice()!.invoice_number,
        this.pdfOptionsForPrinting()
      );
      const url = window.URL.createObjectURL(blob);
      const printWindow = window.open(url);
      if (printWindow) {
        printWindow.onload = () => {
          printWindow.print();
        };
      } else {
        this.snackBar.open(
          'Não foi possível abrir a janela de impressão. Verifique se o navegador está a bloquear janelas.',
          'Fechar',
          { duration: 5000 }
        );
      }
    } catch (error) {
      console.error('Erro ao preparar impressão:', error);
      // Mandar imprimir a página inteira deixou de ser um recurso válido: as
      // regras de impressão já não alcançam o documento, que passou a ser um
      // componente próprio, e sairia deformado.
      this.snackBar.open('Não foi possível preparar a impressão.', 'Fechar', { duration: 4000 });
    } finally {
      this.isGeneratingPdf.set(false);
    }
  }

  async downloadInvoicePdf() {
    const invoice = this.invoice();
    if (!invoice) return;

    try {
      this.isGeneratingPdf.set(true);
      await this.trackPrint();
      const blob = await this.pdfService.generatePdf(
        'invoice-document',
        invoice.invoice_number,
        this.pdfOptionsForPrinting()
      );
      this.pdfService.downloadPdf(blob, `Factura_${invoice.invoice_number}`);
    } catch (error) {
      console.error('Erro ao gerar PDF:', error);
      this.snackBar.open('Erro ao gerar o ficheiro PDF. Por favor, tente novamente.', 'Fechar', { duration: 4000 });
    } finally {
      this.isGeneratingPdf.set(false);
    }
  }

  async annulInvoice() {
    const invoice = this.invoice();
    if (!invoice || !this.invoiceService.canAnnulInvoice(invoice)) return;

    if (!confirm(`Tem certeza que deseja ANULAR a factura ${invoice.invoice_number}? Esta acção irá restaurar o stock e excluir a factura dos cálculos de impostos.`)) {
      return;
    }

    const success = await this.invoiceService.annulInvoice(invoice.id);
    if (success) {
      await this.loadInvoice(invoice.id);
      this.snackBar.open('Factura anulada com sucesso!', 'Fechar', { duration: 3000 });
    } else {
      this.snackBar.open('Erro ao anular factura', 'Fechar', { duration: 3000 });
    }
  }

  async emitDraft() {
    const invoice = this.invoice();
    if (!invoice || invoice.status !== 'rascunho') return;

    if (!confirm(`Deseja validar e emitir esta factura? Esta acção irá atribuir o número sequencial final.`)) {
      return;
    }

    const success = await this.invoiceService.emitInvoice(invoice.id);
    if (success) {
      await this.loadInvoice(invoice.id);
      this.snackBar.open('Factura emitida com sucesso!', 'Fechar', { duration: 3000 });
    } else {
      this.snackBar.open('Erro ao emitir factura', 'Fechar', { duration: 3000 });
    }
  }

  async sendEmail() {
    const invoice = this.invoice();
    if (!invoice) return;

    if (!invoice.client?.email) {
      this.snackBar.open('O cliente associado a esta factura não possui endereço de e-mail.', 'Fechar', { duration: 4000 });
      return;
    }

    try {
      this.isGeneratingPdf.set(true);
      const blob = await this.pdfService.generatePdf('invoice-document', invoice.invoice_number);
      
      const base64pdf = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
      });

      // O destinatário e os dados apresentados no e-mail são resolvidos no
      // servidor a partir da própria factura. Aqui só se identifica o documento.
      const { data, error } = await this.supabase.client.functions.invoke('send-invoice-email', {
        body: {
          invoice_id: invoice.id,
          pdf_base64: base64pdf
        }
      });

      if (error) {
        throw new Error(await this.extrairMensagemDeErro(error));
      }
      if (data && data.success === false) {
        throw new Error(data.error || 'O envio foi recusado.');
      }

      this.snackBar.open(`E-mail com a factura ${invoice.invoice_number} enviado com sucesso para ${invoice.client.email}!`, 'Fechar', { duration: 5000 });
    } catch (error) {
      console.error('Erro ao processar e-mail:', error);
      const mensagem = error instanceof Error && error.message
        ? error.message
        : 'Ocorreu um erro ao enviar o e-mail.';
      this.snackBar.open(mensagem, 'Fechar', { duration: 6000 });
    } finally {
      this.isGeneratingPdf.set(false);
    }
  }

  /**
   * Quando a função recusa o pedido, o supabase-js devolve um erro genérico e
   * guarda a resposta real em `context`. Sem isto, o utilizador via sempre a
   * mesma mensagem, independentemente do motivo.
   */
  private async extrairMensagemDeErro(error: unknown): Promise<string> {
    const contexto = (error as { context?: unknown })?.context;

    if (contexto instanceof Response) {
      try {
        const corpo = await contexto.clone().json();
        if (corpo?.error) return corpo.error;
      } catch {
        // Resposta sem corpo JSON: fica a mensagem genérica.
      }
    }

    if (error instanceof Error && error.message) return error.message;
    return 'Ocorreu um erro ao enviar o e-mail.';
  }

  goBack() {
    this.router.navigate(['/facturas']);
  }

  formatCurrency(value: number): string {
    return this.invoiceService.formatCurrency(value);
  }

  formatDate(date: string): string {
    return this.invoiceService.formatDate(date);
  }

  formatDateTime(date?: string): string {
    return this.invoiceService.formatDateTime(date);
  }
}
