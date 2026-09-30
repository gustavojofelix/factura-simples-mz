import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { CompanyService } from '../services/company.service';

/**
 * Restringe uma rota aos papéis indicados na empresa activa.
 *
 * O menu já esconde as entradas a quem não tem acesso, mas isso não impede
 * a navegação directa pelo URL. O servidor valida de novo nas funções SQL.
 */
export function roleGuard(allowedRoles: string[]): CanActivateFn {
  return async () => {
    const authService = inject(AuthService);
    const companyService = inject(CompanyService);
    const router = inject(Router);

    await authService.waitForInitialization();

    if (!companyService.activeCompany()) {
      await companyService.loadCompanies();
    }

    const company = companyService.activeCompany();
    let role = companyService.activeRole();
    if (company && !role) {
      role = await companyService.getUserRole(company.id);
    }

    if (role && allowedRoles.includes(role)) return true;

    return router.createUrlTree(['/painel']);
  };
}

/** Papéis com acesso a Relatórios e Extractos. */
export const REPORT_ROLES = ['owner', 'admin', 'manager'];
