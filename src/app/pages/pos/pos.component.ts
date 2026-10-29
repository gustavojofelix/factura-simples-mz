import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { Router } from '@angular/router';
import {
  POS_PAYMENT_METHODS,
  POS_WALK_IN_CLIENT_ID,
  PosPaymentMethod,
  PosProduct,
  PosSale,
  PosService
} from '../../core/services/pos.service';
import { CompanyService } from '../../core/services/company.service';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmDialogService } from '../../core/services/confirm-dialog.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { ToastComponent } from '../../shared/components/toast.component';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog.component';
import { t } from '../../core/i18n/i18n';
import { PosReceiptDialogComponent, PosReceiptDialogData } from './pos-receipt-dialog.component';
import { formatPosDate, formatPosMoney, formatPosTime } from './pos-format';

type PosTab = 'terminal' | 'history';
type PosPeriod = 'today' | 'week' | 'all';

const LOW_STOCK = 5;

const CART_WIDTH_KEY = 'pos.cartWidth';
const CART_WIDTH_MIN = 340;
const CART_WIDTH_MAX = 640;

function defaultCartWidth(): number {
  return typeof window !== 'undefined' && window.innerWidth >= 1536 ? 440 : 380;
}

function storedCartWidth(): number {
  try {
    const value = Number(localStorage.getItem(CART_WIDTH_KEY));
    if (value >= CART_WIDTH_MIN && value <= CART_WIDTH_MAX) return value;
  } catch { /* armazenamento indisponível */ }
  return defaultCartWidth();
}

function isSameDay(iso: string, day: Date): boolean {
  const date = new Date(iso);
  return date.getFullYear() === day.getFullYear() && date.getMonth() === day.getMonth() && date.getDate() === day.getDate();
}

@Component({
  selector: 'app-pos',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTooltipModule,
    MatDialogModule,
    ToastComponent,
    ConfirmDialogComponent,
    TranslatePipe
  ],
  templateUrl: './pos.component.html',
  styleUrls: ['./pos.component.css']
})
export class PosComponent implements OnInit, OnDestroy {
  readonly paymentMethods = POS_PAYMENT_METHODS;
  readonly fullscreenSupported = typeof document !== 'undefined' && !!document.documentElement.requestFullscreen;

  isFullscreen = signal(false);
  /** Página de onde se abriu o POS, para o botão Voltar. */
  private readonly returnUrl: string;
  private readonly onFullscreenChange = () => this.isFullscreen.set(!!document.fullscreenElement);
  readonly lowStock = LOW_STOCK;

  tab = signal<PosTab>('terminal');

  // ---------- Caixa ----------
  search = signal('');
  category = signal<string>('all');
  clientId = signal<string>(POS_WALK_IN_CLIENT_ID);
  paymentMethod = signal<PosPaymentMethod>('cash');
  amountReceived = signal<number | null>(null);

  /** Largura da "Venda actual" no desktop, ajustável pela pega e lembrada neste navegador. */
  cartWidth = signal(storedCartWidth());
  /** Telemóvel/tablet: a "Venda actual" abre como folha por cima do catálogo. */
  cartOpen = signal(false);

  filteredProducts = computed(() => {
    const term = this.search().trim().toLowerCase();
    const category = this.category();
    return this.pos.products().filter(p =>
      (category === 'all' || p.category_id === category) &&
      (!term || p.name.toLowerCase().includes(term) || p.code.toLowerCase().includes(term) || (p.barcode ?? '').includes(term))
    );
  });

  /** Quantidade de cada produto no carrinho, para o selo no cartão. */
  cartQuantities = computed(() => new Map(this.pos.cart().map(line => [line.product.id, line.quantity])));

  received = computed(() => this.paymentMethod() === 'cash'
    ? (this.amountReceived() ?? this.pos.cartTotals().total)
    : this.pos.cartTotals().total);
  change = computed(() => Math.max(0, this.received() - this.pos.cartTotals().total));
  missing = computed(() => Math.max(0, this.pos.cartTotals().total - this.received()));
  canCheckout = computed(() => this.pos.cart().length > 0 && this.missing() === 0);

