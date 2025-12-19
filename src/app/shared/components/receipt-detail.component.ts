import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { PaymentService, Payment } from '../../core/services/payment.service';
import { InvoiceService, Invoice } from '../../core/services/invoice.service';
import { CompanyService } from '../../core/services/company.service';

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
    MatDividerModule
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
            <p class="text-gray-500">A carregar...</p>
          </div>
        } @else if (payment() && invoice() && company()) {
          <div id="receipt-content" class="bg-white">
            <div class="text-center mb-6 pb-4 border-b-2 border-gray-300">
              @if (company()!.logo_url) {
                <img [src]="company()!.logo_url" alt="Logo" class="h-16 mx-auto mb-2">
              }
              <h2 class="text-2xl font-bold text-gray-900">{{ company()!.name }}</h2>
              @if (company()!.nuit) {
                <p class="text-sm text-gray-600">NUIT: {{ company()!.nuit }}</p>
              }
              @if (company()!.address) {
                <p class="text-sm text-gray-600">{{ company()!.address }}</p>
              }
              @if (company()!.phone) {
                <p class="text-sm text-gray-600">Tel: {{ company()!.phone }}</p>
              }
            </div>

            <div class="text-center mb-6">
              <h3 class="text-xl font-bold text-gray-900 mb-2">RECIBO DE PAGAMENTO</h3>
              <p class="text-sm text-gray-600">Recibo Nº: {{ payment()!.id.substring(0, 8).toUpperCase() }}</p>
              <p class="text-sm text-gray-600">Data: {{ formatDate(payment()!.payment_date) }}</p>
            </div>

            <div class="mb-6 p-4 bg-gray-50 rounded">
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <p class="text-xs text-gray-500 font-semibold mb-1">CLIENTE</p>
                  @if (invoice()!.client) {
                    <p class="font-medium">{{ invoice()!.client!.name }}</p>
                    @if (invoice()!.client!.document_type || invoice()!.client!.nuit) {
                      <p class="text-sm text-gray-600">{{ invoice()!.client!.document_type || 'NUIT: ' + invoice()!.client!.nuit }}</p>
                    }
                    @if (invoice()!.client!.address) {
                      <p class="text-sm text-gray-600">{{ invoice()!.client!.address }}</p>
                    }
                  }
                </div>
                <div>
                  <p class="text-xs text-gray-500 font-semibold mb-1">REFERENTE À FACTURA</p>
                  <p class="font-medium">{{ invoice()!.invoice_number }}</p>
                  <p class="text-sm text-gray-600">Data: {{ formatDate(invoice()!.date) }}</p>
                  <p class="text-sm text-gray-600">Total Factura: {{ formatCurrency(invoice()!.total) }}</p>
                </div>
              </div>
            </div>

            <div class="mb-6">
              <table class="w-full">
                <thead class="bg-gray-100">
                  <tr>
                    <th class="text-left p-3 text-sm font-semibold text-gray-700">Descrição</th>
                    <th class="text-right p-3 text-sm font-semibold text-gray-700">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  <tr class="border-b">
                    <td class="p-3">
                      <p class="font-medium">Pagamento - {{ invoice()!.invoice_number }}</p>
                      <p class="text-sm text-gray-600">Método: {{ paymentService.getPaymentMethodLabel(payment()!.payment_method) }}</p>
                      @if (payment()!.reference) {
                        <p class="text-sm text-gray-600">Ref: {{ payment()!.reference }}</p>
                      }
                    </td>
                    <td class="p-3 text-right font-medium">{{ formatCurrency(payment()!.amount) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="mb-6 p-4 bg-green-50 border border-green-200 rounded">
              <div class="flex justify-between items-center mb-2">
                <span class="text-lg font-semibold text-gray-900">Total Pago:</span>
                <span class="text-2xl font-bold text-green-600">{{ formatCurrency(payment()!.amount) }}</span>
              </div>
              <mat-divider class="my-2"></mat-divider>
              <div class="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span class="text-gray-600">Total Factura:</span>
                  <span class="font-medium ml-2">{{ formatCurrency(invoice()!.total) }}</span>
                </div>
                <div>
                  <span class="text-gray-600">Total Pago (Acum.):</span>
                  <span class="font-medium ml-2 text-green-600">{{ formatCurrency(invoice()!.amount_paid) }}</span>
                </div>
                <div>
                  <span class="text-gray-600">Saldo Restante:</span>
                  <span class="font-medium ml-2" [class.text-red-600]="invoice()!.amount_pending > 0" [class.text-green-600]="invoice()!.amount_pending === 0">
                    {{ formatCurrency(invoice()!.amount_pending) }}
                  </span>
                </div>
                <div>
                  <span class="text-gray-600">Estado:</span>
                  <span class="font-medium ml-2" [class.text-green-600]="invoice()!.status === 'paga'" [class.text-orange-600]="invoice()!.status === 'pendente'">
                    {{ invoiceService.getStatusLabel(invoice()!.status).toUpperCase() }}
                  </span>
                </div>
              </div>
            </div>

            @if (payment()!.notes) {
              <div class="mb-6 p-3 bg-gray-50 rounded">
                <p class="text-xs text-gray-500 font-semibold mb-1">OBSERVAÇÕES</p>
                <p class="text-sm text-gray-700">{{ payment()!.notes }}</p>
              </div>
            }

            <div class="text-center pt-4 border-t border-gray-300">
              <p class="text-xs text-gray-500">Recibo gerado automaticamente em {{ formatDate(today) }}</p>
              <p class="text-xs text-gray-500 mt-1">Este documento é válido sem assinatura</p>
            </div>
          </div>
        } @else {
          <div class="text-center py-8">
            <p class="text-gray-500">Erro ao carregar recibo</p>
          </div>
        }
      </mat-dialog-content>

      <mat-dialog-actions align="end" class="border-t">
        <button mat-button (click)="close()">Fechar</button>
        <button mat-stroked-button (click)="printReceipt()" [disabled]="!payment()">
          <mat-icon>print</mat-icon>
          Imprimir PDF
        </button>
        <button mat-stroked-button (click)="sendEmail()" [disabled]="!payment() || !invoice()?.client?.email">
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

    #receipt-content {
      padding: 30px;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    }

    @media print {
      .receipt-dialog {
        width: 100%;
        max-width: 100%;
      }

      mat-dialog-title,
      mat-dialog-actions {
        display: none !important;
      }

      mat-dialog-content {
        max-height: none;
        overflow: visible;
        padding: 0;
      }

      #receipt-content {
        padding: 20px;
      }
    }
  `]
})
export class ReceiptDetailComponent implements OnInit {
  private dialogRef = inject(MatDialogRef<ReceiptDetailComponent>);
  data = inject<ReceiptDialogData>(MAT_DIALOG_DATA);

  paymentService = inject(PaymentService);
  invoiceService = inject(InvoiceService);
  private companyService = inject(CompanyService);

  payment = signal<Payment | null>(null);
  invoice = signal<Invoice | null>(null);
  company = this.companyService.activeCompany;
  isLoading = signal(true);
  today = new Date().toISOString();

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
    } catch (error) {
      console.error('Erro ao carregar dados do recibo:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  printReceipt() {
    window.print();
  }

  sendEmail() {
    alert('Funcionalidade de envio de email em desenvolvimento');
  }

  close() {
    this.dialogRef.close();
  }

  formatCurrency(value: number): string {
    return this.paymentService.formatCurrency(value);
  }

  formatDate(date: string): string {
    return this.paymentService.formatDate(date);
  }
}
