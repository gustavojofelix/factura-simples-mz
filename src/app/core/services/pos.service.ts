import { Injectable, computed, signal } from '@angular/core';
import mock from '../data/pos-mock.json';

/**
 * Ponto de Venda (POS).
 *
 * Fase de demonstração: os dados vêm de core/data/pos-mock.json e tudo o que
 * se regista (vendas, sessões de caixa, mesas abertas) fica só neste dispositivo
 * (localStorage), separado por empresa de demonstração (loja / restaurante).
 * Toda a leitura/escrita passa por load()/persist(), que serão substituídos
 * por chamadas ao Supabase sem mudar a interface pública.
 */

export type PosMode = 'retail' | 'restaurant';
export type PosPaymentMethod = 'cash' | 'mpesa' | 'emola' | 'card' | 'transfer';
/** VD = venda a dinheiro (talão); FR = factura-recibo (com NUIT); NC = nota de crédito (devolução). */
export type PosDocumentType = 'VD' | 'FR' | 'NC';
export type PosPaperWidth = 58 | 80;
export type PosSellerRole = 'cashier' | 'waiter' | 'manager';
export type PosStation = 'kitchen' | 'bar';

export const POS_PAYMENT_METHODS: { id: PosPaymentMethod; icon: string }[] = [
  { id: 'cash', icon: 'fa-money-bill-wave' },
  { id: 'mpesa', icon: 'fa-mobile-screen-button' },
  { id: 'emola', icon: 'fa-wallet' },
  { id: 'card', icon: 'fa-credit-card' },
  { id: 'transfer', icon: 'fa-building-columns' }
];

/** Notas e moedas do metical, para a contagem no fecho de caixa. */
export const MZN_DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5];

export const POS_WALK_IN_CLIENT_ID = 'c00';
/** Carrinho da venda directa ao balcão (as mesas usam o id da mesa). */
export const POS_COUNTER_CART = 'counter';

export interface PosStore {
  name: string;
  nuit: string;
  address: string;
  phone: string;
}

export interface PosSettings {
  mode: PosMode;
  paper_width: PosPaperWidth;
  default_document: 'VD' | 'FR';
  terminal_name: string;
}

export interface PosCategory {
  id: string;
  name: string;
  icon: string;
  color: string;
}

export interface PosProduct {
  id: string;
  code: string;
  barcode?: string;
  name: string;
  category_id: string;
  /** Preço de venda ao público, com IVA incluído. */
  price: number;
  tax_rate: number;
  unit: string;
  /** null = sem controlo de stock (serviços, pratos). */
  stock: number | null;
  /** Restaurante: onde o pedido é preparado. */
  station?: PosStation;
}

export interface PosSeller {
  id: string;
  name: string;
  code: string;
  color: string;
  pin: string;
  role: PosSellerRole;
}

export interface PosClient {
  id: string;
  name: string;
  nuit?: string;
  phone?: string;
}

export interface PosZone {
  id: string;
  name: string;
  icon: string;
}

export interface PosTable {
  id: string;
  name: string;
  zone_id: string;
  seats: number;
}

export interface PosCartLine {
  product: PosProduct;
  quantity: number;
  /** Restaurante: quantidade já enviada para a cozinha/bar. */
  sent?: number;
}

export interface PosTableOrder {
  table_id: string;
  opened_at: string;
  waiter_id: string;
  covers: number;
}

/** Desconto na venda (sempre autorizado por um gestor). */
export interface PosDiscount {
  type: 'pct' | 'amount';
  value: number;
  authorized_by: string;
}

export interface PosPayment {
  method: PosPaymentMethod;
  amount: number;
}

export interface PosSaleItem {
  product_id: string;
  name: string;
  unit_price: number;
  tax_rate: number;
  quantity: number;
  total: number;
}

export interface PosTotals {
  /** Soma dos artigos antes do desconto. */
  gross: number;
  discount: number;
  subtotal: number;
  tax_total: number;
  total: number;
}

