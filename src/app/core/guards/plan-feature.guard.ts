import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { CompanyService } from '../services/company.service';
import { SubscriptionService } from '../services/subscription.service';
import { ToastService } from '../services/toast.service';
import { t } from '../i18n/i18n';

/**
 * Restringe uma rota às empresas cujo plano inclui a funcionalidade (ex.:
 * 'reports'). Quando o back office tira a funcionalidade a um plano, o menu
 * esconde a secção e este guard impede o acesso directo pelo URL, levando o
 * utilizador à página de subscrição.
 */
export function planFeatureGuard(featureCode: string): CanActivateFn {
  return async () => {
    const companyService = inject(CompanyService);
    const subscriptionService = inject(SubscriptionService);
    const toast = inject(ToastService);
    const router = inject(Router);

    if (!companyService.activeCompany()) {
      await companyService.loadCompanies();
    }
    const company = companyService.activeCompany();
    if (!company) return true;

    if (!subscriptionService.planFeaturesLoadedFor(company.id)) {
      await subscriptionService.loadSubscription(company.id);
    }

    if (subscriptionService.hasPlanFeature(featureCode, company.id)) return true;

    toast.warning(t('reports.planLocked.title'), t('reports.planLocked.message'));
    return router.createUrlTree(['/configuracoes'], { queryParams: { tab: 'subscricao' } });
  };
}
