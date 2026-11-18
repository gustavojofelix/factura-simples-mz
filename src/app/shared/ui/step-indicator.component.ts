import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

/**
 * Indicador de passos compacto: "Passo 1 de 2 · Cliente" + barra segmentada.
 * Substitui o mat-stepper horizontal, cujos rótulos não cabem no telemóvel.
 */
@Component({
  selector: 'app-step-indicator',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="steps" role="group" [attr.aria-label]="'common.ui.stepOf' | t: { current: current(), total: total() }">
      <p class="steps-text">
        <span class="steps-count">{{ 'common.ui.stepOf' | t: { current: current(), total: total() } }}</span>
        <span class="steps-sep">·</span>
        <span class="steps-label">{{ label() }}</span>
      </p>
      <div class="steps-bar">
        @for (s of segments(); track s) {
          <span class="steps-seg" [class.done]="s <= current()"></span>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; flex: none; }
    .steps { padding: .625rem 1rem .75rem; border-bottom: 1px solid #f1f5f9; }
    @media (min-width: 600px) { .steps { padding: .75rem 1.5rem; } }
    .steps-text { display: flex; gap: .375rem; align-items: baseline; margin: 0 0 .5rem; font-size: .8rem; min-width: 0; }
    .steps-count { flex: none; font-weight: 700; color: #f16c39; }
    .steps-sep { color: #cbd5e1; }
    .steps-label { color: #334155; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .steps-bar { display: flex; gap: .25rem; }
    .steps-seg { flex: 1; height: .25rem; border-radius: 9999px; background: #e2e8f0; transition: background .2s ease; }
    .steps-seg.done { background: #f16c39; }
  `]
})
export class StepIndicatorComponent {
  readonly current = input.required<number>();
  readonly total = input.required<number>();
  readonly label = input<string>('');

  readonly segments = computed(() => Array.from({ length: this.total() }, (_, i) => i + 1));
}
