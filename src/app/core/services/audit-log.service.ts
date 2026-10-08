import { Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';

export interface AuditLogEntry {
  id: string;
  user_id: string | null;
  user_email: string | null;
  company_id: string | null;
  action: string;
  category: string;
  entity_id: string | null;
  entity_name: string | null;
  details: any;
  created_at: string;
  user_name?: string;
}

@Injectable({
  providedIn: 'root'
})
export class AuditLogService {
  private userIp = '';
  private ipResolved = false;

  constructor(private supabase: SupabaseService) {
    this.resolveIpAddress();
  }

  /**
   * Resolves the public IP address of the client using a free/secure service.
   * Caches in memory to avoid repeated requests.
   */
  async resolveIpAddress(): Promise<string> {
    if (this.ipResolved) return this.userIp;

    try {
      const response = await fetch('https://api.ipify.org?format=json');
      const data = await response.json();
      if (data && data.ip) {
        this.userIp = data.ip;
        this.ipResolved = true;
      }
    } catch (error) {
      console.warn('Failed to resolve IP address, falling back to localhost/desconhecido:', error);
      this.userIp = 'IP Desconhecido';
    }
    return this.userIp;
  }

  /**
   * Logs an action to the database.
   * 
   * @param action Description of the action (e.g. 'Criar Cliente', 'Submeter Declaração')
   * @param category Category of the action (e.g. 'auth', 'clients', 'products', 'invoices', 'reports', 'declarations', 'payments', 'settings', 'users', 'subscriptions')
   * @param details Optional JSON payload or differences (JSON-serializable object)
   * @param entityId ID of the affected entity
   * @param entityName Display name or reference code of the affected entity
   * @param companyId Associated company ID (optional, defaults to active company if applicable)
   */
  async log(
    action: string,
    category: string,
    details?: any,
    entityId?: string,
    entityName?: string,
    companyId?: string
  ): Promise<boolean> {
    try {
      const userRes = await this.supabase.auth.getUser();
      const user = userRes.data?.user;
      
      const ip = await this.resolveIpAddress();

      const logData: any = {
        action,
        category,
        user_id: user?.id || null,
        user_email: user?.email || null,
        ip_address: ip,
        details: details || null,
        entity_id: entityId || null,
        entity_name: entityName || null,
        company_id: companyId || null
      };

      const { error } = await this.supabase.db
        .from('audit_logs')
        .insert(logData);

      if (error) throw error;
      return true;
    } catch (error) {
      console.error('Failed to write audit log:', error);
      return false;
    }
  }

  /**
   * Returns the most recent audit entries of a company, with the actor's display name resolved.
   * RLS only returns rows to company owners/admins (and platform admins).
   */
  async getRecentLogs(companyId: string, limit = 6): Promise<AuditLogEntry[]> {
    const { data, error } = await this.supabase.db
      .from('audit_logs')
      .select('id, user_id, user_email, company_id, action, category, entity_id, entity_name, details, created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    const rows = (data || []) as AuditLogEntry[];
    const names = await this.resolveUserNames(rows.map(l => l.user_id));

    return rows.map(l => ({
      ...l,
      user_name: (l.user_id && names[l.user_id]?.full_name) || l.user_email || 'Sistema'
    }));
  }

  /**
   * audit_logs.user_id references auth.users (not profiles), so names cannot be
   * embedded by PostgREST and must be resolved with a second query.
   */
  async resolveUserNames(ids: (string | null)[]): Promise<Record<string, { full_name?: string; email?: string }>> {
    const uniqueIds = [...new Set(ids.filter((id): id is string => !!id))];
    if (uniqueIds.length === 0) return {};

    try {
      const { data, error } = await this.supabase.db
        .from('profiles')
        .select('id, full_name, email')
        .in('id', uniqueIds);

      if (error) throw error;

      const map: Record<string, { full_name?: string; email?: string }> = {};
      for (const p of data || []) {
        map[p.id] = { full_name: p.full_name || undefined, email: p.email || undefined };
      }
      return map;
    } catch (error) {
      console.warn('Failed to resolve audit log user names:', error);
      return {};
    }
  }
}
