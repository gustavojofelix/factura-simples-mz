import { Component, OnInit, signal, computed, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MatDialog, MAT_DIALOG_DATA } from '@angular/material/dialog';
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
import { InvoiceService, InvoiceItem, Invoice } from '../../core/services/invoice.service';
import { CompanyService } from '../../core/services/company.service';
import { DocumentSettingsService } from '../../core/services/document-settings.service';
import { nuitValidator } from '../../core/validators/nuit.validator';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { currentLocale, t } from '../../core/i18n/i18n';

@Component({
  selector: 'app-quick-client-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    TranslatePipe
  ],
  template: `
    <h2 mat-dialog-title>{{ 'invoices.quickClient.title' | t }}</h2>
    <mat-dialog-content class="!pt-4">
      <form [formGroup]="form" class="space-y-4">
        <mat-form-field appearance="outline" class="w-full">
          <mat-label>{{ 'common.fields.name' | t }}</mat-label>
          <input matInput formControlName="name" [placeholder]="'invoices.quickClient.namePlaceholder' | t">
        </mat-form-field>

        <mat-form-field appearance="outline" class="w-full">
          <mat-label>{{ 'invoices.quickClient.nuitOptional' | t }}</mat-label>
          <input matInput formControlName="nuit">
        </mat-form-field>

        <mat-form-field appearance="outline" class="w-full">
          <mat-label>{{ 'invoices.quickClient.phoneOptional' | t }}</mat-label>
          <input matInput formControlName="phone">
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end" class="!px-6 !pb-4">
      <button mat-button mat-dialog-close>{{ 'common.actions.cancel' | t }}</button>
      <button
        mat-raised-button
        class="!bg-ispc-orange !text-white"
        [disabled]="form.invalid || saving()"
        (click)="save()"
      >
        {{ (saving() ? 'common.status.saving' : 'common.actions.create') | t }}
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
      nuit: ['', nuitValidator()],
      phone: ['']
    });
  }

  async save() {
    if (this.form.invalid) return;

    this.saving.set(true);

    try {
      const client = await this.clientService.createClient(this.form.value);
      if (client) {
        this.snackBar.open(t('invoices.quickClient.created'), t('common.actions.close'), { duration: 2000 });
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
    MatAutocompleteModule,
    TranslatePipe
  ],
  templateUrl: './invoice-dialog.component.html',
  styleUrls: ['./invoice-dialog.component.css']
})
export class InvoiceDialogComponent implements OnInit {
  step1Form: FormGroup;
  step2Form: FormGroup;

  selectedClient = signal<Client | null>(null);
  activeClients = computed(() => this.clientService.clients().filter(c => c.is_active || c.id === this.selectedClient()?.id));
  invoiceItems = signal<InvoiceItem[]>([]);
  selectedProduct = signal<Product | null>(null);
  quantity = signal(1);

  // Product filtering
  productSearchTerm = signal('');

  filteredProducts = computed(() => {
    const term = this.productSearchTerm().toLowerCase();
    const products = [...this.productService.products()];

    // 1. Filtering - always start with active products
    let filtered = products.filter(p => p.is_active);

    // 2. Search filtering
    if (term) {
      filtered = filtered.filter(product =>
        product.name.toLowerCase().includes(term) ||
        product.description?.toLowerCase().includes(term) ||
        product.code?.toLowerCase().includes(term) ||
        product.barcode?.toLowerCase().includes(term)
      );
    }

    // 3. Sorting by code (ascending) for consistency with product list
    filtered.sort((a, b) => (a.code || '').localeCompare(b.code || ''));

    return filtered;
  });

  paymentTerms = [0, 5, 10, 15, 30, 45, 60, 90].map(days => ({
    label: days === 0 ? t('invoices.list.immediate') : t('invoices.dialog.termDays', { days }),
    days
  }));

  saving = signal(false);
  isEditing = signal(false);

  displayedColumns = ['product', 'quantity', 'price', 'total', 'actions'];

  private roundMoney(value: number): number {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  subtotal = computed(() =>
    this.roundMoney(this.invoiceItems().reduce((sum, item) => sum + this.roundMoney(item.subtotal), 0))
  );

  total = computed(() => this.subtotal());

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<InvoiceDialogComponent>,
    public clientService: ClientService,
    public productService: ProductService,
    private invoiceService: InvoiceService,
    private snackBar: MatSnackBar,
    private dialog: MatDialog,
    private companyService: CompanyService,
    private documentSettings: DocumentSettingsService,
    @Inject(MAT_DIALOG_DATA) public data: { invoice?: Invoice }
  ) {
    this.step1Form = this.fb.group({
      client_id: ['', Validators.required]
    });

    this.step2Form = this.fb.group({
      product_id: [''],
      quantity: [1, [Validators.required, Validators.min(1)]],
      due_date_term: [0, Validators.required],
      notes: ['']
    });

    if (data?.invoice) {
      this.isEditing.set(true);
    }
  }

  private async aplicarObservacoesPorOmissao() {
    const companyId = this.companyService.activeCompany()?.id;
    if (!companyId) return;

    const branding = await this.documentSettings.resolve(companyId);
    const texto = branding.default_observations?.trim();

    if (texto && !this.step2Form.value.notes) {
      this.step2Form.patchValue({ notes: texto });
    }
  }

  ngOnInit() {
    this.clientService.loadClients().then(() => {
      // Patch client if editing
      if (this.data?.invoice) {
        this.step1Form.patchValue({ client_id: this.data.invoice.client_id });
        const client = this.clientService.getClientById(this.data.invoice.client_id);
        this.selectedClient.set(client || null);
      }
    });

    this.productService.loadProducts();

    // Numa factura nova, as observações por omissão da empresa pré-preenchem o
    // campo. Ficam gravadas no documento e continuam editáveis, por isso mudar
    // a definição mais tarde não altera facturas já emitidas.
    if (!this.data?.invoice) {
      void this.aplicarObservacoesPorOmissao();
    }

    if (this.data?.invoice) {
      // Load items
      const items = this.data.invoice.items || [];
      // Map invoice items to match our type if needed, but they should be compatible
      this.invoiceItems.set(items);

      // Patch notes
      this.step2Form.patchValue({ notes: this.data.invoice.notes || '' });

      // Patch due date term if possible
      if (this.data.invoice.date && this.data.invoice.due_date) {
        const date = new Date(this.data.invoice.date);
        const dueDate = new Date(this.data.invoice.due_date);
        const diffTime = Math.abs(dueDate.getTime() - date.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        // Find closest term
        const closestTerm = this.paymentTerms.reduce((prev, curr) =>
          Math.abs(curr.days - diffDays) < Math.abs(prev.days - diffDays) ? curr : prev
        );
        this.step2Form.patchValue({ due_date_term: closestTerm.days });
      }
    }
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

  onProductSearchChange(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.productSearchTerm.set(value);
  }

  onProductSelected(product: Product) {
    this.selectedProduct.set(product);
    this.productSearchTerm.set(product.name);
    this.step2Form.patchValue({ product_id: product.id });
  }

  addProduct() {
    const product = this.selectedProduct();
    const qty = Number(this.step2Form.get('quantity')?.value);

    if (!product) return;
    if (!Number.isFinite(qty) || qty <= 0) {
      this.snackBar.open(
        qty === 0
          ? t('invoices.dialog.messages.noQuantity', { name: product.name })
          : t('invoices.dialog.messages.invalidQuantity'),
        t('common.actions.close'),
        { duration: 4000 }
      );
      return;
    }

    // Req #4: Prevent duplicate product addition
    const existingIndex = this.invoiceItems().findIndex(item => item.product_id === product.id);
    if (existingIndex !== -1) {
      this.snackBar.open(
        t('invoices.dialog.messages.alreadyAdded', { name: product.name }),
        t('common.actions.close'),
        { duration: 4000 }
      );
      return;
    }

    // Req #5 & #6: Stock validation for products
    if (product.type === 'produto') {
      const availableStock = product.stock ?? 0;
      if (availableStock <= 0) {
        this.snackBar.open(
          t('invoices.dialog.messages.noStock', { name: product.name }),
          t('common.actions.close'),
          { duration: 4000 }
        );
        return;
      }

      if (qty > availableStock) {
        this.snackBar.open(
          t('invoices.dialog.messages.qtyExceedsStock', { qty, stock: availableStock, name: product.name }),
          t('common.actions.close'),
          { duration: 4000 }
        );
        return;
      }
    }

    const subtotal = this.roundMoney(product.price * qty);

    const item: InvoiceItem = {
      product_id: product.id,
      product_name: product.name,
      quantity: qty,
      unit_price: product.price,
      subtotal: subtotal,
      total: subtotal
    };

    this.invoiceItems.update(items => [...items, item]);

    this.step2Form.patchValue({
      product_id: '',
      quantity: 1
    });
    this.selectedProduct.set(null);
    this.productSearchTerm.set('');

    this.snackBar.open(t('invoices.dialog.messages.productAdded'), '', { duration: 1000 });
  }
  removeItem(index: number) {
    this.invoiceItems.update(items => items.filter((_, i) => i !== index));
  }

  updateItemQuantity(index: number, change: number) {
    const items = this.invoiceItems();
    if (index < 0 || index >= items.length) return;
    const currentItem = items[index];
    const newQty = currentItem.quantity + change;

    if (newQty <= 0) {
      this.invoiceItems.update(prev => prev.filter((_, i) => i !== index));
      return;
    }

    if (change > 0) {
      const product = this.productService.getProductById(currentItem.product_id);
      if (product && product.type === 'produto') {
        const availableStock = product.stock ?? 0;
        if (newQty > availableStock) {
          this.snackBar.open(
            t('invoices.dialog.messages.qtyIncreaseExceedsStock', { qty: newQty, stock: availableStock, name: currentItem.product_name }),
            t('common.actions.close'),
            { duration: 4000 }
          );
          return;
        }
      }
    }

    this.invoiceItems.update(prev => {
      const updated = [...prev];
      const item = { ...updated[index] };
      item.quantity = newQty;
      item.subtotal = this.roundMoney(item.unit_price * item.quantity);
      item.total = item.subtotal;
      updated[index] = item;
      return updated;
    });
  }
















  async save(status: string = 'pendente') {


    // Req #5 & #6: Stock validation for all items
    if (status !== 'rascunho') {
      for (const item of this.invoiceItems()) {
        const prod = this.productService.getProductById(item.product_id);
        if (prod && prod.type === 'produto') {
          const availableStock = prod.stock ?? 0;
          if (availableStock <= 0) {
            this.snackBar.open(
              t('invoices.dialog.messages.issueNoStock', { name: item.product_name }),
              t('common.actions.close'),
              { duration: 4000 }
            );
            return;
          }
          if (item.quantity > availableStock) {
            this.snackBar.open(
              t('invoices.dialog.messages.issueQtyExceedsStock', { name: item.product_name, qty: item.quantity, stock: availableStock }),
              t('common.actions.close'),
              { duration: 4000 }
            );
            return;
          }
        }
      }
    }
    if (this.step1Form.invalid || this.invoiceItems().length === 0) {
      this.snackBar.open(t('invoices.dialog.messages.selectClientAndProducts'), t('common.actions.close'), { duration: 3000 });
      return;
    }

    this.saving.set(true);

    try {
      const clientId = this.step1Form.get('client_id')?.value;
      const notes = this.step2Form.get('notes')?.value;
      const days = this.step2Form.get('due_date_term')?.value || 0;

      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + days);
      const dueDateString = dueDate.toISOString().split('T')[0];

      let result: Invoice | null = null;
      let message = '';

      if (this.isEditing() && this.data.invoice) {
        result = await this.invoiceService.updateInvoice(
          this.data.invoice.id,
          clientId,
          this.invoiceItems(),
          dueDateString,
          notes
        );
        message = t('invoices.messages.updated');
      } else {
        result = await this.invoiceService.createInvoice(
          clientId,
          this.invoiceItems(),
          dueDateString,
          notes,
          status
        );
        message = status === 'rascunho' ? t('invoices.messages.draftSaved') : t('invoices.messages.issued');
      }

      if (result) {
        this.snackBar.open(message, t('common.actions.close'), { duration: 3000 });
        this.dialogRef.close(result);
      } else {
        this.snackBar.open(this.invoiceService.lastError || t('invoices.messages.saveFailed'), t('common.actions.close'), { duration: 8000 });
      }
    } finally {
      this.saving.set(false);
    }
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat(currentLocale(), {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value) + ' MZN';
  }

  cancel() {
    this.dialogRef.close();
  }
}
