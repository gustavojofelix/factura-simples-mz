import { Component, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../core/services/auth.service';
import { AccountService } from '../../core/services/account.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

/** Destino do redirect OAuth (Google): cria a sessão e encaminha para a conta. */
@Component({
  selector: 'app-auth-callback',
  standalone: true,
  imports: [RouterLink, MatIconModule, MatProgressSpinnerModule, TranslatePipe],
  template: `
    <div class="min-h-screen flex items-center justify-center bg-slate-950 px-4">
      <div class="max-w-md w-full bg-slate-900/40 border border-white/10 rounded-2xl p-8 text-center shadow-2xl">
        @if (errorMessage()) {
          <div class="w-14 h-14 bg-rose-500/10 border border-rose-500/20 rounded-full flex items-center justify-center mx-auto text-rose-400 mb-4">
            <mat-icon>error_outline</mat-icon>
          </div>
          <h1 class="text-xl font-bold text-white mb-2">{{ 'auth.callback.failedTitle' | t }}</h1>
          <p class="text-sm text-slate-400 mb-6">{{ errorMessage() }}</p>
          <a routerLink="/entrar" class="inline-flex items-center font-semibold text-white bg-ispc-orange hover:bg-ispc-orange/90 py-3 px-5 rounded-xl">
            {{ 'auth.forgot.backToLogin' | t }}
          </a>
        } @else {
          <mat-spinner diameter="36" class="mx-auto mb-4"></mat-spinner>
          <p class="text-sm text-slate-300 font-medium">{{ 'auth.callback.signingIn' | t }}</p>
        }
      </div>
    </div>
  `
})
export class AuthCallbackComponent implements OnInit {
  private authService = inject(AuthService);
  private accountService = inject(AccountService);
  private router = inject(Router);

  errorMessage = signal('');

  async ngOnInit() {
    const result = await this.authService.completeOAuthSignIn();
    if (!result.success) {
      this.errorMessage.set(result.error || '');
      return;
    }

    // Novos utilizadores Google não têm conta: o resolver envia-os para /configurar-conta.
    const target = await this.accountService.resolvePostLoginTarget();
    if (target.kind === 'external') {
      window.location.href = target.url;
    } else {
      this.router.navigate([target.route], { replaceUrl: true });
    }
  }
}
