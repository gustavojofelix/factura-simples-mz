import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { LandingCmsService } from '../../core/services/landing-cms.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

export interface SupportContactDialogData {
  /** Assunto do email. */
  subject: string;
  /** Mensagem já preenchida (email e WhatsApp). */
  message: string;
}

/**
 * Canais de contacto com o apoio ao cliente (WhatsApp, telefone e email), com a
 * mensagem já preenchida. Um simples link mailto: não faz nada em dispositivos
 * sem aplicação de email configurada; aqui o utilizador tem sempre uma
 * alternativa, incluindo copiar o endereço e a mensagem.
 */
@Component({
  selector: 'app-support-contact-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatIconModule, TranslatePipe],
  template: `
    <div class="p-6 max-w-md">
      <div class="flex items-start gap-4">
        <div class="w-12 h-12 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
          <mat-icon class="!text-ispc-orange">support_agent</mat-icon>
        </div>
        <div class="min-w-0">
          <h2 class="text-lg font-bold text-gray-900">{{ 'common.support.title' | t }}</h2>
          <p class="mt-1 text-sm text-gray-600 leading-relaxed">{{ 'common.support.subtitle' | t }}</p>
        </div>
      </div>

      <div class="mt-5 space-y-2">
        @if (whatsappUrl(); as url) {
          <a [href]="url" target="_blank" rel="noopener"
            class="flex items-center gap-3 p-3 rounded-xl border border-emerald-200 bg-emerald-50/60 hover:bg-emerald-50 transition-colors">
            <mat-icon class="!text-emerald-600">chat</mat-icon>
            <span class="flex-1 min-w-0">
              <span class="block text-sm font-bold text-gray-900">WhatsApp</span>
              <span class="block text-xs text-gray-500 truncate">{{ contact().whatsapp }}</span>
            </span>
            <mat-icon class="!text-gray-400">open_in_new</mat-icon>
          </a>
        }

        @if (phoneUrl(); as url) {
          <a [href]="url"
            class="flex items-center gap-3 p-3 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors">
            <mat-icon class="!text-blue-600">call</mat-icon>
            <span class="flex-1 min-w-0">
              <span class="block text-sm font-bold text-gray-900">{{ 'common.support.call' | t }}</span>
              <span class="block text-xs text-gray-500 truncate">{{ contact().phone }}</span>
            </span>
          </a>
        }

        @if (contact().email) {
          <div class="flex items-center gap-3 p-3 rounded-xl border border-gray-200">
            <mat-icon class="!text-ispc-orange">mail</mat-icon>
            <a [href]="mailtoUrl()" class="flex-1 min-w-0 hover:underline">
              <span class="block text-sm font-bold text-gray-900">{{ 'common.support.email' | t }}</span>
              <span class="block text-xs text-gray-500 truncate">{{ contact().email }}</span>
            </a>
            <button type="button" (click)="copy('email', contact().email)"
              class="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700">
              <mat-icon class="!text-sm !w-4 !h-4 !leading-4">{{ copied() === 'email' ? 'check' : 'content_copy' }}</mat-icon>
              {{ (copied() === 'email' ? 'common.support.copied' : 'common.support.copy') | t }}
            </button>
          </div>
        }
      </div>

      <div class="mt-4 rounded-xl bg-gray-50 border border-gray-200 px-4 py-3">
        <div class="flex items-center justify-between gap-2 mb-1">
          <p class="text-xs font-semibold text-gray-500 uppercase tracking-wider">{{ 'common.support.messageLabel' | t }}</p>
          <button type="button" (click)="copy('message', data.message)"
            class="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700">
            <mat-icon class="!text-sm !w-4 !h-4 !leading-4">{{ copied() === 'message' ? 'check' : 'content_copy' }}</mat-icon>
            {{ (copied() === 'message' ? 'common.support.copied' : 'common.support.copy') | t }}
          </button>
        </div>
        <p class="text-sm text-gray-700 whitespace-pre-line">{{ data.message }}</p>
      </div>

      @if (contact().workHours) {
        <p class="mt-3 text-xs text-gray-500 flex items-center gap-1.5">
          <mat-icon class="!text-sm !w-4 !h-4 !leading-4">schedule</mat-icon>
          {{ contact().workHours }}
        </p>
      }

      <div class="mt-6">
        <button type="button" (click)="dialogRef.close()"
          class="w-full px-4 py-2.5 border border-gray-300 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50 transition-colors">
          {{ 'common.actions.close' | t }}
        </button>
      </div>
    </div>
  `
})
export class SupportContactDialogComponent {
  readonly data = inject<SupportContactDialogData>(MAT_DIALOG_DATA);
  readonly dialogRef = inject(MatDialogRef<SupportContactDialogComponent>);
  private readonly cms = inject(LandingCmsService);

  readonly contact = computed(() => this.cms.localizedContact());
  readonly copied = signal<'email' | 'message' | null>(null);

  readonly mailtoUrl = computed(() => {
    const subject = encodeURIComponent(this.data.subject);
    const body = encodeURIComponent(this.data.message);
    return `mailto:${this.contact().email}?subject=${subject}&body=${body}`;
  });

  readonly whatsappUrl = computed(() => {
    const digits = (this.contact().whatsapp || '').replace(/\D/g, '');
    if (!digits) return null;
    return `https://wa.me/${digits}?text=${encodeURIComponent(this.data.message)}`;
  });

  readonly phoneUrl = computed(() => {
    const phone = (this.contact().phone || '').replace(/[^\d+]/g, '');
    return phone ? `tel:${phone}` : null;
  });

  constructor() {
    // O contacto vem do CMS da landing; os valores por omissão servem até carregar.
    this.cms.loadAllContent().catch(() => {});
  }

  async copy(what: 'email' | 'message', text: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.copied.set(what);
      setTimeout(() => this.copied.set(null), 2000);
    } catch {
      // Sem acesso à área de transferência: o texto continua visível para copiar à mão.
    }
  }
}
