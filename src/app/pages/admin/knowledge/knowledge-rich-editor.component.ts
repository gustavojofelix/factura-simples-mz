import {
  AfterViewInit, Component, ElementRef, ViewEncapsulation, forwardRef, signal, viewChild
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { renderAiMarkdown } from '../../../shared/components/ai-chat/markdown.pipe';

const BLOCK_TAGS = new Set([
  'P', 'DIV', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'UL', 'OL', 'TABLE', 'HR'
]);
const DROPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'HEAD', 'TITLE', 'META', 'LINK', 'IFRAME', 'OBJECT', 'TEMPLATE']);

/**
 * HTML → Markdown, no subconjunto que o renderizador do chat conhece:
 * parágrafos, títulos, negrito, itálico, código, listas e tabelas. O que não
 * cabe nesse subconjunto (cores, sublinhado, ligações) fica só como texto, para
 * que o editor nunca mostre algo que o cliente não vai ver.
 */
export function htmlToMarkdown(root: Node): string {
  const blocks: string[] = [];
  let pending: Node[] = [];

  const flush = () => {
    const text = tidy(inlineOf(pending));
    if (text) blocks.push(text);
    pending = [];
  };

  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((child as Element).tagName)) {
        flush();
        block(child as Element);
      } else {
        pending.push(child);
      }
    }
    flush();
  };

  const block = (el: Element) => {
    const tag = el.tagName;
    if (tag === 'HR') return;

    if (/^H[1-6]$/.test(tag)) {
      // O chat mostra '#' como <h3>, '##' como <h4>…: o inverso aqui.
      const level = Math.max(Number(tag[1]) - 2, 1);
      const text = tidy(inlineOf(Array.from(el.childNodes)));
      if (text) blocks.push(`${'#'.repeat(Math.min(level, 4))} ${text}`);
      return;
    }

    if (tag === 'UL' || tag === 'OL') {
      const lines: string[] = [];
      collectList(el, lines);
      if (lines.length) blocks.push(lines.join('\n'));
      return;
    }

    if (tag === 'TABLE') {
      const rows = Array.from(el.querySelectorAll('tr'))
        .map(tr => Array.from(tr.children)
          .filter(c => c.tagName === 'TD' || c.tagName === 'TH')
          .map(c => tidy(inlineOf(Array.from(c.childNodes))).replace(/\|/g, '/') || ' '));
      if (!rows.length) return;
      const width = Math.max(...rows.map(r => r.length));
      const pad = (r: string[]) => [...r, ...Array(width - r.length).fill(' ')];
      const line = (r: string[]) => `| ${pad(r).join(' | ')} |`;
      blocks.push([
        line(rows[0]),
        `|${Array(width).fill('---').join('|')}|`,
        ...rows.slice(1).map(line)
      ].join('\n'));
      return;
    }

    // P, DIV e afins: podem conter outros blocos (o browser aninha <div>s).
    walk(el);
  };

  const collectList = (list: Element, lines: string[]) => {
    const ordered = list.tagName === 'OL';
    let n = 0;
    for (const li of Array.from(list.children)) {
      if (li.tagName !== 'LI') continue;
      const own = Array.from(li.childNodes).filter(c =>
        !(c.nodeType === Node.ELEMENT_NODE && ['UL', 'OL'].includes((c as Element).tagName)));
      const text = tidy(inlineOf(own));
      if (text) lines.push(`${ordered ? `${++n}.` : '-'} ${text}`);
      // O chat só tem um nível de lista: sub-listas passam a itens seguidos.
      for (const sub of Array.from(li.children)) {
        if (sub.tagName === 'UL' || sub.tagName === 'OL') collectList(sub, lines);
      }
    }
  };

  walk(root);
  return blocks.join('\n\n');
}

function inlineOf(nodes: Node[], bold = false, italic = false): string {
  return nodes.map(n => inlineNode(n, bold, italic)).join('');
}

