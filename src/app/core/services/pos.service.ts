import { Injectable, computed, signal } from '@angular/core';
import mock from '../data/pos-mock.json';

/**
 * Ponto de Venda (POS).
 *
 * Fase de demonstração: os dados vêm de core/data/pos-mock.json e as vendas
 * novas ficam só neste navegador (localStorage). Toda a leitura/escrita passa
 * por load()/persist(), que serão substituídos por chamadas ao Supabase
 * (tabelas pos_sales, pos_sale_items, pos_sellers) sem mudar a interface.
 */

export type PosPaymentMethod = 'cash' | 'mpesa' | 'emola' | 'card' | 'transfer';

export const POS_PAYMENT_METHODS: { id: PosPaymentMethod; icon: string }[] = [
  { id: 'cash', icon: 'fa-money-bill-wave' },
  { id: 'mpesa', icon: 'fa-mobile-screen-button' },
  { id: 'emola', icon: 'fa-wallet' },
  { id: 'card', icon: 'fa-credit-card' },
  { id: 'transfer', icon: 'fa-building-columns' }
];

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
  /** null = serviço, sem controlo de stock. */
  stock: number | null;
}

export interface PosSeller {
  id: string;
  name: string;
  code: string;
  color: string;
}

export interface PosClient {
  id: string;
  name: string;
  nuit?: string;
  phone?: string;
}

export interface PosSaleItem {
  product_id: string;
  name: string;
  unit_price: number;
  tax_rate: number;
  quantity: number;
  total: number;
}

export interface PosSale {
  id: string;
  number: string;
  created_at: string;
  seller_id: string;
  client_id: string;
  payment_method: PosPaymentMethod;
  items: PosSaleItem[];
  subtotal: number;
  tax_total: number;
  total: number;
  amount_received: number;
  change: number;
  status: 'completed' | 'cancelled';
}

export interface PosCartLine {
  product: PosProduct;
  quantity: number;
}

export interface PosCheckout {
  seller_id: string;
  client_id: string;
  payment_method: PosPaymentMethod;
  amount_received?: number | null;
}

export const POS_WALK_IN_CLIENT_ID = 'c00';

const STORAGE_KEY = 'pos.demo.v1';

interface StoredState {
  sales: PosSale[];
  stock: Record<string, number | null>;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** IVA contido num valor com IVA incluído. */
function taxIncluded(total: number, rate: number): number {
  return rate > 0 ? round2(total - total / (1 + rate / 100)) : 0;
}

function summarize(items: PosSaleItem[]) {
  const total = round2(items.reduce((sum, item) => sum + item.total, 0));
  const tax_total = round2(items.reduce((sum, item) => sum + taxIncluded(item.total, item.tax_rate), 0));
  return { total, tax_total, subtotal: round2(total - tax_total) };
}

@Injectable({ providedIn: 'root' })
export class PosService {
  readonly categories = signal<PosCategory[]>(mock.categories);
  readonly products = signal<PosProduct[]>([]);
  readonly sellers = signal<PosSeller[]>(mock.sellers);
  readonly clients = signal<PosClient[]>(mock.clients);
  readonly sales = signal<PosSale[]>([]);

  readonly activeSellerId = signal<string>(mock.sellers[0].id);
  readonly cart = signal<PosCartLine[]>([]);

  readonly cartCount = computed(() => this.cart().reduce((sum, line) => sum + line.quantity, 0));
  readonly cartTotals = computed(() => summarize(this.cart().map(line => this.toItem(line))));

  constructor() {
    this.load();
  }

  // ---------- Consultas ----------

  seller(id: string): PosSeller | undefined {
    return this.sellers().find(s => s.id === id);
  }

  client(id: string): PosClient | undefined {
    return this.clients().find(c => c.id === id);
  }

  category(id: string): PosCategory | undefined {
    return this.categories().find(c => c.id === id);
  }

  product(id: string): PosProduct | undefined {
    return this.products().find(p => p.id === id);
  }

  /** Quantidade ainda disponível para juntar ao carrinho. */
  available(product: PosProduct): number {
    if (product.stock === null) return Infinity;
    const inCart = this.cart().find(line => line.product.id === product.id)?.quantity ?? 0;
    return product.stock - inCart;
  }

  // ---------- Carrinho ----------

  addToCart(product: PosProduct): boolean {
    if (this.available(product) <= 0) return false;
    this.cart.update(lines => {
      const existing = lines.find(line => line.product.id === product.id);
      if (existing) {
        return lines.map(line => line === existing ? { ...line, quantity: line.quantity + 1 } : line);
      }
      return [...lines, { product, quantity: 1 }];
    });
    return true;
  }

  setQuantity(productId: string, quantity: number) {
    this.cart.update(lines => lines
      .map(line => {
        if (line.product.id !== productId) return line;
        const max = line.product.stock ?? Infinity;
        return { ...line, quantity: Math.min(Math.max(0, Math.floor(quantity)), max) };
      })
      .filter(line => line.quantity > 0));
  }

