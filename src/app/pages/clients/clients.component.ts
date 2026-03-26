import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { ClientService, Client } from '../../core/services/client.service';
import { CompanyService } from '../../core/services/company.service';
import { ExportService } from '../../core/services/export.service';
import { nuitValidator } from '../../core/validators/nuit.validator';

@Component({
  selector: 'app-client-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatSelectModule
  ],
  template: `
    <h2 mat-dialog-title>{{ data ? 'Editar Cliente' : 'Novo Cliente' }}</h2>
    <mat-dialog-content class="!pt-4">
      <form [formGroup]="form" class="space-y-4">
        <mat-form-field appearance="outline" class="w-full">
          <mat-label>Nome</mat-label>
          <input matInput formControlName="name" placeholder="Nome do cliente">
          @if (form.get('name')?.hasError('required') && form.get('name')?.touched) {
            <mat-error>Nome é obrigatório</mat-error>
          }
        </mat-form-field>

        <div class="space-y-2">
          <mat-form-field appearance="outline" class="w-full">
            <mat-label>NUIT</mat-label>
            <input matInput formControlName="nuit" placeholder="Número de identificação" required>
            @if (form.get('nuit')?.hasError('required') && form.get('nuit')?.touched) {
              <mat-error>NUIT é obrigatório</mat-error>
            }
          </mat-form-field>

          @if (form.get('nuit')?.value) {
            <div class="border border-gray-300 rounded-lg p-4 bg-gray-50">
              <div class="flex items-center justify-between mb-2">
                <label class="text-sm font-medium text-gray-700">Documento de Identificação (opcional)</label>
                @if (documentUrl()) {
                  <button
                    type="button"
                    mat-icon-button
                    (click)="removeDocument()"
                    class="!text-red-600"
                    matTooltip="Remover documento"
                  >
                    <mat-icon>delete</mat-icon>
                  </button>
                }
              </div>

              @if (documentUrl()) {
                <div class="mb-2 p-2 bg-green-50 border border-green-200 rounded">
                  <div class="flex items-center text-sm text-green-800">
                    <mat-icon class="!text-green-600 mr-2">check_circle</mat-icon>
                    <span class="flex-1">Documento anexado</span>
                    <a [href]="documentUrl()" target="_blank" class="text-green-600 hover:underline">
                      Ver documento
                    </a>
                  </div>
                </div>
              }

              <div class="flex items-center gap-2">
                <input
                  type="file"
                  #fileInput
                  accept="image/*,.pdf"
                  (change)="onFileSelected($event)"
                  class="hidden"
                >
                <button
                  type="button"
                  mat-stroked-button
                  (click)="fileInput.click()"
                  [disabled]="uploading()"
                >
                  <mat-icon>upload_file</mat-icon>
                  {{ uploading() ? 'A enviar...' : (documentUrl() ? 'Trocar documento' : 'Escolher documento') }}
                </button>
                <span class="text-xs text-gray-500">PDF ou imagem (máx. 5MB)</span>
              </div>
            </div>
          }
        </div>

        <mat-form-field appearance="outline" class="w-full">
          <mat-label>Email</mat-label>
          <input matInput type="email" formControlName="email" placeholder="email@exemplo.com" required>
          @if (form.get('email')?.hasError('required') && form.get('email')?.touched) {
            <mat-error>Email é obrigatório</mat-error>
          }
          @if (form.get('email')?.hasError('email') && form.get('email')?.touched) {
            <mat-error>Email inválido</mat-error>
          }
        </mat-form-field>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <mat-form-field appearance="outline" class="w-full">
            <mat-label>Telefone</mat-label>
            <input matInput formControlName="phone" placeholder="+258 XX XXX XXXX">
          </mat-form-field>

          <mat-form-field appearance="outline" class="w-full">
            <mat-label>Indústria / Sector</mat-label>
            <mat-select formControlName="industry">
              @for (ind of industries; track ind) {
                <mat-option [value]="ind">{{ ind }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>

        <mat-form-field appearance="outline" class="w-full">
          <mat-label>Endereço</mat-label>
          <textarea matInput formControlName="address" rows="3" placeholder="Endereço completo" required></textarea>
          @if (form.get('address')?.hasError('required') && form.get('address')?.touched) {
            <mat-error>Endereço é obrigatório</mat-error>
          }
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end" class="!px-6 !pb-4">
      <button mat-button mat-dialog-close>Cancelar</button>
      <button
        mat-raised-button
        class="!bg-ispc-orange !text-white"
        [disabled]="form.invalid || saving() || uploading()"
        (click)="save()"
      >
        {{ saving() ? 'A guardar...' : 'Guardar' }}
      </button>
    </mat-dialog-actions>
  `
})
export class ClientDialogComponent {
  form: FormGroup;
  saving = signal(false);
  uploading = signal(false);
  documentUrl = signal<string | null>(null);

