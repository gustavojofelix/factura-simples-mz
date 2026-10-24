import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { LegalDialogComponent } from '../../shared/components/legal-dialog.component';
import { AuthService } from '../../core/services/auth.service';
import { LandingCmsService } from '../../core/services/landing-cms.service';
import { AccountService } from '../../core/services/account.service';
import {
  accountSlugAvailableValidator,
  accountSlugErrorMessage,
  accountSlugFormatValidator
} from '../../core/validators/account-slug.validator';
import { slugifyAccount } from '../../core/utils/tenant.util';
import { environment } from '../../../environments/environment';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { LanguageSwitcherComponent } from '../../shared/components/language-switcher/language-switcher.component';
import { GoogleSignInButtonComponent } from '../../shared/components/google-sign-in-button/google-sign-in-button.component';

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
  hideConfirmPassword = signal(true);
  readonly rootDomain = environment.rootDomain;
  readonly googleSignInAvailable = inject(AuthService).googleSignInAvailable;
  /** Enquanto o utilizador não editar o endereço, ele segue o nome. */
  private slugEditedByUser = false;
  private destroyRef = inject(DestroyRef);

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
      fullName: ['', [Validators.required, Validators.minLength(3)]],
      accountSlug: ['', {
        validators: [Validators.required, accountSlugFormatValidator()],
        asyncValidators: [accountSlugAvailableValidator(this.accountService)]
      }],
      email: ['', [Validators.required, Validators.email]],
      phone: ['', [Validators.pattern(/^\+?258\s?\d{2}\s?\d{3}\s?\d{4}$/)]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', [Validators.required]],
      acceptTerms: [false, [Validators.requiredTrue]]
    }, {
      validators: this.passwordMatchValidator
    });
  }

  ngOnInit() {
    this.cmsService.loadAllContent().catch(() => {});

    this.registerForm.get('fullName')!.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(name => {
        if (this.slugEditedByUser) return;
        const slugControl = this.registerForm.get('accountSlug')!;
        slugControl.setValue(slugifyAccount(name || ''));
        if (slugControl.value) slugControl.markAsTouched();
      });
  }

  onSlugInput() {
    this.slugEditedByUser = true;
    const slugControl = this.registerForm.get('accountSlug')!;
    const clean = (slugControl.value || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (clean !== slugControl.value) slugControl.setValue(clean);
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
    if (this.registerForm.invalid || this.registerForm.pending) {
      this.registerForm.markAllAsTouched();
      return;
    }

    this.isLoading.set(true);

    const { fullName, email, phone, password, accountSlug } = this.registerForm.value;
    const result = await this.authService.signUp(email, password, fullName, phone, accountSlug);

    if (result.success) {
      this.snackBar.open(t('auth.messages.accountCreated'), t('common.actions.close'), {
        duration: 3000,
        panelClass: ['success-snackbar']
      });

      // O slug final pode ter recebido um sufixo se alguém o ocupou entretanto.
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

    if (field === 'accountSlug') return accountSlugErrorMessage(control);

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
    if (control.hasError('pattern') && field === 'phone') {
      return t('auth.validation.phoneFormat');
    }
    if (field === 'confirmPassword' && this.registerForm.hasError('passwordMismatch')) {
      return t('auth.validation.passwordMismatch');
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
