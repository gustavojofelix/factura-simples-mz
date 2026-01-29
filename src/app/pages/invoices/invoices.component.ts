import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { InvoiceService, Invoice } from '../../core/services/invoice.service';
import { CompanyService } from '../../core/services/company.service';
import { InvoiceDialogComponent } from '../../shared/components/invoice-dialog.component';
import { PaymentDialogComponent } from '../../shared/components/payment-dialog.component';

@Component({
  selector: 'app-invoices',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatChipsModule,
    MatProgressSpinnerModule,
    MatMenuModule,
    MatDividerModule,
    MatSnackBarModule,
    MatDialogModule
  ],
  templateUrl: './invoices.component.html',
  styleUrls: ['./invoices.component.css']
})
export class InvoicesComponent implements OnInit {
  displayedColumns = ['invoice_number', 'client', 'date', 'total', 'status', 'actions'];

  searchTerm = signal('');
  statusFilter = signal<string>('todas');

  filteredInvoices = computed(() => {
    const term = this.searchTerm().toLowerCase();
    const status = this.statusFilter();
    let invoices = this.invoiceService.invoices();

    if (status !== 'todas') {
      invoices = invoices.filter(inv => inv.status === status);
    }

    if (term) {
      invoices = invoices.filter(inv =>
        inv.invoice_number.toLowerCase().includes(term) ||
        inv.client?.name.toLowerCase().includes(term)
      );
    }

    return invoices;
  });

  stats = computed(() => {
    const invoices = this.invoiceService.invoices();
    return {
      total: invoices.length,
      paga: invoices.filter(i => i.status === 'paga').length,
      pendente: invoices.filter(i => i.status === 'pendente').length,
      vencida: invoices.filter(i => i.status === 'vencida').length
    };
  });

  constructor(
    public invoiceService: InvoiceService,
    public companyService: CompanyService,
    private snackBar: MatSnackBar,
    private dialog: MatDialog,
    private router: Router
  ) {}

  ngOnInit() {
    this.invoiceService.loadInvoices();
  }

  onSearchChange(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.searchTerm.set(value);
  }

  filterByStatus(status: string) {
    this.statusFilter.set(status);
  }

  viewInvoice(invoice: Invoice) {
    this.router.navigate(['/facturas', invoice.id]);
  }

  printInvoice(invoice: Invoice) {
    this.router.navigate(['/facturas', invoice.id], { queryParams: { print: true } });
  }

  sendEmail(invoice: Invoice) {
    this.router.navigate(['/facturas', invoice.id], { queryParams: { email: true } });
  }

  async deleteInvoice(invoice: Invoice) {
    if (!confirm(`Tem certeza que deseja eliminar a factura ${invoice.invoice_number}?`)) {
      return;
    }

    if (!this.invoiceService.canDeleteInvoice(invoice)) {
      this.snackBar.open('Não é possível eliminar facturas pagas', 'Fechar', { duration: 3000 });
      return;
    }

    const success = await this.invoiceService.deleteInvoice(invoice.id);

    if (success) {
      this.snackBar.open('Factura eliminada!', 'Fechar', { duration: 2000 });
    } else {
      this.snackBar.open('Erro ao eliminar factura', 'Fechar', { duration: 3000 });
    }
  }

  formatCurrency(value: number): string {
    return this.invoiceService.formatCurrency(value);
  }

  formatDate(dateString: string): string {
    return this.invoiceService.formatDate(dateString);
  }

  getStatusColor(status: string): string {
    return this.invoiceService.getStatusColor(status);
  }

  getStatusLabel(status: string): string {
    return this.invoiceService.getStatusLabel(status).toUpperCase();
  }

  openNewInvoiceDialog() {
    const dialogRef = this.dialog.open(InvoiceDialogComponent, {
      width: '900px',
      maxWidth: '95vw',
      disableClose: true
    });

    dialogRef.afterClosed().subscribe((invoice: Invoice) => {
      if (invoice) {
        this.invoiceService.loadInvoices();
      }
    });
  }

  openPaymentDialog(invoice: Invoice) {
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

    dialogRef.afterClosed().subscribe((success: boolean) => {
      if (success) {
        this.invoiceService.loadInvoices();
        this.snackBar.open('Pagamento registado com sucesso!', 'Fechar', { duration: 3000 });
      }
    });
  }

  async editInvoice(invoice: Invoice) {
    if (!this.invoiceService.canEditInvoice(invoice)) {
      this.snackBar.open('Não é possível editar esta factura', 'Fechar', { duration: 3000 });
      return;
    }

    const fullInvoice = await this.invoiceService.getInvoiceWithItems(invoice.id);
    if (!fullInvoice) return;

    const dialogRef = this.dialog.open(InvoiceDialogComponent, {
      width: '900px',
      maxWidth: '95vw',
      disableClose: true,
      data: { invoice: fullInvoice }
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        this.invoiceService.loadInvoices();
      }
    });
  }
}
