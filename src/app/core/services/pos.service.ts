import { Injectable, computed, inject, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { PosApiError, PosApiService, PosOperatorToken } from './pos-api.service';

/**
 * Ponto de Venda (POS): estado do terminal.
 *
 * Os dados vêm do servidor (funções pos_*). Aqui ficam só o carrinho do balcão
 * (até ser cobrado) e o estado do ecrã. Os pedidos de mesa vivem no servidor e
 * são partilhados em tempo real entre terminais. Preços, totais, descontos e
 * trocos são recalculados no servidor ao emitir; os valores daqui servem para
 * mostrar.
 *
 * Documento: sempre FR (factura-recibo), para o Consumidor final ou para o
 * cliente com NUIT. Empresas ISPC: sem IVA.
 */

export type PosMode = 'retail' | 'restaurant';
export type PosPaymentMethod = 'cash' | 'mpesa' | 'emola' | 'card' | 'transfer';
export type PosPaperWidth = 58 | 80;
export type PosStaffRole = 'cashier' | 'waiter' | 'manager';
export type PosStation = 'kitchen' | 'bar';
export type PosPhase = 'loading' | 'unpaired' | 'login' | 'ready' | 'error';

export const POS_PAYMENT_METHODS: { id: PosPaymentMethod; icon: string }[] = [
  { id: 'cash', icon: 'fa-money-bill-wave' },
  { id: 'mpesa', icon: 'fa-mobile-screen-button' },
  { id: 'emola', icon: 'fa-wallet' },
  { id: 'card', icon: 'fa-credit-card' },
  { id: 'transfer', icon: 'fa-building-columns' }
];

/** Notas e moedas do metical, para a contagem no fecho de caixa. */
export const MZN_DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5];

export interface PosCompanySettings {
  paper_width?: PosPaperWidth;
  receipt_header?: string;
  receipt_footer?: string;
  payment_methods?: PosPaymentMethod[];
  mobile_timeout?: number;
  cash?: { default_float?: number; tolerance?: number; blind_close?: boolean };
}

export interface PosCompany {
  id: string;
  name: string;
  nuit: string;
  address?: string;
  province?: string;
  phone?: string;
  email?: string;
  logo_url?: string;
  business_type: PosMode;
  settings: PosCompanySettings;
  mpesa_number?: string;
  emola_number?: string;
}

export interface PosAccess {
  enabled: boolean;
  active: boolean;
  in_grace: boolean;
  grace_until: string | null;
  end_date: string | null;
  allowed: boolean;
}

export interface PosStaffSummary {
  id: string;
  name: string;
  role: PosStaffRole;
  color: string;
  has_pin: boolean;
  locked: boolean;
}

export interface PosTerminalInfo {
  terminal: { id: string; name: string };
  company: { id: string; name: string; nuit: string; logo_url?: string; business_type: PosMode };
  access: PosAccess;
  staff: PosStaffSummary[];
  open_session: { id: string; number: number; opened_at: string; opened_by: string } | null;
}

export interface PosCategory {
  id: string;
  name: string;
  color: string;
  icon?: string | null;
}

export interface PosProduct {
  id: string;
  code: string;
  barcode?: string | null;
  name: string;
  price: number;
  type: 'produto' | 'servico';
  unit: string;
  /** null = sem controlo de stock. */
  stock: number | null;
  category_id: string | null;
  station: PosStation | null;
  image_url?: string | null;
  sold_by_weight: boolean;
  available: boolean;
}

export interface PosZone {
  id: string;
  name: string;
  icon?: string | null;
}

export interface PosTable {
  id: string;
  name: string;
  zone_id: string | null;
  seats: number;
}

export interface PosSessionInfo {
  id: string;
  number: number;
  opened_at: string;
  opening_float: number;
  opened_by: string;
}

export interface PosCartLine {
  product: PosProduct;
  quantity: number;
  notes?: string;
}

export interface PosOrderLine {
  id: string;
  product_id: string | null;
  name: string;
  unit_price: number;
  quantity: number;
  paid_quantity: number;
  station: PosStation | null;
  notes: string | null;
  status: 'pending' | 'sent' | 'voided';
  sent_at: string | null;
  void_reason: string | null;
}

