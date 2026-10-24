import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SupabaseService } from './supabase.service';
import { User, AuthError } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { AuditLogService } from './audit-log.service';
import { LanguageService } from '../i18n/language.service';
import { t } from '../i18n/i18n';

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
  status?: 'active' | 'suspended' | 'trial';
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  currentUser = signal<User | null>(null);
  isLoading = signal<boolean>(true);
  /** Na app nativa o redirect OAuth exige deep links (ainda não configurados). */
  readonly googleSignInAvailable = !Capacitor.isNativePlatform();

  private languageService = inject(LanguageService);
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

  async signUp(email: string, password: string, fullName: string, phone?: string, accountSlug?: string): Promise<AuthResponse> {
    try {
      const { data, error } = await this.supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            phone: phone,
            // O trigger handle_new_user cria a conta (subdomínio) e o perfil.
            account_slug: accountSlug
          }
        }
      });

      if (error) {
        return { success: false, error: this.translateError(error) };
      }

      if (data.user) {
        this.notifySignup(email, fullName, phone, accountSlug);
        return { success: true, user: data.user };
      }

      return { success: false, error: t('auth.messages.signUpError') };
    } catch (error: any) {
      return { success: false, error: error.message || t('auth.messages.unknownError') };
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
        return this.finishSignIn(data.user, 'password');
      }

      return { success: false, error: t('auth.messages.signInError') };
    } catch (error: any) {
      return { success: false, error: error.message || t('auth.messages.unknownError') };
    }
  }

  /**
   * Inicia o login / registo com Google. O browser sai da app e o Supabase
   * devolve os tokens em #/auth/callback (tratados em completeOAuthSignIn).
   */
  async signInWithGoogle(): Promise<AuthResponse> {
    try {
      const { error } = await this.supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/#/auth/callback`,
          queryParams: { prompt: 'select_account' }
        }
      });
      if (error) {
        return { success: false, error: this.translateError(error) };
      }
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message || t('auth.messages.unknownError') };
    }
  }

  /**
   * Conclui o login OAuth. Com HashLocationStrategy os tokens chegam como
   * #/auth/callback#access_token=..., que o Supabase não detecta sozinho.
   */
  async completeOAuthSignIn(): Promise<AuthResponse> {
    try {
      await this.waitForInitialization();
      const params = this.readOAuthCallbackParams();

      const providerError = params.get('error_description') || params.get('error');
      if (providerError) {
        const cancelled = params.get('error') === 'access_denied';
        return { success: false, error: cancelled ? t('auth.google.cancelled') : providerError };
      }

      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      if (accessToken && refreshToken) {
        const { data, error } = await this.supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken
        });
        // Os tokens não devem ficar no histórico do browser.
        window.history.replaceState(window.history.state, '', `${window.location.pathname}#/auth/callback`);
        if (error) return { success: false, error: this.translateError(error) };
        if (!data.user) return { success: false, error: t('auth.google.error') };
        return this.finishSignIn(data.user, 'google');
      }

      // Sem tokens (ex.: recarregamento após sincronizar a língua): basta haver sessão.
      const { data: { session } } = await this.supabase.auth.getSession();
      if (session?.user) {
        this.currentUser.set(session.user);
        return { success: true, user: session.user };
      }
      return { success: false, error: t('auth.google.error') };
    } catch (error: any) {
      return { success: false, error: error.message || t('auth.google.error') };
    }
  }

  /** O utilizador entrou com um fornecedor externo (Google) e não por email/palavra-passe. */
  isOAuthUser(user: User | null = this.currentUser()): boolean {
    const provider = user?.app_metadata?.['provider'];
    return !!provider && provider !== 'email';
  }

  /** Avisa o administrador de um novo registo (e envia as boas-vindas ao utilizador). */
  notifySignup(email: string, fullName: string, phone?: string, accountSlug?: string): void {
    this.supabase.client.functions.invoke('notify-admin', {
      body: {
        type: 'signup',
        email,
        fullName,
        phone,
        accountSlug
      }
    }).then(({ data, error }) => {
      // invoke() resolve com { error } em vez de rejeitar.
      if (error || data?.success === false) {
        console.error('Error invoking notify-admin:', error ?? data?.error ?? data?.status);
      }
    }).catch(err => console.error('Error invoking notify-admin:', err));
  }

  private readOAuthCallbackParams(): URLSearchParams {
    const params = new URLSearchParams(window.location.search);
    const hash = window.location.hash;
    for (const separator of ['#', '?']) {
      const index = hash.indexOf(separator, 1);
      if (index >= 0) {
        new URLSearchParams(hash.substring(index + 1)).forEach((value, key) => params.set(key, value));
      }
    }
    return params;
  }

  /** Passos comuns a qualquer login: conta suspensa, auditoria e língua do perfil. */
  private async finishSignIn(user: User, method: 'password' | 'google'): Promise<AuthResponse> {
    // Verificar se a conta do utilizador/subscritor foi suspensa
    const { data: profile } = await this.supabase.db
      .from('profiles')
      .select('status, language')
      .eq('id', user.id)
      .maybeSingle();

    if (profile?.status === 'suspended') {
      await this.supabase.auth.signOut();
      this.currentUser.set(null);
      await this.auditLogService.log(
        'Tentativa de Login em Conta Suspensa',
        'auth',
        { email: user.email, method }
      );
      return {
        success: false,
        error: t('auth.messages.accountSuspendedLong')
      };
    }

    this.currentUser.set(user);
    this._isAdminCache = null; // Clear cache on new login
    await this.auditLogService.log(
      'Entrou no Sistema (Login)',
      'auth',
      { email: user.email, method }
    );
    // Língua do perfil: se for diferente da actual, a página recarrega já autenticada.
    await this.languageService.syncWithProfile(user.id, profile?.language);
    return { success: true, user };
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
      return { success: false, error: error.message || t('auth.messages.unknownError') };
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

      return { success: false, error: t('auth.messages.passwordUpdateError') };
    } catch (error: any) {
      return { success: false, error: error.message || t('auth.messages.unknownError') };
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
        .select('id, full_name, phone, email, role, status')
        .eq('id', user.id)
        .limit(1)
        .maybeSingle();

      if (error) {
        console.warn('Aviso ao carregar perfil da base de dados:', error.message);
        return {
          id: user.id,
          full_name: user.user_metadata?.['full_name'] || user.email?.split('@')[0] || t('auth.profile.defaultName'),
          phone: user.user_metadata?.['phone'] || '',
          email: user.email!,
          role: 'user',
          status: 'active'
        };
      }

      if (data) {
        return {
          id: data.id,
          full_name: data.full_name,
          phone: data.phone,
          email: user.email!,
          role: data.role === 'admin' ? 'admin' : 'user',
          status: data.status || 'active'
        };
      }

      return null;
    } catch (error) {
      console.error('Erro ao carregar perfil:', error);
      return {
        id: user.id,
        full_name: user.user_metadata?.['full_name'] || user.email?.split('@')[0] || t('auth.profile.defaultName'),
        phone: user.user_metadata?.['phone'] || '',
        email: user.email!,
        role: 'user',
        status: 'active'
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

  private translateError(error: any): string {
    const message = error?.message || (typeof error === 'string' ? error : '');

    if (message.includes('Failed to fetch') || message.includes('ERR_CONNECTION_TIMED_OUT') || message.includes('no such host') || message.includes('fetch')) {
      return t('auth.errors.connection');
    }

    const errorMap: { [key: string]: string } = {
      'Invalid login credentials': 'auth.errors.invalidCredentials',
      'Email not confirmed': 'auth.errors.emailNotConfirmed',
      'User already registered': 'auth.errors.alreadyRegistered',
      'Password should be at least 6 characters': 'auth.errors.passwordTooShort',
      'Unable to validate email address': 'auth.errors.invalidEmail',
      'Email rate limit exceeded': 'auth.errors.rateLimit',
      'New password should be different from the old password': 'auth.errors.samePassword',
      'Database error granting user': 'auth.errors.databaseGrant'
    };

    const key = errorMap[message];
    return key ? t(key) : (message || t('auth.errors.requestFailed'));
  }

  isAuthenticated(): boolean {
    return this.currentUser() !== null;
  }

  async updateUserProfile(data: { fullName: string; phone?: string }): Promise<void> {
    const user = this.currentUser();
    if (!user) throw new Error(t('auth.errors.notAuthenticated'));

    const { error } = await this.supabase.db
      .from('profiles')
      .update({ full_name: data.fullName, phone: data.phone ?? null })
      .eq('id', user.id);

    if (error) throw error;
  }

  async updateUserPassword(currentPassword: string, newPassword: string): Promise<void> {
    const user = this.currentUser();
    if (!user?.email) throw new Error(t('auth.errors.userNotFound'));

    const { error: signInError } = await this.supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword
    });

    if (signInError) throw new Error(t('auth.errors.wrongCurrentPassword'));

    const { error } = await this.supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
  }
}
