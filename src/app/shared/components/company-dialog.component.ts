import { Component, Inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Company } from '../../core/services/company.service';
import { MAIN_ACTIVITIES, SECONDARY_ACTIVITIES } from '../../core/constants/business-activities';

@Component({
  selector: 'app-company-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSelectModule,
    MatIconModule,
    MatTooltipModule
  ],
  template: `
    <h2 mat-dialog-title>{{ data.company ? 'Editar Empresa' : 'Nova Empresa' }}</h2>
    <mat-dialog-content>
      <div class="px-6 py-4 overflow-y-auto max-h-[calc(80vh-140px)]">
        <!-- Logo Upload -->
        <div class="flex flex-col items-center mb-8 pb-6 border-b border-gray-100">
          <div class="relative group">
            <div 
              class="w-32 h-32 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center bg-gray-50 overflow-hidden cursor-pointer hover:border-ispc-orange transition-colors"
              (click)="logoInput.click()"
            >
              @if (logoUrl()) {
                <img [src]="logoUrl()" class="w-full h-full object-contain">
              } @else {
                <div class="text-center p-4">
                  <mat-icon class="!text-gray-400 !text-3xl">add_photo_alternate</mat-icon>
                  <p class="text-xs text-gray-500 mt-1">Logotipo</p>
                </div>
              }
            </div>
            
            @if (logoUrl()) {
              <button 
                type="button"
                mat-mini-fab 
                class="!absolute -top-2 -right-2 !bg-red-500 !text-white !w-8 !h-8"
                (click)="removeLogo($event)"
                matTooltip="Remover Logotipo"
              >
                <mat-icon class="!text-lg">close</mat-icon>
              </button>
            }
          </div>
          <p class="text-xs text-gray-400 mt-2">Formatos: PNG, JPG (Máx. 2MB)</p>
          <input 
            type="file" 
            #logoInput 
            class="hidden" 
            accept="image/*" 
            (change)="onLogoSelected($event)"
          >
        </div>

        <form [formGroup]="form" class="space-y-6">
          <mat-form-field appearance="outline" class="w-full">
            <mat-label>Tipo de Entidade</mat-label>
            <mat-select formControlName="entity_type" required>
              <mat-option value="singular">Pessoa Singular</mat-option>
              <mat-option value="collective">Pessoa Colectiva</mat-option>
            </mat-select>
            <mat-icon matPrefix class="text-gray-400">person</mat-icon>
            @if (form.get('entity_type')?.hasError('required')) {
              <mat-error>Tipo de entidade é obrigatório</mat-error>
            }
          </mat-form-field>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <mat-form-field appearance="outline" class="w-full">
              <mat-label>Nome da Empresa</mat-label>
              <input matInput formControlName="name" placeholder="Ex: Comercial Silva Lda">
              <mat-icon matPrefix class="text-gray-400">business</mat-icon>
              @if (form.get('name')?.hasError('required')) {
                <mat-error>O nome é obrigatório</mat-error>
              }
            </mat-form-field>

            <mat-form-field appearance="outline" class="w-full">
              <mat-label>NUIT</mat-label>
              <input matInput formControlName="nuit" placeholder="Ex: 123456789" maxlength="9" (input)="formatNuit()">
              <mat-icon matPrefix class="text-gray-400">badge</mat-icon>
              @if (form.get('nuit')?.hasError('required')) {
                <mat-error>O NUIT é obrigatório</mat-error>
              }
              @if (form.get('nuit')?.hasError('invalidNuit')) {
                <mat-error>NUIT inválido</mat-error>
              }
            </mat-form-field>
          </div>

          <mat-form-field appearance="outline" class="w-full">
            <mat-label>Endereço</mat-label>
            <textarea matInput formControlName="address" rows="2" placeholder="Ex: Av. Julius Nyerere, nº 123"></textarea>
            <mat-icon matPrefix class="text-gray-400">location_on</mat-icon>
          </mat-form-field>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <mat-form-field appearance="outline" class="w-full">
              <mat-label>Email</mat-label>
              <input matInput formControlName="email" type="email" placeholder="Ex: contacto@empresa.com">
              <mat-icon matPrefix class="text-gray-400">email</mat-icon>
              @if (form.get('email')?.hasError('email')) {
                <mat-error>Email inválido</mat-error>
              }
            </mat-form-field>

            <mat-form-field appearance="outline" class="w-full">
              <mat-label>Telefone</mat-label>
              <input matInput formControlName="phone" placeholder="Ex: +258 84 123 4567">
              <mat-icon matPrefix class="text-gray-400">phone</mat-icon>
            </mat-form-field>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
             <mat-form-field appearance="outline" class="w-full">
              <mat-label>Actividade Principal</mat-label>
              <mat-select formControlName="mainActivity">
                @for (activity of mainActivities; track activity) {
                  <mat-option [value]="activity">{{ activity }}</mat-option>
                }
              </mat-select>
              <mat-icon matPrefix class="text-gray-400">business_center</mat-icon>
            </mat-form-field>

             <mat-form-field appearance="outline" class="w-full">
              <mat-label>Actividade Secundária</mat-label>
              <mat-select formControlName="secondaryActivity">
                @for (activity of secondaryActivities; track activity) {
                  <mat-option [value]="activity">{{ activity }}</mat-option>
                }
              </mat-select>
              <mat-icon matPrefix class="text-gray-400">store</mat-icon>
            </mat-form-field>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <mat-form-field appearance="outline" class="w-full">
              <mat-label>Tipo de Atividade (ISPC)</mat-label>
              <mat-select formControlName="business_activity_type">
                <mat-option value="comercio_ate_1m">Comércio (até 1M)</mat-option>
                <mat-option value="comercio_mais_1m">Comércio (> 1M)</mat-option>
                <mat-option value="industrial_ate_1m">Industrial (até 1M)</mat-option>
                <mat-option value="industrial_mais_1m">Industrial (> 1M)</mat-option>
                <mat-option value="servicos_ate_1m">Serviços (até 1M)</mat-option>
                <mat-option value="servicos_mais_1m">Serviços (> 1M)</mat-option>
                <mat-option value="outros">Outros</mat-option>
              </mat-select>
              <mat-icon matPrefix class="text-gray-400">category</mat-icon>
            </mat-form-field>

            <mat-form-field appearance="outline" class="w-full">
              <mat-label>Moeda</mat-label>
              <mat-select formControlName="currency">
                <mat-option value="MZN">MZN - Metical Moçambicano</mat-option>
                <mat-option value="USD">USD - Dólar Americano</mat-option>
                <mat-option value="EUR">EUR - Euro</mat-option>
                <mat-option value="ZAR">ZAR - Rand Sul-Africano</mat-option>
              </mat-select>
              <mat-icon matPrefix class="text-gray-400">payments</mat-icon>
            </mat-form-field>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <mat-form-field appearance="outline" class="w-full">
              <mat-label>Prefixo da Fatura</mat-label>
              <input matInput formControlName="invoice_prefix" placeholder="Ex: FAC">
              <mat-icon matPrefix class="text-gray-400">tag</mat-icon>
            </mat-form-field>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <mat-form-field appearance="outline" class="w-full">
                  <mat-label>Província</mat-label>
                  <mat-select formControlName="province">
                    @for (province of provinces; track province) {
                      <mat-option [value]="province">{{ province }}</mat-option>
                    }
                  </mat-select>
                  <mat-icon matPrefix class="text-gray-400">map</mat-icon>
                </mat-form-field>

                <mat-form-field appearance="outline" class="w-full">
                  <mat-label>Distrito</mat-label>
                  <input matInput formControlName="district" placeholder="Ex: Maputo" />
                  <mat-icon matPrefix class="text-gray-400">location_city</mat-icon>
                </mat-form-field>
              </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <mat-form-field appearance="outline" class="w-full">
              <mat-label>Posto Administrativo</mat-label>
              <input matInput formControlName="administrativePost" placeholder="Ex: KaMpfumo" />
              <mat-icon matPrefix class="text-gray-400">apartment</mat-icon>
            </mat-form-field>
          </div>

          <div class="border-t border-gray-100 pt-6 mt-6">
            <h3 class="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <mat-icon class="mr-2 text-ispc-orange">account_balance</mat-icon>
              Dados Bancários
            </h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <mat-form-field appearance="outline" class="w-full">
                <mat-label>Nome do Banco</mat-label>
                <input matInput formControlName="bank_name" placeholder="Ex: BIM, BCI, Standard Bank">
              </mat-form-field>

              <mat-form-field appearance="outline" class="w-full">
                <mat-label>Número de Conta</mat-label>
                <input matInput formControlName="bank_account" placeholder="Ex: 123456789">
              </mat-form-field>

              <mat-form-field appearance="outline" class="w-full">
                <mat-label>IBAN</mat-label>
                <input matInput formControlName="bank_iban" placeholder="MZ59 0000...">
              </mat-form-field>

              <mat-form-field appearance="outline" class="w-full">
                <mat-label>SWIFT/BIC</mat-label>
                <input matInput formControlName="bank_swift" placeholder="Ex: ABCDMZMM">
              </mat-form-field>
            </div>
          </div>

        </form>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">Cancelar</button>
      <button mat-raised-button color="primary" (click)="onSave()" [disabled]="form.invalid || loading()">
        {{ data.company ? 'Guardar' : 'Criar' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    :host ::ng-deep .mat-mdc-dialog-container {
      max-width: none !important;
      width: auto !important;
    }

    mat-dialog-content {
      min-width: 1000px;
      width: 85vw;
      max-width: 1400px;
      max-height: 80vh;
      overflow-y: auto;
      overflow-x: hidden;
    }

    form {
      width: 100%;
    }

    mat-form-field {
      width: 100%;
    }
  `]
})
export class CompanyDialogComponent {
  form: FormGroup;
  loading = signal(false);
  logoUrl = signal<string | null>(this.data.company?.logo_url || null);


