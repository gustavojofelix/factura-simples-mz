import { Injectable, signal, computed, effect } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { AuditLogService } from './audit-log.service';

export interface Company {
  id: string;
  user_id: string;
  name: string;
  nuit: string;
  entity_type?: 'singular' | 'collective';
  address: string;
  country?: string;
  postal_code?: string;
  phone?: string;
  email: string;
  currency: string;
  invoice_prefix: string;
  invoice_number: number;
  logo_url?: string;
  nuit_document_url?: string;
  commercial_activity_document_url?: string;
  category1?: string;
  category2?: string;
  category3?: string;
  business_volume?: string;
  bank_name?: string;
  bank_account?: string;
  bank_iban?: string;
  bank_swift?: string;
  documents_metadata?: {
    province?: string;
    district?: string;
    administrativePost?: string;
  };
  status?: 'active' | 'suspended' | 'trial';
  created_at: string;
  updated_at: string;
}

@Injectable({
  providedIn: 'root'
})
export class CompanyService {
  companies = signal<Company[]>([]);
  activeCompany = signal<Company | null>(null);
  activeRole = signal<string | null>(null);
  isLoading = signal(false);

  isCompanySuspended = computed(() => this.activeCompany()?.status === 'suspended');

  constructor(
    private supabase: SupabaseService,
    private authService: AuthService,
    private auditLogService: AuditLogService
  ) {
    effect(() => {
      const user = this.authService.currentUser();
      if (user) {
        this.loadCompanies();
      } else {
        this.companies.set([]);
        this.activeCompany.set(null);
        this.activeRole.set(null);
      }
    }, { allowSignalWrites: true });
  }

