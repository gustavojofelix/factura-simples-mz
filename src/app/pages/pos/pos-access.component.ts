import { Component, computed, input, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { PosSeller, PosService } from '../../core/services/pos.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { PosPinPadComponent } from './pos-pin-pad.component';
import { formatPosDate, formatPosMoney } from './pos-format';

type Step = 'operator' | 'pin' | 'float';

/**
 * Entrada no POS sem login: escolher operador + PIN.
 * mode='open' abre a sessão de caixa (pede o fundo de caixa); mode='unlock' desbloqueia/troca de operador.
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
            <i class="fa-solid" [class.fa-cash-register]="mode() === 'open'" [class.fa-lock]="mode() === 'unlock'" aria-hidden="true"></i>
          </span>
          <h2 class="!m-0 !mt-4 text-2xl font-extrabold text-slate-900">
            {{ (mode() === 'open' ? 'pos.access.openTitle' : 'pos.access.unlockTitle') | t }}
          </h2>
          <p class="text-slate-500 mt-1">{{ pos.store.name }} · {{ pos.settings().terminal_name }}</p>
          @if (mode() === 'unlock' && pos.currentSession(); as s) {
            <p class="text-xs text-slate-400 mt-1">{{ 'pos.access.sessionOpenSince' | t: { number: s.number, date: date(s.opened_at) } }}</p>
          }
        </div>

        <div class="bg-white rounded-3xl border border-slate-200 shadow-xl shadow-slate-200/60 p-5 sm:p-7">
          @switch (step()) {
            @case ('operator') {
              <p class="text-sm font-semibold text-slate-500 mb-3">{{ 'pos.access.chooseOperator' | t }}</p>
              <div class="grid grid-cols-2 gap-3">
                @for (s of pos.sellers(); track s.id) {
                  <button type="button" class="op-card" (click)="choose(s)">
                    <span class="w-12 h-12 rounded-full text-white font-bold flex items-center justify-center" [style.background]="s.color">{{ initials(s.name) }}</span>
                    <span class="font-semibold text-slate-800 text-sm leading-tight text-center">{{ s.name }}</span>
                    <span class="text-[11px] text-slate-400">{{ 'pos.roles.' + s.role | t }}</span>
                  </button>
                }
              </div>
            }
            @case ('pin') {
              <button type="button" class="flex items-center gap-2 text-sm text-slate-500 mb-5" (click)="step.set('operator')">
                <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>
                <span class="w-7 h-7 rounded-full text-white text-[11px] font-bold flex items-center justify-center" [style.background]="seller()?.color">{{ initials(seller()?.name) }}</span>
                <span class="font-semibold text-slate-800">{{ seller()?.name }}</span>
              </button>
              <p class="text-center text-sm font-semibold text-slate-500 mb-4">{{ 'pos.access.enterPin' | t }}</p>
              <app-pos-pin-pad (completed)="checkPin($event)" />
            }
            @case ('float') {
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
              <button mat-raised-button class="w-full !h-14 !mt-6 !rounded-2xl !text-base !font-bold !bg-ispc-orange !text-white" (click)="openSession()">
                <mat-icon>lock_open</mat-icon>
                {{ 'pos.access.openSession' | t }}
              </button>
            }
          }
        </div>

        <p class="text-center text-xs text-slate-400 mt-5">
          <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
          {{ 'pos.access.demoPins' | t: { pins: demoPins() } }}
        </p>
      </div>
    </div>
  `,
  styles: [`
    .op-card {
      display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 16px 10px;
      border-radius: 20px; border: 1px solid #e2e8f0; background: #fff; touch-action: manipulation;
      transition: border-color .15s ease, transform .08s ease;
    }
    .op-card:hover { border-color: #f16c39; }
    .op-card:active { transform: scale(.97); }
  `]
})
export class PosAccessComponent {
  mode = input<'open' | 'unlock'>('open');

  readonly floatPresets = [0, 500, 1000, 2000, 5000];
  step = signal<Step>('operator');
  seller = signal<PosSeller | undefined>(undefined);
  float = signal(1000);

  private pinPad = viewChild(PosPinPadComponent);

  demoPins = computed(() => this.pos.sellers().map(s => `${s.name.split(' ')[0]} ${s.pin}`).join(' · '));

  constructor(public pos: PosService) {}

  money(v: number) { return formatPosMoney(v); }
  date(iso: string) { return formatPosDate(iso); }

  initials(name: string | undefined): string {
    const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
    return parts.length ? (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() : '?';
  }

  choose(seller: PosSeller) {
    this.seller.set(seller);
    this.step.set('pin');
  }

  checkPin(pin: string) {
    const seller = this.seller();
    if (!seller || !this.pos.verifyPin(seller.id, pin)) {
      this.pinPad()?.reject();
      return;
    }
    if (this.mode() === 'unlock') this.pos.unlock(seller.id);
    else this.step.set('float');
  }

  onFloat(event: Event) {
    const value = Number((event.target as HTMLInputElement).value);
    this.float.set(Number.isFinite(value) ? Math.max(0, value) : 0);
  }

  openSession() {
    const seller = this.seller();
    if (seller) this.pos.openSession(seller.id, this.float());
  }
}