  /** Notas sugeridas para pagamento em numerário. */
  quickAmounts = computed(() => {
    const total = this.pos.cartTotals().total;
    if (total <= 0) return [];
    const options = [50, 100, 200, 500, 1000].map(step => Math.ceil(total / step) * step);
    return [...new Set(options)].filter(v => v > total).slice(0, 3);
  });

  // ---------- Vendas ----------
  historySearch = signal('');
  sellerFilter = signal<string>('all');
  methodFilter = signal<string>('all');
  period = signal<PosPeriod>('today');

  todaySales = computed(() => {
    const today = new Date();
    return this.pos.sales().filter(s => s.status === 'completed' && isSameDay(s.created_at, today));
  });

  kpis = computed(() => {
    const sales = this.todaySales();
    const total = sales.reduce((sum, s) => sum + s.total, 0);
    const bySeller = new Map<string, number>();
    for (const sale of sales) bySeller.set(sale.seller_id, (bySeller.get(sale.seller_id) ?? 0) + sale.total);
    const top = [...bySeller.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      total,
      count: sales.length,
      average: sales.length ? total / sales.length : 0,
      topSeller: top ? { seller: this.pos.seller(top[0]), total: top[1] } : null
    };
  });

  byMethod = computed(() => {
    const sales = this.todaySales();
    const total = sales.reduce((sum, s) => sum + s.total, 0) || 1;
    return this.paymentMethods
      .map(method => {
        const amount = sales.filter(s => s.payment_method === method.id).reduce((sum, s) => sum + s.total, 0);
        return { ...method, amount, share: (amount / total) * 100 };
      })
      .filter(m => m.amount > 0);
  });