export interface PosOrder {
  id: string;
  table_id: string | null;
  table_name: string | null;
  status: 'open' | 'closed' | 'cancelled';
  covers: number;
  opened_at: string;
  updated_at: string;
  waiter_id: string | null;
  waiter: string | null;
  waiter_color: string | null;
  lines: PosOrderLine[];
  total: number;
  due: number;
  unsent: number;
}

export interface PosDiscount {
  type: 'pct' | 'amount';
  value: number;
}

export interface PosTotals {
  gross: number;
  discount: number;
  total: number;
}

export interface PosDocumentItem {
  id: string;
  product_id: string | null;
  name: string;
  quantity: number;
  unit_price: number;
  discount: number;
  total: number;
  notes: string | null;
  returned: number;
}

export interface PosDocumentPayment {
  method: PosPaymentMethod;
  amount: number;
  tendered: number | null;
  change: number;
  reference: string | null;
  phone: string | null;
  simulated: boolean;
}

/** FR ou NC tal como o servidor a devolve. */
export interface PosDocument {
  id: string;
  number: string;
  document_type: 'FR' | 'NC';
  status: 'paga' | 'anulada';
  date: string;
  issued_at: string;
  subtotal: number;
  discount_total: number;
  total: number;
  client: { id: string; name: string; nuit: string | null; walk_in: boolean };
  staff: string | null;
  terminal: string | null;
  session_id: string | null;
  table_label: string | null;
  covers: number | null;
  notes: string | null;
  related: { id: string; number: string } | null;
  credit_reason: string | null;
  annulment_reason: string | null;
  annulled_at: string | null;
  print_count: number;
  items: PosDocumentItem[];
  payments: PosDocumentPayment[];
  credit_notes: { id: string; number: string; total: number }[];
}

export interface PosDocumentRow {
  id: string;
  number: string;
  document_type: 'FR' | 'NC';
  status: 'paga' | 'anulada';
  date: string;
  issued_at: string;
  total: number;
  discount_total: number;
  client: string;
  client_nuit: string | null;
  walk_in: boolean;
  staff: string | null;
  table_label: string | null;
  methods: PosPaymentMethod[] | null;
  related: string | null;
  has_credit_notes: boolean;
  session_id: string | null;
}

/** Resumo X/Z da caixa (pos_session_report / pos_close_session). */
export interface PosSessionReport {
  session: {
    id: string; number: number; status: 'open' | 'closed'; opened_at: string; closed_at: string | null;
    opened_by: string; closed_by: string | null; terminal: string; opening_float: number;
  };
  documents: Partial<Record<'FR' | 'NC', { count: number; total: number }>>;
  voided: { count: number; total: number };
  discounts: number;
  net_sales: number;
  payments: Partial<Record<PosPaymentMethod, { count: number; total: number }>>;
  simulated_payments: number;
  by_staff: { name: string | null; count: number; total: number }[];
  movements: { type: 'in' | 'out'; amount: number; reason: string; notes: string | null; created_at: string; staff: string }[];
  cash: { opening_float: number; sales: number; in: number; out: number; expected: number };
  authorizations: number;
  close?: { counted: number; expected: number; difference: number; denominations: Record<string, number> | null; notes: string | null; approved_by: string | null };
}

export interface PosPaymentRequest {
  id: string;
  method: 'mpesa' | 'emola';
  amount: number;
  phone: string;
  status: 'pending' | 'confirmed' | 'failed' | 'expired' | 'cancelled';
  reference: string;
  failure_reason: string | null;
  transaction_id?: string | null;
  expires_at: string;
  provider: 'simulator' | 'sislog';
}

export interface PosClientRef {
  id: string;
  name: string;
  nuit: string | null;
  phone?: string | null;
}

/** Pagamento escolhido no ecrã, antes de emitir. */
export type PosPaymentInput =
  | { method: 'cash'; tendered: number }
  | { method: 'mpesa' | 'emola'; request_id: string; amount: number }
  | { method: 'card' | 'transfer'; amount: number; reference?: string };

export interface PosKitchenTicket {
  station: PosStation;
  lines: { name: string; quantity: number; notes: string | null }[];
}

export interface PosVoidTicket {
  station: PosStation | null;
  table_name: string | null;
  waiter: string;
  product: string;
  quantity: number;
  reason: string;
  authorized_by: string | null;
  at: string;
}

