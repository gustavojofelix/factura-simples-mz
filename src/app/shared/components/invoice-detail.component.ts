import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatTableModule } from '@angular/material/table';
import { MatDialog } from '@angular/material/dialog';
import { InvoiceService, Invoice } from '../../core/services/invoice.service';
import { PaymentService, Payment } from '../../core/services/payment.service';
import { CompanyService } from '../../core/services/company.service';
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
    MatProgressSpinnerModule
  ],
  template: `
    <div class="max-w-5xl mx-auto p-6 printable-content">
      @if (isLoading()) {
        <div class="text-center py-8">
          <mat-spinner diameter="40" class="mx-auto mb-4"></mat-spinner>
          <p class="text-gray-500">A carregar...</p>
        </div>
      } @else if (invoice()) {
        <div id="invoice-card" class="bg-white rounded-lg shadow-sm relative">
          @if (invoice()!.status === 'anulada') {
            <div class="watermark">ANULADO</div>
          }
          @if (isGeneratingPdf()) {
            <div class="absolute inset-0 bg-white/80 z-50 flex flex-col items-center justify-center rounded-lg no-print">
              <mat-spinner diameter="40" class="mb-2"></mat-spinner>
              <p class="text-sm font-medium text-gray-600">A gerar PDF...</p>
            </div>
          }
          <div class="p-4 sm:p-6 border-b border-gray-200/60">
            <div class="flex flex-col lg:flex-row lg:justify-between lg:items-start gap-4 mb-4">
              <div>
                <h1 class="text-xl sm:text-2xl font-bold text-gray-900">Factura {{ invoice()!.invoice_number }}</h1>
                <div class="flex flex-col gap-0.5 mt-1">
                  <p class="text-sm text-gray-500">{{ formatDate(invoice()!.date) }}</p>
                  <p class="text-xs text-slate-400 flex items-center">
                    <mat-icon class="!text-[12px] !w-3 !h-3 !mr-1">person</mat-icon>
                    Emitido por: {{ invoice()!.issuer_name || '-' }}
                  </p>
                </div>
              </div>
              <div class="grid grid-cols-2 lg:flex lg:flex-wrap lg:flex-row gap-2 w-full lg:w-auto no-print">
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

          <div class="p-4 sm:p-6 grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
            <div class="flex items-start gap-4">
              @if (company()?.logo_url) {
                <div class="w-16 h-16 sm:w-24 sm:h-24 bg-gray-50 rounded border border-gray-100 p-2 shrink-0">
                  <img [src]="company()!.logo_url" alt="Logo" class="w-full h-full object-contain">
                </div>
              }
              <div>
                <h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">EMPRESA</h3>
                @if (company()) {
                  <p class="font-bold text-slate-800 text-sm sm:text-base">{{ company()!.name }}</p>
                  @if (company()!.nuit) {
                    <p class="text-xs sm:text-sm text-gray-500 mt-1">NUIT: {{ company()!.nuit }}</p>
                  }
                  @if (company()!.address) {
                    <p class="text-xs sm:text-sm text-gray-500">{{ company()!.address }}</p>
                  }
                }
              </div>
            </div>

            <div>
              <h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">CLIENTE</h3>
              @if (invoice()!.client) {
                <p class="font-bold text-slate-800 text-sm sm:text-base">{{ invoice()!.client!.name }}</p>
                @if (invoice()!.client!.document_type || invoice()!.client!.nuit) {
                  <p class="text-xs sm:text-sm text-gray-500 mt-1">{{ invoice()!.client!.document_type || 'NUIT: ' + invoice()!.client!.nuit }}</p>
                }
                @if (invoice()!.client!.address) {
                  <p class="text-xs sm:text-sm text-gray-500">{{ invoice()!.client!.address }}</p>
                }
                @if (invoice()!.client!.phone) {
                  <p class="text-xs sm:text-sm text-gray-500">Tel: {{ invoice()!.client!.phone }}</p>
                }
                @if (invoice()!.client!.email) {
                  <p class="text-xs sm:text-sm text-gray-500">{{ invoice()!.client!.email }}</p>
                }
              }
            </div>
          </div>

          <div class="p-4 sm:p-6 border-t border-gray-200">
            <h3 class="text-base sm:text-lg font-semibold mb-4">Itens da Factura</h3>
            <div class="overflow-x-auto custom-scrollbar border border-slate-100 rounded-xl">
              <table class="w-full text-sm">
                <thead class="bg-gray-50">
                  <tr class="text-xs sm:text-sm">
                    <th class="text-left p-3 font-semibold text-gray-700 whitespace-nowrap">Produto/Serviço</th>
                    <th class="text-center p-3 font-semibold text-gray-700 whitespace-nowrap">Quantidade</th>
                    <th class="text-right p-3 font-semibold text-gray-700 whitespace-nowrap">Preço Unit.</th>
                    <th class="text-right p-3 font-semibold text-gray-700 whitespace-nowrap">Subtotal</th>
                    <th class="text-right p-3 font-semibold text-gray-700 whitespace-nowrap">Total</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                  @for (item of invoice()!.items || []; track item.id) {
                    <tr class="text-xs sm:text-sm">
                      <td class="p-3 whitespace-nowrap">{{ item.product_name }}</td>
                      <td class="p-3 text-center whitespace-nowrap">{{ item.quantity }}</td>
                      <td class="p-3 text-right whitespace-nowrap">{{ formatCurrency(item.unit_price) }}</td>
                      <td class="p-3 text-right whitespace-nowrap">{{ formatCurrency(item.subtotal) }}</td>
                      <td class="p-3 text-right font-medium whitespace-nowrap">{{ formatCurrency(item.total) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>

          <div class="p-4 sm:p-6 border-t border-gray-200 bg-gray-50">
            <div class="max-w-md ml-auto space-y-2">
              <div class="flex justify-between text-base sm:text-lg font-semibold">
                <span>Total:</span>
                <span>{{ formatCurrency(invoice()!.total) }}</span>
              </div>
              @if (invoice()!.amount_paid > 0) {
                <div class="flex justify-between text-xs sm:text-sm text-green-600 font-semibold">
                  <span>Pago:</span>
                  <span>{{ formatCurrency(invoice()!.amount_paid) }}</span>
                </div>
                <div class="flex justify-between text-xs sm:text-sm font-semibold" [class.text-red-600]="invoice()!.amount_pending > 0">
                  <span>Pendente:</span>
                  <span>{{ formatCurrency(invoice()!.amount_pending) }}</span>
                </div>
              }
            </div>
          </div>

          @if (invoice()!.notes) {
            <div class="p-4 sm:p-6 border-t border-gray-200">
              <h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">OBSERVAÇÕES</h3>
              <p class="text-sm text-gray-600">{{ invoice()!.notes }}</p>
            </div>
          }

          @if (company()?.bank_name) {
            <div class="p-4 sm:p-6 border-t border-gray-200 bg-blue-50/20">
              <h3 class="text-xs font-semibold text-blue-600 uppercase tracking-wider mb-3 flex items-center">
                <span class="mr-2">🏛️</span>
                COORDENADAS BANCÁRIAS
              </h3>
              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                @if (company()?.bank_name) {
                  <div>
                    <span class="text-gray-400 block text-xs uppercase mb-1">Banco</span>
                    <span class="font-medium text-gray-800">{{ company()?.bank_name }}</span>
                  </div>
                }
                @if (company()?.bank_account) {
                  <div>
                    <span class="text-gray-400 block text-xs uppercase mb-1">Conta</span>
                    <span class="font-medium text-gray-800">{{ company()?.bank_account }}</span>
                  </div>
                }
                @if (company()?.bank_iban) {
                  <div class="col-span-1 md:col-span-2">
                    <span class="text-gray-400 block text-xs uppercase mb-1">IBAN</span>
                    <span class="font-medium text-gray-800 break-all">{{ company()?.bank_iban }}</span>
                  </div>
                }
                @if (company()?.bank_swift) {
                  <div>
                    <span class="text-gray-400 block text-xs uppercase mb-1">SWIFT/BIC</span>
                    <span class="font-medium text-gray-800">{{ company()?.bank_swift }}</span>
                  </div>
                }
              </div>
            </div>
          }

          <div class="p-4 sm:p-6 border-t border-gray-200">
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

      .watermark-print {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-45deg);
    font-size: 190px;
    font-weight: 800;
    color: rgba(220, 38, 38, 0.5);
    z-index: 100;
    pointer-events: none;
    white-space: nowrap;
  }


      .only-print {
        display: block !important;
      }
    }

      .watermark {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) rotate(-45deg);
        font-size: 12vw;
        font-weight: 800;
        color: rgba(220, 38, 38, 0.12);
        z-index: 10;
        pointer-events: none;
        white-space: nowrap;
        user-select: none;
      }
      @media (min-width: 768px) {
        .watermark {
          font-size: 120px;
        }
      }

    .only-print {
      display: none;
    }
  `]
})
export class InvoiceDetailComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private dialog = inject(MatDialog);

  invoiceService = inject(InvoiceService);
  paymentService = inject(PaymentService);
  private companyService = inject(CompanyService);
  private pdfService = inject(PdfService);
  private supabase = inject(SupabaseService);

  invoice = signal<Invoice | null>(null);
  payments = signal<Payment[]>([]);
  company = this.companyService.activeCompany;
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

      // Check for print parameter
      const print = this.route.snapshot.queryParamMap.get('print');
      if (print) {
        setTimeout(() => this.printInvoice(), 800);
      }
    }

    this.isLoading.set(false);
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
        amountPending: invoice.amount_pending
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

  async printInvoice() {
    try {
      this.isGeneratingPdf.set(true);
      const blob = await this.pdfService.generatePdf('invoice-card', this.invoice()!.invoice_number);
      const url = window.URL.createObjectURL(blob);
      const printWindow = window.open(url);
      if (printWindow) {
        printWindow.onload = () => {
          printWindow.print();
          // Optionally revoke URL after some time
        };
      } else {
        // Fallback to direct print if popup blocked
        window.print();
      }
    } catch (error) {
      console.error('Erro ao preparar impressão:', error);
      window.print();
    } finally {
      this.isGeneratingPdf.set(false);
    }
  }

  async downloadInvoicePdf() {
    const invoice = this.invoice();
    if (!invoice) return;

    try {
      this.isGeneratingPdf.set(true);
      const blob = await this.pdfService.generatePdf('invoice-card', invoice.invoice_number);
      this.pdfService.downloadPdf(blob, `Factura_${invoice.invoice_number}`);
    } catch (error) {
      console.error('Erro ao gerar PDF:', error);
      alert('Erro ao gerar o ficheiro PDF. Por favor, tente novamente.');
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
      alert('Factura anulada com sucesso!');
    } else {
      alert('Erro ao anular factura');
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
      alert('Factura emitida com sucesso!');
    } else {
      alert('Erro ao emitir factura');
    }
  }

  async sendEmail() {
    const invoice = this.invoice();
    if (!invoice) return;

    if (!invoice.client?.email) {
      alert('O cliente associado a esta factura não possui endereço de e-mail.');
      return;
    }

    try {
      this.isGeneratingPdf.set(true);
      const blob = await this.pdfService.generatePdf('invoice-card', invoice.invoice_number);
      
      const base64pdf = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
      });

      const { data, error } = await this.supabase.client.functions.invoke('send-invoice-email', {
        body: { 
          to_email: invoice.client.email,
          client_name: invoice.client.name,
          invoice_number: invoice.invoice_number,
          pdf_base64: base64pdf 
        }
      });

      if (error) throw error;
      
      alert(`E-mail com a factura ${invoice.invoice_number} enviado com sucesso para ${invoice.client.email}!`);
    } catch (error) {
      console.error('Erro ao processar e-mail:', error);
      alert('Ocorreu um erro ao comunicar com os nossos serviços de e-mail.');
    } finally {
      this.isGeneratingPdf.set(false);
    }
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
}
