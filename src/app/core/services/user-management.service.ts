import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { AuditLogService } from './audit-log.service';

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
    private authService: AuthService,
    private auditLogService: AuditLogService
  ) {}

  async loadAllUsers(): Promise<void> {
    const user = this.authService.currentUser();
    if (!user) return;

    // First, get the list of company IDs the current user belongs to
    const { data: userCompanies } = await this.supabase.client
      .from('company_users')
      .select('company_id')
      .eq('user_id', user.id);

    const companyIds = (userCompanies || []).map(c => c.company_id);

    if (companyIds.length === 0) {
      this.allUsersSignal.set([]);
      return;
    }

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
        ),
        profiles!company_users_user_id_fkey (
          email,
          full_name
        )
      `)
      .in('company_id', companyIds)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error loading all users:', error);
      return;
    }

    // Fail-safe: fetch profiles directly for any user_ids to guarantee emails are found
    const userIds = Array.from(new Set((data || []).map((r: any) => r.user_id)));
    const profilesMap = new Map<string, { email: string; full_name: string }>();

    if (userIds.length > 0) {
      const { data: profData } = await this.supabase.client
        .from('profiles')
        .select('id, email, full_name')
        .in('id', userIds);

      (profData || []).forEach((p: any) => {
        if (p.id) profilesMap.set(p.id, { email: p.email || '', full_name: p.full_name || '' });
      });
    }

    const usersMap = new Map<string, UserWithCompanies>();

    for (const row of data || []) {
      const userId = row.user_id;
      const profile = (row as any).profiles;
      const userEmail = profile?.email || profilesMap.get(userId)?.email || 'N/A';

      if (!usersMap.has(userId)) {
        usersMap.set(userId, {
          user_id: userId,
          user_email: userEmail,
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

    this.allUsersSignal.set(usersArray);
  }

  async loadCompanyUsers(companyId: string): Promise<void> {
    const { data, error } = await this.supabase.client
      .from('company_users')
      .select(`
        *,
        profiles!company_users_user_id_fkey (
          email,
          full_name
        )
      `)
      .eq('company_id', companyId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error loading company users:', error);
      return;
    }

    const userIds = Array.from(new Set((data || []).map((r: any) => r.user_id)));
    const profilesMap = new Map<string, { email: string; full_name: string }>();

    if (userIds.length > 0) {
      const { data: profData } = await this.supabase.client
        .from('profiles')
        .select('id, email, full_name')
        .in('id', userIds);

      (profData || []).forEach((p: any) => {
        if (p.id) profilesMap.set(p.id, { email: p.email || '', full_name: p.full_name || '' });
      });
    }

    const usersWithEmails = (data || []).map((row: any) => ({
      ...row,
      user_email: row.profiles?.email || profilesMap.get(row.user_id)?.email || row.user_id
    }));

    this.companyUsersSignal.set(usersWithEmails);
  }

  async addUserToCompany(
    rawEmail: string, 
    companyId: string, 
    role: CompanyUser['role'],
    fullName?: string,
    phone?: string,
    companyName?: string,
    inviterName?: string,
    roleName?: string
  ): Promise<boolean> {
    try {
      const email = (rawEmail || '').trim().toLowerCase();
      if (!email) return false;

      let targetUserId: string | null = null;

      // 1. Try RPC function to find user ID by email
      const { data: rpcUserId, error: rpcError } = await this.supabase.client
        .rpc('get_user_id_by_email', { email_query: email });

      if (rpcUserId) {
        targetUserId = rpcUserId;
      } else {
        // Fallback: check profiles table by email
        const { data: profile } = await this.supabase.client
          .from('profiles')
          .select('id')
          .ilike('email', email)
          .maybeSingle();

        if (profile?.id) {
          targetUserId = profile.id;
        }
      }
      
      // 2. Invoke invite-user Edge Function to create auth user (if new) and send confirmation/invite email
      const { data: inviteData } = await this.supabase.client.functions.invoke('invite-user', {
        body: { email, fullName, phone, companyName, role: roleName || role, inviterName }
      }).catch(err => {
        console.warn('Error invoking invite-user Edge Function:', err);
        return { data: null };
      });

      if (!targetUserId && inviteData?.user?.id) {
        targetUserId = inviteData.user.id;
      }

      // 3. Sync extra profile data if user exists
      if (fullName && targetUserId) {
        await this.supabase.client
          .from('profiles')
          .upsert({
            id: targetUserId,
            full_name: fullName,
            email: email,
            phone: phone
          });
      }

      if (!targetUserId) return false;

      const { data: existingUser } = await this.supabase.client
        .from('company_users')
        .select('*')
        .eq('company_id', companyId)
        .eq('user_id', targetUserId)
        .maybeSingle();

      if (existingUser) {
        // If already exists, update role and ensure active
        if (existingUser.role !== role || !existingUser.is_active) {
          await this.supabase.client
            .from('company_users')
            .update({ role, is_active: true, updated_at: new Date().toISOString() })
            .eq('id', existingUser.id);
        }
        return true;
      }

      const { error } = await this.supabase.client
        .from('company_users')
        .insert({
          company_id: companyId,
          user_id: targetUserId,
          role,
          is_active: true
        });

      if (error) {
        console.error('Error adding user:', error);
        return false;
      }

      await this.auditLogService.log(
        'Adicionou Utilizador à Empresa',
        'users',
        { email, role },
        targetUserId,
        email,
        companyId
      );

      await this.loadCompanyUsers(companyId);
      return true;
    } catch (error) {
      console.error('Error adding user to company:', error);
      return false;
    }
  }

  async updateUserRole(userId: string, companyId: string, role: CompanyUser['role']): Promise<boolean> {
    try {
      const user = this.companyUsersSignal().find(u => u.user_id === userId);
      const { error } = await this.supabase.client
        .from('company_users')
        .update({ role, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('company_id', companyId);

      if (error) {
        console.error('Error updating user role:', error);
        return false;
      }

      await this.auditLogService.log(
        'Atualizou Papel do Utilizador',
        'users',
        { user_email: user?.user_email || userId, old_role: user?.role, new_role: role },
        userId,
        user?.user_email || userId,
        companyId
      );

      await this.loadCompanyUsers(companyId);
      return true;
    } catch (error) {
      console.error('Error updating user role:', error);
      return false;
    }
  }

  async toggleUserActive(userId: string, companyId: string, isActive: boolean): Promise<boolean> {
    try {
      const user = this.companyUsersSignal().find(u => u.user_id === userId);
      const { error } = await this.supabase.client
        .from('company_users')
        .update({ is_active: isActive, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('company_id', companyId);

      if (error) {
        console.error('Error toggling user active status:', error);
        return false;
      }

      await this.auditLogService.log(
        isActive ? 'Ativou Utilizador' : 'Desativou Utilizador',
        'users',
        { user_email: user?.user_email || userId },
        userId,
        user?.user_email || userId,
        companyId
      );

      await this.loadCompanyUsers(companyId);
      return true;
    } catch (error) {
      console.error('Error toggling user active status:', error);
      return false;
    }
  }

  async removeUserFromCompany(userId: string, companyId: string): Promise<boolean> {
    try {
      const user = this.companyUsersSignal().find(u => u.user_id === userId);
      const { error } = await this.supabase.client
        .from('company_users')
        .delete()
        .eq('user_id', userId)
        .eq('company_id', companyId);

      if (error) {
        console.error('Error removing user:', error);
        return false;
      }

      await this.auditLogService.log(
        'Removeu Utilizador da Empresa',
        'users',
        { user_email: user?.user_email || userId },
        userId,
        user?.user_email || userId,
        companyId
      );

      await this.loadCompanyUsers(companyId);
      return true;
    } catch (error) {
      console.error('Error removing user:', error);
      return false;
    }
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
    try {
      const { error } = await this.supabase.client
        .from('system_settings')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('company_id', companyId);

      if (error) {
        console.error('Error updating system settings:', error);
        return false;
      }

      await this.auditLogService.log(
        'Atualizou Configurações do Sistema',
        'system',
        { updates },
        undefined,
        undefined,
        companyId
      );

      await this.loadSystemSettings(companyId);
      return true;
    } catch (error) {
      console.error('Error updating system settings:', error);
      return false;
    }
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
