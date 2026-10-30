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
  PosPayment,
  PosPaymentMethod,
  PosProduct,
  PosSale,
  PosService,
  PosSession,
  isValidNuit,
  toSaleItem
} from '../../core/services/pos.service';
import { POS_DISPLAY_CHANNEL, PosDisplayMessage, PosDisplayState } from './pos-display';
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
  PosDiscountDialogComponent,
  PosDiscountResult,
  PosMovementDialogComponent,
  PosRefundDialogComponent,
  PosRefundResult,
  PosSettingsDialogComponent
} from './pos-dialogs.component';
import { printBill, printKitchenOrder, printSale, printZReport } from './pos-print';
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
  readonly documentTypes: ('VD' | 'FR')[] = ['VD', 'FR'];
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
  documentType = signal<'VD' | 'FR'>(this.pos.settings().default_document);
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

  /** Pagamento dividido: várias formas na mesma venda (ex.: parte em numerário, parte M-Pesa). */
  splitMode = signal(false);
  splitPayments = signal<PosPayment[]>([]);
  splitAmount = signal<number | null>(null);
  paidSoFar = computed(() => Math.round(this.splitPayments().reduce((acc, p) => acc + p.amount, 0) * 100) / 100);

  received = computed(() => {
    const total = this.pos.cartTotals().total;
    if (this.splitMode()) return this.paidSoFar();
    return this.paymentMethod() === 'cash' ? (this.amountReceived() ?? total) : total;
  });
  change = computed(() => Math.max(0, Math.round((this.received() - this.pos.cartTotals().total) * 100) / 100));
  missing = computed(() => Math.max(0, Math.round((this.pos.cartTotals().total - this.received()) * 100) / 100));
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

  /** Totais líquidos: as notas de crédito (negativas) abatem às vendas. */
  kpis = computed(() => {
    const sales = this.todaySales();
    const total = sales.reduce((sum, s) => sum + s.total, 0);
    const count = sales.filter(s => s.document_type !== 'NC').length;
    const bySeller = new Map<string, number>();
    for (const sale of sales) bySeller.set(sale.seller_id, (bySeller.get(sale.seller_id) ?? 0) + sale.total);
    const top = [...bySeller.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      total,
      count,
      average: count ? total / count : 0,
      topSeller: top ? { seller: this.pos.seller(top[0]), total: top[1] } : null
    };
  });

  byMethod = computed(() => {
    const payments = this.todaySales().flatMap(s => s.payments);
    const total = payments.reduce((sum, p) => sum + p.amount, 0) || 1;
    return this.paymentMethods
      .map(method => {
        const amount = payments.filter(p => p.method === method.id).reduce((sum, p) => sum + p.amount, 0);
        return { ...method, amount, share: Math.max(0, (amount / total) * 100) };
      })
      .filter(m => m.amount !== 0);
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
      if (method !== 'all' && !s.payments.some(p => p.method === method)) return false;
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
    // Mudou a empresa (loja/restaurante) ou o documento por omissão nas definições.
    let lastMode = this.pos.settings().mode;
    effect(() => {
      const settings = this.pos.settings();
      untracked(() => {
        this.resetPayment();
        this.category.set('all');
        if (settings.mode !== lastMode) this.tab.set(settings.mode === 'restaurant' ? 'tables' : 'terminal');
        lastMode = settings.mode;
      });
    });

    // Ecrã do cliente: publica a venda actual sempre que muda.
    effect(() => {
      const message = this.displayState();
      untracked(() => { if (!this.paidOnDisplay) this.display?.postMessage(message); });
    });
  }

  /** Estado mostrado no ecrã do cliente (2º monitor). */
  private displayState = computed<PosDisplayState>(() => ({
    kind: 'state',
    store: this.pos.store().name,
    table: this.pos.activeTable()?.name,
    lines: this.pos.cart().map(l => ({ name: l.product.name, quantity: l.quantity, total: l.product.price * l.quantity })),
    totals: this.pos.cartTotals()
  }));
  private display = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(POS_DISPLAY_CHANNEL) : null;
  private paidOnDisplay = false;
  private paidTimer?: ReturnType<typeof setTimeout>;

  online = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
  private readonly onOnline = () => this.online.set(true);
  private readonly onOffline = () => this.online.set(false);

  ngOnInit() {
    if (this.display) {
      this.display.onmessage = (event: MessageEvent<PosDisplayMessage>) => {
        if (event.data.kind === 'hello') this.display?.postMessage(this.displayState());
      };
    }
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
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
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    clearTimeout(this.paidTimer);
    this.display?.close();
  }

  /** Abre o ecrã do cliente numa janela própria, para arrastar para o 2º monitor. */
  openCustomerDisplay() {
    window.open('/#/pos-cliente', 'ispc-pos-cliente', 'popup,width=1024,height=640');
    this.toast.info(t('pos.display.openedTitle'), t('pos.display.openedBody'));
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

  /**
   * Restaurante: a mesa é o "cliente" da venda. Do balcão leva o pedido para a
   * mesa escolhida; de uma mesa, muda-o para outra livre.
   */
  transferTo(tableId: string) {
    const from = this.pos.activeTable();
    const to = this.pos.table(tableId)?.name ?? '';
    this.pos.moveToTable(tableId);
    this.toast.info(from
      ? t('pos.tables.transferred', { from: from.name, to })
      : t('pos.tables.assigned', { table: to }));
  }

  onTableSelect(event: Event) {
    const select = event.target as HTMLSelectElement;
    const value = select.value;
    if (value === POS_COUNTER_CART) {
      this.backToTables();
      this.openTable(POS_COUNTER_CART);
    } else if (this.pos.tableOrders()[value]) {
      this.openTable(value);
    } else {
      this.transferTo(value);
    }
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

  /** Toque numa forma de pagamento: escolhe-a, ou no modo dividido junta um pagamento. */
  selectPayment(method: PosPaymentMethod) {
    if (this.splitMode()) {
      this.addSplitPayment(method);
      return;
    }
    this.paymentMethod.set(method);
    this.amountReceived.set(null);
  }

  toggleSplit() {
    this.splitMode.update(v => !v);
    this.splitPayments.set([]);
    this.splitAmount.set(null);
    this.amountReceived.set(null);
  }

  /** Só o numerário pode passar do que falta (o excesso é troco). */
  private addSplitPayment(method: PosPaymentMethod) {
    const remaining = this.missing();
    let amount = this.splitAmount() ?? remaining;
    if (method !== 'cash') amount = Math.min(amount, remaining);
    amount = Math.round(amount * 100) / 100;
    if (amount <= 0) return;
    this.splitPayments.update(list => [...list, { method, amount }]);
    this.splitAmount.set(null);
  }

  removeSplitPayment(index: number) {
    this.splitPayments.update(list => list.filter((_, i) => i !== index));
  }

  onSplitAmount(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.splitAmount.set(value === '' ? null : Number(value));
  }

  private resetPayment() {
    this.amountReceived.set(null);
    this.clientId.set(POS_WALK_IN_CLIENT_ID);
    this.paymentMethod.set('cash');
    this.documentType.set(this.pos.settings().default_document);
    this.fiscalName.set('');
    this.fiscalNuit.set('');
    this.splitMode.set(false);
    this.splitPayments.set([]);
    this.splitAmount.set(null);
  }

  checkout() {
    if (!this.canCheckout()) return;
    const wasTable = !!this.pos.activeOrder();
    const payments: PosPayment[] = this.splitMode()
      ? this.splitPayments()
      : [{ method: this.paymentMethod(), amount: this.received() }];
    const sale = this.pos.checkout({
      seller_id: this.pos.activeSellerId(),
      client_id: this.clientId(),
      client_name: this.needsFiscalData() ? this.fiscalName() : undefined,
      client_nuit: this.needsFiscalData() ? this.fiscalNuit() : undefined,
      payments,
      document_type: this.documentType()
    });
    this.showPaidOnDisplay(sale);
    this.resetPayment();
    this.cartOpen.set(false);
    this.toast.success(t('pos.payment.completed', { number: sale.number }));
    this.openSale(sale, true);
    if (wasTable) this.tab.set('tables');
  }

  /** Ecrã do cliente: "Obrigado" e troco durante alguns segundos. */
  private showPaidOnDisplay(sale: PosSale) {
    clearTimeout(this.paidTimer);
    this.paidOnDisplay = true;
    this.display?.postMessage({ ...this.displayState(), lines: [], paid: { number: sale.number, total: sale.total, change: sale.change } } satisfies PosDisplayMessage);
    this.paidTimer = setTimeout(() => {
      this.paidOnDisplay = false;
      this.display?.postMessage(this.displayState());
    }, 8000);
  }

  /** Desconto na venda: precisa sempre do PIN de um gestor. */
  async openDiscount() {
    if (this.pos.cart().length === 0) return;
    const current = this.pos.cartDiscount();
    const result = await new Promise<PosDiscountResult | undefined>(resolve => this.dialog
      .open<PosDiscountDialogComponent, unknown, PosDiscountResult>(PosDiscountDialogComponent, {
        data: { gross: this.pos.cartTotals().gross, current: current ? { type: current.type, value: current.value } : null },
        maxWidth: '95vw', autoFocus: false
      })
      .afterClosed().subscribe(resolve));
    if (!result) return;
    if (result.value <= 0) {
      this.pos.setDiscount(null);
      return;
    }
    const manager = await this.authorize(t('pos.authorize.discount'));
    if (!manager) return;
    this.pos.setDiscount({ ...result, authorized_by: manager });
    this.splitPayments.set([]);
    this.toast.success(t('pos.discount.applied', { amount: this.money(this.pos.cartTotals().discount) }));
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
    this.dialog.open<PosReceiptDialogComponent, PosReceiptDialogData, 'refund' | undefined>(PosReceiptDialogComponent, {
      data: { sale, justCompleted },
      maxWidth: '95vw',
      width: '440px',
      autoFocus: false
    }).afterClosed().subscribe(action => {
      if (action === 'refund') this.refundSale(sale);
    });
  }

  /** Devolução total ou parcial: nota de crédito com autorização do gestor. */
  async refundSale(sale: PosSale) {
    const current = this.pos.sale(sale.id) ?? sale;
    const result = await new Promise<PosRefundResult | undefined>(resolve => this.dialog
      .open<PosRefundDialogComponent, unknown, PosRefundResult>(PosRefundDialogComponent, { data: { sale: current }, maxWidth: '95vw', autoFocus: false })
      .afterClosed().subscribe(resolve));
    if (!result) return;
    const manager = await this.authorize(t('pos.authorize.refund', { number: current.number }));
    if (!manager) return;
    const credit = this.pos.refund(current.id, result.lines, result.method, result.reason, manager);
    if (!credit) return;
    printSale(credit, posPrintContext(this.pos));
    this.toast.success(t('pos.refund.done', { number: credit.number, amount: this.money(Math.abs(credit.total)) }));
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
