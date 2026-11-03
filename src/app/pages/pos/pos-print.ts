import {
  PosCompany,
  PosDocument,
  PosKitchenTicket,
  PosPaperWidth,
  PosSessionReport,
  PosVoidTicket
} from '../../core/services/pos.service';
import { formatPosDate, formatPosMoney } from './pos-format';

/**
 * Impressões do POS em impressora térmica (58 ou 80 mm), numa janela própria.
 * Sempre em português: são documentos para o cliente/AT, não interface (ver i18n.ts).
 * Empresas no regime ISPC: sem IVA destacado.
 */

const METHOD_LABELS: Record<string, string> = {
  cash: 'Numerário', mpesa: 'M-Pesa', emola: 'e-Mola', card: 'Cartão', transfer: 'Transferência'
};

const DOCUMENT_TITLES: Record<string, string> = {
  FR: 'FACTURA-RECIBO',
  NC: 'NOTA DE CRÉDITO'
};

/** Menção fiscal no rodapé (a validar com o consultor fiscal). */
const TAX_NOTE = 'IVA não liquidado: contribuinte sujeito ao ISPC';

const STATIONS: Record<string, string> = { kitchen: 'COZINHA', bar: 'BAR' };

const esc = (s: string | number | undefined | null) =>
  String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const mzn = (v: number) => formatPosMoney(Number(v), 'pt-MZ');
const when = (iso: string) => formatPosDate(iso, 'pt-MZ');
const qty = (v: number) => Number.isInteger(Number(v)) ? String(Number(v)) : Number(v).toFixed(3).replace(/0+$/, '').replace('.', ',');

function header(company: PosCompany): string {
  const custom = company.settings?.receipt_header?.trim();
  return `<h1>${esc(company.name)}</h1>
    <p>NUIT: ${esc(company.nuit)}</p>
    ${company.address ? `<p>${esc(company.address)}${company.province ? ', ' + esc(company.province) : ''}</p>` : ''}
    ${company.phone ? `<p>Tel: ${esc(company.phone)}</p>` : ''}
    ${custom ? `<p>${esc(custom)}</p>` : ''}`;
}

function row(label: string, value: string, cls = ''): string {
  return `<tr class="${cls}"><td>${label}</td><td class="r">${value}</td></tr>`;
}

