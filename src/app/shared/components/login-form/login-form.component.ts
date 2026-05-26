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
  isLoading = signal(false);
  hidePassword = signal(true);

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
  }

  async onForgotPassword() {
    const email = this.loginForm.get('email')?.value;
    if (!email) {
      this.snackBar.open('Por favor, introduza o seu email primeiro', 'Fechar', {
        duration: 3000
      });
      return;
    }

    this.isLoading.set(true);
    const result = await this.authService.resetPassword(email);
    this.isLoading.set(false);

    if (result.success) {
      this.snackBar.open('Email de recuperação enviado! Verifique a sua caixa de entrada.', 'Fechar', {
        duration: 5000,
        panelClass: ['success-snackbar']
      });
    } else {
      this.snackBar.open(result.error || 'Erro ao enviar email de recuperação', 'Fechar', {
        duration: 5000,
        panelClass: ['error-snackbar']
      });
    }
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

  getErrorMessage(field: string): string {
    const control = this.loginForm.get(field);
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
}
