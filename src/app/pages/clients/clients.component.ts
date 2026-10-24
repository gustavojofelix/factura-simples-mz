import { Component, OnInit, signal, computed, inject } from '@angular/core';
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
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { ClientService, Client } from '../../core/services/client.service';
import { CompanyService } from '../../core/services/company.service';
import { REPORT_ROLES } from '../../core/guards/role.guard';
import { Router } from '@angular/router';
import { ExportService } from '../../core/services/export.service';
import { nuitValidator } from '../../core/validators/nuit.validator';
import { SubscriptionLimitDialogComponent } from '../../shared/components/subscription-limit-dialog.component';
import * as XLSX from 'xlsx';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

/** Valores gravados na BD (client.industry) → chave da etiqueta traduzida. */
const INDUSTRIES: ReadonlyArray<{ value: string; key: string }> = [
  { value: 'Comércio', key: 'commerce' },
  { value: 'Serviços', key: 'services' },
  { value: 'Indústria', key: 'industry' },
  { value: 'Agricultura', key: 'agriculture' },
  { value: 'Construção', key: 'construction' },
  { value: 'Tecnologia', key: 'technology' },
  { value: 'Saúde', key: 'health' },
  { value: 'Educação', key: 'education' },
  { value: 'Outros', key: 'other' }
];

function industryOptions(): Array<{ value: string; label: string }> {
  return INDUSTRIES.map(ind => ({ value: ind.value, label: t(`clients.industries.${ind.key}`) }));
}

/** Etiqueta traduzida de um sector gravado (valores desconhecidos ficam como estão). */
function industryLabel(value: string | null | undefined): string {
  if (!value) return '';
  const match = INDUSTRIES.find(ind => ind.value === value);
  return match ? t(`clients.industries.${match.key}`) : value;
}