interface Bootstrap {
  company: PosCompany;
  access: PosAccess;
  terminal: { id: string; name: string };
  staff: { id: string; name: string; role: PosStaffRole; permissions: Record<string, unknown> };
  walk_in_client_id: string;
  categories: PosCategory[];
  products: PosProduct[];
  zones: PosZone[];
  tables: PosTable[];
  session: PosSessionInfo | null;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export function computeTotals(lines: { unit_price: number; quantity: number }[], discount?: PosDiscount | null): PosTotals {
  const gross = round2(lines.reduce((sum, l) => sum + round2(l.unit_price * l.quantity), 0));
  let off = 0;
  if (discount && gross > 0 && discount.value > 0) {
    off = discount.type === 'pct'
      ? round2(gross * Math.min(100, discount.value) / 100)
      : Math.min(gross, round2(discount.value));
  }
  return { gross, discount: off, total: round2(gross - off) };
}

/** NUIT moçambicano: 9 dígitos. */
export function isValidNuit(value: string | undefined | null): boolean {
  return /^\d{9}$/.test((value ?? '').replace(/\s/g, ''));
}

export function newClientUuid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });
}

@Injectable({ providedIn: 'root' })
export class PosService {
  private api = inject(PosApiService);

  readonly phase = signal<PosPhase>('loading');
  readonly error = signal<string | null>(null);
  readonly info = signal<PosTerminalInfo | null>(null);

  readonly company = signal<PosCompany | null>(null);
  readonly access = signal<PosAccess | null>(null);
  readonly terminal = signal<{ id: string; name: string } | null>(null);
  readonly categories = signal<PosCategory[]>([]);
  readonly products = signal<PosProduct[]>([]);
  readonly zones = signal<PosZone[]>([]);
  readonly tables = signal<PosTable[]>([]);
  readonly session = signal<PosSessionInfo | null>(null);
  readonly walkInClientId = signal<string>('');

  /** Pedidos de mesa abertos (restaurante), partilhados entre terminais. */
  readonly orders = signal<PosOrder[]>([]);
  /** Mesa aberta no ecrã de venda; null = balcão. */
  readonly activeOrderId = signal<string | null>(null);

  /** Conta dividida: quantidade a cobrar por linha da mesa (null = tudo). */
  readonly billSplit = signal<Record<string, number> | null>(null);

  /** Carrinho do balcão (venda directa). */
  readonly cart = signal<PosCartLine[]>([]);
  readonly discount = signal<PosDiscount | null>(null);

  readonly operator = this.api.operator;
  readonly isManager = computed(() => this.operator()?.staff.role === 'manager');
  /**
   * Quem cobra precisa de caixa aberta. O empregado de mesa (sem permissão de
   * cobrar) trabalha só com pedidos: mesas, artigos e envio para a cozinha/bar.
   */
  readonly canSell = computed(() => {
    const staff = this.operator()?.staff;
    if (!staff) return false;
    if (staff.role !== 'waiter') return true;
    return staff.permissions?.['sell'] === true || staff.permissions?.['can_charge'] === true;
  });
  readonly mode = computed<PosMode>(() => this.company()?.business_type ?? 'retail');
  readonly paperWidth = computed<PosPaperWidth>(() => this.company()?.settings?.paper_width === 58 ? 58 : 80);
  readonly paymentMethods = computed(() => {
    const enabled = this.company()?.settings?.payment_methods;
    return POS_PAYMENT_METHODS.filter(m => !enabled?.length || enabled.includes(m.id) || m.id === 'cash');
  });

  readonly activeOrder = computed(() => this.orders().find(o => o.id === this.activeOrderId()) ?? null);
  readonly activeTable = computed(() => {
    const order = this.activeOrder();
    return order ? this.tables().find(t => t.id === order.table_id) ?? null : null;
  });
  /** Linhas por pagar da mesa (as anuladas não contam). */
  readonly orderLines = computed(() => (this.activeOrder()?.lines ?? []).filter(l => l.status !== 'voided' && l.quantity > l.paid_quantity));

