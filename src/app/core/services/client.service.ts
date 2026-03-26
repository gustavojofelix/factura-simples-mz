import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CompanyService } from './company.service';

export interface Client {
  id: string;
  client_code: string;
  company_id: string;
  name: string;
  nuit?: string;
  email?: string;
  phone?: string;
  address?: string;
  industry?: string;
  document_url?: string;
  document_type?: string;
  is_active: boolean;
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
  ) { }

  async loadClients() {
    const company = this.companyService.activeCompany();
    if (!company) return;

    this.isLoading.set(true);

    try {
      const { data, error } = await this.supabase.db
        .from('clients')
        .select('*')
        .eq('company_id', company.id)
        .order('client_code', { ascending: true });

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
          company_id: company.id,
          is_active: true
        })
        .select()
        .single();

      if (error) throw error;

      // Reload from server to get the trigger-assigned client_code and correct ordering
      await this.loadClients();
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

  async deleteClient(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Verificar se o cliente já possui facturas
      const used = await this.isClientUsed(id);
      if (used) {
        return {
          success: false,
          error: 'Este cliente possui facturas associadas e não pode ser eliminado. Desative-o em vez disso.'
        };
      }

      const { error } = await this.supabase.db
        .from('clients')
        .delete()
        .eq('id', id);

      if (error) throw error;

      this.clients.update(clients => clients.filter(c => c.id !== id));
      return { success: true };
    } catch (error: any) {
      console.error('Erro ao eliminar cliente:', error);
      return { success: false, error: 'Erro inesperado ao eliminar cliente' };
    }
  }

  async isClientUsed(clientId: string): Promise<boolean> {
    try {
      const { count, error } = await this.supabase.db
        .from('invoices')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', clientId);

      if (error) throw error;
      return (count || 0) > 0;
    } catch (error) {
      console.error('Erro ao verificar facturas do cliente:', error);
      return false;
    }
  }

  async toggleClientActiveStatus(id: string, currentStatus: boolean): Promise<boolean> {
    return this.updateClient(id, { is_active: !currentStatus });
  }

  async isNuitDuplicate(nuit: string, excludeClientId?: string): Promise<boolean> {
    const company = this.companyService.activeCompany();
    if (!company || !nuit) return false;

    try {
      let query = this.supabase.db
        .from('clients')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', company.id)
        .eq('nuit', nuit);

      if (excludeClientId) {
        query = query.not('id', 'eq', excludeClientId);
      }

      const { count, error } = await query;
      if (error) throw error;
      return (count || 0) > 0;
    } catch (error) {
      console.error('Erro ao verificar NUIT duplicado:', error);
      return false;
    }
  }

  getClientById(id: string): Client | undefined {
    return this.clients().find(c => c.id === id);
  }
}
