import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MatDialog } from '@angular/material/dialog';
import { MatStepperModule } from '@angular/material/stepper';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ClientService, Client } from '../../core/services/client.service';
import { ProductService, Product } from '../../core/services/product.service';
import { InvoiceService, InvoiceItem } from '../../core/services/invoice.service';

@Component({
  selector: 'app-quick-client-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule
  ],
  template: `
    <h2 mat-dialog-title>Cliente Rápido</h2>
    <mat-dialog-content class="!pt-4">
      <form [formGroup]="form" class="space-y-4">
        <mat-form-field appearance="outline" class="w-full">
          <mat-label>Nome</mat-label>
          <input matInput formControlName="name" placeholder="Nome do cliente">
        </mat-form-field>

        <mat-form-field appearance="outline" class="w-full">
          <mat-label>NUIT (opcional)</mat-label>
          <input matInput formControlName="nuit">
        </mat-form-field>

        <mat-form-field appearance="outline" class="w-full">
          <mat-label>Telefone (opcional)</mat-label>
          <input matInput formControlName="phone">
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end" class="!px-6 !pb-4">
      <button mat-button mat-dialog-close>Cancelar</button>
      <button
        mat-raised-button
        class="!bg-moz-green !text-white"
        [disabled]="form.invalid || saving()"
        (click)="save()"
      >
        {{ saving() ? 'A guardar...' : 'Criar' }}
      </button>
    </mat-dialog-actions>
  `
})
export class QuickClientDialogComponent {
  form: FormGroup;
  saving = signal(false);

  constructor(
    private fb: FormBuilder,
    private clientService: ClientService,
    private snackBar: MatSnackBar,
    private dialogRef: MatDialogRef<QuickClientDialogComponent>
  ) {
    this.form = this.fb.group({
      name: ['', Validators.required],
      nuit: [''],
      phone: ['']
    });
  }

  async save() {
    if (this.form.invalid) return;

    this.saving.set(true);

    try {
      const client = await this.clientService.createClient(this.form.value);
      if (client) {
        this.snackBar.open('Cliente criado!', 'Fechar', { duration: 2000 });
        this.dialogRef.close(client);
      }
    } finally {
      this.saving.set(false);
    }
  }
}

@Component({
  selector: 'app-invoice-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatStepperModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatAutocompleteModule
  ],
  templateUrl: './invoice-dialog.component.html',
  styleUrls: ['./invoice-dialog.component.css']
})
export class InvoiceDialogComponent implements OnInit {
  step1Form: FormGroup;
  step2Form: FormGroup;

  selectedClient = signal<Client | null>(null);
  invoiceItems = signal<InvoiceItem[]>([]);
  selectedProduct = signal<Product | null>(null);
  quantity = signal(1);

  saving = signal(false);

  displayedColumns = ['product', 'quantity', 'price', 'ispc', 'total', 'actions'];

  subtotal = computed(() =>
    this.invoiceItems().reduce((sum, item) => sum + item.subtotal, 0)
  );

  totalIspc = computed(() =>
    this.invoiceItems().reduce((sum, item) => sum + item.ispc_amount, 0)
  );

  total = computed(() => this.subtotal() + this.totalIspc());

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<InvoiceDialogComponent>,
    public clientService: ClientService,
    public productService: ProductService,
    private invoiceService: InvoiceService,
    private snackBar: MatSnackBar,
    private dialog: MatDialog
  ) {
    this.step1Form = this.fb.group({
      client_id: ['', Validators.required]
    });

    this.step2Form = this.fb.group({
      product_id: [''],
      quantity: [1, [Validators.required, Validators.min(1)]],
      notes: ['']
    });
  }

  ngOnInit() {
    this.clientService.loadClients();
    this.productService.loadProducts();
  }

  onClientChange(clientId: string) {
    const client = this.clientService.getClientById(clientId);
    this.selectedClient.set(client || null);
  }

  openQuickClientDialog() {
    const dialogRef = this.dialog.open(QuickClientDialogComponent, {
      width: '500px'
    });

    dialogRef.afterClosed().subscribe((client: Client) => {
      if (client) {
        this.step1Form.patchValue({ client_id: client.id });
        this.selectedClient.set(client);
      }
    });
  }

  onProductChange(productId: string) {
    const product = this.productService.getProductById(productId);
    this.selectedProduct.set(product || null);
  }

  addProduct() {
    const product = this.selectedProduct();
    const qty = this.step2Form.get('quantity')?.value;

    if (!product || !qty) return;

    const subtotal = product.price * qty;
    const ispcAmount = subtotal * product.ispc_rate;

    const item: InvoiceItem = {
      product_id: product.id,
      product_name: product.name,
      quantity: qty,
      unit_price: product.price,
      ispc_rate: product.ispc_rate,
      ispc_amount: ispcAmount,
      subtotal: subtotal,
      total: subtotal + ispcAmount
    };

    this.invoiceItems.update(items => [...items, item]);

    this.step2Form.patchValue({
      product_id: '',
      quantity: 1
    });
    this.selectedProduct.set(null);

    this.snackBar.open('Produto adicionado!', '', { duration: 1000 });
  }

  removeItem(index: number) {
    this.invoiceItems.update(items => items.filter((_, i) => i !== index));
  }

  async createInvoice() {
    if (this.step1Form.invalid || this.invoiceItems().length === 0) {
      this.snackBar.open('Selecione cliente e adicione produtos', 'Fechar', { duration: 3000 });
      return;
    }

    this.saving.set(true);

    try {
      const clientId = this.step1Form.get('client_id')?.value;
      const notes = this.step2Form.get('notes')?.value;

      const invoice = await this.invoiceService.createInvoice(
        clientId,
        this.invoiceItems(),
        undefined,
        notes
      );

      if (invoice) {
        this.snackBar.open('Factura criada com sucesso!', 'Fechar', { duration: 3000 });
        this.dialogRef.close(invoice);
      } else {
        this.snackBar.open('Erro ao criar factura', 'Fechar', { duration: 3000 });
      }
    } finally {
      this.saving.set(false);
    }
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('pt-MZ', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value) + ' MZN';
  }

  cancel() {
    this.dialogRef.close();
  }
}
