import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  POS_STAFF_COLORS,
  PosAdminService,
  PosCategoryRow,
  PosProductRow,
  PosSalesReport,
  PosSessionRow,
  PosStaffRow,
  PosTableRow,
  PosTerminalRow,
  PosZoneRow
} from '../../core/services/pos-admin.service';
import { POS_PAYMENT_METHODS, PosCompanySettings, PosMode, PosPaymentMethod, PosStaffRole, PosStation } from '../../core/services/pos.service';
import { CompanyService } from '../../core/services/company.service';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ConfirmDialogService } from '../../core/services/confirm-dialog.service';
import { PreferencesService } from '../../core/services/preferences.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog.component';
import { currentLocale, t } from '../../core/i18n/i18n';

type Tab = 'general' | 'terminals' | 'staff' | 'tables' | 'products' | 'sales';
type Range = 'today' | 'week' | 'month';
interface BulkTables { zone_id: string; prefix: string; from: number; to: number; seats: number; }

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Maputo' });
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString('sv-SE', { timeZone: 'Africa/Maputo' });
};

@Component({
  selector: 'app-pos-admin',
  standalone: true,
  // O layout da aplicação não tem o diálogo de confirmação: fica aqui. Avisos: snackbar, como nas outras páginas.
  imports: [CommonModule, MatButtonModule, MatIconModule, MatMenuModule, MatSnackBarModule, MatTooltipModule, TranslatePipe, ConfirmDialogComponent],
  templateUrl: './pos-admin.component.html',
  styles: [`
    .tab { display: inline-flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 12px; font-weight: 600; font-size: 14px; color: #475569; white-space: nowrap; }
    .tab.on { background: #fff4ee; color: #c2410c; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 18px; padding: 20px; }
    .field { width: 100%; padding: 10px 12px; border-radius: 12px; border: 1px solid #e2e8f0; font-size: 15px; outline: none; background: #fff; }
    .field:focus { border-color: #f16c39; }
    .label { display: block; font-size: 12px; font-weight: 700; color: #64748b; margin-bottom: 6px; }
    .seg { display: inline-grid; grid-auto-flow: column; gap: 4px; padding: 4px; border-radius: 12px; background: #f1f5f9; }
    .seg button { padding: 8px 14px; border-radius: 9px; font-size: 14px; font-weight: 600; color: #64748b; display: flex; align-items: center; gap: 8px; }
    .seg button.on { background: #fff; color: #0f172a; box-shadow: 0 1px 3px rgb(15 23 42 / .12); }
    .pill { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; }
    .code { font-family: ui-monospace, monospace; font-size: 34px; font-weight: 800; letter-spacing: .15em; color: #0f172a; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #94a3b8; padding: 8px; border-bottom: 1px solid #e2e8f0; }
    td { padding: 8px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
  `]
})
export class PosAdminComponent {
  /** Dentro de Configurações (separador): título mais pequeno, como os outros separadores. */
  embedded = input(false);

  admin = inject(PosAdminService);
  companyService = inject(CompanyService);
  private snackBar = inject(MatSnackBar);
  private confirm = inject(ConfirmDialogService);
  private preferences = inject(PreferencesService);

  readonly methods = POS_PAYMENT_METHODS;
  readonly colors = POS_STAFF_COLORS;
  readonly roles: PosStaffRole[] = ['cashier', 'waiter', 'manager'];
  readonly zoneIcons = ['fa-chair', 'fa-umbrella-beach', 'fa-martini-glass', 'fa-star', 'fa-tree', 'fa-door-open'];

  tab = signal<Tab>('general');
  loading = signal(false);
  saving = signal(false);

  // Geral
  businessType = signal<PosMode>('retail');
  settings = signal<PosCompanySettings>({});

  // Terminais
  terminals = signal<PosTerminalRow[]>([]);
  newTerminal = signal('');
  pairing = signal<{ terminalId: string; code: string; expires_at: string } | null>(null);

  // Funcionários
  staff = signal<PosStaffRow[]>([]);
  editingStaff = signal<(Partial<PosStaffRow> & { name: string; role: PosStaffRole }) | null>(null);
  pinFor = signal<PosStaffRow | null>(null);
  pinValue = signal('');

