import { Injectable, signal, computed, effect } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';

export interface Company {
  id: string;
  user_id: string;
  name: string;
  nuit: string;
  entity_type?: 'singular' | 'collective';
  address: string;
  phone?: string;
  email?: string;
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
  created_at: string;
  updated_at: string;
}

@Injectable({
  providedIn: 'root'
})
export class CompanyService {
  companies = signal<Company[]>([]);
  activeCompany = signal<Company | null>(null);
  isLoading = signal(false);

  constructor(
    private supabase: SupabaseService,
    private authService: AuthService
  ) {
    effect(() => {
      const user = this.authService.currentUser();
      if (user) {
        this.loadCompanies();
      } else {
        this.companies.set([]);
        this.activeCompany.set(null);
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
        this.setActiveCompany(company);
      }
    } catch (error) {
      console.error('Erro ao carregar empresas:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  setActiveCompany(company: Company) {
    this.activeCompany.set(company);
    localStorage.setItem('activeCompanyId', company.id);
  }

  async createCompany(companyData: Partial<Company>): Promise<Company | null> {
    const user = this.authService.currentUser();
    if (!user) return null;

    try {
      const { data, error } = await this.supabase.db
        .from('companies')
        .insert({
          ...companyData,
          user_id: user.id
        })
        .select()
        .single();

      if (error) throw error;

      this.companies.update(companies => [...companies, data]);
      this.setActiveCompany(data);

      return data;
    } catch (error) {
      console.error('Erro ao criar empresa:', error);
      return null;
    }
  }

  async updateCompany(id: string, updates: Partial<Company>): Promise<boolean> {
    try {
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

      return true;
    } catch (error) {
      console.error('Erro ao actualizar empresa:', error);
      return false;
    }
  }

  async deleteCompany(id: string): Promise<boolean> {
    try {
      const { error } = await this.supabase.db
        .from('companies')
        .delete()
        .eq('id', id);

      if (error) throw error;

      this.companies.update(companies => companies.filter(c => c.id !== id));

      if (this.activeCompany()?.id === id) {
        const remaining = this.companies();
        this.activeCompany.set(remaining.length > 0 ? remaining[0] : null);
      }

      return true;
    } catch (error) {
      console.error('Erro ao deletar empresa:', error);
      return false;
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

  isOwner(companyId: string): boolean {
    const user = this.authService.currentUser();
    if (!user) return false;

    const company = this.companies().find(c => c.id === companyId);
    return company?.user_id === user.id;
  }
}