  /** O que está no ecrã de venda: a mesa aberta ou o carrinho do balcão. */
  readonly saleLines = computed(() => {
    if (this.activeOrder()) {
      const split = this.billSplit();
      return this.orderLines()
        .map(l => ({
          key: l.id, product_id: l.product_id, name: l.name, unit_price: l.unit_price,
          quantity: split ? round2(split[l.id] ?? 0) : round2(l.quantity - l.paid_quantity), status: l.status, notes: l.notes
        }))
        .filter(l => l.quantity > 0);
    }
    return this.cart().map(l => ({
      key: l.product.id, product_id: l.product.id, name: l.product.name, unit_price: l.product.price,
      quantity: l.quantity, status: 'pending' as const, notes: l.notes ?? null
    }));
  });
  readonly saleCount = computed(() => this.saleLines().reduce((sum, l) => sum + l.quantity, 0));
  readonly totals = computed(() => computeTotals(this.saleLines(), this.discount()));
  readonly unsentCount = computed(() => (this.activeOrder()?.lines ?? []).filter(l => l.status === 'pending').length);

  private realtime: RealtimeChannel | null = null;
  private reloadTimer?: ReturnType<typeof setTimeout>;

  // ---------- Arranque, emparelhamento e operadores ----------

  async init() {
    this.phase.set('loading');
    this.error.set(null);
    try {
      if (!(await this.api.isPaired())) {
        this.phase.set('unpaired');
        return;
      }
      await this.loadInfo();
      if (this.api.token) {
        await this.bootstrap();
        this.phase.set('ready');
      } else {
        this.phase.set('login');
      }
    } catch (e) {
      this.handleFatal(e);
    }
  }

  async pair(code: string) {
    await this.api.pair(code);
    await this.init();
  }

  async unpair() {
    this.stopRealtime();
    await this.api.unpair();
    this.reset();
    this.phase.set('unpaired');
  }

  async loadInfo() {
    const info = await this.api.rpc<PosTerminalInfo>('pos_terminal_info');
    this.info.set(info);
    this.terminal.set(info.terminal);
    this.access.set(info.access);
  }

  /** PIN do operador. Devolve a mensagem de erro, ou null se entrou. */
  async login(staffId: string, pin: string): Promise<string | null> {
    const result = await this.api.rpc<{ ok: boolean; error?: string } & Partial<PosOperatorToken>>(
      'pos_operator_login', { p_staff_id: staffId, p_pin: pin });
    if (!result.ok) return result.error ?? 'PIN errado.';
    this.api.setOperator({ token: result.token!, expires_at: result.expires_at!, staff: result.staff! });
    await this.bootstrap();
    this.phase.set('ready');
    return null;
  }

  /** Bloqueia o terminal: termina a sessão do operador (o carrinho do balcão fica). */
  async lock() {
    try { await this.api.op('pos_operator_logout'); } catch { /* sessão já terminada */ }
    this.api.setOperator(null);
    this.phase.set('login');
    await this.loadInfo().catch(() => undefined);
  }

  async bootstrap() {
    const boot = await this.api.op<Bootstrap>('pos_bootstrap');
    this.company.set(boot.company);
    this.access.set(boot.access);
    this.terminal.set(boot.terminal);
    this.categories.set(boot.categories);
    this.products.set(boot.products.map(p => ({ ...p, price: Number(p.price), stock: p.stock === null ? null : Number(p.stock) })));
    this.zones.set(boot.zones);
    this.tables.set(boot.tables);
    this.session.set(boot.session ? { ...boot.session, opening_float: Number(boot.session.opening_float) } : null);
    this.walkInClientId.set(boot.walk_in_client_id);
    if (boot.company.business_type === 'restaurant') {
      await this.loadOrders();
      this.startRealtime(boot.company.id);
    } else {
      this.stopRealtime();
      this.orders.set([]);
    }
  }

  /** Erro de uma operação: se o terminal foi revogado ou o operador saiu, volta ao ecrã certo. */
  handleError(e: unknown): string {
    if (e instanceof PosApiError) {
      if (e.code === 'POS_TERMINAL_REVOKED') {
        this.unpair();
      } else if (e.code === 'POS_OPERATOR_EXPIRED') {
        this.phase.set('login');
        this.loadInfo().catch(() => undefined);
      } else if (e.code === 'POS_NO_SESSION') {
        this.session.set(null);
      }
      return e.message;
    }
    return e instanceof Error ? e.message : String(e);
  }

