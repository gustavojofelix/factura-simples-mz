import { Injectable, signal, computed, effect } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';

export interface Company {
  id: string;
  user_id: string;
  name: string;
  nuit: string;
  address: string;
  phone?: string;
  email?: string;
  business_type: string;
  currency: string;
  invoice_prefix: string;
  invoice_number: number;
  logo_url?: string;
  bank_name?: string;
  bank_account?: string;
  bank_iban?: string;
  bank_swift?: string;
  nuit_document_url?: string;
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
      const { data, error } = await this.supabase.db
        .from('companies')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      this.companies.set(data || []);

      if (data && data.length > 0 && !this.activeCompany()) {
        const savedCompanyId = localStorage.getItem('activeCompanyId');
        const company = savedCompanyId
          ? data.find(c => c.id === savedCompanyId) || data[0]
          : data[0];
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
}
