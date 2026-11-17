import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { AccountDeletionService } from '../services/account-deletion.service';

export const DELETION_PENDING_URL = '/conta-em-eliminacao';

export const authGuard: CanActivateFn = async (route, state) => {
  const authService = inject(AuthService);
  const deletionService = inject(AccountDeletionService);
  const router = inject(Router);

  await authService.waitForInitialization();

  if (authService.isAuthenticated()) {
    if (await authService.isCurrentUserSuspended()) {
      await authService.signOut();
      router.navigate(['/entrar'], { queryParams: { error: 'suspended' } });
      return false;
    }
    // Conta em eliminação (30 dias de carência): só o ecrã para cancelar.
    const user = authService.currentUser();
    if (user && !state.url.startsWith(DELETION_PENDING_URL)) {
      if (await deletionService.pendingDeletion(user.id)) {
        return router.createUrlTree([DELETION_PENDING_URL]);
      }
    }
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
