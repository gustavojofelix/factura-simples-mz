import { Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';

export interface AppError {
  type: 'auth' | 'network' | 'validation' | 'server' | 'unknown';
  message: string;
  originalError?: any;
}

@Injectable({ providedIn: 'root' })
export class ErrorHandlerService {

  private errorMap: Record<string, string> = {
    // Supabase Auth errors
    'Invalid login credentials': 'Email ou palavra-passe incorretos',
    'Email not confirmed': 'Email não confirmado. Verifique a sua caixa de entrada.',
    'User already registered': 'Este email já está registado',
    'Password should be at least 6 characters': 'A palavra-passe deve ter pelo menos 6 caracteres',
    'Unable to validate email address': 'Endereço de email inválido',
    'Email rate limit exceeded': 'Demasiadas tentativas. Tente novamente mais tarde.',
    'New password should be different from the old password': 'A nova palavra-passe deve ser diferente da anterior',
    // Supabase DB errors
    'JWT expired': 'A sua sessão expirou. Por favor, entre novamente.',
    'PGRST301': 'Acesso negado. Não tem permissão para esta acção.',
    // Network
    'Failed to fetch': 'Erro de ligação ao servidor. Verifique a sua internet.',
    'Load failed': 'Falha ao carregar dados. Verifique a sua ligação.',
    'NetworkError': 'Sem ligação à internet.',
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
      this.snackBar.open(appError.message, 'Fechar', { duration: 5000 });
      this.router.navigate(['/entrar']);
      return appError;
    }

    // Show user-friendly message
    this.snackBar.open(appError.message, 'Fechar', { duration: 5000 });
    return appError;
  }

  /**
   * Classifies an error without showing UI feedback.
   */
  classify(error: any): AppError {
    if (!error) {
      return { type: 'unknown', message: 'Erro desconhecido', originalError: error };
    }

    const message = error?.message || error?.error_description || (typeof error === 'string' ? error : '');

    // Network errors
    if (message.includes('Failed to fetch') || message.includes('Load failed') || message.includes('NetworkError') || message.includes('ERR_CONNECTION')) {
      return {
        type: 'network',
        message: this.translate(message) || 'Erro de ligação. Verifique a sua internet.',
        originalError: error
      };
    }

    // Auth errors (Supabase)
    if (error?.status === 401 || message.includes('JWT expired') || message.includes('Invalid login credentials') || message.includes('Email not confirmed')) {
      return {
        type: 'auth',
        message: this.translate(message) || 'Erro de autenticação.',
        originalError: error
      };
    }

    // Permission errors
    if (error?.status === 403 || error?.code === 'PGRST301') {
      return {
        type: 'auth',
        message: 'Não tem permissão para esta acção.',
        originalError: error
      };
    }

    // Server errors
    if (error?.status >= 500) {
      return {
        type: 'server',
        message: 'Erro no servidor. Tente novamente mais tarde.',
        originalError: error
      };
    }

    // Validation errors (Supabase PostgREST)
    if (error?.code?.startsWith('PGRST') || error?.code === '23505' || error?.code === '23503') {
      return {
        type: 'validation',
        message: this.translate(message) || 'Erro de validação dos dados.',
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

    return { type: 'unknown', message: 'Ocorreu um erro inesperado.', originalError: error };
  }

  /**
   * Translates known error messages to Portuguese.
   */
  translate(message: string): string | null {
    if (!message) return null;

    // Exact match
    if (this.errorMap[message]) {
      return this.errorMap[message];
    }

    // Partial match
    for (const [key, value] of Object.entries(this.errorMap)) {
      if (message.includes(key)) {
        return value;
      }
    }

    return null;
  }
}
