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
import { AuthService } from '../../core/services/auth.service';
import { SupabaseService } from '../../core/services/supabase.service';

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
    MatSnackBarModule
  ],
  templateUrl: './company-setup.component.html',
  styleUrls: ['./company-setup.component.css']
})
export class CompanySetupComponent {
  companyInfoForm: FormGroup;
  businessTypeForm: FormGroup;
  settingsForm: FormGroup;
  isLoading = signal(false);

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

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private supabase: SupabaseService,
    private router: Router,
    private snackBar: MatSnackBar
  ) {
    this.companyInfoForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(3)]],
      nuit: ['', [Validators.required, Validators.pattern(/^\d{9}$/)]],
      address: ['', Validators.required]
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

    const companyData = {
      user_id: user.id,
      name: this.companyInfoForm.value.name,
      nuit: this.companyInfoForm.value.nuit,
      address: this.companyInfoForm.value.address,
      business_type: this.businessTypeForm.value.businessType,
      currency: this.settingsForm.value.currency,
      invoice_prefix: this.settingsForm.value.invoicePrefix,
      invoice_number: 1
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
    if (control.hasError('pattern') && field === 'nuit') {
      return 'NUIT deve ter 9 dígitos';
    }
    return '';
  }
}
