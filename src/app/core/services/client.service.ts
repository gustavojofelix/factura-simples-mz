import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CompanyService } from './company.service';

export interface Client {
  id: string;
  company_id: string;
  name: string;
  nuit?: string;
  email?: string;
  phone?: string;
  address?: string;
  document_url?: string;
  document_type?: string;
  created_at: string;
}

@Injectable({
  providedIn: 'root'
})
export class ClientService {
  clients = signal<Client[]>([]);
  isLoading = signal(false);

  constructor(
    private supabase: SupabaseService,
    private companyService: CompanyService
  ) {}

  async loadClients() {
    const company = this.companyService.activeCompany();
    if (!company) return;

    this.isLoading.set(true);

    try {
      const { data, error } = await this.supabase.db
        .from('clients')
        .select('*')
        .eq('company_id', company.id)
        .order('name', { ascending: true });

      if (error) throw error;

      this.clients.set(data || []);
    } catch (error) {
      console.error('Erro ao carregar clientes:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  async createClient(clientData: Omit<Client, 'id' | 'company_id' | 'created_at'>): Promise<Client | null> {
    const company = this.companyService.activeCompany();
    if (!company) return null;

    try {
      const { data, error } = await this.supabase.db
        .from('clients')
        .insert({
          ...clientData,
          company_id: company.id
        })
        .select()
        .single();

      if (error) throw error;

      this.clients.update(clients => [data, ...clients]);
      return data;
    } catch (error) {
      console.error('Erro ao criar cliente:', error);
      return null;
    }
  }

  async updateClient(id: string, updates: Partial<Client>): Promise<boolean> {
    try {
      const { error } = await this.supabase.db
        .from('clients')
        .update(updates)
        .eq('id', id);

      if (error) throw error;

      this.clients.update(clients =>
        clients.map(c => c.id === id ? { ...c, ...updates } : c)
      );

      return true;
    } catch (error) {
      console.error('Erro ao actualizar cliente:', error);
      return false;
    }
  }

  async deleteClient(id: string): Promise<boolean> {
    try {
      const { error } = await this.supabase.db
        .from('clients')
        .delete()
        .eq('id', id);

      if (error) throw error;

      this.clients.update(clients => clients.filter(c => c.id !== id));
      return true;
    } catch (error) {
      console.error('Erro ao eliminar cliente:', error);
      return false;
    }
  }

  getClientById(id: string): Client | undefined {
    return this.clients().find(c => c.id === id);
  }
}