  provinces = [
    'Maputo', 'Gaza', 'Inhambane', 'Sofala', 'Manica', 'Tete',
    'Zambézia', 'Nampula', 'Niassa', 'Cabo Delgado'
  ];

  mainActivities = MAIN_ACTIVITIES;
  secondaryActivities = SECONDARY_ACTIVITIES;

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<CompanyDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { company?: Company }
  ) {
    this.form = this.fb.group({
      name: [data.company?.name || '', Validators.required],
      entity_type: [data.company?.entity_type || '', Validators.required],
      nuit: [data.company?.nuit || '', [Validators.required]],
      address: [data.company?.address || ''],
      phone: [data.company?.phone || ''],
      email: [data.company?.email || '', Validators.email],
      business_activity_type: [(data.company as any)?.business_activity_type || 'comercio_ate_1m', Validators.required],
      currency: [data.company?.currency || 'MZN'],
      invoice_prefix: [data.company?.invoice_prefix || 'FAC'],
      province: [data.company?.documents_metadata?.province || ''],
      district: [data.company?.documents_metadata?.district || ''],
      administrativePost: [data.company?.documents_metadata?.administrativePost || ''],
      mainActivity: [data.company?.documents_metadata?.mainActivity || ''],
      secondaryActivity: [data.company?.documents_metadata?.secondaryActivity || ''],
      bank_name: [data.company?.bank_name || ''],
      bank_account: [data.company?.bank_account || ''],
      bank_iban: [data.company?.bank_iban || ''],
      bank_swift: [data.company?.bank_swift || '']
    });
  }

  onLogoSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        alert('O ficheiro é muito grande. Tamanho máximo: 2MB');
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        this.logoUrl.set(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  }

  removeLogo(event: Event) {
    event.stopPropagation();
    this.logoUrl.set(null);
  }

  formatNuit() {
    const nuitControl = this.form.get('nuit');
    if (!nuitControl) return;

    let value = nuitControl.value.replace(/\D/g, '');
    if (value.length > 9) {
      value = value.substring(0, 9);
    }
    nuitControl.setValue(value, { emitEvent: false });
  }

  onCancel(): void {
    this.dialogRef.close();
  }

  onSave(): void {
    if (this.form.valid) {
      const formValue = this.form.value;
      const formData: Partial<Company> = {
        name: formValue.name,
        nuit: formValue.nuit,
        entity_type: formValue.entity_type,
        address: formValue.address,
        phone: formValue.phone,
        email: formValue.email,
        currency: formValue.currency,
        invoice_prefix: formValue.invoice_prefix,
        logo_url: this.logoUrl() || undefined,
        documents_metadata: {
          province: formValue.province,
          district: formValue.district,
          administrativePost: formValue.administrativePost,
          mainActivity: formValue.mainActivity,
          secondaryActivity: formValue.secondaryActivity
        },
        bank_name: formValue.bank_name,
        bank_account: formValue.bank_account,
        bank_iban: formValue.bank_iban,
        bank_swift: formValue.bank_swift
      };
      
      this.dialogRef.close(formData);
    }
  }
}
