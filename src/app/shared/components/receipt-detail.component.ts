import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { PaymentService, Payment } from '../../core/services/payment.service';
import { InvoiceService, Invoice } from '../../core/services/invoice.service';
import { CompanyService, Company } from '../../core/services/company.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { PdfService } from '../../core/services/pdf.service';
import {
  DocumentSettingsService,
  DocumentBranding,
  DEFAULT_DOCUMENT_BRANDING
} from '../../core/services/document-settings.service';
import { ReceiptDocumentComponent } from './documents/receipt-document.component';

export interface ReceiptDialogData {
  paymentId: string;
  invoiceId: string;
}

@Component({
  selector: 'app-receipt-detail',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    ReceiptDocumentComponent
  ],
  template: `
    <div class="receipt-dialog">
      <h2 mat-dialog-title class="flex items-center justify-between">
        <span>Recibo de Pagamento</span>
        <button mat-icon-button (click)="close()">
          <mat-icon>close</mat-icon>
        </button>
      </h2>

      <mat-dialog-content>
        @if (isLoading()) {
          <div class="text-center py-8">
            <mat-spinner diameter="36" class="mx-auto mb-3"></mat-spinner>
            <p class="text-gray-500">A carregar...</p>
          </div>
        } @else if (payment() && invoice()) {
          <!-- Documento fiscal. É isto que sai em PDF. -->
          <div id="receipt-document" class="bg-white relative">
            @if (isGeneratingPdf()) {
              <div class="absolute inset-0 bg-white/80 z-50 flex flex-col items-center justify-center no-print">
                <mat-spinner diameter="36" class="mb-2"></mat-spinner>
                <p class="text-sm font-medium text-gray-600">A gerar PDF...</p>
              </div>
            }
            <app-receipt-document
              [payment]="payment()!"
              [invoice]="invoice()!"
              [company]="documentCompany()"
              [branding]="branding()">
            </app-receipt-document>
          </div>
        } @else {
          <div class="text-center py-8">
            <p class="text-gray-500">Erro ao carregar recibo</p>
          </div>
        }
      </mat-dialog-content>

      <mat-dialog-actions align="end" class="border-t">
        <button mat-button (click)="close()">Fechar</button>
        <button mat-stroked-button (click)="downloadReceipt()" [disabled]="!payment() || isGeneratingPdf()">
          <mat-icon>file_download</mat-icon>
          PDF
        </button>
        <button mat-stroked-button (click)="printReceipt()" [disabled]="!payment() || isGeneratingPdf()">
          <mat-icon>print</mat-icon>
          Imprimir
        </button>
        <button mat-stroked-button (click)="sendEmail()"
          [disabled]="!payment() || !invoice()?.client?.email || isGeneratingPdf() || paymentService.isAnnulled(payment()!)">
          <mat-icon>email</mat-icon>
          Enviar Email
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .receipt-dialog {
      min-width: 600px;
      max-width: 800px;
    }

    mat-dialog-content {
      max-height: 70vh;
      overflow-y: auto;
      padding: 20px;
    }
  `]
})
export class ReceiptDetailComponent implements OnInit {
  private dialogRef = inject(MatDialogRef<ReceiptDetailComponent>);
  data = inject<ReceiptDialogData>(MAT_DIALOG_DATA);

  paymentService = inject(PaymentService);
  invoiceService = inject(InvoiceService);
  private companyService = inject(CompanyService);
  private documentSettings = inject(DocumentSettingsService);
  private pdfService = inject(PdfService);
  private supabase = inject(SupabaseService);
  private snackBar = inject(MatSnackBar);

  payment = signal<Payment | null>(null);
  invoice = signal<Invoice | null>(null);

  /** A empresa que emitiu o documento, que não é forçosamente a empresa activa. */
  documentCompany = signal<Company | null>(null);
  branding = signal<DocumentBranding>(DEFAULT_DOCUMENT_BRANDING);

  isLoading = signal(true);
  isGeneratingPdf = signal(false);

  async ngOnInit() {
    await this.loadData();
  }

