import { Component, Inject, computed, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import {
  MZN_DENOMINATIONS,
  POS_PAYMENT_METHODS,
  PosMode,
  PosPaymentMethod,
  PosSale,
  PosSaleItem,
  PosPaperWidth,
  PosService,
  PosSession,
  PosSettings
} from '../../core/services/pos.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { t } from '../../core/i18n/i18n';
import { PosPinPadComponent } from './pos-pin-pad.component';
import { formatPosDate, formatPosMoney } from './pos-format';

// =====================================================================
// Entrada / saída de dinheiro
// =====================================================================

const MOVEMENT_REASONS: Record<'in' | 'out', string[]> = {
  in: ['pos.movement.reasons.change', 'pos.movement.reasons.other'],
  out: ['pos.movement.reasons.supplier', 'pos.movement.reasons.deposit', 'pos.movement.reasons.expense', 'pos.movement.reasons.other']
};

@Component({
  selector: 'app-pos-movement-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, TranslatePipe],
  template: `
    <div class="p-6 w-full max-w-[420px]">
      <h2 class="!m-0 text-xl font-bold text-slate-900 flex items-center gap-2">
        <i class="fa-solid" [class.fa-circle-arrow-down]="type === 'in'" [class.text-emerald-600]="type === 'in'"
          [class.fa-circle-arrow-up]="type === 'out'" [class.text-rose-600]="type === 'out'" aria-hidden="true"></i>
        {{ (type === 'in' ? 'pos.movement.inTitle' : 'pos.movement.outTitle') | t }}
      </h2>
      <p class="text-sm text-slate-500 mt-1">{{ 'pos.movement.hint' | t }}</p>

      <label class="block mt-5 rounded-2xl border border-slate-200 focus-within:border-ispc-orange px-4 py-3">
        <span class="text-[11px] font-bold uppercase tracking-wider text-slate-400">{{ 'pos.movement.amount' | t }} (MZN)</span>
        <input type="number" inputmode="decimal" min="0" step="0.01" class="w-full text-3xl font-extrabold outline-none bg-transparent"
          [value]="amount() || ''" (input)="amount.set(+$any($event.target).value || 0)" placeholder="0,00">
      </label>

      <p class="text-xs font-bold uppercase tracking-wider text-slate-400 mt-5 mb-2">{{ 'pos.movement.reason' | t }}</p>
      <div class="flex flex-wrap gap-2">
        @for (key of reasons; track key) {
          <button type="button" class="px-3 py-2 rounded-full border text-sm font-semibold"
            [class.border-ispc-orange]="reasonKey() === key" [class.text-orange-700]="reasonKey() === key" [class.border-slate-200]="reasonKey() !== key"
            (click)="reasonKey.set(key)">{{ key | t }}</button>
        }
      </div>
      <input type="text" class="w-full mt-3 px-4 py-3 rounded-xl border border-slate-200 text-base outline-none focus:border-ispc-orange"
        [placeholder]="'pos.movement.notePlaceholder' | t" [value]="note()" (input)="note.set($any($event.target).value)">

      <div class="flex gap-2 mt-6">
        <button mat-stroked-button class="flex-1 !h-12 !rounded-xl" mat-dialog-close>{{ 'common.actions.cancel' | t }}</button>
        <button mat-raised-button class="flex-1 !h-12 !rounded-xl !bg-ispc-orange !text-white disabled:!opacity-50" [disabled]="amount() <= 0" (click)="save()">
          {{ 'common.actions.confirm' | t }}
        </button>
      </div>
    </div>
  `
})
export class PosMovementDialogComponent {
  readonly type: 'in' | 'out';
  readonly reasons: string[];
  amount = signal(0);
  reasonKey = signal('');
  note = signal('');

  constructor(@Inject(MAT_DIALOG_DATA) data: { type: 'in' | 'out' }, private ref: MatDialogRef<PosMovementDialogComponent>, private pos: PosService) {
    this.type = data.type;
    this.reasons = MOVEMENT_REASONS[data.type];
    this.reasonKey.set(this.reasons[0]);
  }

  save() {
    const reason = [t(this.reasonKey()), this.note().trim()].filter(Boolean).join(' — ');
    this.pos.addMovement(this.type, this.amount(), reason);
    this.ref.close(true);
  }
}

// =====================================================================
// Fecho de caixa
// =====================================================================

@Component({
  selector: 'app-pos-close-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, TranslatePipe],
  template: `
    <div class="flex flex-col max-h-[90dvh] w-full max-w-[560px]">
      <div class="px-6 pt-6 pb-3 shrink-0">
        <h2 class="!m-0 text-xl font-bold text-slate-900">{{ 'pos.close.title' | t: { number: session.number } }}</h2>
        <p class="text-sm text-slate-500">{{ 'pos.close.openedAt' | t: { date: date(session.opened_at), name: pos.seller(session.opened_by)?.name ?? '' } }}</p>
      </div>

      <div class="px-6 pb-4 overflow-y-auto">
        <!-- Resumo -->
        <div class="grid grid-cols-2 gap-3">
          <div class="rounded-2xl bg-slate-50 p-3">
            <p class="text-[11px] font-bold uppercase text-slate-400">{{ 'pos.close.sales' | t }}</p>
            <p class="text-lg font-extrabold">{{ summary.count }} · {{ money(summary.total) }}</p>
          </div>
          <div class="rounded-2xl bg-slate-50 p-3">
            <p class="text-[11px] font-bold uppercase text-slate-400">{{ 'pos.close.cancelled' | t }}</p>
            <p class="text-lg font-extrabold">{{ summary.cancelled.count }} · {{ money(summary.cancelled.total) }}</p>
          </div>
        </div>
        <div class="mt-3 rounded-2xl border border-slate-200 divide-y divide-slate-100 text-sm">
          @for (m of summary.byMethod; track m.id) {
            @if (m.count > 0) {
              <div class="flex justify-between px-4 py-2"><span class="text-slate-600">{{ 'pos.payment.methods.' + m.id | t }} ({{ m.count }})</span><span class="font-semibold">{{ money(m.amount) }}</span></div>
            }
          }
          @if (summary.refunds.count > 0) {
            <div class="flex justify-between px-4 py-2"><span class="text-slate-600">{{ 'pos.close.refunds' | t }} ({{ summary.refunds.count }})</span><span class="text-rose-700">−{{ money(summary.refunds.total) }}</span></div>
          }
          @if (summary.discounts > 0) {
            <div class="flex justify-between px-4 py-2"><span class="text-slate-600">{{ 'pos.close.discounts' | t }}</span><span class="text-rose-700">−{{ money(summary.discounts) }}</span></div>
          }
          <div class="flex justify-between px-4 py-2"><span class="text-slate-600">{{ 'pos.close.float' | t }}</span><span>{{ money(session.opening_float) }}</span></div>
          <div class="flex justify-between px-4 py-2"><span class="text-slate-600">{{ 'pos.close.ins' | t }}</span><span class="text-emerald-700">+{{ money(summary.ins) }}</span></div>
          <div class="flex justify-between px-4 py-2"><span class="text-slate-600">{{ 'pos.close.outs' | t }}</span><span class="text-rose-700">−{{ money(summary.outs) }}</span></div>
          <div class="flex justify-between px-4 py-2 bg-slate-50 font-bold"><span>{{ 'pos.close.expected' | t }}</span><span>{{ money(summary.expectedCash) }}</span></div>
        </div>

        <!-- Contagem -->
        <div class="flex items-center justify-between mt-5 mb-2">
          <p class="text-xs font-bold uppercase tracking-wider text-slate-400">{{ 'pos.close.count' | t }}</p>
          <button type="button" class="text-xs font-semibold text-orange-700" (click)="byNotes.set(!byNotes())">
            {{ (byNotes() ? 'pos.close.countNotes' : 'pos.close.enterTotal') | t }}
          </button>
        </div>
        @if (byNotes()) {
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
            @for (d of denominations; track d; let i = $index) {
              <div class="flex items-center gap-2">
                <span class="w-16 text-sm font-semibold text-slate-700 text-right">{{ d < 1 ? '50 c' : d }}</span>
                <div class="flex items-center border border-slate-200 rounded-xl overflow-hidden">
                  <button type="button" class="w-9 h-9 text-slate-500" (click)="setCount(i, counts()[i] - 1)" aria-label="−">−</button>
                  <input type="number" inputmode="numeric" min="0" class="w-12 h-9 text-center text-base font-bold outline-none"
                    [value]="counts()[i] || ''" (input)="setCount(i, +$any($event.target).value || 0)" placeholder="0">
                  <button type="button" class="w-9 h-9 text-slate-500" (click)="setCount(i, counts()[i] + 1)" aria-label="+">+</button>
                </div>
                <span class="flex-1 text-right text-xs text-slate-400">{{ money(d * counts()[i]) }}</span>
              </div>
            }
          </div>
        } @else {
          <label class="block rounded-2xl border border-slate-200 focus-within:border-ispc-orange px-4 py-3">
            <span class="text-[11px] font-bold uppercase tracking-wider text-slate-400">{{ 'pos.close.counted' | t }} (MZN)</span>
            <input type="number" inputmode="decimal" min="0" step="0.01" class="w-full text-3xl font-extrabold outline-none bg-transparent"
              [value]="manual() ?? ''" (input)="manual.set($any($event.target).value === '' ? null : +$any($event.target).value)">
          </label>
        }

        <div class="flex justify-between items-center mt-4 px-4 py-3 rounded-2xl"
          [class.bg-emerald-50]="difference() === 0" [class.bg-amber-50]="difference() > 0" [class.bg-rose-50]="difference() < 0">
          <div>
            <p class="text-[11px] font-bold uppercase text-slate-500">{{ 'pos.close.counted' | t }}: {{ money(counted()) }}</p>
            <p class="font-bold" [class.text-emerald-700]="difference() === 0" [class.text-amber-700]="difference() > 0" [class.text-rose-700]="difference() < 0">
              {{ (difference() === 0 ? 'pos.close.balanced' : difference() > 0 ? 'pos.close.over' : 'pos.close.short') | t }}
            </p>
          </div>
          <span class="text-xl font-extrabold">{{ difference() > 0 ? '+' : '' }}{{ money(difference()) }}</span>
        </div>

        <textarea rows="2" class="w-full mt-3 px-4 py-3 rounded-xl border border-slate-200 text-base outline-none focus:border-ispc-orange"
          [placeholder]="'pos.close.notesPlaceholder' | t" [value]="notes()" (input)="notes.set($any($event.target).value)"></textarea>
      </div>

      <div class="shrink-0 flex gap-2 px-6 pb-6 pt-3 border-t border-slate-100">
        <button mat-stroked-button class="flex-1 !h-12 !rounded-xl" mat-dialog-close>{{ 'common.actions.cancel' | t }}</button>
        <button mat-raised-button class="flex-[2] !h-12 !rounded-xl !bg-slate-900 !text-white" (click)="close()">
          <mat-icon>lock</mat-icon>
          {{ 'pos.close.confirm' | t }}
        </button>
      </div>
    </div>
  `
})
export class PosCloseDialogComponent {
  readonly session: PosSession;
  readonly summary;
  readonly denominations = MZN_DENOMINATIONS;
  byNotes = signal(true);
  counts = signal<number[]>(MZN_DENOMINATIONS.map(() => 0));
  manual = signal<number | null>(null);
  notes = signal('');

  counted = computed(() => this.byNotes()
    ? Math.round(this.counts().reduce((sum, c, i) => sum + c * MZN_DENOMINATIONS[i], 0) * 100) / 100
    : (this.manual() ?? 0));
  difference = computed(() => Math.round((this.counted() - this.summary.expectedCash) * 100) / 100);

  constructor(public pos: PosService, private ref: MatDialogRef<PosCloseDialogComponent, PosSession | null>) {
    this.session = pos.currentSession()!;
    this.summary = pos.summarize(this.session);
  }

  money(v: number) { return formatPosMoney(v); }
  date(iso: string) { return formatPosDate(iso); }

  setCount(index: number, value: number) {
    this.counts.update(list => list.map((c, i) => i === index ? Math.max(0, Math.floor(value)) : c));
  }

  close() {
    this.ref.close(this.pos.closeSession(this.counted(), this.notes()));
  }
}

// =====================================================================
// Autorização de supervisor (PIN de gestor)
// =====================================================================

@Component({
  selector: 'app-pos-authorize-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, TranslatePipe, PosPinPadComponent],
  template: `
    <div class="p-6 w-full max-w-[380px]">
      <div class="text-center">
        <span class="inline-flex w-12 h-12 rounded-2xl bg-slate-900 text-white items-center justify-center text-xl">
          <i class="fa-solid fa-user-shield" aria-hidden="true"></i>
        </span>
        <h2 class="!m-0 !mt-3 text-lg font-bold text-slate-900">{{ 'pos.authorize.title' | t }}</h2>
        <p class="text-sm text-slate-500 mt-1 mb-5">{{ data.reason }}</p>
      </div>
      <app-pos-pin-pad (completed)="check($event)" />
      <button mat-button class="w-full !mt-4" mat-dialog-close>{{ 'common.actions.cancel' | t }}</button>
    </div>
  `
})
export class PosAuthorizeDialogComponent {
  private pinPad = viewChild(PosPinPadComponent);

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: { reason: string },
    private ref: MatDialogRef<PosAuthorizeDialogComponent, string | undefined>,
    private pos: PosService
  ) {}

  check(pin: string) {
    const manager = this.pos.managerByPin(pin);
    if (manager) this.ref.close(manager.id);
    else this.pinPad()?.reject();
  }
}

