import { Component, OnInit, signal, computed, Inject } from '@angular/core';
import { friendlyErrorMessage } from '../../core/utils/error-message';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { ProductService, Product } from '../../core/services/product.service';
import { CompanyService } from '../../core/services/company.service';
import { SubscriptionLimitDialogComponent } from '../../shared/components/subscription-limit-dialog.component';
import { ExportService } from '../../core/services/export.service';
import * as XLSX from 'xlsx';
import { t, currentLocale } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

@Component({
  selector: 'app-product-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    TranslatePipe
  ],
  template: `
    <h2 mat-dialog-title>
      {{ 'products.dialog.title' | t }}
    </h2>
    <mat-dialog-content class="!pt-4">
      <form [formGroup]="form" class="space-y-4">
        <!-- Tipo hidden as per requirements -->
        <mat-form-field appearance="outline" class="w-full">
          <mat-label>{{ 'common.fields.type' | t }}</mat-label>
          <mat-select formControlName="type">
            <mat-option value="produto">{{ 'products.types.product' | t }}</mat-option>
            <mat-option value="servico">{{ 'products.types.service' | t }}</mat-option>
          </mat-select>
          @if (form.get('type')?.hasError('required') && form.get('type')?.touched) {
            <mat-error>{{ 'products.dialog.typeRequired' | t }}</mat-error>
          }
        </mat-form-field>

        <mat-form-field appearance="outline" class="w-full">
          <mat-label>{{ 'common.fields.name' | t }}</mat-label>
          <input matInput formControlName="name" [placeholder]="'products.dialog.namePlaceholder' | t">
          @if (form.get('name')?.hasError('required') && form.get('name')?.touched) {
            <mat-error>{{ 'products.dialog.nameRequired' | t }}</mat-error>
          }
        </mat-form-field>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <mat-form-field appearance="outline" class="w-full">
            <mat-label>{{ 'common.fields.code' | t }}</mat-label>
            <input matInput formControlName="code" [placeholder]="'products.dialog.codePlaceholder' | t">
            <mat-hint>{{ 'products.dialog.codeHint' | t }}</mat-hint>
          </mat-form-field>

          <mat-form-field appearance="outline" class="w-full">
            <mat-label>{{ 'products.dialog.barcode' | t }}</mat-label>
            <input matInput formControlName="barcode" [placeholder]="'products.dialog.barcodePlaceholder' | t">
          </mat-form-field>
        </div>

        <mat-form-field appearance="outline" class="w-full">
          <mat-label>{{ 'common.fields.description' | t }}</mat-label>
          <textarea matInput formControlName="description" rows="3" [placeholder]="'common.fields.description' | t"></textarea>
        </mat-form-field>

        <div class="grid grid-cols-2 gap-4">
          <mat-form-field appearance="outline" class="w-full">
            <mat-label>{{ 'products.dialog.price' | t }}</mat-label>
            <input matInput type="number" formControlName="price" placeholder="0.00" step="0.01" min="0">
            @if (form.get('price')?.hasError('required') && form.get('price')?.touched) {
              <mat-error>{{ 'products.dialog.priceRequired' | t }}</mat-error>
            }
          </mat-form-field>

          <mat-form-field appearance="outline" class="w-full">
            <mat-label>{{ 'products.dialog.unit' | t }}</mat-label>
            <input matInput formControlName="unit" [placeholder]="'products.dialog.unitPlaceholder' | t">
          </mat-form-field>
        </div>

        @if (form.get('type')?.value === 'produto') {
          <mat-form-field appearance="outline" class="w-full">
            <mat-label>{{ 'products.dialog.stock' | t }}</mat-label>
            <input matInput type="number" formControlName="stock" [placeholder]="'products.dialog.stockPlaceholder' | t" min="0">
            <mat-hint>{{ 'products.dialog.stockHint' | t }}</mat-hint>
          </mat-form-field>
        }
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
        <span>
          @if (saving()) { {{ 'common.status.saving' | t }} } @else { {{ 'common.actions.save' | t }} }
        </span>
      </button>
    </mat-dialog-actions>
  `
})
export class ProductDialogComponent implements OnInit {
  form: FormGroup;
  saving = signal(false);

