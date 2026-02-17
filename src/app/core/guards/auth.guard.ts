import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = async (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  await authService.waitForInitialization();

  if (authService.isAuthenticated()) {
    return true;
  }

  router.navigate(['/entrar'], { queryParams: { returnUrl: state.url } });
  return false;
};

export const guestGuard: CanActivateFn = async (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  await authService.waitForInitialization();

  if (!authService.isAuthenticated()) {
    return true;
  }

  router.navigate(['/painel']);
  return false;
};