/** Converte a etiqueta (ou o valor) importada no valor gravado na BD. */
function industryValue(input: string): string {
  const normalized = input.toLowerCase().trim();
  const match = INDUSTRIES.find(ind =>
    ind.value.toLowerCase() === normalized || t(`clients.industries.${ind.key}`).toLowerCase() === normalized
  );
  return match ? match.value : input;
}

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
    MatSelectModule,
    TranslatePipe
  ],
  template: `
    <h2 mat-dialog-title>{{ (data ? 'clients.dialog.editTitle' : 'clients.dialog.newTitle') | t }}</h2>
    <mat-dialog-content class="!pt-4">
      <form [formGroup]="form" class="space-y-4">
        <mat-form-field appearance="outline" class="w-full">
          <mat-label>{{ 'common.fields.name' | t }}</mat-label>
          <input matInput formControlName="name" [placeholder]="'clients.dialog.namePlaceholder' | t">
          @if (form.get('name')?.hasError('required') && form.get('name')?.touched) {
            <mat-error>{{ 'clients.dialog.nameRequired' | t }}</mat-error>
          }
        </mat-form-field>

        <div class="space-y-2">
          <mat-form-field appearance="outline" class="w-full">
            <mat-label>NUIT</mat-label>
            <input matInput formControlName="nuit" [placeholder]="'clients.dialog.nuitPlaceholder' | t" required>
            @if (form.get('nuit')?.hasError('required') && form.get('nuit')?.touched) {
              <mat-error>{{ 'clients.dialog.nuitRequired' | t }}</mat-error>
            }
          </mat-form-field>

          @if (form.get('nuit')?.value) {
            <div class="border border-gray-300 rounded-lg p-4 bg-gray-50">
              <div class="flex items-center justify-between mb-2">
                <label class="text-sm font-medium text-gray-700">{{ 'clients.dialog.idDocument' | t }}</label>
                @if (documentUrl()) {
                  <button
                    type="button"
                    mat-icon-button
                    (click)="removeDocument()"
                    class="!text-red-600"
                    [title]="'clients.dialog.removeDocument' | t"
                  >
                    <mat-icon>delete</mat-icon>
                  </button>
                }
              </div>

              @if (documentUrl()) {
                <div class="mb-2 p-2 bg-green-50 border border-green-200 rounded">
                  <div class="flex items-center text-sm text-green-800">
                    <mat-icon class="!text-green-600 mr-2">check_circle</mat-icon>
                    <span class="flex-1">{{ 'clients.dialog.documentAttached' | t }}</span>
                    <a [href]="documentUrl()" target="_blank" class="text-green-600 hover:underline">
                      {{ 'clients.dialog.viewDocument' | t }}
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
                  {{ (uploading() ? 'clients.dialog.uploading' : (documentUrl() ? 'clients.dialog.replaceDocument' : 'clients.dialog.chooseDocument')) | t }}
                </button>
                <span class="text-xs text-gray-500">{{ 'clients.dialog.documentHint' | t }}</span>
              </div>
            </div>
          }
        </div>

        <mat-form-field appearance="outline" class="w-full">
          <mat-label>{{ 'clients.dialog.email' | t }}</mat-label>
          <input matInput type="email" formControlName="email" [placeholder]="'clients.dialog.emailPlaceholder' | t" required>
          @if (form.get('email')?.hasError('required') && form.get('email')?.touched) {
            <mat-error>{{ 'clients.dialog.emailRequired' | t }}</mat-error>
          }
          @if (form.get('email')?.hasError('email') && form.get('email')?.touched) {
            <mat-error>{{ 'clients.dialog.emailInvalid' | t }}</mat-error>
          }
        </mat-form-field>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <mat-form-field appearance="outline" class="w-full">
            <mat-label>{{ 'common.fields.phone' | t }}</mat-label>
            <input matInput type="tel" inputmode="numeric" maxlength="9" formControlName="phone" [placeholder]="'clients.dialog.phonePlaceholder' | t" (input)="onPhoneInput($event)">
            @if (form.get('phone')?.hasError('pattern') && form.get('phone')?.touched) {
              <mat-error>{{ 'clients.dialog.phoneInvalid' | t }}</mat-error>
            }
          </mat-form-field>

          <mat-form-field appearance="outline" class="w-full">
            <mat-label>{{ 'clients.dialog.industry' | t }}</mat-label>
            <mat-select formControlName="industry">
              @for (ind of industries; track ind.value) {
                <mat-option [value]="ind.value">{{ ind.label }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>

        <mat-form-field appearance="outline" class="w-full">
          <mat-label>{{ 'common.fields.address' | t }}</mat-label>
          <textarea matInput formControlName="address" rows="3" [placeholder]="'clients.dialog.addressPlaceholder' | t" required></textarea>
          @if (form.get('address')?.hasError('required') && form.get('address')?.touched) {
            <mat-error>{{ 'clients.dialog.addressRequired' | t }}</mat-error>
          }
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end" class="!px-6 !pb-4">
      <button mat-button mat-dialog-close>{{ 'common.actions.cancel' | t }}</button>
      <button
        mat-raised-button
        class="!bg-ispc-orange !text-white"
        [disabled]="form.invalid || saving() || uploading()"
        (click)="save()"
      >
        {{ (saving() ? 'common.status.saving' : 'common.actions.save') | t }}
      </button>
    </mat-dialog-actions>
  `
})
export class ClientDialogComponent {
  form: FormGroup;
  saving = signal(false);
  uploading = signal(false);
  documentUrl = signal<string | null>(null);

  industries = industryOptions();

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
      phone: ['', Validators.pattern(/^\d{9}$/)],
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