  constructor(
    private fb: FormBuilder,
    private productService: ProductService,
    private snackBar: MatSnackBar,
    private dialog: MatDialog,
    private dialogRef: MatDialogRef<ProductDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public product: Product | null
  ) {
    this.form = this.fb.group({
      type: ['servico', Validators.required],
      name: ['', Validators.required],
      code: [''],
      barcode: [''],
      description: [''],
      price: ['', [Validators.required, Validators.min(0)]],
      unit: ['un'],
      stock: [null, Validators.min(0)]
    });
  }

  ngOnInit() {
    if (this.product) {
      this.form.patchValue(this.product);
    }
  }

  async save() {
    if (this.form.invalid) return;

    this.saving.set(true);

    try {
      const formData = {
        ...this.form.value,
        code: this.form.value.code?.trim() || null,
        barcode: this.form.value.barcode?.trim() || null
      };

      if (formData.type === 'servico') {
        formData.stock = null;
      } else if (formData.stock === null || formData.stock === '' || Number(formData.stock) < 0) {
        this.snackBar.open(t('products.messages.stockInvalid'), t('common.actions.close'), { duration: 3000 });
        return;
      }

      const isDuplicate = await this.productService.isProductDuplicate(formData.name, formData.type, this.product?.id);
      if (isDuplicate) {
        this.snackBar.open(t('products.messages.duplicateName'), t('common.actions.close'), { duration: 4000 });
        return;
      }

      if (await this.productService.isProductIdentifierDuplicate('code', formData.code, this.product?.id)) {
        this.snackBar.open(t('products.messages.duplicateCode'), t('common.actions.close'), { duration: 4000 });
        return;
      }

      if (await this.productService.isProductIdentifierDuplicate('barcode', formData.barcode, this.product?.id)) {
        this.snackBar.open(t('products.messages.duplicateBarcode'), t('common.actions.close'), { duration: 4000 });
        return;
      }

      if (this.product) {
        const success = await this.productService.updateProduct(this.product.id, formData);
        if (success) {
          this.snackBar.open(
            t(formData.type === 'produto' ? 'products.messages.productUpdated' : 'products.messages.serviceUpdated'),
            t('common.actions.close'),
            { duration: 3000 }
          );
          this.dialogRef.close();
        } else {
          this.snackBar.open(this.productService.lastError || t('products.messages.updateFailed'), t('common.actions.close'), { duration: 6000 });
        }
      } else {
        const product = await this.productService.createProduct(formData);
        if (product) {
          this.snackBar.open(
            t(formData.type === 'produto' ? 'products.messages.productCreated' : 'products.messages.serviceCreated'),
            t('common.actions.close'),
            { duration: 3000 }
          );
          this.dialogRef.close();
        }
      }
    } catch (error: any) {
      // Handle subscription feature limit errors with a dedicated upgrade dialog
      if (
        error?.code === 'P0001' &&
        error?.details === 'SUBSCRIPTION_FEATURE_DISABLED'
      ) {
        this.dialogRef.close();
        this.dialog.open(SubscriptionLimitDialogComponent, {
          width: '420px',
          panelClass: 'subscription-limit-dialog',
          data: { errorMessage: error?.message }
        });
      } else {
        console.error('Erro ao guardar produto:', error);
        this.snackBar.open(friendlyErrorMessage(error, t('products.messages.saveFailed')), t('common.actions.close'), { duration: 8000 });
      }
    } finally {
      this.saving.set(false);
    }
  }
}


