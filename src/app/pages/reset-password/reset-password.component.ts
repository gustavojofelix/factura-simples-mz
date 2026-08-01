import { Component, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule
  ],
  templateUrl: './reset-password.component.html',
  styleUrls: ['./reset-password.component.css']
})
export class ResetPasswordComponent implements OnInit {
  resetForm: FormGroup;
  isLoading = signal(false);
  hidePassword = signal(true);
  hideConfirmPassword = signal(true);
  isSuccess = signal(false);

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router,
    private snackBar: MatSnackBar
  ) {
    this.resetForm = this.fb.group({
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', [Validators.required]]
    }, { validators: this.passwordMatchValidator });
  }

  async ngOnInit() {
    await this.authService.waitForInitialization();
  }

  passwordMatchValidator(control: AbstractControl): ValidationErrors | null {
    const password = control.get('password')?.value;
    const confirmPassword = control.get('confirmPassword')?.value;

    if (password && confirmPassword && password !== confirmPassword) {
      return { passwordMismatch: true };
    }
    return null;
  }

  getErrorMessage(field: string): string {
    const control = this.resetForm.get(field);
    if (!control || (!control.touched && !this.resetForm.hasError('passwordMismatch'))) return '';

    if (control.hasError('required')) {
      return 'Este campo é obrigatório';
    }
    if (control.hasError('minlength')) {
      return 'A palavra-passe deve ter pelo menos 6 caracteres';
    }
    if (field === 'confirmPassword' && this.resetForm.hasError('passwordMismatch')) {
      return 'As palavras-passes não coincidem';
    }
    return '';
  }

  async onSubmit() {
    if (this.resetForm.invalid) {
      this.resetForm.markAllAsTouched();
      return;
    }

    this.isLoading.set(true);
    const { password } = this.resetForm.value;

    const result = await this.authService.completePasswordReset(password);
    this.isLoading.set(false);

    if (result.success) {
      this.isSuccess.set(true);
      this.snackBar.open('Palavra-passe alterada com sucesso!', 'Fechar', {
        duration: 4000,
        panelClass: ['success-snackbar']
      });

      // Auto redirect user after 1.5 seconds
      setTimeout(async () => {
        const companies = await this.authService.getUserCompanies();
        if (companies.length === 0) {
          this.router.navigate(['/configurar-empresa']);
        } else {
          this.router.navigate(['/painel']);
        }
      }, 1500);
    } else {
      this.snackBar.open(result.error || 'Erro ao redefinir a palavra-passe', 'Fechar', {
        duration: 5000,
        panelClass: ['error-snackbar']
      });
    }
  }
}
