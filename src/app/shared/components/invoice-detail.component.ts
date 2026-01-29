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
    InvoiceDialogComponent
  ],
  template: `
    <div class="max-w-5xl mx-auto p-6">
      @if (isLoading()) {
        <div class="text-center py-8">
          <p class="text-gray-500">A carregar...</p>
        </div>
      } @else if (invoice()) {
        <div class="bg-white rounded-lg shadow-sm">
          <div class="p-6 border-b border-gray-200">
            <div class="flex justify-between items-start mb-4">
              <div>
                <h1 class="text-2xl font-bold text-gray-900">Factura {{ invoice()!.invoice_number }}</h1>
                <p class="text-sm text-gray-500 mt-1">{{ formatDate(invoice()!.date) }}</p>
              </div>
              <div class="flex gap-2">
                <button mat-stroked-button (click)="goBack()">
                  <mat-icon>arrow_back</mat-icon>
                  Voltar
                </button>
                <button mat-stroked-button (click)="printInvoice()">
                  <mat-icon>print</mat-icon>
                  Imprimir PDF
                </button>
                <button mat-stroked-button (click)="sendEmail()" [disabled]="!invoice()!.client?.email">
                  <mat-icon>email</mat-icon>
                  Enviar Email
                </button>
                @if (invoiceService.canEditInvoice(invoice()!)) {
                  <button mat-raised-button class="!bg-moz-green !text-white" (click)="editInvoice()">
                    <mat-icon>edit</mat-icon>
                    Editar
                  </button>
                }
              </div>
            </div>

            <div class="flex items-center gap-2">
              <mat-chip [class]="invoiceService.getStatusColor(invoice()!.status)">
                {{ invoiceService.getStatusLabel(invoice()!.status) }}
              </mat-chip>
              @if (invoice()!.due_date) {
                <span class="text-sm text-gray-600">
                  Vencimento: {{ formatDate(invoice()!.due_date!) }}
                </span>
              }
            </div>
          </div>

          <div class="p-6 grid grid-cols-2 gap-8">
            <div>
              <h3 class="text-sm font-semibold text-gray-700 mb-2">EMPRESA</h3>
              @if (company()) {
                <p class="font-medium">{{ company()!.name }}</p>
                @if (company()!.nuit) {
                  <p class="text-sm text-gray-600">NUIT: {{ company()!.nuit }}</p>
                }
                @if (company()!.address) {
                  <p class="text-sm text-gray-600">{{ company()!.address }}</p>
                }
              }
            </div>

            <div>
              <h3 class="text-sm font-semibold text-gray-700 mb-2">CLIENTE</h3>
              @if (invoice()!.client) {
                <p class="font-medium">{{ invoice()!.client!.name }}</p>
                @if (invoice()!.client!.document_type || invoice()!.client!.nuit) {
                  <p class="text-sm text-gray-600">{{ invoice()!.client!.document_type || 'NUIT: ' + invoice()!.client!.nuit }}</p>
                }
                @if (invoice()!.client!.address) {
                  <p class="text-sm text-gray-600">{{ invoice()!.client!.address }}</p>
                }
                @if (invoice()!.client!.phone) {
                  <p class="text-sm text-gray-600">Tel: {{ invoice()!.client!.phone }}</p>
                }
                @if (invoice()!.client!.email) {
                  <p class="text-sm text-gray-600">{{ invoice()!.client!.email }}</p>
                }
              }
            </div>
          </div>

          <div class="p-6 border-t border-gray-200">
            <h3 class="text-lg font-semibold mb-4">Itens da Factura</h3>
            <table mat-table [dataSource]="invoice()!.items || []" class="w-full">
              <ng-container matColumnDef="product">
                <th mat-header-cell *matHeaderCellDef class="text-left">Produto/Serviço</th>
                <td mat-cell *matCellDef="let item">{{ item.product_name }}</td>
              </ng-container>

              <ng-container matColumnDef="quantity">
                <th mat-header-cell *matHeaderCellDef class="text-center">Quantidade</th>
                <td mat-cell *matCellDef="let item" class="text-center">{{ item.quantity }}</td>
              </ng-container>

              <ng-container matColumnDef="price">
                <th mat-header-cell *matHeaderCellDef class="text-right">Preço Unit.</th>
                <td mat-cell *matCellDef="let item" class="text-right">{{ formatCurrency(item.unit_price) }}</td>
              </ng-container>

              <ng-container matColumnDef="subtotal">
                <th mat-header-cell *matHeaderCellDef class="text-right">Subtotal</th>
                <td mat-cell *matCellDef="let item" class="text-right">{{ formatCurrency(item.subtotal) }}</td>
              </ng-container>

              <ng-container matColumnDef="total">
                <th mat-header-cell *matHeaderCellDef class="text-right">Total</th>
                <td mat-cell *matCellDef="let item" class="text-right font-medium">{{ formatCurrency(item.total) }}</td>
              </ng-container>

              <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: displayedColumns;"></tr>
            </table>
          </div>

          <div class="p-6 border-t border-gray-200 bg-gray-50">
            <div class="max-w-md ml-auto space-y-2">
              <div class="flex justify-between text-lg font-semibold">
                <span>Total:</span>
                <span>{{ formatCurrency(invoice()!.total) }}</span>
              </div>
              @if (invoice()!.amount_paid > 0) {
                <div class="flex justify-between text-sm text-green-600">
                  <span>Pago:</span>
                  <span class="font-medium">{{ formatCurrency(invoice()!.amount_paid) }}</span>
                </div>
                <div class="flex justify-between text-sm" [class.text-red-600]="invoice()!.amount_pending > 0">
                  <span>Pendente:</span>
                  <span class="font-medium">{{ formatCurrency(invoice()!.amount_pending) }}</span>
                </div>
              }
            </div>
          </div>

          @if (invoice()!.notes) {
            <div class="p-6 border-t border-gray-200">
              <h3 class="text-sm font-semibold text-gray-700 mb-2">OBSERVAÇÕES</h3>
              <p class="text-sm text-gray-600">{{ invoice()!.notes }}</p>
            </div>
          }

          <div class="p-6 border-t border-gray-200">
              <div class="flex justify-between items-center mb-4">
              <h3 class="text-lg font-semibold">Pagamentos</h3>
              @if (invoiceService.canManagePayments(invoice()!)) {
                <button mat-raised-button color="primary" (click)="openPaymentDialog()">
                  <mat-icon>add</mat-icon>
                  Registar Pagamento
                </button>
              }
            </div>

            @if (payments().length > 0) {
              <table mat-table [dataSource]="payments()" class="w-full">
                <ng-container matColumnDef="date">
                  <th mat-header-cell *matHeaderCellDef>Data</th>
                  <td mat-cell *matCellDef="let payment">{{ formatDate(payment.payment_date) }}</td>
                </ng-container>

                <ng-container matColumnDef="method">
                  <th mat-header-cell *matHeaderCellDef>Método</th>
                  <td mat-cell *matCellDef="let payment">{{ paymentService.getPaymentMethodLabel(payment.payment_method) }}</td>
                </ng-container>

                <ng-container matColumnDef="reference">
                  <th mat-header-cell *matHeaderCellDef>Referência</th>
                  <td mat-cell *matCellDef="let payment">{{ payment.reference || '-' }}</td>
                </ng-container>

                <ng-container matColumnDef="amount">
                  <th mat-header-cell *matHeaderCellDef class="text-right">Valor</th>
                  <td mat-cell *matCellDef="let payment" class="text-right font-medium">{{ formatCurrency(payment.amount) }}</td>
                </ng-container>

                <ng-container matColumnDef="actions">
                  <th mat-header-cell *matHeaderCellDef></th>
                  <td mat-cell *matCellDef="let payment">
                    <button mat-icon-button (click)="viewReceipt(payment.id)">
                      <mat-icon>receipt</mat-icon>
                    </button>
                    @if (invoiceService.canManagePayments(invoice()!)) {
                      <button mat-icon-button (click)="deletePayment(payment.id)" color="warn">
                        <mat-icon>delete</mat-icon>
                      </button>
                    }
                  </td>
                </ng-container>

                <tr mat-header-row *matHeaderRowDef="paymentColumns"></tr>
                <tr mat-row *matRowDef="let row; columns: paymentColumns;"></tr>
              </table>
            } @else {
              <p class="text-gray-500 text-center py-4">Nenhum pagamento registado</p>
            }
          </div>
        </div>
      } @else {
        <div class="text-center py-8">
          <p class="text-gray-500">Factura não encontrada</p>
        </div>
      }
    </div>
  `
})
export class InvoiceDetailComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private dialog = inject(MatDialog);

  invoiceService = inject(InvoiceService);
  paymentService = inject(PaymentService);
  private companyService = inject(CompanyService);

  invoice = signal<Invoice | null>(null);
  payments = signal<Payment[]>([]);
  company = this.companyService.activeCompany;
  isLoading = signal(true);

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

  printInvoice() {
    alert('Funcionalidade de impressão PDF em desenvolvimento');
  }

  sendEmail() {
    alert('Funcionalidade de envio de email em desenvolvimento');
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
