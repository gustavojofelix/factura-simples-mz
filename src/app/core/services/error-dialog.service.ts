import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import {
  ErrorDialogComponent,
  ErrorDialogData,
  ErrorDialogDetail,
  ErrorDialogResult
} from '../../shared/components/error-dialog.component';
import { friendlyErrorMessage } from '../utils/error-message';
import { AuthService } from './auth.service';
import { currentLocale, t } from '../i18n/i18n';

export interface ErrorDialogOptions {
  /** Título do popup, ex.: "Não foi possível criar a empresa". */
  title?: string;
  /** Acção que falhou, incluída nos detalhes enviados ao suporte. */
  context?: string;
  /** Substitui a mensagem traduzida automaticamente a partir do erro. */
  message?: string;
  /** Mostra um botão de nova tentativa com este texto. */
  retryLabel?: string;
}

/**
 * Mostra erros num popup que não desaparece sozinho, com detalhes técnicos
 * e contacto com o suporte. Usar em vez de toasts para falhas que o
 * utilizador precisa de ler ou reportar.
 *
 *   const result = await this.errorDialog.show(error, { title: 'Não foi possível guardar' });
 *   if (result === 'retry') ...
 */
@Injectable({ providedIn: 'root' })
export class ErrorDialogService {
  private readonly dialog = inject(MatDialog);
  private readonly authService = inject(AuthService);

  show(error: unknown, options: ErrorDialogOptions = {}): Promise<ErrorDialogResult> {
    const data: ErrorDialogData = {
      title: options.title || t('errors.dialog.defaultTitle'),
      message: options.message || friendlyErrorMessage(error),
      details: this.collectDetails(error, options.context),
      retryLabel: options.retryLabel
    };

    const ref = this.dialog.open<ErrorDialogComponent, ErrorDialogData, ErrorDialogResult>(ErrorDialogComponent, {
      data,
      width: '520px',
      maxWidth: 'calc(100vw - 32px)',
      autoFocus: false,
      // Só fecha por acção explícita: o objectivo é dar tempo para ler.
      disableClose: true
    });

    return firstValueFrom(ref.afterClosed()).then(result => result ?? 'close');
  }

  private collectDetails(error: unknown, context?: string): ErrorDialogDetail[] {
    const err = (error ?? {}) as any;
    const details: ErrorDialogDetail[] = [];
    const add = (label: string, value: unknown) => {
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        details.push({ label, value: String(value) });
      }
    };

    add(t('errors.dialog.details.action'), context);
    if (typeof error === 'string') {
      add(t('errors.dialog.details.message'), error);
    } else {
      add(t('errors.dialog.details.code'), err.code);
      add(t('errors.dialog.details.detail'), err.details);
      add(t('errors.dialog.details.hint'), err.hint);
      add(t('errors.dialog.details.message'), err.message ?? err.error_description ?? err.error);
      add('HTTP', err.status);
    }
    add(t('errors.dialog.details.page'), window.location.href);
    add(t('errors.dialog.details.user'), this.authService.currentUser()?.email);
    add(t('errors.dialog.details.dateTime'), new Date().toLocaleString(currentLocale()));
    add(t('errors.dialog.details.browser'), navigator.userAgent);
    return details;
  }
}
