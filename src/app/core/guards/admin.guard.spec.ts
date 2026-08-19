import { TestBed } from '@angular/core/testing';
import { Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { adminGuard, adminGuestGuard } from './admin.guard';

describe('Admin Guards', () => {
  let mockAuthService: any;
  let mockRouter: any;
  let mockRoute: ActivatedRouteSnapshot;
  let mockState: RouterStateSnapshot;

  beforeEach(() => {
    mockAuthService = {
      waitForInitialization: jasmine.createSpy().and.resolveTo(),
      getCurrentUser: jasmine.createSpy(),
      isAdmin: jasmine.createSpy()
    };

    mockRouter = {
      navigate: jasmine.createSpy()
    };

    mockRoute = {} as ActivatedRouteSnapshot;
    mockState = { url: '/admin/test-url' } as RouterStateSnapshot;

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: Router, useValue: mockRouter }
      ]
    });
  });

  describe('adminGuard', () => {
    it('should allow access for authenticated admin user', async () => {
      mockAuthService.getCurrentUser.and.resolveTo({ id: 'user1' });
      mockAuthService.isAdmin.and.resolveTo(true);
      const result = await TestBed.runInInjectionContext(() => adminGuard(mockRoute, mockState));
      expect(result).toBeTrue();
      expect(mockRouter.navigate).not.toHaveBeenCalled();
    });

    it('should redirect to /admin/entrar when no user', async () => {
      mockAuthService.getCurrentUser.and.resolveTo(null);
      const result = await TestBed.runInInjectionContext(() => adminGuard(mockRoute, mockState));
      expect(result).toBeFalse();
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/admin/entrar'], { queryParams: { returnUrl: '/admin/test-url' } });
    });

    it('should redirect to /admin/entrar when user is not admin', async () => {
      mockAuthService.getCurrentUser.and.resolveTo({ id: 'user1' });
      mockAuthService.isAdmin.and.resolveTo(false);
      const result = await TestBed.runInInjectionContext(() => adminGuard(mockRoute, mockState));
      expect(result).toBeFalse();
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/admin/entrar']);
    });
  });

  describe('adminGuestGuard', () => {
    it('should allow access when no user', async () => {
      mockAuthService.getCurrentUser.and.resolveTo(null);
      const result = await TestBed.runInInjectionContext(() => adminGuestGuard(mockRoute, mockState));
      expect(result).toBeTrue();
      expect(mockRouter.navigate).not.toHaveBeenCalled();
    });

    it('should allow access when user is not admin', async () => {
      mockAuthService.getCurrentUser.and.resolveTo({ id: 'user1' });
      mockAuthService.isAdmin.and.resolveTo(false);
      const result = await TestBed.runInInjectionContext(() => adminGuestGuard(mockRoute, mockState));
      expect(result).toBeTrue();
      expect(mockRouter.navigate).not.toHaveBeenCalled();
    });

    it('should redirect to /admin when user is admin', async () => {
      mockAuthService.getCurrentUser.and.resolveTo({ id: 'user1' });
      mockAuthService.isAdmin.and.resolveTo(true);
      const result = await TestBed.runInInjectionContext(() => adminGuestGuard(mockRoute, mockState));
      expect(result).toBeFalse();
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/admin']);
    });
  });
});
