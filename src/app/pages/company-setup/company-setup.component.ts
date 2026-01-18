import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatStepperModule } from '@angular/material/stepper';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { AuthService } from '../../core/services/auth.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { DocumentProcessingService } from '../../core/services/document-processing.service';
import { nuitValidator } from '../../core/validators/nuit.validator';

@Component({
  selector: 'app-company-setup',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatStepperModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatCardModule,
    MatChipsModule
  ],
  templateUrl: './company-setup.component.html',
  styleUrls: ['./company-setup.component.css']
})
export class CompanySetupComponent {
  companyInfoForm: FormGroup;
  businessTypeForm: FormGroup;
  settingsForm: FormGroup;
  isLoading = signal(false);
  isProcessingDocument = signal(false);

  uploadedDocuments = signal({
    nuit: { file: null as File | null, url: '', extractedData: false },
    activityStart: { file: null as File | null, url: '', extractedData: false },
    commercialActivity: { file: null as File | null, url: '', extractedData: false },
    registrationCertificate: { file: null as File | null, url: '', extractedData: false }
  });

  businessTypes = [
    { value: 'servicos_consultoria', label: 'Serviços de Consultoria' },
    { value: 'comercio_geral', label: 'Comércio Geral' },
    { value: 'restauracao', label: 'Restauração e Hotelaria' },
    { value: 'construcao', label: 'Construção Civil' },
    { value: 'tecnologia', label: 'Tecnologia e Software' },
    { value: 'saude', label: 'Saúde e Bem-estar' },
    { value: 'educacao', label: 'Educação e Formação' },
    { value: 'agricultura', label: 'Agricultura e Pecuária' },
    { value: 'transporte', label: 'Transporte e Logística' },
    { value: 'outro', label: 'Outro' }
  ];

