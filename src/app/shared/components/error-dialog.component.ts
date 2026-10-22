import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { LandingCmsService } from '../../core/services/landing-cms.service';

export interface ErrorDialogDetail {
  label: string;
  value: string;
}

export interface ErrorDialogData {
  title: string;
  /** Mensagem já traduzida para o utilizador. */
  message: string;
  /** Linhas técnicas (código, detalhe, página, hora, ...) para o suporte. */
  details: ErrorDialogDetail[];
  /** Texto do botão de nova tentativa; sem ele o botão não aparece. */
  retryLabel?: string;
}

export type ErrorDialogResult = 'retry' | 'close';

/**
 * Popup de erro: mensagem legível, detalhes técnicos copiáveis e contacto
 * com o suporte (email/WhatsApp) já preenchido com esses detalhes.
 * Abrir através do ErrorDialogService.
 */
@Component({
  selector: 'app-error-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatIconModule],
  template: `
    <div class="p-6 max-w-lg">
      <div class="flex items-start gap-4">
        <div class="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center flex-shrink-0">
          <mat-icon class="!text-rose-600">error_outline</mat-icon>
        </div>
        <div class="min-w-0">
          <h2 class="text-lg font-bold text-gray-900">{{ data.title }}</h2>
          <p class="mt-1 text-sm text-gray-600 leading-relaxed whitespace-pre-line">{{ data.message }}</p>
        </div>
      </div>

      @if (data.details.length > 0) {
        <div class="mt-5 border border-gray-200 rounded-xl overflow-hidden">
          <button type="button"
            class="w-full flex items-center justify-between px-4 py-2.5 text-sm font-semibold text-gray-700 bg-gray-50 hover:bg-gray-100 transition-colors"
            (click)="showDetails.set(!showDetails())">
            <span class="flex items-center gap-2">
              <mat-icon class="!text-base !w-4 !h-4 !leading-4">code</mat-icon>
              Detalhes técnicos
            </span>
            <mat-icon class="!text-base !w-4 !h-4 !leading-4">{{ showDetails() ? 'expand_less' : 'expand_more' }}</mat-icon>
          </button>
          @if (showDetails()) {
            <dl class="px-4 py-3 space-y-1.5 text-xs bg-white max-h-56 overflow-auto">
              @for (detail of data.details; track detail.label) {
                <div class="flex gap-2">
                  <dt class="font-semibold text-gray-500 w-24 flex-shrink-0">{{ detail.label }}</dt>
                  <dd class="text-gray-800 font-mono break-all">{{ detail.value }}</dd>
                </div>
              }
            </dl>
            <div class="px-4 pb-3 bg-white">
              <button type="button"
                class="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700"
                (click)="copyDetails()">
                <mat-icon class="!text-sm !w-4 !h-4 !leading-4">{{ copied() ? 'check' : 'content_copy' }}</mat-icon>
                {{ copied() ? 'Copiado' : 'Copiar detalhes' }}
              </button>
            </div>
          }
        </div>
      }

      <div class="mt-5 rounded-xl bg-orange-50 border border-orange-100 px-4 py-3">
        <p class="text-sm text-gray-700">O problema continua? A nossa equipa de suporte pode ajudar.</p>
        <div class="mt-2 flex flex-wrap gap-2">
          <a [href]="mailtoUrl()"
            class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-orange-200 text-sm font-semibold text-ispc-orange hover:bg-orange-100 transition-colors">
            <mat-icon class="!text-base !w-4 !h-4 !leading-4">mail</mat-icon>
            Enviar email
          </a>
          @if (whatsappUrl(); as url) {
            <a [href]="url" target="_blank" rel="noopener"
              class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-emerald-200 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 transition-colors">
              <mat-icon class="!text-base !w-4 !h-4 !leading-4">chat</mat-icon>
              WhatsApp
            </a>
          }
        </div>
      </div>

      <div class="mt-6 flex gap-3">
        <button type="button" (click)="close('close')"
          class="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50 transition-colors">
          Fechar
        </button>
        @if (data.retryLabel) {
          <button type="button" (click)="close('retry')"
            class="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-ispc-orange hover:opacity-90 transition-opacity">
            {{ data.retryLabel }}
          </button>
        }
      </div>
    </div>
  `
})
export class ErrorDialogComponent {
  readonly data = inject<ErrorDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<ErrorDialogComponent, ErrorDialogResult>);
  private readonly cms = inject(LandingCmsService);

  readonly showDetails = signal(false);
  readonly copied = signal(false);

  private readonly reportText = computed(() => [
    `Erro: ${this.data.title}`,
    `Mensagem: ${this.data.message}`,
    '',
    ...this.data.details.map(d => `${d.label}: ${d.value}`)
  ].join('\n'));

  readonly mailtoUrl = computed(() => {
    const email = this.cms.contact().email;
    const subject = encodeURIComponent(`Pedido de suporte: ${this.data.title}`);
    const body = encodeURIComponent(`Olá, encontrei este erro no ISPC Fácil:\n\n${this.reportText()}\n`);
    return `mailto:${email}?subject=${subject}&body=${body}`;
  });

  readonly whatsappUrl = computed(() => {
    const digits = (this.cms.contact().whatsapp || '').replace(/\D/g, '');
    if (!digits) return null;
    const text = encodeURIComponent(`Olá, encontrei este erro no ISPC Fácil:\n\n${this.reportText()}`);
    return `https://wa.me/${digits}?text=${text}`;
  });

  constructor() {
    // O contacto vem do CMS da landing; os valores por omissão servem até carregar.
    this.cms.loadAllContent().catch(() => {});
  }

  async copyDetails() {
    try {
      await navigator.clipboard.writeText(this.reportText());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      // Sem acesso à área de transferência: os detalhes continuam visíveis para copiar à mão.
    }
  }

  close(result: ErrorDialogResult) {
    this.dialogRef.close(result);
  }
}
