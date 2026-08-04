import { Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';

export interface ActivityType {
  id: string;
  code: string;
  name: string;
  parent_id: string | null;
  level: number;
  is_active: boolean;
  display_order: number;
  activity_type_rules?: ActivityRule[];
}

export interface ActivityRule {
  id?: string;
  activity_type_id: string;
  rule_type: string;
  tax_rate: number;
  minimum_amount?: number | null;
  maximum_amount?: number | null;
  is_active: boolean;
}

export type CompanyActivityRole = 'principal' | 'comercial' | 'servico';

export interface CompanyActivity {
  id?: string;
  company_id: string;
  activity_type_id: string;
  activity_role: CompanyActivityRole;
  is_primary: boolean;
  activity_type?: ActivityType;
}

@Injectable({ providedIn: 'root' })
export class ActivityService {
  constructor(private supabase: SupabaseService) {}

  async list(includeInactive = true): Promise<ActivityType[]> {
    let query = this.supabase.db
      .from('activity_types')
      .select('*, activity_type_rules(*)')
      .order('level', { ascending: true })
      .order('display_order', { ascending: true });
    if (!includeInactive) query = query.eq('is_active', true);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as ActivityType[];
  }

  async create(activity: Pick<ActivityType, 'code' | 'name' | 'parent_id' | 'level' | 'display_order'>) {
    const { data, error } = await this.supabase.db.from('activity_types').insert(activity).select().single();
    if (error) throw error;
    return data as ActivityType;
  }

  async update(id: string, updates: Partial<Pick<ActivityType, 'code' | 'name' | 'parent_id' | 'level' | 'display_order' | 'is_active'>>) {
    const { data, error } = await this.supabase.db.from('activity_types').update(updates).eq('id', id).select().single();
    if (error) throw error;
    return data as ActivityType;
  }

  async saveRule(rule: Omit<ActivityRule, 'id'> & { id?: string }) {
    const { id, ...payload } = rule;
    const query = id
      ? this.supabase.db.from('activity_type_rules').update(payload).eq('id', id).select().single()
      : this.supabase.db.from('activity_type_rules').insert(payload).select().single();
    const { data, error } = await query;
    if (error) throw error;
    return data as ActivityRule;
  }

  async getCompanyActivities(companyId: string): Promise<CompanyActivity[]> {
    const { data, error } = await this.supabase.db
      .from('company_activities')
      .select('*, activity_type:activity_types(*, activity_type_rules(*))')
      .eq('company_id', companyId)
      .order('is_primary', { ascending: false });
    if (error) throw error;
    return (data || []) as CompanyActivity[];
  }

  async saveCompanyActivities(companyId: string, activities: Omit<CompanyActivity, 'id' | 'company_id'>[]) {
    const { error: deleteError } = await this.supabase.db
      .from('company_activities')
      .delete()
      .eq('company_id', companyId);
    if (deleteError) throw deleteError;

    if (activities.length === 0) return [];
    const rows = activities.map(activity => ({ ...activity, company_id: companyId }));
    const { data, error } = await this.supabase.db
      .from('company_activities')
      .insert(rows)
      .select('*, activity_type:activity_types(*, activity_type_rules(*))');
    if (error) throw error;
    return (data || []) as CompanyActivity[];
  }
}
