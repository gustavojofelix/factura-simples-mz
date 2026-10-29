import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { CompanyService } from '../services/company.service';

/**
 * Para páginas fora do MainLayoutComponent (ex.: POS em ecrã inteiro), que não
 * mostram o aviso de contribuinte suspenso: envia para o painel, onde o aviso aparece.
 */
export const activeCompanyGuard: CanActivateFn = async () => {
  const companyService = inject(CompanyService);
  const router = inject(Router);

  if (!companyService.activeCompany()) {
    await companyService.loadCompanies();
  }

  return companyService.isCompanySuspended() ? router.createUrlTree(['/painel']) : true;
};
