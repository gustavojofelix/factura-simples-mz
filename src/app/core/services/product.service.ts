import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CompanyService } from './company.service';
import { AuditLogService } from './audit-log.service';

export interface Product {
  id: string;
  code: string;
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

export interface ProductImportData {
  name: string;
  type: 'produto' | 'servico';
  description?: string;
  price: number;
  unit?: string;
  stock?: number | null;
  is_active?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class ProductService {
  products = signal<Product[]>([]);
  isLoading = signal(false);

  constructor(
    private supabase: SupabaseService,
    private companyService: CompanyService,
    private auditLogService: AuditLogService
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
        .order('code', { ascending: true });

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

    if (await this.isProductDuplicate(productData.name, productData.type)) {
      throw new Error('Já existe um produto ou serviço com este nome.');
    }

    const { data, error } = await this.supabase.db
      .from('products')
      .insert({
        ...productData,
        company_id: company.id,
        is_active: true
      })
      .select()
      .single();

    // Re-throw so callers can inspect the error code (e.g. SUBSCRIPTION_FEATURE_DISABLED)
    if (error) throw error;

    await this.auditLogService.log(
      'Criou Produto/Serviço',
      'products',
      { name: data.name, code: data.code, price: data.price, type: data.type },
      data.id,
      data.name,
      company.id
    );

    // Reload from server to get the trigger-assigned code and correct ordering
    await this.loadProducts();
    return data;
  }

  async updateProduct(id: string, updates: Partial<Product>): Promise<boolean> {
    try {
      const prod = this.getProductById(id);
      if (updates.name && await this.isProductDuplicate(updates.name, updates.type || prod?.type, id)) {
        return false;
      }
      const { error } = await this.supabase.db
        .from('products')
        .update(updates)
        .eq('id', id);

      if (error) throw error;

      this.products.update(products =>
        products.map(p => p.id === id ? { ...p, ...updates } : p)
      );

      await this.auditLogService.log(
        'Atualizou Produto/Serviço',
        'products',
        { updates, old: prod ? { name: prod.name, code: prod.code, price: prod.price, type: prod.type, is_active: prod.is_active } : null },
        id,
        updates.name || prod?.name,
        prod?.company_id
      );

      return true;
    } catch (error) {
      console.error('Erro ao actualizar produto:', error);
      return false;
    }
  }

  async deleteProduct(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      const prod = this.getProductById(id);
      const companyId = prod?.company_id;
      const name = prod?.name;

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

      await this.auditLogService.log(
        'Eliminou Produto/Serviço',
        'products',
        { name },
        id,
        name,
        companyId
      );

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

  async isProductDuplicate(name: string, type?: Product['type'], excludeProductId?: string): Promise<boolean> {
    const company = this.companyService.activeCompany();
    if (!company || !name.trim()) return false;

    let query = this.supabase.db
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', company.id)
      .ilike('name', name.trim());

    if (type) query = query.eq('type', type);
    if (excludeProductId) query = query.not('id', 'eq', excludeProductId);

    const { count, error } = await query;
    if (error) throw error;
    return (count || 0) > 0;
  }

  async importProducts(products: ProductImportData[]): Promise<{ imported: number; error?: string }> {
    const company = this.companyService.activeCompany();
    if (!company) return { imported: 0, error: 'Nenhuma empresa activa seleccionada.' };

    try {
      const { data, error } = await this.supabase.db
        .from('products')
        .insert(products.map(product => ({
          ...product,
          stock: product.type === 'produto' ? product.stock ?? 0 : null,
          is_active: product.is_active ?? true,
          company_id: company.id
        })))
        .select('id, name, code, price, type');
      if (error) throw error;

      await Promise.all((data || []).map(product => this.auditLogService.log(
        'Importou Produto/Serviço', 'products', product, product.id, product.name, company.id
      )));
      await this.loadProducts();
      return { imported: data?.length || 0 };
    } catch (error: any) {
      console.error('Erro ao importar produtos:', error);
      return { imported: 0, error: error?.message || 'Não foi possível importar os produtos.' };
    }
  }

  getProductById(id: string): Product | undefined {
    return this.products().find(p => p.id === id);
  }
}