  private handleFatal(e: unknown) {
    const message = this.handleError(e);
    if (this.phase() === 'loading') {
      this.error.set(message);
      this.phase.set('error');
    }
  }

  private reset() {
    this.info.set(null);
    this.company.set(null);
    this.access.set(null);
    this.terminal.set(null);
    this.categories.set([]);
    this.products.set([]);
    this.zones.set([]);
    this.tables.set([]);
    this.session.set(null);
    this.orders.set([]);
    this.activeOrderId.set(null);
    this.cart.set([]);
    this.discount.set(null);
  }

  // ---------- Consultas ----------

  category(id: string | null | undefined): PosCategory | undefined {
    return this.categories().find(c => c.id === id);
  }

  product(id: string | null | undefined): PosProduct | undefined {
    return this.products().find(p => p.id === id);
  }

  table(id: string | null | undefined): PosTable | undefined {
    return this.tables().find(t => t.id === id);
  }

  orderForTable(tableId: string): PosOrder | undefined {
    return this.orders().find(o => o.table_id === tableId);
  }

  // ---------- Caixa ----------

  async openSession(openingFloat: number) {
    const s = await this.api.op<PosSessionInfo>('pos_open_session', { p_opening_float: openingFloat });
    this.session.set({ ...s, opening_float: Number(s.opening_float) });
  }

  cashMovement(type: 'in' | 'out', amount: number, reason: string, notes: string | null, authPin?: string) {
    return this.api.op<PosSessionReport>('pos_cash_movement', {
      p_type: type, p_amount: amount, p_reason: reason, p_notes: notes, p_auth_pin: authPin ?? null
    });
  }

  sessionReport() {
    return this.api.op<PosSessionReport>('pos_session_report');
  }

  async closeSession(counted: number, denominations: Record<string, number> | null, notes: string, authPin?: string) {
    const report = await this.api.op<PosSessionReport>('pos_close_session', {
      p_counted_cash: counted, p_denominations: denominations, p_notes: notes || null, p_auth_pin: authPin ?? null
    });
    this.session.set(null);
    this.cart.set([]);
    this.discount.set(null);
    this.activeOrderId.set(null);
    // O fecho termina a sessão de todos os operadores do terminal.
    this.api.setOperator(null);
    return report;
  }

  // ---------- Carrinho do balcão ----------

  /** Quantidade que ainda se pode vender (avisa, não bloqueia: o stock pode ficar negativo). */
  inCart(productId: string): number {
    return this.cart().find(l => l.product.id === productId)?.quantity ?? 0;
  }

  addToCart(product: PosProduct, quantity = 1) {
    this.cart.update(lines => {
      const existing = lines.find(l => l.product.id === product.id && !l.notes);
      if (existing) return lines.map(l => l === existing ? { ...l, quantity: round2(l.quantity + quantity) } : l);
      return [...lines, { product, quantity }];
    });
  }

  setCartQuantity(productId: string, quantity: number) {
    this.cart.update(lines => lines
      .map(l => l.product.id === productId ? { ...l, quantity: Math.max(0, l.product.sold_by_weight ? round2(quantity) : Math.floor(quantity)) } : l)
      .filter(l => l.quantity > 0));
    if (this.cart().length === 0) this.discount.set(null);
  }

  clearCart() {
    this.cart.set([]);
    this.discount.set(null);
  }

  // ---------- Clientes ----------

  searchClients(query: string) {
    return this.api.op<PosClientRef[]>('pos_search_clients', { p_query: query });
  }

  createClient(name: string, nuit: string, phone?: string) {
    return this.api.op<PosClientRef & { existing: boolean }>('pos_create_client', { p_name: name, p_nuit: nuit, p_phone: phone ?? null });
  }

  // ---------- Pagamentos móveis ----------

  requestMobilePayment(method: 'mpesa' | 'emola', amount: number, phone: string) {
    return this.api.op<PosPaymentRequest>('pos_request_mobile_payment', { p_method: method, p_amount: amount, p_phone: phone });
  }

  checkMobilePayment(requestId: string, simulate?: 'confirm' | 'fail' | 'cancel') {
    return this.api.op<PosPaymentRequest>('pos_check_mobile_payment', { p_request_id: requestId, p_simulate: simulate ?? null });
  }