// =====================================================================
// Definições do terminal
// =====================================================================

@Component({
  selector: 'app-pos-settings-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, TranslatePipe],
  template: `
    <div class="p-6 w-full max-w-[480px]">
      <h2 class="!m-0 text-xl font-bold text-slate-900">{{ 'pos.settings.title' | t }}</h2>
      <p class="text-sm text-slate-500 mt-1">{{ 'pos.settings.hint' | t }}</p>

      <p class="label">{{ 'pos.settings.mode' | t }}</p>
      <div class="seg">
        @for (m of modes; track m.id) {
          <button type="button" [class.on]="draft().mode === m.id" (click)="patch({ mode: m.id })">
            <i class="fa-solid {{ m.icon }}" aria-hidden="true"></i> {{ 'pos.settings.modes.' + m.id | t }}
          </button>
        }
      </div>

      <p class="label">{{ 'pos.settings.document' | t }}</p>
      <div class="seg">
        @for (d of documents; track d) {
          <button type="button" [class.on]="draft().default_document === d" (click)="patch({ default_document: d })">{{ 'pos.documents.' + d | t }}</button>
        }
      </div>

      <p class="label">{{ 'pos.settings.paper' | t }}</p>
      <div class="seg">
        @for (w of widths; track w) {
          <button type="button" [class.on]="draft().paper_width === w" (click)="patch({ paper_width: w })">{{ w }} mm</button>
        }
      </div>

      <p class="label">{{ 'pos.settings.terminalName' | t }}</p>
      <input type="text" class="w-full px-4 py-3 rounded-xl border border-slate-200 text-base outline-none focus:border-ispc-orange"
        [value]="draft().terminal_name" (input)="patch({ terminal_name: $any($event.target).value })">

      <div class="flex gap-2 mt-6">
        <button mat-stroked-button class="flex-1 !h-12 !rounded-xl" mat-dialog-close>{{ 'common.actions.cancel' | t }}</button>
        <button mat-raised-button class="flex-1 !h-12 !rounded-xl !bg-ispc-orange !text-white" (click)="save()">{{ 'common.actions.save' | t }}</button>
      </div>
    </div>
  `,
  styles: [`
    .label { margin: 18px 0 8px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: #94a3b8; }
    .seg { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 4px; padding: 4px; border-radius: 14px; background: #f1f5f9; }
    .seg button { min-height: 44px; border-radius: 10px; font-size: 14px; font-weight: 600; color: #64748b; display: flex; align-items: center; justify-content: center; gap: 8px; }
    .seg button.on { background: #fff; color: #0f172a; box-shadow: 0 1px 3px rgb(15 23 42 / .12); }
  `]
})
export class PosSettingsDialogComponent {
  readonly modes: { id: PosMode; icon: string }[] = [{ id: 'retail', icon: 'fa-basket-shopping' }, { id: 'restaurant', icon: 'fa-utensils' }];
  readonly documents: ('VD' | 'FR')[] = ['VD', 'FR'];
  readonly widths: PosPaperWidth[] = [58, 80];
  draft = signal<PosSettings>(this.pos.settings());

