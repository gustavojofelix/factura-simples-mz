import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../core/services/auth.service';
import { AccountDeletionService } from '../../core/services/account-deletion.service';
import { currentLocale, t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { LanguageSwitcherComponent } from '../../shared/components/language-switcher/language-switcher.component';

/**
 * /conta-em-eliminacao: a conta tem um pedido de eliminação confirmado e está
 * nos 30 dias de carência. O utilizador só pode cancelar ou terminar a sessão.
 */
@Component({
  selector: 'app-account-deletion-pending',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatProgressSpinnerModule, TranslatePipe, LanguageSwitcherComponent],
  template: `
    <div class="relative min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 py-16 px-4 sm:px-6 lg:px-8">
      <div class="absolute top-4 right-4 z-20">
        <app-language-switcher />
      </div>
      <div class="max-w-md w-full">
        <div class="bg-white rounded-2xl shadow-xl p-8 text-center">
          <mat-icon class="!text-5xl !w-12 !h-12 text-rose-600 mb-4">schedule</mat-icon>
          <h1 class="text-2xl font-bold text-gray-900 mb-2">{{ 'profile.deleteAccount.pending.title' | t }}</h1>
          @if (scheduledFor()) {
            <p class="text-gray-600 mb-2">
              {{ 'profile.deleteAccount.pending.text' | t: { date: formattedDate() } }}
            </p>
          }
          <p class="text-sm text-gray-500 mb-6">{{ 'profile.deleteAccount.pending.hint' | t }}</p>

          @if (error()) {
            <p class="text-sm text-rose-600 mb-4">{{ error() }}</p>
          }

          <div class="flex flex-col gap-3">
            <button type="button" (click)="cancelDeletion()" [disabled]="busy()"
              class="w-full py-3 rounded-xl font-semibold text-white bg-ispc-orange hover:bg-ispc-orange/90 disabled:opacity-60 flex items-center justify-center gap-2">
              @if (busy()) { <mat-spinner diameter="18"></mat-spinner> }
              {{ 'profile.deleteAccount.pending.cancel' | t }}
            </button>
            <button type="button" (click)="signOut()"
              class="w-full py-3 rounded-xl font-semibold text-gray-700 border border-gray-300 hover:bg-gray-50">
              {{ 'profile.deleteAccount.pending.signOut' | t }}
            </button>
          </div>
        </div>
      </div>
    </div>
  `
})
export class AccountDeletionPendingComponent implements OnInit {
  private authService = inject(AuthService);
  private deletion = inject(AccountDeletionService);
  private router = inject(Router);

  scheduledFor = signal<string | null>(null);
  busy = signal(false);
  error = signal('');

  async ngOnInit() {
    const user = this.authService.currentUser();
    const pending = user ? await this.deletion.pendingDeletion(user.id, true) : null;
    if (!pending) {
      this.router.navigate(['/painel']);
      return;
    }
    this.scheduledFor.set(pending.scheduled_for);
  }

  formattedDate(): string {
    const value = this.scheduledFor();
    return value
      ? new Intl.DateTimeFormat(currentLocale(), { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(value))
      : '';
  }

  async cancelDeletion() {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.deletion.cancel();
      this.router.navigate(['/painel']);
    } catch (e: any) {
      this.error.set(e?.message || t('profile.deleteAccount.errors.generic'));
    } finally {
      this.busy.set(false);
    }
  }

  async signOut() {
    await this.authService.signOut();
  }
}
