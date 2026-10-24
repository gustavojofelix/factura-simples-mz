import { Injectable, computed, effect, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { TenantService } from './tenant.service';
import { ACCOUNT_SLUG_PATTERN } from '../utils/tenant.util';
import { t } from '../i18n/i18n';

export interface Account {
  id: string;
  slug: string;
  name: string | null;
  status: 'active' | 'suspended';
  is_owner: boolean;
}

export interface PublicAccountInfo {
  id: string;
  name: string | null;
  logo_url: string | null;
  status: 'active' | 'suspended';
}

/** Rota da app (hash) para onde o utilizador deve ir depois de autenticar. */
export type PostLoginTarget =
  | { kind: 'route'; route: string }
  | { kind: 'external'; url: string };

const ACTIVE_ACCOUNT_KEY = 'activeAccountId';

/**
 * Conta (tenant) activa. Na web é a do subdomínio; na raiz ou na app nativa é a
 * última usada ou a primeira a que o utilizador tem acesso.
 */
@Injectable({
  providedIn: 'root'
})
export class AccountService {
  accounts = signal<Account[]>([]);
  activeAccount = signal<Account | null>(null);
  /** O subdomínio actual pertence a uma conta a que o utilizador não tem acesso. */
  accessDenied = signal(false);
  isLoaded = signal(false);

  isAccountOwner = computed(() => !!this.activeAccount()?.is_owner);
  ownedAccount = computed(() => this.accounts().find(a => a.is_owner) ?? null);

  private loading: Promise<void> | null = null;

  constructor(
    private supabase: SupabaseService,
    private authService: AuthService,
    private tenant: TenantService
  ) {
    effect(() => {
      const user = this.authService.currentUser();
      if (user) {
        this.loadAccounts();
      } else {
        this.accounts.set([]);
        this.activeAccount.set(null);
        this.accessDenied.set(false);
        this.isLoaded.set(false);
        this.loading = null;
      }
    }, { allowSignalWrites: true });
  }

  /** Garante que as contas foram carregadas (usado pelos guards). */
  async ensureLoaded(): Promise<void> {
    if (this.isLoaded()) return;
    await this.loadAccounts();
  }

  loadAccounts(): Promise<void> {
    if (!this.loading) {
      this.loading = this.fetchAccounts().finally(() => (this.loading = null));
    }
    return this.loading;
  }

  private async fetchAccounts(): Promise<void> {
    // Não depende de currentUser(): logo após signUp/signIn o signal pode ainda
    // não estar actualizado, mas a sessão já está no cliente.
    const { data, error } = await this.supabase.db.rpc('get_my_accounts');
    if (error) {
      console.error('Erro ao carregar contas:', error);
      this.accounts.set([]);
    } else {
      this.accounts.set((data || []) as Account[]);
    }

    this.resolveActiveAccount();
    this.isLoaded.set(true);
  }

  private resolveActiveAccount() {
    const accounts = this.accounts();
    const slug = this.tenant.currentSlug();

    if (slug) {
      const match = accounts.find(a => a.slug === slug) ?? null;
      this.accessDenied.set(!match);
      this.setActive(match);
      return;
    }

    this.accessDenied.set(false);
    const current = this.activeAccount();
    if (current && accounts.some(a => a.id === current.id)) return;

    let savedId: string | null = null;
    try {
      savedId = localStorage.getItem(ACTIVE_ACCOUNT_KEY);
    } catch {
      savedId = null;
    }
    this.setActive(accounts.find(a => a.id === savedId) ?? accounts[0] ?? null);
  }

  private setActive(account: Account | null) {
    if (this.activeAccount()?.id !== account?.id) {
      this.activeAccount.set(account);
    }
    if (account) {
      try {
        localStorage.setItem(ACTIVE_ACCOUNT_KEY, account.id);
      } catch {
        // ignore
      }
    }
  }

  /**
   * Troca de conta. Na web navega para o subdomínio da conta; na app nativa
   * troca no momento (o CompanyService recarrega as empresas).
   */
  switchAccount(account: Account, route = '/painel') {
    if (this.tenant.usesSubdomains) {
      window.location.href = this.tenant.accountUrl(account.slug, route);
      return;
    }
    this.setActive(account);
  }

  /** Decide para onde ir depois de login / redefinição de palavra-passe. */
  async resolvePostLoginTarget(): Promise<PostLoginTarget> {
    await this.loadAccounts();
    const accounts = this.accounts();

    if (this.tenant.currentSlug()) {
      if (this.accessDenied()) return { kind: 'route', route: '/sem-acesso' };
      return { kind: 'route', route: await this.homeRouteFor(this.activeAccount()!) };
    }

    if (accounts.length === 0) return { kind: 'route', route: '/configurar-conta' };

    if (this.tenant.usesSubdomains) {
      if (accounts.length > 1) return { kind: 'route', route: '/escolher-conta' };
      const account = accounts[0];
      return { kind: 'external', url: this.tenant.accountUrl(account.slug, await this.homeRouteFor(account)) };
    }

    // App nativa / dev: fica na mesma origem, na conta activa.
    return { kind: 'route', route: await this.homeRouteFor(this.activeAccount() ?? accounts[0]) };
  }

  /** O dono de uma conta sem empresas vai configurar a primeira; os restantes vão ao painel. */
  async homeRouteFor(account: Account): Promise<string> {
    if (!account.is_owner) return '/painel';
    const { count, error } = await this.supabase.db
      .from('companies')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', account.id);
    if (error) return '/painel';
    return (count ?? 0) === 0 ? '/configurar-empresa' : '/painel';
  }

  async isSlugAvailable(slug: string): Promise<boolean> {
    if (!ACCOUNT_SLUG_PATTERN.test(slug)) return false;
    const { data, error } = await this.supabase.db.rpc('is_account_slug_available', { p_slug: slug });
    if (error) {
      console.warn('Não foi possível verificar o endereço da conta:', error.message);
      return true;
    }
    return data === true;
  }

  async getPublicAccount(slug: string): Promise<PublicAccountInfo | null> {
    const { data, error } = await this.supabase.db.rpc('resolve_account_by_slug', { p_slug: slug });
    if (error || !data || (Array.isArray(data) && data.length === 0)) return null;
    return (Array.isArray(data) ? data[0] : data) as PublicAccountInfo;
  }

  /** Cria a conta do utilizador autenticado (quem ainda não tem conta própria). */
  async createAccount(slug: string, name: string): Promise<Account> {
    const { data, error } = await this.supabase.db.rpc('create_account', { p_slug: slug, p_name: name });
    if (error) throw error;
    await this.loadAccounts();
    const account = this.accounts().find(a => a.id === (data as any).id);
    if (!account) throw new Error(t('account.errors.createdNotFound'));
    if (!this.tenant.usesSubdomains) this.setActive(account);
    return account;
  }

  async updateAccountName(name: string): Promise<void> {
    const account = this.activeAccount();
    if (!account) return;
    const { error } = await this.supabase.db
      .from('accounts')
      .update({ name })
      .eq('id', account.id);
    if (error) throw error;
    const updated = { ...account, name };
    this.accounts.update(list => list.map(a => (a.id === account.id ? updated : a)));
    this.activeAccount.set(updated);
  }
}