  constructor(private pos: PosService, private ref: MatDialogRef<PosSettingsDialogComponent>) {}

  patch(change: Partial<PosSettings>) {
    this.draft.update(d => ({ ...d, ...change }));
  }

  save() {
    const draft = this.draft();
    this.pos.updateSettings({ ...draft, terminal_name: draft.terminal_name.trim() || this.pos.settings().terminal_name });
    this.ref.close(true);
  }
}

// =====================================================================
// Desconto na venda
// =====================================================================

export interface PosDiscountResult {
  type: 'pct' | 'amount';
  value: number;
}

@Component({
  selector: 'app-pos-discount-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, TranslatePipe],
  template: `
    <div class="p-6 w-full max-w-[420px]">
      <h2 class="!m-0 text-xl font-bold text-slate-900">{{ 'pos.discount.title' | t }}</h2>
      <p class="text-sm text-slate-500 mt-1">{{ 'pos.discount.hint' | t }}</p>

      <div class="grid grid-cols-2 gap-1 p-1 mt-5 rounded-xl bg-slate-100">
        <button type="button" class="h-10 rounded-lg text-sm font-bold" [class.bg-white]="type() === 'pct'" [class.shadow-sm]="type() === 'pct'" (click)="type.set('pct')">%</button>
        <button type="button" class="h-10 rounded-lg text-sm font-bold" [class.bg-white]="type() === 'amount'" [class.shadow-sm]="type() === 'amount'" (click)="type.set('amount')">MZN</button>
      </div>

      <label class="block mt-3 rounded-2xl border border-slate-200 focus-within:border-ispc-orange px-4 py-3">
        <span class="text-[11px] font-bold uppercase tracking-wider text-slate-400">{{ 'pos.discount.value' | t }} ({{ type() === 'pct' ? '%' : 'MZN' }})</span>
        <input type="number" inputmode="decimal" min="0" step="0.01" class="w-full text-3xl font-extrabold outline-none bg-transparent"
          [value]="value() || ''" (input)="value.set(+$any($event.target).value || 0)" placeholder="0">
      </label>
      @if (type() === 'pct') {
        <div class="flex flex-wrap gap-2 mt-3">
          @for (p of presets; track p) {
            <button type="button" class="px-3 py-2 rounded-full border text-sm font-semibold"
              [class.border-ispc-orange]="value() === p" [class.text-orange-700]="value() === p" [class.border-slate-200]="value() !== p"
              (click)="value.set(p)">{{ p }}%</button>
          }
        </div>
      }

      <div class="mt-5 rounded-2xl bg-slate-50 p-4 text-sm space-y-1">
        <div class="flex justify-between text-slate-500"><span>{{ 'pos.discount.before' | t }}</span><span>{{ money(data.gross) }}</span></div>
        <div class="flex justify-between text-rose-600"><span>{{ 'pos.discount.label' | t }}</span><span>−{{ money(off()) }}</span></div>
        <div class="flex justify-between font-bold text-slate-900 text-base"><span>{{ 'pos.discount.after' | t }}</span><span>{{ money(data.gross - off()) }}</span></div>
      </div>

      <div class="flex gap-2 mt-6">
        @if (data.current) {
          <button mat-stroked-button class="!h-12 !rounded-xl !text-rose-600" (click)="ref.close({ type: 'pct', value: 0 })">{{ 'pos.discount.remove' | t }}</button>
        }
        <button mat-stroked-button class="flex-1 !h-12 !rounded-xl" mat-dialog-close>{{ 'common.actions.cancel' | t }}</button>
        <button mat-raised-button class="flex-1 !h-12 !rounded-xl !bg-ispc-orange !text-white disabled:!opacity-50"
          [disabled]="off() <= 0" (click)="ref.close({ type: type(), value: value() })">{{ 'pos.discount.apply' | t }}</button>
      </div>
    </div>
  `
})
export class PosDiscountDialogComponent {
  readonly presets = [5, 10, 15, 20];
  type = signal<'pct' | 'amount'>('pct');
  value = signal(0);
  off = computed(() => {
    const v = Math.max(0, this.value());
    return this.type() === 'pct'
      ? Math.round(this.data.gross * Math.min(100, v)) / 100
      : Math.min(this.data.gross, v);
  });

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: { gross: number; current: PosDiscountResult | null },
    public ref: MatDialogRef<PosDiscountDialogComponent, PosDiscountResult>
  ) {
    if (data.current) { this.type.set(data.current.type); this.value.set(data.current.value); }
  }

  money(v: number) { return formatPosMoney(v); }
}