  onPhoneInput(event: Event) {
    const input = event.target as HTMLInputElement;
    const phone = input.value.replace(/\D/g, '').slice(0, 9);
    this.form.get('phone')?.setValue(phone, { emitEvent: false });
  }

  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      this.snackBar.open(t('clients.messages.fileTooLarge'), t('common.actions.close'), { duration: 3000 });
      return;
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
    if (!allowedTypes.includes(file.type)) {
      this.snackBar.open(t('clients.messages.fileTypeNotAllowed'), t('common.actions.close'), { duration: 3000 });
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
        this.snackBar.open(t('clients.messages.documentUploaded'), t('common.actions.close'), { duration: 2000 });
      };
      reader.readAsDataURL(file);
    } catch (error) {
      this.snackBar.open(friendlyErrorMessage(error, t('clients.messages.documentUploadFailed')), t('common.actions.close'), { duration: 6000 });
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
        this.snackBar.open(t('clients.messages.duplicateNuit'), t('common.actions.close'), {
          duration: 5000
        });
        this.saving.set(false);
        return;
      }

      if (this.data) {
        const success = await this.clientService.updateClient(this.data.id, formData);
        if (success) {
          this.snackBar.open(t('clients.messages.updated'), t('common.actions.close'), { duration: 3000 });
          this.dialog.closeAll();
        } else {
          this.snackBar.open(this.clientService.lastError || t('clients.messages.updateFailed'), t('common.actions.close'), { duration: 6000 });
        }
      } else {
        const client = await this.clientService.createClient(formData);
        if (client) {
          this.snackBar.open(t('clients.messages.created'), t('common.actions.close'), { duration: 3000 });
          this.dialog.closeAll();
        }
      }
    } catch (error: any) {
      // Handle subscription feature limit errors with a dedicated upgrade dialog
      if (
        error?.code === 'P0001' &&
        error?.details === 'SUBSCRIPTION_FEATURE_DISABLED'
      ) {
        this.dialog.closeAll();
        this.dialog.open(SubscriptionLimitDialogComponent, {
          width: '420px',
          panelClass: 'subscription-limit-dialog',
          data: { errorMessage: error?.message }
        });
      } else {
        console.error('Erro ao guardar cliente:', error);
        this.snackBar.open(friendlyErrorMessage(error, t('clients.messages.saveFailed')), t('common.actions.close'), { duration: 8000 });
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
    MatSelectModule,
    TranslatePipe
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

  industries = industryOptions();
  industryLabel = industryLabel;

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
    private exportService: ExportService,
    private router: Router
  ) { }

  /** O extracto só está disponível para Proprietário, Admin e Gestor. */
  canViewStatement = computed(() => REPORT_ROLES.includes(this.companyService.activeRole() || ''));

  ngOnInit() {
    this.clientService.loadClients();
  }

  viewStatement(client: Client) {
    this.router.navigate(['/relatorios/extractos', client.id]);
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

  async onImportFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: '' });
      const existingNuits = new Set(this.clientService.clients().map(client => client.nuit?.trim()).filter(Boolean));
      const importedNuits = new Set<string>();
      const clients: Array<{ name: string; nuit: string; email: string; phone?: string; address: string; industry?: string; is_active: boolean }> = [];
      const invalidRows: string[] = [];

      rows.forEach((row, index) => {
        const getValue = (...names: string[]) => {
          const entry = Object.entries(row).find(([key]) =>
            names.includes(key.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim())
          );
          return String(entry?.[1] ?? '').trim();
        };
        // Aceita cabeçalhos em português, inglês e francês (os modelos são gerados na língua da interface).
        const name = getValue('nome', 'name', 'nom');
        const nuit = getValue('nuit');
        const email = getValue('email', 'e-mail');
        const phone = getValue('telefone', 'phone', 'telemovel', 'telephone');
        const address = getValue('endereco', 'morada', 'address', 'adresse');
        const industry = getValue('industria', 'sector', 'setor', 'industry', 'secteur');
        const status = getValue('estado', 'status', 'statut').toLowerCase();
        const rowNumber = index + 2;

        if (!name || !nuit || !email || !address) {
          invalidRows.push(t('clients.import.rowRequired', { row: rowNumber }));
          return;
        }
        if (!/^\d{9}$/.test(nuit)) {
          invalidRows.push(t('clients.import.rowNuitDigits', { row: rowNumber }));
          return;
        }
        if (Validators.email({ value: email } as any)) {
          invalidRows.push(t('clients.import.rowEmailInvalid', { row: rowNumber }));
          return;
        }
        if (phone && !/^\d{9}$/.test(phone)) {
          invalidRows.push(t('clients.import.rowPhoneDigits', { row: rowNumber }));
          return;
        }
        if (existingNuits.has(nuit) || importedNuits.has(nuit)) {
          invalidRows.push(t('clients.import.rowNuitDuplicate', { row: rowNumber }));
          return;
        }

        importedNuits.add(nuit);
        clients.push({
          name,
          nuit,
          email,
          phone: phone || undefined,
          address,
          industry: industry ? industryValue(industry) : undefined,
          is_active: !['inactivo', 'inativo', 'false', '0', 'inactive', 'inactif', t('common.status.inactive').toLowerCase()].includes(status)
        });
      });

      if (invalidRows.length) {
        console.warn('Linhas inválidas na importação de clientes:', invalidRows);
      }

      if (!clients.length) {
        this.snackBar.open(t('clients.import.noneValid', { details: invalidRows.slice(0, 2).join('; ') }), t('common.actions.close'), { duration: 7000 });
        return;
      }

      const result = await this.clientService.importClients(clients);
      if (result.error) {
        this.snackBar.open(t('clients.import.failed', { error: result.error }), t('common.actions.close'), { duration: 6000 });
        return;
      }

      const message = invalidRows.length
        ? t('clients.import.successWithSkipped', { imported: result.imported, skipped: invalidRows.length })
        : t('clients.import.success', { count: result.imported });
      this.snackBar.open(message, t('common.actions.close'), { duration: 6000 });
    } catch (error) {
      console.error('Erro ao ler ficheiro de clientes:', error);
      this.snackBar.open(t('clients.messages.importReadFailed'), t('common.actions.close'), { duration: 5000 });
    }
  }

  downloadImportTemplate(format: 'xlsx' | 'xls' | 'csv') {
    const example = [{
      [t('clients.columns.name')]: t('clients.template.exampleName'),
      'NUIT': '400123456',
      [t('clients.columns.email')]: 'geral@exemplo.co.mz',
      [t('clients.columns.phone')]: '841234567',
      [t('clients.columns.address')]: 'Av. 25 de Setembro, Maputo',
      [t('clients.columns.industry')]: industryLabel('Comércio'),
      [t('clients.columns.status')]: t('common.status.active')
    }];
    const fileName = t('clients.template.fileName');

    if (format === 'csv') {
      this.exportService.exportToCsv(example, fileName);
      return;
    }

    const worksheet = XLSX.utils.json_to_sheet(example);
    worksheet['!cols'] = [
      { wch: 30 }, { wch: 14 }, { wch: 28 }, { wch: 14 },
      { wch: 38 }, { wch: 18 }, { wch: 12 }
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, t('clients.template.sheetName'));
    XLSX.writeFile(workbook, `${fileName}.${format}`, format === 'xls' ? { bookType: 'biff8' } : undefined);
  }

  async toggleStatus(client: Client) {
    const success = await this.clientService.toggleClientActiveStatus(client.id, client.is_active);
    if (success) {
      this.snackBar.open(
        t(!client.is_active ? 'clients.messages.activated' : 'clients.messages.deactivated'),
        t('common.actions.close'),
        { duration: 3000 }
      );
    } else {
      this.snackBar.open(this.clientService.lastError || t('clients.messages.statusChangeFailed'), t('common.actions.close'), { duration: 6000 });
    }
  }

  async deleteClient(client: Client) {
    if (!confirm(t('clients.messages.confirmDelete', { name: client.name }))) {
      return;
    }

    const result = await this.clientService.deleteClient(client.id);

    if (result.success) {
      this.snackBar.open(t('clients.messages.deleted'), t('common.actions.close'), { duration: 3000 });
    } else {
      this.snackBar.open(result.error || t('clients.messages.deleteFailed'), t('common.actions.close'), { duration: 5000 });
    }
  }

  private exportRows() {
    const active = t('common.status.active');
    const inactive = t('common.status.inactive');
    return this.clientService.clients().map(c => ({
      'ID': c.client_code || '',
      [t('clients.columns.name')]: c.name,
      'NUIT': c.nuit || '',
      [t('clients.columns.email')]: c.email || '',
      [t('clients.columns.phone')]: c.phone || '',
      [t('clients.columns.address')]: c.address || '',
      [t('clients.columns.status')]: c.is_active ? active : inactive
    }));
  }

  private exportFileName(): string {
    return t('clients.export.fileName', { date: new Date().toISOString().split('T')[0] });
  }

  exportAsCSV() {
    this.exportService.exportToCsv(this.exportRows(), this.exportFileName());
  }

  exportAsExcel() {
    this.exportService.exportToExcel(this.exportRows(), this.exportFileName(), t('clients.export.sheetName'));
  }
}
