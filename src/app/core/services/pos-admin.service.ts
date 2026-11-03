import { Injectable, effect, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CompanyService } from './company.service';
import type { PosAccess, PosCompanySettings, PosMode, PosPaymentMethod, PosSessionReport, PosStaffRole, PosStation } from './pos.service';

/**
 * Configuração do Ponto de Venda na aplicação da empresa (Proprietário,
 * Admin e Gestor): estabelecimento, terminais, funcionários e PIN, mesas,
 * categorias e produtos do POS, caixas e vendas.
 */

export interface PosTerminalRow {
  id: string;
  name: string;
  auth_user_id: string | null;
  pairing_expires_at: string | null;
  paired_at: string | null;
  last_seen_at: string | null;
  user_agent: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface PosStaffRow {
  id: string;
  user_id: string | null;
  name: string;
  role: PosStaffRole;
  permissions: { can_charge?: boolean; max_discount_pct?: number } & Record<string, unknown>;
  color: string;
  failed_attempts: number;
  locked_until: string | null;
  is_active: boolean;
  has_pin?: boolean;
}

export interface PosZoneRow { id: string; name: string; icon: string | null; sort_order: number; is_active: boolean; }
export interface PosTableRow { id: string; zone_id: string | null; name: string; seats: number; sort_order: number; is_active: boolean; }
export interface PosCategoryRow { id: string; name: string; color: string; icon: string | null; sort_order: number; is_active: boolean; }

export interface PosProductRow {
  id: string;
  code: string;
  name: string;
  price: number;
  type: 'produto' | 'servico';
  unit: string;
  stock: number | null;
  is_active: boolean;
  category_id: string | null;
  pos_visible: boolean;
  pos_station: PosStation | null;
  sold_by_weight: boolean;
  pos_available: boolean;
  image_url: string | null;
}

export interface PosSessionRow {
  id: string;
  number: number;
  status: 'open' | 'closed';
  opened_at: string;
  closed_at: string | null;
  opening_float: number;
  expected_cash: number | null;
  counted_cash: number | null;
  difference: number | null;
  notes: string | null;
  summary: PosSessionReport | null;
  terminal: { name: string } | null;
  opener: { name: string } | null;
  closer: { name: string } | null;
}

export interface PosSalesReport {
  netSales: number;
  frCount: number;
  frTotal: number;
  ncCount: number;
  ncTotal: number;
  voidedCount: number;
  discounts: number;
  byMethod: { method: PosPaymentMethod; total: number; count: number }[];
  byStaff: { name: string; total: number; count: number }[];
  byDay: { date: string; total: number }[];
  byHour: number[];
  topProducts: { name: string; quantity: number; total: number }[];
  simulated: number;
}

export const POS_STAFF_COLORS = ['#f16c39', '#0ea5e9', '#8b5cf6', '#10b981', '#e11d48', '#f59e0b', '#14b8a6', '#6366f1'];

@Injectable({ providedIn: 'root' })
export class PosAdminService {
  private supabase = inject(SupabaseService);
  private companyService = inject(CompanyService);

  /** Estado do POS da empresa activa (plano + tolerância); null enquanto carrega. */
  readonly access = signal<PosAccess | null>(null);

  constructor() {
    effect(() => {
      const company = this.companyService.activeCompany();
      this.access.set(null);
      if (company) this.loadAccess(company.id);
    });
  }

  private get db() {
    return this.supabase.db;
  }

  private companyId(): string {
    const id = this.companyService.activeCompany()?.id;
    if (!id) throw new Error('Sem empresa activa');
    return id;
  }

  /** Os tipos das relações embutidas (staff, terminal…) vêm do select; aqui afirmam-se pelo T. */
  private async run<T>(promise: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
    const { data, error } = await promise;
    if (error) throw new Error(error.message);
    return data as T;
  }

  async loadAccess(companyId: string) {
    const { data } = await this.db.rpc('company_pos_access', { p_company_id: companyId });
    if (this.companyService.activeCompany()?.id === companyId) this.access.set((data as PosAccess) ?? null);
  }

  // ---------- Estabelecimento ----------

  async getSettings(): Promise<{ business_type: PosMode; settings: PosCompanySettings }> {
    const row = await this.run(this.db.from('companies').select('pos_business_type, pos_settings').eq('id', this.companyId()).single());
    const r = row as unknown as { pos_business_type: PosMode; pos_settings: PosCompanySettings };
    return { business_type: r.pos_business_type ?? 'retail', settings: r.pos_settings ?? {} };
  }

  async saveSettings(business_type: PosMode, settings: PosCompanySettings) {
    await this.run(this.db.from('companies').update({ pos_business_type: business_type, pos_settings: settings }).eq('id', this.companyId()));
  }

  // ---------- Terminais ----------

  listTerminals() {
    return this.run<PosTerminalRow[]>(this.db.from('pos_terminals')
      .select('id, name, auth_user_id, pairing_expires_at, paired_at, last_seen_at, user_agent, revoked_at, created_at')
      .eq('company_id', this.companyId())
      .order('revoked_at', { ascending: true, nullsFirst: true })
      .order('created_at'));
  }

