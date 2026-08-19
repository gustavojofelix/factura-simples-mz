import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';
import { AuditLogService } from './audit-log.service';
import { Router } from '@angular/router';
import { provideRouter } from '@angular/router';

describe('AuthService', () => {
  let service: AuthService;
  let supabaseMock: any;
  let routerMock: any;
  let auditLogMock: any;

  beforeEach(() => {
    supabaseMock = {
      auth: {
        signInWithPassword: jasmine.createSpy('signInWithPassword'),
        signOut: jasmine.createSpy('signOut').mockResolvedValue({ error: null }),
        onAuthStateChange: jasmine.createSpy('onAuthStateChange').and.returnValue({ data: { subscription: { unsubscribe: () => {} } } }),
        getSession: jasmine.createSpy('getSession').mockResolvedValue({ data: { session: null }, error: null })
      },
      db: {
        from: jasmine.createSpy('from').and.returnValue({
          select: jasmine.createSpy('select').and.returnValue({
            eq: jasmine.createSpy('eq').and.returnValue({
              single: jasmine.createSpy('single').mockResolvedValue({ data: {}, error: null })
            })
          })
        })
      }
    };

    routerMock = {
      navigate: jasmine.createSpy('navigate')
    };

    auditLogMock = {
      logAction: jasmine.createSpy('logAction').mockResolvedValue(true)
    };

    TestBed.configureTestingModule({
      providers: [
        AuthService,
        { provide: SupabaseService, useValue: supabaseMock },
        { provide: Router, useValue: routerMock },
        { provide: AuditLogService, useValue: auditLogMock },
        provideRouter([])
      ]
    });
    
    // Cast spy methods for Jasmine if using Jasmine instead of Jest
    service = TestBed.inject(AuthService);
  });

  it('should return false for isAuthenticated when currentUser is null', () => {
    service.currentUser.set(null);
    expect(service.isAuthenticated()).toBeFalse();
  });

  it('should return true for isAuthenticated when currentUser is set', () => {
    service.currentUser.set({ id: '123' } as any);
    expect(service.isAuthenticated()).toBeTrue();
  });

  it('should return success with user on valid credentials for signIn()', async () => {
    const mockUser = { id: '123', email: 'test@example.com' };
    supabaseMock.auth.signInWithPassword.and.returnValue(Promise.resolve({
      data: { user: mockUser },
      error: null
    }));

    const result = await service.signIn('test@example.com', 'password123');
    
    expect(result.success).toBeTrue();
    expect(result.user).toEqual(mockUser as any);
    expect(service.currentUser()).toEqual(mockUser as any);
  });

  it('should return error message on invalid credentials for signIn()', async () => {
    supabaseMock.auth.signInWithPassword.and.returnValue(Promise.resolve({
      data: { user: null },
      error: { message: 'Invalid login credentials' }
    }));

    const result = await service.signIn('test@example.com', 'wrongpassword');
    
    expect(result.success).toBeFalse();
    expect(result.error).toBe('Email ou palavra-passe incorretos');
  });

  it('should clear user and navigate to / on signOut()', async () => {
    service.currentUser.set({ id: '123' } as any);
    
    await service.signOut();
    
    expect(supabaseMock.auth.signOut).toHaveBeenCalled();
    expect(service.currentUser()).toBeNull();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/']);
  });

  it('should correctly translate error messages', () => {
    const errorMessage = (service as any).translateError({ message: 'Invalid login credentials' });
    expect(errorMessage).toBe('Email ou palavra-passe incorretos');
  });
});
