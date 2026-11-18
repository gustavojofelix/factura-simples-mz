import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenu, MatMenuModule } from '@angular/material/menu';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

/**
 * Cabeçalho das páginas de lista (Facturas, Clientes, Produtos...).
 *
 * Desktop: título à esquerda, acções secundárias + principal à direita.
 * Telemóvel: título + botão "⋮" (abre `moreMenu`, com as acções secundárias)
 * e a acção principal a toda a largura por baixo. As acções secundárias
 * projectadas em [headerActions] ficam escondidas no telemóvel.
 *
 * Slots: [headerActions] acções secundárias (desktop), [headerPrimary] acção principal.
 */
@Component({
  selector: 'app-page-header',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatMenuModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ph">
      <div class="ph-titles">
        <h1 class="ph-title">{{ title() }}</h1>
        @if (subtitle()) {
          <p class="ph-sub">{{ subtitle() }}</p>
        }
      </div>

      @if (moreMenu(); as menu) {
        <button mat-icon-button type="button" class="ph-more" [matMenuTriggerFor]="menu" [attr.aria-label]="'common.ui.moreActions' | t">
          <mat-icon>more_vert</mat-icon>
        </button>
      }

      <div class="ph-actions">
        <div class="ph-secondary"><ng-content select="[headerActions]" /></div>
        <div class="ph-primary"><ng-content select="[headerPrimary]" /></div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; margin-bottom: 1.25rem; }
    .ph {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas:
        "titles more"
        "actions actions";
      align-items: center;
      gap: .75rem;
    }
    .ph-titles { grid-area: titles; min-width: 0; }
    .ph-title {
      margin: 0;
      font-size: 1.5rem;
      line-height: 1.2;
      font-weight: 800;
      letter-spacing: -.01em;
      color: #0f172a;
    }
    .ph-sub { margin: .25rem 0 0; font-size: .85rem; color: #64748b; overflow-wrap: anywhere; }
    .ph-more { grid-area: more; align-self: start; margin-right: -.5rem; }
    .ph-actions { grid-area: actions; display: flex; align-items: center; gap: .5rem; min-width: 0; }
    .ph-secondary { display: none; }
    .ph-primary { flex: 1; display: flex; }
    .ph-primary ::ng-deep > * { flex: 1; height: 3rem !important; border-radius: .75rem !important; }

    @media (min-width: 600px) {
      .ph {
        grid-template-columns: minmax(0, 1fr) auto;
        grid-template-areas: "titles actions";
        gap: 1rem;
      }
      .ph-title { font-size: 1.875rem; }
      .ph-more { display: none; }
      .ph-secondary { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: .5rem; }
      .ph-primary { flex: none; }
      .ph-primary ::ng-deep > * { flex: none; }
    }
    /* Tablet: com muitos botões secundários, a linha de acções desce para baixo do título. */
    @media (min-width: 600px) and (max-width: 1023.98px) {
      .ph { grid-template-columns: 1fr; grid-template-areas: "titles" "actions"; }
      .ph-actions { justify-content: flex-start; flex-wrap: wrap; }
      .ph-secondary { justify-content: flex-start; }
    }
  `]
})
export class PageHeaderComponent {
  readonly title = input.required<string>();
  readonly subtitle = input<string>('');
  /** Menu com as acções secundárias, mostrado no telemóvel através do botão "⋮". */
  readonly moreMenu = input<MatMenu | null>(null);
}
