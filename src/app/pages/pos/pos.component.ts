import { Component, ElementRef, HostListener, OnDestroy, OnInit, computed, effect, signal, untracked, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { Capacitor } from '@capacitor/core';
import {
  POS_COUNTER_CART,
  POS_PAYMENT_METHODS,
  POS_WALK_IN_CLIENT_ID,
  PosDocumentType,
  PosPaymentMethod,
  PosProduct,
  PosSale,
  PosService,
  PosSession,
  isValidNuit,
  toSaleItem
} from '../../core/services/pos.service';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmDialogService } from '../../core/services/confirm-dialog.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { ToastComponent } from '../../shared/components/toast.component';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog.component';
import { t } from '../../core/i18n/i18n';
import { PosReceiptDialogComponent, PosReceiptDialogData, posPrintContext } from './pos-receipt-dialog.component';
import { PosAccessComponent } from './pos-access.component';
import { PosTablesComponent } from './pos-tables.component';
import {
  PosAuthorizeDialogComponent,
  PosCloseDialogComponent,
  PosMovementDialogComponent,
  PosSettingsDialogComponent
} from './pos-dialogs.component';
import { printBill, printKitchenOrder, printZReport } from './pos-print';
import { formatPosDate, formatPosMoney, formatPosTime } from './pos-format';

type PosTab = 'tables' | 'terminal' | 'history';
type PosPeriod = 'session' | 'today' | 'week' | 'all';

const LOW_STOCK = 5;

const CART_WIDTH_KEY = 'pos.cartWidth';
const CART_WIDTH_MIN = 340;
const CART_WIDTH_MAX = 640;

