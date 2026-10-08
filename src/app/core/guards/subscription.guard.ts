import { inject } from '@angular/core';
import { CanActivateChildFn, Router } from '@angular/router';
import { CompanyService } from '../services/company.service';
import { SubscriptionService } from '../services/subscription.service';

/** Páginas que continuam acessíveis com a subscrição expirada (para poder subscrever). */
export const SUBSCRIPTION_FREE_PATHS = ['/configuracoes', '/perfil'];

/** Separador "Subscrições" em Configurações. */
export const SUBSCRIPTION_TAB_INDEX = 1;

export function isSubscriptionFreeUrl(url: string): boolean {
  const path = url.split(/[?#]/)[0];
  return SUBSCRIPTION_FREE_PATHS.some(p => path === p || path.startsWith(`${p}/`));
}

/**
 * Bloqueia todo o sistema quando o período experimental ou a subscrição da
 * empresa activa expirou, deixando apenas a página de subscrição. O servidor
 * aplica o mesmo bloqueio (enforce_active_subscription) a escritas directas.
 */
export const subscriptionGuard: CanActivateChildFn = async (_route, state) => {
  if (isSubscriptionFreeUrl(state.url)) return true;

  const companyService = inject(CompanyService);
  const subscriptionService = inject(SubscriptionService);
  const router = inject(Router);

  if (!companyService.activeCompany()) {
    await companyService.loadCompanies();
  }
  const company = companyService.activeCompany();
  if (!company) return true;

  if (subscriptionService.subscription()?.company_id !== company.id) {
    await subscriptionService.loadSubscription(company.id);
  }

  if (!subscriptionService.isExpired()) return true;

  return router.createUrlTree(['/configuracoes'], { queryParams: { tab: 'subscricao' } });
};