export interface PosSale extends PosTotals {
  id: string;
  number: string;
  document_type: PosDocumentType;
  created_at: string;
  seller_id: string;
  client_id: string;
  client_name: string;
  client_nuit?: string;
  session_id?: string;
  table_id?: string;
  covers?: number;
  /** 'mixed' quando o pagamento foi dividido. */
  payment_method: PosPaymentMethod | 'mixed';
  /** Valores líquidos por forma (o numerário já sem o troco). NC: negativos. */
  payments: PosPayment[];
  items: PosSaleItem[];
  amount_received: number;
  change: number;
  status: 'completed' | 'cancelled';
  cancelled_by?: string;
  discount_by?: string;
  /** NC: venda de origem e motivo. */
  refund_of?: string;
  refund_reason?: string;
  /** Venda de origem: quantidades já devolvidas por artigo. */
  returned?: Record<string, number>;
}

export interface PosCashMovement {
  id: string;
  type: 'in' | 'out';
  amount: number;
  reason: string;
  created_at: string;
  seller_id: string;
}

export interface PosSession {
  id: string;
  number: number;
  terminal_name: string;
  opened_at: string;
  opened_by: string;
  opening_float: number;
  movements: PosCashMovement[];
  status: 'open' | 'closed';
  closed_at?: string;
  closed_by?: string;
  expected_cash?: number;
  counted_cash?: number;
  notes?: string;
}

export interface PosSessionSummary {
  count: number;
  total: number;
  tax_total: number;
  byMethod: { id: PosPaymentMethod; amount: number; count: number }[];
  byDocument: Record<PosDocumentType, number>;
  bySeller: { seller_id: string; amount: number; count: number }[];
  cancelled: { count: number; total: number };
  refunds: { count: number; total: number };
  discounts: number;
  cashSales: number;
  ins: number;
  outs: number;
  expectedCash: number;
}

export interface PosCheckout {
  seller_id: string;
  client_id: string;
  client_name?: string;
  client_nuit?: string;
  payments: PosPayment[];
  document_type: 'VD' | 'FR';
}

const STATE_KEY = 'pos.demo.v3';
const SETTINGS_KEY = 'pos.settings';

const DEFAULT_SETTINGS: PosSettings = {
  mode: 'retail',
  paper_width: 80,
  default_document: 'VD',
  terminal_name: 'Caixa 1'
};

interface StoredState {
  sales: PosSale[];
  stock: Record<string, number | null>;
  sessions: PosSession[];
  carts: Record<string, PosCartLine[]>;
  tableOrders: Record<string, PosTableOrder>;
  discounts: Record<string, PosDiscount>;
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const uid = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const sum = (values: number[]) => round2(values.reduce((a, b) => a + b, 0));

/** IVA contido num valor com IVA incluído. */
function taxIncluded(total: number, rate: number): number {
  return rate > 0 ? round2(total - total / (1 + rate / 100)) : 0;
}

/** Totais com IVA incluído; o desconto reparte-se proporcionalmente pelo IVA. */
export function computeTotals(items: PosSaleItem[], discount?: PosDiscount | null): PosTotals {
  const gross = sum(items.map(i => i.total));
  const grossTax = sum(items.map(i => taxIncluded(i.total, i.tax_rate)));
  let off = 0;
  if (discount && gross > 0) {
    off = discount.type === 'pct'
      ? round2(gross * Math.min(100, Math.max(0, discount.value)) / 100)
      : Math.min(gross, round2(Math.max(0, discount.value)));
  }
  const total = round2(gross - off);
  const tax_total = gross ? round2(grossTax * total / gross) : 0;
  return { gross, discount: off, total, tax_total, subtotal: round2(total - tax_total) };
}

export function toSaleItem(line: PosCartLine): PosSaleItem {
  return {
    product_id: line.product.id,
    name: line.product.name,
    unit_price: line.product.price,
    tax_rate: line.product.tax_rate,
    quantity: line.quantity,
    total: round2(line.product.price * line.quantity)
  };
}

/** NUIT moçambicano: 9 dígitos. */
export function isValidNuit(value: string | undefined | null): boolean {
  return /^\d{9}$/.test((value ?? '').trim());
}

@Injectable({ providedIn: 'root' })
export class PosService {
  readonly sellers = signal<PosSeller[]>(mock.sellers as PosSeller[]);
  readonly clients = signal<PosClient[]>(mock.clients);
  readonly zones = signal<PosZone[]>(mock.restaurant.zones);
  readonly tables = signal<PosTable[]>(mock.restaurant.tables);

