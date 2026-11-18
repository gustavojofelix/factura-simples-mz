import { Component, OnInit, signal, computed, Inject, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ClientService, Client } from '../../core/services/client.service';
import { ProductService, Product } from '../../core/services/product.service';
import { InvoiceService, InvoiceItem, Invoice } from '../../core/services/invoice.service';
import { CompanyService } from '../../core/services/company.service';
import { DocumentSettingsService } from '../../core/services/document-settings.service';
import { ResponsiveDialogService } from '../../core/services/responsive-dialog.service';
import { nuitValidator } from '../../core/validators/nuit.validator';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { currentLocale, t } from '../../core/i18n/i18n';
import { DialogShellComponent } from '../ui/dialog-shell.component';
import { StepIndicatorComponent } from '../ui/step-indicator.component';
import { SearchPickerFieldComponent } from '../ui/search-picker-field.component';
import { PickerOption, SearchPickerService } from '../ui/search-picker';

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
    DialogShellComponent,
    TranslatePipe
  ],
  template: `
    <app-dialog-shell [title]="'invoices.quickClient.title' | t" icon="person_add" (closed)="dialogRef.close()">
      <form [formGroup]="form" (ngSubmit)="save()">
        <mat-form-field appearance="outline" class="w-full">
          <mat-label>{{ 'common.fields.name' | t }}</mat-label>
          <input matInput formControlName="name" autocomplete="off" [placeholder]="'invoices.quickClient.namePlaceholder' | t">
        </mat-form-field>

        <mat-form-field appearance="outline" class="w-full">
          <mat-label>{{ 'invoices.quickClient.nuitOptional' | t }}</mat-label>
          <input matInput formControlName="nuit" inputmode="numeric" autocomplete="off">
        </mat-form-field>

        <mat-form-field appearance="outline" class="w-full">
          <mat-label>{{ 'invoices.quickClient.phoneOptional' | t }}</mat-label>
          <input matInput formControlName="phone" type="tel" inputmode="tel" autocomplete="off">
        </mat-form-field>
      </form>

      <div shellFooter class="flex gap-2 sm:justify-end">
        <button mat-stroked-button type="button" class="flex-1 sm:flex-none !h-12 !rounded-xl" (click)="dialogRef.close()">
          {{ 'common.actions.cancel' | t }}
        </button>
        <button
          mat-flat-button
          type="button"
          class="flex-1 sm:flex-none !h-12 !rounded-xl !bg-ispc-orange !text-white"
          [disabled]="form.invalid || saving()"
          (click)="save()"
        >
          {{ (saving() ? 'common.status.saving' : 'common.actions.create') | t }}
        </button>
      </div>
    </app-dialog-shell>
  `
})
export class QuickClientDialogComponent {
  form: FormGroup;
  saving = signal(false);

  constructor(
    private fb: FormBuilder,
    private clientService: ClientService,
    private snackBar: MatSnackBar,
    public dialogRef: MatDialogRef<QuickClientDialogComponent>
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
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    DialogShellComponent,
    StepIndicatorComponent,
    SearchPickerFieldComponent,
    TranslatePipe
  ],
  templateUrl: './invoice-dialog.component.html',
  styleUrls: ['./invoice-dialog.component.css']
})
export class InvoiceDialogComponent implements OnInit {
  private readonly pickerService = inject(SearchPickerService);
  private readonly responsiveDialog = inject(ResponsiveDialogService);

  step1Form: FormGroup;
  step2Form: FormGroup;

  /** Passo actual: 1 = cliente, 2 = itens e detalhes. */
  step = signal<1 | 2>(1);

  selectedClient = signal<Client | null>(null);
  activeClients = computed(() => this.clientService.clients().filter(c => c.is_active || c.id === this.selectedClient()?.id));
  invoiceItems = signal<InvoiceItem[]>([]);

  clientOptions = computed<PickerOption[]>(() =>
    this.activeClients().map(client => ({
      value: client.id,
      label: client.name,
      sublabel: [client.nuit ? `NUIT ${client.nuit}` : '', client.phone || ''].filter(Boolean).join(' · ') || undefined,
      keywords: client.email || ''
    }))
  );

  /** Produtos activos, ordenados por código (como na lista de produtos). */
  activeProducts = computed(() =>
    this.productService.products()
      .filter(p => p.is_active)
      .sort((a, b) => (a.code || '').localeCompare(b.code || ''))
  );

  paymentTerms = [0, 5, 10, 15, 30, 45, 60, 90].map(days => ({
    label: days === 0 ? t('invoices.list.immediate') : t('invoices.dialog.termDays', { days }),
    days
  }));

  saving = signal(false);
  isEditing = signal(false);

