import { Component, Inject, computed, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import {
  MZN_DENOMINATIONS,
  PosDocumentType,
  PosMode,
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
  readonly documents: PosDocumentType[] = ['VD', 'FR'];
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