@Component({
  selector: 'app-products',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTooltipModule,
    MatMenuModule,
    TranslatePipe
  ],
  templateUrl: './products.component.html',
  styleUrls: ['./products.component.css']
})
export class ProductsComponent implements OnInit {
  displayedColumns = computed(() => {
    const role = this.companyService.activeRole();
    if (role === 'user') {
      return ['code', 'name', 'price', 'unit', 'stock', 'status'];
    }
    return ['code', 'name', 'price', 'unit', 'stock', 'status', 'actions'];
  });
  searchTerm = signal('');
  sortField = signal<string>('code');
  sortDirection = signal<'asc' | 'desc'>('asc');
  minPriceFilter = signal<number | null>(null);
  maxPriceFilter = signal<number | null>(null);
  typeFilter = signal<'all' | Product['type']>('all');
  statusFilter = signal<'all' | 'active' | 'inactive'>('all');

  filteredProducts = computed(() => {
    const term = this.searchTerm().toLowerCase();
    const products = [...this.productService.products()];
    const field = this.sortField();
    const direction = this.sortDirection();
    const minPrice = this.minPriceFilter();
    const maxPrice = this.maxPriceFilter();
    const type = this.typeFilter();
    const status = this.statusFilter();

    // 1. Filtering
    let filtered = products;
    if (term) {
      filtered = products.filter(product =>
        product.name.toLowerCase().includes(term) ||
        product.description?.toLowerCase().includes(term) ||
        product.code?.toLowerCase().includes(term) ||
        product.barcode?.toLowerCase().includes(term)
      );
    }

    // 2. Price Filtering
    if (minPrice !== null) {
      filtered = filtered.filter(product => product.price >= minPrice);
    }
    if (maxPrice !== null) {
      filtered = filtered.filter(product => product.price <= maxPrice);
    }
    if (type !== 'all') filtered = filtered.filter(product => product.type === type);
    if (status !== 'all') filtered = filtered.filter(product => status === 'active' ? product.is_active : !product.is_active);

    // 2. Sorting
    filtered.sort((a, b) => {
      let valA: any;
      let valB: any;

      switch (field) {
        case 'code':
          valA = a.code || '';
          valB = b.code || '';
          break;
        case 'name':
          valA = a.name.toLowerCase();
          valB = b.name.toLowerCase();
          break;
        case 'price':
          valA = a.price;
          valB = b.price;
          break;
        case 'stock':
          valA = a.stock || 0;
          valB = b.stock || 0;
          break;
        case 'date':
          valA = new Date(a.created_at).getTime();
          valB = new Date(b.created_at).getTime();
          break;
        default:
          valA = a.name.toLowerCase();
          valB = b.name.toLowerCase();
      }

      if (valA < valB) return direction === 'asc' ? -1 : 1;
      if (valA > valB) return direction === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  });

  constructor(
    public productService: ProductService,
    public companyService: CompanyService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar,
    private exportService: ExportService
  ) {}

  ngOnInit() {
    this.productService.loadProducts();
  }

  onSearchChange(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.searchTerm.set(value);
  }

  toggleSortDirection() {
    this.sortDirection.update(d => d === 'asc' ? 'desc' : 'asc');
  }

  onSortFieldChange(field: string) {
    this.sortField.set(field);
  }

  onMinPriceChange(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.minPriceFilter.set(value ? Number(value) : null);
  }

  onMaxPriceChange(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.maxPriceFilter.set(value ? Number(value) : null);
  }

  onTypeChange(value: 'all' | Product['type']) { this.typeFilter.set(value); }

  onStatusChange(value: 'all' | 'active' | 'inactive') { this.statusFilter.set(value); }

  clearFilters() {
    this.searchTerm.set('');
    this.sortField.set('code');
    this.sortDirection.set('asc');
    this.minPriceFilter.set(null);
    this.maxPriceFilter.set(null);
    this.typeFilter.set('all');
    this.statusFilter.set('all');
  }

  openDialog(product?: Product) {
    const dialogRef = this.dialog.open(ProductDialogComponent, {
      width: '600px',
      data: product || null
    });

    dialogRef.afterClosed().subscribe(() => {
      this.productService.loadProducts();
    });
  }

  async toggleStatus(product: Product) {
    const success = await this.productService.toggleProductActiveStatus(product.id, product.is_active);
    if (success) {
      this.snackBar.open(
        t(!product.is_active ? 'products.messages.activated' : 'products.messages.deactivated'),
        t('common.actions.close'),
        { duration: 3000 }
      );
    } else {
      this.snackBar.open(this.productService.lastError || t('products.messages.statusChangeFailed'), t('common.actions.close'), { duration: 6000 });
    }
  }

  async deleteProduct(product: Product) {
    if (!confirm(t('products.messages.confirmDelete', { name: product.name }))) {
      return;
    }

    const result = await this.productService.deleteProduct(product.id);

    if (result.success) {
      this.snackBar.open(t('products.messages.deleted'), t('common.actions.close'), { duration: 3000 });
    } else {
      this.snackBar.open(result.error || t('products.messages.deleteFailed'), t('common.actions.close'), { duration: 5000 });
    }
  }

  /** Etiqueta traduzida do tipo (o valor gravado continua 'produto' / 'servico'). */
  typeLabel(type: Product['type']): string {
    return t(type === 'produto' ? 'products.types.product' : 'products.types.service');
  }

  exportProducts(format: 'csv' | 'xlsx') {
    const active = t('common.status.active');
    const inactive = t('common.status.inactive');
    const data = this.filteredProducts().map(product => ({
      [t('products.columns.code')]: product.code || '',
      [t('products.columns.barcode')]: product.barcode || '',
      [t('products.columns.name')]: product.name,
      [t('products.columns.type')]: this.typeLabel(product.type),
      [t('products.columns.description')]: product.description || '',
      [t('products.columns.price')]: product.price,
      [t('products.columns.unit')]: product.unit || '',
      [t('products.columns.stock')]: product.stock ?? '',
      [t('products.columns.status')]: product.is_active ? active : inactive
    }));
    const fileName = t('products.export.fileName', { date: new Date().toISOString().split('T')[0] });
    if (format === 'csv') this.exportService.exportToCsv(data, fileName);
    else this.exportService.exportToExcel(data, fileName, t('products.export.sheetName'));
  }

  downloadImportTemplate(format: 'xlsx' | 'xls' | 'csv') {
    const example = [{
      [t('products.columns.code')]: 'CAN-AZ-001',
      [t('products.columns.barcode')]: '7891234567890',
      [t('products.columns.name')]: t('products.template.exampleName'),
      [t('products.columns.type')]: t('products.types.product'),
      [t('products.columns.description')]: t('products.template.exampleDescription'),
      [t('products.columns.price')]: 25,
      [t('products.columns.unit')]: 'un',
      [t('products.columns.stock')]: 100,
      [t('products.columns.status')]: t('common.status.active')
    }];
    const fileName = t('products.template.fileName');

    if (format === 'csv') {
      this.exportService.exportToCsv(example, fileName);
      return;
    }

    const worksheet = XLSX.utils.json_to_sheet(example);
    worksheet['!cols'] = [
      { wch: 18 }, { wch: 20 }, { wch: 28 }, { wch: 14 }, { wch: 34 },
      { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, t('products.export.sheetName'));
    XLSX.writeFile(workbook, `${fileName}.${format}`, format === 'xls' ? { bookType: 'biff8' } : undefined);
  }

  async onImportFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    try {
      const workbook = await this.readImportWorkbook(file);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
      const existingProducts = this.productService.products();
      const existing = new Set(existingProducts.map(p => `${p.type}:${p.name.trim().toLowerCase()}`));
      const existingCodes = new Set(existingProducts.map(p => p.code?.trim()).filter((c): c is string => !!c));
      const existingBarcodes = new Set(existingProducts.map(p => p.barcode?.trim()).filter((c): c is string => !!c));
      const seen = new Map<string, number>();
      const seenCodes = new Map<string, number>();
      const seenBarcodes = new Map<string, number>();
      const products: Array<{ name: string; type: 'produto' | 'servico'; code?: string; barcode?: string; description?: string; price: number; unit?: string; stock?: number; is_active: boolean }> = [];
      const invalidRows: string[] = [];

      rows.forEach((row, index) => {
        // Ignore completely empty rows (e.g. trailing lines in a CSV)
        if (Object.values(row).every(v => String(v ?? '').trim() === '')) return;

        const get = (...names: string[]) => {
          const found = Object.entries(row).find(([key]) => names.includes(this.normalizeImportText(key)));
          return this.repairMojibake(String(found?.[1] ?? '')).trim();
        };
        const rowNumber = index + 2;
        // Aceita cabeçalhos em português, inglês e francês (os modelos são gerados na língua da interface).
        const name = get('nome', 'name', 'nom');
        const code = get('codigo', 'code');
        const barcode = get('codigo de barras', 'codigodebarras', 'codigo barras', 'barcode', 'bar_code', 'code-barres', 'code barres', 'code-barre');
        const typeRaw = get('tipo', 'type');
        const type = this.parseImportType(typeRaw);
        const priceText = get('preco', 'price', 'preco unitario', 'prix', 'unit price', 'prix unitaire');
        const price = this.parseImportNumber(priceText);
        const stockText = get('stock', 'quantidade', 'quantity', 'quantite');
        const stock = stockText === '' ? 0 : this.parseImportNumber(stockText);

        const errors: string[] = [];
        if (!name) errors.push(t('products.import.nameMissing'));
        if (!typeRaw) errors.push(t('products.import.typeMissing'));
        else if (!type) errors.push(t('products.import.typeInvalid', { value: typeRaw }));
        if (!priceText) errors.push(t('products.import.priceMissing'));
        else if (price === null || price < 0) errors.push(t('products.import.priceInvalid', { value: priceText }));
        if (type === 'produto' && (stock === null || stock < 0)) errors.push(t('products.import.stockInvalid', { value: stockText }));

        const key = type ? `${type}:${name.toLowerCase()}` : '';
        if (name && type) {
          if (existing.has(key)) errors.push(t(type === 'produto' ? 'products.import.productNameExists' : 'products.import.serviceNameExists', { name }));
          else if (seen.has(key)) errors.push(t('products.import.nameRepeated', { name, row: seen.get(key) }));
        }
        if (code) {
          if (existingCodes.has(code)) errors.push(t('products.import.codeExists', { code }));
          else if (seenCodes.has(code)) errors.push(t('products.import.codeRepeated', { code, row: seenCodes.get(code) }));
        }
        if (barcode) {
          if (existingBarcodes.has(barcode)) errors.push(t('products.import.barcodeExists', { barcode }));
          else if (seenBarcodes.has(barcode)) errors.push(t('products.import.barcodeRepeated', { barcode, row: seenBarcodes.get(barcode) }));
        }

        if (errors.length || !type || price === null) {
          invalidRows.push(t('products.import.rowErrors', { row: rowNumber, errors: errors.join('; ') }));
          return;
        }

        seen.set(key, rowNumber);
        if (code) seenCodes.set(code, rowNumber);
        if (barcode) seenBarcodes.set(barcode, rowNumber);
        const status = this.normalizeImportText(get('estado', 'status', 'statut'));
        const inactiveLabel = this.normalizeImportText(t('common.status.inactive'));
        products.push({
          name, type, code: code || undefined, barcode: barcode || undefined, price,
          stock: type === 'produto' ? (stock ?? 0) : undefined,
          description: get('descricao', 'description') || undefined,
          unit: get('unidade', 'unit', 'unite') || undefined,
          is_active: !['inactivo', 'inativo', 'inactive', 'inactif', 'false', '0', 'nao', 'no', 'non', inactiveLabel].includes(status)
        });
      });

      if (invalidRows.length) console.warn('Linhas inválidas na importação de produtos:', invalidRows);

      if (!products.length) {
        const message = invalidRows.length
          ? t('products.import.noneValidWithDetails', { details: this.summarizeInvalidRows(invalidRows) })
          : t('products.import.noneValid');
        this.snackBar.open(message, t('common.actions.close'), { duration: 10000 });
        return;
      }
      const result = await this.productService.importProducts(products);
      if (result.error) {
        this.snackBar.open(t('products.import.failed', { error: result.error }), t('common.actions.close'), { duration: 8000 });
        return;
      }
      const message = invalidRows.length
        ? t('products.import.successWithSkipped', { imported: result.imported, skipped: invalidRows.length, details: this.summarizeInvalidRows(invalidRows) })
        : t('products.import.success', { count: result.imported });
      this.snackBar.open(message, t('common.actions.close'), { duration: invalidRows.length ? 12000 : 6000 });
    } catch (error) {
      console.error('Erro ao ler ficheiro de produtos:', error);
      this.snackBar.open(t('products.messages.importReadFailed'), t('common.actions.close'), { duration: 5000 });
    }
  }

  /** CSV files are decoded explicitly (UTF-8, falling back to Windows-1252) so accents survive. */
  private async readImportWorkbook(file: File): Promise<XLSX.WorkBook> {
    const buffer = await file.arrayBuffer();
    if (!/\.(csv|txt)$/i.test(file.name)) {
      return XLSX.read(buffer, { type: 'array' });
    }
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      text = new TextDecoder('windows-1252').decode(buffer);
    }
    return XLSX.read(text.replace(/^﻿/, ''), { type: 'string' });
  }

  /** Fixes UTF-8 text that was decoded as Latin-1 (e.g. "ServiÃ§o" -> "Serviço"). */
  private repairMojibake(value: string): string {
    if (!/[ÃÂ]/.test(value)) return value;
    try {
      const bytes = Uint8Array.from(value, ch => {
        const code = ch.charCodeAt(0);
        if (code > 255) throw new Error('not latin1');
        return code;
      });
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return value;
    }
  }

  private normalizeImportText(value: string): string {
    return this.repairMojibake(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  private parseImportType(value: string): 'produto' | 'servico' | null {
    const normalized = this.normalizeImportText(value);
    if (!normalized) return null;
    if (normalized === this.normalizeImportText(t('products.types.product'))) return 'produto';
    if (normalized === this.normalizeImportText(t('products.types.service'))) return 'servico';
    if (['produto', 'produtos', 'product', 'products'].includes(normalized) || normalized.startsWith('prod')) return 'produto';
    if (['servico', 'servicos', 'service', 'services'].includes(normalized) || normalized.startsWith('serv')) return 'servico';
    return null;
  }

  /**
   * Parses numbers written in Portuguese or English notation:
   * "1500", "1500.50", "1500,50", "1.500,50", "1,500.50", "1 500,50", "1500 MZN".
   * Returns null for empty or invalid values.
   */
  private parseImportNumber(value: string): number | null {
    let text = value.replace(/[\s  ]/g, '').replace(/(mzn|mt|meticais)$/i, '');
    if (!text || !/^-?[\d.,]+$/.test(text)) return null;

    const lastComma = text.lastIndexOf(',');
    const lastDot = text.lastIndexOf('.');
    if (lastComma > -1 && lastDot > -1) {
      // Both separators present: the last one is the decimal separator
      const decimal = lastComma > lastDot ? ',' : '.';
      const thousands = decimal === ',' ? '.' : ',';
      text = text.split(thousands).join('').replace(decimal, '.');
    } else if (lastComma > -1 || lastDot > -1) {
      const separator = lastComma > -1 ? ',' : '.';
      const parts = text.split(separator);
      // A repeated separator ("1.500.000") is a thousands separator; a single one is decimal
      text = parts.length > 2 ? parts.join('') : parts.join('.');
    }

    if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
    const result = Number(text);
    return Number.isFinite(result) ? result : null;
  }

  private summarizeInvalidRows(invalidRows: string[]): string {
    const shown = invalidRows.slice(0, 3).join(' | ');
    return invalidRows.length > 3 ? t('products.import.andMore', { shown, count: invalidRows.length - 3 }) : shown;
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat(currentLocale(), {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value) + ' MZN';
  }
}