  filteredSales = computed(() => {
    const term = this.historySearch().trim().toLowerCase();
    const seller = this.sellerFilter();
    const method = this.methodFilter();
    const period = this.period();
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 6);
    weekAgo.setHours(0, 0, 0, 0);

    return this.pos.sales().filter(s => {
      if (seller !== 'all' && s.seller_id !== seller) return false;
      if (method !== 'all' && s.payment_method !== method) return false;
      if (period === 'today' && !isSameDay(s.created_at, now)) return false;
      if (period === 'week' && new Date(s.created_at) < weekAgo) return false;
      if (term) {
        const client = this.pos.client(s.client_id)?.name.toLowerCase() ?? '';
        if (!s.number.toLowerCase().includes(term) && !client.includes(term)) return false;
      }
      return true;
    });
  });

  periodTotal = computed(() => this.filteredSales()
    .filter(s => s.status === 'completed')
    .reduce((sum, s) => sum + s.total, 0));

  constructor(
    public pos: PosService,
    public companyService: CompanyService,
    private toast: ToastService,
    private confirmDialog: ConfirmDialogService,
    private dialog: MatDialog,
    private router: Router
  ) {
    // Durante a navegação para /pos, previousNavigation é a página de onde se veio.
    const previous = this.router.currentNavigation()?.previousNavigation?.finalUrl;
    this.returnUrl = previous ? this.router.serializeUrl(previous) : '';
  }

  ngOnInit() {
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
    // O clique no menu ainda conta como gesto do utilizador; se o navegador recusar, fica o botão.
    this.enterFullscreen();
  }

  ngOnDestroy() {
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    this.exitFullscreen();
  }

  // ---------- Ecrã inteiro / voltar ----------

  toggleFullscreen() {
    if (document.fullscreenElement) this.exitFullscreen();
    else this.enterFullscreen();
  }

  goBack() {
    const fallback = this.companyService.activeRole() === 'user' ? '/facturas' : '/painel';
    const target = this.returnUrl && !this.returnUrl.startsWith('/pos') ? this.returnUrl : fallback;
    this.router.navigateByUrl(target);
  }

  private enterFullscreen() {
    if (!this.fullscreenSupported || document.fullscreenElement) return;
    document.documentElement.requestFullscreen().catch(() => { /* sem gesto do utilizador */ });
  }

  private exitFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  money(value: number) { return formatPosMoney(value); }
  date(iso: string) { return formatPosDate(iso); }
  time(iso: string) { return formatPosTime(iso); }

  initials(name: string | undefined): string {
    const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }

  // ---------- Acções do caixa ----------

  add(product: PosProduct) {
    if (!this.pos.addToCart(product)) {
      this.toast.warning(t('pos.terminal.stockLimit', { name: product.name }));
    }
  }

  increase(product: PosProduct) {
    this.add(product);
  }

  decrease(productId: string, quantity: number) {
    this.pos.setQuantity(productId, quantity - 1);
  }

  onSearch(event: Event) {
    this.search.set((event.target as HTMLInputElement).value);
  }

  /** Enter na pesquisa: código de barras ou código exacto junta logo ao carrinho. */
  onSearchEnter() {
    const term = this.search().trim().toLowerCase();
    const exact = this.pos.products().find(p => p.barcode === term || p.code.toLowerCase() === term);
    const match = exact ?? (this.filteredProducts().length === 1 ? this.filteredProducts()[0] : undefined);
    if (match) {
      this.add(match);
      this.search.set('');
    }
  }

  onReceived(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.amountReceived.set(value === '' ? null : Number(value));
  }

  selectPayment(method: PosPaymentMethod) {
    this.paymentMethod.set(method);
    this.amountReceived.set(null);
  }

  checkout() {
    if (!this.canCheckout()) return;
    const sale = this.pos.checkout({
      seller_id: this.pos.activeSellerId(),
      client_id: this.clientId(),
      payment_method: this.paymentMethod(),
      amount_received: this.amountReceived()
    });
    this.amountReceived.set(null);
    this.cartOpen.set(false);
    this.clientId.set(POS_WALK_IN_CLIENT_ID);
    this.paymentMethod.set('cash');
    this.toast.success(t('pos.payment.completed', { number: sale.number }));
    this.openSale(sale, true);
  }

  startResize(event: PointerEvent) {
    event.preventDefault();
    const handle = event.target as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const width = Math.round(window.innerWidth - e.clientX);
      this.cartWidth.set(Math.min(CART_WIDTH_MAX, Math.max(CART_WIDTH_MIN, width)));
    };
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
      try { localStorage.setItem(CART_WIDTH_KEY, String(this.cartWidth())); } catch { /* armazenamento indisponível */ }
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  }

  resetCartWidth() {
    this.cartWidth.set(defaultCartWidth());
    try { localStorage.removeItem(CART_WIDTH_KEY); } catch { /* armazenamento indisponível */ }
  }

  // ---------- Acções das vendas ----------

  openSale(sale: PosSale, justCompleted = false) {
    this.dialog.open<PosReceiptDialogComponent, PosReceiptDialogData>(PosReceiptDialogComponent, {
      data: { sale, justCompleted },
      maxWidth: '95vw',
      width: '440px'
    });
  }

  async cancelSale(sale: PosSale) {
    const confirmed = await this.confirmDialog.confirm({
      title: t('pos.history.cancelTitle', { number: sale.number }),
      message: t('pos.history.cancelMessage'),
      confirmLabel: t('pos.history.cancel'),
      cancelLabel: t('common.actions.back'),
      danger: true
    });
    if (!confirmed) return;
    this.pos.cancelSale(sale.id);
    this.toast.info(t('pos.history.cancelled', { number: sale.number }));
  }

  async resetDemo() {
    const confirmed = await this.confirmDialog.confirm({
      title: t('pos.demo.resetTitle'),
      message: t('pos.demo.resetMessage'),
      confirmLabel: t('pos.demo.reset'),
      cancelLabel: t('common.actions.cancel'),
      danger: true
    });
    if (!confirmed) return;
    this.pos.resetDemo();
    this.amountReceived.set(null);
    this.toast.success(t('pos.demo.resetDone'));
  }
}
