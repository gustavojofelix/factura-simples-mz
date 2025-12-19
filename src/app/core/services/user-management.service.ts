import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';

export interface CompanyUser {
  id: string;
  company_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'manager' | 'user';
  is_active: boolean;
  permissions: Record<string, boolean>;
  created_at: string;
  updated_at: string;
  user_email?: string;
  company_name?: string;
}

export interface UserWithCompanies {
  user_id: string;
  user_email: string;
  companies: Array<{
    company_id: string;
    company_name: string;
    role: string;
    is_active: boolean;
  }>;
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
  private allUsersSignal = signal<UserWithCompanies[]>([]);
  allUsers = this.allUsersSignal.asReadonly();

  private companyUsersSignal = signal<CompanyUser[]>([]);
  companyUsers = this.companyUsersSignal.asReadonly();

  private settingsSignal = signal<SystemSettings | null>(null);
  settings = this.settingsSignal.asReadonly();

  constructor(
    private supabase: SupabaseService,
    private authService: AuthService
  ) {}

  async loadAllUsers(): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) return;

    const { data, error } = await this.supabase.client
      .from('company_users')
      .select(`
        user_id,
        company_id,
        role,
        is_active,
        companies (
          id,
          name
        )
      `)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error loading all users:', error);
      return;
    }

    const usersMap = new Map<string, UserWithCompanies>();

    for (const row of data || []) {
      const userId = row.user_id;

      if (!usersMap.has(userId)) {
        usersMap.set(userId, {
          user_id: userId,
          user_email: '',
          companies: []
        });
      }

      const userEntry = usersMap.get(userId)!;
      userEntry.companies.push({
        company_id: row.company_id,
        company_name: (row as any).companies?.name || 'Unknown',
        role: row.role,
        is_active: row.is_active
      });
    }

    const usersArray = Array.from(usersMap.values());

    for (const user of usersArray) {
      try {
        const { data: { users } } = await this.supabase.client.auth.admin.listUsers();
        const userData = users?.find(u => u.id === user.user_id);
        if (userData) {
          user.user_email = userData.email || user.user_id;
        }
      } catch (error) {
        user.user_email = user.user_id;
      }
    }

    this.allUsersSignal.set(usersArray);
  }

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
        try {
          const { data: { users } } = await this.supabase.client.auth.admin.listUsers();
          const userData = users?.find(u => u.id === user.user_id);
          return {
            ...user,
            user_email: userData?.email || user.user_id
          };
        } catch (error) {
          return {
            ...user,
            user_email: user.user_id
          };
        }
      })
    );

    this.companyUsersSignal.set(usersWithEmails);
  }

  async addUserToCompany(email: string, companyId: string, role: CompanyUser['role']): Promise<boolean> {
    try {
      const { data: { users } } = await this.supabase.client.auth.admin.listUsers();
      const targetUser = users?.find(u => u.email === email);

      if (!targetUser) {
        console.error('User not found');
        return false;
      }

      const { data: existingUser } = await this.supabase.client
        .from('company_users')
        .select('*')
        .eq('company_id', companyId)
        .eq('user_id', targetUser.id)
        .maybeSingle();

      if (existingUser) {
        console.error('User already exists in this company');
        return false;
      }

      const { error } = await this.supabase.client
        .from('company_users')
        .insert({
          company_id: companyId,
          user_id: targetUser.id,
          role,
          is_active: true
        });

      if (error) {
        console.error('Error adding user:', error);
        return false;
      }

      await this.loadCompanyUsers(companyId);
      return true;
    } catch (error) {
      console.error('Error adding user to company:', error);
      return false;
    }
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

  async removeUserFromCompany(userId: string, companyId: string): Promise<boolean> {
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
    const user = this.companyUsersSignal().find(u => u.user_id === userId);
    return user?.role || null;
  }

  isUserOwnerOrAdmin(userId: string): boolean {
    const role = this.getUserRole(userId);
    return role === 'owner' || role === 'admin';
  }

  async getUserCompanies(userId: string): Promise<Array<{ company_id: string; company_name: string; role: string }>> {
    const { data, error } = await this.supabase.client
      .from('company_users')
      .select(`
        company_id,
        role,
        companies (
          name
        )
      `)
      .eq('user_id', userId);

    if (error || !data) return [];

    return data.map((row: any) => ({
      company_id: row.company_id,
      company_name: row.companies?.name || 'Unknown',
      role: row.role
    }));
  }
}