  // Mesas
  zones = signal<PosZoneRow[]>([]);
  tables = signal<PosTableRow[]>([]);
  newZone = signal('');
  bulk = signal<BulkTables>({ zone_id: '', prefix: 'M', from: 1, to: 10, seats: 4 });

  // Produtos
  categories = signal<PosCategoryRow[]>([]);
  products = signal<PosProductRow[]>([]);
  productSearch = signal('');
  newCategory = signal('');

  // Vendas
  range = signal<Range>('today');
  report = signal<PosSalesReport | null>(null);
  sessions = signal<PosSessionRow[]>([]);

  isRestaurant = computed(() => this.businessType() === 'restaurant');
  posUrl = computed(() => `${window.location.origin}/pos`);
  filteredProducts = computed(() => {
    const term = this.productSearch().trim().toLowerCase();
    return this.products().filter(p => !term || p.name.toLowerCase().includes(term) || p.code.toLowerCase().includes(term));
  });
  hourMax = computed(() => Math.max(1, ...(this.report()?.byHour ?? [0])));
  dayMax = computed(() => Math.max(1, ...(this.report()?.byDay ?? []).map(d => d.total)));

  constructor() {
    // Ao mudar de empresa, recarrega o separador aberto.
    effect(() => {
      const company = this.companyService.activeCompany();
      if (company) untracked(() => this.load());
    });
  }

