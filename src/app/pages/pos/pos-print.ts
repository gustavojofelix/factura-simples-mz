import {
  PosPaperWidth,
  PosSale,
  PosSession,
  PosSessionSummary,
  PosStore,
  PosSaleItem,
  PosStation
} from '../../core/services/pos.service';
import { formatPosDate, formatPosMoney } from './pos-format';

/**
 * Impressões do POS em impressora térmica (58 ou 80 mm), numa janela própria.
 * Sempre em português: são documentos para o cliente/AT, não interface (ver i18n.ts).
 */

const METHOD_LABELS: Record<string, string> = {
  cash: 'Numerário', mpesa: 'M-Pesa', emola: 'e-Mola', card: 'Cartão', transfer: 'Transferência'
};

const DOCUMENT_TITLES: Record<string, string> = {
  VD: 'VENDA A DINHEIRO',
  FR: 'FACTURA-RECIBO'
};

const esc = (s: string | number | undefined | null) =>
  String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const mzn = (v: number) => formatPosMoney(v, 'pt-MZ');
const when = (iso: string) => formatPosDate(iso, 'pt-MZ');

function header(store: PosStore): string {
  return `<h1>${esc(store.name)}</h1>
    <p>NUIT: ${esc(store.nuit)}</p>
    <p>${esc(store.address)}</p>
    <p>Tel: ${esc(store.phone)}</p>`;
}

function row(label: string, value: string, cls = ''): string {
  return `<tr class="${cls}"><td>${label}</td><td class="r">${value}</td></tr>`;
}

function itemsTable(items: Pick<PosSaleItem, 'name' | 'quantity' | 'unit_price' | 'total'>[]): string {
  return `<table>${items.map(i => `
    <tr><td colspan="2">${esc(i.name)}</td></tr>
    <tr><td>&nbsp;&nbsp;${i.quantity} x ${mzn(i.unit_price)}</td><td class="r">${mzn(i.total)}</td></tr>`).join('')}</table>`;
}