function inlineNode(node: Node, bold: boolean, italic: boolean): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? '').replace(/[\s ]+/g, ' ');
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as Element;
  const tag = el.tagName;
  if (DROPPED_TAGS.has(tag)) return '';
  if (tag === 'BR') return ' ';

  const isBold = tag === 'B' || tag === 'STRONG';
  const isItalic = tag === 'I' || tag === 'EM';
  const inner = inlineOf(Array.from(el.childNodes), bold || isBold, italic || isItalic);

  if (isBold && !bold) return wrap(inner, '**');
  if (isItalic && !italic && !bold) return wrap(inner, '*');
  if (tag === 'CODE') return wrap(inner.replace(/`/g, "'"), '`');
  return inner;
}

/** Os espaços ficam fora das marcas: "**texto **" não seria negrito. */
function wrap(text: string, mark: string): string {
  const m = text.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
  return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : text;
}

function tidy(text: string): string {
  return text.replace(/ {2,}/g, ' ').trim();
}

/**
 * Editor de texto formatado para os artigos da base fiscal.
 *
 * O valor do formulário é sempre Markdown — é o que a IA lê e o que o chat
 * mostra. O editor apresenta-o já formatado (com o mesmo renderizador do chat)
 * e, a cada alteração, converte o conteúdo de volta para Markdown. Por isso a
 * barra de ferramentas só oferece o que esse Markdown consegue exprimir.
 */
@Component({
  selector: 'app-knowledge-rich-editor',
  standalone: true,
  imports: [MatIconModule],
  encapsulation: ViewEncapsulation.None,
  providers: [{
    provide: NG_VALUE_ACCESSOR,
    useExisting: forwardRef(() => KnowledgeRichEditorComponent),
    multi: true
  }],
  styles: [`
    .kb-rte-area { min-height: 360px; max-height: 640px; overflow-y: auto; outline: none; padding: 16px;
      font-size: 13.5px; line-height: 1.55; color: #1e293b; word-break: break-word; }
    .kb-rte-area:empty::before { content: attr(data-placeholder); color: #9ca3af; pointer-events: none; }
    .kb-rte-area p, .kb-rte-area > div { margin: 0 0 8px; }
    .kb-rte-area :is(h1, h2, h3, h4, h5, h6) { margin: 12px 0 6px; font-size: 13.5px; font-weight: 700; color: #0f172a; }
    .kb-rte-area ul { margin: 0 0 8px; padding-left: 18px; list-style: disc; }
    .kb-rte-area ol { margin: 0 0 8px; padding-left: 18px; list-style: decimal; }
    .kb-rte-area li { margin-bottom: 3px; }
    .kb-rte-area code { padding: 1px 5px; border-radius: 5px; background: #f1f5f9; font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
    .kb-rte-area .ai-table-wrap { margin: 8px 0; overflow-x: auto; }
    .kb-rte-area table { width: 100%; border-collapse: collapse; font-size: 12px; background: #fff; margin: 8px 0; }
    .kb-rte-area th { padding: 7px 10px; text-align: left; font-weight: 700; font-size: 10.5px; text-transform: uppercase;
      letter-spacing: .04em; color: #64748b; background: #f8fafc; border: 1px solid #e2e8f0; }
    .kb-rte-area td { padding: 7px 10px; color: #334155; border: 1px solid #e2e8f0; min-width: 60px; }
  `],
  template: `
    <div class="rounded-lg border border-gray-200 bg-white overflow-hidden focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
      <div class="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-gray-100 bg-gray-50">
        @for (group of toolbar; track $index; let last = $last) {
          @for (a of group; track a.id) {
            <button type="button" (mousedown)="$event.preventDefault()" (click)="run(a.id)" [title]="a.hint"
                    class="w-8 h-8 rounded flex items-center justify-center text-gray-600 hover:bg-gray-200 disabled:opacity-30"
                    [disabled]="a.needsTable && !inTable()"
                    [class.!bg-blue-100]="active()[a.id]" [class.!text-blue-700]="active()[a.id]">
              <mat-icon class="!text-[18px] !w-[18px] !h-[18px]">{{ a.icon }}</mat-icon>
            </button>
          }
          @if (!last) { <span class="w-px h-5 bg-gray-200 mx-1"></span> }
        }
      </div>
      <div #area class="kb-rte-area" contenteditable="true" role="textbox" aria-multiline="true"
           data-placeholder="Escreva aqui a resposta…"
           (input)="onInput()" (keyup)="refresh()" (mouseup)="refresh()" (blur)="onTouched()"
           (paste)="onPaste($event)"></div>
    </div>
  `
})
export class KnowledgeRichEditorComponent implements ControlValueAccessor, AfterViewInit {
  private areaRef = viewChild.required<ElementRef<HTMLDivElement>>('area');

  active = signal<Record<string, boolean>>({});
  inTable = signal(false);

  toolbar = [
    [
      { id: 'heading', icon: 'title', hint: 'Título' },
      { id: 'bold', icon: 'format_bold', hint: 'Negrito' },
      { id: 'italic', icon: 'format_italic', hint: 'Itálico' }
    ],
    [
      { id: 'insertUnorderedList', icon: 'format_list_bulleted', hint: 'Lista' },
      { id: 'insertOrderedList', icon: 'format_list_numbered', hint: 'Lista numerada' }
    ],
    [
      { id: 'table', icon: 'table_chart', hint: 'Inserir tabela' },
      { id: 'addRow', icon: 'table_rows', hint: 'Acrescentar linha abaixo', needsTable: true },
      { id: 'addColumn', icon: 'view_column', hint: 'Acrescentar coluna à direita', needsTable: true },
      { id: 'removeRow', icon: 'playlist_remove', hint: 'Remover linha', needsTable: true },
      { id: 'removeColumn', icon: 'backspace', hint: 'Remover coluna', needsTable: true }
    ],
    [
      { id: 'removeFormat', icon: 'format_clear', hint: 'Limpar formatação' }
    ]
  ] as { id: string; icon: string; hint: string; needsTable?: boolean }[][];

  /** Último Markdown emitido: evita reescrever o editor (e perder o cursor) com o próprio eco. */
  private lastMarkdown: string | null = null;
  private pending: string | null = null;
  private ready = false;

  private onChange: (v: string) => void = () => {};
  onTouched: () => void = () => {};

  private get area() { return this.areaRef().nativeElement; }

  ngAfterViewInit() {
    this.ready = true;
    if (this.pending !== null) this.writeValue(this.pending);
  }

  writeValue(value: string | null) {
    const md = String(value ?? '');
    if (!this.ready) { this.pending = md; return; }
    if (md === this.lastMarkdown) return;
    this.lastMarkdown = md;
    this.area.innerHTML = md.trim() ? renderAiMarkdown(md) : '';
  }

  registerOnChange(fn: (v: string) => void) { this.onChange = fn; }
  registerOnTouched(fn: () => void) { this.onTouched = fn; }

  onInput() {
    const md = htmlToMarkdown(this.area);
    this.lastMarkdown = md;
    this.onChange(md);
    this.refresh();
  }

  run(id: string) {
    this.area.focus();
    document.execCommand('styleWithCSS', false, 'false');

    switch (id) {
      case 'heading': {
        const current = String(document.queryCommandValue('formatBlock') || '').toLowerCase();
        document.execCommand('formatBlock', false, /^h[1-6]$/.test(current) ? 'p' : 'h4');
        break;
      }
      case 'table':
        document.execCommand('insertHTML', false,
          '<table><thead><tr><th>Coluna 1</th><th>Coluna 2</th></tr></thead>' +
          '<tbody><tr><td><br></td><td><br></td></tr></tbody></table><p><br></p>');
        break;
      case 'addRow': this.editTable('addRow'); break;
      case 'addColumn': this.editTable('addColumn'); break;
      case 'removeRow': this.editTable('removeRow'); break;
      case 'removeColumn': this.editTable('removeColumn'); break;
      case 'removeFormat':
        document.execCommand('removeFormat');
        document.execCommand('formatBlock', false, 'p');
        break;
      default:
        document.execCommand(id);
    }
    this.onInput();
  }

  /** Colar passa sempre pelo Markdown: entra só a formatação que o chat mostra. */
  onPaste(event: ClipboardEvent) {
    const data = event.clipboardData;
    if (!data) return;
    event.preventDefault();
    const html = data.getData('text/html');
    if (html) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      document.execCommand('insertHTML', false, renderAiMarkdown(htmlToMarkdown(doc.body)));
    } else {
      document.execCommand('insertText', false, data.getData('text/plain'));
    }
    this.onInput();
  }

  refresh() {
    const state: Record<string, boolean> = {};
    for (const c of ['bold', 'italic', 'insertUnorderedList', 'insertOrderedList']) {
      try { state[c] = document.queryCommandState(c); } catch { state[c] = false; }
    }
    try {
      state['heading'] = /^h[1-6]$/i.test(String(document.queryCommandValue('formatBlock') || ''));
    } catch { state['heading'] = false; }
    this.active.set(state);
    this.inTable.set(!!this.currentCell());
  }

  private currentCell(): HTMLTableCellElement | null {
    const node = window.getSelection()?.anchorNode;
    const el = node ? (node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement) : null;
    const cell = el?.closest('td, th') as HTMLTableCellElement | null;
    return cell && this.area.contains(cell) ? cell : null;
  }

  private editTable(action: 'addRow' | 'addColumn' | 'removeRow' | 'removeColumn') {
    const cell = this.currentCell();
    if (!cell) return;
    const row = cell.parentElement as HTMLTableRowElement;
    const table = cell.closest('table')!;
    const index = cell.cellIndex;
    const rows = Array.from(table.querySelectorAll('tr'));

    if (action === 'addRow') {
      const tr = document.createElement('tr');
      for (let i = 0; i < row.cells.length; i++) tr.appendChild(this.newCell('td'));
      // Uma linha nova a partir do cabeçalho vai para o início do corpo.
      const tbody = table.tBodies[0];
      if (row.parentElement?.tagName === 'THEAD' && tbody) tbody.insertBefore(tr, tbody.firstChild);
      else row.after(tr);
      this.placeCaret(tr.cells[0]);
    } else if (action === 'addColumn') {
      for (const r of rows) {
        const ref = r.cells[Math.min(index, r.cells.length - 1)];
        const c = this.newCell(r.parentElement?.tagName === 'THEAD' ? 'th' : 'td');
        if (ref) ref.after(c); else r.appendChild(c);
      }
      this.placeCaret(row.cells[index + 1] ?? row.cells[index]);
    } else if (action === 'removeRow') {
      if (rows.length <= 1) { table.remove(); return; }
      const next = (row.nextElementSibling ?? row.previousElementSibling) as HTMLTableRowElement | null;
      row.remove();
      if (next?.cells.length) this.placeCaret(next.cells[0]);
    } else {
      if (row.cells.length <= 1) { table.remove(); return; }
      for (const r of rows) r.cells[index]?.remove();
      this.placeCaret(row.cells[Math.max(index - 1, 0)]);
    }
  }

  private newCell(tag: 'td' | 'th') {
    const c = document.createElement(tag);
    c.appendChild(document.createElement('br'));
    return c;
  }

  private placeCaret(el: Element | undefined) {
    if (!el) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }
}