  readonly settings = signal<PosSettings>(this.readSettings());
  /** Cada modo é uma empresa de demonstração diferente (Loja / Restaurante). */
  readonly store = computed<PosStore>(() => mock.stores[this.settings().mode]);

  /** Todos os artigos (retalho + restaurante), com o stock actual. */
  private readonly allProducts = signal<PosProduct[]>([]);
  readonly sales = signal<PosSale[]>([]);
  readonly sessions = signal<PosSession[]>([]);
  readonly carts = signal<Record<string, PosCartLine[]>>({});
  readonly tableOrders = signal<Record<string, PosTableOrder>>({});
  readonly discounts = signal<Record<string, PosDiscount>>({});

  /** Operador com sessão iniciada neste terminal (PIN). */
  readonly activeSellerId = signal<string>(mock.sellers[0].id);
  readonly locked = signal(false);
  readonly activeCartKey = signal<string>(POS_COUNTER_CART);

  readonly categories = computed<PosCategory[]>(() =>
    this.settings().mode === 'restaurant' ? mock.restaurant.categories : mock.categories);
  readonly products = computed(() => {
    const ids = new Set(this.categories().map(c => c.id));
    return this.allProducts().filter(p => ids.has(p.category_id));
  });

  readonly currentSession = computed(() => this.sessions().find(s => s.status === 'open') ?? null);
  readonly activeSeller = computed(() => this.seller(this.activeSellerId()));
  readonly isManager = computed(() => this.activeSeller()?.role === 'manager');

  readonly cart = computed(() => this.carts()[this.activeCartKey()] ?? []);
  readonly cartDiscount = computed<PosDiscount | null>(() => this.discounts()[this.activeCartKey()] ?? null);
  readonly cartCount = computed(() => this.cart().reduce((total, line) => total + line.quantity, 0));
  readonly cartTotals = computed(() => computeTotals(this.cart().map(toSaleItem), this.cartDiscount()));
  readonly activeTable = computed(() => this.tables().find(t => t.id === this.activeCartKey()) ?? null);
  readonly activeOrder = computed<PosTableOrder | null>(() => this.tableOrders()[this.activeCartKey()] ?? null);
  /** Linhas ainda não enviadas para a cozinha/bar. */
  readonly unsentCount = computed(() => this.cart().reduce((total, l) => total + Math.max(0, l.quantity - (l.sent ?? 0)), 0));

  constructor() {
    this.load();
  }

  // ---------- Consultas ----------

  seller(id: string | undefined): PosSeller | undefined {
    return this.sellers().find(s => s.id === id);
  }

  client(id: string): PosClient | undefined {
    return this.clients().find(c => c.id === id);
  }

  category(id: string): PosCategory | undefined {
    return [...mock.categories, ...mock.restaurant.categories].find(c => c.id === id);
  }

  product(id: string): PosProduct | undefined {
    return this.allProducts().find(p => p.id === id);
  }

  table(id: string | undefined): PosTable | undefined {
    return this.tables().find(t => t.id === id);
  }

  sale(id: string | undefined): PosSale | undefined {
    return this.sales().find(s => s.id === id);
  }

  tableTotal(tableId: string): number {
    return computeTotals((this.carts()[tableId] ?? []).map(toSaleItem), this.discounts()[tableId]).total;
  }

  /** Quantidade ainda disponível, descontando o que está em todos os carrinhos/mesas. */
  available(product: PosProduct): number {
    if (product.stock === null) return Infinity;
    const reserved = Object.values(this.carts())
      .flat()
      .filter(line => line.product.id === product.id)
      .reduce((total, line) => total + line.quantity, 0);
    return product.stock - reserved;
  }

  /** Quanto ainda se pode devolver de cada artigo da venda. */
  returnable(sale: PosSale): { item: PosSaleItem; max: number }[] {
    return sale.items
      .map(item => ({ item, max: item.quantity - (sale.returned?.[item.product_id] ?? 0) }))
      .filter(r => r.max > 0);
  }