function open(title: string, body: string, width: PosPaperWidth) {
  const paper = width === 58 ? '48mm' : '72mm';
  const size = width === 58 ? '11px' : '12px';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      @page { margin: 0; size: ${width}mm auto; }
      body { font-family: 'Courier New', monospace; font-size: ${size}; width: ${paper}; margin: 0 auto; padding: 6px 4px; color: #000; }
      h1 { font-size: 1.2em; text-align: center; margin: 0 0 2px; } h2 { font-size: 1.1em; text-align: center; margin: 4px 0; }
      p { margin: 1px 0; text-align: center; } .l { text-align: left; }
      table { width: 100%; border-collapse: collapse; } td { padding: 1px 0; vertical-align: top; } .r { text-align: right; white-space: nowrap; }
      hr { border: 0; border-top: 1px dashed #000; margin: 5px 0; } .b { font-weight: bold; font-size: 1.15em; }
      .big td { font-size: 1.35em; font-weight: bold; padding: 3px 0; }
    </style></head><body>${body}
    <script>window.onload = () => { window.print(); setTimeout(() => window.close(), 400); };</script>
    </body></html>`;
  const win = window.open('', '_blank', 'width=380,height=640');
  if (!win) return false;
  win.document.write(html);
  win.document.close();
  return true;
}

export interface PrintContext {
  store: PosStore;
  width: PosPaperWidth;
  sellerName: (id: string | undefined) => string;
  tableName: (id: string | undefined) => string;
}

export function printSale(sale: PosSale, ctx: PrintContext) {
  const body = `${header(ctx.store)}
    <hr><h2>${DOCUMENT_TITLES[sale.document_type]}</h2>
    <p><strong>${esc(sale.number)}</strong></p>
    <p>${when(sale.created_at)}</p>
    ${sale.status === 'cancelled' ? '<p class="b">*** ANULADO ***</p>' : ''}
    <hr>
    <p class="l">Cliente: ${esc(sale.client_name || 'Consumidor Final')}</p>
    ${sale.client_nuit ? `<p class="l">NUIT cliente: ${esc(sale.client_nuit)}</p>` : ''}
    ${sale.table_id ? `<p class="l">Mesa: ${esc(ctx.tableName(sale.table_id))}${sale.covers ? ` · ${sale.covers} pessoa(s)` : ''}</p>` : ''}
    <p class="l">Operador: ${esc(ctx.sellerName(sale.seller_id))}</p>
    <hr>${itemsTable(sale.items)}<hr>
    <table>
      ${row('Subtotal (sem IVA)', mzn(sale.subtotal))}
      ${row('IVA incluído', mzn(sale.tax_total))}
      ${row('TOTAL', mzn(sale.total), 'big')}
      ${row(METHOD_LABELS[sale.payment_method], mzn(sale.amount_received))}
      ${sale.change > 0 ? row('Troco', mzn(sale.change)) : ''}
    </table>
    <hr>
    ${sale.document_type === 'FR' ? '<p>Documento processado por computador</p>' : ''}
    <p>Obrigado pela preferência!</p><p>ISPC Fácil POS</p>`;
  return open(sale.number, body, ctx.width);
}

/** Pedido para a cozinha / bar: só o que ainda não tinha sido enviado. */
export function printKitchenOrder(
  groups: Record<PosStation, { name: string; quantity: number }[]>,
  tableLabel: string,
  waiterName: string,
  width: PosPaperWidth
) {
  const block = (title: string, lines: { name: string; quantity: number }[]) => lines.length === 0 ? '' : `
    <h2>*** ${title} ***</h2>
    <p class="b">${esc(tableLabel)}</p>
    <p>${when(new Date().toISOString())} · ${esc(waiterName)}</p><hr>
    <table>${lines.map(l => `<tr class="big"><td>${l.quantity}x</td><td>${esc(l.name)}</td></tr>`).join('')}</table>
    <hr><br>`;
  return open('Pedido', block('COZINHA', groups.kitchen) + block('BAR', groups.bar), width);
}

/** Consulta de mesa (pré-conta): não é documento fiscal. */
export function printBill(
  ctx: PrintContext,
  tableLabel: string,
  covers: number,
  items: PosSaleItem[],
  totals: { subtotal: number; tax_total: number; total: number }
) {
  const perPerson = covers > 1 ? row(`Por pessoa (${covers})`, mzn(totals.total / covers)) : '';
  const body = `${header(ctx.store)}
    <hr><h2>CONSULTA DE MESA</h2>
    <p class="b">${esc(tableLabel)}</p>
    <p>${when(new Date().toISOString())}</p><hr>
    ${itemsTable(items)}<hr>
    <table>
      ${row('Subtotal (sem IVA)', mzn(totals.subtotal))}
      ${row('IVA incluído', mzn(totals.tax_total))}
      ${row('TOTAL', mzn(totals.total), 'big')}
      ${perPerson}
    </table>
    <hr><p class="b">NÃO SERVE DE FACTURA</p><p>Peça o documento ao pagar.</p>`;
  return open('Consulta de mesa', body, ctx.width);
}

/** Relatório Z do fecho de caixa. */
export function printZReport(session: PosSession, summary: PosSessionSummary, ctx: PrintContext) {
  const counted = session.counted_cash ?? 0;
  const diff = counted - (session.expected_cash ?? summary.expectedCash);
  const methods = summary.byMethod.filter(m => m.count > 0)
    .map(m => row(`${METHOD_LABELS[m.id]} (${m.count})`, mzn(m.amount))).join('');
  const sellers = summary.bySeller.map(s => row(`${esc(ctx.sellerName(s.seller_id))} (${s.count})`, mzn(s.amount))).join('');
  const movements = session.movements.map(m =>
    row(`${m.type === 'in' ? '+' : '-'} ${esc(m.reason)}`, mzn(m.amount))).join('');

  const title = session.closed_at ? 'RELATÓRIO Z · FECHO DE CAIXA' : 'RELATÓRIO X · LEITURA PARCIAL';
  const body = `${header(ctx.store)}
    <hr><h2>${title}</h2>
    <p class="b">Sessão nº ${session.number} · ${esc(session.terminal_name)}</p>
    <hr>
    <p class="l">Abertura: ${when(session.opened_at)}</p>
    <p class="l">Por: ${esc(ctx.sellerName(session.opened_by))}</p>
    ${session.closed_at ? `<p class="l">Fecho: ${when(session.closed_at)}</p><p class="l">Por: ${esc(ctx.sellerName(session.closed_by))}</p>` : ''}
    <hr><table>
      ${row('Vendas', String(summary.count))}
      ${row('  Talões (VD)', String(summary.byDocument.VD))}
      ${row('  Facturas-recibo (FR)', String(summary.byDocument.FR))}
      ${row('Total vendido', mzn(summary.total), 'b')}
      ${row('IVA incluído', mzn(summary.tax_total))}
      ${row(`Anuladas (${summary.cancelled.count})`, mzn(summary.cancelled.total))}
    </table>
    <hr><p class="l"><strong>Por forma de pagamento</strong></p><table>${methods || row('—', mzn(0))}</table>
    ${sellers ? `<hr><p class="l"><strong>Por operador</strong></p><table>${sellers}</table>` : ''}
    <hr><p class="l"><strong>Gaveta</strong></p><table>
      ${row('Fundo de caixa', mzn(session.opening_float))}
      ${row('+ Vendas em numerário', mzn(summary.cashSales))}
      ${row('+ Entradas', mzn(summary.ins))}
      ${row('- Saídas', mzn(summary.outs))}
      ${row('Esperado', mzn(session.expected_cash ?? summary.expectedCash), 'b')}
      ${session.closed_at ? row('Contado', mzn(counted), 'b') + row('Diferença', (diff > 0 ? '+' : '') + mzn(diff), 'b') : ''}
    </table>
    ${movements ? `<hr><p class="l"><strong>Movimentos</strong></p><table>${movements}</table>` : ''}
    ${session.notes ? `<hr><p class="l">Obs.: ${esc(session.notes)}</p>` : ''}
    <hr><br><p>______________________</p><p>Assinatura do operador</p><br>
    <p>______________________</p><p>Assinatura do supervisor</p>`;
  return open(`Relatório ${session.closed_at ? 'Z' : 'X'} ${session.number}`, body, ctx.width);
}
