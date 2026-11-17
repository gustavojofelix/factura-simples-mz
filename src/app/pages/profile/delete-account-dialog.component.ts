import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AccountDeletionService } from '../../core/services/account-deletion.service';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

export interface DeleteAccountDialogData {
  /** Empresas do utilizador que ficam encerradas (vazio para membros convidados). */
  companies: string[];
}

/**
 * Eliminação de conta em dois passos: (1) consequências + escrever ELIMINAR,
 * (2) código de 6 dígitos enviado por email. Devolve a data agendada.
 */
@Component({
  selector: 'app-delete-account-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatIconModule, MatProgressSpinnerModule, TranslatePipe],
  template: `
    <div class="p-6 max-w-md">
      <div class="flex items-start gap-4">
        <div class="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center flex-shrink-0">
          <mat-icon class="!text-rose-600">delete_forever</mat-icon>
        </div>
        <div class="min-w-0">
          <h2 class="text-lg font-bold text-gray-900">{{ 'profile.deleteAccount.dialogTitle' | t }}</h2>
          <p class="mt-1 text-sm text-gray-600">{{ 'profile.deleteAccount.dialogSubtitle' | t }}</p>
        </div>
      </div>

      @if (step() === 'info') {
        <ul class="mt-5 space-y-2 text-sm text-gray-700">
          @if (data.companies.length) {
            <li class="flex gap-2">
              <mat-icon class="!text-base !w-4 !h-4 text-rose-500 flex-shrink-0 mt-0.5">business</mat-icon>
              <span>{{ 'profile.deleteAccount.consequences.companies' | t: { companies: data.companies.join(', ') } }}</span>
            </li>
            <li class="flex gap-2">
              <mat-icon class="!text-base !w-4 !h-4 text-rose-500 flex-shrink-0 mt-0.5">group_off</mat-icon>
              <span>{{ 'profile.deleteAccount.consequences.members' | t }}</span>
            </li>
            <li class="flex gap-2">
              <mat-icon class="!text-base !w-4 !h-4 text-rose-500 flex-shrink-0 mt-0.5">money_off</mat-icon>
              <span>{{ 'profile.deleteAccount.consequences.subscription' | t }}</span>
            </li>
          } @else {
            <li class="flex gap-2">
              <mat-icon class="!text-base !w-4 !h-4 text-rose-500 flex-shrink-0 mt-0.5">logout</mat-icon>
              <span>{{ 'profile.deleteAccount.consequences.memberAccess' | t }}</span>
            </li>
          }
          <li class="flex gap-2">
            <mat-icon class="!text-base !w-4 !h-4 text-rose-500 flex-shrink-0 mt-0.5">person_off</mat-icon>
            <span>{{ 'profile.deleteAccount.consequences.personalData' | t }}</span>
          </li>
          <li class="flex gap-2">
            <mat-icon class="!text-base !w-4 !h-4 text-gray-500 flex-shrink-0 mt-0.5">inventory_2</mat-icon>
            <span>{{ 'profile.deleteAccount.consequences.retention' | t }}</span>
          </li>
          <li class="flex gap-2">
            <mat-icon class="!text-base !w-4 !h-4 text-gray-500 flex-shrink-0 mt-0.5">schedule</mat-icon>
            <span>{{ 'profile.deleteAccount.consequences.grace' | t }}</span>
          </li>
        </ul>

        @if (data.companies.length) {
          <div class="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-900">
            {{ 'profile.deleteAccount.exportHint' | t }}
            <button type="button" class="font-semibold underline ml-1" (click)="goToExport()">
              {{ 'profile.deleteAccount.exportLink' | t }}
            </button>
          </div>
        }

        <label class="block mt-5 text-sm font-medium text-gray-700">
          {{ 'profile.deleteAccount.typeToConfirm' | t: { word: confirmWord } }}
        </label>
        <input
          type="text"
          [(ngModel)]="typed"
          autocomplete="off"
          autocapitalize="characters"
          class="mt-1 w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-rose-300"
          [placeholder]="confirmWord"
        />
      } @else {
        <p class="mt-5 text-sm text-gray-700">
          {{ 'profile.deleteAccount.codeSent' | t: { email: email() } }}
        </p>
        <input
          type="text"
          inputmode="numeric"
          maxlength="6"
          [(ngModel)]="code"
          autocomplete="one-time-code"
          class="mt-3 w-full px-3 py-3 border border-gray-300 rounded-xl text-center text-2xl tracking-[0.5em] font-bold focus:outline-none focus:ring-2 focus:ring-rose-300"
          placeholder="000000"
        />
        <button type="button" class="mt-2 text-sm text-gray-600 underline disabled:opacity-50"
          [disabled]="busy()" (click)="sendCode()">
          {{ 'profile.deleteAccount.resend' | t }}
        </button>
      }

      @if (error()) {
        <p class="mt-3 text-sm text-rose-600">{{ error() }}</p>
      }

      <div class="mt-6 flex gap-3">
        <button type="button" (click)="ref.close()"
          class="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50">
          {{ 'common.actions.cancel' | t }}
        </button>
        @if (step() === 'info') {
          <button type="button" (click)="sendCode()" [disabled]="!wordMatches() || busy()"
            class="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 flex items-center justify-center gap-2">
            @if (busy()) { <mat-spinner diameter="18"></mat-spinner> }
            {{ 'profile.deleteAccount.sendCode' | t }}
          </button>
        } @else {
          <button type="button" (click)="confirm()" [disabled]="code.trim().length !== 6 || busy()"
            class="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 flex items-center justify-center gap-2">
            @if (busy()) { <mat-spinner diameter="18"></mat-spinner> }
            {{ 'profile.deleteAccount.confirm' | t }}
          </button>
        }
      </div>
    </div>
  `
})
export class DeleteAccountDialogComponent {
  readonly data = inject<DeleteAccountDialogData>(MAT_DIALOG_DATA);
  readonly ref = inject<MatDialogRef<DeleteAccountDialogComponent, string>>(MatDialogRef);
  private deletion = inject(AccountDeletionService);
  private router = inject(Router);

  readonly confirmWord = t('profile.deleteAccount.confirmWord');
  step = signal<'info' | 'code'>('info');
  busy = signal(false);
  error = signal('');
  email = signal('');
  typed = '';
  code = '';

  wordMatches(): boolean {
    return this.typed.trim().toUpperCase() === this.confirmWord.toUpperCase();
  }

  goToExport() {
    this.ref.close();
    this.router.navigate(['/relatorios/saft']);
  }

  async sendCode() {
    if (this.step() === 'info' && !this.wordMatches()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      this.email.set(await this.deletion.requestCode());
      this.step.set('code');
    } catch (e: any) {
      this.error.set(e?.message || t('profile.deleteAccount.errors.generic'));
    } finally {
      this.busy.set(false);
    }
  }

  async confirm() {
    this.busy.set(true);
    this.error.set('');
    try {
      const scheduledFor = await this.deletion.confirm(this.code.trim());
      this.ref.close(scheduledFor);
    } catch (e: any) {
      this.error.set(e?.message || t('profile.deleteAccount.errors.generic'));
    } finally {
      this.busy.set(false);
    }
  }
}