  // ---------- Operadores e PIN ----------

  verifyPin(sellerId: string, pin: string): boolean {
    return this.seller(sellerId)?.pin === pin;
  }

  /** Autorização de supervisor: devolve o gestor dono do PIN. */
  managerByPin(pin: string): PosSeller | undefined {
    return this.sellers().find(s => s.role === 'manager' && s.pin === pin);
  }

  lock() {
    this.locked.set(true);
  }

  unlock(sellerId: string) {
    this.activeSellerId.set(sellerId);
    this.locked.set(false);
  }

  // ---------- Sessão de caixa ----------

  openSession(sellerId: string, openingFloat: number): PosSession {
    const session: PosSession = {
      id: uid('ses'),
      number: this.sessions().reduce((max, s) => Math.max(max, s.number), 0) + 1,
      terminal_name: this.settings().terminal_name,
      opened_at: new Date().toISOString(),
      opened_by: sellerId,
      opening_float: round2(Math.max(0, openingFloat)),
      movements: [],
      status: 'open'
    };
    this.sessions.update(list => [session, ...list]);
    this.unlock(sellerId);
    this.persist();
    return session;
  }

  addMovement(type: 'in' | 'out', amount: number, reason: string) {
    const session = this.currentSession();
    if (!session || amount <= 0) return;
    const movement: PosCashMovement = {
      id: uid('mov'), type, amount: round2(amount), reason,
      created_at: new Date().toISOString(), seller_id: this.activeSellerId()
    };
    this.sessions.update(list => list.map(s => s.id === session.id ? { ...s, movements: [...s.movements, movement] } : s));
    this.persist();
  }

  summarize(session: PosSession): PosSessionSummary {
    const sales = this.sales().filter(s => s.session_id === session.id);
    const done = sales.filter(s => s.status === 'completed');
    const salesOnly = done.filter(s => s.document_type !== 'NC');
    const refunds = done.filter(s => s.document_type === 'NC');
    const cancelled = sales.filter(s => s.status === 'cancelled');

    const byMethod = POS_PAYMENT_METHODS.map(m => {
      const payments = done.flatMap(s => s.payments.filter(p => p.method === m.id));
      return { id: m.id, amount: sum(payments.map(p => p.amount)), count: payments.length };
    });
    const sellerIds = [...new Set(done.map(s => s.seller_id))];
    const bySeller = sellerIds
      .map(id => { const list = done.filter(s => s.seller_id === id); return { seller_id: id, amount: sum(list.map(s => s.total)), count: list.length }; })
      .sort((a, b) => b.amount - a.amount);

    const cashSales = byMethod.find(m => m.id === 'cash')!.amount;
    const ins = sum(session.movements.filter(m => m.type === 'in').map(m => m.amount));
    const outs = sum(session.movements.filter(m => m.type === 'out').map(m => m.amount));

    return {
      count: salesOnly.length,
      total: sum(done.map(s => s.total)),
      tax_total: sum(done.map(s => s.tax_total)),
      byMethod,
      byDocument: {
        VD: salesOnly.filter(s => s.document_type === 'VD').length,
        FR: salesOnly.filter(s => s.document_type === 'FR').length,
        NC: refunds.length
      },
      bySeller,
      cancelled: { count: cancelled.length, total: sum(cancelled.map(s => s.total)) },
      refunds: { count: refunds.length, total: Math.abs(sum(refunds.map(s => s.total))) },
      discounts: sum(salesOnly.map(s => s.discount)),
      cashSales,
      ins,
      outs,
      expectedCash: round2(session.opening_float + cashSales + ins - outs)
    };
  }

  closeSession(countedCash: number, notes: string): PosSession | null {
    const session = this.currentSession();
    if (!session) return null;
    const closed: PosSession = {
      ...session,
      status: 'closed',
      closed_at: new Date().toISOString(),
      closed_by: this.activeSellerId(),
      expected_cash: this.summarize(session).expectedCash,
      counted_cash: round2(countedCash),
      notes: notes.trim() || undefined
    };
    this.sessions.update(list => list.map(s => s.id === session.id ? closed : s));
    this.activeCartKey.set(POS_COUNTER_CART);
    this.locked.set(false);
    this.persist();
    return closed;
  }

