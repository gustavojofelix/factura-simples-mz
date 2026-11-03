import { Component, computed, input, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { PosService, PosStaffSummary } from '../../core/services/pos.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { PosPinPadComponent } from './pos-pin-pad.component';
import { formatPosDate, formatPosMoney } from './pos-format';

/**
 * Entrada no terminal:
 *  - pair:   dispositivo ainda não emparelhado → código gerado em Ponto de Venda → Terminais
 *  - login:  escolher o operador e o PIN (validado no servidor)
 *  - open:   operador entrou mas a caixa está fechada → fundo de caixa e abrir
 */
@Component({
  selector: 'app-pos-access',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, TranslatePipe, PosPinPadComponent],
  template: `
    <div class="min-h-full flex items-center justify-center p-4 sm:p-8">
      <div class="w-full max-w-[520px]">
        <div class="text-center mb-6">
          <span class="inline-flex w-14 h-14 rounded-2xl bg-ispc-orange text-white items-center justify-center text-2xl shadow-lg shadow-orange-200">
            <i class="fa-solid" [class.fa-link]="mode() === 'pair'" [class.fa-lock]="mode() === 'login'" [class.fa-cash-register]="mode() === 'open'" aria-hidden="true"></i>
          </span>
          <h2 class="!m-0 !mt-4 text-2xl font-extrabold text-slate-900">{{ 'pos.access.' + mode() + 'Title' | t }}</h2>
          @if (mode() === 'pair') {
            <p class="text-slate-500 mt-1">{{ 'pos.access.pairHint' | t }}</p>
          } @else {
            <p class="text-slate-500 mt-1">{{ pos.info()?.company?.name }} · {{ pos.terminal()?.name }}</p>
            @if (pos.info()?.open_session; as s) {
              <p class="text-xs text-slate-400 mt-1">{{ 'pos.access.sessionOpenSince' | t: { number: s.number, date: date(s.opened_at) } }}</p>
            }
          }
        </div>

        @if (graceWarning(); as until) {
          <div class="mb-4 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800 flex gap-2">
            <i class="fa-solid fa-triangle-exclamation mt-0.5" aria-hidden="true"></i>
            <span>{{ 'pos.access.grace' | t: { date: until } }}</span>
          </div>
        }

        <div class="bg-white rounded-3xl border border-slate-200 shadow-xl shadow-slate-200/60 p-5 sm:p-7">
          @switch (mode()) {
            @case ('pair') {
              <label class="block rounded-2xl border border-slate-200 focus-within:border-ispc-orange px-4 py-3">
                <span class="text-[11px] font-bold uppercase tracking-wider text-slate-400">{{ 'pos.access.pairCode' | t }}</span>
                <input type="text" autocomplete="off" autocapitalize="characters" maxlength="9" placeholder="XXXX-XXXX"
                  class="w-full text-3xl font-extrabold tracking-[.2em] uppercase text-slate-900 outline-none bg-transparent"
                  [value]="code()" (input)="code.set($any($event.target).value)" (keydown.enter)="pair()">
              </label>
              @if (error()) { <p class="text-sm text-rose-600 mt-3">{{ error() }}</p> }
              <button mat-raised-button class="w-full !h-14 !mt-5 !rounded-2xl !text-base !font-bold !bg-ispc-orange !text-white disabled:!opacity-50"
                [disabled]="busy() || code().replace('-', '').trim().length !== 8" (click)="pair()">
                <mat-icon>link</mat-icon>
                {{ 'pos.access.pair' | t }}
              </button>
              <p class="text-xs text-slate-400 mt-4 text-center">{{ 'pos.access.pairWhere' | t }}</p>
            }
            @case ('login') {
              @if (!staff()) {
                <p class="text-sm font-semibold text-slate-500 mb-3">{{ 'pos.access.chooseOperator' | t }}</p>
                @if ((pos.info()?.staff ?? []).length === 0) {
                  <p class="text-sm text-slate-500">{{ 'pos.access.noStaff' | t }}</p>
                }
                <div class="grid grid-cols-2 gap-3">
                  @for (s of pos.info()?.staff ?? []; track s.id) {
                    <button type="button" class="op-card" [disabled]="!s.has_pin" (click)="choose(s)">
                      <span class="w-12 h-12 rounded-full text-white font-bold flex items-center justify-center" [style.background]="s.color">{{ initials(s.name) }}</span>
                      <span class="font-semibold text-slate-800 text-sm leading-tight text-center">{{ s.name }}</span>
                      <span class="text-[11px]" [class.text-slate-400]="s.has_pin && !s.locked" [class.text-rose-500]="!s.has_pin || s.locked">
                        {{ (!s.has_pin ? 'pos.access.noPin' : s.locked ? 'pos.access.locked' : 'pos.roles.' + s.role) | t }}
                      </span>
                    </button>
                  }
                </div>
              } @else {
                <button type="button" class="flex items-center gap-2 text-sm text-slate-500 mb-5" (click)="back()">
                  <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>
                  <span class="w-7 h-7 rounded-full text-white text-[11px] font-bold flex items-center justify-center" [style.background]="staff()?.color">{{ initials(staff()?.name) }}</span>
                  <span class="font-semibold text-slate-800">{{ staff()?.name }}</span>
                </button>
                <p class="text-center text-sm font-semibold text-slate-500 mb-4">{{ 'pos.access.enterPin' | t }}</p>
                <app-pos-pin-pad [disabled]="busy()" (completed)="checkPin($event)" />
                @if (error()) { <p class="text-center text-sm text-rose-600 mt-4">{{ error() }}</p> }
              }
            }
            @case ('open') {
              <p class="text-sm font-semibold text-slate-500 mb-1">{{ 'pos.access.openingFloat' | t }}</p>
              <p class="text-xs text-slate-400 mb-4">{{ 'pos.access.openingFloatHint' | t }}</p>
              <label class="block rounded-2xl border border-slate-200 focus-within:border-ispc-orange px-4 py-3">
                <span class="text-[11px] font-bold uppercase tracking-wider text-slate-400">MZN</span>
                <input type="number" inputmode="decimal" min="0" step="0.01" class="w-full text-3xl font-extrabold text-slate-900 outline-none bg-transparent"
                  [value]="float()" (input)="onFloat($event)">
              </label>
              <div class="flex flex-wrap gap-2 mt-3">
                @for (v of floatPresets; track v) {
                  <button type="button" class="px-3 py-2 rounded-full border text-sm font-semibold"
                    [class.border-ispc-orange]="float() === v" [class.text-orange-700]="float() === v" [class.border-slate-200]="float() !== v"
                    (click)="float.set(v)">{{ money(v) }}</button>
                }
              </div>
              @if (error()) { <p class="text-sm text-rose-600 mt-3">{{ error() }}</p> }
              <button mat-raised-button class="w-full !h-14 !mt-6 !rounded-2xl !text-base !font-bold !bg-ispc-orange !text-white disabled:!opacity-50"
                [disabled]="busy()" (click)="openSession()">
                <mat-icon>lock_open</mat-icon>
                {{ 'pos.access.openSession' | t }}
              </button>
              <button mat-button class="w-full !mt-2" (click)="pos.lock()">{{ 'pos.access.switchOperator' | t }}</button>
            }
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .op-card {
      display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 16px 10px;
      border-radius: 20px; border: 1px solid #e2e8f0; background: #fff; touch-action: manipulation;
      transition: border-color .15s ease, transform .08s ease;
    }
    .op-card:hover:not(:disabled) { border-color: #f16c39; }
    .op-card:disabled { opacity: .55; }
    .op-card:active { transform: scale(.97); }
  `]
})
export class PosAccessComponent {
  mode = input<'pair' | 'login' | 'open'>('login');

