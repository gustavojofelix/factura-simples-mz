import { Injectable, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { environment } from '../../../environments/environment';
import { parseAccountSlug } from '../utils/tenant.util';

/**
 * Identifica a conta (tenant) a partir do subdomínio em que a app está aberta.
 * Na app nativa não há subdomínio: a conta é resolvida pelo utilizador autenticado.
 */
@Injectable({
  providedIn: 'root'
})
export class TenantService {
  readonly isNative = Capacitor.isNativePlatform();

  /** Slug do subdomínio actual, ou null na raiz / www / app nativa. */
  readonly currentSlug = signal<string | null>(
    this.isNative ? null : parseAccountSlug(window.location.hostname, environment.rootDomain)
  );

  /** True quando a navegação entre contas é feita trocando de subdomínio. */
  get usesSubdomains(): boolean {
    return !this.isNative;
  }

  isOnRootDomain(): boolean {
    return this.usesSubdomains && this.currentSlug() === null;
  }

  /** Origem (sem rota) do subdomínio de uma conta, ex.: https://acme.ispcfacil.co.mz */
  accountOrigin(slug: string): string {
    return this.origin(`${slug}.${environment.rootDomain}`);
  }

  /** URL absoluto de uma rota (hash routing) dentro do subdomínio de uma conta. */
  accountUrl(slug: string, route = '/painel'): string {
    return this.buildUrl(`${slug}.${environment.rootDomain}`, route);
  }

  /** URL absoluto de uma rota (hash routing) no domínio raiz. */
  rootUrl(route = '/'): string {
    return this.buildUrl(environment.rootDomain, route);
  }

  private origin(host: string): string {
    const { protocol, port } = window.location;
    return `${protocol}//${host}${port ? `:${port}` : ''}`;
  }

  private buildUrl(host: string, route: string): string {
    const cleanRoute = route.startsWith('/') ? route : `/${route}`;
    return `${this.origin(host)}/#${cleanRoute}`;
  }
}
