import { ChangeDetectionStrategy, Component, computed, forwardRef, inject, input, output, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { PickerOption, SearchPickerService } from './search-picker';

/**
 * Campo de escolha com pesquisa — substitui o mat-select em listas que crescem
 * (clientes, produtos, empresas). Ao tocar abre o SearchPicker; funciona com
 * formControlName/ngModel. Emite (create) quando o utilizador pede para criar.
 */
@Component({
  selector: 'app-search-picker-field',
  standalone: true,
  imports: [MatIconModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SearchPickerFieldComponent), multi: true }
  ],
  template: `
    <button type="button" class="pf" [class.pf-empty]="!current()" [disabled]="disabled()" (click)="open()" (blur)="onTouched()">
      <span class="pf-text">
        <span class="pf-label">{{ label() }}</span>
        @if (current(); as option) {
          <span class="pf-value">{{ option.label }}</span>
          @if (option.sublabel) {
            <span class="pf-sub">{{ option.sublabel }}</span>
          }
        } @else {
          <span class="pf-placeholder">{{ placeholder() || ('common.ui.choose' | t) }}</span>
        }
      </span>
      <mat-icon class="pf-chevron">unfold_more</mat-icon>
    </button>
  `,
  styles: [`
    :host { display: block; }
    .pf {
      display: flex;
      align-items: center;
      gap: .5rem;
      width: 100%;
      min-height: 3.5rem;
      padding: .5rem .75rem .5rem 1rem;
      border: 1px solid #cbd5e1;
      border-radius: .75rem;
      background: #fff;
      text-align: left;
      transition: border-color .15s ease, box-shadow .15s ease;
    }
    .pf:hover { border-color: #94a3b8; }
    .pf:focus-visible { outline: none; border-color: #f16c39; box-shadow: 0 0 0 3px rgba(241, 108, 57, .12); }
    .pf:disabled { opacity: .6; }
    .pf-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .pf-label { font-size: .72rem; font-weight: 600; color: #64748b; }
    .pf-value { font-size: 1rem; font-weight: 600; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pf-sub { font-size: .78rem; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pf-placeholder { font-size: 1rem; color: #94a3b8; }
    .pf-chevron { flex: none; color: #94a3b8; }
  `]
})
export class SearchPickerFieldComponent<V = string> implements ControlValueAccessor {
  private readonly picker = inject(SearchPickerService);

  readonly label = input.required<string>();
  readonly options = input.required<PickerOption<V>[]>();
  readonly placeholder = input<string>('');
  readonly sheetTitle = input<string>('');
  readonly searchPlaceholder = input<string>('');
  readonly emptyText = input<string>('');
  readonly createLabel = input<string>('');

  readonly create = output<void>();
  readonly selected = output<PickerOption<V>>();

  readonly value = signal<V | null>(null);
  readonly disabled = signal(false);
  readonly current = computed(() => this.options().find(o => o.value === this.value()) ?? null);

  private onChange: (value: V | null) => void = () => {};
  onTouched: () => void = () => {};

  async open() {
    const result = await this.picker.pick<V>({
      title: this.sheetTitle() || this.label(),
      options: this.options(),
      selected: this.value(),
      searchPlaceholder: this.searchPlaceholder() || undefined,
      emptyText: this.emptyText() || undefined,
      createLabel: this.createLabel() || undefined
    });
    this.onTouched();
    if (!result) return;
    if (result.type === 'create') {
      this.create.emit();
      return;
    }
    this.value.set(result.option.value);
    this.onChange(result.option.value);
    this.selected.emit(result.option);
  }

  writeValue(value: V | null): void {
    this.value.set(value ?? null);
  }

  registerOnChange(fn: (value: V | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }
}
