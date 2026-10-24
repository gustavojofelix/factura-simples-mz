import { Component, Input, inject, signal } from '@angular/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthService } from '../../../core/services/auth.service';
import { t } from '../../../core/i18n/i18n';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';

/** Botão "Continuar com Google" (login e registo). Não aparece na app nativa. */
@Component({
  selector: 'app-google-sign-in-button',
  standalone: true,
  imports: [MatProgressSpinnerModule, MatSnackBarModule, TranslatePipe],
  template: `
    @if (authService.googleSignInAvailable) {
      <button
        type="button"
        (click)="signIn()"
        [disabled]="isRedirecting()"
        class="w-full h-12 flex items-center justify-center gap-3 rounded-xl text-sm font-semibold transition-all active:scale-[0.98] disabled:opacity-70 disabled:cursor-wait"
        [class]="variant === 'dark'
          ? 'bg-white text-slate-800 hover:bg-slate-100 shadow-lg'
          : 'bg-white text-gray-800 border border-gray-300 hover:bg-gray-50 shadow-sm'"
      >
        @if (isRedirecting()) {
          <mat-spinner diameter="18"></mat-spinner>
          <span>{{ 'auth.google.redirecting' | t }}</span>
        } @else {
          <svg class="w-5 h-5" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/>
          </svg>
          <span>{{ 'auth.google.continue' | t }}</span>
        }
      </button>
    }
  `
})
export class GoogleSignInButtonComponent {
  @Input() variant: 'dark' | 'light' = 'dark';

  readonly authService = inject(AuthService);
  private snackBar = inject(MatSnackBar);
  isRedirecting = signal(false);

  async signIn() {
    this.isRedirecting.set(true);
    const result = await this.authService.signInWithGoogle();
    // Em caso de sucesso o browser já está a sair para o Google.
    if (!result.success) {
      this.isRedirecting.set(false);
      this.snackBar.open(result.error || t('auth.google.error'), t('common.actions.close'), {
        duration: 5000,
        panelClass: ['error-snackbar']
      });
    }
  }
}