  // ---------- Emitir ----------

  /** Cobra o balcão ou a mesa aberta (toda, ou só as linhas indicadas: conta dividida). */
  async checkout(input: {
    client_uuid: string;
    client_id: string | null;
    payments: PosPaymentInput[];
    order_lines?: { line_id: string; quantity: number }[];
  }, authPin?: string): Promise<{ document: PosDocument; orderClosed: boolean }> {
    const payments = input.payments.map(p => p.method === 'cash'
      ? { method: 'cash', tendered: p.tendered }
      : p.method === 'mpesa' || p.method === 'emola'
        ? { method: p.method, request_id: p.request_id }
        : { method: p.method, amount: p.amount, reference: 'reference' in p ? p.reference ?? null : null });
    const order = this.activeOrder();
    const base = { client_uuid: input.client_uuid, client_id: input.client_id, discount: this.discount(), payments };

    if (order) {
      const split = this.billSplit();
      const orderLines = input.order_lines ?? (split
        ? Object.entries(split).filter(([, q]) => q > 0).map(([line_id, quantity]) => ({ line_id, quantity }))
        : undefined);
      const result = await this.api.op<{ document: PosDocument; order: PosOrder; order_closed: boolean }>('pos_checkout_order', {
        p_order_id: order.id,
        p_payload: { ...base, order_lines: orderLines?.length ? orderLines : undefined },
        p_auth_pin: authPin ?? null
      });
      this.upsertOrder(result.order);
      this.discount.set(null);
      this.billSplit.set(null);
      if (result.order_closed) this.activeOrderId.set(null);
      return { document: result.document, orderClosed: result.order_closed };
    }

    const document = await this.api.op<PosDocument>('pos_issue_fr', {
      p_payload: {
        ...base,
        lines: this.cart().map(l => ({ product_id: l.product.id, quantity: l.quantity, notes: l.notes ?? null }))
      },
      p_auth_pin: authPin ?? null
    });
    this.clearCart();
    this.applyStock(document, -1);
    return { document, orderClosed: false };
  }

  /** Mantém o stock mostrado coerente sem recarregar o catálogo. */
  private applyStock(document: PosDocument, sign: 1 | -1) {
    const byProduct = new Map<string, number>();
    for (const item of document.items) {
      if (item.product_id) byProduct.set(item.product_id, (byProduct.get(item.product_id) ?? 0) + Number(item.quantity));
    }
    this.products.update(list => list.map(p => p.stock === null || !byProduct.has(p.id)
      ? p
      : { ...p, stock: round2(p.stock + sign * byProduct.get(p.id)!) }));
  }

  // ---------- Documentos ----------

  listDocuments(scope: 'session' | 'today' | 'week', search?: string) {
    return this.api.op<PosDocumentRow[]>('pos_list_documents', { p_scope: scope, p_search: search || null });
  }

  getDocument(id: string, reprint = false) {
    return this.api.op<PosDocument>('pos_get_document', { p_invoice_id: id, p_reprint: reprint });
  }

  async voidDocument(id: string, reason: string, authPin?: string) {
    const doc = await this.api.op<PosDocument>('pos_void_fr', { p_invoice_id: id, p_reason: reason, p_auth_pin: authPin ?? null });
    this.applyStock(doc, 1);
    return doc;
  }

  async creditNote(id: string, lines: { item_id: string; quantity: number }[], reason: string, method: PosPaymentMethod | null, authPin?: string) {
    const doc = await this.api.op<PosDocument>('pos_issue_nc', {
      p_invoice_id: id, p_lines: lines, p_reason: reason, p_refund_method: method, p_auth_pin: authPin ?? null
    });
    this.applyStock(doc, -1);
    return doc;
  }

  // ---------- Restaurante ----------

  async loadOrders() {
    this.orders.set((await this.api.op<PosOrder[]>('pos_list_orders')).map(o => this.normalizeOrder(o)));
    if (this.activeOrderId() && !this.activeOrder()) this.activeOrderId.set(null);
  }

