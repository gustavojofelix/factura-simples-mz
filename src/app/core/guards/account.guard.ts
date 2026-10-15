import { inject } from '@angular/core';
import { CanActivateFn, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { AccountService } from '../services/account.service';
import { TenantService } from '../services/tenant.service';

interface GuardDeps {
  authService: AuthService;
  accountService: AccountService;
  tenant: TenantService;
  router: Router;
}

function injectDeps(): GuardDeps {
  return {
    authService: inject(AuthService),
    accountService: inject(AccountService),
    tenant: inject(TenantService),
    router: inject(Router)
  };
}

/**
 * Resolve a conta activa. Na raiz (web) redirecciona para o subdomínio da conta;
 * num subdomínio sem acesso envia para /sem-acesso. Deve correr depois do authGuard.
 */
async function resolveAccount(deps: GuardDeps, state: RouterStateSnapshot): Promise<boolean | UrlTree> {
  const { authService, accountService, tenant, router } = deps;

  await authService.waitForInitialization();
  if (!authService.isAuthenticated()) return router.parseUrl('/entrar');

  await accountService.ensureLoaded();

  if (accountService.accessDenied()) return router.parseUrl('/sem-acesso');

  const accounts = accountService.accounts();
  if (accounts.length === 0) return router.parseUrl('/configurar-conta');

  if (tenant.isOnRootDomain()) {
    if (accounts.length > 1) return router.parseUrl('/escolher-conta');
    window.location.href = tenant.accountUrl(accounts[0].slug, state.url);
    return false;
  }

  return true;
}

/** Rotas da aplicação (painel, facturas, ...). */
export const accountGuard: CanActivateFn = async (_route, state) => {
  const deps = injectDeps();
  const result = await resolveAccount(deps, state);
  if (result !== true) return result;

  // O titular de uma conta ainda sem empresas tem de configurar a primeira.
  const home = await deps.accountService.homeRouteFor(deps.accountService.activeAccount()!);
  if (home === '/configurar-empresa') return deps.router.parseUrl('/configurar-empresa');

  return true;
};

/** /configurar-empresa: exige que a conta activa seja do utilizador. */
export const ownedAccountGuard: CanActivateFn = async (_route, state) => {
  const deps = injectDeps();
  const result = await resolveAccount(deps, state);
  if (result !== true) return result;

  const { accountService, tenant, router } = deps;
  if (accountService.isAccountOwner()) return true;

  // Membro de outra conta sem conta própria: tem de criar a sua primeiro.
  const owned = accountService.ownedAccount();
  if (!owned) return router.parseUrl('/configurar-conta');

  accountService.switchAccount(owned, '/configurar-empresa');
  return tenant.usesSubdomains ? false : router.parseUrl('/configurar-empresa');
};

/** No subdomínio de uma conta a landing não existe: vai directo ao login da conta. */
export const accountLandingGuard: CanActivateFn = () => {
  const tenant = inject(TenantService);
  return tenant.currentSlug() ? inject(Router).parseUrl('/entrar') : true;
};

/** Páginas que só existem no domínio raiz (ex.: registo de nova conta). */
export const rootDomainOnlyGuard: CanActivateFn = (_route, state) => {
  const tenant = inject(TenantService);
  if (!tenant.currentSlug()) return true;
  window.location.href = tenant.rootUrl(state.url);
  return false;
};
