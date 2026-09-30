import {
  AfterViewInit,
  Component,
  ElementRef,
  forwardRef,
  input,
  output,
  signal,
  viewChild
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

/**
 * Etiquetas que o editor aceita. É a mesma lista que a função de envio de
 * e-mail deixa passar, por isso o que se vê aqui é o que chega ao cliente.
 */
const ALLOWED_TAGS = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'A', 'DIV']);

/** Conteúdo destas etiquetas é descartado por inteiro, não apenas a etiqueta. */
const DROPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'HEAD', 'TITLE', 'META', 'LINK', 'IFRAME', 'OBJECT', 'TEMPLATE']);

const SAFE_HREF = /^(https?:|mailto:)/i;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Texto antigo, sem formatação: cada linha em branco separa um parágrafo. */
export function plainTextToHtml(text: string): string {
  const value = String(text ?? '').trim();
  if (!value) return '';
  return value
    .split(/\n{2,}/)
    .map(paragraph => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export function looksLikeHtml(value: string): boolean {
  return /<\/?(p|br|b|strong|i|em|u|ul|ol|li|a|div)\b/i.test(String(value ?? ''));
}

/**
 * Limpa HTML vindo da base de dados ou colado de outro programa. O DOMParser
 * não executa scripts nem carrega imagens, por isso é seguro para inspeccionar
 * conteúdo desconhecido antes de o pôr no editor.
 */
export function sanitizeRichText(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');

  const clean = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return escapeHtml(node.textContent ?? '');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (DROPPED_TAGS.has(tag)) return '';

    const inner = Array.from(el.childNodes).map(clean).join('');
    if (!ALLOWED_TAGS.has(tag)) return inner;

    const name = tag.toLowerCase();
    if (tag === 'BR') return '<br>';
    if (tag === 'A') {
      const href = (el.getAttribute('href') ?? '').trim();
      return SAFE_HREF.test(href) ? `<a href="${escapeHtml(href)}">${inner}</a>` : inner;
    }
    return `<${name}>${inner}</${name}>`;
  };

  return Array.from(doc.body.childNodes).map(clean).join('');
}

/**
 * Editor de texto com formatação simples para as mensagens de e-mail.
 *
 * Sem dependências: usa um elemento editável e os comandos nativos do browser.
 * Só oferece o que os clientes de e-mail mostram de forma fiável (negrito,
 * itálico, sublinhado, listas e ligações).
 */
@Component({
  selector: 'app-rich-text-editor',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => RichTextEditorComponent),
      multi: true
    }
  ],
  styles: [`
    .editor {
      min-height: var(--rte-min-height, 96px);
      outline: none;
      overflow-wrap: anywhere;
    }
    .editor:empty::before {
      content: attr(data-placeholder);
      color: #9ca3af;
      pointer-events: none;
    }
    .editor :is(p, div) { margin: 0 0 0.6em 0; }
    .editor :is(p, div):last-child { margin-bottom: 0; }
    .editor ul { list-style: disc; padding-left: 1.4em; margin: 0 0 0.6em 0; }
    .editor ol { list-style: decimal; padding-left: 1.4em; margin: 0 0 0.6em 0; }
    .editor a { color: #f16c39; text-decoration: underline; }
  `],
  template: `
    <div class="rounded-md border transition-colors"
      [class.border-gray-300]="!focused()"
      [class.border-orange-500]="focused()"
      [class.opacity-60]="disabled()">

      <div class="flex items-center justify-between gap-2 px-3 pt-2">
        <span class="text-xs font-medium" [class.text-gray-500]="!focused()" [class.text-orange-600]="focused()">
          {{ label() }}
        </span>

        <div class="flex items-center gap-0.5">
          @for (action of actions; track action.command) {
            <button type="button"
              (mousedown)="$event.preventDefault()"
              (click)="run(action.command)"
              [disabled]="disabled()"
              [matTooltip]="action.hint"
              class="w-7 h-7 rounded flex items-center justify-center text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
              [class.!bg-orange-100]="active()[action.command]"
              [class.!text-orange-700]="active()[action.command]">
              <mat-icon class="!text-[18px] !w-[18px] !h-[18px]">{{ action.icon }}</mat-icon>
            </button>
          }
        </div>
      </div>

      <div #editor
        class="editor px-3 py-2 text-sm text-gray-800 leading-relaxed"
        [style.--rte-min-height.px]="minHeight()"
        [attr.contenteditable]="!disabled()"
        [attr.data-placeholder]="placeholder()"
        role="textbox"
        aria-multiline="true"
        [attr.aria-label]="label()"
        (input)="onInput()"
        (focus)="onFocus()"
        (blur)="onBlur()"
        (keyup)="saveSelection()"
        (mouseup)="saveSelection()"
        (paste)="onPaste($event)"></div>
    </div>
  `
})
export class RichTextEditorComponent implements ControlValueAccessor, AfterViewInit {
  /** Nome do campo no formulário, usado para lhe endereçar marcadores. */
  name = input.required<string>();
  label = input('');
  placeholder = input('');
  minHeight = input(96);

