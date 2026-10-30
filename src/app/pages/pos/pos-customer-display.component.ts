import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { formatPosMoney } from './pos-format';
import { POS_DISPLAY_CHANNEL, PosDisplayMessage, PosDisplayState } from './pos-display';

type DisplayState = PosDisplayState;

/** Ecrã virado para o cliente (2º monitor): artigos, total e troco, em letra grande. */
@Component({
  selector: 'app-pos-customer-display',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  template: `
    <div class="display" (dblclick)="fullscreen()">
      @if (state(); as s) {
        @if (s.paid) {
          <div class="center">
            <div class="check"><i class="fa-solid fa-check" aria-hidden="true"></i></div>
            <h1>{{ 'pos.display.thanks' | t }}</h1>
            <p class="muted">{{ s.paid.number }} · {{ money(s.paid.total) }}</p>
            @if (s.paid.change > 0) {
              <p class="change-label">{{ 'pos.payment.change' | t }}</p>
              <p class="change">{{ money(s.paid.change) }}</p>
            }
            <p class="store">{{ s.store }}</p>
          </div>
        } @else if (s.lines.length === 0) {
          <div class="center">
            <img src="assets/ispc-facil-logo.png" alt="" class="logo">
            <h1>{{ 'pos.display.welcome' | t }}</h1>
            <p class="store">{{ s.store }}</p>
          </div>
        } @else {
          <div class="grid">
            <section class="lines">
              <header>
                <span>{{ s.store }}</span>
                @if (s.table) { <span class="pill">{{ 'pos.tables.table' | t }} {{ s.table }}</span> }
              </header>
              <ul>
                @for (l of s.lines; track $index) {
                  <li [class.last]="$last">
                    <span class="qty">{{ l.quantity }}×</span>
                    <span class="name">{{ l.name }}</span>
                    <span class="amount">{{ money(l.total) }}</span>
                  </li>
                }
              </ul>
            </section>
            <aside class="total">
              @if (s.totals.discount > 0) {
                <p class="muted">{{ 'pos.discount.label' | t }} −{{ money(s.totals.discount) }}</p>
              }
              <p class="muted">{{ 'pos.cart.tax' | t }} {{ money(s.totals.tax_total) }}</p>
              <p class="total-label">{{ 'pos.cart.total' | t }}</p>
              <p class="total-value">{{ money(s.totals.total) }}</p>
              <p class="count">{{ 'pos.cart.items' | t: { count: count() } }}</p>
            </aside>
          </div>
        }
      } @else {
        <div class="center">
          <img src="assets/ispc-facil-logo.png" alt="" class="logo">
          <p class="muted">{{ 'pos.display.waiting' | t }}</p>
        </div>
      }
    </div>
  `,
  styles: [`
    .display { height: 100vh; height: 100dvh; background: #0f172a; color: #fff; font-family: Inter, system-ui, sans-serif; overflow: hidden; cursor: default; }
    .center { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 4vh 4vw; }
    .logo { width: min(28vh, 260px); border-radius: 32px; background: #fff; margin-bottom: 4vh; }
    h1 { font-family: Inter, system-ui, sans-serif; font-size: clamp(32px, 7vh, 72px); font-weight: 800; line-height: 1.15; margin: 0 0 1.5vh; }
    .muted { color: #94a3b8; font-size: clamp(16px, 2.6vh, 24px); margin: 6px 0; }
    .store { margin-top: 4vh; color: #f16c39; font-weight: 700; font-size: clamp(16px, 3vh, 28px); }
    .check { width: 14vh; height: 14vh; border-radius: 50%; background: #22c55e; display: flex; align-items: center; justify-content: center; font-size: 7vh; margin-bottom: 3vh; }
    .change-label { margin-top: 4vh; color: #86efac; font-size: clamp(18px, 3vh, 28px); font-weight: 700; text-transform: uppercase; letter-spacing: .1em; }
    .change { font-size: clamp(48px, 13vh, 140px); font-weight: 900; color: #4ade80; margin: 0; }
    .grid { height: 100%; display: grid; grid-template-columns: 1.4fr 1fr; }
    @media (max-aspect-ratio: 1/1) { .grid { grid-template-columns: 1fr; grid-template-rows: 1fr auto; } }
    .lines { display: flex; flex-direction: column; min-height: 0; padding: 4vh 3vw; }
    .lines header { display: flex; justify-content: space-between; align-items: center; color: #f16c39; font-weight: 800; font-size: clamp(16px, 3vh, 28px); margin-bottom: 2vh; }
    .pill { background: #f16c39; color: #fff; padding: 4px 14px; border-radius: 999px; }
    ul { list-style: none; margin: 0; padding: 0; overflow: hidden; display: flex; flex-direction: column; justify-content: flex-end; flex: 1; }
    li { display: flex; gap: 1.2vw; align-items: baseline; padding: 1.4vh 0; border-bottom: 1px solid #1e293b; font-size: clamp(16px, 3.2vh, 32px); }
    li.last { color: #fdba74; }
    .qty { color: #94a3b8; min-width: 3.5em; }
    .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .amount { font-weight: 700; }
    .total { background: #f16c39; display: flex; flex-direction: column; justify-content: center; align-items: flex-end; padding: 4vh 3vw; text-align: right; }
    .total .muted { color: #ffe4d6; }
    .total-label { font-size: clamp(20px, 4vh, 40px); font-weight: 700; margin: 2vh 0 0; }
    .total-value { font-size: clamp(44px, 12vh, 130px); font-weight: 900; line-height: 1; margin: 1vh 0; letter-spacing: -.02em; }
    .count { color: #ffe4d6; font-size: clamp(16px, 2.6vh, 24px); }
  `]
})
export class PosCustomerDisplayComponent implements OnInit, OnDestroy {
  state = signal<DisplayState | null>(null);
  count = computed(() => this.state()?.lines.reduce((acc, l) => acc + l.quantity, 0) ?? 0);
  private channel?: BroadcastChannel;

  ngOnInit() {
    document.title = 'ISPC Fácil POS — Cliente';
    if (typeof BroadcastChannel === 'undefined') return;
    this.channel = new BroadcastChannel(POS_DISPLAY_CHANNEL);
    this.channel.onmessage = (event: MessageEvent<PosDisplayMessage>) => {
      if (event.data.kind === 'state') this.state.set(event.data);
    };
    // Pede o estado actual ao POS (caso a janela abra a meio de uma venda).
    this.channel.postMessage({ kind: 'hello' } satisfies PosDisplayMessage);
  }

  ngOnDestroy() {
    this.channel?.close();
  }

  money(v: number) { return formatPosMoney(v); }

  fullscreen() {
    document.documentElement.requestFullscreen?.().catch(() => {});
  }
}
