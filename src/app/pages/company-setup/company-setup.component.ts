import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormControl } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatStepperModule } from '@angular/material/stepper';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { AuthService } from '../../core/services/auth.service';
import { nuitValidator } from '../../core/validators/nuit.validator';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DocumentProcessingService } from '../../core/services/document-processing.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { ACTIVITY_HIERARCHY } from '../../core/constants/activity-categories';
import { CompanyDocument } from '../../core/services/document-processing.service';


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
  settingsForm: FormGroup;
  isLoading = signal(false);
  nuitDocumentUrl = signal<string | null>(null);
  isUploadingNuit = signal(false);
  commercialActivityUrl = signal<string | null>(null);
  isUploadingCommercial = signal(false);
  
  otherDocuments = signal<Partial<CompanyDocument>[]>([]);
  isUploadingOther = signal(false);
  newDocType = new FormControl('');

  documentTypes = [
    'Alvará',
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
      entityType: ['', Validators.required],
      email: ['', [Validators.email]],
      phone: [''],
      nuit: ['', [Validators.required, nuitValidator()]],
      address: ['', Validators.required],
      province: [''],
      district: [''],
      administrativePost: [''],
      category1: [''],
      category2: [''],
      category3: [''],
      business_volume: ['3', Validators.required]
    });


    this.settingsForm = this.fb.group({
      currency: ['MZN'],
      invoicePrefix: ['FAC', [Validators.required, Validators.maxLength(10)]]
    });

    this.setupCategoryWatchers();
  }

  setupCategoryWatchers() {
    this.companyInfoForm.get('category1')?.valueChanges.subscribe(() => {
      this.companyInfoForm.patchValue({ category2: '', category3: '' }, { emitEvent: false });
    });

    this.companyInfoForm.get('category2')?.valueChanges.subscribe((cat2) => {
      this.companyInfoForm.patchValue({ category3: '' }, { emitEvent: false });
      
      if (cat2 === 'servicos_nao_liberais') {
        this.companyInfoForm.patchValue({ business_volume: '12' });
      } else if (cat2 === 'servicos_liberais') {
        this.companyInfoForm.patchValue({ business_volume: '15' });
      } else {
        const currentVol = this.companyInfoForm.get('business_volume')?.value;
        if (currentVol === '12' || currentVol === '15' || currentVol === '20') {
          this.companyInfoForm.patchValue({ business_volume: '3' });
        }
      }
    });
  }

  getServiceType(): 'liberal' | 'nao_liberais' | null {
    const cat2 = this.companyInfoForm.get('category2')?.value;
    if (cat2 === 'servicos_nao_liberais') return 'nao_liberais';
    if (cat2 === 'servicos_liberais') return 'liberal';
    return null;
  }

  isISPCScaleActivity() {
    const cat2 = this.companyInfoForm.get('category2')?.value;
    return cat2 !== 'servicos_nao_liberais' && cat2 !== 'servicos_liberais';
  }

  getCat1Options() {
    return Object.entries(this.activityHierarchy).map(([id, cat]) => ({ id, label: cat.label }));
  }

  getCat2Options() {
    const cat1 = this.companyInfoForm.get('category1')?.value;
    if (!cat1 || !this.activityHierarchy[cat1]?.subcategories) return [];
    
    return Object.entries(this.activityHierarchy[cat1].subcategories!).map(([id, cat]) => ({ 
      id, 
      label: cat.label 
    }));
  }

  getCat3Options() {
    const cat1 = this.companyInfoForm.get('category1')?.value;
    const cat2 = this.companyInfoForm.get('category2')?.value;
    
    if (!cat1 || !cat2) return [];
    
    const cat2Obj = (this.activityHierarchy[cat1]?.subcategories as any)?.[cat2];
    if (!cat2Obj || !cat2Obj.subcategories) return [];
    
    return cat2Obj.subcategories;
  }

  async onNuitDocumentSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    this.isUploadingNuit.set(true);

    try {
      const result = await this.documentService.uploadDocument(file, 'temp', 'nuit');
      this.nuitDocumentUrl.set(result.url);
      
      if (result.extractedData) {
        if (result.extractedData.nuit) {
          this.companyInfoForm.patchValue({ nuit: result.extractedData.nuit });
          this.formatNuit();
        }
        if (result.extractedData.tradeName && !this.companyInfoForm.get('name')?.value) {
          this.companyInfoForm.patchValue({ name: result.extractedData.tradeName });
        }
        if (result.extractedData.address && !this.companyInfoForm.get('address')?.value) {
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
      const result = await this.documentService.uploadDocument(file, 'temp', 'commercial_activity');
      this.commercialActivityUrl.set(result.url);

      if (result.extractedData) {
        if (result.extractedData.tradeName && !this.companyInfoForm.get('name')?.value) {
          this.companyInfoForm.patchValue({ name: result.extractedData.tradeName });
        }
        if (result.extractedData.address && !this.companyInfoForm.get('address')?.value) {
          this.companyInfoForm.patchValue({ address: result.extractedData.address });
        }
        if (result.extractedData.province && !this.companyInfoForm.get('province')?.value) {
          this.companyInfoForm.patchValue({ province: result.extractedData.province });
        }
        if (result.extractedData.district && !this.companyInfoForm.get('district')?.value) {
          this.companyInfoForm.patchValue({ district: result.extractedData.district });
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
      const result = await this.documentService.uploadDocument(file, 'temp', 'other' as any);
      
      this.otherDocuments.update(docs => [...docs, {
        type,
        url: result.url,
        file_name: file.name
      }]);
      
      this.newDocType.setValue('');
      this.snackBar.open('Documento adicionado à lista!', 'Fechar', { duration: 3000 });
    } catch (error: any) {
      console.error('Erro ao subir documento:', error);
      this.snackBar.open('Erro ao carregar documento', 'Fechar', { duration: 3000 });
    } finally {
      this.isUploadingOther.set(false);
      input.value = '';
    }
  }

  isDocTypeSelected(type: string): boolean {
    return this.otherDocuments().some(d => d.type === type);
  }

  async viewOtherDocument(doc: Partial<CompanyDocument>) {
    if (doc.url) {
      const signedUrl = await this.documentService.getSignedUrl(doc.url);
      window.open(signedUrl, '_blank');
    }
  }

  async removeOtherDocument(doc: Partial<CompanyDocument>) {
    try {
      if (doc.url) {
        await this.documentService.deleteDocument(doc.url);
      }
      this.otherDocuments.update(docs => docs.filter(d => d !== doc));
      this.snackBar.open('Documento removido da lista!', 'Fechar', { duration: 3000 });
    } catch (error) {
      console.error('Erro ao remover documento:', error);
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
    const nuitControl = this.companyInfoForm.get('nuit');
    if (!nuitControl) return;

    let value = nuitControl.value.replace(/\D/g, '');
    if (value.length > 9) {
      value = value.substring(0, 9);
    }
    nuitControl.setValue(value, { emitEvent: false });
  }

  async onSubmit() {
    if (this.companyInfoForm.invalid || this.settingsForm.invalid) {
      this.snackBar.open('Por favor, preencha todos os campos obrigatórios', 'Fechar', {
        duration: 3000,
        panelClass: ['error-snackbar']
      });
      return;
    }

    this.isLoading.set(true);

    const user = (await this.supabase.auth.getUser()).data.user;
    if (!user) {
      this.snackBar.open('Utilizador não autenticado', 'Fechar', {
        duration: 3000,
        panelClass: ['error-snackbar']
      });
      this.isLoading.set(false);
      return;
    }

    const companyData = {
      user_id: user.id,
      name: this.companyInfoForm.value.name,
      entity_type: this.companyInfoForm.value.entityType,
      email: this.companyInfoForm.value.email,
      phone: this.companyInfoForm.value.phone,
      nuit: this.companyInfoForm.value.nuit,
      address: this.companyInfoForm.value.address,
      currency: this.settingsForm.value.currency,
      invoice_prefix: this.settingsForm.value.invoicePrefix,
      invoice_number: 1,
      nuit_document_url: this.nuitDocumentUrl() || undefined,
      commercial_activity_document_url: this.commercialActivityUrl() || undefined,
      category1: this.companyInfoForm.value.category1,
      category2: this.companyInfoForm.value.category2,
      category3: this.companyInfoForm.value.category3,
      business_volume: this.companyInfoForm.value.business_volume,
      documents_metadata: {
        province: this.companyInfoForm.value.province,
        district: this.companyInfoForm.value.district,
        administrativePost: this.companyInfoForm.value.administrativePost
      }
    };

    try {
      const { data, error } = await this.supabase.db
        .from('companies')
        .insert(companyData)
        .select()
        .single();

      if (error) throw error;

      // 2. Salvar documentos adicionais se existirem
      if (this.otherDocuments().length > 0) {
        const docPromises = this.otherDocuments().map(doc => 
          this.documentService.saveDocument(data.id, doc.type!, doc.url!, doc.file_name!)
        );
        await Promise.all(docPromises);
      }

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
