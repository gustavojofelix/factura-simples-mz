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
import { ProductService, Product } from '../../core/services/product.service';
import { CompanyService } from '../../core/services/company.service';

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
    private dialogRef: MatDialogRef<ProductDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public product: Product | null
  ) {
    this.form = this.fb.group({
      type: ['servico', Validators.required],
      name: ['', Validators.required],
      description: [''],
      price: ['', [Validators.required, Validators.min(0)]],
      unit: ['un'],
      stock: [null]
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
        } else {
          this.snackBar.open('Erro ao criar', 'Fechar', { duration: 3000 });
        }
      }
    } catch (error) {
      console.error('Erro ao guardar:', error);
      this.snackBar.open('Erro ao guardar. Verifique os dados.', 'Fechar', { duration: 3000 });
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
    MatTooltipModule
  ],
  templateUrl: './products.component.html',
  styleUrls: ['./products.component.css']
})
export class ProductsComponent implements OnInit {
  displayedColumns = ['code', 'name', 'price', 'unit', 'stock', 'status', 'actions'];
  searchTerm = signal('');
  sortField = signal<string>('name');
  sortDirection = signal<'asc' | 'desc'>('asc');
  minPriceFilter = signal<number | null>(null);
  maxPriceFilter = signal<number | null>(null);

  filteredProducts = computed(() => {
    const term = this.searchTerm().toLowerCase();
    const products = [...this.productService.products()];
    const field = this.sortField();
    const direction = this.sortDirection();
    const minPrice = this.minPriceFilter();
    const maxPrice = this.maxPriceFilter();

    // 1. Filtering
    let filtered = products;
    if (term) {
      filtered = products.filter(product =>
        product.name.toLowerCase().includes(term) ||
        product.description?.toLowerCase().includes(term) ||
        String(product.code).includes(term)
      );
    }

    // 2. Price Filtering
    if (minPrice !== null) {
      filtered = filtered.filter(product => product.price >= minPrice);
    }
    if (maxPrice !== null) {
      filtered = filtered.filter(product => product.price <= maxPrice);
    }

    // 2. Sorting
    filtered.sort((a, b) => {
      let valA: any;
      let valB: any;

      switch (field) {
        case 'code':
          valA = a.code;
          valB = b.code;
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
    private snackBar: MatSnackBar
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

  clearFilters() {
    this.searchTerm.set('');
    this.sortField.set('name');
    this.sortDirection.set('asc');
    this.minPriceFilter.set(null);
    this.maxPriceFilter.set(null);
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

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('pt-MZ', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value) + ' MZN';
  }
}
