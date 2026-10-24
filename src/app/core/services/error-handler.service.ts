import { Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { t } from '../i18n/i18n';

export interface AppError {
  type: 'auth' | 'network' | 'validation' | 'server' | 'unknown';
  message: string;
  originalError?: any;
}

@Injectable({ providedIn: 'root' })
export class ErrorHandlerService {

  /** Mensagem do Supabase → chave de tradução (errors.handler.*). */
  private errorMap: Record<string, string> = {
    // Supabase Auth errors
    'Invalid login credentials': 'errors.handler.invalidCredentials',
    'Email not confirmed': 'errors.handler.emailNotConfirmed',
    'User already registered': 'errors.handler.userRegistered',
    'Password should be at least 6 characters': 'errors.handler.passwordTooShort',
    'Unable to validate email address': 'errors.handler.invalidEmail',
    'Email rate limit exceeded': 'errors.handler.rateLimit',
    'New password should be different from the old password': 'errors.handler.samePassword',
    // Supabase DB errors
    'JWT expired': 'errors.handler.sessionExpired',
    'PGRST301': 'errors.handler.accessDenied',
    // Network
    'Failed to fetch': 'errors.handler.fetchFailed',
    'Load failed': 'errors.handler.loadFailed',
    'NetworkError': 'errors.handler.offline',
  };

  constructor(
    private snackBar: MatSnackBar,
    private router: Router
  ) {}

  /**
   * Classifies and handles an error, showing a user-friendly message.
   */
  handle(error: any, context?: string): AppError {
    const appError = this.classify(error);

    // Log in development
    if (!environment.production) {
      console.error(`[ErrorHandler${context ? ` — ${context}` : ''}]`, error);
    }

    // Handle auth errors by redirecting
    if (appError.type === 'auth') {
      this.snackBar.open(appError.message, t('common.actions.close'), { duration: 5000 });
      this.router.navigate(['/entrar']);
      return appError;
    }

    // Show user-friendly message
    this.snackBar.open(appError.message, t('common.actions.close'), { duration: 5000 });
    return appError;
  }

  /**
   * Classifies an error without showing UI feedback.
   */
  classify(error: any): AppError {
    if (!error) {
      return { type: 'unknown', message: t('errors.handler.unknown'), originalError: error };
    }

    const message = error?.message || error?.error_description || (typeof error === 'string' ? error : '');

    // Network errors
    if (message.includes('Failed to fetch') || message.includes('Load failed') || message.includes('NetworkError') || message.includes('ERR_CONNECTION')) {
      return {
        type: 'network',
        message: this.translate(message) || t('common.errors.network'),
        originalError: error
      };
    }

    // Auth errors (Supabase)
    if (error?.status === 401 || message.includes('JWT expired') || message.includes('Invalid login credentials') || message.includes('Email not confirmed')) {
      return {
        type: 'auth',
        message: this.translate(message) || t('errors.handler.authError'),
        originalError: error
      };
    }

    // Permission errors
    if (error?.status === 403 || error?.code === 'PGRST301') {
      return {
        type: 'auth',
        message: t('errors.handler.noPermission'),
        originalError: error
      };
    }

    // Server errors
    if (error?.status >= 500) {
      return {
        type: 'server',
        message: t('errors.handler.serverError'),
        originalError: error
      };
    }

    // Validation errors (Supabase PostgREST)
    if (error?.code?.startsWith('PGRST') || error?.code === '23505' || error?.code === '23503') {
      return {
        type: 'validation',
        message: this.translate(message) || t('errors.handler.validationError'),
        originalError: error
      };
    }

    // Generic Supabase error with message
    if (message) {
      return {
        type: 'unknown',
        message: this.translate(message) || message,
        originalError: error
      };
    }

    return { type: 'unknown', message: t('errors.unexpected'), originalError: error };
  }

  /**
   * Translates known error messages to the interface language.
   */
  translate(message: string): string | null {
    if (!message) return null;

    // Exact match
    if (this.errorMap[message]) {
      return t(this.errorMap[message]);
    }

    // Partial match
    for (const [key, value] of Object.entries(this.errorMap)) {
      if (message.includes(key)) {
        return t(value);
      }
    }

    return null;
  }
}
