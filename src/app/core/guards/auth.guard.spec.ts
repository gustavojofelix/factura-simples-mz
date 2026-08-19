import { TestBed } from '@angular/core/testing';
import { Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { authGuard, guestGuard } from './auth.guard';

describe('Auth Guards', () => {
  let mockAuthService: any;
  let mockRouter: any;
  let mockRoute: ActivatedRouteSnapshot;
  let mockState: RouterStateSnapshot;

  beforeEach(() => {
    mockAuthService = {
      waitForInitialization: jasmine.createSpy().and.resolveTo(),
      isAuthenticated: jasmine.createSpy()
    };

    mockRouter = {
      navigate: jasmine.createSpy()
    };

    mockRoute = {} as ActivatedRouteSnapshot;
    mockState = { url: '/test-url' } as RouterStateSnapshot;

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: Router, useValue: mockRouter }
      ]
    });
  });

  describe('authGuard', () => {
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
