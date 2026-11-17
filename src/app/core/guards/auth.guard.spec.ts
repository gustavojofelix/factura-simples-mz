import { TestBed } from '@angular/core/testing';
import { Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { AccountDeletionService } from '../services/account-deletion.service';
import { authGuard, guestGuard } from './auth.guard';

describe('Auth Guards', () => {
  let mockAuthService: any;
  let mockRouter: any;
  let mockDeletionService: any;
  let mockRoute: ActivatedRouteSnapshot;
  let mockState: RouterStateSnapshot;

  beforeEach(() => {
    mockAuthService = {
      waitForInitialization: jasmine.createSpy().and.resolveTo(),
      isAuthenticated: jasmine.createSpy(),
      isCurrentUserSuspended: jasmine.createSpy().and.resolveTo(false),
      currentUser: jasmine.createSpy().and.returnValue({ id: 'user-1' })
    };

    mockDeletionService = {
      pendingDeletion: jasmine.createSpy().and.resolveTo(null)
    };

    mockRouter = {
      navigate: jasmine.createSpy(),
      createUrlTree: jasmine.createSpy().and.callFake((commands: string[]) => ({ commands }))
    };

    mockRoute = {} as ActivatedRouteSnapshot;
    mockState = { url: '/test-url' } as RouterStateSnapshot;

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: Router, useValue: mockRouter },
        { provide: AccountDeletionService, useValue: mockDeletionService }
      ]
    });
  });

  describe('authGuard', () => {
    it('should redirect to the pending-deletion screen when the account is being deleted', async () => {
      mockAuthService.isAuthenticated.and.returnValue(true);
      mockDeletionService.pendingDeletion.and.resolveTo({ id: 'r1', status: 'pending', scheduled_for: '2026-12-17' });
      const result: any = await TestBed.runInInjectionContext(() => authGuard(mockRoute, mockState));
      expect(result).toEqual({ commands: ['/conta-em-eliminacao'] });
    });

    it('should allow access when user is authenticated', async () => {
      mockAuthService.isAuthenticated.and.returnValue(true);
      const result = await TestBed.runInInjectionContext(() => authGuard(mockRoute, mockState));
      expect(result).toBeTrue();
      expect(mockRouter.navigate).not.toHaveBeenCalled();
    });

    it('should redirect to /entrar when user is NOT authenticated', async () => {
      mockAuthService.isAuthenticated.and.returnValue(false);
      const result = await TestBed.runInInjectionContext(() => authGuard(mockRoute, mockState));
      expect(result).toBeFalse();
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/entrar'], { queryParams: { returnUrl: '/test-url' } });
    });
  });

  describe('guestGuard', () => {
    it('should allow access when user is NOT authenticated', async () => {
      mockAuthService.isAuthenticated.and.returnValue(false);
      const result = await TestBed.runInInjectionContext(() => guestGuard(mockRoute, mockState));
      expect(result).toBeTrue();
      expect(mockRouter.navigate).not.toHaveBeenCalled();
    });

    it('should redirect to /painel when user IS authenticated', async () => {
      mockAuthService.isAuthenticated.and.returnValue(true);
      const result = await TestBed.runInInjectionContext(() => guestGuard(mockRoute, mockState));
      expect(result).toBeFalse();
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/painel']);
    });
  });
});