  focusIn = output<void>();

  private editorRef = viewChild.required<ElementRef<HTMLDivElement>>('editor');

  focused = signal(false);
  disabled = signal(false);
  active = signal<Record<string, boolean>>({});

  /** Última posição do cursor dentro do editor, para inserir marcadores lá. */
  private savedRange: Range | null = null;

  /** O formulário pode entregar o valor antes de a vista existir. */
  private pendingValue: string | null = null;
  private viewReady = false;

  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};

  actions = [
    { command: 'bold', icon: 'format_bold', hint: 'Negrito' },
    { command: 'italic', icon: 'format_italic', hint: 'Itálico' },
    { command: 'underline', icon: 'format_underlined', hint: 'Sublinhado' },
    { command: 'insertUnorderedList', icon: 'format_list_bulleted', hint: 'Lista' },
    { command: 'insertOrderedList', icon: 'format_list_numbered', hint: 'Lista numerada' },
    { command: 'createLink', icon: 'link', hint: 'Inserir ligação' },
    { command: 'removeFormat', icon: 'format_clear', hint: 'Limpar formatação' }
  ];

  private get editor(): HTMLDivElement {
    return this.editorRef().nativeElement;
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    if (this.pendingValue !== null) {
      this.writeValue(this.pendingValue);
      this.pendingValue = null;
    }
  }

  writeValue(value: string | null): void {
    const raw = String(value ?? '');
    if (!this.viewReady) {
      this.pendingValue = raw;
      return;
    }
    this.editor.innerHTML = looksLikeHtml(raw) ? sanitizeRichText(raw) : plainTextToHtml(raw);
    this.savedRange = null;
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }

  run(command: string) {
    if (this.disabled()) return;
    this.restoreSelection();

    // Etiquetas simples (<b>, <i>) em vez de estilos embutidos, que alguns
    // clientes de e-mail ignoram.
    document.execCommand('styleWithCSS', false, 'false');

    if (command === 'createLink') {
      const url = window.prompt('Endereço da ligação (https://… ou mailto:…)', 'https://');
      if (!url) return;
      const href = url.trim();
      if (!SAFE_HREF.test(href)) return;
      this.restoreSelection();
      if (window.getSelection()?.isCollapsed) {
        document.execCommand('insertHTML', false, `<a href="${escapeHtml(href)}">${escapeHtml(href)}</a>`);
      } else {
        document.execCommand('createLink', false, href);
      }
    } else if (command === 'removeFormat') {
      document.execCommand('removeFormat');
      document.execCommand('unlink');
    } else {
      document.execCommand(command);
    }

    this.onInput();
  }

  /** Insere um marcador onde o cursor estava; sem cursor, vai para o fim. */
  insertText(text: string) {
    if (this.disabled()) return;

    this.editor.focus();
    if (this.savedRange) {
      this.restoreSelection();
    } else {
      const range = document.createRange();
      range.selectNodeContents(this.editor);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }

    document.execCommand('insertText', false, text);
    this.onInput();
  }

  onInput() {
    this.saveSelection();
    const text = (this.editor.textContent ?? '').trim();
    const html = this.editor.innerHTML;
    // Um editor esvaziado fica com um <br> ou um parágrafo vazio.
    this.onChange(text || /<(ul|ol|li)\b/i.test(html) ? html : '');
  }

  onFocus() {
    this.focused.set(true);
    this.focusIn.emit();
    document.execCommand('defaultParagraphSeparator', false, 'p');
  }

  onBlur() {
    this.focused.set(false);
    this.onTouched();
  }

  /** Colar mantém a formatação básica, mas nunca estilos ou etiquetas estranhas. */
  onPaste(event: ClipboardEvent) {
    const data = event.clipboardData;
    if (!data) return;
    event.preventDefault();

    const html = data.getData('text/html');
    if (html) {
      document.execCommand('insertHTML', false, sanitizeRichText(html));
    } else {
      document.execCommand('insertText', false, data.getData('text/plain'));
    }
    this.onInput();
  }

  saveSelection() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (this.editor.contains(range.commonAncestorContainer)) {
      this.savedRange = range.cloneRange();
    }
    this.refreshActive();
  }

  private restoreSelection() {
    this.editor.focus();
    if (!this.savedRange) return;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(this.savedRange);
  }

  private refreshActive() {
    const state: Record<string, boolean> = {};
    for (const command of ['bold', 'italic', 'underline', 'insertUnorderedList', 'insertOrderedList']) {
      try {
        state[command] = document.queryCommandState(command);
      } catch {
        state[command] = false;
      }
    }
    this.active.set(state);
  }
}
