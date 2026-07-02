import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-login-form',
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
  templateUrl: './login-form.component.html',
  styleUrls: ['./login-form.component.css']
})
export class LoginFormComponent {
  loginForm: FormGroup;
  forgotForm: FormGroup;
  mode = signal<'login' | 'forgot'>('login');
  isLoading = signal(false);
  hidePassword = signal(true);

  setMode(newMode: 'login' | 'forgot') {
    this.mode.set(newMode);
  }

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router,
    private snackBar: MatSnackBar
  ) {
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]]
    });

    this.forgotForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]]
    });
  }

  async onSubmit() {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.isLoading.set(true);

    const { email, password } = this.loginForm.value;
    const result = await this.authService.signIn(email, password);

    this.isLoading.set(false);

    if (result.success) {
      this.snackBar.open('Bem-vindo de volta!', 'Fechar', {
        duration: 3000,
        panelClass: ['success-snackbar']
      });

      const companies = await this.authService.getUserCompanies();
      if (companies.length === 0) {
        this.router.navigate(['/configurar-empresa']);
      } else {
        this.router.navigate(['/painel']);
      }
    } else {
      this.snackBar.open(result.error || 'Erro ao entrar', 'Fechar', {
        duration: 5000,
        panelClass: ['error-snackbar']
      });
    }
  }

  getErrorMessage(field: string, formName: 'login' | 'forgot' = 'login'): string {
    const form = formName === 'login' ? this.loginForm : this.forgotForm;
    const control = form.get(field);
    if (!control || !control.touched) return '';

    if (control.hasError('required')) {
      return 'Este campo é obrigatório';
    }
    if (control.hasError('email')) {
      return 'Email inválido';
    }
    if (control.hasError('minlength')) {
      return 'A palavra-passe deve ter pelo menos 6 caracteres';
    }
    return '';
  }

  async onForgotPasswordSubmit() {
    if (this.forgotForm.invalid) {
      this.forgotForm.markAllAsTouched();
      return;
    }

    this.isLoading.set(true);
    const { email } = this.forgotForm.value;
    const result = await this.authService.resetPassword(email);
    this.isLoading.set(false);

    if (result.success) {
      this.snackBar.open('E-mail de recuperação enviado com sucesso!', 'Fechar', {
        duration: 5000,
        panelClass: ['success-snackbar']
      });
      this.mode.set('login');
      this.forgotForm.reset();
    } else {
      this.snackBar.open(result.error || 'Erro ao enviar e-mail de recuperação', 'Fechar', {
        duration: 5000,
        panelClass: ['error-snackbar']
      });
    }
  }
}
