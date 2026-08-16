import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const adminGuard: CanActivateFn = async (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  await authService.waitForInitialization();

  // Check user existence FIRST — never allow access without an authenticated user
  const user = await authService.getCurrentUser();
  if (!user) {
    router.navigate(['/admin/entrar'], { queryParams: { returnUrl: state.url } });
    return false;
  }

  // Delegate role check entirely to the service (reads from DB, no hardcoded emails)
  const isAdmin = await authService.isAdmin();
  if (isAdmin) return true;

  router.navigate(['/admin/entrar']);
  return false;
};

export const adminGuestGuard: CanActivateFn = async (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  await authService.waitForInitialization();

  const user = await authService.getCurrentUser();

  // If not logged in, allow access to the login page
  if (!user) return true;

  // If already an admin, redirect to the back office
  const isAdmin = await authService.isAdmin();
  if (isAdmin) {
    router.navigate(['/admin']);
    return false;
  }

  return true;
};
