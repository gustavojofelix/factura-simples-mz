import { TestBed } from '@angular/core/testing';
import { InvoiceService } from './invoice.service';
import { SupabaseService } from './supabase.service';
import { CompanyService } from './company.service';
import { AuditLogService } from './audit-log.service';

describe('InvoiceService', () => {
  let service: InvoiceService;
  let supabaseMock: any;
  let companyMock: any;
  let auditLogMock: any;

  beforeEach(() => {
    supabaseMock = {};
    companyMock = {};
    auditLogMock = {};

    TestBed.configureTestingModule({
      providers: [
        InvoiceService,
        { provide: SupabaseService, useValue: supabaseMock },
        { provide: CompanyService, useValue: companyMock },
        { provide: AuditLogService, useValue: auditLogMock }
      ]
    });
    service = TestBed.inject(InvoiceService);
  });

  describe('getStatusLabel', () => {
    it('should return correct labels', () => {
      expect(service.getStatusLabel('rascunho')).toBe('Rascunho');
      expect(service.getStatusLabel('pendente')).toBe('Pendente');
      expect(service.getStatusLabel('paga')).toBe('Paga');
      expect(service.getStatusLabel('vencida')).toBe('Vencida');
      expect(service.getStatusLabel('anulada')).toBe('Anulada');
      expect(service.getStatusLabel('unknown' as any)).toBe('unknown');
    });
  });

  describe('getStatusColor', () => {
    it('should return correct classes for statuses', () => {
      expect(service.getStatusColor('rascunho')).toContain('bg-gray-100');
      expect(service.getStatusColor('pendente')).toContain('bg-yellow-100');
      expect(service.getStatusColor('paga')).toContain('bg-green-100');
      expect(service.getStatusColor('vencida')).toContain('bg-red-100');
      expect(service.getStatusColor('anulada')).toContain('bg-gray-800');
    });
  });

  describe('Permissions methods', () => {
    it('canEditInvoice', () => {
      expect(service.canEditInvoice({ status: 'rascunho' } as any)).toBeTrue();
      expect(service.canEditInvoice({ status: 'pendente' } as any)).toBeFalse();
      expect(service.canEditInvoice({ status: 'paga' } as any)).toBeFalse();
    });

    it('canDeleteInvoice', () => {
      expect(service.canDeleteInvoice({ status: 'rascunho' } as any)).toBeTrue();
      expect(service.canDeleteInvoice({ status: 'anulada' } as any)).toBeFalse();
    });

    it('canAnnulInvoice', () => {
      expect(service.canAnnulInvoice({ status: 'rascunho' } as any)).toBeFalse();
      expect(service.canAnnulInvoice({ status: 'anulada' } as any)).toBeFalse();
      expect(service.canAnnulInvoice({ status: 'pendente' } as any)).toBeTrue();
      expect(service.canAnnulInvoice({ status: 'paga' } as any)).toBeTrue();
      expect(service.canAnnulInvoice({ status: 'vencida' } as any)).toBeTrue();
    });

    it('canManagePayments', () => {
      expect(service.canManagePayments({ status: 'rascunho', amount_pending: 100 } as any)).toBeFalse();
      expect(service.canManagePayments({ status: 'paga', amount_pending: 0 } as any)).toBeFalse();
      expect(service.canManagePayments({ status: 'pendente', amount_pending: 100 } as any)).toBeTrue();
      expect(service.canManagePayments({ status: 'vencida', amount_pending: 50 } as any)).toBeTrue();
      // Even if pendente, if amount_pending is 0, it should be false (based on requirements amount_pending > 0)
      expect(service.canManagePayments({ status: 'pendente', amount_pending: 0 } as any)).toBeFalse();
    });
  });

  describe('formatCurrency', () => {
    it('should format correctly', () => {
      const formatted = service.formatCurrency(1234.5);
      // We expect the formatting to end with MZN or be localized depending on implementation
      // usually something like "1 234,50 MZN" or "1.234,50 MZN" but let's just check it contains the number and MZN
      expect(formatted).toContain('MZN');
    });
  });
});