  // ---------- Carrinho / pedido da mesa ----------

  selectCart(key: string) {
    this.activeCartKey.set(key);
  }

  addToCart(product: PosProduct): boolean {
    if (this.available(product) <= 0) return false;
    this.updateCart(lines => {
      const existing = lines.find(line => line.product.id === product.id);
      if (existing) return lines.map(line => line === existing ? { ...line, quantity: line.quantity + 1 } : line);
      return [...lines, { product, quantity: 1, sent: 0 }];
    });
    return true;
  }

  setQuantity(productId: string, quantity: number) {
    this.updateCart(lines => lines
      .map(line => {
        if (line.product.id !== productId) return line;
        const current = this.product(productId) ?? line.product;
        const max = current.stock === null ? Infinity : this.available(current) + line.quantity;
        return { ...line, quantity: Math.min(Math.max(0, Math.floor(quantity)), max) };
      })
      .filter(line => line.quantity > 0));
  }

  removeFromCart(productId: string) {
    this.updateCart(lines => lines.filter(line => line.product.id !== productId));
  }

  clearCart() {
    this.updateCart(() => []);
  }

  setDiscount(discount: PosDiscount | null) {
    const key = this.activeCartKey();
    this.discounts.update(map => {
      const { [key]: _, ...rest } = map;
      return discount && discount.value > 0 ? { ...rest, [key]: discount } : rest;
    });
    this.persist();
  }

  // ---------- Restaurante ----------

  /** Abre (ou retoma) a mesa e torna-a no carrinho activo. */
  openTable(tableId: string) {
    if (!this.tableOrders()[tableId]) {
      const table = this.table(tableId);
      this.tableOrders.update(orders => ({
        ...orders,
        [tableId]: { table_id: tableId, opened_at: new Date().toISOString(), waiter_id: this.activeSellerId(), covers: Math.min(2, table?.seats ?? 2) }
      }));
      this.persist();
    }
    this.activeCartKey.set(tableId);
  }

  setCovers(covers: number) {
    const key = this.activeCartKey();
    const order = this.tableOrders()[key];
    if (!order) return;
    this.tableOrders.update(orders => ({ ...orders, [key]: { ...order, covers: Math.max(1, Math.min(30, covers)) } }));
    this.persist();
  }

  /** Mesa aberta sem nada pedido: liberta-a. */
  releaseTableIfEmpty(tableId: string) {
    if ((this.carts()[tableId] ?? []).length > 0 || !this.tableOrders()[tableId]) return;
    this.tableOrders.update(orders => { const { [tableId]: _, ...rest } = orders; return rest; });
    this.persist();
  }

  /** Marca o que falta enviar e devolve-o, agrupado por posto (cozinha / bar). */
  sendToKitchen(): Record<PosStation, { name: string; quantity: number }[]> {
    const result: Record<PosStation, { name: string; quantity: number }[]> = { kitchen: [], bar: [] };
    for (const line of this.cart()) {
      const pending = line.quantity - (line.sent ?? 0);
      if (pending > 0) result[line.product.station ?? 'kitchen'].push({ name: line.product.name, quantity: pending });
    }
    this.updateCart(lines => lines.map(line => ({ ...line, sent: line.quantity })));
    return result;
  }

  /**
   * Leva o pedido actual para outra mesa: do balcão para uma mesa (a mesa passa a
   * ser o "cliente" da venda) ou de uma mesa para outra livre.
   */
  moveToTable(to: string) {
    const from = this.activeCartKey();
    if (from === to || this.tableOrders()[to]) return;
    const order = this.tableOrders()[from];
    const table = this.table(to);
    if (!table) return;
    const moved: PosTableOrder = order
      ? { ...order, table_id: to }
      : { table_id: to, opened_at: new Date().toISOString(), waiter_id: this.activeSellerId(), covers: Math.min(2, table.seats) };
    this.carts.update(carts => { const { [from]: lines, ...rest } = carts; return lines ? { ...rest, [to]: lines } : rest; });
    this.discounts.update(map => { const { [from]: d, ...rest } = map; return d ? { ...rest, [to]: d } : rest; });
    this.tableOrders.update(orders => { const { [from]: _, ...rest } = orders; return { ...rest, [to]: moved }; });
    this.activeCartKey.set(to);
    this.persist();
  }