  async openTable(tableId: string, covers = 2): Promise<PosOrder> {
    const existing = this.orderForTable(tableId);
    if (existing) {
      this.activeOrderId.set(existing.id);
      this.discount.set(null);
      this.billSplit.set(null);
      return existing;
    }
    const order = await this.api.op<PosOrder>('pos_open_order', { p_table_id: tableId, p_covers: covers });
    this.upsertOrder(order);
    this.activeOrderId.set(order.id);
    this.discount.set(null);
    return order;
  }

  selectCounter() {
    this.activeOrderId.set(null);
    this.discount.set(null);
    this.billSplit.set(null);
  }

  async addToOrder(product: PosProduct, quantity = 1, notes?: string) {
    const order = this.activeOrder();
    if (!order) return;
    this.upsertOrder(await this.api.op<PosOrder>('pos_order_add_line', {
      p_order_id: order.id, p_product_id: product.id, p_quantity: quantity, p_notes: notes ?? null
    }));
  }

  /** Muda a quantidade de uma linha da mesa; numa linha enviada pede motivo e gerente. */
  async updateOrderLine(lineId: string, quantity: number, reason?: string, authPin?: string, notes?: string): Promise<PosVoidTicket | null> {
    const result = await this.api.op<{ order: PosOrder; void_ticket: PosVoidTicket | null }>('pos_order_update_line', {
      p_line_id: lineId, p_quantity: quantity, p_notes: notes ?? null, p_reason: reason ?? null, p_auth_pin: authPin ?? null
    });
    this.upsertOrder(result.order);
    return result.void_ticket;
  }

  async sendOrder(): Promise<{ tickets: PosKitchenTicket[]; table_name: string | null; covers: number; waiter: string; at: string } | null> {
    const order = this.activeOrder();
    if (!order) return null;
    const result = await this.api.op<{ order: PosOrder; tickets: PosKitchenTicket[]; table_name: string | null; covers: number; waiter: string; at: string }>(
      'pos_order_send', { p_order_id: order.id });
    this.upsertOrder(result.order);
    return result;
  }

  async moveOrder(tableId: string) {
    const order = this.activeOrder();
    if (!order) return;
    this.upsertOrder(await this.api.op<PosOrder>('pos_order_move', { p_order_id: order.id, p_table_id: tableId }));
  }

  async setCovers(covers: number) {
    const order = this.activeOrder();
    if (!order) return;
    this.upsertOrder(await this.api.op<PosOrder>('pos_order_set_covers', { p_order_id: order.id, p_covers: covers }));
  }

  async cancelOrder(reason?: string, authPin?: string) {
    const order = this.activeOrder();
    if (!order) return;
    await this.api.op('pos_order_cancel', { p_order_id: order.id, p_reason: reason ?? null, p_auth_pin: authPin ?? null });
    this.orders.update(list => list.filter(o => o.id !== order.id));
    this.activeOrderId.set(null);
  }

  /** O balcão passa a mesa: abre a mesa e manda as linhas do carrinho para lá. */
  async moveCartToTable(tableId: string) {
    const lines = this.cart();
    const order = await this.openTable(tableId);
    for (const line of lines) {
      this.upsertOrder(await this.api.op<PosOrder>('pos_order_add_line', {
        p_order_id: order.id, p_product_id: line.product.id, p_quantity: line.quantity, p_notes: line.notes ?? null
      }));
    }
    this.cart.set([]);
  }

  private upsertOrder(order: PosOrder) {
    const normalized = this.normalizeOrder(order);
    this.orders.update(list => {
      const others = list.filter(o => o.id !== normalized.id);
      return normalized.status === 'open' ? [...others, normalized] : others;
    });
  }

  private normalizeOrder(order: PosOrder): PosOrder {
    return {
      ...order,
      total: Number(order.total),
      due: Number(order.due),
      lines: order.lines.map(l => ({ ...l, unit_price: Number(l.unit_price), quantity: Number(l.quantity), paid_quantity: Number(l.paid_quantity) }))
    };
  }

  private startRealtime(companyId: string) {
    if (this.realtime) return;
    this.realtime = this.api.watchOrders(companyId, () => {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = setTimeout(() => this.loadOrders().catch(() => undefined), 400);
    });
  }

  private stopRealtime() {
    if (this.realtime) {
      this.api.client.removeChannel(this.realtime);
      this.realtime = null;
    }
  }
}
