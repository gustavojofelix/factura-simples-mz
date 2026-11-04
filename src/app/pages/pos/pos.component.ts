import { Component, ElementRef, HostListener, OnDestroy, OnInit, computed, effect, signal, untracked, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { Capacitor } from '@capacitor/core';
import {
  PosClientRef,
  PosDocument,
  PosDocumentRow,
  PosPaymentInput,
  PosPaymentMethod,
  PosPaymentRequest,
  PosProduct,
  PosService,
  PosSessionReport,
  newClientUuid
} from '../../core/services/pos.service';
import { PosApiError } from '../../core/services/pos-api.service';
import { POS_DISPLAY_CHANNEL, PosDisplayMessage, PosDisplayState } from './pos-display';
import { ToastService } from '../../core/services/toast.service';
import { ConfirmDialogService } from '../../core/services/confirm-dialog.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { ToastComponent } from '../../shared/components/toast.component';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog.component';
import { t } from '../../core/i18n/i18n';
import { PosReceiptAction, PosReceiptDialogComponent, PosReceiptDialogData } from './pos-receipt-dialog.component';
import { PosAccessComponent } from './pos-access.component';
import { PosTablesComponent } from './pos-tables.component';
import {
  PosAuthorizeDialogComponent,
  PosBillSplitDialogComponent,
  PosClientDialogComponent,
  PosCloseDialogComponent,
  PosCloseResult,
  PosDiscountDialogComponent,
  PosDiscountResult,
  PosMobilePaymentDialogComponent,
  PosMovementDialogComponent,
  PosMovementResult,
  PosReasonDialogComponent,
  PosRefundDialogComponent,
  PosRefundResult
} from './pos-dialogs.component';
import { printBill, printDocument, printKitchenTickets, printSessionReport, printVoidTicket } from './pos-print';
import { formatPosDate, formatPosMoney, formatPosTime } from './pos-format';

type PosTab = 'tables' | 'terminal' | 'history';
type PosPeriod = 'session' | 'today' | 'week';

/** Linha do ecrã de venda (balcão ou mesa). */
type SaleLine = ReturnType<PosService['saleLines']>[number];

/** Pagamento na lista do modo dividido, com o valor para mostrar. */
type SplitPayment = PosPaymentInput & { label_amount: number };

const LOW_STOCK = 5;

const CART_WIDTH_KEY = 'pos.cartWidth';
const CART_WIDTH_MIN = 340;
const CART_WIDTH_MAX = 640;

const VOID_LINE_REASONS = ['pos.reason.customerChanged', 'pos.reason.wrongOrder', 'pos.reason.kitchenProblem', 'pos.reason.other'];
const VOID_SALE_REASONS = ['pos.reason.wrongSale', 'pos.reason.customerGaveUp', 'pos.reason.paymentProblem', 'pos.reason.other'];

const round2 = (v: number) => Math.round(v * 100) / 100;

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

  tab = signal<PosTab>('terminal');
  isRestaurant = computed(() => this.pos.mode() === 'restaurant');
  /** Pronto a operar: com caixa aberta, ou empregado de mesa (só pedidos, sem caixa). */
  ready = computed(() => this.pos.phase() === 'ready' && (!!this.pos.session() || !this.pos.canSell()));
  /** Operação em curso (evita duplo toque em "Cobrar"). */
  busy = signal(false);

  // ---------- Venda ----------
  search = signal('');
  category = signal<string>('all');
  client = signal<PosClientRef | null>(null);
  paymentMethod = signal<PosPaymentMethod>('cash');
  amountReceived = signal<number | null>(null);

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

  /** Quantidade de cada artigo no ecrã de venda (para o selo no botão). */
  lineQuantities = computed(() => {
    const map = new Map<string, number>();
    for (const l of this.pos.saleLines()) if (l.product_id) map.set(l.product_id, (map.get(l.product_id) ?? 0) + l.quantity);
    return map;
  });

  total = computed(() => this.pos.totals().total);

  /** Pagamento dividido: várias formas na mesma venda. */
  splitMode = signal(false);
  splitPayments = signal<SplitPayment[]>([]);
  splitAmount = signal<number | null>(null);
  paidSoFar = computed(() => round2(this.splitPayments().reduce((acc, p) => acc + p.label_amount, 0)));

  received = computed(() => {
    if (this.splitMode()) return this.paidSoFar();
    return this.paymentMethod() === 'cash' ? (this.amountReceived() ?? this.total()) : this.total();
  });
  change = computed(() => Math.max(0, round2(this.received() - this.total())));
  missing = computed(() => Math.max(0, round2(this.total() - this.received())));
  canCheckout = computed(() => this.pos.canSell() && !!this.pos.session() && this.pos.saleLines().length > 0
    && this.total() > 0 && this.missing() === 0 && !this.busy());

  quickAmounts = computed(() => {
    const total = this.total();
    if (total <= 0) return [];
    const options = [50, 100, 200, 500, 1000].map(step => Math.ceil(total / step) * step);
    return [...new Set(options)].filter(v => v > total).slice(0, 3);
  });

  freeTables = computed(() => this.pos.tables().filter(tb => !this.pos.orderForTable(tb.id)));
  perPerson = computed(() => {
    const covers = this.pos.activeOrder()?.covers ?? 1;
    return covers > 1 ? this.total() / covers : 0;
  });

  // ---------- Vendas (histórico) ----------
  historySearch = signal('');
  period = signal<PosPeriod>('session');
  documents = signal<PosDocumentRow[]>([]);
  report = signal<PosSessionReport | null>(null);
  historyLoading = signal(false);
  private historyTimer?: ReturnType<typeof setTimeout>;

  kpis = computed(() => {
    const docs = this.documents().filter(d => d.status === 'paga');
    const total = docs.reduce((sum, d) => sum + Number(d.total), 0);
    const count = docs.filter(d => d.document_type === 'FR').length;
    return { total, count, average: count ? total / count : 0 };
  });

  byMethod = computed(() => {
    const payments = this.report()?.payments ?? {};
    const entries = this.pos.paymentMethods()
      .map(m => ({ ...m, amount: Number(payments[m.id]?.total ?? 0) }))
      .filter(m => m.amount !== 0);
    const max = Math.max(1, ...entries.map(e => Math.abs(e.amount)));
    return entries.map(e => ({ ...e, share: Math.max(0, (e.amount / max) * 100) }));
  });

  constructor(
    public pos: PosService,
    private toast: ToastService,
    private confirmDialog: ConfirmDialogService,
    private dialog: MatDialog
  ) {
    // Ao entrar, o restaurante começa nas mesas e a loja na venda.
    effect(() => {
      const restaurant = this.isRestaurant();
      const ready = this.ready();
      untracked(() => { if (ready) this.tab.set(restaurant ? 'tables' : 'terminal'); });
    });

    // Ecrã do cliente: publica a venda actual sempre que muda.
    effect(() => {
      const message = this.displayState();
      untracked(() => { if (!this.paidOnDisplay) this.display?.postMessage(message); });
    });
  }

  /** Estado mostrado no ecrã do cliente (2º monitor). */
  private mobileWaiting = signal<{ method: 'mpesa' | 'emola'; amount: number } | null>(null);
  private displayState = computed<PosDisplayState>(() => ({
    kind: 'state',
    store: this.pos.company()?.name ?? '',
    table: this.pos.activeTable()?.name,
    lines: this.pos.saleLines().map(l => ({ name: l.name, quantity: l.quantity, total: l.unit_price * l.quantity })),
    totals: this.pos.totals(),
    mobile: this.mobileWaiting() ?? undefined
  }));
  private display = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(POS_DISPLAY_CHANNEL) : null;
  private paidOnDisplay = false;
  private paidTimer?: ReturnType<typeof setTimeout>;

  online = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
  private readonly onOnline = () => this.online.set(true);
  private readonly onOffline = () => this.online.set(false);

  ngOnInit() {
    this.pos.init();
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
    clearTimeout(this.historyTimer);
    this.display?.close();
  }

  /** Abre o ecrã do cliente numa janela própria, para arrastar para o 2º monitor. */
  openCustomerDisplay() {
    window.open('/#/pos-cliente', 'ispc-pos-cliente', 'popup,width=1024,height=640');
    this.toast.info(t('pos.display.openedTitle'), t('pos.display.openedBody'));
  }

  /** F2 pesquisa · F9 cobra · Esc fecha o carrinho no telemóvel. */
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

  money(value: number) { return formatPosMoney(Number(value)); }
  date(iso: string) { return formatPosDate(iso); }
  time(iso: string) { return formatPosTime(iso); }
  qty(value: number) { return Number.isInteger(value) ? String(value) : value.toLocaleString(undefined, { maximumFractionDigits: 3 }); }

  initials(name: string | null | undefined): string {
    const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }

  firstName(name: string | null | undefined) {
    return (name ?? '').split(' ')[0];
  }

  elapsed(iso: string | undefined): string {
    if (!iso) return '';
    const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
    return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`;
  }

  // ---------- Erros e autorizações ----------

  private fail(e: unknown) {
    this.toast.error(this.pos.handleError(e));
  }

  /**
   * Executa uma operação; se o servidor pedir a autorização de um gerente
   * (POS_AUTH_REQUIRED) mostra o teclado de PIN e repete com o PIN.
   */
  private async withAuth<T>(reason: string, fn: (pin?: string) => Promise<T>): Promise<T | undefined> {
    let pin: string | undefined;
    let error: string | undefined;
    for (;;) {
      try {
        return await fn(pin);
      } catch (e) {
        if (e instanceof PosApiError && (e.code === 'POS_AUTH_REQUIRED' || e.code === 'POS_AUTH_INVALID')) {
          error = e.code === 'POS_AUTH_INVALID' ? e.message : undefined;
          pin = await new Promise<string | undefined>(resolve => this.dialog
            .open<PosAuthorizeDialogComponent, { reason: string; error?: string }, string | undefined>(
              PosAuthorizeDialogComponent, { data: { reason, error }, maxWidth: '95vw', autoFocus: false })
            .afterClosed().subscribe(resolve));
          if (!pin) return undefined;
          continue;
        }
        throw e;
      }
    }
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
    window.open('/#/configuracoes?tab=pos', '_blank');
  }

  async refreshCatalog() {
    try {
      await this.pos.bootstrap();
      this.toast.success(t('pos.menu.refreshed'));
    } catch (e) {
      this.fail(e);
    }
  }

  async unpair() {
    const confirmed = await this.confirmDialog.confirm({
      title: t('pos.unpair.title'),
      message: t('pos.unpair.message'),
      confirmLabel: t('pos.unpair.confirm'),
      cancelLabel: t('common.actions.cancel'),
      danger: true
    });
    if (confirmed) await this.pos.unpair();
  }

  // ---------- Caixa (sessão) ----------

  async lock() {
    this.cartOpen.set(false);
    await this.pos.lock();
  }

  movement(type: 'in' | 'out') {
    this.dialog.open<PosMovementDialogComponent, { type: 'in' | 'out' }, PosMovementResult>(PosMovementDialogComponent, { data: { type }, maxWidth: '95vw', autoFocus: false })
      .afterClosed().subscribe(async result => {
        if (!result) return;
        try {
          const done = await this.withAuth(t('pos.authorize.cashMovement'),
            pin => this.pos.cashMovement(type, result.amount, result.reason, result.notes, pin));
          if (done) this.toast.success(t(type === 'in' ? 'pos.movement.inDone' : 'pos.movement.outDone'));
        } catch (e) {
          this.fail(e);
        }
      });
  }

  async printPartialReport() {
    try {
      printSessionReport(await this.pos.sessionReport(), this.pos.company()!, this.pos.paperWidth());
    } catch (e) {
      this.fail(e);
    }
  }

  async closeSession() {
    let report: PosSessionReport;
    try {
      report = await this.pos.sessionReport();
    } catch (e) {
      this.fail(e);
      return;
    }
    if (this.isRestaurant() && this.pos.orders().length > 0) {
      this.toast.warning(t('pos.close.tablesOpen', { count: this.pos.orders().length }));
      return;
    }
    const blind = !!this.pos.company()?.settings?.cash?.blind_close && !this.pos.isManager();
    const result = await new Promise<PosCloseResult | undefined>(resolve => this.dialog
      .open<PosCloseDialogComponent, { report: PosSessionReport; blind: boolean; tolerance: number }, PosCloseResult>(PosCloseDialogComponent, {
        data: { report, blind, tolerance: Number(this.pos.company()?.settings?.cash?.tolerance ?? 0) }, maxWidth: '95vw', autoFocus: false
      })
      .afterClosed().subscribe(resolve));
    if (!result) return;
    try {
      const closed = await this.withAuth(t('pos.authorize.difference'),
        pin => this.pos.closeSession(result.counted, result.denominations, result.notes, pin));
      if (!closed) return;
      printSessionReport(closed, this.pos.company()!, this.pos.paperWidth());
      this.resetPayment();
      this.toast.success(t('pos.close.done', { number: closed.session.number }));
      await this.pos.lock();
    } catch (e) {
      this.fail(e);
    }
  }

  // ---------- Mesas ----------

  async openTable(tableId: string | null) {
    this.resetPayment();
    if (tableId === null) {
      this.pos.selectCounter();
      this.tab.set('terminal');
      return;
    }
    try {
      await this.pos.openTable(tableId, Math.min(2, this.pos.table(tableId)?.seats ?? 2));
      this.tab.set('terminal');
    } catch (e) {
      this.fail(e);
    }
  }

  backToTables() {
    this.cartOpen.set(false);
    this.pos.selectCounter();
    this.tab.set('tables');
  }

  async sendToKitchen() {
    const table = this.pos.activeTable();
    if (!table || this.pos.unsentCount() === 0) return;
    try {
      const result = await this.pos.sendOrder();
      if (result?.tickets.length) {
        printKitchenTickets(result.tickets, `${t('pos.tables.table')} ${table.name}`, result.covers, result.waiter, this.pos.paperWidth());
      }
      this.toast.success(t('pos.tables.sent', { table: table.name }));
    } catch (e) {
      this.fail(e);
    }
  }

  printBill() {
    const table = this.pos.activeTable();
    if (!table) return;
    printBill(this.pos.company()!, this.pos.paperWidth(), `${t('pos.tables.table')} ${table.name}`,
      this.pos.activeOrder()?.covers ?? 1, this.pos.saleLines(), this.pos.totals());
  }

  async setCovers(covers: number) {
    try {
      await this.pos.setCovers(Math.max(1, covers));
    } catch (e) {
      this.fail(e);
    }
  }

  /** Do balcão leva o carrinho para a mesa escolhida; de uma mesa, muda o pedido para outra livre. */
  async transferTo(tableId: string) {
    const from = this.pos.activeTable();
    const to = this.pos.table(tableId)?.name ?? '';
    try {
      if (from) await this.pos.moveOrder(tableId);
      else await this.pos.moveCartToTable(tableId);
      this.toast.info(from ? t('pos.tables.transferred', { from: from.name, to }) : t('pos.tables.assigned', { table: to }));
    } catch (e) {
      this.fail(e);
    }
  }

  async onTableSelect(event: Event) {
    const value = (event.target as HTMLSelectElement).value;
    if (value === '') {
      this.pos.selectCounter();
    } else if (this.pos.orderForTable(value)) {
      await this.openTable(value);
    } else {
      await this.transferTo(value);
    }
  }

  /** Fecha a mesa sem cobrar: livre se nada foi enviado; senão pede motivo e gerente. */
  async cancelOrder() {
    const order = this.pos.activeOrder();
    if (!order) return;
    const hasSent = order.lines.some(l => l.status === 'sent');
    let reason: string | undefined;
    if (hasSent) {
      reason = await this.askReason(t('pos.tables.cancelTitle', { table: order.table_name ?? '' }), t('pos.tables.cancelMessage'), t('pos.tables.cancelConfirm'), VOID_LINE_REASONS);
      if (!reason) return;
    }
    try {
      await this.withAuth(t('pos.authorize.voidLine'), async pin => { await this.pos.cancelOrder(reason, pin); return true; });
      this.tab.set('tables');
    } catch (e) {
      this.fail(e);
    }
  }

  /** Conta dividida por artigos: escolher o que se cobra agora. */
  splitBill() {
    const order = this.pos.activeOrder();
    if (!order) return;
    this.dialog.open<PosBillSplitDialogComponent, unknown, Record<string, number>>(PosBillSplitDialogComponent, {
      data: { lines: this.pos.orderLines(), current: this.pos.billSplit() }, maxWidth: '95vw', autoFocus: false
    }).afterClosed().subscribe(selection => {
      if (!selection) return;
      this.pos.billSplit.set(Object.keys(selection).length ? selection : null);
      this.splitPayments.set([]);
      this.amountReceived.set(null);
    });
  }

  cancelBillSplit() {
    this.pos.billSplit.set(null);
    this.splitPayments.set([]);
    this.amountReceived.set(null);
  }

  // ---------- Venda ----------

  async add(product: PosProduct) {
    if (!product.available) {
      this.toast.warning(t('pos.terminal.unavailable', { name: product.name }));
      return;
    }
    let quantity = 1;
    if (product.sold_by_weight) {
      const value = prompt(t('pos.terminal.weightPrompt', { name: product.name, unit: product.unit }), '1');
      quantity = Number(String(value ?? '').replace(',', '.'));
      if (!value || !Number.isFinite(quantity) || quantity <= 0) return;
    }
    if (this.pos.activeOrder()) {
      if (this.pos.billSplit()) this.cancelBillSplit();
      try {
        await this.pos.addToOrder(product, quantity);
      } catch (e) {
        this.fail(e);
      }
      return;
    }
    if (!this.pos.canSell()) {
      this.toast.info(t('pos.tables.chooseTableFirst'));
      return;
    }
    if (product.stock !== null && product.stock - this.pos.inCart(product.id) - quantity < 0) {
      this.toast.warning(t('pos.terminal.stockLimit', { name: product.name }));
    }
    this.pos.addToCart(product, quantity);
  }

  addLine(line: SaleLine) {
    const product = this.pos.product(line.product_id);
    if (product) this.add(product);
  }

  /** −1 numa linha (ou retirar, com quantity = 0). Numa linha da mesa já enviada pede motivo e gerente. */
  async changeLine(line: SaleLine, quantity: number) {
    // Com a conta dividida, as linhas mostram só a parte a cobrar: não se editam.
    if (this.pos.billSplit()) return;
    if (!this.pos.activeOrder()) {
      this.pos.setCartQuantity(line.key, quantity);
      return;
    }
    const orderLine = this.pos.activeOrder()!.lines.find(l => l.id === line.key);
    if (!orderLine) return;
    const target = Math.max(0, round2(orderLine.paid_quantity + quantity));
    let reason: string | undefined;
    if (orderLine.status === 'sent') {
      reason = await this.askReason(t('pos.tables.voidTitle', { name: line.name }), t('pos.tables.voidMessage'), t('pos.tables.voidConfirm'), VOID_LINE_REASONS);
      if (!reason) return;
    }
    try {
      const ticket = await this.withAuth(t('pos.authorize.voidLine'),
        async pin => ({ ticket: await this.pos.updateOrderLine(orderLine.id, target, reason, pin) }));
      if (ticket?.ticket) {
        if (ticket.ticket.station) printVoidTicket(ticket.ticket, this.pos.paperWidth());
        this.toast.info(t('pos.tables.voided', { name: line.name }));
      }
    } catch (e) {
      this.fail(e);
    }
  }

  /** Nota para a cozinha numa linha por enviar ("sem cebola"). */
  async editNote(line: SaleLine) {
    if (!this.pos.activeOrder() || line.status !== 'pending') return;
    const value = prompt(t('pos.tables.notePrompt', { name: line.name }), line.notes ?? '');
    if (value === null) return;
    try {
      await this.pos.updateOrderLine(line.key, line.quantity, undefined, undefined, value);
    } catch (e) {
      this.fail(e);
    }
  }

  async clearSale() {
    if (!this.pos.activeOrder()) {
      this.pos.clearCart();
      return;
    }
    await this.cancelOrder();
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

  chooseClient() {
    this.dialog.open<PosClientDialogComponent, unknown, PosClientRef>(PosClientDialogComponent, { maxWidth: '95vw', autoFocus: false })
      .afterClosed().subscribe(client => { if (client) this.client.set(client); });
  }

  /** Toque numa forma de pagamento: escolhe-a, ou no modo dividido junta um pagamento. */
  async selectPayment(method: PosPaymentMethod) {
    if (this.splitMode()) {
      await this.addSplitPayment(method);
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

  /** Só o numerário pode passar do que falta (o excesso é troco). M-Pesa/e-Mola confirmam já. */
  private async addSplitPayment(method: PosPaymentMethod) {
    const remaining = this.missing();
    let amount = this.splitAmount() ?? remaining;
    if (method !== 'cash') amount = Math.min(amount, remaining);
    amount = round2(amount);
    if (amount <= 0) return;
    if (method === 'cash' && this.splitPayments().some(p => p.method === 'cash')) {
      this.toast.warning(t('pos.split.oneCash'));
      return;
    }
    let payment: SplitPayment;
    if (method === 'mpesa' || method === 'emola') {
      const request = await this.mobilePayment(method, amount);
      if (!request) return;
      payment = { method, request_id: request.id, amount, label_amount: amount };
    } else if (method === 'cash') {
      payment = { method, tendered: amount, label_amount: amount };
    } else {
      payment = { method, amount, label_amount: amount };
    }
    this.splitPayments.update(list => [...list, payment]);
    this.splitAmount.set(null);
  }

  removeSplitPayment(index: number) {
    const payment = this.splitPayments()[index];
    if (payment && (payment.method === 'mpesa' || payment.method === 'emola')) {
      this.toast.warning(t('pos.split.mobileKept'));
      return;
    }
    this.splitPayments.update(list => list.filter((_, i) => i !== index));
  }

  onSplitAmount(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.splitAmount.set(value === '' ? null : Number(value));
  }

  private resetPayment() {
    this.amountReceived.set(null);
    this.client.set(null);
    this.paymentMethod.set('cash');
    this.splitMode.set(false);
    this.splitPayments.set([]);
    this.splitAmount.set(null);
  }

  private mobilePayment(method: 'mpesa' | 'emola', amount: number): Promise<PosPaymentRequest | undefined> {
    return new Promise(resolve => this.dialog
      .open<PosMobilePaymentDialogComponent, unknown, PosPaymentRequest>(PosMobilePaymentDialogComponent, {
        data: { method, amount, onWaiting: (waiting: boolean) => this.mobileWaiting.set(waiting ? { method, amount } : null) },
        maxWidth: '95vw', autoFocus: false
      })
      .afterClosed().subscribe(resolve));
  }

  async checkout() {
    if (!this.canCheckout()) return;
    this.busy.set(true);
    try {
      let payments: PosPaymentInput[];
      if (this.splitMode()) {
        payments = this.splitPayments().map(({ label_amount: _, ...p }) => p as PosPaymentInput);
      } else {
        const method = this.paymentMethod();
        if (method === 'cash') {
          payments = [{ method, tendered: this.received() }];
        } else if (method === 'mpesa' || method === 'emola') {
          const request = await this.mobilePayment(method, this.total());
          if (!request) return;
          payments = [{ method, request_id: request.id, amount: request.amount }];
        } else {
          payments = [{ method, amount: this.total() }];
        }
      }

      const clientUuid = newClientUuid();
      const result = await this.withAuth(t('pos.authorize.discount'), pin => this.pos.checkout({
        client_uuid: clientUuid,
        client_id: this.client()?.id ?? null,
        payments
      }, pin));
      if (!result) return;

      const change = result.document.payments.reduce((sum, p) => sum + Number(p.change || 0), 0);
      this.showPaidOnDisplay(result.document.number, Number(result.document.total), change);
      this.resetPayment();
      this.cartOpen.set(false);
      this.toast.success(t('pos.payment.completed', { number: result.document.number }));
      if (this.pos.activeOrder() === null && this.isRestaurant() && !this.pos.cart().length) this.tab.set('tables');
      this.openDocument(result.document, true);
    } catch (e) {
      this.fail(e);
    } finally {
      this.busy.set(false);
    }
  }

  /** Ecrã do cliente: "Obrigado" e troco durante alguns segundos. */
  private showPaidOnDisplay(number: string, total: number, change: number) {
    clearTimeout(this.paidTimer);
    this.paidOnDisplay = true;
    this.display?.postMessage({ ...this.displayState(), lines: [], mobile: undefined, paid: { number, total, change } } satisfies PosDisplayMessage);
    this.paidTimer = setTimeout(() => {
      this.paidOnDisplay = false;
      this.display?.postMessage(this.displayState());
    }, 8000);
  }

  /** Desconto: o servidor pede o PIN do gerente ao cobrar, se passar do limite do operador. */
  async openDiscount() {
    if (this.pos.saleLines().length === 0) return;
    const current = this.pos.discount();
    const result = await new Promise<PosDiscountResult | undefined>(resolve => this.dialog
      .open<PosDiscountDialogComponent, unknown, PosDiscountResult>(PosDiscountDialogComponent, {
        data: { gross: this.pos.totals().gross, current },
        maxWidth: '95vw', autoFocus: false
      })
      .afterClosed().subscribe(resolve));
    if (!result) return;
    this.pos.discount.set(result.value > 0 ? result : null);
    this.splitPayments.set([]);
    if (result.value > 0) this.toast.success(t('pos.discount.applied', { amount: this.money(this.pos.totals().discount) }));
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

  showHistory() {
    this.tab.set('history');
    this.loadHistory();
  }

  setPeriod(period: PosPeriod) {
    this.period.set(period);
    this.loadHistory();
  }

  onHistorySearch(value: string) {
    this.historySearch.set(value);
    clearTimeout(this.historyTimer);
    this.historyTimer = setTimeout(() => this.loadHistory(), 300);
  }

  async loadHistory() {
    this.historyLoading.set(true);
    try {
      const [docs, report] = await Promise.all([
        this.pos.listDocuments(this.period(), this.historySearch()),
        this.pos.sessionReport().catch(() => null)
      ]);
      this.documents.set(docs);
      this.report.set(report);
    } catch (e) {
      this.fail(e);
    } finally {
      this.historyLoading.set(false);
    }
  }

  async openRow(row: PosDocumentRow) {
    try {
      this.openDocument(await this.pos.getDocument(row.id));
    } catch (e) {
      this.fail(e);
    }
  }

  openDocument(doc: PosDocument, justCompleted = false) {
    this.dialog.open<PosReceiptDialogComponent, PosReceiptDialogData, PosReceiptAction | undefined>(PosReceiptDialogComponent, {
      data: { doc, justCompleted },
      maxWidth: '95vw',
      width: '440px',
      autoFocus: false
    }).afterClosed().subscribe(async action => {
      try {
        if (action === 'print' || action === 'reprint') {
          const fresh = await this.pos.getDocument(doc.id, true);
          printDocument(fresh, this.pos.company()!, this.pos.paperWidth(), action === 'reprint');
        } else if (action === 'refund') {
          await this.refund(doc);
        } else if (action === 'void') {
          await this.voidDocument(doc);
        }
      } catch (e) {
        this.fail(e);
      }
    });
  }

  /** Devolução total ou parcial: nota de crédito (o servidor pede o gerente se for preciso). */
  private async refund(doc: PosDocument) {
    const result = await new Promise<PosRefundResult | undefined>(resolve => this.dialog
      .open<PosRefundDialogComponent, unknown, PosRefundResult>(PosRefundDialogComponent, { data: { doc }, maxWidth: '95vw', autoFocus: false })
      .afterClosed().subscribe(resolve));
    if (!result) return;
    const credit = await this.withAuth(t('pos.authorize.refund', { number: doc.number }),
      pin => this.pos.creditNote(doc.id, result.lines, result.reason, result.method, pin));
    if (!credit) return;
    printDocument(credit, this.pos.company()!, this.pos.paperWidth());
    this.toast.success(t('pos.refund.done', { number: credit.number, amount: this.money(Math.abs(Number(credit.total))) }));
    if (this.tab() === 'history') this.loadHistory();
  }

  private async voidDocument(doc: PosDocument) {
    const reason = await this.askReason(t('pos.history.cancelTitle', { number: doc.number }), t('pos.history.cancelMessage'), t('pos.history.cancel'), VOID_SALE_REASONS);
    if (!reason) return;
    const voided = await this.withAuth(t('pos.authorize.cancel', { number: doc.number }),
      pin => this.pos.voidDocument(doc.id, reason, pin));
    if (!voided) return;
    this.toast.info(t('pos.history.cancelled', { number: doc.number }));
    if (this.tab() === 'history') this.loadHistory();
  }

  private askReason(title: string, message: string, confirm: string, reasons: string[]): Promise<string | undefined> {
    return new Promise(resolve => this.dialog
      .open<PosReasonDialogComponent, unknown, string>(PosReasonDialogComponent, {
        data: { title, message, confirm, reasons }, maxWidth: '95vw', autoFocus: false
      })
      .afterClosed().subscribe(resolve));
  }
}
