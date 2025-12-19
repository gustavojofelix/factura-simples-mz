import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatCheckboxModule,
    MatProgressSpinnerModule,
    MatSnackBarModule
  ],
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.css']
})
export class RegisterComponent {
  registerForm: FormGroup;
  isLoading = signal(false);
  hidePassword = signal(true);
  hideConfirmPassword = signal(true);

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router,
    private snackBar: MatSnackBar
  ) {
    this.registerForm = this.fb.group({
      fullName: ['', [Validators.required, Validators.minLength(3)]],
      email: ['', [Validators.required, Validators.email]],
      phone: ['', [Validators.pattern(/^\+?258\s?\d{2}\s?\d{3}\s?\d{4}$/)]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', [Validators.required]],
      acceptTerms: [false, [Validators.requiredTrue]]
    }, {
      validators: this.passwordMatchValidator
    });
  }

  private passwordMatchValidator(control: AbstractControl): ValidationErrors | null {
    const password = control.get('password');
    const confirmPassword = control.get('confirmPassword');

    if (!password || !confirmPassword) {
      return null;
    }

    return password.value === confirmPassword.value ? null : { passwordMismatch: true };
  }

  async onSubmit() {
    if (this.registerForm.invalid) {
      this.registerForm.markAllAsTouched();
      return;
    }

    this.isLoading.set(true);

    const { fullName, email, phone, password } = this.registerForm.value;
    const result = await this.authService.signUp(email, password, fullName, phone);

    this.isLoading.set(false);

    if (result.success) {
      this.snackBar.open('Conta criada com sucesso!', 'Fechar', {
        duration: 3000,
        panelClass: ['success-snackbar']
      });

      this.router.navigate(['/configurar-empresa']);
    } else {
      this.snackBar.open(result.error || 'Erro ao criar conta', 'Fechar', {
        duration: 5000,
        panelClass: ['error-snackbar']
      });
    }
  }

  formatPhone() {
    const phoneControl = this.registerForm.get('phone');
    if (!phoneControl) return;

    let value = phoneControl.value.replace(/\D/g, '');

    if (value.startsWith('258')) {
      value = value.substring(3);
    }

    if (value.length <= 2) {
      phoneControl.setValue(value ? `+258 ${value}` : '');
    } else if (value.length <= 5) {
      phoneControl.setValue(`+258 ${value.substring(0, 2)} ${value.substring(2)}`);
    } else if (value.length <= 9) {
      phoneControl.setValue(`+258 ${value.substring(0, 2)} ${value.substring(2, 5)} ${value.substring(5)}`);
    } else {
      phoneControl.setValue(`+258 ${value.substring(0, 2)} ${value.substring(2, 5)} ${value.substring(5, 9)}`);
    }
  }

  getErrorMessage(field: string): string {
    const control = this.registerForm.get(field);
    if (!control || !control.touched) return '';

    if (control.hasError('required')) {
      return 'Este campo é obrigatório';
    }
    if (control.hasError('email')) {
      return 'Email inválido';
    }
    if (control.hasError('minlength')) {
      const minLength = control.getError('minlength').requiredLength;
      return `Mínimo de ${minLength} caracteres`;
    }
    if (control.hasError('pattern') && field === 'phone') {
      return 'Formato: +258 XX XXX XXXX';
    }
    if (field === 'confirmPassword' && this.registerForm.hasError('passwordMismatch')) {
      return 'As palavras-passe não coincidem';
    }
    return '';
  }
}
