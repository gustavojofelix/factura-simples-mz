import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

/**
 * Estrutura comum dos diálogos: cabeçalho fixo, corpo com scroll e barra de
 * acções fixa em baixo. Funciona igual no desktop (diálogo centrado) e no
 * telemóvel (ecrã inteiro via ResponsiveDialogService).
 *
 * Slots:
 *  - [shellSubheader]  fica fixo logo abaixo do cabeçalho (passos, pesquisa);
 *  - conteúdo normal   vai para o corpo com scroll;
 *  - [shellFooter]     barra de acções fixa (só aparece com [footer]="true").
 */
@Component({
  selector: 'app-dialog-shell',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="shell-header" [class.has-back]="showBack()">
      @if (showBack()) {
        <button mat-icon-button type="button" (click)="back.emit()" [attr.aria-label]="'common.actions.back' | t">
          <mat-icon>arrow_back</mat-icon>
        </button>
      } @else if (icon()) {
        <mat-icon class="shell-icon">{{ icon() }}</mat-icon>
      }
      <div class="shell-titles">
        <h2 class="shell-title">{{ title() }}</h2>
        @if (subtitle()) {
          <p class="shell-subtitle">{{ subtitle() }}</p>
        }
      </div>
      <button mat-icon-button type="button" (click)="closed.emit()" [attr.aria-label]="'common.actions.close' | t">
        <mat-icon>close</mat-icon>
      </button>
    </header>

    <ng-content select="[shellSubheader]" />

    <div class="shell-body">
      <ng-content />
    </div>

    @if (footer()) {
      <footer class="shell-footer">
        <ng-content select="[shellFooter]" />
      </footer>
    }
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      max-height: 100%;
      min-height: 0;
      background: #fff;
      color: #0f172a;
    }
    @media (min-width: 600px) {
      :host { max-height: 90vh; }
    }
    .shell-header {
      flex: none;
      display: flex;
      align-items: center;
      gap: .5rem;
      min-height: 3.5rem;
      padding: .25rem .25rem .25rem 1rem;
      border-bottom: 1px solid #f1f5f9;
    }
    .shell-header.has-back { padding-left: .25rem; }
    .shell-icon { flex: none; color: #f16c39; }
    .shell-titles { flex: 1 1 auto; min-width: 0; }
    .shell-title {
      margin: 0;
      font-size: 1.05rem;
      font-weight: 700;
      line-height: 1.3;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .shell-subtitle { margin: 0; font-size: .75rem; color: #64748b; }
    .shell-body {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 1rem;
    }
    @media (min-width: 600px) {
      .shell-body { padding: 1.25rem 1.5rem; }
    }
    .shell-footer {
      flex: none;
      padding: .75rem 1rem;
      padding-bottom: max(.75rem, env(safe-area-inset-bottom));
      border-top: 1px solid #f1f5f9;
      background: #fff;
      box-shadow: 0 -4px 16px rgba(15, 23, 42, .04);
    }
    @media (min-width: 600px) {
      .shell-footer { padding: .875rem 1.5rem; }
    }
  `]
})
export class DialogShellComponent {
  readonly title = input.required<string>();
  readonly subtitle = input<string>('');
  readonly icon = input<string>('');
  /** Mostra a seta "voltar" no lugar do ícone (ex.: segundo passo). */
  readonly showBack = input(false);
  readonly footer = input(true);

  readonly back = output<void>();
  readonly closed = output<void>();
}