  // ---------- Vendas ----------

  checkout(input: PosCheckout): PosSale {
    const key = this.activeCartKey();
    const order = this.tableOrders()[key];
    const discount = this.cartDiscount();
    const items = this.cart().map(toSaleItem);
    const totals = computeTotals(items, discount);

    // O troco sai sempre do numerário entregue.
    const paid = sum(input.payments.map(p => p.amount));
    const change = Math.max(0, round2(paid - totals.total));
    const payments = this.mergePayments(input.payments, change);
    const client = this.client(input.client_id);

    const now = new Date();
    const sale: PosSale = {
      id: uid('v'),
      number: this.nextNumber(input.document_type, now.getFullYear()),
      document_type: input.document_type,
      created_at: now.toISOString(),
      seller_id: input.seller_id,
      client_id: input.client_id,
      client_name: (input.client_name?.trim() || client?.name) ?? '',
      client_nuit: (input.client_nuit?.trim() || client?.nuit) || undefined,
      session_id: this.currentSession()?.id,
      table_id: order ? key : undefined,
      covers: order?.covers,
      payment_method: payments.length === 1 ? payments[0].method : 'mixed',
      payments,
      items,
      ...totals,
      amount_received: round2(paid),
      change,
      status: 'completed',
      discount_by: discount?.authorized_by
    };

    this.adjustStock(items, -1);
    this.sales.update(list => [sale, ...list]);
    this.carts.update(carts => { const { [key]: _, ...rest } = carts; return rest; });
    this.discounts.update(map => { const { [key]: _, ...rest } = map; return rest; });
    if (order) {
      this.tableOrders.update(orders => { const { [key]: _, ...rest } = orders; return rest; });
      this.activeCartKey.set(POS_COUNTER_CART);
    }
    this.persist();
    return sale;
  }

  /** Devolução: emite uma nota de crédito (valores negativos) e repõe o stock. */
  refund(saleId: string, lines: { product_id: string; quantity: number }[], method: PosPaymentMethod, reason: string, authorizedBy: string): PosSale | null {
    const original = this.sale(saleId);
    const valid = lines.filter(l => l.quantity > 0);
    if (!original || original.status !== 'completed' || original.document_type === 'NC' || valid.length === 0) return null;

    // O desconto da venda original aplica-se também ao que se devolve.
    const factor = original.gross ? original.total / original.gross : 1;
    const items: PosSaleItem[] = valid.map(l => {
      const it = original.items.find(i => i.product_id === l.product_id)!;
      return { ...it, quantity: -l.quantity, total: round2(-it.unit_price * l.quantity) };
    });
    const gross = sum(items.map(i => i.total));
    const total = round2(gross * factor);
    const tax_total = round2(sum(items.map(i => -taxIncluded(-i.total, i.tax_rate))) * factor);

    const now = new Date();
    const credit: PosSale = {
      id: uid('nc'),
      number: this.nextNumber('NC', now.getFullYear()),
      document_type: 'NC',
      created_at: now.toISOString(),
      seller_id: this.activeSellerId(),
      client_id: original.client_id,
      client_name: original.client_name,
      client_nuit: original.client_nuit,
      session_id: this.currentSession()?.id,
      table_id: original.table_id,
      payment_method: method,
      payments: [{ method, amount: total }],
      items,
      gross,
      discount: round2(gross - total),
      total,
      tax_total,
      subtotal: round2(total - tax_total),
      amount_received: total,
      change: 0,
      status: 'completed',
      discount_by: authorizedBy,
      refund_of: original.id,
      refund_reason: reason.trim() || undefined
    };

    const returned = { ...(original.returned ?? {}) };
    valid.forEach(l => returned[l.product_id] = (returned[l.product_id] ?? 0) + l.quantity);
    this.adjustStock(valid.map(l => ({ product_id: l.product_id, quantity: l.quantity })), 1);
    this.sales.update(list => [credit, ...list.map(s => s.id === original.id ? { ...s, returned } : s)]);
    this.persist();
    return credit;
  }

