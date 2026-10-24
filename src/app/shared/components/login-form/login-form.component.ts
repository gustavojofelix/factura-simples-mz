import { Component, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthService } from '../../../core/services/auth.service';
import { AccountService } from '../../../core/services/account.service';
import { t } from '../../../core/i18n/i18n';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';

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
    MatSnackBarModule,
    TranslatePipe
  ],
  templateUrl: './login-form.component.html',
  styleUrls: ['./login-form.component.css']
})
export class LoginFormComponent implements OnInit {
  loginForm: FormGroup;
  forgotForm: FormGroup;
  mode = signal<'login' | 'forgot' | 'forgot_sent'>('login');
  sentEmail = signal<string>('');
  isLoading = signal(false);
  hidePassword = signal(true);

  setMode(newMode: 'login' | 'forgot' | 'forgot_sent') {
    this.mode.set(newMode);
  }

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute,
    private snackBar: MatSnackBar,
    private accountService: AccountService
  ) {
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]]
    });

    this.forgotForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]]
    });
  }

  ngOnInit() {
    this.route.queryParams.subscribe(params => {
      if (params['error'] === 'suspended') {
        this.snackBar.open(t('auth.messages.accountSuspended'), t('common.actions.close'), {
          duration: 8000,
          panelClass: ['error-snackbar']
        });
      }
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
      this.snackBar.open(t('auth.messages.welcomeBack'), t('common.actions.close'), {
        duration: 3000,
        panelClass: ['success-snackbar']
      });

      // Na raiz redirecciona para o subdomínio da conta (ou para a escolha de conta).
      const target = await this.accountService.resolvePostLoginTarget();
      if (target.kind === 'external') {
        window.location.href = target.url;
      } else {
        this.router.navigate([target.route]);
      }
    } else {
      this.snackBar.open(result.error || t('auth.messages.signInError'), t('common.actions.close'), {
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
      return t('auth.validation.required');
    }
    if (control.hasError('email')) {
      return t('auth.validation.emailInvalid');
    }
    if (control.hasError('minlength')) {
      return t('auth.validation.passwordMin');
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
      this.sentEmail.set(email);
      this.mode.set('forgot_sent');
      this.snackBar.open(t('auth.messages.recoverySent'), t('common.actions.close'), {
        duration: 5000,
        panelClass: ['success-snackbar']
      });
    } else {
      this.snackBar.open(result.error || t('auth.messages.recoveryError'), t('common.actions.close'), {
        duration: 5000,
        panelClass: ['error-snackbar']
      });
    }
  }
}
