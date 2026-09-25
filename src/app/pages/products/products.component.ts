import { Component, OnInit, signal, computed, Inject } from '@angular/core';
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
    MatButtonModule
  ],
  template: `
    <h2 mat-dialog-title>
      Produto / Serviço
    </h2>
    <mat-dialog-content class="!pt-4">
      <form [formGroup]="form" class="space-y-4">
        <!-- Tipo hidden as per requirements -->
        <mat-form-field appearance="outline" class="w-full">
          <mat-label>Tipo</mat-label>
          <mat-select formControlName="type">
            <mat-option value="produto">Produto</mat-option>
            <mat-option value="servico">Serviço</mat-option>
          </mat-select>
          @if (form.get('type')?.hasError('required') && form.get('type')?.touched) {
            <mat-error>Tipo é obrigatório</mat-error>
          }
        </mat-form-field> 

        <mat-form-field appearance="outline" class="w-full">
          <mat-label>Nome</mat-label>
          <input matInput formControlName="name" placeholder="Nome do produto ou serviço">
          @if (form.get('name')?.hasError('required') && form.get('name')?.touched) {
            <mat-error>Nome é obrigatório</mat-error>
          }
        </mat-form-field>

        <mat-form-field appearance="outline" class="w-full">
          <mat-label>Descrição</mat-label>
          <textarea matInput formControlName="description" rows="3" placeholder="Descrição"></textarea>
        </mat-form-field>

        <div class="grid grid-cols-2 gap-4">
          <mat-form-field appearance="outline" class="w-full">
            <mat-label>Preço (MZN)</mat-label>
            <input matInput type="number" formControlName="price" placeholder="0.00" step="0.01" min="0">
            @if (form.get('price')?.hasError('required') && form.get('price')?.touched) {
              <mat-error>Preço é obrigatório</mat-error>
            }
          </mat-form-field>

          <mat-form-field appearance="outline" class="w-full">
            <mat-label>Unidade</mat-label>
            <input matInput formControlName="unit" placeholder="un, kg, m, h, etc">
          </mat-form-field>
        </div>

        @if (form.get('type')?.value === 'produto') {
          <mat-form-field appearance="outline" class="w-full">
            <mat-label>Stock</mat-label>
            <input matInput type="number" formControlName="stock" placeholder="Quantidade em stock" min="0">
            <mat-hint>Apenas para produtos físicos</mat-hint>
          </mat-form-field>
        }
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end" class="!px-6 !pb-4">
      <button mat-button mat-dialog-close>Cancelar</button>
      <button
        mat-raised-button
        class="!bg-ispc-orange !text-white"
        [disabled]="form.invalid || saving()"
        (click)="save()"
      >
        <span>
          @if (saving()) { A guardar... } @else { Guardar }
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
        ...this.form.value
      };

      if (formData.type === 'servico') {
        formData.stock = null;
      } else if (formData.stock === null || formData.stock === '' || Number(formData.stock) < 0) {
        this.snackBar.open('O stock deve ser zero ou um número positivo.', 'Fechar', { duration: 3000 });
        return;
      }

      const isDuplicate = await this.productService.isProductDuplicate(formData.name, formData.type, this.product?.id);
      if (isDuplicate) {
        this.snackBar.open('Já existe um produto ou serviço com este nome.', 'Fechar', { duration: 4000 });
        return;
      }

      if (this.product) {
        const success = await this.productService.updateProduct(this.product.id, formData);
        if (success) {
          this.snackBar.open(
            `${formData.type === 'produto' ? 'Produto' : 'Serviço'} actualizado com sucesso!`,
            'Fechar',
            { duration: 3000 }
          );
          this.dialogRef.close();
        } else {
          this.snackBar.open('Erro ao actualizar', 'Fechar', { duration: 3000 });
        }
      } else {
        const product = await this.productService.createProduct(formData);
        if (product) {
          this.snackBar.open(
            `${formData.type === 'produto' ? 'Produto' : 'Serviço'} criado com sucesso!`,
            'Fechar',
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
        this.snackBar.open('Erro ao guardar. Verifique os dados.', 'Fechar', { duration: 4000 });
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
    MatMenuModule
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
        product.code?.toLowerCase().includes(term)
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
        `Produto ${!product.is_active ? 'activado' : 'desactivado'} com sucesso!`,
        'Fechar',
        { duration: 3000 }
      );
    } else {
      this.snackBar.open('Erro ao alterar estado do produto', 'Fechar', { duration: 3000 });
    }
  }

  async deleteProduct(product: Product) {
    if (!confirm(`Tem certeza que deseja eliminar o produto "${product.name}"?`)) {
      return;
    }

    const result = await this.productService.deleteProduct(product.id);

    if (result.success) {
      this.snackBar.open('Produto eliminado com sucesso!', 'Fechar', { duration: 3000 });
    } else {
      this.snackBar.open(result.error || 'Erro ao eliminar produto', 'Fechar', { duration: 5000 });
    }
  }

  exportProducts(format: 'csv' | 'xlsx') {
    const data = this.filteredProducts().map(product => ({
      'Código': product.code || '',
      'Nome': product.name,
      'Tipo': product.type === 'produto' ? 'Produto' : 'Serviço',
      'Descrição': product.description || '',
      'Preço': product.price,
      'Unidade': product.unit || '',
      'Stock': product.stock ?? '',
      'Estado': product.is_active ? 'Activo' : 'Inactivo'
    }));
    const fileName = `produtos_servicos_${new Date().toISOString().split('T')[0]}`;
    if (format === 'csv') this.exportService.exportToCsv(data, fileName);
    else this.exportService.exportToExcel(data, fileName, 'Produtos e Serviços');
  }

  async onImportFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
      const existing = new Set(this.productService.products().map(p => `${p.type}:${p.name.trim().toLowerCase()}`));
      const seen = new Set<string>();
      const products: Array<{ name: string; type: 'produto' | 'servico'; description?: string; price: number; unit?: string; stock?: number; is_active: boolean }> = [];
      const invalidRows: string[] = [];

      rows.forEach((row, index) => {
        const get = (...names: string[]) => {
          const found = Object.entries(row).find(([key]) => names.includes(key.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()));
          return String(found?.[1] ?? '').trim();
        };
        const name = get('nome', 'name');
        const typeValue = get('tipo', 'type').toLowerCase();
        const type = ['produto', 'product'].includes(typeValue) ? 'produto' : ['servico', 'service'].includes(typeValue) ? 'servico' : null;
        const price = Number(get('preco', 'price').replace(',', '.'));
        const stockText = get('stock', 'quantidade');
        const stock = stockText === '' ? 0 : Number(stockText.replace(',', '.'));
        const key = type ? `${type}:${name.toLowerCase()}` : '';
        const rowNumber = index + 2;

        if (!name || !type || !Number.isFinite(price) || price < 0) {
          invalidRows.push(`linha ${rowNumber}: Nome, Tipo e Preço válido são obrigatórios`);
          return;
        }
        if (type === 'produto' && (!Number.isFinite(stock) || stock < 0)) {
          invalidRows.push(`linha ${rowNumber}: Stock não pode ser negativo`);
          return;
        }
        if (existing.has(key) || seen.has(key)) {
          invalidRows.push(`linha ${rowNumber}: produto ou serviço duplicado`);
          return;
        }

        seen.add(key);
        const status = get('estado', 'status').toLowerCase();
        products.push({
          name, type, price, stock: type === 'produto' ? stock : undefined,
          description: get('descricao', 'description') || undefined,
          unit: get('unidade', 'unit') || undefined,
          is_active: !['inactivo', 'inativo', 'false', '0'].includes(status)
        });
      });

      if (!products.length) {
        this.snackBar.open(`Nenhum item válido encontrado. ${invalidRows.slice(0, 2).join('; ')}`, 'Fechar', { duration: 7000 });
        return;
      }
      const result = await this.productService.importProducts(products);
      if (result.error) {
        this.snackBar.open(`Erro ao importar: ${result.error}`, 'Fechar', { duration: 6000 });
        return;
      }
      const skipped = invalidRows.length ? ` ${invalidRows.length} linha(s) inválida(s) ignorada(s).` : '';
      this.snackBar.open(`${result.imported} item(ns) importado(s) com sucesso.${skipped}`, 'Fechar', { duration: 6000 });
    } catch (error) {
      console.error('Erro ao ler ficheiro de produtos:', error);
      this.snackBar.open('Não foi possível ler o ficheiro. Use um CSV ou Excel válido.', 'Fechar', { duration: 5000 });
    }
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('pt-MZ', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value) + ' MZN';
  }
}
