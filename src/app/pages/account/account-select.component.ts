import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Account, AccountService } from '../../core/services/account.service';
import { AuthService } from '../../core/services/auth.service';
import { environment } from '../../../environments/environment';

/** /escolher-conta: o utilizador tem acesso a várias contas e escolhe uma. */
@Component({
  selector: 'app-account-select',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 py-12 px-4 sm:px-6 lg:px-8">
      <div class="max-w-md w-full">
        <div class="bg-white rounded-2xl shadow-xl p-8">
          <div class="text-center mb-6">
            <h1 class="text-2xl font-bold text-gray-900 mb-2">Escolha a conta</h1>
            <p class="text-gray-600">Tem acesso a mais de uma conta.</p>
          </div>

          @if (!accountService.isLoaded()) {
            <div class="flex justify-center py-6"><mat-spinner diameter="32"></mat-spinner></div>
          } @else {
            <ul class="space-y-3">
              @for (account of accountService.accounts(); track account.id) {
                <li>
                  <button
                    type="button"
                    (click)="open(account)"
                    class="w-full flex items-center gap-3 text-left p-4 rounded-xl border border-gray-200 hover:border-ispc-orange hover:bg-orange-50 transition-colors"
                  >
                    <mat-icon class="text-ispc-orange">{{ account.is_owner ? 'home_work' : 'groups' }}</mat-icon>
                    <span class="flex-1 min-w-0">
                      <span class="block font-semibold text-gray-900 truncate">{{ account.name || account.slug }}</span>
                      <span class="block text-sm text-gray-500 truncate">{{ account.slug }}.{{ rootDomain }}</span>
                    </span>
                    @if (account.is_owner) {
                      <span class="text-xs font-medium text-ispc-orange bg-orange-100 rounded-full px-2 py-0.5">Titular</span>
                    }
                    <mat-icon class="text-gray-400">chevron_right</mat-icon>
                  </button>
                </li>
              }
            </ul>
          }

          <div class="mt-8 text-center">
            <button type="button" (click)="signOut()" class="text-sm text-gray-600 hover:text-gray-900">
              Terminar sessão
            </button>
          </div>
        </div>
      </div>
    </div>
  `
})
export class AccountSelectComponent implements OnInit {
  readonly rootDomain = environment.rootDomain;

  constructor(
    readonly accountService: AccountService,
    private authService: AuthService,
    private router: Router
  ) {}

  async ngOnInit() {
    await this.accountService.ensureLoaded();
    if (this.accountService.accounts().length === 0) {
      this.router.navigate(['/configurar-conta']);
    }
  }

  async open(account: Account) {
    this.accountService.switchAccount(account, await this.accountService.homeRouteFor(account));
  }

  async signOut() {
    await this.authService.signOut();
    this.router.navigate(['/entrar']);
  }
}
