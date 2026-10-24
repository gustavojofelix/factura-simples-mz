import { Component, Input, Output, EventEmitter, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { DocumentProcessingService, ExtractedCompanyData } from '../../core/services/document-processing.service';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

export interface DocumentUploadData {
  nuit?: { file: File | null; url: string; extractedData: boolean };
  activityStart?: { file: File | null; url: string; extractedData: boolean };
  commercialActivity?: { file: File | null; url: string; extractedData: boolean };
  registrationCertificate?: { file: File | null; url: string; extractedData: boolean };
}

@Component({
  selector: 'app-company-documents',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatChipsModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    TranslatePipe
  ],
  template: `
    <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
      <div class="flex items-start">
        <mat-icon class="text-blue-600 mr-3">cloud_upload</mat-icon>
        <div>
          <h4 class="font-semibold text-blue-900 mb-1">{{ (readOnly ? 'company.documentsUpload.titleReadOnly' : 'company.documentsUpload.titleOptional') | t }}</h4>
          <p class="text-sm text-blue-800">
            @if (!readOnly) {
              {{ 'company.documentsUpload.introUpload' | t }}
            } @else {
              {{ 'company.documentsUpload.introReadOnly' | t }}
            }
          </p>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <mat-card class="!shadow-sm hover:!shadow-md transition-shadow">
        <mat-card-content>
          <div class="flex items-center justify-between mb-3">
            <span class="text-sm font-medium">{{ 'company.documentsUpload.nuit' | t }}</span>
            @if (documents.nuit?.extractedData) {
              <mat-chip class="!bg-green-100 !text-green-800">
                <mat-icon class="!text-base mr-1">check_circle</mat-icon>
                {{ 'company.documentsUpload.dataExtracted' | t }}
              </mat-chip>
            }
          </div>
          @if (!documents.nuit?.file && !documents.nuit?.url) {
            <label class="flex flex-col items-center justify-center h-32 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50"
                   [class.pointer-events-none]="readOnly"
                   [class.opacity-50]="readOnly">
              <mat-icon class="text-gray-400 mb-2">upload_file</mat-icon>
              <span class="text-xs text-gray-600">{{ 'company.documentsUpload.formats' | t }}</span>
              @if (!readOnly) {
                <input type="file" class="hidden" accept=".pdf,.jpg,.jpeg,.png" (change)="onFileSelected($event, 'nuit')">
              }
            </label>
          } @else {
            <div class="flex items-center justify-between bg-gray-50 p-3 rounded">
              <span class="text-sm truncate">{{ documents.nuit?.file?.name || ('company.documentsUpload.uploaded' | t) }}</span>
              @if (!readOnly) {
                <button mat-icon-button (click)="removeDocument('nuit')">
                  <mat-icon class="!text-red-500">close</mat-icon>
                </button>
              }
            </div>
          }
        </mat-card-content>
      </mat-card>

      <mat-card class="!shadow-sm hover:!shadow-md transition-shadow">
        <mat-card-content>
          <div class="flex items-center justify-between mb-3">
            <span class="text-sm font-medium">{{ 'company.documentsUpload.activityStart' | t }}</span>
            @if (documents.activityStart?.extractedData) {
              <mat-chip class="!bg-green-100 !text-green-800">
                <mat-icon class="!text-base mr-1">check_circle</mat-icon>
                {{ 'company.documentsUpload.dataExtracted' | t }}
              </mat-chip>
            }
          </div>
          @if (!documents.activityStart?.file && !documents.activityStart?.url) {
            <label class="flex flex-col items-center justify-center h-32 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50"
                   [class.pointer-events-none]="readOnly"
                   [class.opacity-50]="readOnly">
              <mat-icon class="text-gray-400 mb-2">upload_file</mat-icon>
              <span class="text-xs text-gray-600">{{ 'company.documentsUpload.formats' | t }}</span>
              @if (!readOnly) {
                <input type="file" class="hidden" accept=".pdf,.jpg,.jpeg,.png" (change)="onFileSelected($event, 'activityStart')">
              }
            </label>
          } @else {
            <div class="flex items-center justify-between bg-gray-50 p-3 rounded">
              <span class="text-sm truncate">{{ documents.activityStart?.file?.name || ('company.documentsUpload.uploaded' | t) }}</span>
              @if (!readOnly) {
                <button mat-icon-button (click)="removeDocument('activityStart')">
                  <mat-icon class="!text-red-500">close</mat-icon>
                </button>
              }
            </div>
          }
        </mat-card-content>
      </mat-card>

      <mat-card class="!shadow-sm hover:!shadow-md transition-shadow">
        <mat-card-content>
          <div class="flex items-center justify-between mb-3">
            <span class="text-sm font-medium">{{ 'company.documentsUpload.commercialActivity' | t }}</span>
          </div>
          @if (!documents.commercialActivity?.file && !documents.commercialActivity?.url) {
            <label class="flex flex-col items-center justify-center h-32 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50"
                   [class.pointer-events-none]="readOnly"
                   [class.opacity-50]="readOnly">
              <mat-icon class="text-gray-400 mb-2">upload_file</mat-icon>
              <span class="text-xs text-gray-600">{{ 'company.documentsUpload.formats' | t }}</span>
              @if (!readOnly) {
                <input type="file" class="hidden" accept=".pdf,.jpg,.jpeg,.png" (change)="onFileSelected($event, 'commercialActivity')">
              }
            </label>
          } @else {
            <div class="flex items-center justify-between bg-gray-50 p-3 rounded">
              <span class="text-sm truncate">{{ documents.commercialActivity?.file?.name || ('company.documentsUpload.uploaded' | t) }}</span>
              @if (!readOnly) {
                <button mat-icon-button (click)="removeDocument('commercialActivity')">
                  <mat-icon class="!text-red-500">close</mat-icon>
                </button>
              }
            </div>
          }
        </mat-card-content>
      </mat-card>

      <mat-card class="!shadow-sm hover:!shadow-md transition-shadow">
        <mat-card-content>
          <div class="flex items-center justify-between mb-3">
            <span class="text-sm font-medium">{{ 'company.documentsUpload.registrationCertificate' | t }}</span>
          </div>
          @if (!documents.registrationCertificate?.file && !documents.registrationCertificate?.url) {
            <label class="flex flex-col items-center justify-center h-32 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50"
                   [class.pointer-events-none]="readOnly"
                   [class.opacity-50]="readOnly">
              <mat-icon class="text-gray-400 mb-2">upload_file</mat-icon>
              <span class="text-xs text-gray-600">{{ 'company.documentsUpload.formats' | t }}</span>
              @if (!readOnly) {
                <input type="file" class="hidden" accept=".pdf,.jpg,.jpeg,.png" (change)="onFileSelected($event, 'registrationCertificate')">
              }
            </label>
          } @else {
            <div class="flex items-center justify-between bg-gray-50 p-3 rounded">
              <span class="text-sm truncate">{{ documents.registrationCertificate?.file?.name || ('company.documentsUpload.uploaded' | t) }}</span>
              @if (!readOnly) {
                <button mat-icon-button (click)="removeDocument('registrationCertificate')">
                  <mat-icon class="!text-red-500">close</mat-icon>
                </button>
              }
            </div>
          }
        </mat-card-content>
      </mat-card>
    </div>

    @if (isProcessingDocument()) {
      <div class="flex items-center justify-center py-4 bg-blue-50 rounded-lg mt-4">
        <mat-spinner diameter="24" class="mr-3"></mat-spinner>
        <span class="text-sm text-blue-900">{{ 'company.documentsUpload.processing' | t }}</span>
      </div>
    }
  `
})
export class CompanyDocumentsComponent {
  @Input() companyId: string = '';
  @Input() readOnly: boolean = false;
  @Input() documents: DocumentUploadData = {
    nuit: { file: null, url: '', extractedData: false },
    activityStart: { file: null, url: '', extractedData: false },
    commercialActivity: { file: null, url: '', extractedData: false },
    registrationCertificate: { file: null, url: '', extractedData: false }
  };

