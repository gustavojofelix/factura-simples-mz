import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { ErrorHandlerService } from './error-handler.service';

describe('ErrorHandlerService', () => {
  let service: ErrorHandlerService;
  let mockSnackBar: any;
  let mockRouter: any;

  beforeEach(() => {
    mockSnackBar = {
      open: jasmine.createSpy()
    };
    mockRouter = {
      navigate: jasmine.createSpy()
    };

    TestBed.configureTestingModule({
      providers: [
        ErrorHandlerService,
        { provide: MatSnackBar, useValue: mockSnackBar },
        { provide: Router, useValue: mockRouter }
      ]
    });
    service = TestBed.inject(ErrorHandlerService);
  });

  it('should create', () => {
    expect(service).toBeTruthy();
  });

  describe('classify', () => {
    it('should return network type for "Failed to fetch"', () => {
      const error = new Error('Failed to fetch data');
      const result = service.classify(error);
      expect(result.type).toBe('network');
    });

    it('should return auth type for "Invalid login credentials"', () => {
      const error = new Error('Invalid login credentials');
      const result = service.classify(error);
      expect(result.type).toBe('auth');
    });

    it('should return auth type for status 401', () => {
      const error = { status: 401, message: 'Unauthorized' };
      const result = service.classify(error);
      expect(result.type).toBe('auth');
    });

    it('should return auth type for status 403', () => {
      const error = { status: 403, message: 'Forbidden' };
      const result = service.classify(error);
      expect(result.type).toBe('auth');
    });

    it('should return server type for status 500', () => {
      const error = { status: 500, message: 'Internal Server Error' };
      const result = service.classify(error);
      expect(result.type).toBe('server');
    });

    it('should return unknown for null error', () => {
      const result = service.classify(null);
      expect(result.type).toBe('unknown');
    });
  });

  describe('translate', () => {
    it('should return Portuguese for known errors', () => {
      const result = service.translate('Invalid login credentials');
      expect(result).toBe('Email ou palavra-passe incorretos');
    });

    it('should return null for unknown errors', () => {
      const result = service.translate('Some weird error that does not exist');
      expect(result).toBeNull();
    });
  });

  describe('handle', () => {
    it('should show snackbar and navigate for auth errors', () => {
      const error = { status: 401, message: 'Unauthorized' };
      service.handle(error);
      expect(mockSnackBar.open).toHaveBeenCalled();
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/entrar']);
    });

    it('should show snackbar for non-auth errors', () => {
      const error = { status: 500, message: 'Server error' };
      service.handle(error);
      expect(mockSnackBar.open).toHaveBeenCalled();
      expect(mockRouter.navigate).not.toHaveBeenCalled();
    });
  });
});
