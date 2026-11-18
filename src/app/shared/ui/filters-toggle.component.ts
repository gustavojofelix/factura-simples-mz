import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

/**
 * Botão "Filtros (n)" que só aparece no telemóvel. Usar com a classe global
 * `.m-filters` no contentor dos filtros:
 *
 *   <app-filters-toggle [(open)]="filtersOpen" [count]="activeFilters()" />
 *   <div class="m-filters" [class.is-open]="filtersOpen()">
 *     <campo de pesquisa class="m-filter-keep"> ...outros filtros...
 *   </div>
 *
 * No telemóvel, com o painel fechado, só os elementos `.m-filter-keep` ficam visíveis.
 */
@Component({
  selector: 'app-filters-toggle',
  standalone: true,
  imports: [MatIconModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="ft" [class.ft-open]="open()" (click)="open.set(!open())" [attr.aria-expanded]="open()">
      <mat-icon>tune</mat-icon>
      <span>{{ 'common.actions.filter' | t }}</span>
      @if (count() > 0) {
        <span class="ft-count">{{ count() }}</span>
      }
      <mat-icon class="ft-chevron">{{ open() ? 'expand_less' : 'expand_more' }}</mat-icon>
    </button>
  `,
  styles: [`
    :host { display: block; }
    @media (min-width: 600px) { :host { display: none; } }
    .ft {
      display: flex;
      align-items: center;
      gap: .5rem;
      width: 100%;
      min-height: 2.75rem;
      padding: 0 .75rem;
      border: 1px solid #e2e8f0;
      border-radius: .75rem;
      background: #f8fafc;
      color: #334155;
      font-weight: 600;
      font-size: .9rem;
    }
    .ft-open { border-color: #fdba74; background: #fff7ed; }
    .ft-count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 1.25rem;
      height: 1.25rem;
      padding: 0 .3rem;
      border-radius: 9999px;
      background: #f16c39;
      color: #fff;
      font-size: .7rem;
      font-weight: 700;
    }
    .ft-chevron { margin-left: auto; color: #94a3b8; }
  `]
})
export class FiltersToggleComponent {
  readonly open = model(false);
  readonly count = input(0);
}
