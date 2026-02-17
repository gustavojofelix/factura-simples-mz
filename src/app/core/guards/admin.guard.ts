import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const adminGuard: CanActivateFn = async (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  await authService.waitForInitialization();

  if (!authService.isAuthenticated()) {
    router.navigate(['/entrar'], { queryParams: { returnUrl: state.url } });
    return false;
  }

  const isAdmin = await authService.isAdmin();
  if (isAdmin) {
    return true;
  }

  router.navigate(['/painel']);
  return false;
};
