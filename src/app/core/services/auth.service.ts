import { Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SupabaseService } from './supabase.service';
import { User, AuthError } from '@supabase/supabase-js';
import { AuditLogService } from './audit-log.service';

export interface AuthResponse {
  success: boolean;
  error?: string;
  user?: User;
}

export interface UserProfile {
  id: string;
  full_name: string;
  phone?: string;
  email: string;
  role: 'user' | 'admin';
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  currentUser = signal<User | null>(null);
  isLoading = signal<boolean>(true);

  private _isAdminCache: boolean | null = null;
  private _authResolved = false;
  private authInitialized = new Promise<void>((resolve) => {
    this.resolveAuth = resolve;
  });
  private resolveAuth!: () => void;

  constructor(
    private supabase: SupabaseService,
    private router: Router,
    private auditLogService: AuditLogService
  ) {
    this.initAuthListener();
  }

  private initAuthListener() {
    this.supabase.auth.getSession().then(({ data: { session } }) => {
      this.currentUser.set(session?.user ?? null);
      this.isLoading.set(false);
      if (!this._authResolved) {
        this._authResolved = true;
        this.resolveAuth();
      }
    });

    this.supabase.auth.onAuthStateChange((event, session) => {
      this.currentUser.set(session?.user ?? null);
      this.isLoading.set(false);
      this._isAdminCache = null; // Invalidate cache on auth state change
      if (!this._authResolved) {
        this._authResolved = true;
        this.resolveAuth();
      }
    });
  }

  async waitForInitialization(): Promise<void> {
    return this.authInitialized;
  }

