import { Component, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { User } from '@supabase/supabase-js';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatCardModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    TranslatePipe
  ],
  templateUrl: './profile.component.html'
})
export class ProfileComponent {
  profileForm: FormGroup;
  isLoading = signal(false);  // ← false, não true
  isSaving = signal(false);
  isEditing = signal(false);
  hideCurrentPassword = signal(true);
  hidePassword = signal(true);
  hideConfirmPassword = signal(true);

  // Armazena os dados originais para poder cancelar
  private originalData: any = {};

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private snackBar: MatSnackBar
  ) {
    // Todos os campos começam desabilitados
    this.profileForm = this.fb.group({
      fullName: [{ value: '', disabled: true }, [Validators.required, Validators.minLength(3)]],
      email: [{ value: '', disabled: true }, [Validators.required, Validators.email]],
      phone: [{ value: '', disabled: true }, [Validators.pattern(/^\+?258\s?\d{2}\s?\d{3}\s?\d{4}$/)]],
      currentPassword: [{ value: '', disabled: true }],
      password: [{ value: '', disabled: true }, [Validators.minLength(6)]],
      confirmPassword: [{ value: '', disabled: true }]
    }, {
      validators: this.passwordMatchValidator
    });

    // effect fora da inicialização do form
    effect(() => {
      const user = this.authService.currentUser();
      if (user) {
        this.loadUserData(user);
      }
    });
  }

  private async loadUserData(user: User) {
    this.isLoading.set(true);
    try {
      await this.authService.waitForInitialization();
      const profile = await this.authService.getCurrentProfile();

      if (profile) {
        this.originalData = {
          fullName: profile.full_name || '',
          email: profile.email || user.email || '',
          phone: profile.phone || ''
        };
      } else {
        this.originalData = { email: user.email || '' };
      }

      this.profileForm.patchValue(this.originalData);
      // console.log('Dados carregados:', { user: !!user, profile: !!profile });
    } catch (error) {
      console.error('Erro ao carregar perfil:', error);
    } finally {
      this.isLoading.set(false); // ← spinner desaparece aqui
    }
  }

  toggleEditMode() {
    this.isEditing.set(true);
    this.profileForm.get('fullName')?.enable();
    this.profileForm.get('phone')?.enable();
    this.profileForm.get('currentPassword')?.enable();
    this.profileForm.get('password')?.enable();
    this.profileForm.get('confirmPassword')?.enable();
  }

  cancelEdit() {
    this.isEditing.set(false);
    this.profileForm.patchValue({
      ...this.originalData,
      currentPassword: '',
      password: '',
      confirmPassword: ''
    });
    ['fullName', 'phone', 'currentPassword', 'password', 'confirmPassword'].forEach(f => {
      this.profileForm.get(f)?.disable();
      this.profileForm.get(f)?.markAsUntouched();
      this.profileForm.get(f)?.markAsPristine();
    });
    this.profileForm.markAsPristine();
  }

  private passwordMatchValidator(control: AbstractControl): ValidationErrors | null {
    const currentPassword = control.get('currentPassword');
    const password = control.get('password');
    const confirmPassword = control.get('confirmPassword');

    if (password?.value && !currentPassword?.value) {
      return { currentPasswordRequired: true };
    }
    if (!password || !confirmPassword) return null;
    if (password.value && password.value !== confirmPassword.value) {
      return { passwordMismatch: true };
    }
    return null;
  }

  formatPhone() {
    const phoneControl = this.profileForm.get('phone');
    if (!phoneControl) return;

    let value = phoneControl.value.replace(/\D/g, '');
    if (value.startsWith('258')) value = value.substring(3);

    if (value.length <= 2) {
      phoneControl.setValue(value ? `+258 ${value}` : '', { emitEvent: false });
    } else if (value.length <= 5) {
      phoneControl.setValue(`+258 ${value.substring(0, 2)} ${value.substring(2)}`, { emitEvent: false });
    } else if (value.length <= 9) {
      phoneControl.setValue(`+258 ${value.substring(0, 2)} ${value.substring(2, 5)} ${value.substring(5)}`, { emitEvent: false });
    } else {
      phoneControl.setValue(`+258 ${value.substring(0, 2)} ${value.substring(2, 5)} ${value.substring(5, 9)}`, { emitEvent: false });
    }
  }

  getErrorMessage(field: string): string {
    const control = this.profileForm.get(field);
    if (!control || !control.touched) return '';

    if (control.hasError('required')) return t('profile.errors.required');
    if (control.hasError('email')) return t('profile.errors.email');
    if (control.hasError('minlength')) return t('common.validation.minLength', { min: control.getError('minlength').requiredLength });
    if (control.hasError('pattern') && field === 'phone') return t('profile.errors.phoneFormat');
    if (field === 'currentPassword' && this.profileForm.hasError('currentPasswordRequired')) {
      return t('profile.errors.currentPasswordRequired');
    }
    if (field === 'confirmPassword' && this.profileForm.hasError('passwordMismatch')) {
      return t('profile.errors.passwordMismatch');
    }
    return '';
  }

  async onSubmit() {
    if (this.profileForm.invalid || !this.isEditing()) {
      this.profileForm.markAllAsTouched();
      return;
    }

    this.isSaving.set(true);
    const { fullName, phone, currentPassword, password } = this.profileForm.value;

    try {
      await this.authService.updateUserProfile({ fullName, phone });

      if (password && currentPassword) {
        await this.authService.updateUserPassword(currentPassword, password);
      }

      this.snackBar.open(t('profile.messages.updated'), t('common.actions.close'), {
        duration: 3000,
        panelClass: ['success-snackbar']
      });

      this.originalData.fullName = fullName;
      this.originalData.phone = phone;
      this.cancelEdit();

    } catch (error: any) {
      this.snackBar.open(error.message || t('profile.messages.updateError'), t('common.actions.close'), {
        duration: 5000,
        panelClass: ['error-snackbar']
      });
    } finally {
      this.isSaving.set(false);
    }
  }
}