  async loadCompanies() {
    const user = this.authService.currentUser();
    if (!user) return;

    this.isLoading.set(true);

    try {
      const { data: ownedCompanies, error: ownedError } = await this.supabase.db
        .from('companies')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (ownedError) throw ownedError;

      const { data: sharedCompanies, error: sharedError } = await this.supabase.db
        .from('company_users')
        .select('company_id, companies(*)')
        .eq('user_id', user.id)
        .neq('role', 'owner');

      if (sharedError) throw sharedError;

      const shared = (sharedCompanies || [])
        .map((cu: any) => cu.companies)
        .filter((c: any) => c !== null);

      const allCompanies = [...(ownedCompanies || []), ...shared];
      this.companies.set(allCompanies);

      if (allCompanies.length > 0 && !this.activeCompany()) {
        const savedCompanyId = localStorage.getItem('activeCompanyId');
        const company = savedCompanyId
          ? allCompanies.find(c => c.id === savedCompanyId) || allCompanies[0]
          : allCompanies[0];
        await this.setActiveCompany(company);
      }
    } catch (error) {
      console.error('Erro ao carregar empresas:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  async setActiveCompany(company: Company) {
    this.activeCompany.set(company);
    localStorage.setItem('activeCompanyId', company.id);
    this.activeRole.set(null);
    try {
      const role = await this.getUserRole(company.id);
      this.activeRole.set(role);
    } catch (error) {
      console.error('Erro ao buscar cargo do utilizador:', error);
    }
  }

  async createCompany(companyData: Partial<Company>): Promise<Company | null> {
    const user = this.authService.currentUser();
    if (!user) return null;

    const { data, error } = await this.supabase.db
      .from('companies')
      .insert({
        ...companyData,
        user_id: user.id
      })
      .select()
      .single();

    // Re-throw so callers can inspect the error code (e.g. SUBSCRIPTION_FEATURE_DISABLED)
    if (error) throw error;

    this.companies.update(companies => [...companies, data]);
    await this.setActiveCompany(data);

    await this.auditLogService.log(
      'Criou Empresa',
      'settings',
      { company_name: data.name, nuit: data.nuit },
      data.id,
      data.name,
      data.id
    );

    return data;
  }

  async updateCompany(id: string, updates: Partial<Company>, skipAuditLog = false): Promise<boolean> {
    try {
      const oldCompany = this.companies().find(c => c.id === id);
      const { error } = await this.supabase.db
        .from('companies')
        .update(updates)
        .eq('id', id);

      if (error) throw error;

      this.companies.update(companies =>
        companies.map(c => c.id === id ? { ...c, ...updates } : c)
      );

      if (this.activeCompany()?.id === id) {
        this.activeCompany.update(c => c ? { ...c, ...updates } : null);
      }

      if (!skipAuditLog) {
        await this.auditLogService.log(
          'Atualizou Configurações da Empresa',
          'settings',
          { updates, old: oldCompany ? { name: oldCompany.name, nuit: oldCompany.nuit } : null },
          id,
          updates.name || oldCompany?.name,
          id
        );
      }

      return true;
    } catch (error) {
      console.error('Erro ao actualizar empresa:', error);
      return false;
    }
  }

  async deleteCompany(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      const oldCompany = this.companies().find(c => c.id === id);
      // 1. Check for dependent records
      const checks = [
        { table: 'invoices', label: 'facturas' },
        { table: 'products', label: 'produtos' },
        { table: 'clients', label: 'clientes' },
        { table: 'tax_declarations', label: 'declarações' }
      ];

      for (const check of checks) {
        const { count, error: countError } = await this.supabase.db
          .from(check.table)
          .select('*', { count: 'exact', head: true })
          .eq('company_id', id);

        if (countError) throw countError;

        if (count && count > 0) {
          return { 
            success: false, 
            error: `Não é possível eliminar uma empresa que já possui registos (${check.label}).` 
          };
        }
      }

      // 2. Perform deletion if no records found
      const { error } = await this.supabase.db
        .from('companies')
        .delete()
        .eq('id', id);

      if (error) throw error;

      this.companies.update(companies => companies.filter(c => c.id !== id));

      if (this.activeCompany()?.id === id) {
        const remaining = this.companies();
        if (remaining.length > 0) {
          await this.setActiveCompany(remaining[0]);
        } else {
          this.activeCompany.set(null);
          this.activeRole.set(null);
        }
      }

      await this.auditLogService.log(
        'Eliminou Empresa',
        'settings',
        { company_name: oldCompany?.name, nuit: oldCompany?.nuit },
        id,
        oldCompany?.name,
        id
      );

      return { success: true };
    } catch (error: any) {
      console.error('Erro ao deletar empresa:', error);
      return { success: false, error: error.message || 'Erro ao eliminar empresa' };
    }
  }

  async getUserRole(companyId: string): Promise<string | null> {
    const user = this.authService.currentUser();
    if (!user) return null;

    const company = this.companies().find(c => c.id === companyId);
    if (company?.user_id === user.id) return 'owner';

    const { data, error } = await this.supabase.db
      .from('company_users')
      .select('role')
      .eq('company_id', companyId)
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return data.role;
  }

  /**
   * Verifica se um NUIT já está registado por qualquer entidade da plataforma.
   * O RLS impede o cliente de consultar empresas de outros subscritores, pelo
   * que a verificação é delegada numa RPC que devolve apenas sim/não.
   *
   * Em caso de falha de rede devolve `true` (disponível) — o trigger
   * `enforce_company_nuit_unique` é a garantia final no servidor.
   */
  async isNuitAvailable(nuit: string, excludeCompanyId?: string): Promise<boolean> {
    const clean = (nuit || '').replace(/\D/g, '');
    if (clean.length !== 9) return true;

    const { data, error } = await this.supabase.db.rpc('is_company_nuit_available', {
      p_nuit: clean,
      p_exclude_company_id: excludeCompanyId ?? null
    });

    if (error) {
      console.warn('Não foi possível verificar o NUIT antecipadamente:', error.message);
      return true;
    }

    return data !== false;
  }

  /** Mensagem legível para o erro de NUIT duplicado devolvido pelo servidor. */
  static isDuplicateNuitError(error: any): boolean {
    return error?.details === 'DUPLICATE_COMPANY_NUIT';
  }

  isOwner(companyId: string): boolean {
    const user = this.authService.currentUser();
    if (!user) return false;

    const company = this.companies().find(c => c.id === companyId);
    return company?.user_id === user.id;
  }
}

