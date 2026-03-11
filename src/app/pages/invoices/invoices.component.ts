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
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
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
    MatDialogModule,
    MatFormFieldModule,
    MatSelectModule
  ],
  templateUrl: './invoices.component.html',
  styleUrls: ['./invoices.component.css']
})
export class InvoicesComponent implements OnInit {
  displayedColumns = ['invoice_number', 'client', 'issuer_name', 'date', 'due_date', 'total', 'status', 'actions'];

  searchTerm = signal('');
  statusFilter = signal<string>('todas');
  sortField = signal<string>('date');
  sortDirection = signal<'asc' | 'desc'>('desc');

  filteredInvoices = computed(() => {
    const term = this.searchTerm().toLowerCase();
    const status = this.statusFilter();
    const field = this.sortField();
    const direction = this.sortDirection();
    let invoices = [...this.invoiceService.invoices()]; // Create a copy to sort

    // 1. Filtering by Status
    if (status !== 'todas') {
      invoices = invoices.filter(inv => inv.status === status);
    }

    // 2. Filtering by Search Term
    if (term) {
      invoices = invoices.filter(inv =>
        inv.invoice_number.toLowerCase().includes(term) ||
        inv.client?.name.toLowerCase().includes(term)
      );
    }

    // 3. Sorting
    invoices.sort((a, b) => {
      let valA: any;
      let valB: any;

      switch (field) {
        case 'invoice_number':
          valA = a.invoice_number;
          valB = b.invoice_number;
          break;
        case 'client':
          valA = a.client?.name || '';
          valB = b.client?.name || '';
          break;
        case 'date':
          valA = new Date(a.date).getTime();
          valB = new Date(b.date).getTime();
          break;
        case 'total':
          valA = a.total;
          valB = b.total;
          break;
        default:
          valA = a.created_at;
          valB = b.created_at;
      }

      if (valA < valB) return direction === 'asc' ? -1 : 1;
      if (valA > valB) return direction === 'asc' ? 1 : -1;
      return 0;
    });

    return invoices;
  });

  stats = computed(() => {
      const allInvoices = this.invoiceService.invoices();
    // Apenas ignora rascunhos. Anuladas continuam a contar para o número de facturas emitidas.
    const validInvoices = allInvoices.filter(i => i.status !== 'rascunho');
    
    return {
      total: validInvoices.length, // Agora apenas conta as que não são rascunhos
      paga: validInvoices.filter(i => i.status === 'paga').length,
      pendente: validInvoices.filter(i => i.status === 'pendente').length,
      vencida: validInvoices.filter(i => i.status === 'vencida').length
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

  toggleSortDirection() {
    this.sortDirection.update(d => d === 'asc' ? 'desc' : 'asc');
  }

  onSortFieldChange(field: string) {
    this.sortField.set(field);
  }

  viewInvoice(invoice: Invoice) {
    this.router.navigate(['/facturas', invoice.id]);
  }

  printInvoice(invoice: Invoice) {
    this.router.navigate(['/facturas', invoice.id], { queryParams: { print: true } });
  }

  async emitDraft(invoice: Invoice) {
    if (!confirm(`Deseja validar e emitir esta factura? Esta acção irá atribuir o número sequencial final.`)) {
      return;
    }

    const success = await this.invoiceService.emitInvoice(invoice.id);
    if (success) {
      this.snackBar.open('Factura emitida com sucesso!', 'Fechar', { duration: 3000 });
    } else {
      this.snackBar.open('Erro ao emitir factura', 'Fechar', { duration: 3000 });
    }
  }

  sendEmail(invoice: Invoice) {
    this.router.navigate(['/facturas', invoice.id], { queryParams: { email: true } });
  }

  async deleteInvoice(invoice: Invoice) {
    if (!confirm(`Tem certeza que deseja eliminar o rascunho ${invoice.invoice_number}?`)) {
      return;
    }

    const success = await this.invoiceService.deleteInvoice(invoice.id);

    if (success) {
      this.snackBar.open('Rascunho eliminado!', 'Fechar', { duration: 2000 });
    } else {
      this.snackBar.open('Erro ao eliminar rascunho', 'Fechar', { duration: 3000 });
    }
  }

  async annulInvoice(invoice: Invoice) {
    if (!confirm(`Tem certeza que deseja ANULAR a factura ${invoice.invoice_number}? Esta acção irá restaurar o stock e excluir a factura dos cálculos de impostos.`)) {
      return;
    }

    const success = await this.invoiceService.annulInvoice(invoice.id);

    if (success) {
      this.snackBar.open('Factura anulada com sucesso!', 'Fechar', { duration: 3000 });
    } else {
      this.snackBar.open('Erro ao anular factura', 'Fechar', { duration: 3000 });
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
      width: '1000px',
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
      width: '1000px',
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