  @Output() documentsChange = new EventEmitter<DocumentUploadData>();
  @Output() dataExtracted = new EventEmitter<ExtractedCompanyData>();

  isProcessingDocument = signal(false);

  constructor(
    private documentService: DocumentProcessingService,
    private snackBar: MatSnackBar
  ) { }

  async onFileSelected(event: Event, documentType: 'nuit' | 'activityStart' | 'commercialActivity' | 'registrationCertificate') {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    const maxSize = 10 * 1024 * 1024;

    if (file.size > maxSize) {
      this.snackBar.open(t('company.documentsUpload.fileTooLarge'), t('common.actions.close'), {
        duration: 3000
      });
      return;
    }

    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
    if (!allowedTypes.includes(file.type)) {
      this.snackBar.open(t('company.documentsUpload.typeNotAllowed'), t('common.actions.close'), {
        duration: 3000
      });
      return;
    }

    this.documents[documentType] = { file, url: '', extractedData: false };
    this.documentsChange.emit(this.documents);

    if (documentType === 'nuit' || documentType === 'activityStart') {
      await this.processDocument(file, documentType);
    }
  }

  async processDocument(file: File, documentType: 'nuit' | 'activityStart') {
    this.isProcessingDocument.set(true);

    try {
      const companyId = this.companyId || 'temp';
      const docTypeMap = {
        'nuit': 'nuit' as const,
        'activityStart': 'activity_start' as const
      };

      const result = await this.documentService.uploadDocument(
        file,
        companyId,
        docTypeMap[documentType]
      );

      this.documents[documentType]!.url = result.url;
      this.documents[documentType]!.extractedData = !!result.extractedData;
      this.documentsChange.emit(this.documents);

      if (result.extractedData) {
        this.dataExtracted.emit(result.extractedData);
        this.snackBar.open(t('company.documentsUpload.extractedAuto'), t('common.actions.close'), {
          duration: 3000
        });
      }
    } catch (error: any) {
      console.error('Erro ao processar documento:', error);
      this.snackBar.open(t('company.documentsUpload.processFailed'), t('common.actions.close'), {
        duration: 4000
      });
    } finally {
      this.isProcessingDocument.set(false);
    }
  }

  removeDocument(documentType: 'nuit' | 'activityStart' | 'commercialActivity' | 'registrationCertificate') {
    this.documents[documentType] = { file: null, url: '', extractedData: false };
    this.documentsChange.emit(this.documents);
  }
}
