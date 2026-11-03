import { Injectable, signal } from '@angular/core';
import { createClient, RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { currentLocale } from '../i18n/i18n';

/**
 * Ligação do terminal POS ao servidor.
 *
 * O terminal tem a sua própria sessão Supabase (utilizador técnico criado no
 * emparelhamento), guardada à parte da sessão da aplicação: abrir o /pos no
 * mesmo browser não troca o utilizador da aplicação, e vice-versa. Esse
 * utilizador só chega aos dados através das funções pos_* (SECURITY DEFINER).
 */

const AUTH_STORAGE_KEY = 'ispc-pos-terminal-auth';
const OPERATOR_KEY = 'ispc-pos-operator';

/** Códigos que o servidor devolve em DETAIL para o POS reagir. */
export type PosErrorCode =
  | 'POS_AUTH_REQUIRED'
  | 'POS_AUTH_INVALID'
  | 'POS_TERMINAL_REVOKED'
  | 'POS_OPERATOR_EXPIRED'
  | 'POS_NOT_ALLOWED'
  | 'POS_NO_SESSION'
  | 'POS_PAYMENT_NOT_CONFIRMED'
  | 'POS_PAYMENT_SHORT'
  | 'POS_OPEN_ORDERS'
  | 'POS_PENDING_PAYMENTS'
  | 'POS_DIFFERENCE_NOTES'
  | 'POS_REASON_REQUIRED'
  | 'POS_ORDER_CLOSED'
  | 'POS_TABLE_BUSY'
  | 'POS_UNAVAILABLE'
  | 'POS_STAFF_LOCKED'
  | 'POS_NO_PIN'
  | 'SUBSCRIPTION_EXPIRED'
  | 'NETWORK'
  | 'UNKNOWN';

export class PosApiError extends Error {
  constructor(message: string, readonly code: PosErrorCode | string, readonly hint?: string) {
    super(message);
  }
}

export interface PosOperatorToken {
  token: string;
  expires_at: string;
  staff: { id: string; name: string; role: 'cashier' | 'waiter' | 'manager'; color: string; permissions: Record<string, unknown> };
}

@Injectable({ providedIn: 'root' })
export class PosApiService {
  readonly client: SupabaseClient = createClient(environment.supabaseUrl, environment.supabaseKey, {
    auth: {
      storageKey: AUTH_STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      lock: async (_name: string, _timeout: number, fn: () => Promise<any>) => await fn()
    }
  });

  readonly operator = signal<PosOperatorToken | null>(this.readOperator());

  async isPaired(): Promise<boolean> {
    const { data } = await this.client.auth.getSession();
    return !!data.session && data.session.user.app_metadata?.['kind'] === 'pos_terminal';
  }

  /** Troca o código de 8 caracteres pela sessão do terminal. */
  async pair(code: string): Promise<{ terminal: { id: string; name: string }; company: { name: string } }> {
    const { data, error } = await this.client.functions.invoke('pos-pair-terminal', {
      body: { code, language: currentLocale(), device: navigator.userAgent }
    });
    if (error || !data?.session) {
      let message = data?.error as string | undefined;
      if (!message && error && 'context' in error) {
        try { message = (await (error as { context: Response }).context.json())?.error; } catch { /* corpo sem JSON */ }
      }
      throw new PosApiError(message || 'Não foi possível emparelhar este dispositivo.', 'UNKNOWN');
    }
    const { error: sessionError } = await this.client.auth.setSession(data.session);
    if (sessionError) throw new PosApiError(sessionError.message, 'UNKNOWN');
    this.setOperator(null);
    return data;
  }

  async unpair() {
    this.setOperator(null);
    await this.client.auth.signOut({ scope: 'local' }).catch(() => undefined);
  }

  setOperator(value: PosOperatorToken | null) {
    this.operator.set(value);
    try {
      if (value) localStorage.setItem(OPERATOR_KEY, JSON.stringify(value));
      else localStorage.removeItem(OPERATOR_KEY);
    } catch { /* armazenamento indisponível */ }
  }

  get token(): string {
    return this.operator()?.token ?? '';
  }

  /** Chama uma função pos_* e converte o erro do Postgres num PosApiError. */
  async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new PosApiError('Sem ligação à internet. A venda não foi registada; tente quando a rede voltar.', 'NETWORK');
    }
    const { data, error } = await this.client.rpc(fn, args);
    if (error) {
      const code = (error.details as string) || (error.message?.includes('Failed to fetch') ? 'NETWORK' : 'UNKNOWN');
      if (code === 'POS_OPERATOR_EXPIRED') this.setOperator(null);
      throw new PosApiError(
        code === 'NETWORK' ? 'Sem ligação ao servidor. Verifique a internet e tente novamente.' : error.message,
        code,
        error.hint ?? undefined
      );
    }
    return data as T;
  }

  /** Chamada com o token do operador como primeiro argumento (p_token). */
  op<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    return this.rpc<T>(fn, { p_token: this.token, ...args });
  }

  /** Avisos em tempo real das mesas da empresa (o RLS limita à empresa do terminal). */
  watchOrders(companyId: string, onChange: () => void): RealtimeChannel {
    return this.client
      .channel(`pos-orders-${companyId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pos_orders', filter: `company_id=eq.${companyId}` }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pos_order_lines', filter: `company_id=eq.${companyId}` }, onChange)
      .subscribe();
  }

  private readOperator(): PosOperatorToken | null {
    try {
      const raw = localStorage.getItem(OPERATOR_KEY);
      const value = raw ? JSON.parse(raw) as PosOperatorToken : null;
      return value && new Date(value.expires_at) > new Date() ? value : null;
    } catch {
      return null;
    }
  }
}
