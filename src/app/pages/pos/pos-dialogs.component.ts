import { Component, Inject, OnDestroy, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import {
  MZN_DENOMINATIONS,
  POS_PAYMENT_METHODS,
  PosClientRef,
  PosDocument,
  PosOrderLine,
  PosPaymentMethod,
  PosPaymentRequest,
  PosService,
  PosSessionReport,
  isValidNuit
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

export interface PosMovementResult {
  amount: number;
  reason: string;
  notes: string | null;
}

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

  constructor(@Inject(MAT_DIALOG_DATA) data: { type: 'in' | 'out' }, private ref: MatDialogRef<PosMovementDialogComponent, PosMovementResult>) {
    this.type = data.type;
    this.reasons = MOVEMENT_REASONS[data.type];
    this.reasonKey.set(this.reasons[0]);
  }

  save() {
    this.ref.close({ amount: this.amount(), reason: t(this.reasonKey()), notes: this.note().trim() || null });
  }
}

// =====================================================================
// Fecho de caixa
// =====================================================================

export interface PosCloseResult {
  counted: number;
  denominations: Record<string, number> | null;
  notes: string;
}

@Component({
  selector: 'app-pos-close-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, TranslatePipe],
  template: `
    <div class="flex flex-col max-h-[90dvh] w-full max-w-[560px]">
      <div class="px-6 pt-6 pb-3 shrink-0">
        <h2 class="!m-0 text-xl font-bold text-slate-900">{{ 'pos.close.title' | t: { number: r.session.number } }}</h2>
        <p class="text-sm text-slate-500">{{ 'pos.close.openedAt' | t: { date: date(r.session.opened_at), name: r.session.opened_by } }}</p>
      </div>

      <div class="px-6 pb-4 overflow-y-auto">
        <div class="grid grid-cols-2 gap-3">
          <div class="rounded-2xl bg-slate-50 p-3">
            <p class="text-[11px] font-bold uppercase text-slate-400">{{ 'pos.close.sales' | t }}</p>
            <p class="text-lg font-extrabold">{{ r.documents.FR?.count ?? 0 }} · {{ money(r.net_sales) }}</p>
          </div>
          <div class="rounded-2xl bg-slate-50 p-3">
            <p class="text-[11px] font-bold uppercase text-slate-400">{{ 'pos.close.cancelled' | t }}</p>
            <p class="text-lg font-extrabold">{{ r.voided.count }} · {{ money(r.voided.total) }}</p>
          </div>
        </div>
        <div class="mt-3 rounded-2xl border border-slate-200 divide-y divide-slate-100 text-sm">
          @for (m of methods; track m.id) {
            @if (r.payments[m.id]; as p) {
              <div class="flex justify-between px-4 py-2"><span class="text-slate-600">{{ 'pos.payment.methods.' + m.id | t }} ({{ p.count }})</span><span class="font-semibold">{{ money(p.total) }}</span></div>
            }
          }
          @if (r.documents.NC; as nc) {
            <div class="flex justify-between px-4 py-2"><span class="text-slate-600">{{ 'pos.close.refunds' | t }} ({{ nc.count }})</span><span class="text-rose-700">{{ money(nc.total) }}</span></div>
          }
          @if (r.discounts > 0) {
            <div class="flex justify-between px-4 py-2"><span class="text-slate-600">{{ 'pos.close.discounts' | t }}</span><span class="text-rose-700">−{{ money(r.discounts) }}</span></div>
          }
          @if (!blind) {
            <div class="flex justify-between px-4 py-2"><span class="text-slate-600">{{ 'pos.close.float' | t }}</span><span>{{ money(r.cash.opening_float) }}</span></div>
            <div class="flex justify-between px-4 py-2"><span class="text-slate-600">{{ 'pos.close.ins' | t }}</span><span class="text-emerald-700">+{{ money(r.cash.in) }}</span></div>
            <div class="flex justify-between px-4 py-2"><span class="text-slate-600">{{ 'pos.close.outs' | t }}</span><span class="text-rose-700">−{{ money(r.cash.out) }}</span></div>
            <div class="flex justify-between px-4 py-2 bg-slate-50 font-bold"><span>{{ 'pos.close.expected' | t }}</span><span>{{ money(r.cash.expected) }}</span></div>
          }
        </div>
        @if (r.simulated_payments) {
          <p class="text-xs text-amber-700 mt-2"><i class="fa-solid fa-flask" aria-hidden="true"></i> {{ 'pos.close.simulated' | t: { amount: money(r.simulated_payments) } }}</p>
        }

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

        @if (!blind) {
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
        } @else {
          <p class="mt-4 px-4 py-3 rounded-2xl bg-slate-50 text-sm text-slate-600">{{ 'pos.close.blindHint' | t: { amount: money(counted()) } }}</p>
        }

        @if (needsNotes()) {
          <p class="text-xs font-semibold text-amber-700 mt-3">{{ 'pos.close.notesRequired' | t }}</p>
        }
        <textarea rows="2" class="w-full mt-2 px-4 py-3 rounded-xl border text-base outline-none focus:border-ispc-orange"
          [class.border-amber-400]="needsNotes() && notes().trim().length < 3" [class.border-slate-200]="!needsNotes() || notes().trim().length >= 3"
          [placeholder]="'pos.close.notesPlaceholder' | t" [value]="notes()" (input)="notes.set($any($event.target).value)"></textarea>
      </div>

      <div class="shrink-0 flex gap-2 px-6 pb-6 pt-3 border-t border-slate-100">
        <button mat-stroked-button class="flex-1 !h-12 !rounded-xl" mat-dialog-close>{{ 'common.actions.cancel' | t }}</button>
        <button mat-raised-button class="flex-[2] !h-12 !rounded-xl !bg-slate-900 !text-white disabled:!opacity-50"
          [disabled]="needsNotes() && notes().trim().length < 3" (click)="close()">
          <mat-icon>lock</mat-icon>
          {{ 'pos.close.confirm' | t }}
        </button>
      </div>
    </div>
  `
})
export class PosCloseDialogComponent {
  readonly r: PosSessionReport;
  readonly blind: boolean;
  readonly methods = POS_PAYMENT_METHODS;
  readonly denominations = MZN_DENOMINATIONS;
  byNotes = signal(true);
  counts = signal<number[]>(MZN_DENOMINATIONS.map(() => 0));
  manual = signal<number | null>(null);
  notes = signal('');

  counted = computed(() => this.byNotes()
    ? Math.round(this.counts().reduce((sum, c, i) => sum + c * MZN_DENOMINATIONS[i], 0) * 100) / 100
    : (this.manual() ?? 0));
  difference = computed(() => Math.round((this.counted() - Number(this.r.cash.expected)) * 100) / 100);
  /** Acima da tolerância a diferença tem de ser justificada (e o servidor pede o gerente). */
  needsNotes = computed(() => !this.blind && Math.abs(this.difference()) > this.tolerance);
  private readonly tolerance: number;

  constructor(
    @Inject(MAT_DIALOG_DATA) data: { report: PosSessionReport; blind: boolean; tolerance: number },
    private ref: MatDialogRef<PosCloseDialogComponent, PosCloseResult>
  ) {
    this.r = data.report;
    this.blind = data.blind;
    this.tolerance = data.tolerance;
  }

  money(v: number) { return formatPosMoney(Number(v)); }
  date(iso: string) { return formatPosDate(iso); }

  setCount(index: number, value: number) {
    this.counts.update(list => list.map((c, i) => i === index ? Math.max(0, Math.floor(value)) : c));
  }

  close() {
    const denominations = this.byNotes()
      ? Object.fromEntries(MZN_DENOMINATIONS.map((d, i) => [String(d), this.counts()[i]]).filter(([, c]) => Number(c) > 0))
      : null;
    this.ref.close({ counted: this.counted(), denominations, notes: this.notes().trim() });
  }
}

// =====================================================================
// Autorização de gerente (o PIN é validado no servidor)
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
        <p class="text-sm text-slate-500 mt-1 mb-2">{{ data.reason }}</p>
        @if (data.error) { <p class="text-sm font-semibold text-rose-600 mb-2">{{ data.error }}</p> }
      </div>
      <div class="mt-3"><app-pos-pin-pad (completed)="ref.close($event)" /></div>
      <button mat-button class="w-full !mt-4" mat-dialog-close>{{ 'common.actions.cancel' | t }}</button>
    </div>
  `
})
export class PosAuthorizeDialogComponent {
  constructor(
    @Inject(MAT_DIALOG_DATA) public data: { reason: string; error?: string },
    public ref: MatDialogRef<PosAuthorizeDialogComponent, string | undefined>
  ) {}
}

// =====================================================================
// Motivo (anulação de linha enviada, anulação de FR, cancelar mesa)
// =====================================================================

@Component({
  selector: 'app-pos-reason-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, TranslatePipe],
  template: `
    <div class="p-6 w-full max-w-[420px]">
      <h2 class="!m-0 text-xl font-bold text-slate-900">{{ data.title }}</h2>
      @if (data.message) { <p class="text-sm text-slate-500 mt-1">{{ data.message }}</p> }
      <div class="flex flex-wrap gap-2 mt-4">
        @for (key of data.reasons; track key) {
          @let label = key | t;
          <button type="button" class="px-3 py-2 rounded-full border text-sm font-semibold"
            [class.border-ispc-orange]="reason() === label" [class.text-orange-700]="reason() === label" [class.border-slate-200]="reason() !== label"
            (click)="reason.set(label)">{{ label }}</button>
        }
      </div>
      <input type="text" class="w-full mt-3 px-4 py-3 rounded-xl border border-slate-200 text-base outline-none focus:border-ispc-orange"
        [placeholder]="'pos.reason.other' | t" [value]="reason()" (input)="reason.set($any($event.target).value)">
      <div class="flex gap-2 mt-6">
        <button mat-stroked-button class="flex-1 !h-12 !rounded-xl" mat-dialog-close>{{ 'common.actions.cancel' | t }}</button>
        <button mat-raised-button class="flex-1 !h-12 !rounded-xl !bg-rose-600 !text-white disabled:!opacity-50"
          [disabled]="reason().trim().length < 3" (click)="ref.close(reason().trim())">{{ data.confirm }}</button>
      </div>
    </div>
  `
})
export class PosReasonDialogComponent {
  reason = signal('');
  constructor(
    @Inject(MAT_DIALOG_DATA) public data: { title: string; message?: string; confirm: string; reasons: string[] },
    public ref: MatDialogRef<PosReasonDialogComponent, string>
  ) {}
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
  lines: { item_id: string; quantity: number }[];
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
        <p class="text-sm text-slate-500">{{ 'pos.refund.subtitle' | t: { number: doc.number } }}</p>
      </div>

      <div class="px-6 pb-4 overflow-y-auto">
        <div class="flex justify-end mb-1">
          <button type="button" class="text-xs font-semibold text-orange-700" (click)="all()">{{ 'pos.refund.all' | t }}</button>
        </div>
        <ul class="divide-y divide-slate-100 rounded-2xl border border-slate-200">
          @for (r of rows; track r.item.id; let i = $index) {
            <li class="flex items-center gap-3 px-3 py-2.5">
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-slate-800 truncate">{{ r.item.name }}</p>
                <p class="text-[11px] text-slate-400">{{ money(r.unit) }} · {{ 'pos.refund.max' | t: { count: r.max } }}</p>
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
  readonly doc: PosDocument;
  /** unit = valor líquido por unidade (já com a parte do desconto). */
  readonly rows: { item: PosDocument['items'][number]; max: number; unit: number }[];
  readonly methods = POS_PAYMENT_METHODS;
  readonly reasons = REFUND_REASONS;
  qty = signal<number[]>([]);
  method = signal<PosPaymentMethod>('cash');
  reason = signal(REFUND_REASONS[0]);
  total = computed(() => Math.round(this.rows.reduce((acc, r, i) => acc + r.unit * (this.qty()[i] ?? 0), 0) * 100) / 100);

  constructor(
    @Inject(MAT_DIALOG_DATA) data: { doc: PosDocument },
    private ref: MatDialogRef<PosRefundDialogComponent, PosRefundResult>
  ) {
    this.doc = data.doc;
    this.rows = data.doc.items
      .map(item => ({ item, max: Number(item.quantity) - Number(item.returned), unit: Number(item.total) / Number(item.quantity) }))
      .filter(r => r.max > 0);
    this.qty.set(this.rows.map(() => 0));
    const methods = [...new Set(data.doc.payments.filter(p => Number(p.amount) > 0).map(p => p.method))];
    this.method.set(methods.length === 1 ? methods[0] : 'cash');
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
      lines: this.rows.map((r, i) => ({ item_id: r.item.id, quantity: this.qty()[i] })).filter(l => l.quantity > 0),
      method: this.method(),
      reason: t(this.reason())
    });
  }
}

// =====================================================================
// Cliente com NUIT (pesquisar ou criar)
// =====================================================================

@Component({
  selector: 'app-pos-client-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, TranslatePipe],
  template: `
    <div class="p-6 w-full max-w-[460px]">
      <h2 class="!m-0 text-xl font-bold text-slate-900">{{ 'pos.client.title' | t }}</h2>
      <p class="text-sm text-slate-500 mt-1">{{ 'pos.client.hint' | t }}</p>

      <input type="search" class="w-full mt-4 px-4 py-3 rounded-xl border border-slate-200 text-base outline-none focus:border-ispc-orange"
        [placeholder]="'pos.client.search' | t" [value]="query()" (input)="onQuery($any($event.target).value)">
      <ul class="mt-2 max-h-56 overflow-y-auto divide-y divide-slate-100">
        @for (c of results(); track c.id) {
          <li>
            <button type="button" class="w-full text-left px-3 py-2.5 hover:bg-orange-50 rounded-lg" (click)="ref.close(c)">
              <span class="block text-sm font-semibold text-slate-800">{{ c.name }}</span>
              <span class="block text-xs text-slate-500">{{ c.nuit ? 'NUIT ' + c.nuit : ('pos.client.noNuit' | t) }}</span>
            </button>
          </li>
        }
      </ul>

      <p class="text-xs font-bold uppercase tracking-wider text-slate-400 mt-5 mb-2">{{ 'pos.client.new' | t }}</p>
      <div class="grid grid-cols-[1fr_9rem] gap-2">
        <input type="text" class="px-4 py-3 rounded-xl border border-slate-200 text-base outline-none focus:border-ispc-orange"
          [placeholder]="'pos.client.name' | t" [value]="name()" (input)="name.set($any($event.target).value)">
        <input type="text" inputmode="numeric" maxlength="9" class="px-4 py-3 rounded-xl border text-base outline-none focus:border-ispc-orange"
          [class.border-rose-400]="nuit().length > 0 && !validNuit()" [class.border-slate-200]="!nuit().length || validNuit()"
          placeholder="NUIT" [value]="nuit()" (input)="nuit.set($any($event.target).value.replace(/\\D/g, ''))">
      </div>
      @if (error()) { <p class="text-sm text-rose-600 mt-2">{{ error() }}</p> }

      <div class="flex gap-2 mt-6">
        <button mat-stroked-button class="flex-1 !h-12 !rounded-xl" mat-dialog-close>{{ 'common.actions.cancel' | t }}</button>
        <button mat-raised-button class="flex-1 !h-12 !rounded-xl !bg-ispc-orange !text-white disabled:!opacity-50"
          [disabled]="busy() || !validNuit()" (click)="create()">{{ 'pos.client.use' | t }}</button>
      </div>
    </div>
  `
})
export class PosClientDialogComponent {
  query = signal('');
  results = signal<PosClientRef[]>([]);
  name = signal('');
  nuit = signal('');
  busy = signal(false);
  error = signal<string | null>(null);
  validNuit = computed(() => isValidNuit(this.nuit()));
  private timer?: ReturnType<typeof setTimeout>;

  constructor(public ref: MatDialogRef<PosClientDialogComponent, PosClientRef>, private pos: PosService) {}

  onQuery(value: string) {
    this.query.set(value);
    clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      try { this.results.set(value.trim().length >= 2 ? await this.pos.searchClients(value) : []); }
      catch (e) { this.error.set(this.pos.handleError(e)); }
    }, 250);
  }

  async create() {
    this.busy.set(true);
    this.error.set(null);
    try {
      this.ref.close(await this.pos.createClient(this.name(), this.nuit()));
    } catch (e) {
      this.error.set(this.pos.handleError(e));
    } finally {
      this.busy.set(false);
    }
  }
}

// =====================================================================
// Pagamento M-Pesa / e-Mola (por agora simulado)
// =====================================================================

@Component({
  selector: 'app-pos-mobile-payment-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, TranslatePipe],
  template: `
    <div class="p-6 w-full max-w-[420px]">
      <div class="flex items-center justify-between">
        <h2 class="!m-0 text-xl font-bold text-slate-900">{{ 'pos.payment.methods.' + data.method | t }}</h2>
        <span class="px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold uppercase tracking-wide">{{ 'pos.mobile.simulation' | t }}</span>
      </div>
      <p class="text-3xl font-extrabold text-slate-900 mt-3">{{ money(data.amount) }}</p>

      @switch (request()?.status ?? 'new') {
        @case ('new') {
          <label class="block mt-5 rounded-2xl border border-slate-200 focus-within:border-ispc-orange px-4 py-3">
            <span class="text-[11px] font-bold uppercase tracking-wider text-slate-400">{{ 'pos.mobile.phone' | t }}</span>
            <input type="tel" inputmode="tel" autocomplete="off" class="w-full text-2xl font-bold outline-none bg-transparent"
              placeholder="84 123 4567" [value]="phone()" (input)="phone.set($any($event.target).value)" (keydown.enter)="start()">
          </label>
          <p class="text-xs text-slate-400 mt-2">{{ 'pos.mobile.simulationHint' | t }}</p>
          @if (error()) { <p class="text-sm text-rose-600 mt-2">{{ error() }}</p> }
          <div class="flex gap-2 mt-6">
            <button mat-stroked-button class="flex-1 !h-12 !rounded-xl" mat-dialog-close>{{ 'common.actions.cancel' | t }}</button>
            <button mat-raised-button class="flex-1 !h-12 !rounded-xl !bg-ispc-orange !text-white disabled:!opacity-50"
              [disabled]="busy() || phone().replace(/\\D/g, '').length < 9" (click)="start()">{{ 'pos.mobile.send' | t }}</button>
          </div>
        }
        @case ('pending') {
          <div class="mt-6 text-center">
            <div class="w-16 h-16 mx-auto rounded-full border-4 border-orange-200 border-t-ispc-orange animate-spin"></div>
            <p class="font-semibold text-slate-800 mt-4">{{ 'pos.mobile.waiting' | t }}</p>
            <p class="text-xs text-slate-500 mt-1">{{ request()?.phone }} · {{ request()?.reference }} · {{ secondsLeft() }} s</p>
          </div>
          <div class="grid grid-cols-2 gap-2 mt-6">
            <button mat-stroked-button class="!h-11 !rounded-xl !text-emerald-700" (click)="check('confirm')">{{ 'pos.mobile.simConfirm' | t }}</button>
            <button mat-stroked-button class="!h-11 !rounded-xl !text-rose-600" (click)="check('fail')">{{ 'pos.mobile.simFail' | t }}</button>
          </div>
          <button mat-button class="w-full !mt-2" (click)="cancel()">{{ 'common.actions.cancel' | t }}</button>
        }
        @case ('confirmed') {
          <div class="mt-6 text-center">
            <div class="w-16 h-16 mx-auto rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-2xl"><i class="fa-solid fa-check" aria-hidden="true"></i></div>
            <p class="font-semibold text-slate-800 mt-4">{{ 'pos.mobile.confirmed' | t }}</p>
            <p class="text-xs text-slate-500 mt-1">{{ request()?.transaction_id }}</p>
          </div>
        }
        @default {
          <div class="mt-6 text-center">
            <div class="w-16 h-16 mx-auto rounded-full bg-rose-100 text-rose-600 flex items-center justify-center text-2xl"><i class="fa-solid fa-xmark" aria-hidden="true"></i></div>
            <p class="font-semibold text-slate-800 mt-4">{{ request()?.failure_reason || ('pos.mobile.failed' | t) }}</p>
          </div>
          <div class="flex gap-2 mt-6">
            <button mat-stroked-button class="flex-1 !h-12 !rounded-xl" mat-dialog-close>{{ 'pos.mobile.otherMethod' | t }}</button>
            <button mat-raised-button class="flex-1 !h-12 !rounded-xl !bg-ispc-orange !text-white" (click)="retry()">{{ 'pos.mobile.retry' | t }}</button>
          </div>
        }
      }
    </div>
  `
})
export class PosMobilePaymentDialogComponent implements OnDestroy {
  phone = signal('');
  request = signal<PosPaymentRequest | null>(null);
  busy = signal(false);
  error = signal<string | null>(null);
  now = signal(Date.now());
  secondsLeft = computed(() => {
    const r = this.request();
    return r ? Math.max(0, Math.round((new Date(r.expires_at).getTime() - this.now()) / 1000)) : 0;
  });
  private poll?: ReturnType<typeof setInterval>;

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: { method: 'mpesa' | 'emola'; amount: number; onWaiting?: (waiting: boolean) => void },
    private ref: MatDialogRef<PosMobilePaymentDialogComponent, PosPaymentRequest>,
    private pos: PosService
  ) {
    ref.disableClose = true;
  }

  ngOnDestroy() {
    clearInterval(this.poll);
    this.data.onWaiting?.(false);
  }

  money(v: number) { return formatPosMoney(v); }

  async start() {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      this.request.set(await this.pos.requestMobilePayment(this.data.method, this.data.amount, this.phone()));
      this.data.onWaiting?.(true);
      this.poll = setInterval(() => { this.now.set(Date.now()); this.check(); }, 1500);
    } catch (e) {
      this.error.set(this.pos.handleError(e));
    } finally {
      this.busy.set(false);
    }
  }

  async check(simulate?: 'confirm' | 'fail') {
    const r = this.request();
    if (!r || r.status !== 'pending') return;
    try {
      const next = await this.pos.checkMobilePayment(r.id, simulate);
      this.request.set(next);
      if (next.status !== 'pending') {
        clearInterval(this.poll);
        this.data.onWaiting?.(false);
        if (next.status === 'confirmed') setTimeout(() => this.ref.close(next), 900);
      }
    } catch (e) {
      this.error.set(this.pos.handleError(e));
    }
  }

  async cancel() {
    const r = this.request();
    clearInterval(this.poll);
    if (r?.status === 'pending') {
      try { await this.pos.checkMobilePayment(r.id, 'cancel'); } catch { /* fecha na mesma */ }
    }
    this.ref.close();
  }

  retry() {
    this.request.set(null);
    this.error.set(null);
  }
}

// =====================================================================
// Dividir a conta da mesa (por artigos)
// =====================================================================

@Component({
  selector: 'app-pos-bill-split-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, TranslatePipe],
  template: `
    <div class="flex flex-col max-h-[90dvh] w-full max-w-[480px]">
      <div class="px-6 pt-6 pb-3 shrink-0">
        <h2 class="!m-0 text-xl font-bold text-slate-900">{{ 'pos.split.billTitle' | t }}</h2>
        <p class="text-sm text-slate-500">{{ 'pos.split.billHint' | t }}</p>
      </div>
      <ul class="px-6 overflow-y-auto divide-y divide-slate-100">
        @for (r of rows; track r.line.id; let i = $index) {
          <li class="flex items-center gap-3 py-2.5">
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-slate-800 truncate">{{ r.line.name }}</p>
              <p class="text-[11px] text-slate-400">{{ money(r.line.unit_price) }} · {{ 'pos.refund.max' | t: { count: r.max } }}</p>
            </div>
            <div class="flex items-center border border-slate-200 rounded-xl overflow-hidden">
              <button type="button" class="w-9 h-9 text-slate-500" (click)="setQty(i, qty()[i] - 1)" aria-label="−">−</button>
              <span class="w-8 text-center font-bold">{{ qty()[i] }}</span>
              <button type="button" class="w-9 h-9 text-slate-500" (click)="setQty(i, qty()[i] + 1)" aria-label="+">+</button>
            </div>
          </li>
        }
      </ul>
      <div class="shrink-0 px-6 pb-6 pt-3 border-t border-slate-100 mt-2">
        <div class="flex justify-between items-baseline mb-3">
          <span class="text-sm font-semibold text-slate-600">{{ 'pos.split.billPart' | t }}</span>
          <span class="text-2xl font-extrabold text-slate-900">{{ money(total()) }}</span>
        </div>
        <div class="flex gap-2">
          <button mat-stroked-button class="flex-1 !h-12 !rounded-xl" mat-dialog-close>{{ 'common.actions.cancel' | t }}</button>
          <button mat-raised-button class="flex-[2] !h-12 !rounded-xl !bg-ispc-orange !text-white disabled:!opacity-50"
            [disabled]="total() <= 0" (click)="confirm()">{{ 'pos.split.billConfirm' | t }}</button>
        </div>
      </div>
    </div>
  `
})
export class PosBillSplitDialogComponent {
  readonly rows: { line: PosOrderLine; max: number }[];
  qty = signal<number[]>([]);
  total = computed(() => Math.round(this.rows.reduce((acc, r, i) => acc + r.line.unit_price * (this.qty()[i] ?? 0), 0) * 100) / 100);

  constructor(
    @Inject(MAT_DIALOG_DATA) data: { lines: PosOrderLine[]; current: Record<string, number> | null },
    private ref: MatDialogRef<PosBillSplitDialogComponent, Record<string, number>>
  ) {
    this.rows = data.lines.map(line => ({ line, max: Math.round((line.quantity - line.paid_quantity) * 1000) / 1000 }));
    this.qty.set(this.rows.map(r => data.current?.[r.line.id] ?? 0));
  }

  money(v: number) { return formatPosMoney(v); }

  setQty(i: number, value: number) {
    this.qty.update(list => list.map((q, j) => j === i ? Math.max(0, Math.min(this.rows[i].max, value)) : q));
  }

  confirm() {
    this.ref.close(Object.fromEntries(this.rows.map((r, i) => [r.line.id, this.qty()[i]]).filter(([, q]) => Number(q) > 0)));
  }
}