function itemsTable(items: { name: string; quantity: number; unit_price: number; total: number; notes?: string | null }[]): string {
  return `<table>${items.map(i => `
    <tr><td colspan="2">${esc(i.name)}</td></tr>
    ${i.notes ? `<tr><td colspan="2">&nbsp;&nbsp;» ${esc(i.notes)}</td></tr>` : ''}
    <tr><td>&nbsp;&nbsp;${qty(i.quantity)} x ${mzn(i.unit_price)}</td><td class="r">${mzn(i.total)}</td></tr>`).join('')}</table>`;
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

/** FR ou NC. `copy` marca a reimpressão como 2.ª via. */
export function printDocument(doc: PosDocument, company: PosCompany, width: PosPaperWidth, copy = false) {
  const isNc = doc.document_type === 'NC';
  const gross = Number(doc.total) + Number(doc.discount_total);
  const payments = doc.payments.filter(p => isNc ? Number(p.amount) < 0 : Number(p.amount) > 0);
  const cash = payments.find(p => p.method === 'cash' && p.tendered);
  const simulated = payments.some(p => p.simulated);
  const footer = company.settings?.receipt_footer?.trim();

  const body = `${header(company)}
    <hr><h2>${DOCUMENT_TITLES[doc.document_type]}</h2>
    <p><strong>${esc(doc.number)}</strong></p>
    <p>${when(doc.issued_at)}</p>
    ${copy ? '<p class="b">2.ª VIA</p>' : ''}
    ${doc.status === 'anulada' ? '<p class="b">*** ANULADO ***</p>' : ''}
    <hr>
    <p class="l">Cliente: ${esc(doc.client.walk_in ? 'Consumidor final' : doc.client.name)}</p>
    ${doc.client.nuit ? `<p class="l">NUIT cliente: ${esc(doc.client.nuit)}</p>` : ''}
    ${doc.table_label ? `<p class="l">${esc(doc.table_label)}${doc.covers ? ` · ${doc.covers} pessoa(s)` : ''}</p>` : ''}
    <p class="l">Operador: ${esc(doc.staff)}${doc.terminal ? ' · ' + esc(doc.terminal) : ''}</p>
    ${doc.related ? `<p class="l">Ref.: ${esc(doc.related.number)}</p>` : ''}
    ${doc.credit_reason ? `<p class="l">Motivo: ${esc(doc.credit_reason)}</p>` : ''}
    <hr>${itemsTable(doc.items.map(i => ({ ...i, quantity: Math.abs(Number(i.quantity)), total: Math.abs(Number(i.unit_price) * Number(i.quantity)) })))}<hr>
    <table>
      ${Number(doc.discount_total) > 0 ? row('Soma', mzn(gross)) + row('Desconto', '-' + mzn(doc.discount_total)) : ''}
      ${row(isNc ? 'TOTAL A DEVOLVER' : 'TOTAL', mzn(Math.abs(Number(doc.total))), 'big')}
      ${payments.map(p => row(METHOD_LABELS[p.method] + (p.reference ? ` ${esc(p.reference)}` : ''), mzn(Math.abs(Number(p.amount))))).join('')}
      ${cash && Number(cash.change) > 0 ? row('Valor entregue', mzn(cash.tendered!)) + row('Troco', mzn(cash.change)) : ''}
    </table>
    ${simulated ? '<p>Pagamento móvel: simulação (fase de testes)</p>' : ''}
    <hr>
    <p>${TAX_NOTE}</p>
    <p>Documento processado por computador</p>
    ${footer ? `<p>${esc(footer)}</p>` : '<p>Obrigado pela preferência!</p>'}
    <p>ISPC Fácil POS</p>`;
  return open(doc.number, body, width);
}

/** Pedido para a cozinha / bar: só o que ainda não tinha sido enviado. */
export function printKitchenTickets(tickets: PosKitchenTicket[], tableLabel: string, covers: number, waiterName: string, width: PosPaperWidth) {
  const body = tickets.map(ticket => `
    <h2>*** ${STATIONS[ticket.station] ?? 'PEDIDO'} ***</h2>
    <p class="b">${esc(tableLabel)} · ${covers} p.</p>
    <p>${when(new Date().toISOString())} · ${esc(waiterName)}</p><hr>
    <table>${ticket.lines.map(l => `<tr class="big"><td>${qty(l.quantity)}x</td><td>${esc(l.name)}</td></tr>
      ${l.notes ? `<tr><td></td><td>» ${esc(l.notes)}</td></tr>` : ''}`).join('')}</table>
    <hr><br>`).join('');
  return open('Pedido', body, width);
}

/** Linha retirada depois de enviada: a estação tem de saber. */
export function printVoidTicket(ticket: PosVoidTicket, width: PosPaperWidth) {
  const body = `
    <h2>*** ${STATIONS[ticket.station ?? ''] ?? 'PEDIDO'} ***</h2>
    <h2>*** ANULADO ***</h2>
    <p class="b">Mesa ${esc(ticket.table_name)}</p>
    <p>${when(ticket.at)} · ${esc(ticket.waiter)}</p><hr>
    <table><tr class="big"><td>-${qty(ticket.quantity)}x</td><td>${esc(ticket.product)}</td></tr></table>
    <p class="l">Motivo: ${esc(ticket.reason)}</p>
    ${ticket.authorized_by ? `<p class="l">Autorizado: ${esc(ticket.authorized_by)}</p>` : ''}<hr><br>`;
  return open('Anulação', body, width);
}

/** Consulta de mesa (pré-conta): não é documento fiscal. */
export function printBill(
  company: PosCompany,
  width: PosPaperWidth,
  tableLabel: string,
  covers: number,
  items: { name: string; quantity: number; unit_price: number }[],
  totals: { gross: number; discount: number; total: number }
) {
  const perPerson = covers > 1 ? row(`Por pessoa (${covers})`, mzn(totals.total / covers)) : '';
  const body = `${header(company)}
    <hr><h2>CONSULTA DE MESA</h2>
    <p class="b">${esc(tableLabel)}</p>
    <p>${when(new Date().toISOString())}</p><hr>
    ${itemsTable(items.map(i => ({ ...i, total: i.unit_price * i.quantity })))}<hr>
    <table>
      ${totals.discount > 0 ? row('Soma', mzn(totals.gross)) + row('Desconto', '-' + mzn(totals.discount)) : ''}
      ${row('TOTAL', mzn(totals.total), 'big')}
      ${perPerson}
    </table>
    <hr><p class="b">NÃO SERVE DE FACTURA</p><p>Peça a factura-recibo ao pagar.</p>`;
  return open('Consulta de mesa', body, width);
}

/** Relatório X (leitura parcial) ou Z (fecho de caixa), a partir do resumo do servidor. */
export function printSessionReport(report: PosSessionReport, company: PosCompany, width: PosPaperWidth) {
  const s = report.session;
  const closed = s.status === 'closed';
  const fr = report.documents.FR ?? { count: 0, total: 0 };
  const nc = report.documents.NC ?? { count: 0, total: 0 };
  const methods = Object.entries(report.payments)
    .map(([m, v]) => row(`${METHOD_LABELS[m] ?? m} (${v!.count})`, mzn(v!.total))).join('');
  const staff = report.by_staff.map(x => row(`${esc(x.name ?? '—')} (${x.count})`, mzn(x.total))).join('');
  const movements = report.movements.map(m =>
    row(`${m.type === 'in' ? '+' : '-'} ${esc(m.reason)}`, mzn(m.amount))).join('');

  const body = `${header(company)}
    <hr><h2>${closed ? 'RELATÓRIO Z · FECHO DE CAIXA' : 'RELATÓRIO X · LEITURA PARCIAL'}</h2>
    <p class="b">Caixa nº ${s.number} · ${esc(s.terminal)}</p>
    <hr>
    <p class="l">Abertura: ${when(s.opened_at)}</p>
    <p class="l">Por: ${esc(s.opened_by)}</p>
    ${closed && s.closed_at ? `<p class="l">Fecho: ${when(s.closed_at)}</p><p class="l">Por: ${esc(s.closed_by)}</p>` : ''}
    <hr><table>
      ${row(`Facturas-recibo (${fr.count})`, mzn(fr.total))}
      ${row(`Notas de crédito (${nc.count})`, mzn(nc.total))}
      ${row('Descontos concedidos', mzn(report.discounts))}
      ${row('Total líquido', mzn(report.net_sales), 'b')}
      ${row(`Anuladas (${report.voided.count})`, mzn(report.voided.total))}
      ${report.authorizations ? row('Autorizações de gerente', String(report.authorizations)) : ''}
    </table>
    <hr><p class="l"><strong>Por forma de pagamento</strong></p><table>${methods || row('—', mzn(0))}</table>
    ${Number(report.simulated_payments) ? `<p class="l">Inclui ${mzn(report.simulated_payments)} em pagamentos móveis simulados.</p>` : ''}
    ${staff ? `<hr><p class="l"><strong>Por operador</strong></p><table>${staff}</table>` : ''}
    <hr><p class="l"><strong>Gaveta</strong></p><table>
      ${row('Fundo de caixa', mzn(report.cash.opening_float))}
      ${row('+ Numerário (vendas - devoluções)', mzn(report.cash.sales))}
      ${row('+ Entradas', mzn(report.cash.in))}
      ${row('- Saídas', mzn(report.cash.out))}
      ${row('Esperado', mzn(report.cash.expected), 'b')}
      ${report.close ? row('Contado', mzn(report.close.counted), 'b') + row('Diferença', (report.close.difference > 0 ? '+' : '') + mzn(report.close.difference), 'b') : ''}
    </table>
    ${movements ? `<hr><p class="l"><strong>Movimentos</strong></p><table>${movements}</table>` : ''}
    ${report.close?.notes ? `<hr><p class="l">Obs.: ${esc(report.close.notes)}</p>` : ''}
    ${report.close?.approved_by ? `<p class="l">Diferença aprovada por: ${esc(report.close.approved_by)}</p>` : ''}
    <hr><br><p>______________________</p><p>Assinatura do operador</p><br>
    <p>______________________</p><p>Assinatura do supervisor</p>`;
  return open(`Relatório ${closed ? 'Z' : 'X'} ${s.number}`, body, width);
}
