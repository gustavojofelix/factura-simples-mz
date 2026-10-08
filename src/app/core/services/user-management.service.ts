import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { AuditLogService } from './audit-log.service';
import { friendlyErrorMessage, friendlyFunctionError } from '../utils/error-message';

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

export interface UserAccessResult {
  ok: boolean;
  error?: string;
  warning?: string;
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

    // Single query: get company_users with profile data via join
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
          id,
          email,
          full_name
        )
      `)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error loading all users:', error);
      return;
    }

    const usersMap = new Map<string, UserWithCompanies>();

    for (const row of data || []) {
      const userId = (row as any).user_id as string;
      const profile = (row as any).profiles;
      const userEmail = profile?.email || 'N/A';

      if (!usersMap.has(userId)) {
        usersMap.set(userId, {
          user_id: userId,
          user_email: userEmail,
          companies: []
        });
      }

      usersMap.get(userId)!.companies.push({
        company_id: (row as any).company_id,
        company_name: (row as any).companies?.name || 'Unknown',
        role: (row as any).role,
        is_active: (row as any).is_active
      });
    }

    this.allUsersSignal.set(Array.from(usersMap.values()));
  }

  async loadCompanyUsers(companyId: string): Promise<void> {
    // Single query with join — no separate profiles fallback needed
    const { data, error } = await this.supabase.client
      .from('company_users')
      .select(`
        *,
        profiles!company_users_user_id_fkey (
          id,
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

    const usersWithEmails = (data || []).map((row: any) => ({
      ...row,
      user_email: row.profiles?.email || row.user_id
    }));

    this.companyUsersSignal.set(usersWithEmails);
  }

  /**
   * Dá acesso a uma empresa. Para utilizadores sem acesso a essa empresa envia
   * convite (a Edge Function cria a conta se necessário); para quem já tem
   * acesso apenas actualiza a função, sem reenviar emails.
   */
  async addUserToCompany(
    rawEmail: string,
    companyId: string,
    role: CompanyUser['role'],
    fullName?: string,
    phone?: string,
    companyName?: string,
    inviterName?: string,
    roleName?: string
  ): Promise<UserAccessResult> {
    try {
      const email = (rawEmail || '').trim().toLowerCase();
      if (!email) return { ok: false, error: 'Indique o email do utilizador.' };
      if ((role as string) === 'owner') {
        return { ok: false, error: 'Não é possível atribuir a função de proprietário.' };
      }

      const currentUser = this.authService.currentUser();
      if (currentUser?.email?.toLowerCase() === email) {
        return { ok: false, error: 'Não pode alterar o seu próprio acesso.' };
      }

      // 1. O utilizador já existe e já tem acesso a esta empresa?
      const { data: rpcUserId } = await this.supabase.client
        .rpc('get_user_id_by_email', { email_query: email });
      let targetUserId: string | null = rpcUserId || null;

      if (targetUserId) {
        const { data: existing, error: existingError } = await this.supabase.client
          .from('company_users')
          .select('id, role, is_active')
          .eq('company_id', companyId)
          .eq('user_id', targetUserId)
          .maybeSingle();
        if (existingError) throw existingError;

        if (existing) {
          if (existing.role === 'owner') {
            return { ok: false, error: 'Este utilizador é o proprietário da empresa; a sua função não pode ser alterada.' };
          }
          if (existing.role !== role || !existing.is_active) {
            const { data: updated, error: updateError } = await this.supabase.client
              .from('company_users')
              .update({ role, is_active: true, updated_at: new Date().toISOString() })
              .eq('id', existing.id)
              .select('id');
            if (updateError) throw updateError;
            if (!updated?.length) {
              return { ok: false, error: 'Não tem permissão para alterar utilizadores desta empresa. Apenas o proprietário o pode fazer.' };
            }
            await this.auditLogService.log(
              'Atualizou Papel do Utilizador', 'users',
              { user_email: email, old_role: existing.role, new_role: role },
              targetUserId, email, companyId
            );
          }
          return { ok: true };
        }
      }

      // 2. Novo acesso: enviar convite (cria a conta, se ainda não existir).
      const { data: inviteData, error: inviteError } = await this.supabase.client.functions.invoke('invite-user', {
        body: { email, fullName, phone, companyId, companyName, role: roleName || role, inviterName }
      });
      if (inviteError) {
        return { ok: false, error: await friendlyFunctionError(inviteError, 'Não foi possível enviar o convite.') };
      }
      targetUserId = inviteData?.user?.id || targetUserId;
      if (!targetUserId) {
        return { ok: false, error: 'Não foi possível criar a conta do utilizador.' };
      }

      // 3. Criar o acesso
      const { error } = await this.supabase.client
        .from('company_users')
        .insert({
          company_id: companyId,
          user_id: targetUserId,
          role,
          is_active: true
        });
      if (error) throw error;

      await this.auditLogService.log(
        'Adicionou Utilizador à Empresa',
        'users',
        { email, role },
        targetUserId,
        email,
        companyId
      );

      await this.loadCompanyUsers(companyId);
      return { ok: true, warning: inviteData?.warning };
    } catch (error) {
      console.error('Error adding user to company:', error);
      return { ok: false, error: friendlyErrorMessage(error, 'Não foi possível adicionar o utilizador.') };
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

  async removeUserFromCompany(userId: string, companyId: string): Promise<UserAccessResult> {
    try {
      if (userId === this.authService.currentUser()?.id) {
        return { ok: false, error: 'Não pode remover o seu próprio acesso.' };
      }
      const user = this.companyUsersSignal().find(u => u.user_id === userId);
      const { data, error } = await this.supabase.client
        .from('company_users')
        .delete()
        .eq('user_id', userId)
        .eq('company_id', companyId)
        .neq('role', 'owner')
        .select('id');

      if (error) throw error;
      // Com RLS, um DELETE sem permissão não dá erro: apenas não apaga nada.
      if (!data?.length) {
        return { ok: false, error: 'Não foi possível remover o acesso. Apenas o proprietário da empresa pode remover utilizadores, e o proprietário não pode ser removido.' };
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
      return { ok: true };
    } catch (error) {
      console.error('Error removing user:', error);
      return { ok: false, error: friendlyErrorMessage(error, 'Não foi possível remover o acesso.') };
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

  /**
   * Grava as configurações do sistema. Usa upsert + select para detectar o caso
   * em que a RLS (só o proprietário pode alterar) filtra a linha: o PostgREST
   * devolve 0 linhas sem erro e antes a UI mostrava "sucesso" sem nada mudar.
   */
  async updateSystemSettings(
    companyId: string,
    updates: Partial<SystemSettings>
  ): Promise<{ ok: boolean; data?: SystemSettings; error?: string }> {
    try {
      const { id: _id, created_at: _c, updated_at: _u, company_id: _cid, ...fields } = updates;
      const { data, error } = await this.supabase.client
        .from('system_settings')
        .upsert(
          { ...fields, company_id: companyId, updated_at: new Date().toISOString() },
          { onConflict: 'company_id' }
        )
        .select()
        .maybeSingle();

      if (error) {
        console.error('Error updating system settings:', error);
        const denied = (error as any)?.code === '42501' || /row-level security/i.test(error.message || '');
        return {
          ok: false,
          error: denied
            ? 'Apenas o proprietário da empresa pode alterar as configurações do sistema.'
            : friendlyErrorMessage(error, 'Não foi possível guardar as configurações.')
        };
      }
      if (!data) {
        return { ok: false, error: 'Apenas o proprietário da empresa pode alterar as configurações do sistema.' };
      }

      await this.auditLogService.log(
        'Atualizou Configurações do Sistema',
        'system',
        { updates: fields },
        undefined,
        undefined,
        companyId
      );

      this.settingsSignal.set(data as SystemSettings);
      return { ok: true, data: data as SystemSettings };
    } catch (error) {
      console.error('Error updating system settings:', error);
      return { ok: false, error: friendlyErrorMessage(error, 'Não foi possível guardar as configurações.') };
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
