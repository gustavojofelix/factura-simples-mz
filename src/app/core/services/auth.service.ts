import { Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SupabaseService } from './supabase.service';
import { User, AuthError } from '@supabase/supabase-js';

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
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  currentUser = signal<User | null>(null);
  isLoading = signal<boolean>(true);

  constructor(
    private supabase: SupabaseService,
    private router: Router
  ) {
    this.initAuthListener();
  }

  private initAuthListener() {
    this.supabase.auth.getSession().then(({ data: { session } }) => {
      this.currentUser.set(session?.user ?? null);
      this.isLoading.set(false);
    });

    this.supabase.auth.onAuthStateChange((event, session) => {
      (() => {
        this.currentUser.set(session?.user ?? null);
        this.isLoading.set(false);
      })();
    });
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
        return { success: true, user: data.user };
      }

      return { success: false, error: 'Erro ao entrar' };
    } catch (error: any) {
      return { success: false, error: error.message || 'Erro desconhecido' };
    }
  }

  async signOut(): Promise<void> {
    await this.supabase.auth.signOut();
    this.router.navigate(['/']);
  }

  async resetPassword(email: string): Promise<AuthResponse> {
    try {
      const { error } = await this.supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/resetar-senha`
      });

      if (error) {
        return { success: false, error: this.translateError(error) };
      }

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message || 'Erro desconhecido' };
    }
  }

  async getCurrentProfile(): Promise<UserProfile | null> {
    const user = this.currentUser();
    if (!user) return null;

    try {
      const { data, error } = await this.supabase.db
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        return {
          id: data.id,
          full_name: data.full_name,
          phone: data.phone,
          email: user.email!
        };
      }

      return null;
    } catch (error) {
      console.error('Erro ao carregar perfil:', error);
      return null;
    }
  }

  async getUserCompanies() {
    const user = this.currentUser();
    if (!user) return [];

    try {
      const { data, error } = await this.supabase.db
        .from('companies')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
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

  private translateError(error: AuthError): string {
    const errorMap: { [key: string]: string } = {
      'Invalid login credentials': 'Email ou palavra-passe incorretos',
      'Email not confirmed': 'Email não confirmado',
      'User already registered': 'Este email já está registado',
      'Password should be at least 6 characters': 'A palavra-passe deve ter pelo menos 6 caracteres',
      'Unable to validate email address': 'Email inválido',
      'Email rate limit exceeded': 'Demasiadas tentativas. Tente novamente mais tarde'
    };

    return errorMap[error.message] || error.message || 'Erro ao processar pedido';
  }

  isAuthenticated(): boolean {
    return this.currentUser() !== null;
  }
}
