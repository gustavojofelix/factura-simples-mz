import { Component, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors } from '@angular/forms';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthService } from '../../core/services/auth.service';
import { SupabaseService } from '../../core/services/supabase.service';

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
  isVerifying = signal(true);
  tokenValid = signal(true);
  tokenErrorMessage = signal('');
  hidePassword = signal(true);
  hideConfirmPassword = signal(true);
  isSuccess = signal(false);

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private supabaseService: SupabaseService,
    private route: ActivatedRoute,
    private router: Router,
    private snackBar: MatSnackBar
  ) {
    this.resetForm = this.fb.group({
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', [Validators.required]]
    }, { validators: this.passwordMatchValidator });
  }

  async ngOnInit() {
    this.isVerifying.set(true);
    await this.authService.waitForInitialization();

    // Check for query parameters (token_hash or code) or hash fragments
    const queryParams = this.route.snapshot.queryParams;
    const tokenHash = queryParams['token_hash'];
    const code = queryParams['code'];

    try {
      if (tokenHash) {
        const { error } = await this.supabaseService.auth.verifyOtp({
          token_hash: tokenHash,
          type: 'recovery'
        });
        if (error) throw error;
      } else if (code) {
        const { error } = await this.supabaseService.auth.exchangeCodeForSession(code);
        if (error) throw error;
      }

      // Check if session exists after initial parsing
      const { data: { session } } = await this.supabaseService.auth.getSession();
      if (!session) {
        const hash = window.location.hash;
        if (hash.includes('access_token=')) {
          // Manually extract access_token and refresh_token because HashLocationStrategy breaks Supabase's automatic extraction
          const hashString = hash.substring(hash.indexOf('access_token='));
          const urlParams = new URLSearchParams(hashString);
          const accessToken = urlParams.get('access_token');
          const refreshToken = urlParams.get('refresh_token');

          if (accessToken && refreshToken) {
            const { error: sessionError } = await this.supabaseService.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken
            });
            
            if (sessionError) {
              throw sessionError;
            } else {
              this.tokenValid.set(true);
            }
          } else {
            throw new Error('Token de recuperação incompleto no link.');
          }
        } else {
          this.tokenValid.set(false);
          this.tokenErrorMessage.set('O link de recuperação de palavra-passe é inválido ou expirou.');
        }
      } else {
        this.tokenValid.set(true);
      }
    } catch (err: any) {
      console.error('Erro ao verificar token de recuperação:', err);
      this.tokenValid.set(false);
      this.tokenErrorMessage.set(err.message || 'O link de recuperação caducou ou é inválido.');
    } finally {
      this.isVerifying.set(false);
    }
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
