import { Injectable, effect, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CompanyService } from './company.service';
import {
  DateFormat,
  DEFAULT_DATE_FORMAT,
  formatDateParts,
  formatDayMonthParts,
  toDateFormat
} from '../utils/date.util';

export const DEFAULT_TIMEZONE = 'Africa/Maputo';

/** Fusos horários disponíveis nas Configurações do Sistema. */
export const SUPPORTED_TIMEZONES = ['Africa/Maputo', 'Africa/Johannesburg', 'UTC'] as const;

export interface DisplayPreferences {
  timezone: string;
  date_format: DateFormat;
  language: string;
}

export type AppDateStyle = 'date' | 'datetime' | 'datetime-seconds' | 'time' | 'short';

const STORAGE_KEY = 'displayPreferences';
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('pt-PT', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Preferências de apresentação da empresa activa (Configurações > Sistema):
 * fuso horário e formato de data. Carregadas ao entrar e ao mudar de empresa.
 *
 * Regra importante: datas de calendário ('AAAA-MM-DD', ex.: data da factura)
 * são formatadas a partir das partes, SEM conversão de fuso — caso contrário
 * podiam aparecer com o dia anterior/seguinte.
 */
@Injectable({ providedIn: 'root' })
export class PreferencesService {
  readonly timezone = signal<string>(DEFAULT_TIMEZONE);
  readonly dateFormat = signal<DateFormat>(DEFAULT_DATE_FORMAT);
  readonly language = signal<string>('pt');

  private loadedFor: string | null = null;
  private formatterCache = new Map<string, Intl.DateTimeFormat>();

  constructor(
    private supabase: SupabaseService,
    private companyService: CompanyService
  ) {
    this.restoreFromStorage();

    effect(() => {
      const companyId = this.companyService.activeCompany()?.id ?? null;
      if (companyId && companyId !== this.loadedFor) {
        this.loadedFor = companyId;
        void this.load(companyId);
      } else if (!companyId) {
        this.loadedFor = null;
      }
    });
  }

  /** Lê system_settings da empresa e aplica-as. Falhas mantêm os valores actuais. */
  async load(companyId: string): Promise<void> {
    try {
      const { data, error } = await this.supabase.client
        .from('system_settings')
        .select('language, timezone, date_format')
        .eq('company_id', companyId)
        .maybeSingle();
      if (error) throw error;
      // A empresa activa pode ter mudado entretanto.
      if (this.companyService.activeCompany()?.id !== companyId) return;
      this.apply(data ?? {});
    } catch (error) {
      console.error('Erro ao carregar preferências do sistema:', error);
    }
  }

  /** Aplica valores (por ex. logo após guardar nas Configurações). */
  apply(prefs: Partial<{ timezone: string | null; date_format: string | null; language: string | null }>): void {
    this.timezone.set(isValidTimezone(prefs.timezone) ? prefs.timezone : DEFAULT_TIMEZONE);
    this.dateFormat.set(toDateFormat(prefs.date_format));
    this.language.set(prefs.language || 'pt');
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        timezone: this.timezone(),
        date_format: this.dateFormat(),
        language: this.language()
      }));
    } catch { /* armazenamento indisponível: ignora */ }
  }

  /** Activa as preferências se a empresa indicada for a empresa activa. */
  applyIfActive(companyId: string, prefs: Partial<{ timezone: string | null; date_format: string | null; language: string | null }>): void {
    if (this.companyService.activeCompany()?.id === companyId) this.apply(prefs);
  }

  /**
   * Formata uma data segundo as preferências.
   * - 'date' (por defeito): data
   * - 'datetime': data + HH:mm
   * - 'datetime-seconds': data + HH:mm:ss
   * - 'time': HH:mm
   * - 'short': dia e mês (sem ano)
   */
  format(value: string | Date | number | null | undefined, style: AppDateStyle = 'date'): string {
    if (value === null || value === undefined || value === '') return '';
    const fmt = this.dateFormat();

    if (typeof value === 'string' && DATE_ONLY.test(value)) {
      const [y, m, d] = value.split('-');
      if (style === 'short') return formatDayMonthParts(m, d, fmt);
      if (style === 'time') return '';
      return formatDateParts(y, m, d, fmt);
    }

    const date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime())) return '';

    const p = this.parts(date);
    const time = style === 'datetime-seconds' ? `${p.hour}:${p.minute}:${p.second}` : `${p.hour}:${p.minute}`;
    switch (style) {
      case 'time': return time;
      case 'short': return formatDayMonthParts(p.month, p.day, fmt);
      case 'datetime':
      case 'datetime-seconds':
        return `${formatDateParts(p.year, p.month, p.day, fmt)} ${time}`;
      default:
        return formatDateParts(p.year, p.month, p.day, fmt);
    }
  }

  formatDate(value: string | Date | number | null | undefined): string {
    return this.format(value, 'date');
  }

  formatDateTime(value: string | Date | number | null | undefined, seconds = false): string {
    return this.format(value, seconds ? 'datetime-seconds' : 'datetime');
  }

  formatTime(value: string | Date | number | null | undefined): string {
    return this.format(value, 'time');
  }

  /** Partes da data no fuso horário configurado. */
  parts(date: Date): { year: string; month: string; day: string; hour: string; minute: string; second: string } {
    const tz = this.timezone();
    let formatter = this.formatterCache.get(tz);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hourCycle: 'h23'
      });
      this.formatterCache.set(tz, formatter);
    }
    const out: Record<string, string> = {};
    for (const part of formatter.formatToParts(date)) out[part.type] = part.value;
    return {
      year: out['year'],
      month: out['month'],
      day: out['day'],
      hour: out['hour'] === '24' ? '00' : out['hour'],
      minute: out['minute'],
      second: out['second']
    };
  }

  /** 'AAAA-MM-DD' de hoje no fuso horário configurado. */
  todayIso(): string {
    const p = this.parts(new Date());
    return `${p.year}-${p.month}-${p.day}`;
  }

  private restoreFromStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (isValidTimezone(saved?.timezone)) this.timezone.set(saved.timezone);
      this.dateFormat.set(toDateFormat(saved?.date_format));
      if (typeof saved?.language === 'string') this.language.set(saved.language);
    } catch { /* ignora */ }
  }
}