// =====================================================================
// Devolução (nota de crédito)
// =====================================================================

export interface PosRefundResult {
  lines: { product_id: string; quantity: number }[];
  method: PosPaymentMethod;
  reason: string;
}

const REFUND_REASONS = ['pos.refund.reasons.defect', 'pos.refund.reasons.mistake', 'pos.refund.reasons.changedMind', 'pos.refund.reasons.other'];

@Component({
  selector: 'app-pos-refund-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, TranslatePipe],
  template: `
    <div class="flex flex-col max-h-[90dvh] w-full max-w-[520px]">
      <div class="px-6 pt-6 pb-3 shrink-0">
        <h2 class="!m-0 text-xl font-bold text-slate-900">{{ 'pos.refund.title' | t }}</h2>
        <p class="text-sm text-slate-500">{{ 'pos.refund.subtitle' | t: { number: sale.number } }}</p>
      </div>

      <div class="px-6 pb-4 overflow-y-auto">
        <div class="flex justify-end mb-1">
          <button type="button" class="text-xs font-semibold text-orange-700" (click)="all()">{{ 'pos.refund.all' | t }}</button>
        </div>
        <ul class="divide-y divide-slate-100 rounded-2xl border border-slate-200">
          @for (r of rows; track r.item.product_id; let i = $index) {
            <li class="flex items-center gap-3 px-3 py-2.5">
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-slate-800 truncate">{{ r.item.name }}</p>
                <p class="text-[11px] text-slate-400">{{ money(r.item.unit_price) }} · {{ 'pos.refund.max' | t: { count: r.max } }}</p>
              </div>
              <div class="flex items-center border border-slate-200 rounded-xl overflow-hidden">
                <button type="button" class="w-9 h-9 text-slate-500" (click)="setQty(i, qty()[i] - 1)" aria-label="−">−</button>
                <span class="w-8 text-center font-bold">{{ qty()[i] }}</span>
                <button type="button" class="w-9 h-9 text-slate-500" (click)="setQty(i, qty()[i] + 1)" aria-label="+">+</button>
              </div>
            </li>
          }
        </ul>

        <p class="text-xs font-bold uppercase tracking-wider text-slate-400 mt-5 mb-2">{{ 'pos.refund.method' | t }}</p>
        <div class="grid grid-cols-5 gap-1.5">
          @for (m of methods; track m.id) {
            <button type="button" class="flex flex-col items-center gap-1 py-2 rounded-xl border text-[11px] font-semibold min-w-0"
              [class.border-ispc-orange]="method() === m.id" [class.bg-orange-50]="method() === m.id" [class.border-slate-200]="method() !== m.id"
              (click)="method.set(m.id)">
              <i class="fa-solid {{ m.icon }}" aria-hidden="true"></i>
              <span class="truncate max-w-full">{{ 'pos.payment.methods.' + m.id | t }}</span>
            </button>
          }
        </div>

        <p class="text-xs font-bold uppercase tracking-wider text-slate-400 mt-5 mb-2">{{ 'pos.refund.reason' | t }}</p>
        <div class="flex flex-wrap gap-2">
          @for (key of reasons; track key) {
            <button type="button" class="px-3 py-2 rounded-full border text-sm font-semibold"
              [class.border-ispc-orange]="reason() === key" [class.text-orange-700]="reason() === key" [class.border-slate-200]="reason() !== key"
              (click)="reason.set(key)">{{ key | t }}</button>
          }
        </div>
      </div>

      <div class="shrink-0 px-6 pb-6 pt-3 border-t border-slate-100">
        <div class="flex justify-between items-baseline mb-3">
          <span class="text-sm font-semibold text-slate-600">{{ 'pos.refund.total' | t }}</span>
          <span class="text-2xl font-extrabold text-rose-600">{{ money(total()) }}</span>
        </div>
        <div class="flex gap-2">
          <button mat-stroked-button class="flex-1 !h-12 !rounded-xl" mat-dialog-close>{{ 'common.actions.cancel' | t }}</button>
          <button mat-raised-button class="flex-[2] !h-12 !rounded-xl !bg-rose-600 !text-white disabled:!opacity-50" [disabled]="total() <= 0" (click)="confirm()">
            {{ 'pos.refund.confirm' | t }}
          </button>
        </div>
      </div>
    </div>
  `
})
export class PosRefundDialogComponent {
  readonly sale: PosSale;
  readonly rows: { item: PosSaleItem; max: number }[];
  readonly methods = POS_PAYMENT_METHODS;
  readonly reasons = REFUND_REASONS;
  qty = signal<number[]>([]);
  method = signal<PosPaymentMethod>('cash');
  reason = signal(REFUND_REASONS[0]);
  total = computed(() => {
    const factor = this.sale.gross ? this.sale.total / this.sale.gross : 1;
    const gross = this.rows.reduce((acc, r, i) => acc + r.item.unit_price * (this.qty()[i] ?? 0), 0);
    return Math.round(gross * factor * 100) / 100;
  });

  constructor(
    @Inject(MAT_DIALOG_DATA) data: { sale: PosSale },
    private ref: MatDialogRef<PosRefundDialogComponent, PosRefundResult>,
    pos: PosService
  ) {
    this.sale = data.sale;
    this.rows = pos.returnable(data.sale);
    this.qty.set(this.rows.map(() => 0));
    this.method.set(data.sale.payments[0]?.method ?? 'cash');
  }

  money(v: number) { return formatPosMoney(v); }

  setQty(i: number, value: number) {
    this.qty.update(list => list.map((q, j) => j === i ? Math.max(0, Math.min(this.rows[i].max, value)) : q));
  }

  all() {
    this.qty.set(this.rows.map(r => r.max));
  }

  confirm() {
    this.ref.close({
      lines: this.rows.map((r, i) => ({ product_id: r.item.product_id, quantity: this.qty()[i] })).filter(l => l.quantity > 0),
      method: this.method(),
      reason: t(this.reason())
    });
  }
}