function defaultCartWidth(): number {
  return typeof window !== 'undefined' && window.innerWidth >= 1536 ? 440 : 400;
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

/** Evento de instalação de PWA (Chrome/Android/Edge). */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

/** Elementos do <head> que fazem do /pos uma aplicação instalável à parte. */
const POS_HEAD: { tag: string; attrs: Record<string, string> }[] = [
  { tag: 'link', attrs: { rel: 'manifest', href: 'assets/pos/pos.webmanifest' } },
  { tag: 'link', attrs: { rel: 'apple-touch-icon', href: 'assets/pos/pos-icon.png' } },
  { tag: 'meta', attrs: { name: 'theme-color', content: '#0f172a' } },
  { tag: 'meta', attrs: { name: 'apple-mobile-web-app-capable', content: 'yes' } },
  { tag: 'meta', attrs: { name: 'mobile-web-app-capable', content: 'yes' } },
  { tag: 'meta', attrs: { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' } },
  { tag: 'meta', attrs: { name: 'apple-mobile-web-app-title', content: 'ISPC POS' } }
];

@Component({
  selector: 'app-pos',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatTooltipModule,
    MatDialogModule,
    ToastComponent,
    ConfirmDialogComponent,
    TranslatePipe,
    PosAccessComponent,
    PosTablesComponent
  ],
  templateUrl: './pos.component.html',
  styleUrls: ['./pos.component.css']
})
export class PosComponent implements OnInit, OnDestroy {
  readonly paymentMethods = POS_PAYMENT_METHODS;
  readonly documentTypes: PosDocumentType[] = ['VD', 'FR'];
  readonly counterCart = POS_COUNTER_CART;
  readonly lowStock = LOW_STOCK;
  readonly isNative = Capacitor.isNativePlatform();
  readonly fullscreenSupported = typeof document !== 'undefined' && !!document.documentElement.requestFullscreen;
  readonly isIos = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
  readonly isStandalone = typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true);

  isFullscreen = signal(false);
  installPrompt = signal<InstallPromptEvent | null>(null);
  private headNodes: HTMLElement[] = [];
  private previousTitle = '';
  private readonly onFullscreenChange = () => this.isFullscreen.set(!!document.fullscreenElement);
  private readonly onInstallPrompt = (e: Event) => { e.preventDefault(); this.installPrompt.set(e as InstallPromptEvent); };

  private searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  tab = signal<PosTab>(this.pos.settings().mode === 'restaurant' ? 'tables' : 'terminal');
  isRestaurant = computed(() => this.pos.settings().mode === 'restaurant');
  ready = computed(() => !!this.pos.currentSession() && !this.pos.locked());

  // ---------- Venda ----------
  search = signal('');
  category = signal<string>('all');
  clientId = signal<string>(POS_WALK_IN_CLIENT_ID);
  paymentMethod = signal<PosPaymentMethod>('cash');
  amountReceived = signal<number | null>(null);
  documentType = signal<PosDocumentType>(this.pos.settings().default_document);
  /** FR para cliente sem ficha: nome e NUIT escritos na hora. */
  fiscalName = signal('');
  fiscalNuit = signal('');

  cartWidth = signal(storedCartWidth());
  cartOpen = signal(false);

  filteredProducts = computed(() => {
    const term = this.search().trim().toLowerCase();
    const category = this.category();
    return this.pos.products().filter(p =>
      (category === 'all' || p.category_id === category) &&
      (!term || p.name.toLowerCase().includes(term) || p.code.toLowerCase().includes(term) || (p.barcode ?? '').includes(term))
    );
  });

  cartQuantities = computed(() => new Map(this.pos.cart().map(line => [line.product.id, line.quantity])));

  selectedClient = computed(() => this.pos.client(this.clientId()));
  /** FR precisa de NUIT: da ficha do cliente ou escrito na hora. */
  needsFiscalData = computed(() => this.documentType() === 'FR' && !this.selectedClient()?.nuit);
  fiscalValid = computed(() => !this.needsFiscalData() || (this.fiscalName().trim().length > 1 && isValidNuit(this.fiscalNuit())));

  received = computed(() => this.paymentMethod() === 'cash'
    ? (this.amountReceived() ?? this.pos.cartTotals().total)
    : this.pos.cartTotals().total);
  change = computed(() => Math.max(0, this.received() - this.pos.cartTotals().total));
  missing = computed(() => Math.max(0, this.pos.cartTotals().total - this.received()));
  canCheckout = computed(() => this.pos.cart().length > 0 && this.missing() === 0 && this.fiscalValid());

  quickAmounts = computed(() => {
    const total = this.pos.cartTotals().total;
    if (total <= 0) return [];
    const options = [50, 100, 200, 500, 1000].map(step => Math.ceil(total / step) * step);
    return [...new Set(options)].filter(v => v > total).slice(0, 3);
  });

  /** Mesas livres para onde se pode transferir a mesa actual. */
  freeTables = computed(() => this.pos.tables().filter(tb => !this.pos.tableOrders()[tb.id]));
  perPerson = computed(() => {
    const covers = this.pos.activeOrder()?.covers ?? 1;
    return covers > 1 ? this.pos.cartTotals().total / covers : 0;
  });

  // ---------- Vendas ----------
  historySearch = signal('');
  sellerFilter = signal<string>('all');
  methodFilter = signal<string>('all');
  period = signal<PosPeriod>('session');

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
    const sessionId = this.pos.currentSession()?.id;
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 6);
    weekAgo.setHours(0, 0, 0, 0);

    return this.pos.sales().filter(s => {
      if (seller !== 'all' && s.seller_id !== seller) return false;
      if (method !== 'all' && s.payment_method !== method) return false;
      if (period === 'session' && s.session_id !== sessionId) return false;
      if (period === 'today' && !isSameDay(s.created_at, now)) return false;
      if (period === 'week' && new Date(s.created_at) < weekAgo) return false;
      if (term && !s.number.toLowerCase().includes(term) && !s.client_name.toLowerCase().includes(term)) return false;
      return true;
    });
  });

  periodTotal = computed(() => this.filteredSales()
    .filter(s => s.status === 'completed')
    .reduce((sum, s) => sum + s.total, 0));

  constructor(
    public pos: PosService,
    private toast: ToastService,
    private confirmDialog: ConfirmDialogService,
    private dialog: MatDialog
  ) {
    // Mudou o modo (retalho/restaurante) ou o documento por omissão nas definições.
    effect(() => {
      const settings = this.pos.settings();
      untracked(() => {
        this.documentType.set(settings.default_document);
        this.category.set('all');
        if (settings.mode === 'retail' && this.tab() === 'tables') this.tab.set('terminal');
      });
    });
  }

  ngOnInit() {
    this.previousTitle = document.title;
    document.title = 'ISPC Fácil POS';
    for (const { tag, attrs } of POS_HEAD) {
      // O manifesto pode já ter sido posto pelo index.html (entrada directa em /pos).
      if (attrs['rel'] === 'manifest' && document.querySelector('link[rel="manifest"]')) continue;
      const node = document.createElement(tag);
      Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
      document.head.appendChild(node);
      this.headNodes.push(node);
    }
    document.documentElement.classList.add('pos-app');
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
    window.addEventListener('beforeinstallprompt', this.onInstallPrompt);
  }

  ngOnDestroy() {
    document.title = this.previousTitle;
    this.headNodes.forEach(n => n.remove());
    document.documentElement.classList.remove('pos-app');
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    window.removeEventListener('beforeinstallprompt', this.onInstallPrompt);
  }

  /** F2 pesquisa · F9 finaliza · Esc fecha o carrinho no telemóvel. */
  @HostListener('document:keydown', ['$event'])
  onShortcut(event: KeyboardEvent) {
    if (!this.ready() || this.dialog.openDialogs.length > 0) return;
    if (event.key === 'F2') {
      event.preventDefault();
      this.tab.set('terminal');
      setTimeout(() => this.searchInput()?.nativeElement.focus());
    } else if (event.key === 'F9' && this.tab() === 'terminal') {
      event.preventDefault();
      this.checkout();
    } else if (event.key === 'Escape' && this.cartOpen()) {
      this.cartOpen.set(false);
    }
  }

  money(value: number) { return formatPosMoney(value); }
  date(iso: string) { return formatPosDate(iso); }
  time(iso: string) { return formatPosTime(iso); }

  initials(name: string | undefined): string {
    const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }

  firstName(name: string | undefined) {
    return (name ?? '').split(' ')[0];
  }

  elapsed(iso: string | undefined): string {
    if (!iso) return '';
    const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
    return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`;
  }

  // ---------- Aplicação ----------

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  async install() {
    const prompt = this.installPrompt();
    if (prompt) {
      await prompt.prompt();
      this.installPrompt.set(null);
    } else if (this.isIos) {
      this.toast.info(t('pos.app.installIosTitle'), t('pos.app.installIosBody'));
    }
  }

  openBackOffice() {
    window.open('/#/painel', '_blank');
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
    this.resetPayment();
    this.tab.set(this.isRestaurant() ? 'tables' : 'terminal');
    this.toast.success(t('pos.demo.resetDone'));
  }

  // ---------- Caixa (sessão) ----------

  lock() {
    this.cartOpen.set(false);
    this.pos.lock();
  }

  movement(type: 'in' | 'out') {
    this.dialog.open(PosMovementDialogComponent, { data: { type }, maxWidth: '95vw', autoFocus: false })
      .afterClosed().subscribe(done => {
        if (done) this.toast.success(t(type === 'in' ? 'pos.movement.inDone' : 'pos.movement.outDone'));
      });
  }

  printPartialReport() {
    const session = this.pos.currentSession();
    if (session) printZReport(session, this.pos.summarize(session), posPrintContext(this.pos));
  }

  closeSession() {
    const busy = Object.keys(this.pos.tableOrders()).length;
    if (this.isRestaurant() && busy > 0) {
      this.toast.warning(t('pos.close.tablesOpen', { count: busy }));
      return;
    }
    this.dialog.open<PosCloseDialogComponent, unknown, PosSession | null>(PosCloseDialogComponent, { maxWidth: '95vw', autoFocus: false })
      .afterClosed().subscribe(closed => {
        if (!closed) return;
        printZReport(closed, this.pos.summarize(closed), posPrintContext(this.pos));
        this.resetPayment();
        this.tab.set(this.isRestaurant() ? 'tables' : 'terminal');
        this.toast.success(t('pos.close.done', { number: closed.number }));
      });
  }

  /** Pede o PIN de um gestor, salvo se o operador actual já for gestor. */
  private authorize(reason: string): Promise<string | undefined> {
    if (this.pos.isManager()) return Promise.resolve(this.pos.activeSellerId());
    return new Promise(resolve => this.dialog
      .open<PosAuthorizeDialogComponent, { reason: string }, string | undefined>(PosAuthorizeDialogComponent, { data: { reason }, maxWidth: '95vw', autoFocus: false })
      .afterClosed().subscribe(resolve));
  }

  async openSettings() {
    if (!(await this.authorize(t('pos.authorize.settings')))) return;
    this.dialog.open(PosSettingsDialogComponent, { maxWidth: '95vw', autoFocus: false })
      .afterClosed().subscribe(saved => { if (saved) this.toast.success(t('pos.settings.saved')); });
  }

  // ---------- Mesas ----------

  openTable(key: string) {
    if (key === POS_COUNTER_CART) this.pos.selectCart(POS_COUNTER_CART);
    else this.pos.openTable(key);
    this.resetPayment();
    this.tab.set('terminal');
  }

  backToTables() {
    const key = this.pos.activeCartKey();
    if (key !== POS_COUNTER_CART) this.pos.releaseTableIfEmpty(key);
    this.cartOpen.set(false);
    this.tab.set('tables');
  }

  sendToKitchen() {
    const table = this.pos.activeTable();
    const order = this.pos.activeOrder();
    if (!table || this.pos.unsentCount() === 0) return;
    const groups = this.pos.sendToKitchen();
    printKitchenOrder(groups, `${t('pos.tables.table')} ${table.name}`, this.pos.seller(order?.waiter_id)?.name ?? '', this.pos.settings().paper_width);
    this.toast.success(t('pos.tables.sent', { table: table.name }));
  }

  printBill() {
    const table = this.pos.activeTable();
    if (!table) return;
    printBill(posPrintContext(this.pos), `${t('pos.tables.table')} ${table.name}`, this.pos.activeOrder()?.covers ?? 1,
      this.pos.cart().map(toSaleItem), this.pos.cartTotals());
  }

  transferTo(tableId: string) {
    const from = this.pos.activeTable();
    if (!from) return;
    this.pos.transferTable(from.id, tableId);
    this.toast.info(t('pos.tables.transferred', { from: from.name, to: this.pos.table(tableId)?.name ?? '' }));
  }

  // ---------- Venda ----------

  add(product: PosProduct) {
    if (!this.pos.addToCart(product)) {
      this.toast.warning(t('pos.terminal.stockLimit', { name: product.name }));
    }
  }

  decrease(productId: string, quantity: number) {
    this.pos.setQuantity(productId, quantity - 1);
  }

  onSearch(event: Event) {
    this.search.set((event.target as HTMLInputElement).value);
  }

  /** Enter na pesquisa (ou leitor de código de barras): o artigo entra logo na venda. */
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

  private resetPayment() {
    this.amountReceived.set(null);
    this.clientId.set(POS_WALK_IN_CLIENT_ID);
    this.paymentMethod.set('cash');
    this.documentType.set(this.pos.settings().default_document);
    this.fiscalName.set('');
    this.fiscalNuit.set('');
  }

  checkout() {
    if (!this.canCheckout()) return;
    const wasTable = !!this.pos.activeOrder();
    const sale = this.pos.checkout({
      seller_id: this.pos.activeSellerId(),
      client_id: this.clientId(),
      client_name: this.needsFiscalData() ? this.fiscalName() : undefined,
      client_nuit: this.needsFiscalData() ? this.fiscalNuit() : undefined,
      payment_method: this.paymentMethod(),
      amount_received: this.amountReceived(),
      document_type: this.documentType()
    });
    this.resetPayment();
    this.cartOpen.set(false);
    this.toast.success(t('pos.payment.completed', { number: sale.number }));
    this.openSale(sale, true);
    if (wasTable) this.tab.set('tables');
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

  // ---------- Histórico ----------

  openSale(sale: PosSale, justCompleted = false) {
    this.dialog.open<PosReceiptDialogComponent, PosReceiptDialogData>(PosReceiptDialogComponent, {
      data: { sale, justCompleted },
      maxWidth: '95vw',
      width: '440px',
      autoFocus: false
    });
  }

  async cancelSale(sale: PosSale) {
    const manager = await this.authorize(t('pos.authorize.cancel', { number: sale.number }));
    if (!manager) return;
    const confirmed = await this.confirmDialog.confirm({
      title: t('pos.history.cancelTitle', { number: sale.number }),
      message: t('pos.history.cancelMessage'),
      confirmLabel: t('pos.history.cancel'),
      cancelLabel: t('common.actions.back'),
      danger: true
    });
    if (!confirmed) return;
    this.pos.cancelSale(sale.id, manager);
    this.toast.info(t('pos.history.cancelled', { number: sale.number }));
  }
}
