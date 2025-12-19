import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';

export interface CompanyUser {
  id: string;
  company_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'manager' | 'user';
  permissions: Record<string, boolean>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  user_email?: string;
}

export interface SystemSettings {
  id: string;
  company_id: string;
  language: string;
  timezone: string;
  currency: string;
  date_format: string;
  fiscal_year_start: string;
  enable_notifications: boolean;
  notification_email?: string;
  created_at: string;
  updated_at: string;
}

@Injectable({
  providedIn: 'root'
})
export class UserManagementService {
  private usersSignal = signal<CompanyUser[]>([]);
  users = this.usersSignal.asReadonly();

  private settingsSignal = signal<SystemSettings | null>(null);
  settings = this.settingsSignal.asReadonly();

  constructor(private supabase: SupabaseService) {}

  async loadCompanyUsers(companyId: string): Promise<void> {
    const { data, error } = await this.supabase.client
      .from('company_users')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error loading company users:', error);
      return;
    }

    const usersWithEmails = await Promise.all(
      (data || []).map(async (user) => {
        const { data: { user: userData } } = await this.supabase.client.auth.admin.getUserById(user.user_id);
        return {
          ...user,
          user_email: userData?.email
        };
      })
    );

    this.usersSignal.set(usersWithEmails);
  }

  async inviteUser(companyId: string, email: string, role: CompanyUser['role']): Promise<boolean> {
    const { data: existingUser } = await this.supabase.client
      .from('company_users')
      .select('*')
      .eq('company_id', companyId);

    const userExists = existingUser?.some((u: any) => u.user_email === email);

    if (userExists) {
      console.error('User already exists in this company');
      return false;
    }

    return true;
  }

  async addUser(companyId: string, userId: string, role: CompanyUser['role']): Promise<boolean> {
    const { error } = await this.supabase.client
      .from('company_users')
      .insert({
        company_id: companyId,
        user_id: userId,
        role,
        is_active: true
      });

    if (error) {
      console.error('Error adding user:', error);
      return false;
    }

    await this.loadCompanyUsers(companyId);
    return true;
  }

  async updateUserRole(userId: string, companyId: string, role: CompanyUser['role']): Promise<boolean> {
    const { error } = await this.supabase.client
      .from('company_users')
      .update({ role, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('company_id', companyId);

    if (error) {
      console.error('Error updating user role:', error);
      return false;
    }

    await this.loadCompanyUsers(companyId);
    return true;
  }

  async toggleUserActive(userId: string, companyId: string, isActive: boolean): Promise<boolean> {
    const { error } = await this.supabase.client
      .from('company_users')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('company_id', companyId);

    if (error) {
      console.error('Error toggling user active status:', error);
      return false;
    }

    await this.loadCompanyUsers(companyId);
    return true;
  }

  async removeUser(userId: string, companyId: string): Promise<boolean> {
    const { error } = await this.supabase.client
      .from('company_users')
      .delete()
      .eq('user_id', userId)
      .eq('company_id', companyId);

    if (error) {
      console.error('Error removing user:', error);
      return false;
    }

    await this.loadCompanyUsers(companyId);
    return true;
  }

  async loadSystemSettings(companyId: string): Promise<void> {
    const { data, error } = await this.supabase.client
      .from('system_settings')
      .select('*')
      .eq('company_id', companyId)
      .maybeSingle();

    if (error) {
      console.error('Error loading system settings:', error);
      return;
    }

    this.settingsSignal.set(data);
  }

  async updateSystemSettings(companyId: string, updates: Partial<SystemSettings>): Promise<boolean> {
    const { error } = await this.supabase.client
      .from('system_settings')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('company_id', companyId);

    if (error) {
      console.error('Error updating system settings:', error);
      return false;
    }

    await this.loadSystemSettings(companyId);
    return true;
  }

  getUserRole(userId: string): CompanyUser['role'] | null {
    const user = this.usersSignal().find(u => u.user_id === userId);
    return user?.role || null;
  }

  isUserOwnerOrAdmin(userId: string): boolean {
    const role = this.getUserRole(userId);
    return role === 'owner' || role === 'admin';
  }
}