  /** Anula a venda (com autorização de um gestor) e devolve as quantidades ao stock. */
  cancelSale(saleId: string, authorizedBy: string) {
    const sale = this.sale(saleId);
    if (!sale || sale.status === 'cancelled') return;
    this.adjustStock(sale.items.map(i => ({ product_id: i.product_id, quantity: i.quantity })), 1);
    this.sales.update(list => list.map(s => s.id === saleId ? { ...s, status: 'cancelled', cancelled_by: authorizedBy } : s));
    this.persist();
  }

  // ---------- Definições do terminal ----------

  updateSettings(patch: Partial<PosSettings>) {
    const modeChanged = !!patch.mode && patch.mode !== this.settings().mode;
    if (modeChanged) this.persist();
    this.settings.update(s => ({ ...s, ...patch }));
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings())); } catch { /* armazenamento indisponível */ }
    if (modeChanged) {
      // Outra empresa: outras vendas, outra caixa, outras mesas.
      this.activeCartKey.set(POS_COUNTER_CART);
      this.locked.set(false);
      this.load();
    }
  }

  /** Repõe os dados de demonstração da empresa actual (mantém as definições). */
  resetDemo() {
    try { localStorage.removeItem(this.stateKey()); } catch { /* armazenamento indisponível */ }
    this.activeCartKey.set(POS_COUNTER_CART);
    this.locked.set(false);
    this.load();
  }

  // ---------- Fonte de dados (a substituir pelo Supabase) ----------

  private stateKey() {
    return `${STATE_KEY}.${this.settings().mode}`;
  }

  private load() {
    const stored = this.readStored();
    const products: PosProduct[] = [...mock.products, ...mock.restaurant.products].map(p => ({
      ...(p as PosProduct),
      stock: stored && p.id in stored.stock ? stored.stock[p.id] : p.stock
    }));
    this.allProducts.set(products);
    this.sales.set(stored?.sales ?? this.seedSales(products));
    this.sessions.set(stored?.sessions ?? []);
    this.discounts.set(stored?.discounts ?? {});
    if (stored) {
      this.carts.set(stored.carts);
      this.tableOrders.set(stored.tableOrders);
    } else if (this.settings().mode === 'restaurant') {
      this.seedTables(products);
    } else {
      this.carts.set({});
      this.tableOrders.set({});
    }
  }

  private persist() {
    const state: StoredState = {
      sales: this.sales(),
      stock: Object.fromEntries(this.allProducts().map(p => [p.id, p.stock])),
      sessions: this.sessions(),
      carts: this.carts(),
      tableOrders: this.tableOrders(),
      discounts: this.discounts()
    };
    try { localStorage.setItem(this.stateKey(), JSON.stringify(state)); } catch { /* armazenamento indisponível */ }
  }

  private readStored(): StoredState | null {
    try {
      const raw = localStorage.getItem(this.stateKey());
      return raw ? JSON.parse(raw) as StoredState : null;
    } catch {
      return null;
    }
  }

  private readSettings(): PosSettings {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch { /* armazenamento indisponível */ }
    return DEFAULT_SETTINGS;
  }

  private updateCart(fn: (lines: PosCartLine[]) => PosCartLine[]) {
    const key = this.activeCartKey();
    this.carts.update(carts => {
      const next = fn(carts[key] ?? []);
      if (next.length === 0) { const { [key]: _, ...rest } = carts; return rest; }
      return { ...carts, [key]: next };
    });
    if (!this.carts()[key]) this.discounts.update(map => { const { [key]: _, ...rest } = map; return rest; });
    this.persist();
  }

  /** Junta pagamentos da mesma forma e tira o troco ao numerário. */
  private mergePayments(payments: PosPayment[], change: number): PosPayment[] {
    const merged = new Map<PosPaymentMethod, number>();
    payments.filter(p => p.amount > 0).forEach(p => merged.set(p.method, (merged.get(p.method) ?? 0) + p.amount));
    if (change > 0 && merged.has('cash')) merged.set('cash', merged.get('cash')! - change);
    return [...merged.entries()].map(([method, amount]) => ({ method, amount: round2(amount) })).filter(p => p.amount > 0);
  }

  /** Mesas já ocupadas no arranque da demonstração do restaurante. */
  private seedTables(products: PosProduct[]) {
    const now = Date.now();
    const carts: Record<string, PosCartLine[]> = {};
    const orders: Record<string, PosTableOrder> = {};
    for (const o of mock.restaurant.open_orders) {
      carts[o.table_id] = o.lines.map(l => ({ product: products.find(p => p.id === l.product_id)!, quantity: l.quantity, sent: l.sent }));
      orders[o.table_id] = {
        table_id: o.table_id, waiter_id: o.waiter_id, covers: o.covers,
        opened_at: new Date(now - o.minutes_ago * 60_000).toISOString()
      };
    }
    this.carts.set(carts);
    this.tableOrders.set(orders);
  }

  /** As vendas de exemplo são relativas a hoje, para o painel ter sempre "vendas de hoje". */
  private seedSales(products: PosProduct[]): PosSale[] {
    type RawSale = {
      id: string; days_ago: number; time: string; seller_id: string; client_id?: string; table_id?: string; covers?: number;
      payment_method: string; amount_received?: number; items: { product_id: string; quantity: number }[];
    };
    const raws: RawSale[] = this.settings().mode === 'restaurant' ? mock.restaurant.sales : mock.sales;
    const now = new Date();
    const seeded = raws.map((raw, index): PosSale => {
      const [hours, minutes] = raw.time.split(':').map(Number);
      const date = new Date(now);
      date.setDate(date.getDate() - raw.days_ago);
      date.setHours(hours, minutes, 0, 0);
      // Uma venda "de hoje" nunca pode ficar no futuro.
      if (date > now) date.setTime(now.getTime() - (index + 1) * 7 * 60_000);

      const items = raw.items.map(entry => toSaleItem({ product: products.find(p => p.id === entry.product_id)!, quantity: entry.quantity }));
      const totals = computeTotals(items);
      const method = raw.payment_method as PosPaymentMethod;
      const received = method === 'cash' ? Math.max(totals.total, raw.amount_received ?? totals.total) : totals.total;
      const client = this.client(raw.client_id ?? POS_WALK_IN_CLIENT_ID);

      return {
        id: raw.id,
        number: '',
        document_type: 'VD',
        created_at: date.toISOString(),
        seller_id: raw.seller_id,
        client_id: client?.id ?? POS_WALK_IN_CLIENT_ID,
        client_name: client?.name ?? '',
        client_nuit: client?.nuit,
        table_id: raw.table_id,
        covers: raw.covers,
        payment_method: method,
        payments: [{ method, amount: totals.total }],
        items,
        ...totals,
        amount_received: received,
        change: round2(received - totals.total),
        status: 'completed'
      };
    });

    // Numeração sequencial por ordem cronológica.
    const chronological = [...seeded].sort((a, b) => a.created_at.localeCompare(b.created_at));
    chronological.forEach((sale, i) => {
      sale.number = `VD ${new Date(sale.created_at).getFullYear()}/${String(i + 1).padStart(4, '0')}`;
    });
    return chronological.reverse();
  }

  private nextNumber(type: PosDocumentType, year: number): string {
    const prefix = `${type} ${year}/`;
    const last = this.sales()
      .filter(s => s.number.startsWith(prefix))
      .reduce((max, s) => Math.max(max, Number(s.number.slice(prefix.length)) || 0), 0);
    return `${prefix}${String(last + 1).padStart(4, '0')}`;
  }

  private adjustStock(lines: { product_id: string; quantity: number }[], direction: 1 | -1) {
    this.allProducts.update(list => list.map(product => {
      const line = lines.find(l => l.product_id === product.id);
      if (!line || product.stock === null) return product;
      return { ...product, stock: Math.max(0, product.stock + direction * line.quantity) };
    }));
  }
}