  industries = [
    'Comércio',
    'Serviços',
    'Indústria',
    'Agricultura',
    'Construção',
    'Tecnologia',
    'Saúde',
    'Educação',
    'Outros'
  ];

  constructor(
    private fb: FormBuilder,
    private clientService: ClientService,
    private snackBar: MatSnackBar,
    public dialog: MatDialog
  ) {
    this.form = this.fb.group({
      name: ['', Validators.required],
      nuit: ['', [Validators.required, nuitValidator()]],
      email: ['', [Validators.required, Validators.email]],
      phone: [''],
      industry: [''],
      address: ['', Validators.required],
      document_url: [''],
      document_type: ['NUIT']
    });
  }

  data: Client | null = null;

  ngOnInit() {
    if (this.data) {
      this.form.patchValue(this.data);
      if (this.data.document_url) {
        this.documentUrl.set(this.data.document_url);
      }
    }
  }

  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      this.snackBar.open('Ficheiro muito grande. Máximo: 5MB', 'Fechar', { duration: 3000 });
      return;
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
    if (!allowedTypes.includes(file.type)) {
      this.snackBar.open('Tipo de ficheiro não permitido', 'Fechar', { duration: 3000 });
      return;
    }

    this.uploading.set(true);

    try {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        this.documentUrl.set(dataUrl);
        this.form.patchValue({
          document_url: dataUrl,
          document_type: file.type === 'application/pdf' ? 'PDF' : 'Imagem'
        });
        this.snackBar.open('Documento carregado!', 'Fechar', { duration: 2000 });
      };
      reader.readAsDataURL(file);
    } catch (error) {
      this.snackBar.open('Erro ao carregar documento', 'Fechar', { duration: 3000 });
    } finally {
      this.uploading.set(false);
    }
  }

  removeDocument() {
    this.documentUrl.set(null);
    this.form.patchValue({
      document_url: null,
      document_type: null
    });
  }

  async save() {
    if (this.form.invalid) return;

    this.saving.set(true);

    try {
      const formData = this.form.value;
      const nuit = formData.nuit;

      // Verificar NUIT duplicado
      const isDuplicate = await this.clientService.isNuitDuplicate(nuit, this.data?.id);
      if (isDuplicate) {
        this.snackBar.open('Já existe um cliente registado com este NUIT nesta empresa.', 'Fechar', {
          duration: 5000
        });
        this.saving.set(false);
        return;
      }

      if (this.data) {
        const success = await this.clientService.updateClient(this.data.id, formData);
        if (success) {
          this.snackBar.open('Cliente actualizado com sucesso!', 'Fechar', { duration: 3000 });
          this.dialog.closeAll();
        } else {
          this.snackBar.open('Erro ao actualizar cliente', 'Fechar', { duration: 3000 });
        }
      } else {
        const client = await this.clientService.createClient(formData);
        if (client) {
          this.snackBar.open('Cliente criado com sucesso!', 'Fechar', { duration: 3000 });
          this.dialog.closeAll();
        } else {
          this.snackBar.open('Erro ao criar cliente', 'Fechar', { duration: 3000 });
        }
      }
    } finally {
      this.saving.set(false);
    }
  }
}

@Component({
  selector: 'app-clients',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatDialogModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatMenuModule,
    MatTooltipModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule
  ],
  templateUrl: './clients.component.html',
  styleUrls: ['./clients.component.css']
})
export class ClientsComponent implements OnInit {
  displayedColumns = ['id', 'name', 'nuit', 'email', 'industry', 'status', 'actions'];
  searchTerm = signal('');
  industryFilter = signal('');
  statusFilter = signal<'all' | 'active' | 'inactive'>('all');
  sortField = signal<'id' | 'name'>('id');
  sortOrder = signal<'asc' | 'desc'>('asc');