  async createTerminal(name: string): Promise<string> {
    const row = await this.run<{ id: string }>(this.db.from('pos_terminals').insert({ company_id: this.companyId(), name }).select('id').single());
    return row.id;
  }

  renameTerminal(id: string, name: string) {
    return this.run(this.db.from('pos_terminals').update({ name }).eq('id', id));
  }

  pairingCode(terminalId: string) {
    return this.run<{ code: string; expires_at: string }>(this.db.rpc('pos_create_pairing_code', { p_terminal_id: terminalId }));
  }

  revokeTerminal(terminalId: string) {
    return this.run(this.db.rpc('pos_revoke_terminal', { p_terminal_id: terminalId }));
  }

  // ---------- Funcionários ----------

  listStaff() {
    return this.run<PosStaffRow[]>(this.db.from('pos_staff')
      .select('id, user_id, name, role, permissions, color, failed_attempts, locked_until, is_active')
      .eq('company_id', this.companyId())
      .order('is_active', { ascending: false })
      .order('name'));
  }

  async saveStaff(staff: Partial<PosStaffRow> & { name: string; role: PosStaffRole }): Promise<string> {
    const payload = {
      name: staff.name.trim(),
      role: staff.role,
      color: staff.color ?? POS_STAFF_COLORS[0],
      permissions: staff.permissions ?? {},
      is_active: staff.is_active ?? true,
      user_id: staff.user_id ?? null
    };
    if (staff.id) {
      await this.run(this.db.from('pos_staff').update(payload).eq('id', staff.id));
      return staff.id;
    }
    const row = await this.run<{ id: string }>(this.db.from('pos_staff').insert({ ...payload, company_id: this.companyId() }).select('id').single());
    return row.id;
  }

  setPin(staffId: string, pin: string) {
    return this.run(this.db.rpc('pos_set_staff_pin', { p_staff_id: staffId, p_pin: pin }));
  }

  unlockStaff(staffId: string) {
    return this.run(this.db.rpc('pos_unlock_staff', { p_staff_id: staffId }));
  }

  // ---------- Zonas e mesas ----------

  listZones() {
    return this.run<PosZoneRow[]>(this.db.from('pos_zones').select('id, name, icon, sort_order, is_active')
      .eq('company_id', this.companyId()).order('sort_order').order('name'));
  }

  listTables() {
    return this.run<PosTableRow[]>(this.db.from('pos_tables').select('id, zone_id, name, seats, sort_order, is_active')
      .eq('company_id', this.companyId()).order('sort_order').order('name'));
  }

  async saveZone(zone: Partial<PosZoneRow> & { name: string }) {
    const payload = { name: zone.name.trim(), icon: zone.icon ?? null, sort_order: zone.sort_order ?? 0, is_active: zone.is_active ?? true };
    if (zone.id) await this.run(this.db.from('pos_zones').update(payload).eq('id', zone.id));
    else await this.run(this.db.from('pos_zones').insert({ ...payload, company_id: this.companyId() }));
  }

  deleteZone(id: string) {
    return this.run(this.db.from('pos_zones').delete().eq('id', id));
  }

  async saveTable(table: Partial<PosTableRow> & { name: string }) {
    const payload = {
      name: table.name.trim(), zone_id: table.zone_id ?? null, seats: table.seats ?? 4,
      sort_order: table.sort_order ?? 0, is_active: table.is_active ?? true
    };
    if (table.id) await this.run(this.db.from('pos_tables').update(payload).eq('id', table.id));
    else await this.run(this.db.from('pos_tables').insert({ ...payload, company_id: this.companyId() }));
  }

  /** Cria várias mesas de uma vez (ex.: S1 a S10). */
  async addTables(zoneId: string | null, prefix: string, from: number, to: number, seats: number) {
    const rows = [];
    for (let n = from; n <= to; n++) {
      rows.push({ company_id: this.companyId(), zone_id: zoneId, name: `${prefix}${n}`, seats, sort_order: n });
    }
    await this.run(this.db.from('pos_tables').insert(rows));
  }

  deleteTable(id: string) {
    return this.run(this.db.from('pos_tables').delete().eq('id', id));
  }

  // ---------- Categorias e produtos ----------

  listCategories() {
    return this.run<PosCategoryRow[]>(this.db.from('product_categories').select('id, name, color, icon, sort_order, is_active')
      .eq('company_id', this.companyId()).order('sort_order').order('name'));
  }

  async saveCategory(category: Partial<PosCategoryRow> & { name: string }) {
    const payload = {
      name: category.name.trim(), color: category.color ?? '#f16c39', icon: category.icon ?? null,
      sort_order: category.sort_order ?? 0, is_active: category.is_active ?? true
    };
    if (category.id) await this.run(this.db.from('product_categories').update(payload).eq('id', category.id));
    else await this.run(this.db.from('product_categories').insert({ ...payload, company_id: this.companyId() }));
  }

