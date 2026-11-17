import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { currentLanguage, t } from '../i18n/i18n';
import { friendlyFunctionError } from '../utils/error-message';

export interface PendingDeletion {
  id: string;
  status: 'pending' | 'failed';
  scheduled_for: string;
}

/**
 * Eliminação de conta: pedido com código por email, 30 dias de carência e
 * cancelamento. A lógica está na Edge Function `delete-account`.
 */
@Injectable({ providedIn: 'root' })
export class AccountDeletionService {
  private supabase = inject(SupabaseService);
  /** Utilizador cujo estado já foi verificado (evita uma consulta por navegação). */
  private checkedUserId: string | null = null;
  private cached: PendingDeletion | null = null;

  /** Pedido confirmado e ainda por processar (null se não houver, ou sem rede). */
  async pendingDeletion(userId: string, force = false): Promise<PendingDeletion | null> {
    if (!force && this.checkedUserId === userId) return this.cached;
    try {
      const { data, error } = await this.supabase.db
        .from('account_deletion_requests')
        .select('id, status, scheduled_for')
        .eq('user_id', userId)
        .in('status', ['pending', 'failed'])
        .maybeSingle();
      if (error) throw error;
      this.cached = (data as PendingDeletion | null) ?? null;
      this.checkedUserId = userId;
      return this.cached;
    } catch {
      // Sem rede (modo offline) ou tabela indisponível: não bloqueia a aplicação.
      return null;
    }
  }

  /** Empresas que ficam encerradas se a conta for eliminada. */
  async ownedCompanyNames(userId: string): Promise<string[]> {
    const { data } = await this.supabase.db
      .from('companies')
      .select('name')
      .eq('user_id', userId)
      .is('closed_at', null)
      .order('name');
    return (data ?? []).map((c: { name: string }) => c.name);
  }

  async requestCode(): Promise<string> {
    const data = await this.invoke({ action: 'request_code' });
    return data.email as string;
  }

  async confirm(code: string): Promise<string> {
    const data = await this.invoke({ action: 'confirm', code });
    this.cached = null;
    this.checkedUserId = null;
    return data.scheduled_for as string;
  }

  async cancel(): Promise<void> {
    await this.invoke({ action: 'cancel' });
    this.cached = null;
    this.checkedUserId = null;
  }

  private async invoke(body: Record<string, unknown>): Promise<any> {
    const { data, error } = await this.supabase.client.functions.invoke('delete-account', {
      body: { ...body, language: currentLanguage() }
    });
    if (error) throw new Error(await friendlyFunctionError(error, t('profile.deleteAccount.errors.generic')));
    if (data?.success === false) throw new Error(data.error || t('profile.deleteAccount.errors.generic'));
    return data;
  }
}