  removeFromCart(productId: string) {
    this.cart.update(lines => lines.filter(line => line.product.id !== productId));
  }

  clearCart() {
    this.cart.set([]);
  }

  // ---------- Vendas ----------

  checkout(input: PosCheckout): PosSale {
    const items = this.cart().map(line => this.toItem(line));
    const totals = summarize(items);
    const received = input.payment_method === 'cash'
      ? Math.max(totals.total, input.amount_received ?? totals.total)
      : totals.total;

    const now = new Date();
    const sale: PosSale = {
      id: `v${now.getTime()}`,
      number: this.nextNumber(now.getFullYear()),
      created_at: now.toISOString(),
      seller_id: input.seller_id,
      client_id: input.client_id,
      payment_method: input.payment_method,
      items,
      ...totals,
      amount_received: round2(received),
      change: round2(received - totals.total),
      status: 'completed'
    };

    this.adjustStock(items, -1);
    this.sales.update(list => [sale, ...list]);
    this.clearCart();
    this.persist();
    return sale;
  }

  /** Anula a venda e devolve as quantidades ao stock. */
  cancelSale(saleId: string) {
    const sale = this.sales().find(s => s.id === saleId);
    if (!sale || sale.status === 'cancelled') return;
    this.adjustStock(sale.items, 1);
    this.sales.update(list => list.map(s => s.id === saleId ? { ...s, status: 'cancelled' } : s));
    this.persist();
  }

  /** Repõe os dados de demonstração originais. */
  resetDemo() {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* armazenamento indisponível */ }
    this.clearCart();
    this.load();
  }

  // ---------- Fonte de dados (a substituir pelo Supabase) ----------

  private load() {
    const stored = this.readStored();
    const products: PosProduct[] = mock.products.map(p => ({
      ...p,
      stock: stored && p.id in stored.stock ? stored.stock[p.id] : p.stock
    }));
    this.products.set(products);
    this.sales.set(stored?.sales ?? this.seedSales(products));
  }

  private persist() {
    const state: StoredState = {
      sales: this.sales(),
      stock: Object.fromEntries(this.products().map(p => [p.id, p.stock]))
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* armazenamento indisponível */ }
  }

  private readStored(): StoredState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) as StoredState : null;
    } catch {
      return null;
    }
  }

  /** As vendas de exemplo são relativas a hoje, para o painel ter sempre "vendas de hoje". */
  private seedSales(products: PosProduct[]): PosSale[] {
    const now = new Date();
    const seeded = mock.sales.map((raw, index) => {
      const [hours, minutes] = raw.time.split(':').map(Number);
      const date = new Date(now);
      date.setDate(date.getDate() - raw.days_ago);
      date.setHours(hours, minutes, 0, 0);
      // Uma venda "de hoje" nunca pode ficar no futuro.
      if (date > now) date.setTime(now.getTime() - (index + 1) * 7 * 60_000);

      const items = raw.items.map(entry => {
        const product = products.find(p => p.id === entry.product_id)!;
        return this.toItem({ product, quantity: entry.quantity });
      });
      const totals = summarize(items);
      const received = raw.payment_method === 'cash'
        ? Math.max(totals.total, (raw as { amount_received?: number }).amount_received ?? totals.total)
        : totals.total;

      return {
        id: raw.id,
        number: '',
        created_at: date.toISOString(),
        seller_id: raw.seller_id,
        client_id: raw.client_id,
        payment_method: raw.payment_method as PosPaymentMethod,
        items,
        ...totals,
        amount_received: received,
        change: round2(received - totals.total),
        status: 'completed' as const
      };
    });

    // Numeração sequencial por ordem cronológica.
    const chronological = [...seeded].sort((a, b) => a.created_at.localeCompare(b.created_at));
    chronological.forEach((sale, i) => {
      sale.number = `VD ${new Date(sale.created_at).getFullYear()}/${String(i + 1).padStart(4, '0')}`;
    });
    return chronological.reverse();
  }

  private nextNumber(year: number): string {
    const prefix = `VD ${year}/`;
    const last = this.sales()
      .filter(s => s.number.startsWith(prefix))
      .reduce((max, s) => Math.max(max, Number(s.number.slice(prefix.length)) || 0), 0);
    return `${prefix}${String(last + 1).padStart(4, '0')}`;
  }

  private adjustStock(items: PosSaleItem[], direction: 1 | -1) {
    this.products.update(list => list.map(product => {
      const item = items.find(i => i.product_id === product.id);
      if (!item || product.stock === null) return product;
      return { ...product, stock: Math.max(0, product.stock + direction * item.quantity) };
    }));
  }

  private toItem(line: PosCartLine): PosSaleItem {
    return {
      product_id: line.product.id,
      name: line.product.name,
      unit_price: line.product.price,
      tax_rate: line.product.tax_rate,
      quantity: line.quantity,
      total: round2(line.product.price * line.quantity)
    };
  }
}
