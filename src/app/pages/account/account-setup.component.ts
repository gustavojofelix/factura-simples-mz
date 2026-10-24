import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AccountService } from '../../core/services/account.service';
import { AuthService } from '../../core/services/auth.service';
import { TenantService } from '../../core/services/tenant.service';
import {
  accountSlugAvailableValidator,
  accountSlugErrorMessage,
  accountSlugFormatValidator
} from '../../core/validators/account-slug.validator';
import { slugifyAccount } from '../../core/utils/tenant.util';
import { friendlyErrorMessage } from '../../core/utils/error-message';
import { environment } from '../../../environments/environment';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { LanguageSwitcherComponent } from '../../shared/components/language-switcher/language-switcher.component';

/**
 * /configurar-conta: utilizadores sem conta própria (ex.: convidados que passam
 * a ter empresas suas, ou contas criadas antes dos subdomínios) escolhem o endereço.
 */
@Component({
  selector: 'app-account-setup',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    TranslatePipe,
    LanguageSwitcherComponent
  ],
  template: `
    <div class="relative min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 py-16 px-4 sm:px-6 lg:px-8">
      <div class="absolute top-4 right-4 z-20">
        <app-language-switcher />
      </div>
      <div class="max-w-md w-full">
        <div class="bg-white rounded-2xl shadow-xl p-8">
          <div class="text-center mb-8">
            <h1 class="text-3xl font-bold text-gray-900 mb-2">{{ 'account.setup.title' | t }}</h1>
            <p class="text-gray-600">{{ 'account.setup.subtitle' | t }}</p>
          </div>

          <form [formGroup]="form" (ngSubmit)="onSubmit()" class="space-y-5">
            <mat-form-field appearance="outline" class="w-full">
              <mat-label>{{ 'account.setup.name' | t }}</mat-label>
              <input matInput formControlName="name" [placeholder]="'account.setup.namePlaceholder' | t" />
              <mat-icon matPrefix class="text-gray-400">business</mat-icon>
            </mat-form-field>

            <mat-form-field appearance="outline" class="w-full">
              <mat-label>{{ 'auth.register.accountAddress' | t }}</mat-label>
              <input
                matInput
                formControlName="slug"
                [placeholder]="'auth.register.accountAddressPlaceholder' | t"
                autocomplete="off"
                autocapitalize="off"
                spellcheck="false"
                (input)="onSlugInput()"
              />
              <mat-icon matPrefix class="text-gray-400">language</mat-icon>
              <span matTextSuffix class="text-gray-500">.{{ rootDomain }}</span>
              @if (slugError()) {
                <mat-error>{{ slugError() }}</mat-error>
              }
              @if (form.get('slug')?.pending) {
                <mat-hint>{{ 'auth.register.checkingAvailability' | t }}</mat-hint>
              } @else if (form.get('slug')?.valid) {
                <mat-hint class="!text-green-700">{{ 'account.setup.available' | t }}</mat-hint>
              }
            </mat-form-field>

            <button
              mat-raised-button
              type="submit"
              class="w-full !bg-ispc-orange !text-white !py-3 !text-lg"
              [disabled]="isLoading()"
            >
              @if (isLoading()) {
                <mat-spinner diameter="20" class="inline-block mr-2"></mat-spinner>
                <span>{{ 'auth.register.creating' | t }}</span>
              } @else {
                <span>{{ 'common.actions.continue' | t }}</span>
              }
            </button>
          </form>

          <div class="mt-8 text-center">
            <button type="button" (click)="signOut()" class="text-sm text-gray-600 hover:text-gray-900">
              {{ 'account.common.signOut' | t }}
            </button>
          </div>
        </div>
      </div>
    </div>
  `
})
export class AccountSetupComponent implements OnInit {
  form: FormGroup;
  isLoading = signal(false);
  readonly rootDomain = environment.rootDomain;
  private slugEditedByUser = false;

  constructor(
    private fb: FormBuilder,
    private accountService: AccountService,
    private authService: AuthService,
    private tenant: TenantService,
    private router: Router,
    private snackBar: MatSnackBar
  ) {
    this.form = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      slug: ['', {
        validators: [Validators.required, accountSlugFormatValidator()],
        asyncValidators: [accountSlugAvailableValidator(this.accountService)]
      }]
    });
  }

  async ngOnInit() {
    await this.accountService.ensureLoaded();
    const owned = this.accountService.ownedAccount();
    if (owned) {
      // Já tem conta: segue para ela.
      this.accountService.switchAccount(owned, '/configurar-empresa');
      if (!this.tenant.usesSubdomains) this.router.navigate(['/configurar-empresa']);
      return;
    }

    this.form.get('name')!.valueChanges.subscribe(name => {
      if (this.slugEditedByUser) return;
      const slugControl = this.form.get('slug')!;
      slugControl.setValue(slugifyAccount(name || ''));
      if (slugControl.value) slugControl.markAsTouched();
    });
  }

  slugError(): string {
    const control = this.form.get('slug');
    return control?.touched ? accountSlugErrorMessage(control) : '';
  }

  onSlugInput() {
    this.slugEditedByUser = true;
    const control = this.form.get('slug')!;
    const clean = (control.value || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (clean !== control.value) control.setValue(clean);
  }

  async onSubmit() {
    if (this.form.invalid || this.form.pending) {
      this.form.markAllAsTouched();
      return;
    }

    this.isLoading.set(true);
    try {
      const { name, slug } = this.form.value;
      const account = await this.accountService.createAccount(slug, name);
      // Quem se regista com Google só cria a conta aqui: é este o "registo" a notificar.
      const user = this.authService.currentUser();
      if (user?.email && this.authService.isOAuthUser(user)) {
        this.authService.notifySignup(user.email, user.user_metadata?.['full_name'] ?? name, undefined, account.slug);
      }
      if (this.tenant.usesSubdomains) {
        window.location.href = this.tenant.accountUrl(account.slug, '/configurar-empresa');
      } else {
        this.router.navigate(['/configurar-empresa']);
      }
    } catch (error: any) {
      this.isLoading.set(false);
      if (error?.details === 'ACCOUNT_SLUG_UNAVAILABLE') {
        this.form.get('slug')!.setErrors({ slugTaken: true });
        this.form.get('slug')!.markAsTouched();
        return;
      }
      this.snackBar.open(friendlyErrorMessage(error, t('account.setup.createError')), t('common.actions.close'), {
        duration: 5000,
        panelClass: ['error-snackbar']
      });
    }
  }

  async signOut() {
    await this.authService.signOut();
    this.router.navigate(['/entrar']);
  }
}
