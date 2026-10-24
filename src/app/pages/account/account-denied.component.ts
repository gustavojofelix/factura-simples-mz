import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { AccountService } from '../../core/services/account.service';
import { AuthService } from '../../core/services/auth.service';
import { TenantService } from '../../core/services/tenant.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { LanguageSwitcherComponent } from '../../shared/components/language-switcher/language-switcher.component';

/** /sem-acesso: o subdomínio é de uma conta a que o utilizador não pertence. */
@Component({
  selector: 'app-account-denied',
  standalone: true,
  imports: [CommonModule, MatIconModule, TranslatePipe, LanguageSwitcherComponent],
  template: `
    <div class="relative min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 py-16 px-4 sm:px-6 lg:px-8">
      <div class="absolute top-4 right-4 z-20">
        <app-language-switcher />
      </div>
      <div class="max-w-md w-full">
        <div class="bg-white rounded-2xl shadow-xl p-8 text-center">
          <mat-icon class="!text-5xl !w-12 !h-12 text-ispc-orange mb-4">lock</mat-icon>
          <h1 class="text-2xl font-bold text-gray-900 mb-2">{{ 'account.denied.title' | t }}</h1>
          <p class="text-gray-600 mb-6">
            {{ 'account.denied.noAccessPrefix' | t }}
            <strong>{{ tenant.currentSlug() }}</strong>{{ 'account.denied.noAccessSuffix' | t }}
            {{ 'account.denied.askOwner' | t }}
          </p>

          <div class="flex flex-col gap-3">
            @if (accountService.accounts().length > 0) {
              <a
                [href]="tenant.rootUrl('/escolher-conta')"
                class="w-full py-3 rounded-xl font-semibold text-white bg-ispc-orange hover:bg-ispc-orange/90"
              >
                {{ 'account.denied.goToMyAccounts' | t }}
              </a>
            }
            <button
              type="button"
              (click)="signOut()"
              class="w-full py-3 rounded-xl font-semibold text-gray-700 border border-gray-300 hover:bg-gray-50"
            >
              {{ 'account.denied.signInAsOther' | t }}
            </button>
          </div>
        </div>
      </div>
    </div>
  `
})
export class AccountDeniedComponent implements OnInit {
  constructor(
    readonly accountService: AccountService,
    readonly tenant: TenantService,
    private authService: AuthService,
    private router: Router
  ) {}

  async ngOnInit() {
    await this.accountService.ensureLoaded();
    if (!this.accountService.accessDenied()) {
      this.router.navigate(['/painel']);
    }
  }

  async signOut() {
    await this.authService.signOut();
    this.router.navigate(['/entrar']);
  }
}
