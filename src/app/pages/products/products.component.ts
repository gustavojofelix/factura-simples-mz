import { Component, OnInit, signal, computed } from '@angular/core';
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
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ProductService, Product, ISPC_CATEGORIES } from '../../core/services/product.service';
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
    <h2 mat-dialog-title>{{ data ? 'Editar' : 'Novo' }} {{ form.get('type')?.value === 'produto' ? 'Produto' : 'Serviço' }}</h2>
    <mat-dialog-content class="!pt-4">
      <form [formGroup]="form" class="space-y-4">
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

        <mat-form-field appearance="outline" class="w-full">
          <mat-label>Categoria ISPC</mat-label>
          <mat-select formControlName="ispc_category" (selectionChange)="onCategoryChange()">
            @for (category of categories; track category.value) {
              <mat-option [value]="category.value">
                {{ category.label }} ({{ category.rate * 100 }}%)
              </mat-option>
            }
          </mat-select>
          @if (form.get('ispc_category')?.hasError('required') && form.get('ispc_category')?.touched) {
            <mat-error>Categoria é obrigatória</mat-error>
          }
        </mat-form-field>

        @if (form.get('price')?.value && form.get('ispc_category')?.value) {
          <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div class="text-sm text-blue-800">
              <div class="font-semibold mb-2">Cálculo de ISPC:</div>
              <div class="space-y-1">
                <div>Preço: {{ formatCurrency(form.get('price')?.value) }}</div>
                <div>Taxa ISPC: {{ getSelectedRate() * 100 }}%</div>
                <div class="font-bold text-lg">ISPC: {{ formatCurrency(calculateIspc()) }}</div>
                <div class="font-bold text-lg">Total: {{ formatCurrency(form.get('price')?.value + calculateIspc()) }}</div>
              </div>
            </div>
          </div>
        }

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
        class="!bg-moz-green !text-white"
        [disabled]="form.invalid || saving()"
        (click)="save()"
      >
        {{ saving() ? 'A guardar...' : 'Guardar' }}
      </button>
    </mat-dialog-actions>
  `
})
export class ProductDialogComponent {
  form: FormGroup;
  saving = signal(false);
  categories = ISPC_CATEGORIES;

  constructor(
    private fb: FormBuilder,
    private productService: ProductService,
    private snackBar: MatSnackBar,
    public dialog: MatDialog
  ) {
    this.form = this.fb.group({
      type: ['produto', Validators.required],
      name: ['', Validators.required],
      description: [''],
      price: ['', [Validators.required, Validators.min(0)]],
      unit: ['un'],
      ispc_category: ['E', Validators.required],
      ispc_rate: [0],
      stock: [null]
    });
  }

  data: Product | null = null;

  ngOnInit() {
    if (this.data) {
      this.form.patchValue(this.data);
    } else {
      this.onCategoryChange();
    }
  }

  onCategoryChange() {
    const category = this.form.get('ispc_category')?.value;
    const rate = this.productService.getCategoryRate(category);
    this.form.patchValue({ ispc_rate: rate });
  }

  getSelectedRate(): number {
    const category = this.form.get('ispc_category')?.value;
    return this.productService.getCategoryRate(category);
  }

  calculateIspc(): number {
    const price = this.form.get('price')?.value || 0;
    const category = this.form.get('ispc_category')?.value;
    return this.productService.calculateIspc(price, category);
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('pt-MZ', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value) + ' MZN';
  }

  async save() {
    if (this.form.invalid) return;

    this.saving.set(true);

    try {
      const formData = { ...this.form.value };

      if (formData.type === 'servico') {
        formData.stock = null;
      }

      if (this.data) {
        const success = await this.productService.updateProduct(this.data.id, formData);
        if (success) {
          this.snackBar.open(
            `${formData.type === 'produto' ? 'Produto' : 'Serviço'} actualizado com sucesso!`,
            'Fechar',
            { duration: 3000 }
          );
          this.dialog.closeAll();
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
          this.dialog.closeAll();
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
    MatProgressSpinnerModule,
    MatSnackBarModule
  ],
  templateUrl: './products.component.html',
  styleUrls: ['./products.component.css']
})
export class ProductsComponent implements OnInit {
  displayedColumns = ['name', 'price', 'ispc', 'category', 'stock', 'actions'];
  searchTerm = signal('');

  filteredProducts = signal<Product[]>([]);

  constructor(
    public productService: ProductService,
    public companyService: CompanyService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit() {
    this.productService.loadProducts();
    this.updateFilteredProducts();
  }

  updateFilteredProducts() {
    const term = this.searchTerm().toLowerCase();
    const products = this.productService.products();

    if (!term) {
      this.filteredProducts.set(products);
    } else {
      this.filteredProducts.set(
        products.filter(product =>
          product.name.toLowerCase().includes(term) ||
          product.description?.toLowerCase().includes(term)
        )
      );
    }
  }

  onSearchChange(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.searchTerm.set(value);
    this.updateFilteredProducts();
  }

  openDialog(product?: Product) {
    const dialogRef = this.dialog.open(ProductDialogComponent, {
      width: '600px',
      data: product || null
    });

    const instance = dialogRef.componentInstance;
    instance.data = product || null;
  }

  async deleteProduct(product: Product) {
    if (!confirm(`Tem certeza que deseja eliminar o produto "${product.name}"?`)) {
      return;
    }

    const success = await this.productService.deleteProduct(product.id);

    if (success) {
      this.snackBar.open('Produto eliminado com sucesso!', 'Fechar', { duration: 3000 });
      this.updateFilteredProducts();
    } else {
      this.snackBar.open('Erro ao eliminar produto', 'Fechar', { duration: 3000 });
    }
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('pt-MZ', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value) + ' MZN';
  }

  getCategoryLabel(category: string): string {
    const cat = ISPC_CATEGORIES.find(c => c.value === category);
    return cat ? `Grupo ${cat.value}` : category;
  }
}
