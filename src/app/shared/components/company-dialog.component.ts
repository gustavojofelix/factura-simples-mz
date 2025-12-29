import { Component, Inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { Company } from '../../core/services/company.service';
import { DocumentProcessingService } from '../../core/services/document-processing.service';

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
    MatCardModule,
    MatIconModule,
    MatChipsModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTabsModule
  ],
  template: `
    <h2 mat-dialog-title>{{ data.company ? 'Editar Empresa' : 'Nova Empresa' }}</h2>
    <mat-dialog-content>
      <mat-tab-group>
        <mat-tab label="Documentos">
          <div class="pt-4 space-y-4">
            <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div class="flex items-start">
                <mat-icon class="text-blue-600 mr-3">cloud_upload</mat-icon>
                <div>
                  <h4 class="font-semibold text-blue-900 mb-1">Upload de Documentos</h4>
                  <p class="text-sm text-blue-800">
                    Faça upload dos documentos e preencheremos automaticamente os campos!
                  </p>
                </div>
              </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <mat-card class="!shadow-sm hover:!shadow-md transition-shadow">
                <mat-card-content>
                  <div class="flex items-center justify-between mb-3">
                    <span class="text-sm font-medium">Comunicação NUIT</span>
                    @if (uploadedDocuments().nuit.extractedData) {
                      <mat-chip class="!bg-green-100 !text-green-800">
                        <mat-icon class="!text-base mr-1">check_circle</mat-icon>
                        Dados extraídos
                      </mat-chip>
                    }
                  </div>
                  @if (!uploadedDocuments().nuit.file && !uploadedDocuments().nuit.url) {
                    <label class="flex flex-col items-center justify-center h-32 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50">
                      <mat-icon class="text-gray-400 mb-2">upload_file</mat-icon>
                      <span class="text-xs text-gray-600">PDF, JPG ou PNG</span>
                      <input type="file" class="hidden" accept=".pdf,.jpg,.jpeg,.png" (change)="onFileSelected($event, 'nuit')">
                    </label>
                  } @else {
                    <div class="flex items-center justify-between bg-gray-50 p-3 rounded">
                      <span class="text-sm truncate">{{ uploadedDocuments().nuit.file?.name || 'Documento carregado' }}</span>
                      <button mat-icon-button (click)="removeDocument('nuit')">
                        <mat-icon class="!text-red-500">close</mat-icon>
                      </button>
                    </div>
                  }
                </mat-card-content>
              </mat-card>

              <mat-card class="!shadow-sm hover:!shadow-md transition-shadow">
                <mat-card-content>
                  <div class="flex items-center justify-between mb-3">
                    <span class="text-sm font-medium">Comunicado Início Atividades</span>
                    @if (uploadedDocuments().activityStart.extractedData) {
                      <mat-chip class="!bg-green-100 !text-green-800">
                        <mat-icon class="!text-base mr-1">check_circle</mat-icon>
                        Dados extraídos
                      </mat-chip>
                    }
                  </div>
                  @if (!uploadedDocuments().activityStart.file && !uploadedDocuments().activityStart.url) {
                    <label class="flex flex-col items-center justify-center h-32 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50">
                      <mat-icon class="text-gray-400 mb-2">upload_file</mat-icon>
                      <span class="text-xs text-gray-600">PDF, JPG ou PNG</span>
                      <input type="file" class="hidden" accept=".pdf,.jpg,.jpeg,.png" (change)="onFileSelected($event, 'activityStart')">
                    </label>
                  } @else {
                    <div class="flex items-center justify-between bg-gray-50 p-3 rounded">
                      <span class="text-sm truncate">{{ uploadedDocuments().activityStart.file?.name || 'Documento carregado' }}</span>
                      <button mat-icon-button (click)="removeDocument('activityStart')">
                        <mat-icon class="!text-red-500">close</mat-icon>
                      </button>
                    </div>
                  }
                </mat-card-content>
              </mat-card>

              <mat-card class="!shadow-sm hover:!shadow-md transition-shadow">
                <mat-card-content>
                  <div class="flex items-center justify-between mb-3">
                    <span class="text-sm font-medium">Exercício Atividade Comercial</span>
                  </div>
                  @if (!uploadedDocuments().commercialActivity.file && !uploadedDocuments().commercialActivity.url) {
                    <label class="flex flex-col items-center justify-center h-32 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50">
                      <mat-icon class="text-gray-400 mb-2">upload_file</mat-icon>
                      <span class="text-xs text-gray-600">PDF, JPG ou PNG</span>
                      <input type="file" class="hidden" accept=".pdf,.jpg,.jpeg,.png" (change)="onFileSelected($event, 'commercialActivity')">
                    </label>
                  } @else {
                    <div class="flex items-center justify-between bg-gray-50 p-3 rounded">
                      <span class="text-sm truncate">{{ uploadedDocuments().commercialActivity.file?.name || 'Documento carregado' }}</span>
                      <button mat-icon-button (click)="removeDocument('commercialActivity')">
                        <mat-icon class="!text-red-500">close</mat-icon>
                      </button>
                    </div>
                  }
                </mat-card-content>
              </mat-card>

              <mat-card class="!shadow-sm hover:!shadow-md transition-shadow">
                <mat-card-content>
                  <div class="flex items-center justify-between mb-3">
                    <span class="text-sm font-medium">Certificado Registo Definitivo</span>
                  </div>
                  @if (!uploadedDocuments().registrationCertificate.file && !uploadedDocuments().registrationCertificate.url) {
                    <label class="flex flex-col items-center justify-center h-32 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50">
                      <mat-icon class="text-gray-400 mb-2">upload_file</mat-icon>
                      <span class="text-xs text-gray-600">PDF, JPG ou PNG</span>
                      <input type="file" class="hidden" accept=".pdf,.jpg,.jpeg,.png" (change)="onFileSelected($event, 'registrationCertificate')">
                    </label>
                  } @else {
                    <div class="flex items-center justify-between bg-gray-50 p-3 rounded">
                      <span class="text-sm truncate">{{ uploadedDocuments().registrationCertificate.file?.name || 'Documento carregado' }}</span>
                      <button mat-icon-button (click)="removeDocument('registrationCertificate')">
                        <mat-icon class="!text-red-500">close</mat-icon>
                      </button>
                    </div>
                  }
                </mat-card-content>
              </mat-card>
            </div>

            @if (isProcessingDocument()) {
              <div class="flex items-center justify-center py-4 bg-blue-50 rounded-lg">
                <mat-spinner diameter="24" class="mr-3"></mat-spinner>
                <span class="text-sm text-blue-900">Processando documento e extraindo dados...</span>
              </div>
            }
          </div>
        </mat-tab>

        <mat-tab label="Informações Básicas">
          <form [formGroup]="form" class="space-y-4 pt-4">
            <mat-form-field appearance="outline" class="w-full">
              <mat-label>Nome da Empresa</mat-label>
              <input matInput formControlName="name" required>
              <mat-error *ngIf="form.get('name')?.hasError('required')">
                Nome é obrigatório
              </mat-error>
            </mat-form-field>

            <mat-form-field appearance="outline" class="w-full">
              <mat-label>NUIT</mat-label>
              <input matInput formControlName="nuit" required>
              <mat-error *ngIf="form.get('nuit')?.hasError('required')">
                NUIT é obrigatório
              </mat-error>
            </mat-form-field>

            <mat-form-field appearance="outline" class="w-full">
              <mat-label>Endereço</mat-label>
              <textarea matInput formControlName="address" rows="2"></textarea>
            </mat-form-field>

            <div class="grid grid-cols-2 gap-4">
              <mat-form-field appearance="outline" class="w-full">
                <mat-label>Telefone</mat-label>
                <input matInput formControlName="phone">
              </mat-form-field>

              <mat-form-field appearance="outline" class="w-full">
                <mat-label>Email</mat-label>
                <input matInput type="email" formControlName="email">
                <mat-error *ngIf="form.get('email')?.hasError('email')">
                  Email inválido
                </mat-error>
              </mat-form-field>
            </div>

            <div class="grid grid-cols-2 gap-4">
              <mat-form-field appearance="outline" class="w-full">
                <mat-label>Província</mat-label>
                <mat-select formControlName="province">
                  @for (province of provinces; track province) {
                    <mat-option [value]="province">{{ province }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>

              <mat-form-field appearance="outline" class="w-full">
                <mat-label>Distrito</mat-label>
                <input matInput formControlName="district">
              </mat-form-field>
            </div>

            <div class="grid grid-cols-2 gap-4">
              <mat-form-field appearance="outline" class="w-full">
                <mat-label>Posto Administrativo</mat-label>
                <input matInput formControlName="administrativePost">
              </mat-form-field>

              <mat-form-field appearance="outline" class="w-full">
                <mat-label>Actividade Principal</mat-label>
                <input matInput formControlName="mainActivity">
              </mat-form-field>
            </div>

            <mat-form-field appearance="outline" class="w-full">
              <mat-label>Tipo de Negócio</mat-label>
              <input matInput formControlName="business_type">
            </mat-form-field>

            <div class="grid grid-cols-2 gap-4">
              <mat-form-field appearance="outline" class="w-full">
                <mat-label>Moeda</mat-label>
                <mat-select formControlName="currency">
                  <mat-option value="MZN">Metical (MZN)</mat-option>
                  <mat-option value="USD">Dólar (USD)</mat-option>
                  <mat-option value="EUR">Euro (EUR)</mat-option>
                </mat-select>
              </mat-form-field>

              <mat-form-field appearance="outline" class="w-full">
                <mat-label>Prefixo de Fatura</mat-label>
                <input matInput formControlName="invoice_prefix">
              </mat-form-field>
            </div>
          </form>
        </mat-tab>
      </mat-tab-group>
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
  isProcessingDocument = signal(false);

  uploadedDocuments = signal({
    nuit: { file: null as File | null, url: '', extractedData: false },
    activityStart: { file: null as File | null, url: '', extractedData: false },
    commercialActivity: { file: null as File | null, url: '', extractedData: false },
    registrationCertificate: { file: null as File | null, url: '', extractedData: false }
  });

  provinces = [
    'Maputo', 'Gaza', 'Inhambane', 'Sofala', 'Manica', 'Tete',
    'Zambézia', 'Nampula', 'Niassa', 'Cabo Delgado'
  ];

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<CompanyDialogComponent>,
    private documentService: DocumentProcessingService,
    private snackBar: MatSnackBar,
    @Inject(MAT_DIALOG_DATA) public data: { company?: Company }
  ) {
    const metadata = data.company?.documents_metadata as any || {};

    this.form = this.fb.group({
      name: [data.company?.name || '', Validators.required],
      nuit: [data.company?.nuit || '', Validators.required],
      address: [data.company?.address || ''],
      phone: [data.company?.phone || ''],
      email: [data.company?.email || '', Validators.email],
      business_type: [data.company?.business_type || ''],
      currency: [data.company?.currency || 'MZN'],
      invoice_prefix: [data.company?.invoice_prefix || 'FAC'],
      province: [metadata.province || ''],
      district: [metadata.district || ''],
      administrativePost: [metadata.administrativePost || ''],
      mainActivity: [metadata.mainActivity || '']
    });

    if (data.company) {
      const docs = this.uploadedDocuments();
      if (data.company.nuit_document_url) {
        docs.nuit.url = data.company.nuit_document_url;
      }
      if (data.company.activity_start_document_url) {
        docs.activityStart.url = data.company.activity_start_document_url;
      }
      if (data.company.commercial_activity_document_url) {
        docs.commercialActivity.url = data.company.commercial_activity_document_url;
      }
      if (data.company.registration_certificate_url) {
        docs.registrationCertificate.url = data.company.registration_certificate_url;
      }
      this.uploadedDocuments.set(docs);
    }
  }

  async onFileSelected(event: Event, documentType: 'nuit' | 'activityStart' | 'commercialActivity' | 'registrationCertificate') {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    const maxSize = 10 * 1024 * 1024;

    if (file.size > maxSize) {
      this.snackBar.open('Arquivo muito grande. Máximo: 10MB', 'Fechar', {
        duration: 3000
      });
      return;
    }

    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
    if (!allowedTypes.includes(file.type)) {
      this.snackBar.open('Apenas PDF, JPG e PNG são permitidos', 'Fechar', {
        duration: 3000
      });
      return;
    }

    const docs = this.uploadedDocuments();
    const docKey = documentType === 'activityStart' ? 'activityStart' :
                   documentType === 'commercialActivity' ? 'commercialActivity' :
                   documentType === 'registrationCertificate' ? 'registrationCertificate' : 'nuit';

    docs[docKey].file = file;
    this.uploadedDocuments.set(docs);

    if (documentType === 'nuit' || documentType === 'activityStart') {
      await this.processDocument(file, documentType);
    }
  }

  async processDocument(file: File, documentType: 'nuit' | 'activityStart') {
    this.isProcessingDocument.set(true);

    try {
      const companyId = this.data.company?.id || 'temp';
      const docTypeMap = {
        'nuit': 'nuit' as const,
        'activityStart': 'activity_start' as const
      };

      const result = await this.documentService.uploadDocument(
        file,
        companyId,
        docTypeMap[documentType]
      );

      const docs = this.uploadedDocuments();
      const docKey = documentType === 'activityStart' ? 'activityStart' : 'nuit';
      docs[docKey].url = result.url;
      docs[docKey].extractedData = !!result.extractedData;
      this.uploadedDocuments.set(docs);

      if (result.extractedData) {
        if (result.extractedData.nuit) {
          this.form.patchValue({ nuit: result.extractedData.nuit });
        }
        if (result.extractedData.tradeName) {
          this.form.patchValue({ name: result.extractedData.tradeName });
        }
        if (result.extractedData.address) {
          this.form.patchValue({ address: result.extractedData.address });
        }
        if (result.extractedData.province) {
          this.form.patchValue({ province: result.extractedData.province });
        }
        if (result.extractedData.district) {
          this.form.patchValue({ district: result.extractedData.district });
        }
        if (result.extractedData.administrativePost) {
          this.form.patchValue({ administrativePost: result.extractedData.administrativePost });
        }
        if (result.extractedData.mainActivity) {
          this.form.patchValue({ mainActivity: result.extractedData.mainActivity });
        }

        this.snackBar.open('Dados extraídos automaticamente!', 'Fechar', {
          duration: 3000
        });
      }
    } catch (error: any) {
      console.error('Erro ao processar documento:', error);
      this.snackBar.open('Erro ao processar documento. Preencha manualmente.', 'Fechar', {
        duration: 4000
      });
    } finally {
      this.isProcessingDocument.set(false);
    }
  }

  removeDocument(documentType: 'nuit' | 'activityStart' | 'commercialActivity' | 'registrationCertificate') {
    const docs = this.uploadedDocuments();
    const docKey = documentType === 'activityStart' ? 'activityStart' :
                   documentType === 'commercialActivity' ? 'commercialActivity' :
                   documentType === 'registrationCertificate' ? 'registrationCertificate' : 'nuit';

    docs[docKey].file = null;
    docs[docKey].url = '';
    docs[docKey].extractedData = false;
    this.uploadedDocuments.set(docs);
  }

  onCancel(): void {
    this.dialogRef.close();
  }

  onSave(): void {
    if (this.form.valid) {
      const docs = this.uploadedDocuments();
      const formData = {
        ...this.form.value,
        nuit_document_url: docs.nuit.url || null,
        activity_start_document_url: docs.activityStart.url || null,
        commercial_activity_document_url: docs.commercialActivity.url || null,
        registration_certificate_url: docs.registrationCertificate.url || null,
        documents_metadata: {
          province: this.form.value.province,
          district: this.form.value.district,
          administrativePost: this.form.value.administrativePost,
          mainActivity: this.form.value.mainActivity
        }
      };
      this.dialogRef.close(formData);
    }
  }
}