  readonly floatPresets = [0, 500, 1000, 2000, 5000];
  staff = signal<PosStaffSummary | null>(null);
  code = signal('');
  float = signal(1000);
  busy = signal(false);
  error = signal<string | null>(null);

  private pinPad = viewChild(PosPinPadComponent);

  /** Subscrição expirada, ainda dentro da tolerância do POS. */
  graceWarning = computed(() => {
    const access = this.pos.access() ?? this.pos.info()?.access;
    return access?.in_grace && access.grace_until ? formatPosDate(access.grace_until).split(/[ ,]/)[0] : null;
  });

  constructor(public pos: PosService) {
    const preset = pos.company()?.settings?.cash?.default_float;
    if (typeof preset === 'number') this.float.set(preset);
  }

  money(v: number) { return formatPosMoney(v); }
  date(iso: string) { return formatPosDate(iso); }

  initials(name: string | undefined): string {
    const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
    return parts.length ? (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() : '?';
  }

  async pair() {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.pos.pair(this.code());
    } catch (e) {
      this.error.set(this.pos.handleError(e));
    } finally {
      this.busy.set(false);
    }
  }

  choose(staff: PosStaffSummary) {
    this.error.set(null);
    this.staff.set(staff);
  }

  back() {
    this.error.set(null);
    this.staff.set(null);
  }

  async checkPin(pin: string) {
    const staff = this.staff();
    if (!staff || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const error = await this.pos.login(staff.id, pin);
      if (error) {
        this.error.set(error);
        this.pinPad()?.reject();
      }
    } catch (e) {
      this.error.set(this.pos.handleError(e));
      this.pinPad()?.reject();
    } finally {
      this.busy.set(false);
    }
  }

  onFloat(event: Event) {
    const value = Number((event.target as HTMLInputElement).value);
    this.float.set(Number.isFinite(value) ? Math.max(0, value) : 0);
  }

  async openSession() {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.pos.openSession(this.float());
    } catch (e) {
      this.error.set(this.pos.handleError(e));
    } finally {
      this.busy.set(false);
    }
  }
}