  money(v: number | null | undefined) {
    return new Intl.NumberFormat(currentLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v ?? 0)) + ' MZN';
  }

  dateTime(iso: string | null | undefined) {
    if (!iso) return '—';
    const d = new Date(iso);
    return `${this.preferences.formatDate(d)} ${this.preferences.formatTime(d)}`;
  }

  setTab(tab: Tab) {
    this.tab.set(tab);
    this.load();
  }

  async load() {
    this.loading.set(true);
    try {
      const general = await this.admin.getSettings();
      this.businessType.set(general.business_type);
      this.settings.set(general.settings);
      switch (this.tab()) {
        case 'terminals': this.terminals.set(await this.admin.listTerminals()); break;
        case 'staff': this.staff.set(await this.admin.listStaff()); break;
        case 'tables':
          this.zones.set(await this.admin.listZones());
          this.tables.set(await this.admin.listTables());
          break;
        case 'products':
          this.categories.set(await this.admin.listCategories());
          this.products.set(await this.admin.listProducts());
          break;
        case 'sales': await this.loadSales(); break;
      }
    } catch (e) {
      this.error(e);
    } finally {
      this.loading.set(false);
    }
  }

  private notify(message: string, duration = 3000) {
    this.snackBar.open(message, t('common.actions.close'), { duration });
  }

  private error(e: unknown) {
    this.notify(e instanceof Error ? e.message : String(e), 6000);
  }

  openPos() {
    window.open('/pos', '_blank');
  }

  // ---------- Geral ----------

  patchSettings(patch: Partial<PosCompanySettings>) {
    this.settings.update(s => ({ ...s, ...patch }));
  }

  patchCash(patch: NonNullable<PosCompanySettings['cash']>) {
    this.settings.update(s => ({ ...s, cash: { ...(s.cash ?? {}), ...patch } }));
  }

  methodEnabled(method: PosPaymentMethod) {
    const list = this.settings().payment_methods;
    return !list?.length || list.includes(method);
  }

  toggleMethod(method: PosPaymentMethod) {
    if (method === 'cash') return;
    const current = this.settings().payment_methods?.length ? this.settings().payment_methods! : this.methods.map(m => m.id);
    const next = current.includes(method) ? current.filter(m => m !== method) : [...current, method];
    this.patchSettings({ payment_methods: next });
  }

  async saveGeneral() {
    this.saving.set(true);
    try {
      await this.admin.saveSettings(this.businessType(), this.settings());
      this.notify(t('posAdmin.general.saved'));
    } catch (e) {
      this.error(e);
    } finally {
      this.saving.set(false);
    }
  }

  // ---------- Terminais ----------

  async addTerminal() {
    const name = this.newTerminal().trim();
    if (!name) return;
    try {
      const id = await this.admin.createTerminal(name);
      this.newTerminal.set('');
      this.terminals.set(await this.admin.listTerminals());
      await this.pair(id);
    } catch (e) {
      this.error(e);
    }
  }

  async pair(terminalId: string) {
    try {
      const result = await this.admin.pairingCode(terminalId);
      this.pairing.set({ terminalId, ...result });
    } catch (e) {
      this.error(e);
    }
  }

  async renameTerminal(terminal: PosTerminalRow) {
    const name = prompt(t('posAdmin.terminals.renamePrompt'), terminal.name)?.trim();
    if (!name || name === terminal.name) return;
    try {
      await this.admin.renameTerminal(terminal.id, name);
      this.terminals.set(await this.admin.listTerminals());
    } catch (e) {
      this.error(e);
    }
  }

  async revoke(terminal: PosTerminalRow) {
    const ok = await this.confirm.confirm({
      title: t('posAdmin.terminals.revokeTitle', { name: terminal.name }),
      message: t('posAdmin.terminals.revokeMessage'),
      confirmLabel: t('posAdmin.terminals.revoke'),
      cancelLabel: t('common.actions.cancel'),
      danger: true
    });
    if (!ok) return;
    try {
      await this.admin.revokeTerminal(terminal.id);
      this.terminals.set(await this.admin.listTerminals());
      this.notify(t('posAdmin.terminals.revoked'));
    } catch (e) {
      this.error(e);
    }
  }

  terminalStatus(terminal: PosTerminalRow): 'revoked' | 'paired' | 'waiting' | 'new' {
    if (terminal.revoked_at) return 'revoked';
    if (terminal.paired_at) return 'paired';
    if (terminal.pairing_expires_at && new Date(terminal.pairing_expires_at) > new Date()) return 'waiting';
    return 'new';
  }

  // ---------- Funcionários ----------

  newStaff() {
    this.editingStaff.set({ name: '', role: 'cashier', color: this.colors[this.staff().length % this.colors.length], permissions: {}, is_active: true });
  }

  editStaff(staff: PosStaffRow) {
    this.editingStaff.set({ ...staff, permissions: { ...staff.permissions } });
  }

  patchStaff(patch: Partial<PosStaffRow>) {
    this.editingStaff.update(s => s ? { ...s, ...patch } : s);
  }

  patchPermissions(patch: Record<string, unknown>) {
    this.editingStaff.update(s => s ? { ...s, permissions: { ...(s.permissions ?? {}), ...patch } } : s);
  }

  async saveStaff() {
    const staff = this.editingStaff();
    if (!staff || staff.name.trim().length < 2) return;
    try {
      const id = await this.admin.saveStaff(staff);
      const isNew = !staff.id;
      this.editingStaff.set(null);
      this.staff.set(await this.admin.listStaff());
      this.notify(t('posAdmin.staff.saved'));
      if (isNew) {
        const row = this.staff().find(s => s.id === id);
        if (row) this.askPin(row);
      }
    } catch (e) {
      this.error(e);
    }
  }

  askPin(staff: PosStaffRow) {
    this.pinFor.set(staff);
    this.pinValue.set('');
  }

  async savePin() {
    const staff = this.pinFor();
    if (!staff || !/^\d{4}$/.test(this.pinValue())) return;
    try {
      await this.admin.setPin(staff.id, this.pinValue());
      this.pinFor.set(null);
      this.staff.set(await this.admin.listStaff());
      this.notify(t('posAdmin.staff.pinSaved', { name: staff.name }));
    } catch (e) {
      this.error(e);
    }
  }

  async unlock(staff: PosStaffRow) {
    try {
      await this.admin.unlockStaff(staff.id);
      this.staff.set(await this.admin.listStaff());
    } catch (e) {
      this.error(e);
    }
  }

  async toggleStaff(staff: PosStaffRow) {
    try {
      await this.admin.saveStaff({ ...staff, is_active: !staff.is_active });
      this.staff.set(await this.admin.listStaff());
    } catch (e) {
      this.error(e);
    }
  }

  isLocked(staff: PosStaffRow) {
    return !!staff.locked_until && new Date(staff.locked_until) > new Date();
  }

  // ---------- Mesas ----------

  async addZone() {
    const name = this.newZone().trim();
    if (!name) return;
    try {
      await this.admin.saveZone({ name, sort_order: this.zones().length, icon: this.zoneIcons[this.zones().length % this.zoneIcons.length] });
      this.newZone.set('');
      this.zones.set(await this.admin.listZones());
    } catch (e) {
      this.error(e);
    }
  }

  async setZoneIcon(zone: PosZoneRow, icon: string) {
    try {
      await this.admin.saveZone({ ...zone, icon });
      this.zones.set(await this.admin.listZones());
    } catch (e) {
      this.error(e);
    }
  }

  async removeZone(zone: PosZoneRow) {
    const ok = await this.confirm.confirm({
      title: t('posAdmin.tables.removeZoneTitle', { name: zone.name }),
      message: t('posAdmin.tables.removeZoneMessage'),
      confirmLabel: t('common.actions.delete'),
      cancelLabel: t('common.actions.cancel'),
      danger: true
    });
    if (!ok) return;
    try {
      await this.admin.deleteZone(zone.id);
      this.zones.set(await this.admin.listZones());
      this.tables.set(await this.admin.listTables());
    } catch (e) {
      this.error(e);
    }
  }

  patchBulk(patch: Partial<BulkTables>) {
    this.bulk.update(b => ({ ...b, ...patch }));
  }

  async addTables() {
    const b = this.bulk();
    if (!b.prefix.trim() || b.to < b.from || b.to - b.from > 99) return;
    try {
      await this.admin.addTables(b.zone_id || null, b.prefix.trim(), b.from, b.to, b.seats);
      this.tables.set(await this.admin.listTables());
      this.notify(t('posAdmin.tables.added', { count: b.to - b.from + 1 }));
    } catch (e) {
      this.error(e);
    }
  }

  async patchTable(table: PosTableRow, patch: Partial<PosTableRow>) {
    try {
      await this.admin.saveTable({ ...table, ...patch });
      this.tables.set(await this.admin.listTables());
    } catch (e) {
      this.error(e);
    }
  }

  async removeTable(table: PosTableRow) {
    try {
      await this.admin.deleteTable(table.id);
      this.tables.set(await this.admin.listTables());
    } catch (e) {
      // Mesas com pedidos ficam: desactivam-se.
      await this.patchTable(table, { is_active: false });
    }
  }

  tablesOf(zoneId: string | null) {
    return this.tables().filter(tb => tb.zone_id === zoneId);
  }

  // ---------- Produtos ----------

  async addCategory() {
    const name = this.newCategory().trim();
    if (!name) return;
    try {
      await this.admin.saveCategory({ name, color: this.colors[this.categories().length % this.colors.length], sort_order: this.categories().length });
      this.newCategory.set('');
      this.categories.set(await this.admin.listCategories());
    } catch (e) {
      this.error(e);
    }
  }

  async patchCategory(category: PosCategoryRow, patch: Partial<PosCategoryRow>) {
    try {
      await this.admin.saveCategory({ ...category, ...patch });
      this.categories.set(await this.admin.listCategories());
    } catch (e) {
      this.error(e);
    }
  }

  async removeCategory(category: PosCategoryRow) {
    try {
      await this.admin.deleteCategory(category.id);
      this.categories.set(await this.admin.listCategories());
      this.products.set(await this.admin.listProducts());
    } catch (e) {
      this.error(e);
    }
  }

  async patchProduct(product: PosProductRow, patch: Partial<PosProductRow>) {
    this.products.update(list => list.map(p => p.id === product.id ? { ...p, ...patch } : p));
    try {
      await this.admin.updateProduct(product.id, patch);
    } catch (e) {
      this.products.update(list => list.map(p => p.id === product.id ? product : p));
      this.error(e);
    }
  }

  stationValue(value: string): PosStation | null {
    return value === 'kitchen' || value === 'bar' ? value : null;
  }

  // ---------- Vendas ----------

  setRange(range: Range) {
    this.range.set(range);
    this.loadSales();
  }

  private async loadSales() {
    const from = this.range() === 'today' ? today() : this.range() === 'week' ? daysAgo(6) : daysAgo(29);
    const [report, sessions] = await Promise.all([
      this.admin.salesReport(from, today()),
      this.admin.listSessions(`${from}T00:00:00`)
    ]);
    this.report.set(report);
    this.sessions.set(sessions);
  }
}