  industries = [
    'Comércio',
    'Serviços',
    'Indústria',
    'Agricultura',
    'Construção',
    'Tecnologia',
    'Saúde',
    'Educação',
    'Outros'
  ];

  filteredClients = computed(() => {
    const term = this.searchTerm().toLowerCase();
    const industry = this.industryFilter();
    const status = this.statusFilter();
    const clients = this.clientService.clients();
    const field = this.sortField();
    const order = this.sortOrder();

    const filtered = clients.filter(client => {
      const matchesSearch = !term ||
        client.name.toLowerCase().includes(term) ||
        client.nuit?.toLowerCase().includes(term) ||
        client.email?.toLowerCase().includes(term) ||
        client.phone?.toLowerCase().includes(term) ||
        client.client_code?.toLowerCase().includes(term);

      const matchesIndustry = !industry || client.industry === industry;

      const matchesStatus = status === 'all' ||
        (status === 'active' && client.is_active) ||
        (status === 'inactive' && !client.is_active);

      return matchesSearch && matchesIndustry && matchesStatus;
    });

    return filtered.sort((a, b) => {
      const valA = field === 'name' ? a.name.toLowerCase() : (a.client_code ?? '');
      const valB = field === 'name' ? b.name.toLowerCase() : (b.client_code ?? '');
      if (valA < valB) return order === 'asc' ? -1 : 1;
      if (valA > valB) return order === 'asc' ? 1 : -1;
      return 0;
    });
  });

  constructor(
    public clientService: ClientService,
    public companyService: CompanyService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar,
    private exportService: ExportService
  ) { }

  ngOnInit() {
    this.clientService.loadClients();
  }


  onSearchChange(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.searchTerm.set(value);
  }

  onIndustryChange(value: string) {
    this.industryFilter.set(value);
  }

  onStatusChange(value: 'all' | 'active' | 'inactive') {
    this.statusFilter.set(value);
  }

  clearFilters() {
    this.searchTerm.set('');
    this.industryFilter.set('');
    this.statusFilter.set('all');
  }
  onSortFieldChange(value: 'id' | 'name') {
    this.sortField.set(value);
  }

  onSortOrderChange(value: 'asc' | 'desc') {
    this.sortOrder.set(value);
  }

  openDialog(client?: Client) {
    const dialogRef = this.dialog.open(ClientDialogComponent, {
      width: '600px',
      data: client || null
    });

    const instance = dialogRef.componentInstance;
    instance.data = client || null;

    dialogRef.afterClosed().subscribe(() => {
      this.clientService.loadClients();
    });
  }

  async toggleStatus(client: Client) {
    const success = await this.clientService.toggleClientActiveStatus(client.id, client.is_active);
    if (success) {
      this.snackBar.open(
        `Cliente ${!client.is_active ? 'activado' : 'desactivado'} com sucesso!`,
        'Fechar',
        { duration: 3000 }
      );
    } else {
      this.snackBar.open('Erro ao alterar estado do cliente', 'Fechar', { duration: 3000 });
    }
  }

  async deleteClient(client: Client) {
    if (!confirm(`Tem certeza que deseja eliminar o cliente "${client.name}"?`)) {
      return;
    }

    const result = await this.clientService.deleteClient(client.id);

    if (result.success) {
      this.snackBar.open('Cliente eliminado com sucesso!', 'Fechar', { duration: 3000 });
    } else {
      this.snackBar.open(result.error || 'Erro ao eliminar cliente', 'Fechar', { duration: 5000 });
    }
  }

  exportAsCSV() {
    const data = this.clientService.clients().map(c => ({
      'ID': c.client_code || '',
      'Nome': c.name,
      'NUIT': c.nuit || '',
      'Email': c.email || '',
      'Telefone': c.phone || '',
      'Endereço': c.address || '',
      'Estado': c.is_active ? 'Activo' : 'Inactivo'
    }));
    this.exportService.exportToCsv(data, `clientes_${new Date().toISOString().split('T')[0]}`);
  }

  exportAsExcel() {
    const data = this.clientService.clients().map(c => ({
      'ID': c.client_code || '',
      'Nome': c.name,
      'NUIT': c.nuit || '',
      'Email': c.email || '',
      'Telefone': c.phone || '',
      'Endereço': c.address || '',
      'Estado': c.is_active ? 'Activo' : 'Inactivo'
    }));
    this.exportService.exportToExcel(data, `clientes_${new Date().toISOString().split('T')[0]}`);
  }
}