  async loadData() {
    this.isLoading.set(true);

    try {
      const [payments, invoice] = await Promise.all([
        this.paymentService.loadPaymentsByInvoice(this.data.invoiceId),
        this.invoiceService.getInvoiceWithItems(this.data.invoiceId)
      ]);

      const payment = payments.find(p => p.id === this.data.paymentId);
      this.payment.set(payment || null);
      this.invoice.set(invoice);

      if (invoice) await this.loadIssuingCompany(invoice);
    } catch (error) {
      console.error('Erro ao carregar dados do recibo:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  private async loadIssuingCompany(invoice: Invoice) {
    const known = this.companyService.companies().find(c => c.id === invoice.company_id)
      ?? (this.companyService.activeCompany()?.id === invoice.company_id
        ? this.companyService.activeCompany()
        : null);

    if (known) {
      this.documentCompany.set(known);
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

  private pdfOptions() {
    const copies = Math.min(3, Math.max(1, this.branding().receipt_copies || 1));
    const labels = ['ORIGINAL', 'DUPLICADO', 'TRIPLICADO'];

    return {
      marginMm: 10,
      copies,
      copyLabels: copies > 1 ? labels.slice(0, copies) : undefined
    };
  }

  private async gerarPdf(): Promise<Blob> {
    return this.pdfService.generatePdf(
      'receipt-document',
      this.receiptFileName(),
      this.pdfOptions()
    );
  }

  private receiptFileName(): string {
    const payment = this.payment();
    const numero = payment ? this.paymentService.getReceiptNumber(payment) : '';
    return `Recibo_${numero}`;
  }

  async downloadReceipt() {
    if (!this.payment()) return;

    try {
      this.isGeneratingPdf.set(true);
      const blob = await this.gerarPdf();
      this.pdfService.downloadPdf(blob, this.receiptFileName());
    } catch (error) {
      console.error('Erro ao gerar o recibo em PDF:', error);
      this.snackBar.open('Não foi possível gerar o recibo em PDF.', 'Fechar', { duration: 4000 });
    } finally {
      this.isGeneratingPdf.set(false);
    }
  }

  /**
   * Antes mandava imprimir a página inteira, o que imprimia a aplicação toda
   * por baixo do diálogo. Agora gera o mesmo PDF e manda imprimir esse.
   */
  async printReceipt() {
    if (!this.payment()) return;

    try {
      this.isGeneratingPdf.set(true);
      const blob = await this.gerarPdf();
      const url = window.URL.createObjectURL(blob);
      const printWindow = window.open(url);

      if (printWindow) {
        printWindow.onload = () => printWindow.print();
      } else {
        this.snackBar.open(
          'Não foi possível abrir a janela de impressão. Verifique se o navegador está a bloquear janelas.',
          'Fechar',
          { duration: 5000 }
        );
      }
    } catch (error) {
      console.error('Erro ao preparar a impressão do recibo:', error);
      this.snackBar.open('Não foi possível preparar a impressão.', 'Fechar', { duration: 4000 });
    } finally {
      this.isGeneratingPdf.set(false);
    }
  }

  async sendEmail() {
    const payment = this.payment();
    const invoice = this.invoice();
    if (!payment || !invoice) return;

    if (!invoice.client?.email) {
      this.snackBar.open('O cliente associado a esta factura não possui endereço de e-mail.', 'Fechar', { duration: 4000 });
      return;
    }

    try {
      this.isGeneratingPdf.set(true);

      // O anexo enviado ao cliente leva sempre uma via. As vias servem a
      // impressão em papel, não o correio electrónico.
      const blob = await this.pdfService.generatePdf(
        'receipt-document',
        this.receiptFileName(),
        { marginMm: 10 }
      );

      const base64pdf = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
      });

      const { data, error } = await this.supabase.client.functions.invoke('send-invoice-email', {
        body: {
          invoice_id: invoice.id,
          document_kind: 'recibo',
          payment_id: payment.id,
          pdf_base64: base64pdf
        }
      });

      if (error) throw new Error(await this.extrairMensagemDeErro(error));
      if (data && data.success === false) throw new Error(data.error || 'O envio foi recusado.');

      this.snackBar.open(
        `Recibo enviado com sucesso para ${invoice.client.email}.`,
        'Fechar',
        { duration: 5000 }
      );
    } catch (error) {
      console.error('Erro ao enviar o recibo:', error);
      const mensagem = error instanceof Error && error.message
        ? error.message
        : 'Ocorreu um erro ao enviar o recibo.';
      this.snackBar.open(mensagem, 'Fechar', { duration: 6000 });
    } finally {
      this.isGeneratingPdf.set(false);
    }
  }

  /** A resposta real da função fica escondida dentro do erro do supabase-js. */
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
    return 'Ocorreu um erro ao enviar o recibo.';
  }

  close() {
    this.dialogRef.close();
  }
}