  provinces = [
    'Maputo', 'Gaza', 'Inhambane', 'Sofala', 'Manica', 'Tete',
    'Zambézia', 'Nampula', 'Niassa', 'Cabo Delgado'
  ];

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private supabase: SupabaseService,
    private router: Router,
    private snackBar: MatSnackBar,
    private documentService: DocumentProcessingService
  ) {
    this.companyInfoForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(3)]],
      nuit: ['', [Validators.required, nuitValidator()]],
      address: ['', Validators.required],
      province: [''],
      district: [''],
      administrativePost: [''],
      mainActivity: ['']
    });

    this.businessTypeForm = this.fb.group({
      businessType: ['', Validators.required]
    });

    this.settingsForm = this.fb.group({
      currency: ['MZN'],
      invoicePrefix: ['FAC', [Validators.required, Validators.maxLength(10)]]
    });
  }

  formatNuit() {
    const nuitControl = this.companyInfoForm.get('nuit');
    if (!nuitControl) return;

    let value = nuitControl.value.replace(/\D/g, '');
    if (value.length > 9) {
      value = value.substring(0, 9);
    }
    nuitControl.setValue(value, { emitEvent: false });
  }

  async onFileSelected(event: Event, documentType: 'nuit' | 'activityStart' | 'commercialActivity' | 'registrationCertificate') {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    const maxSize = 10 * 1024 * 1024;

    if (file.size > maxSize) {
      this.snackBar.open('Arquivo muito grande. Máximo: 10MB', 'Fechar', {
        duration: 3000,
        panelClass: ['error-snackbar']
      });
      return;
    }

    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
    if (!allowedTypes.includes(file.type)) {
      this.snackBar.open('Apenas PDF, JPG e PNG são permitidos', 'Fechar', {
        duration: 3000,
        panelClass: ['error-snackbar']
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
      const companyId = 'temp';
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
          this.companyInfoForm.patchValue({ nuit: result.extractedData.nuit });
        }
        if (result.extractedData.tradeName) {
          this.companyInfoForm.patchValue({ name: result.extractedData.tradeName });
        }
        if (result.extractedData.address) {
          this.companyInfoForm.patchValue({ address: result.extractedData.address });
        }
        if (result.extractedData.province) {
          this.companyInfoForm.patchValue({ province: result.extractedData.province });
        }
        if (result.extractedData.district) {
          this.companyInfoForm.patchValue({ district: result.extractedData.district });
        }
        if (result.extractedData.administrativePost) {
          this.companyInfoForm.patchValue({ administrativePost: result.extractedData.administrativePost });
        }
        if (result.extractedData.mainActivity) {
          this.companyInfoForm.patchValue({ mainActivity: result.extractedData.mainActivity });
        }

        this.snackBar.open('Dados extraídos automaticamente!', 'Fechar', {
          duration: 3000,
          panelClass: ['success-snackbar']
        });
      }
    } catch (error: any) {
      console.error('Erro ao processar documento:', error);
      this.snackBar.open('Erro ao processar documento. Preencha manualmente.', 'Fechar', {
        duration: 4000,
        panelClass: ['error-snackbar']
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

  async onSubmit() {
    if (this.companyInfoForm.invalid || this.businessTypeForm.invalid || this.settingsForm.invalid) {
      this.snackBar.open('Por favor, preencha todos os campos obrigatórios', 'Fechar', {
        duration: 3000,
        panelClass: ['error-snackbar']
      });
      return;
    }

    this.isLoading.set(true);

    const user = this.authService.currentUser();
    if (!user) {
      this.snackBar.open('Utilizador não autenticado', 'Fechar', {
        duration: 3000,
        panelClass: ['error-snackbar']
      });
      this.isLoading.set(false);
      return;
    }

    const docs = this.uploadedDocuments();
    const companyData = {
      user_id: user.id,
      name: this.companyInfoForm.value.name,
      nuit: this.companyInfoForm.value.nuit,
      address: this.companyInfoForm.value.address,
      business_type: this.businessTypeForm.value.businessType,
      currency: this.settingsForm.value.currency,
      invoice_prefix: this.settingsForm.value.invoicePrefix,
      invoice_number: 1,
      nuit_document_url: docs.nuit.url || null,
      activity_start_document_url: docs.activityStart.url || null,
      commercial_activity_document_url: docs.commercialActivity.url || null,
      registration_certificate_url: docs.registrationCertificate.url || null,
      documents_metadata: {
        province: this.companyInfoForm.value.province,
        district: this.companyInfoForm.value.district,
        administrativePost: this.companyInfoForm.value.administrativePost,
        mainActivity: this.companyInfoForm.value.mainActivity
      }
    };

    try {
      const { data, error } = await this.supabase.db
        .from('companies')
        .insert(companyData)
        .select()
        .single();

      if (error) throw error;

      this.snackBar.open('Empresa configurada com sucesso!', 'Fechar', {
        duration: 3000,
        panelClass: ['success-snackbar']
      });

      this.router.navigate(['/painel']);
    } catch (error: any) {
      console.error('Erro ao criar empresa:', error);
      this.snackBar.open(error.message || 'Erro ao configurar empresa', 'Fechar', {
        duration: 5000,
        panelClass: ['error-snackbar']
      });
    } finally {
      this.isLoading.set(false);
    }
  }

  getErrorMessage(form: FormGroup, field: string): string {
    const control = form.get(field);
    if (!control || !control.touched) return '';

    if (control.hasError('required')) {
      return 'Este campo é obrigatório';
    }
    if (control.hasError('minlength')) {
      const minLength = control.getError('minlength').requiredLength;
      return `Mínimo de ${minLength} caracteres`;
    }
    if (control.hasError('maxlength')) {
      const maxLength = control.getError('maxlength').requiredLength;
      return `Máximo de ${maxLength} caracteres`;
    }
    if (control.hasError('nuit')) {
      return control.getError('nuit');
    }
    if (control.hasError('pattern') && field === 'nuit') {
      return 'NUIT deve ter 9 dígitos';
    }
    return '';
  }
}
