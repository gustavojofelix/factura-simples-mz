import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CompanyService } from './company.service';

export interface Product {
  id: string;
  company_id: string;
  name: string;
  description?: string;
  price: number;
  type: 'produto' | 'servico';
  ispc_category: string;
  ispc_rate: number;
  stock?: number;
  unit?: string;
  created_at: string;
}

export const ISPC_CATEGORIES = [
  { value: 'A', label: 'Grupo A - Petróleo e derivados', rate: 0.10 },
  { value: 'B', label: 'Grupo B - Bebidas alcoólicas e tabaco', rate: 0.075 },
  { value: 'C', label: 'Grupo C - Comunicações', rate: 0.05 },
  { value: 'D', label: 'Grupo D - Outros produtos e serviços', rate: 0.05 },
  { value: 'E', label: 'Grupo E - Produtos não sujeitos', rate: 0.0 }
];

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
          company_id: company.id
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

  async deleteProduct(id: string): Promise<boolean> {
    try {
      const { error } = await this.supabase.db
        .from('products')
        .delete()
        .eq('id', id);

      if (error) throw error;

      this.products.update(products => products.filter(p => p.id !== id));
      return true;
    } catch (error) {
      console.error('Erro ao eliminar produto:', error);
      return false;
    }
  }

  getProductById(id: string): Product | undefined {
    return this.products().find(p => p.id === id);
  }

  getCategoryRate(category: string): number {
    const cat = ISPC_CATEGORIES.find(c => c.value === category);
    return cat?.rate || 0;
  }

  calculateIspc(price: number, category: string): number {
    const rate = this.getCategoryRate(category);
    return price * rate;
  }
}
