import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { LanguageSwitcherComponent } from '../../shared/components/language-switcher/language-switcher.component';
import { SupportContactDialogComponent } from '../../shared/components/support-contact-dialog.component';

/**
 * /eliminar-conta: página pública exigida pela Google Play ("link para pedir a
 * eliminação da conta"). Explica os passos dentro da app e oferece o contacto
 * do apoio para quem já não consegue entrar.
 */
@Component({
  selector: 'app-delete-account-info',
  standalone: true,
  imports: [CommonModule, RouterModule, MatDialogModule, MatIconModule, TranslatePipe, LanguageSwitcherComponent],
  template: `
    <div class="relative min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 py-16 px-4 sm:px-6 lg:px-8">
      <div class="absolute top-4 right-4 z-20">
        <app-language-switcher />
      </div>
      <div class="max-w-lg w-full">
        <div class="bg-white rounded-2xl shadow-xl p-8">
          <div class="text-center">
            <mat-icon class="!text-5xl !w-12 !h-12 text-rose-600 mb-4">delete_forever</mat-icon>
            <h1 class="text-2xl font-bold text-gray-900 mb-2">{{ 'profile.deleteAccount.public.title' | t }}</h1>
            <p class="text-gray-600 mb-6">{{ 'profile.deleteAccount.public.intro' | t }}</p>
          </div>

          <ol class="list-decimal pl-5 space-y-2 text-sm text-gray-700 mb-6">
            <li>{{ 'profile.deleteAccount.public.step1' | t }}</li>
            <li>{{ 'profile.deleteAccount.public.step2' | t }}</li>
            <li>{{ 'profile.deleteAccount.public.step3' | t }}</li>
            <li>{{ 'profile.deleteAccount.public.step4' | t }}</li>
          </ol>

          <div class="p-4 rounded-xl bg-gray-50 border border-gray-200 text-sm text-gray-700 space-y-2 mb-6">
            <p><strong>{{ 'profile.deleteAccount.public.deletedTitle' | t }}</strong> {{ 'profile.deleteAccount.public.deletedText' | t }}</p>
            <p><strong>{{ 'profile.deleteAccount.public.keptTitle' | t }}</strong> {{ 'profile.deleteAccount.public.keptText' | t }}</p>
          </div>

          <div class="flex flex-col gap-3">
            <a routerLink="/entrar"
              class="w-full py-3 rounded-xl font-semibold text-white text-center bg-ispc-orange hover:bg-ispc-orange/90">
              {{ 'profile.deleteAccount.public.signIn' | t }}
            </a>
            <button type="button" (click)="contactSupport()"
              class="w-full py-3 rounded-xl font-semibold text-gray-700 border border-gray-300 hover:bg-gray-50">
              {{ 'profile.deleteAccount.public.noAccess' | t }}
            </button>
          </div>
        </div>
      </div>
    </div>
  `
})
export class DeleteAccountInfoComponent {
  private dialog = inject(MatDialog);

  contactSupport() {
    this.dialog.open(SupportContactDialogComponent, {
      data: {
        subject: t('profile.deleteAccount.public.supportSubject'),
        message: t('profile.deleteAccount.public.supportMessage')
      },
      maxWidth: '95vw',
      autoFocus: false
    });
  }
}
