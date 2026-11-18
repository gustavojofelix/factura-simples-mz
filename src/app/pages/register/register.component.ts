import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { LegalDialogComponent } from '../../shared/components/legal-dialog.component';
import { AuthService } from '../../core/services/auth.service';
import { LandingCmsService } from '../../core/services/landing-cms.service';
import { AccountService } from '../../core/services/account.service';
import { ACCOUNT_SLUG_PATTERN, slugifyAccount } from '../../core/utils/tenant.util';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { LanguageSwitcherComponent } from '../../shared/components/language-switcher/language-switcher.component';
import { GoogleSignInButtonComponent } from '../../shared/components/google-sign-in-button/google-sign-in-button.component';
import { DEMO_BUSINESS_TYPES, asDemoBusinessType } from '../../core/constants/demo-business-types';

/**
 * Registo para o teste de 14 dias: só nome da empresa, email e palavra-passe.
 * O endereço da conta sai do nome da empresa (o servidor resolve colisões) e a
 * primeira empresa é criada logo a seguir, em /configurar-empresa.
 */
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
    MatSnackBarModule,
    MatDialogModule,
    TranslatePipe,
    LanguageSwitcherComponent,
    GoogleSignInButtonComponent
  ],
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.css']
})
export class RegisterComponent implements OnInit {
  registerForm: FormGroup;
  isLoading = signal(false);
  hidePassword = signal(true);
  readonly googleSignInAvailable = inject(AuthService).googleSignInAvailable;
  readonly demoBusinessTypes = DEMO_BUSINESS_TYPES;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router,
    private snackBar: MatSnackBar,
    private dialog: MatDialog,
    private cmsService: LandingCmsService,
    private accountService: AccountService
  ) {
    this.registerForm = this.fb.group({
      companyName: ['', [Validators.required, Validators.minLength(2)]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      loadDemoData: [true],
      demoBusinessType: ['services']
    });
  }

  ngOnInit() {
    this.cmsService.loadAllContent().catch(() => {});
  }

  /** Endereço sugerido a partir do nome da empresa (ou do email, se o nome não servir). */
  private accountSlugFor(companyName: string, email: string): string {
    const fromName = slugifyAccount(companyName);
    if (ACCOUNT_SLUG_PATTERN.test(fromName)) return fromName;
    const fromEmail = slugifyAccount(email.split('@')[0] || '');
    if (ACCOUNT_SLUG_PATTERN.test(fromEmail)) return fromEmail;
    return 'conta-' + Math.random().toString(36).slice(2, 8);
  }

  async onSubmit() {
    if (this.registerForm.invalid) {
      this.registerForm.markAllAsTouched();
      return;
    }

    this.isLoading.set(true);

    const { companyName, email, password, loadDemoData, demoBusinessType } = this.registerForm.value;
    const name = (companyName as string).trim();
    const result = await this.authService.signUp(
      email,
      password,
      name,
      this.accountSlugFor(name, email),
      !!loadDemoData,
      asDemoBusinessType(demoBusinessType)
    );

    if (result.success) {
      this.snackBar.open(t('auth.messages.accountCreated'), t('common.actions.close'), {
        duration: 3000,
        panelClass: ['success-snackbar']
      });

      // O slug final pode ter recebido um sufixo se já estava ocupado.
      const target = await this.accountService.resolvePostLoginTarget();
      this.isLoading.set(false);
      if (target.kind === 'external') {
        window.location.href = target.url;
      } else {
        this.router.navigate([target.route]);
      }
    } else {
      this.isLoading.set(false);
      this.snackBar.open(result.error || t('auth.messages.signUpError'), t('common.actions.close'), {
        duration: 5000,
        panelClass: ['error-snackbar']
      });
    }
  }

  getErrorMessage(field: string): string {
    const control = this.registerForm.get(field);
    if (!control || !control.touched) return '';

    if (control.hasError('required')) {
      return t('auth.validation.requiredShort');
    }
    if (control.hasError('email')) {
      return t('auth.validation.emailInvalidShort');
    }
    if (control.hasError('minlength')) {
      const minLength = control.getError('minlength').requiredLength;
      return t('auth.validation.minLength', { min: minLength });
    }
    return '';
  }

  openTerms(event: Event) {
    event.preventDefault();
    this.dialog.open(LegalDialogComponent, {
      width: '100vw',
      maxWidth: '100vw',
      height: '100vh',
      panelClass: 'full-screen-dialog',
      data: {
        title: this.cmsService.localizedTerms().title || t('landing.legal.termsTitle'),
        content: this.cmsService.getTermsHtml()
      }
    });
  }

  openPrivacy(event: Event) {
    event.preventDefault();
    this.dialog.open(LegalDialogComponent, {
      width: '100vw',
      maxWidth: '100vw',
      height: '100vh',
      panelClass: 'full-screen-dialog',
      data: {
        title: this.cmsService.localizedPrivacy().title || t('landing.legal.privacyTitle'),
        content: this.cmsService.getPrivacyHtml()
      }
    });
  }
}
