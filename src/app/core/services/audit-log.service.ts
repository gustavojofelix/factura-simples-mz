import { Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';

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
}
