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
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { DocumentProcessingService, CompanyDocument } from '../../core/services/document-processing.service';
import { Company } from '../../core/services/company.service';
import { ACTIVITY_HIERARCHY } from '../../core/constants/activity-categories';
import { SupabaseService } from '../../core/services/supabase.service';

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
    MatTooltipModule,
    MatSnackBarModule,
    MatProgressSpinnerModule
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
              
              <div matSuffix class="flex items-center">
                @if (isUploadingNuit()) {
                  <mat-spinner diameter="20" class="mr-2"></mat-spinner>
                } @else {
                  @if (nuitDocumentUrl()) {
                    <mat-icon class="text-green-500 mr-2" matTooltip="Documento carregado">check_circle</mat-icon>
                    <button type="button" mat-icon-button (click)="viewDocument()" matTooltip="Visualizar Documento">
                      <mat-icon class="text-blue-500">visibility</mat-icon>
                    </button>
                    <button type="button" mat-icon-button (click)="nuitInput.click()" matTooltip="Alterar Documento">
                      <mat-icon class="text-gray-400">file_upload</mat-icon>
                    </button>
                  } @else {
                    <button type="button" mat-icon-button (click)="nuitInput.click()" matTooltip="Fazer upload do NUIT (Opcional)">
                      <mat-icon class="text-gray-400">file_upload</mat-icon>
                    </button>
                  }
                }
                <input type="file" #nuitInput class="hidden" accept=".pdf,.jpg,.jpeg,.png" (change)="onNuitDocumentSelected($event)">
              </div>

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
            <textarea matInput formControlName="address" rows="2" placeholder="Ex: Av. Julius Nyerere, nº 123" required></textarea>
            <mat-icon matPrefix class="text-gray-400">location_on</mat-icon>
            @if (form.get('address')?.hasError('required')) {
              <mat-error>O endereço é obrigatório</mat-error>
            }
          </mat-form-field>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <mat-form-field appearance="outline" class="w-full">
              <mat-label>Email</mat-label>
              <input matInput formControlName="email" type="email" placeholder="Ex: contacto@empresa.com" required>
              <mat-icon matPrefix class="text-gray-400">email</mat-icon>
              @if (form.get('email')?.hasError('required')) {
                <mat-error>O email é obrigatório</mat-error>
              }
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

          <div class="border-t border-gray-100 pt-6 mt-6">
            <h3 class="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <mat-icon class="mr-2 text-ispc-orange">business_center</mat-icon>
              Tipo de Actividades
            </h3>
            
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <mat-form-field appearance="outline" class="w-full">
                <mat-label>Actividade Principal</mat-label>
                <mat-select formControlName="category1">
                  @for (cat of getCat1Options(); track cat.id) {
                    <mat-option [value]="cat.id">{{ cat.label }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>

              @if (getCat2Options().length > 0) {
                <mat-form-field appearance="outline" class="w-full">
                  <mat-label>Actividade(s) Comerciais</mat-label>
                  <mat-select formControlName="category2">
                    @for (cat of getCat2Options(); track cat.id) {
                      <mat-option [value]="cat.id">{{ cat.label }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
              }

              @if (getCat3Options().length > 0) {
                <mat-form-field appearance="outline" class="w-full">
                  <mat-label>Actividade(s) de Prestação de Serviços</mat-label>
                  <mat-select formControlName="category3">
                    @for (cat of getCat3Options(); track cat) {
                      <mat-option [value]="cat">{{ cat }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
              }
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <mat-form-field appearance="outline" class="w-full">
              <mat-label>Volume de Negócio</mat-label>
              <mat-select formControlName="business_volume">
                @if (isISPCScaleActivity()) {
                  <mat-option value="3">3% (até 1.000.000,00MT)</mat-option>
                  <mat-option value="4">4% (> 1.000.000,00MT e ≤ 2.500.000,00MT)</mat-option>
                  <mat-option value="5">5% (> 2.500.000,00MT e ≤ 4.000.000,00MT)</mat-option>
                  <mat-option value="20">20% (> 4.000.000,00MT)</mat-option>
                } @else {
                  @if (getServiceType() === 'nao_liberais') {
                    <mat-option value="12">12% s/ volume ≤ 4.000.000,00MT</mat-option>
                    <mat-option value="20">20% s/ volume > 4.000.000,00MT</mat-option>
                  } @else if (getServiceType() === 'liberal') {
                    <mat-option value="15">15% s/ volume ≤ 4.000.000,00MT</mat-option>
                    <mat-option value="20">20% s/ volume > 4.000.000,00MT</mat-option>
                  }
                }
              </mat-select>
              <mat-icon matPrefix class="text-gray-400">trending_up</mat-icon>
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

           <!-- Seccao Alvará -->
            <div class="border-t border-gray-100 pt-6 mt-6">
              <h3 class="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <mat-icon class="mr-2 text-ispc-orange">verified</mat-icon>
                Alvará
              </h3>
              <div class="bg-gray-50 p-4 rounded-lg">
                @if (alvaraDoc) {
                  <div class="flex items-center justify-between bg-white p-3 rounded border">
                    <span class="text-sm truncate">{{ alvaraDoc.file_name }}</span>
                    <div class="flex items-center">
                      <button type="button" mat-icon-button color="primary" (click)="viewOtherDocument(alvaraDoc)" matTooltip="Visualizar">
                        <mat-icon>visibility</mat-icon>
                      </button>
                      <button type="button" mat-icon-button color="warn" (click)="removeOtherDocument(alvaraDoc)" matTooltip="Remover">
                        <mat-icon>delete</mat-icon>
                      </button>
                    </div>
                  </div>
                } @else {
                  <div class="flex items-center gap-3">
                    <button type="button" mat-raised-button (click)="alvaraInput.click()" [disabled]="isUploadingAlvara()">
                      <mat-icon>file_upload</mat-icon>
                      {{ isUploadingAlvara() ? 'Carregando...' : 'Fazer Upload do Alvará' }}
                    </button>
                    <span class="text-xs text-gray-500">PDF, JPG ou PNG (máx.10MB)</span>
                    <input type="file" #alvaraInput class="hidden" accept=".pdf,.jpg,.jpeg,.png" (change)="onAlvaraDocumentSelected($event)">
                  </div>
                }
              </div>
            </div>
             <!-- Seccao Início de Actividade -->
                <div class="border-t border-gray-100 pt-6 mt-6">
                  <h3 class="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                    <mat-icon class="mr-2 text-ispc-orange">event_available</mat-icon>
                    Início de Actividade
                  </h3>
                  <div class="bg-gray-100 p-4 rounded-lg">
                    @if (commercialActivityUrl()) {
                      <div class="flex items-center justify-between bg-white p-3 rounded border">
                        <span class="text-sm text-green-600 flex items-center gap-1">
                          <mat-icon class="!text-base">check_circle</mat-icon>
                          Documento carregado
                        </span>
                        <div class="flex items-center">
                            <button type="button" mat-icon-button color="primary" (click)="viewCommercialDocument()" matTooltip="Visualizar">
                              <mat-icon class="!text-lg">visibility</mat-icon>
                            </button>
                            <button type="button" mat-icon-button (click)="commercialInput.click()" [disabled]="isUploadingCommercial()" matTooltip="Alterar Documento">
                              <mat-icon class="!text-lg">file_upload</mat-icon>
                            </button>
                            <button type="button" mat-icon-button color="warn" (click)="clearCommercialDocument()" matTooltip="Apagar Documento">
                              <mat-icon class="!text-lg">delete</mat-icon>
                            </button>
                          </div>
                      </div>
                    } @else {
                      <div class="flex items-center gap-3">
                        <button type="button" mat-raised-button (click)="commercialInput.click()" [disabled]="isUploadingCommercial()">
                          <mat-icon>file_upload</mat-icon>
                          {{ isUploadingCommercial() ? 'Carregando...' : 'Fazer Upload do Início de Actividade' }}
                        </button>
                        <span class="text-xs text-gray-500">PDF, JPG ou PNG (máx.10MB)</span>
                      </div>
                    }
                    <input type="file" #commercialInput class="hidden" accept=".pdf,.jpg,.jpeg,.png"
                      (change)="onCommercialDocumentSelected($event)">
                  </div>
                </div>
          <!-- Seccao de Documentos Adicionais -->
          <div class="border-t border-gray-100 pt-6 mt-6">
            <h3 class="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <mat-icon class="mr-2 text-ispc-orange">folder</mat-icon>
              Outros Documentos
            </h3>

            <div class="bg-gray-50 p-4 rounded-lg mb-4">
              <div class="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                <mat-form-field appearance="outline" class="w-full">
                  <mat-label>Tipo de Documento</mat-label>
                  <mat-select [formControl]="newDocType">
                    @for (type of documentTypes; track type) {
                      <mat-option [value]="type" [disabled]="isDocTypeSelected(type)">
                        {{ type }}
                      </mat-option>
                    }
                  </mat-select>
                </mat-form-field>

                <div class="flex items-center gap-2 mb-2">
                  <button type="button" mat-raised-button (click)="otherInput.click()" [disabled]="!newDocType.value || isUploadingOther()">
                    <mat-icon>file_upload</mat-icon>
                    {{ isUploadingOther() ? 'Carregando...' : 'Fazer Upload' }}
                  </button>
                  <input type="file" #otherInput class="hidden" accept=".pdf,.jpg,.jpeg,.png" (change)="onOtherDocumentSelected($event)">
                </div>

                <div class="text-xs text-gray-500 mb-2">
                  * Apenas um ficheiro por tipo. Para substituir, apague o anterior.
                </div>
              </div>
            </div>

            @if (otherDocsWithoutAlvara.length > 0) {
              <div class="border rounded-lg overflow-hidden">
                <table class="w-full text-sm text-left">
                  <thead class="bg-gray-50 text-gray-700 uppercase text-xs">
                    <tr>
                      <th class="px-4 py-2">Tipo</th>
                      <th class="px-4 py-2">Ficheiro</th>
                      <th class="px-4 py-2 text-right">Acções</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y">
                    @for (doc of otherDocsWithoutAlvara; track doc.id) {
                      <tr>
                        <td class="px-4 py-3 font-medium">{{ doc.type }}</td>
                        <td class="px-4 py-3 text-gray-500">{{ doc.file_name }}</td>
                        <td class="px-4 py-3 text-right">
                          <button type="button" mat-icon-button color="primary" (click)="viewOtherDocument(doc)" matTooltip="Visualizar">
                            <mat-icon>visibility</mat-icon>
                          </button>
                          <button type="button" mat-icon-button color="warn" (click)="removeOtherDocument(doc)" matTooltip="Remover">
                            <mat-icon>delete</mat-icon>
                          </button>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <p class="text-center text-gray-500 py-4 italic">Nenhum documento adicional adicionado.</p>
            }
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
  nuitDocumentUrl = signal<string | null>(this.data.company?.nuit_document_url || null);
  isUploadingNuit = signal(false);
  commercialActivityUrl = signal<string | null>(this.data.company?.commercial_activity_document_url || null);
  isUploadingCommercial = signal(false);

  otherDocuments = signal<CompanyDocument[]>([]);
  isUploadingOther = signal(false);
  isUploadingAlvara = signal(false);
  newDocType = this.fb.control('');

  documentTypes = [
    'Certidão de Registo Comercial',
    'Boletim da República',
    'Documento de Identificação (Sócios)',
    'Contrato de Arrendamento',
    'Outros'
  ];

  provinces = [
    'Maputo', 'Gaza', 'Inhambane', 'Sofala', 'Manica', 'Tete',
    'Zambézia', 'Nampula', 'Niassa', 'Cabo Delgado'
  ];

  activityHierarchy = ACTIVITY_HIERARCHY;

  get alvaraDoc(): CompanyDocument | undefined {
    return this.otherDocuments().find(d => d.type === 'Alvará');
  }
  get otherDocsWithoutAlvara() {
    return this.otherDocuments().filter(doc => doc.type !== 'Alvará');
  }


  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<CompanyDialogComponent>,
    private documentService: DocumentProcessingService,
    private snackBar: MatSnackBar,
    private supabase: SupabaseService,
    @Inject(MAT_DIALOG_DATA) public data: { company?: Company }

  ) {
    this.form = this.fb.group({
      name: [data.company?.name || '', Validators.required],
      entity_type: [data.company?.entity_type || '', Validators.required],
      nuit: [data.company?.nuit || '', [Validators.required]],
      address: [data.company?.address || '', Validators.required],
      phone: [data.company?.phone || ''],
      email: [data.company?.email || '', [Validators.required, Validators.email]],
      business_volume: [(data.company as any)?.business_volume || '3', Validators.required],
      currency: [data.company?.currency || 'MZN'],
      invoice_prefix: [data.company?.invoice_prefix || 'FAC'],
      province: [data.company?.documents_metadata?.province || ''],
      district: [data.company?.documents_metadata?.district || ''],
      administrativePost: [data.company?.documents_metadata?.administrativePost || ''],
      bank_name: [data.company?.bank_name || ''],
      bank_account: [data.company?.bank_account || ''],
      bank_iban: [data.company?.bank_iban || ''],
      bank_swift: [data.company?.bank_swift || ''],
      category1: [data.company?.category1 || ''],
      category2: [data.company?.category2 || ''],
      category3: [data.company?.category3 || '']
    });

    this.setupCategoryWatchers();
    this.loadOtherDocuments();
  }

  async loadOtherDocuments() {
    if (this.data.company?.id) {
      const docs = await this.documentService.getCompanyDocuments(this.data.company.id);
      this.otherDocuments.set(docs);
    }
  }

  setupCategoryWatchers() {
    this.form.get('category1')?.valueChanges.subscribe(() => {
      this.form.patchValue({ category2: '', category3: '' }, { emitEvent: false });
    });

    this.form.get('category2')?.valueChanges.subscribe((cat2) => {
      this.form.patchValue({ category3: '' }, { emitEvent: false });

      if (cat2 === 'servicos_nao_liberais') {
        this.form.patchValue({ business_volume: '12' });
      } else if (cat2 === 'servicos_liberais') {
        this.form.patchValue({ business_volume: '15' });
      } else {
        const currentVol = this.form.get('business_volume')?.value;
        if (currentVol === '12' || currentVol === '15' || currentVol === '20') {
          this.form.patchValue({ business_volume: '3' });
        }
      }
    });
  }

  isISPCScaleActivity() {
    const cat2 = this.form.get('category2')?.value;
    return cat2 !== 'servicos_nao_liberais' && cat2 !== 'servicos_liberais';
  }

  getServiceType(): 'liberal' | 'nao_liberais' | null {
    const cat2 = this.form.get('category2')?.value;
    if (cat2 === 'servicos_nao_liberais') return 'nao_liberais';
    if (cat2 === 'servicos_liberais') return 'liberal';
    return null;
  }

  getCat1Options() {
    return Object.entries(this.activityHierarchy).map(([id, cat]) => ({ id, label: cat.label }));
  }

  getCat2Options() {
    const cat1 = this.form.get('category1')?.value;
    if (!cat1 || !this.activityHierarchy[cat1]?.subcategories) return [];

    return Object.entries(this.activityHierarchy[cat1].subcategories!).map(([id, cat]) => ({
      id,
      label: cat.label
    }));
  }

  getCat3Options() {
    const cat1 = this.form.get('category1')?.value;
    const cat2 = this.form.get('category2')?.value;

    if (!cat1 || !cat2) return [];

    const cat2Obj = (this.activityHierarchy[cat1]?.subcategories as any)?.[cat2];
    if (!cat2Obj || !cat2Obj.subcategories) return [];

    return cat2Obj.subcategories;
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

  async onNuitDocumentSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    this.isUploadingNuit.set(true);

    try {
      const companyId = this.data.company?.id || 'temp';
      const result = await this.documentService.uploadDocument(file, companyId, 'nuit');

      this.nuitDocumentUrl.set(result.url);

      if (result.extractedData) {
        if (result.extractedData.nuit) {
          this.form.patchValue({ nuit: result.extractedData.nuit });
          this.formatNuit();
        }
        if (result.extractedData.tradeName && !this.form.get('name')?.value) {
          this.form.patchValue({ name: result.extractedData.tradeName });
        }
        if (result.extractedData.address && !this.form.get('address')?.value) {
          this.form.patchValue({ address: result.extractedData.address });
        }

        this.snackBar.open('Dados extraídos do documento!', 'Fechar', { duration: 3000 });
      } else {
        this.snackBar.open('Documento carregado com sucesso!', 'Fechar', { duration: 3000 });
      }
    } catch (error: any) {
      console.error('Erro ao subir NUIT:', error);
      this.snackBar.open('Erro ao carregar documento', 'Fechar', { duration: 3000 });
    } finally {
      this.isUploadingNuit.set(false);
      input.value = '';
    }
  }

  async onCommercialDocumentSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    this.isUploadingCommercial.set(true);

    try {
      const companyId = this.data.company?.id || 'temp';
      const result = await this.documentService.uploadDocument(file, companyId, 'commercial_activity');

      this.commercialActivityUrl.set(result.url);

      if (result.extractedData) {
        if (result.extractedData.tradeName && !this.form.get('name')?.value) {
          this.form.patchValue({ name: result.extractedData.tradeName });
        }
        this.snackBar.open('Dados extraídos do documento!', 'Fechar', { duration: 3000 });
      } else {
        this.snackBar.open('Documento carregado com sucesso!', 'Fechar', { duration: 3000 });
      }
    } catch (error: any) {
      console.error('Erro ao subir Exercício de Actividade Comercial:', error);
      this.snackBar.open('Erro ao carregar documento', 'Fechar', { duration: 3000 });
    } finally {
      this.isUploadingCommercial.set(false);
      input.value = '';
    }
  }

  async onOtherDocumentSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const type = this.newDocType.value;

    if (!input.files || input.files.length === 0 || !type) return;

    if (this.isDocTypeSelected(type)) {
      this.snackBar.open(`Já existe um documento do tipo "${type}"`, 'Fechar', { duration: 3000 });
      input.value = '';
      return;
    }

    const file = input.files[0];
    this.isUploadingOther.set(true);

    try {
      const companyId = this.data.company?.id;
      if (!companyId) {
        this.snackBar.open('Salve a empresa primeiro antes de adicionar outros documentos.', 'Fechar', { duration: 3000 });
        return;
      }

      const result = await this.documentService.uploadDocument(file, companyId, 'other' as any);
      const savedDoc = await this.documentService.saveDocument(companyId, type, result.url, file.name);

      if (savedDoc) {
        this.otherDocuments.update(docs => [...docs, savedDoc]);
        this.newDocType.setValue('');
        this.snackBar.open('Documento adicionado com sucesso!', 'Fechar', { duration: 3000 });
      }
    } catch (error: any) {
      console.error('Erro ao subir documento:', error);
      this.snackBar.open('Erro ao carregar documento', 'Fechar', { duration: 3000 });
    } finally {
      this.isUploadingOther.set(false);
      input.value = '';
    }
  }

  async onAlvaraDocumentSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    this.isUploadingAlvara.set(true);

    try {
      const companyId = this.data.company?.id;
      if (!companyId) {
        this.snackBar.open('Salve a empresa primeiro antes de adicionar o Alvará.', 'Fechar', { duration: 3000 });
        return;
      }

      const result = await this.documentService.uploadDocument(file, companyId, 'other' as any);
      const savedDoc = await this.documentService.saveDocument(companyId, 'Alvará', result.url, file.name);

      if (savedDoc) {
        this.otherDocuments.update(docs => [...docs, savedDoc]);
        this.snackBar.open('Alvará carregado com sucesso!', 'Fechar', { duration: 3000 });
      }
    } catch (error: any) {
      console.error('Erro ao subir alvará:', error);
      this.snackBar.open('Erro ao carregar o Alvará', 'Fechar', { duration: 3000 });
    } finally {
      this.isUploadingAlvara.set(false);
      input.value = '';
    }
  }

  isDocTypeSelected(type: string): boolean {
    return this.otherDocuments().some(d => d.type === type);
  }

  async viewOtherDocument(doc: CompanyDocument) {
    const signedUrl = await this.documentService.getSignedUrl(doc.url);
    window.open(signedUrl, '_blank');
  }

  async removeOtherDocument(doc: CompanyDocument) {
    if (confirm(`Tem certeza que deseja remover o documento "${doc.type}"?`)) {
      try {
        await this.documentService.deleteDocument(doc.url);
        await this.documentService.deleteCompanyDocument(doc.id);
        this.otherDocuments.update(docs => docs.filter(d => d.id !== doc.id));
        this.snackBar.open('Documento removido com sucesso!', 'Fechar', { duration: 3000 });
      } catch (error) {
        console.error('Erro ao remover documento:', error);
        this.snackBar.open('Erro ao remover documento', 'Fechar', { duration: 3000 });
      }
    }
  }

  async viewDocument() {
    const url = this.nuitDocumentUrl();
    if (url) {
      const signedUrl = await this.documentService.getSignedUrl(url);
      window.open(signedUrl, '_blank');
    }
  }

  async viewCommercialDocument() {
    const url = this.commercialActivityUrl();
    if (url) {
      const signedUrl = await this.documentService.getSignedUrl(url);
      window.open(signedUrl, '_blank');
    }
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

  async clearCommercialDocument() {
    const url = this.commercialActivityUrl();
    if (!url) return;
    try {
      await this.documentService.deleteDocument(url);

      if (this.data.company?.id) {
        await this.supabase.db
          .from('companies')
          .update({ commercial_activity_document_url: null })
          .eq('id', this.data.company.id);
      }

      this.commercialActivityUrl.set(null);
      this.snackBar.open('Documento removido!', 'Fechar', { duration: 3000 });
    } catch (error) {
      console.error('Erro ao remover documento:', error);
      this.snackBar.open('Erro ao remover documento', 'Fechar', { duration: 3000 });
    }
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
        nuit_document_url: this.nuitDocumentUrl() || undefined,
        commercial_activity_document_url: this.commercialActivityUrl() || undefined,
        documents_metadata: {
          province: formValue.province,
          district: formValue.district,
          administrativePost: formValue.administrativePost
        },
        bank_name: formValue.bank_name,
        bank_account: formValue.bank_account,
        bank_iban: formValue.bank_iban,
        bank_swift: formValue.bank_swift,
        category1: formValue.category1,
        category2: formValue.category2,
        category3: formValue.category3,
        business_volume: formValue.business_volume
      };

      this.dialogRef.close(formData);
    }
  }
}