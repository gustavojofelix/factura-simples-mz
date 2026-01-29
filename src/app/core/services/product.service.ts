import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CompanyService } from './company.service';

export interface Product {
  id: string;
  code: number;
  company_id: string;
  name: string;
  description?: string;
  price: number;
  type: 'produto' | 'servico';
  stock?: number;
  unit?: string;
  is_active: boolean;
  created_at: string;
}

@Injectable({
  providedIn: 'root'
})
export class ProductService {
  products = signal<Product[]>([]);
  isLoading = signal(false);

  constructor(
    private supabase: SupabaseService,
    private companyService: CompanyService
  ) {}

  async loadProducts() {
    const company = this.companyService.activeCompany();
    if (!company) return;

    this.isLoading.set(true);

    try {
      const { data, error } = await this.supabase.db
        .from('products')
        .select('*')
        .eq('company_id', company.id)
        .order('name', { ascending: true });

      if (error) throw error;

      this.products.set(data || []);
    } catch (error) {
      console.error('Erro ao carregar produtos:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  async createProduct(productData: Omit<Product, 'id' | 'company_id' | 'created_at'>): Promise<Product | null> {
    const company = this.companyService.activeCompany();
    if (!company) return null;

    try {
      const { data, error } = await this.supabase.db
        .from('products')
        .insert({
          ...productData,
          company_id: company.id,
          is_active: true
        })
        .select()
        .single();

      if (error) throw error;

      this.products.update(products => [data, ...products]);
      return data;
    } catch (error) {
      console.error('Erro ao criar produto:', error);
      return null;
    }
  }

  async updateProduct(id: string, updates: Partial<Product>): Promise<boolean> {
    try {
      const { error } = await this.supabase.db
        .from('products')
        .update(updates)
        .eq('id', id);

      if (error) throw error;

      this.products.update(products =>
        products.map(p => p.id === id ? { ...p, ...updates } : p)
      );

      return true;
    } catch (error) {
      console.error('Erro ao actualizar produto:', error);
      return false;
    }
  }

  async deleteProduct(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Verificar se o produto já foi vendido
      const sold = await this.isProductSold(id);
      if (sold) {
        return { 
          success: false, 
          error: 'Este item já possui vendas registadas e não pode ser eliminado. Desative-o em vez disso.' 
        };
      }

      const { error } = await this.supabase.db
        .from('products')
        .delete()
        .eq('id', id);

      if (error) throw error;

      this.products.update(products => products.filter(p => p.id !== id));
      return { success: true };
    } catch (error: any) {
      console.error('Erro ao eliminar produto:', error);
      return { success: false, error: 'Erro inesperado ao eliminar produto' };
    }
  }

  async isProductSold(productId: string): Promise<boolean> {
    try {
      const { count, error } = await this.supabase.db
        .from('invoice_items')
        .select('*', { count: 'exact', head: true })
        .eq('product_id', productId);

      if (error) throw error;
      return (count || 0) > 0;
    } catch (error) {
      console.error('Erro ao verificar vendas do produto:', error);
      return false;
    }
  }

  async toggleProductActiveStatus(id: string, currentStatus: boolean): Promise<boolean> {
    return this.updateProduct(id, { is_active: !currentStatus });
  }

  getProductById(id: string): Product | undefined {
    return this.products().find(p => p.id === id);
  }
}
