import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const adminGuard: CanActivateFn = async (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  await authService.waitForInitialization();

  const user = await authService.getCurrentUser();
  const userEmail = (user?.email || '').trim().toLowerCase();

  // Super admin email bypass: ALWAYS allow access for gustavojofelix@gmail.com
  if (userEmail === 'gustavojofelix@gmail.com') {
    return true;
  }

  const isAdmin = await authService.isAdmin();
  if (isAdmin) {
    return true;
  }

  if (!user) {
    router.navigate(['/admin/entrar'], { queryParams: { returnUrl: state.url } });
    return false;
  }

  router.navigate(['/admin/entrar']);
  return false;
};

export const adminGuestGuard: CanActivateFn = async (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  await authService.waitForInitialization();

  const user = await authService.getCurrentUser();
  const userEmail = (user?.email || '').trim().toLowerCase();

  if (userEmail === 'gustavojofelix@gmail.com') {
    router.navigate(['/admin']);
    return false;
  }

  if (!user) {
    return true;
  }

  const isAdmin = await authService.isAdmin();
  if (isAdmin) {
    router.navigate(['/admin']);
    return false;
  }

  return true;
};
