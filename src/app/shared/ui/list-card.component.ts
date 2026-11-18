import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * Cartão de uma linha de lista no telemóvel (substitui a linha da tabela).
 *
 *  ┌──────────────────────────────────────────┐
 *  │ [lcLeading]  título            [lcAside] │ [lcActions]
 *  │              subtítulo                   │
 *  │ [lcFooter] ................................│
 *  └──────────────────────────────────────────┘
 *
 * Tocar no cartão emite (open). Toques dentro de [lcActions] não abrem o cartão.
 * Usar dentro de um contentor `.list-cards` (definido nos estilos globais).
 */
@Component({
  selector: 'app-list-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.lc-clickable]': 'clickable()',
    '[attr.role]': 'clickable() ? "button" : null',
    '[attr.tabindex]': 'clickable() ? 0 : null',
    '(click)': 'clickable() && open.emit()',
    '(keydown.enter)': 'clickable() && open.emit()'
  },
  template: `
    <div class="lc-top">
      <ng-content select="[lcLeading]" />
      <div class="lc-main">
        <p class="lc-title">{{ title() }}</p>
        @if (subtitle()) {
          <p class="lc-sub">{{ subtitle() }}</p>
        }
      </div>
      <div class="lc-aside"><ng-content select="[lcAside]" /></div>
      <div class="lc-actions" (click)="$event.stopPropagation()" (keydown.enter)="$event.stopPropagation()">
        <ng-content select="[lcActions]" />
      </div>
    </div>
    <ng-content select="[lcFooter]" />
  `,
  styles: [`
    :host {
      display: block;
      padding: .75rem .25rem .75rem .875rem;
      border: 1px solid #e2e8f0;
      border-radius: .875rem;
      background: #fff;
      -webkit-tap-highlight-color: transparent;
      transition: background .15s ease, border-color .15s ease;
    }
    :host(.lc-clickable) { cursor: pointer; }
    :host(.lc-clickable:active) { background: #fff7ed; border-color: #fed7aa; }
    :host(:focus-visible) { outline: 2px solid #f16c39; outline-offset: 2px; }
    .lc-top { display: flex; align-items: flex-start; gap: .75rem; }
    .lc-main { flex: 1 1 auto; min-width: 0; }
    .lc-title {
      margin: 0;
      font-weight: 700;
      color: #0f172a;
      line-height: 1.3;
      overflow-wrap: anywhere;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .lc-sub { margin: .125rem 0 0; font-size: .8rem; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .lc-aside { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: .25rem; text-align: right; }
    .lc-aside:empty, .lc-actions:empty { display: none; }
    .lc-actions { flex: none; margin: -.5rem 0 -.5rem -.5rem; }
  `]
})
export class ListCardComponent {
  readonly title = input.required<string>();
  readonly subtitle = input<string>('');
  readonly clickable = input(true);
  readonly open = output<void>();
}