  deleteCategory(id: string) {
    return this.run(this.db.from('product_categories').delete().eq('id', id));
  }

  listProducts() {
    return this.run<PosProductRow[]>(this.db.from('products')
      .select('id, code, name, price, type, unit, stock, is_active, category_id, pos_visible, pos_station, sold_by_weight, pos_available, image_url')
      .eq('company_id', this.companyId())
      .order('name'));
  }

  updateProduct(id: string, patch: Partial<Pick<PosProductRow, 'category_id' | 'pos_visible' | 'pos_station' | 'sold_by_weight' | 'pos_available' | 'image_url'>>) {
    return this.run(this.db.from('products').update(patch).eq('id', id));
  }

  // ---------- Caixas e vendas ----------

  listSessions(from: string) {
    return this.run<PosSessionRow[]>(this.db.from('pos_sessions')
      .select('id, number, status, opened_at, closed_at, opening_float, expected_cash, counted_cash, difference, notes, summary, terminal:pos_terminals(name), opener:pos_staff!pos_sessions_opened_by_fkey(name), closer:pos_staff!pos_sessions_closed_by_fkey(name)')
      .eq('company_id', this.companyId())
      .gte('opened_at', from)
      .order('opened_at', { ascending: false })
      .limit(200));
  }

  /** Vendas do POS entre duas datas (AAAA-MM-DD), agregadas para os relatórios. */
  async salesReport(from: string, to: string): Promise<PosSalesReport> {
    const companyId = this.companyId();
    const [docs, payments] = await Promise.all([
      this.run<{ id: string; document_type: 'FR' | 'NC'; status: string; total: number; discount_total: number; date: string; created_at: string; staff: { name: string } | null; items: { product_name: string; quantity: number; total: number }[] }[]>(
        this.db.from('invoices')
          .select('id, document_type, status, total, discount_total, date, created_at, staff:pos_staff(name), items:invoice_items(product_name, quantity, total)')
          .eq('company_id', companyId).eq('origin', 'pos').gte('date', from).lte('date', to).limit(5000)),
      this.run<{ method: PosPaymentMethod; amount: number; simulated: boolean; invoice: { date: string } | null }[]>(
        this.db.from('pos_payments')
          .select('method, amount, simulated, invoice:invoices!inner(date)')
          .eq('company_id', companyId).gte('invoice.date', from).lte('invoice.date', to).limit(10000))
    ]);

    const active = docs.filter(d => d.status !== 'anulada');
    const fr = active.filter(d => d.document_type === 'FR');
    const nc = active.filter(d => d.document_type === 'NC');
    const sum = (list: { total: number }[]) => Math.round(list.reduce((s, d) => s + Number(d.total), 0) * 100) / 100;

    const methods = new Map<PosPaymentMethod, { total: number; count: number }>();
    let simulated = 0;
    for (const p of payments) {
      const m = methods.get(p.method) ?? { total: 0, count: 0 };
      m.total += Number(p.amount);
      if (Number(p.amount) > 0) m.count++;
      methods.set(p.method, m);
      if (p.simulated) simulated += Number(p.amount);
    }

    const staff = new Map<string, { total: number; count: number }>();
    const days = new Map<string, number>();
    const hours = Array.from({ length: 24 }, () => 0);
    const products = new Map<string, { quantity: number; total: number }>();
    for (const d of active) {
      const name = d.staff?.name ?? '—';
      const s = staff.get(name) ?? { total: 0, count: 0 };
      s.total += Number(d.total);
      if (d.document_type === 'FR') s.count++;
      staff.set(name, s);
      days.set(d.date, (days.get(d.date) ?? 0) + Number(d.total));
      if (d.document_type === 'FR') hours[new Date(d.created_at).getHours()] += Number(d.total);
      for (const it of d.items ?? []) {
        const p = products.get(it.product_name) ?? { quantity: 0, total: 0 };
        p.quantity += Number(it.quantity);
        p.total += Number(it.total);
        products.set(it.product_name, p);
      }
    }

    return {
      netSales: sum(active),
      frCount: fr.length,
      frTotal: sum(fr),
      ncCount: nc.length,
      ncTotal: sum(nc),
      voidedCount: docs.length - active.length,
      discounts: Math.round(fr.reduce((s, d) => s + Number(d.discount_total), 0) * 100) / 100,
      byMethod: [...methods.entries()].map(([method, v]) => ({ method, ...v })).sort((a, b) => b.total - a.total),
      byStaff: [...staff.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.total - a.total),
      byDay: [...days.entries()].map(([date, total]) => ({ date, total })).sort((a, b) => a.date.localeCompare(b.date)),
      byHour: hours,
      topProducts: [...products.entries()].map(([name, v]) => ({ name, ...v })).filter(p => p.quantity > 0)
        .sort((a, b) => b.total - a.total).slice(0, 10),
      simulated: Math.round(simulated * 100) / 100
    };
  }
}
