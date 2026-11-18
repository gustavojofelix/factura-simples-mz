import { ChangeDetectionStrategy, Component, Injectable, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';
import { ResponsiveDialogService } from '../../core/services/responsive-dialog.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { isCompactViewport } from '../../core/utils/viewport';
import { DialogShellComponent } from './dialog-shell.component';

export interface PickerOption<V = string> {
  value: V;
  label: string;
  /** Segunda linha, ex.: NUIT · telefone. */
  sublabel?: string;
  /** Texto à direita, ex.: preço. */
  trailing?: string;
  /** Texto extra usado só na pesquisa (código, código de barras, descrição...). */
  keywords?: string;
}

export interface PickerConfig<V = string> {
  title: string;
  options: PickerOption<V>[];
  selected?: V | null;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Mostra um botão "criar" no fundo (ex.: "Novo cliente"). */
  createLabel?: string;
}

export type PickerResult<V = string> =
  | { type: 'select'; option: PickerOption<V> }
  | { type: 'create' };

/** Quantas linhas mostrar de cada vez; o resto encontra-se pela pesquisa. */
const RENDER_LIMIT = 100;

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

@Component({
  selector: 'app-search-picker-sheet',
  standalone: true,
  imports: [DialogShellComponent, MatButtonModule, MatIconModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-dialog-shell [title]="data.title" icon="search" [footer]="!!data.createLabel" (closed)="ref.close()">
      <div shellSubheader class="picker-search">
        <mat-icon class="picker-search-icon">search</mat-icon>
        <input
          #searchInput
          type="search"
          class="picker-search-input"
          [placeholder]="data.searchPlaceholder || ('common.ui.searchPlaceholder' | t)"
          [value]="term()"
          (input)="term.set(searchInput.value)"
          enterkeyhint="search"
          autocomplete="off"
        >
        @if (term()) {
          <button type="button" class="picker-clear" (click)="term.set(''); searchInput.focus()" [attr.aria-label]="'common.actions.clearFilters' | t">
            <mat-icon>close</mat-icon>
          </button>
        }
      </div>

      @if (visible().length === 0) {
        <p class="picker-empty">{{ data.emptyText || ('common.ui.noResults' | t) }}</p>
      } @else {
        <ul class="picker-list" role="listbox">
          @for (option of visible(); track $index) {
            <li>
              <button type="button" role="option" class="picker-row"
                [class.is-selected]="option.value === data.selected"
                [attr.aria-selected]="option.value === data.selected"
                (click)="choose(option)">
                <span class="picker-row-text">
                  <span class="picker-row-label">{{ option.label }}</span>
                  @if (option.sublabel) {
                    <span class="picker-row-sub">{{ option.sublabel }}</span>
                  }
                </span>
                @if (option.trailing) {
                  <span class="picker-row-trailing">{{ option.trailing }}</span>
                }
                @if (option.value === data.selected) {
                  <mat-icon class="picker-row-check">check</mat-icon>
                }
              </button>
            </li>
          }
        </ul>
        @if (filtered().length > visible().length) {
          <p class="picker-more">{{ 'common.ui.moreResults' | t: { shown: visible().length, total: filtered().length } }}</p>
        }
      }

      <div shellFooter>
        <button mat-stroked-button type="button" class="picker-create" (click)="ref.close({ type: 'create' })">
          <mat-icon>add</mat-icon>
          {{ data.createLabel }}
        </button>
      </div>
    </app-dialog-shell>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .picker-search {
      flex: none;
      position: relative;
      display: flex;
      align-items: center;
      margin: .75rem 1rem;
      border: 1px solid #cbd5e1;
      border-radius: .75rem;
      background: #f8fafc;
    }
    @media (min-width: 600px) { .picker-search { margin: .75rem 1.5rem; } }
    .picker-search:focus-within { border-color: #f16c39; box-shadow: 0 0 0 3px rgba(241, 108, 57, .12); background: #fff; }
    .picker-search-icon { margin-left: .75rem; color: #94a3b8; flex: none; }
    .picker-search-input {
      flex: 1;
      min-width: 0;
      height: 3rem;
      min-height: 3rem;
      padding: 0 .5rem;
      border: 0;
      outline: none;
      background: transparent;
      color: #0f172a;
    }
    .picker-search-input::-webkit-search-cancel-button { display: none; }
    .picker-clear {
      flex: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 3rem;
      height: 3rem;
      color: #64748b;
    }
    .picker-list { margin: -.25rem -1rem; padding: 0; list-style: none; }
    @media (min-width: 600px) { .picker-list { margin: -.5rem -1.5rem; } }
    .picker-row {
      display: flex;
      align-items: center;
      gap: .75rem;
      width: 100%;
      min-height: 3.5rem;
      padding: .625rem 1rem;
      border-bottom: 1px solid #f1f5f9;
      text-align: left;
      background: transparent;
      transition: background .15s ease;
    }
    @media (min-width: 600px) { .picker-row { padding: .625rem 1.5rem; } }
    .picker-row:hover, .picker-row:focus-visible { background: #f8fafc; outline: none; }
    .picker-row:active { background: #fff7ed; }
    .picker-row.is-selected { background: #fff7ed; }
    .picker-row-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .picker-row-label {
      color: #0f172a;
      font-weight: 600;
      font-size: .95rem;
      line-height: 1.3;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      overflow-wrap: anywhere;
    }
    .picker-row-sub { margin-top: .125rem; color: #64748b; font-size: .78rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .picker-row-trailing { flex: none; color: #ea580c; font-weight: 700; font-size: .875rem; font-variant-numeric: tabular-nums; }
    .picker-row-check { flex: none; color: #f16c39; }
    .picker-empty, .picker-more { margin: 1.5rem 0; text-align: center; color: #94a3b8; font-size: .875rem; }
    .picker-more { margin: 1rem 0 .5rem; font-size: .78rem; }
    .picker-create { width: 100%; height: 3rem !important; border-color: #f16c39 !important; color: #f16c39 !important; border-radius: .75rem !important; }
  `]
})
export class SearchPickerSheetComponent {
  readonly ref = inject<MatDialogRef<SearchPickerSheetComponent, PickerResult<unknown>>>(MatDialogRef);
  readonly data = inject<PickerConfig<unknown>>(MAT_DIALOG_DATA);

  readonly term = signal('');

  private readonly index = this.data.options.map(option => ({
    option,
    haystack: normalize([option.label, option.sublabel, option.keywords].filter(Boolean).join(' '))
  }));

  readonly filtered = computed(() => {
    const words = normalize(this.term().trim()).split(/\s+/).filter(Boolean);
    if (words.length === 0) return this.data.options;
    return this.index
      .filter(entry => words.every(word => entry.haystack.includes(word)))
      .map(entry => entry.option);
  });

  readonly visible = computed(() => this.filtered().slice(0, RENDER_LIMIT));

  choose(option: PickerOption<unknown>) {
    this.ref.close({ type: 'select', option });
  }
}

/**
 * Escolha de um item numa lista com pesquisa. Ecrã inteiro no telemóvel,
 * diálogo pequeno no desktop. Devolve `undefined` se o utilizador fechar.
 */
@Injectable({ providedIn: 'root' })
export class SearchPickerService {
  private readonly dialogs = inject(ResponsiveDialogService);

  pick<V>(config: PickerConfig<V>): Promise<PickerResult<V> | undefined> {
    const ref = this.dialogs.open<SearchPickerSheetComponent, PickerConfig<V>, PickerResult<V>>(
      SearchPickerSheetComponent,
      {
        size: 'sm',
        height: 'min(640px, 85vh)',
        // No telemóvel o teclado tapava metade da lista; aí o utilizador toca na pesquisa quando quer.
        autoFocus: isCompactViewport() ? 'dialog' : '.picker-search-input',
        data: config
      }
    );
    return firstValueFrom(ref.afterClosed());
  }
}
