import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuditLogService } from './audit-log.service';

/**
 * Dados de demonstração do período de teste: dados da empresa, clientes,
 * produtos e facturas de exemplo, carregados no registo (seed_demo_data).
 * Remover (remove_demo_data) apaga TUDO o que a empresa tem, incluindo o que o
 * utilizador criou durante os testes, e repõe os dados da empresa em branco.
 */
@Injectable({
  providedIn: 'root'
})
export class DemoDataService {
  /** A empresa activa tem dados de demonstração. */
  hasDemoData = signal(false);
  private checkedCompanyId: string | null = null;

  constructor(
    private supabase: SupabaseService,
    private auditLogService: AuditLogService
  ) {}

  async refresh(companyId: string | null): Promise<void> {
    this.checkedCompanyId = companyId;
    if (!companyId) {
      this.hasDemoData.set(false);
      return;
    }
    // Os clientes demo só desaparecem com remove_demo_data (as facturas demo usam-nos).
    const { count, error } = await this.supabase.db
      .from('clients')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('is_demo', true);
    if (this.checkedCompanyId !== companyId) return;
    this.hasDemoData.set(!error && (count ?? 0) > 0);
  }

  async remove(companyId: string, companyName: string): Promise<void> {
    const { data, error } = await this.supabase.db.rpc('remove_demo_data', { p_company_id: companyId });
    if (error) throw error;
    this.hasDemoData.set(false);
    await this.auditLogService.log(
      'Removeu Dados de Demonstração',
      'settings',
      data ?? {},
      companyId,
      companyName,
      companyId
    );
  }
}