  async signUp(email: string, password: string, fullName: string, phone?: string): Promise<AuthResponse> {
    try {
      const { data, error } = await this.supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            phone: phone
          }
        }
      });

      if (error) {
        return { success: false, error: this.translateError(error) };
      }

      if (data.user) {
        await this.createProfile(data.user.id, fullName, phone);

        // Notify admin of new signup
        this.supabase.client.functions.invoke('notify-admin', {
          body: {
            type: 'signup',
            email,
            fullName,
            phone
          }
        }).catch(err => console.error('Error invoking notify-admin:', err));

        return { success: true, user: data.user };
      }

      return { success: false, error: 'Erro ao criar conta' };
    } catch (error: any) {
      return { success: false, error: error.message || 'Erro desconhecido' };
    }
  }

  async signIn(email: string, password: string): Promise<AuthResponse> {
    try {
      const { data, error } = await this.supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        return { success: false, error: this.translateError(error) };
      }

      if (data.user) {
        this.currentUser.set(data.user);
        this._isAdminCache = null; // Clear cache on new login
        await this.auditLogService.log(
          'Entrou no Sistema (Login)',
          'auth',
          { email: data.user.email }
        );
        return { success: true, user: data.user };
      }

      return { success: false, error: 'Erro ao entrar' };
    } catch (error: any) {
      return { success: false, error: error.message || 'Erro desconhecido' };
    }
  }

  async signOut(): Promise<void> {
    this._isAdminCache = null; // Clear admin cache on logout
    const user = this.currentUser();
    if (user) {
      await this.auditLogService.log(
        'Saiu do Sistema (Logout)',
        'auth',
        { email: user.email }
      );
    }
    await this.supabase.auth.signOut();
    this.router.navigate(['/']);
  }

  async resetPassword(email: string): Promise<AuthResponse> {
    try {
      const { error } = await this.supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/#/resetar-senha`
      });

      if (error) {
        return { success: false, error: this.translateError(error) };
      }

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message || 'Erro desconhecido' };
    }
  }

  async completePasswordReset(newPassword: string): Promise<AuthResponse> {
    try {
      const { data, error } = await this.supabase.auth.updateUser({
        password: newPassword
      });

      if (error) {
        return { success: false, error: this.translateError(error) };
      }

      if (data.user) {
        this.currentUser.set(data.user);
        await this.auditLogService.log(
          'Alterou a Palavra-passe (Recuperação)',
          'auth',
          { email: data.user.email, method: 'password_reset_recovery' }
        );
        return { success: true, user: data.user };
      }

      return { success: false, error: 'Erro ao atualizar a palavra-passe' };
    } catch (error: any) {
      return { success: false, error: error.message || 'Erro desconhecido' };
    }
  }

  async getCurrentUser(): Promise<User | null> {
    let user = this.currentUser();
    if (!user) {
      try {
        const { data } = await this.supabase.auth.getUser();
        user = data.user || null;
        if (user) {
          this.currentUser.set(user);
        }
      } catch (e) {
        console.warn('Erro ao obter utilizador autenticado:', e);
      }
    }
    return user;
  }

  async getCurrentProfile(): Promise<UserProfile | null> {
    const user = await this.getCurrentUser();
    if (!user) return null;

    try {
      const { data, error } = await this.supabase.db
        .from('profiles')
        .select('id, full_name, phone, email, role')
        .eq('id', user.id)
        .limit(1)
        .maybeSingle();

      if (error) {
        console.warn('Aviso ao carregar perfil da base de dados:', error.message);
        return {
          id: user.id,
          full_name: user.user_metadata?.['full_name'] || user.email?.split('@')[0] || 'Utilizador',
          phone: user.user_metadata?.['phone'] || '',
          email: user.email!,
          role: 'user'
        };
      }

      if (data) {
        return {
          id: data.id,
          full_name: data.full_name,
          phone: data.phone,
          email: user.email!,
          role: data.role === 'admin' ? 'admin' : 'user'
        };
      }

      return null;
    } catch (error) {
      console.error('Erro ao carregar perfil:', error);
      return {
        id: user.id,
        full_name: user.user_metadata?.['full_name'] || user.email?.split('@')[0] || 'Utilizador',
        phone: user.user_metadata?.['phone'] || '',
        email: user.email!,
        role: 'user'
      };
    }
  }

  async isAdmin(): Promise<boolean> {
    // Return cached result if available (avoids repeated DB calls per navigation)
    if (this._isAdminCache !== null) return this._isAdminCache;
    const user = await this.getCurrentUser();
    if (!user) {
      this._isAdminCache = false;
      return false;
    }
    const profile = await this.getCurrentProfile();
    this._isAdminCache = profile?.role === 'admin';
    return this._isAdminCache;
  }

  async getUserCompanies() {
    const user = this.currentUser();
    if (!user) return [];

    try {
      const { data: owned, error: ownedError } = await this.supabase.db
        .from('companies')
        .select('id, name, user_id, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (ownedError) throw ownedError;

      const { data: shared, error: sharedError } = await this.supabase.db
        .from('company_users')
        .select('companies(id, name, user_id, created_at)')
        .eq('user_id', user.id)
        .neq('role', 'owner');

      if (sharedError) throw sharedError;

      const sharedCompanies = (shared || [])
        .map((cu: any) => cu.companies)
        .filter((c: any) => c !== null);

      return [...(owned || []), ...sharedCompanies];
    } catch (error) {
      console.error('Erro ao carregar empresas:', error);
      return [];
    }
  }

  private async createProfile(userId: string, fullName: string, phone?: string) {
    try {
      await this.supabase.db
        .from('profiles')
        .insert({
          id: userId,
          full_name: fullName,
          phone: phone
        });
    } catch (error) {
      console.error('Erro ao criar perfil:', error);
    }
  }

  private translateError(error: any): string {
    const message = error?.message || (typeof error === 'string' ? error : '');

    if (message.includes('Failed to fetch') || message.includes('ERR_CONNECTION_TIMED_OUT') || message.includes('no such host') || message.includes('fetch')) {
      return 'Erro de ligação ao servidor. Por favor, verifique a sua ligação à internet e tente novamente.';
    }

    const errorMap: { [key: string]: string } = {
      'Invalid login credentials': 'Email ou palavra-passe incorretos',
      'Email not confirmed': 'Email não confirmado',
      'User already registered': 'Este email já está registado',
      'Password should be at least 6 characters': 'A palavra-passe deve ter pelo menos 6 caracteres',
      'Unable to validate email address': 'Email inválido',
      'Email rate limit exceeded': 'Demasiadas tentativas. Tente novamente mais tarde',
      'New password should be different from the old password': 'A nova palavra-passe deve ser diferente da antiga',
      'Database error granting user': 'Erro na base de dados ao autenticar o utilizador. Por favor, execute as migrações mais recentes no Supabase.'
    };

    return errorMap[message] || message || 'Erro ao processar pedido';
  }

  isAuthenticated(): boolean {
    return this.currentUser() !== null;
  }

  async updateUserProfile(data: { fullName: string; phone?: string }): Promise<void> {
    const user = this.currentUser();
    if (!user) throw new Error('Utilizador não autenticado');

    const { error } = await this.supabase.db
      .from('profiles')
      .update({ full_name: data.fullName, phone: data.phone ?? null })
      .eq('id', user.id);

    if (error) throw error;
  }

  async updateUserPassword(currentPassword: string, newPassword: string): Promise<void> {
    const user = this.currentUser();
    if (!user?.email) throw new Error('Utilizador não encontrado');

    const { error: signInError } = await this.supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword
    });

    if (signInError) throw new Error('Palavra-passe atual incorreta');

    const { error } = await this.supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
  }
}