  private roundMoney(value: number): number {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  subtotal = computed(() =>
    this.roundMoney(this.invoiceItems().reduce((sum, item) => sum + this.roundMoney(item.subtotal), 0))
  );

  total = computed(() => this.subtotal());

  constructor(
    private fb: FormBuilder,
    public dialogRef: MatDialogRef<InvoiceDialogComponent>,
    public clientService: ClientService,
    public productService: ProductService,
    private invoiceService: InvoiceService,
    private snackBar: MatSnackBar,
    private companyService: CompanyService,
    private documentSettings: DocumentSettingsService,
    @Inject(MAT_DIALOG_DATA) public data: { invoice?: Invoice }
  ) {
    this.step1Form = this.fb.group({
      client_id: ['', Validators.required]
    });

    this.step2Form = this.fb.group({
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
    const dialogRef = this.responsiveDialog.open(QuickClientDialogComponent, { size: 'sm' });

    dialogRef.afterClosed().subscribe((client: Client) => {
      if (client) {
        this.step1Form.patchValue({ client_id: client.id });
        this.selectedClient.set(client);
      }
    });
  }

  goToItems() {
    if (this.step1Form.invalid) return;
    this.step.set(2);
  }

  goToClient() {
    this.step.set(1);
  }

  /** Botão "voltar" do Android: no passo 2 volta ao passo 1 em vez de fechar. */
  handleBack(): boolean {
    if (this.step() === 2) {
      this.goToClient();
      return true;
    }
    return false;
  }

  async openProductPicker() {
    const result = await this.pickerService.pick<string>({
      title: t('invoices.dialog.chooseProduct'),
      searchPlaceholder: t('invoices.dialog.searchProductPlaceholder'),
      options: this.activeProducts().map(product => ({
        value: product.id,
        label: product.name,
        sublabel: [
          product.code || '',
          product.stock != null ? t('invoices.dialog.stock', { stock: product.stock }) : ''
        ].filter(Boolean).join(' · ') || undefined,
        trailing: this.formatCurrency(product.price),
        keywords: [product.description, product.barcode].filter(Boolean).join(' ')
      }))
    });
    if (result?.type !== 'select') return;
    const product = this.productService.getProductById(result.option.value);
    if (product) this.addProduct(product);
  }

  addProduct(product: Product) {
    // Já está na factura: soma uma unidade em vez de bloquear.
    const existingIndex = this.invoiceItems().findIndex(item => item.product_id === product.id);
    if (existingIndex !== -1) {
      const next = this.invoiceItems()[existingIndex].quantity + 1;
      if (this.setItemQuantity(existingIndex, next)) {
        this.snackBar.open(
          t('invoices.dialog.messages.qtyIncreased', { name: product.name, qty: next }),
          '',
          { duration: 1500 }
        );
      }
      return;
    }

    // Req #5 & #6: Stock validation for products
    // Produtos sem controlo de stock (stock null) não são validados.
    if (product.type === 'produto' && product.stock != null && product.stock <= 0) {
      this.snackBar.open(
        t('invoices.dialog.messages.noStock', { name: product.name }),
        t('common.actions.close'),
        { duration: 4000 }
      );
      return;
    }

    const subtotal = this.roundMoney(product.price);

    const item: InvoiceItem = {
      product_id: product.id,
      product_name: product.name,
      quantity: 1,
      unit_price: product.price,
      subtotal: subtotal,
      total: subtotal
    };

    this.invoiceItems.update(items => [...items, item]);
    this.snackBar.open(t('invoices.dialog.messages.productAdded'), '', { duration: 1000 });
  }

  removeItem(index: number) {
    this.invoiceItems.update(items => items.filter((_, i) => i !== index));
  }

  updateItemQuantity(index: number, change: number) {
    const item = this.invoiceItems()[index];
    if (!item) return;
    const next = this.roundMoney(item.quantity + change);
    if (next <= 0) {
      this.removeItem(index);
      return;
    }
    this.setItemQuantity(index, next);
  }

  /** Quantidade escrita à mão no campo do item (aceita vírgula decimal). */
  onQuantityInput(index: number, input: HTMLInputElement) {
    const item = this.invoiceItems()[index];
    if (!item) return;
    const qty = Number(String(input.value).replace(',', '.'));
    if (!Number.isFinite(qty) || qty <= 0) {
      this.snackBar.open(t('invoices.dialog.messages.invalidQuantity'), t('common.actions.close'), { duration: 3000 });
      input.value = String(item.quantity);
      return;
    }
    if (!this.setItemQuantity(index, qty)) {
      input.value = String(this.invoiceItems()[index].quantity);
    }
  }

  /** Muda a quantidade de um item, validando o stock. Devolve false se recusou. */
  setItemQuantity(index: number, qty: number): boolean {
    const currentItem = this.invoiceItems()[index];
    if (!currentItem) return false;

    if (qty > currentItem.quantity) {
      const product = this.productService.getProductById(currentItem.product_id);
      if (product && product.type === 'produto' && product.stock != null && qty > product.stock) {
        this.snackBar.open(
          t('invoices.dialog.messages.qtyIncreaseExceedsStock', { qty, stock: product.stock, name: currentItem.product_name }),
          t('common.actions.close'),
          { duration: 4000 }
        );
        return false;
      }
    }

    this.invoiceItems.update(prev => {
      const updated = [...prev];
      const item = { ...updated[index] };
      item.quantity = qty;
      item.subtotal = this.roundMoney(item.unit_price * item.quantity);
      item.total = item.subtotal;
      updated[index] = item;
      return updated;
    });
    return true;
  }

  async save(status: string = 'pendente') {
    // Req #5 & #6: Stock validation for all items
    if (status !== 'rascunho') {
      for (const item of this.invoiceItems()) {
        const prod = this.productService.getProductById(item.product_id);
        if (prod && prod.type === 'produto' && prod.stock != null) {
          const availableStock = prod.stock;
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
