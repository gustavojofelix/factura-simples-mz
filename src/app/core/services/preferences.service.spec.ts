import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PreferencesService } from './preferences.service';
import { SupabaseService } from './supabase.service';
import { CompanyService } from './company.service';
import { formatDateParts, formatIsoDate } from '../utils/date.util';

describe('date.util', () => {
  it('formatDateParts respeita os três formatos', () => {
    expect(formatDateParts('2026', '10', '08', 'DD/MM/YYYY')).toBe('08/10/2026');
    expect(formatDateParts('2026', '10', '08', 'MM/DD/YYYY')).toBe('10/08/2026');
    expect(formatDateParts('2026', '10', '08', 'YYYY-MM-DD')).toBe('2026-10-08');
  });

  it('formatIsoDate mantém DD/MM/AAAA por omissão', () => {
    expect(formatIsoDate('2026-01-31')).toBe('31/01/2026');
    expect(formatIsoDate('2026-01-31', 'YYYY-MM-DD')).toBe('2026-01-31');
  });
});

describe('PreferencesService', () => {
  let service: PreferencesService;

  beforeEach(() => {
    try { localStorage.removeItem('displayPreferences'); } catch { /* ignora */ }
    TestBed.configureTestingModule({
      providers: [
        PreferencesService,
        { provide: SupabaseService, useValue: {} },
        { provide: CompanyService, useValue: { activeCompany: signal(null) } }
      ]
    });
    service = TestBed.inject(PreferencesService);
  });

  it('datas de calendário nunca mudam de dia, qualquer que seja o fuso', () => {
    for (const tz of ['Africa/Maputo', 'UTC', 'America/New_York', 'Pacific/Kiritimati']) {
      service.apply({ timezone: tz, date_format: 'DD/MM/YYYY' });
      expect(service.formatDate('2026-10-08')).toBe('08/10/2026');
    }
  });

  it('timestamps são convertidos para o fuso configurado', () => {
    service.apply({ timezone: 'Africa/Maputo', date_format: 'DD/MM/YYYY' });
    expect(service.formatDateTime('2026-10-07T23:30:00Z')).toBe('08/10/2026 01:30');
    service.apply({ timezone: 'UTC', date_format: 'DD/MM/YYYY' });
    expect(service.formatDateTime('2026-10-07T23:30:00Z')).toBe('07/10/2026 23:30');
  });

  it('aplica o formato escolhido', () => {
    service.apply({ timezone: 'Africa/Maputo', date_format: 'MM/DD/YYYY' });
    expect(service.formatDate('2026-10-08')).toBe('10/08/2026');
    expect(service.format('2026-10-08T10:05:09Z', 'datetime-seconds')).toBe('10/08/2026 12:05:09');
    service.apply({ timezone: 'Africa/Maputo', date_format: 'YYYY-MM-DD' });
    expect(service.formatDate('2026-10-08')).toBe('2026-10-08');
    expect(service.format('2026-10-08', 'short')).toBe('10-08');
  });

  it('valores inválidos voltam ao padrão', () => {
    service.apply({ timezone: 'Nao/Existe', date_format: 'XX' });
    expect(service.timezone()).toBe('Africa/Maputo');
    expect(service.dateFormat()).toBe('DD/MM/YYYY');
    expect(service.formatDate(null)).toBe('');
    expect(service.formatDate('lixo')).toBe('');
  });
});
