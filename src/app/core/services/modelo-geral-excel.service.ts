import { Injectable, inject } from '@angular/core';
import type { CellStyle, WorkSheet } from 'xlsx-js-style';
import type { TaxDeclaration } from './tax.service';
import type { Company } from './company.service';
import { computeModeloGeralFields } from '../utils/modelo-geral-fields';
import { SheetBuilder, style } from './model30-excel.service';
import { AuditLogService } from './audit-log.service';
import { ExportService } from './export.service';

/* Cores do formulário oficial M/G: cabeçalhos lilás, campos a preencher em creme (texto azul). */
const LILAC = 'E4DFEC';
const CREAM = 'FFF6DC';
const BLUE = '1F3A93';
const AMOUNT_FMT = '#,##0.00';

const S = {
  topNote: style({ h: 'center', bold: true, sz: 8, border: false }),
  org: style({ h: 'center', sz: 9 }),
  orgBold: style({ h: 'center', sz: 9, bold: true }),
  title: style({ h: 'center', bold: true, sz: 12 }),
  code: style({ h: 'center', bold: true, sz: 14, fill: LILAC }),
  section: style({ fill: LILAC, bold: true, sz: 10 }),
  label: style(),
  labelBold: style({ bold: true }),
  labelRight: style({ bold: true, h: 'right' }),
  colHeader: style({ bold: true, h: 'center' }),
  fill: style({ fill: CREAM, color: BLUE }),
  fillBold: style({ fill: CREAM, color: BLUE, bold: true }),
  fillCenter: style({ fill: CREAM, color: BLUE, bold: true, h: 'center' }),
  fillAmount: style({ fill: CREAM, color: BLUE, h: 'right', numFmt: AMOUNT_FMT }),
  fillRate: style({ fill: CREAM, color: BLUE, h: 'center', numFmt: '0%' }),
  fillRateDec: style({ fill: CREAM, color: BLUE, h: 'center', numFmt: '0.00%' }),
  fieldCode: style({ fill: 'D9D9D9', bold: true, h: 'center' }),
  amount: style({ h: 'right', numFmt: AMOUNT_FMT }),
  amountBold: style({ h: 'right', bold: true, numFmt: AMOUNT_FMT }),
  text: style(),
  caption: style({ italic: true, sz: 8, color: '444444' }),
  footer: style({ italic: true, sz: 8, color: '666666', border: false, wrap: false }),
  instTitle: style({ bold: true, sz: 11, h: 'center', border: false }),
  instHeading: style({ bold: true, sz: 9, border: false, fill: LILAC }),
  instText: style({ sz: 9, border: false, v: 'top' }),
};

const LOGO_URL = 'assets/escudomozambique.png';
/** Escudo à esquerda do bloco A1:A4 (cabeçalho com 4 linhas de 16 pt ≈ 85 px). */
const LOGO_ANCHOR = { col: 0, row: 0, offsetX: 8, offsetY: 6, width: 70, height: 72 };

function colLetter(c: number): string {
  return String.fromCharCode(65 + c);
}

/** Acrescenta uma fórmula a uma célula já escrita (o valor calculado fica como cache). */
function formula(ws: WorkSheet, r: number, c: number, f: string): void {
  const cell = ws[`${colLetter(c)}${r + 1}`];
  if (cell) cell.f = f;
}

/**
 * Exportação da Declaração Modelo Geral (M/G) do ISPC para Excel (.xlsx),
 * com o aspecto do formulário oficial. Os totais (09, 14, 07 e a importância
 * a pagar) ficam com fórmulas, para que alterar os juros (08) actualize o total.
 */
@Injectable({ providedIn: 'root' })
export class ModeloGeralExcelService {
  private auditLog = inject(AuditLogService);
  private exportService = inject(ExportService);

  async export(decl: TaxDeclaration, company: Company): Promise<void> {
    const mod: any = await import('xlsx-js-style');
    const XLSX = (mod.default ?? mod) as typeof import('xlsx-js-style');

    const wb = XLSX.utils.book_new();
    const sheet = this.buildSheet(decl, company);
    XLSX.utils.book_append_sheet(wb, sheet.ws, 'M-G');

    wb.Props = {
      Title: `Declaração Modelo Geral (M/G) — ISPC ${decl.period}º Trimestre ${decl.year}`,
      Subject: 'Declaração Modelo Geral — ISPC',
      Author: 'ISPC Fácil',
      Company: company.name,
    };

    let file = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer);
    const { addPngToXlsx, setXlsxPrintLayout } = await import('../utils/xlsx-package.util');
    file = setXlsxPrintLayout(file, 1, { paperSize: 9, fitToWidth: true, rowBreaks: [sheet.instructionsRow] }) as Uint8Array<ArrayBuffer>;
    const logo = await this.loadLogo();
    if (logo) file = addPngToXlsx(file, 1, logo, LOGO_ANCHOR) as Uint8Array<ArrayBuffer>;

    this.exportService.downloadBlob(
      new Blob([file], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      `Modelo_Geral_MG_ISPC_${decl.year}_T${decl.period}.xlsx`
    );

    void this.auditLog.log(
      'Exportou Modelo Geral (Excel)',
      'declarations',
      { year: decl.year, period: decl.period },
      decl.id,
      `${decl.period}º Trim ${decl.year}`,
      decl.company_id
    );
  }

  // Colunas: A = descrição | B = código | C = base | D = taxa | E = código | F = montante
  private buildSheet(decl: TaxDeclaration, company: Company): { ws: WorkSheet; instructionsRow: number } {
    const f = computeModeloGeralFields(decl, company);
    const meta = company.documents_metadata || {};
    const b = new SheetBuilder([36, 6, 18, 10, 6, 20]);
    const LAST = 5;
    const X = (on: boolean) => (on ? '[X]' : '[  ]');

    const pair = (l1: string, v1: string, l2?: string, v2?: string) => {
      b.put(0, 0, l1, S.label).put(1, 2, v1, S.fill, { text: true });
      if (l2 !== undefined) b.put(3, 4, l2, S.label).put(5, 5, v2 ?? '', S.fill, { text: true });
      else b.put(3, LAST, '', S.text);
      b.next();
    };

    b.full('SE PREENCHER MANUALMENTE, POR FAVOR UTILIZE LETRA DE IMPRENSA', S.topNote);

    // Cabeçalho: escudo + organismo | título | M/G
    const h0 = b.row;
    b.area(h0, h0, 0, 2, 'República de Moçambique', S.org);
    b.area(h0 + 1, h0 + 1, 0, 2, 'Ministério da Economia e Finanças', S.org);
    b.area(h0 + 2, h0 + 2, 0, 2, 'Autoridade Tributária de Moçambique', S.orgBold);
    b.area(h0 + 3, h0 + 3, 0, 2, 'DIRECÇÃO GERAL DE IMPOSTOS', S.org);
    b.area(h0, h0 + 3, 3, 4, 'DECLARAÇÃO MODELO GERAL', S.title);
    b.area(h0, h0 + 3, 5, 5, 'M/G', S.code);
    for (let r = h0; r <= h0 + 3; r++) { b.row = r; b.height(20); }
    b.row = h0 + 4;

    // Quadro 1
    b.full('1 – TIPO DE DECLARAÇÃO', S.section);
    b.put(0, 2, `${X(true)} Declaração Inicial`, S.fill).put(3, LAST, `${X(false)} Declaração de Substituição`, S.text).next();

    // Quadros 2 e 3
    b.put(0, 2, '2 – PERÍODO A QUE RESPEITA', S.section).put(3, LAST, '3 – NUIT', S.section).next();
    b.put(0, 0, '(Mês) / (Ano)', S.label).put(1, 2, `${f.month} / ${f.year}`, S.fillCenter, { text: true })
      .put(3, 4, 'NUIT', S.labelBold).put(5, 5, f.nuit, S.fillCenter, { text: true }).next();
    b.put(0, 2, `${X(!f.late)} 1. Entrega dentro do Prazo`, S.fill)
      .put(3, 4, 'Área Fiscal/UGC', S.labelBold).put(5, 5, '', S.fill).next();
    b.put(0, 2, `${X(f.late)} 2. Entrega fora do Prazo`, S.fill).put(3, LAST, '', S.text).next();

    // Quadro 5
    b.full('5 – NOME/DESIGNAÇÃO SOCIAL DO SUJEITO PASSIVO', S.section);
    b.put(0, LAST, company.name, S.fillBold).fit(company.name, 100).next();

    // Quadro 6
    b.full('6 – DOMICÍLIO FISCAL DO SUJEITO PASSIVO', S.section);
    const address = company.address || '';
    b.put(0, 0, 'Rua/Avenida', S.label).put(1, LAST, address, S.fill).fit(address, 60).next();
    pair('N.º', '', 'Andar', '');
    pair('Flat', '', 'Código Postal', company.postal_code || '');
    pair('Caixa Postal', '', 'Província', meta.province || '');
    pair('Distrito / Município', meta.district || '', 'Localidade', '');
    pair('Posto Administrativo / Distrito Municipal', meta.administrativePost || '', 'Bairro', '');
    pair('Povoação', '', 'Célula', '');
    pair('Quarteirão', '', 'N.º da casa', '');
    pair('Tel. Fixo', '', 'Telemóvel', company.phone || '');
    pair('Fax', '', 'E-mail', company.email || '');
    pair('E-mail alternativo', '');

    // Quadro 8
    b.full('8 – APURAMENTO DO MATERIAL COLECTÁVEL', S.section);
    b.put(0, 0, 'DESCRIÇÃO DA RECEITA', S.colHeader).put(1, 2, 'BASE TRIBUTÁVEL', S.colHeader)
      .put(3, 3, 'TAXA', S.colHeader).put(4, 5, 'Montante apurado', S.colHeader).next();
    const firstLineRow = b.row;
    for (let i = 0; i < 4; i++) {
      const l = f.lines[i];
      b.put(0, 0, l?.description ?? '', S.fill)
        .put(1, 1, `0${i + 1}`, S.fieldCode, { text: true })
        .put(2, 2, l ? l.base : null, S.fillAmount)
        .put(3, 3, l ? l.rate / 100 : null, l && !Number.isInteger(l.rate) ? S.fillRateDec : S.fillRate)
        .put(4, 4, `0${i + 5}`, S.fieldCode, { text: true })
        .put(5, 5, l ? l.amount : null, S.amount)
        .next();
    }
    const subtotal1Row = b.row;
    b.put(0, 3, 'SUBTOTAL-1', S.labelRight).put(4, 4, '09', S.fieldCode, { text: true })
      .put(5, 5, f.subtotal1, S.amountBold).next();
    formula(b.ws, subtotal1Row, 5, `SUM(F${firstLineRow + 1}:F${firstLineRow + 4})`);

    b.put(0, 3, 'DESCRIÇÃO DA RECEITA', S.colHeader).put(4, 5, 'Montante apurado', S.colHeader).next();
    const firstOtherRow = b.row;
    for (let i = 0; i < 4; i++) {
      const l = f.otherLines[i];
      b.put(0, 3, l?.description ?? '', S.fill)
        .put(4, 4, String(10 + i), S.fieldCode, { text: true })
        .put(5, 5, l ? l.amount : null, S.fillAmount)
        .next();
    }
    const subtotal2Row = b.row;
    b.put(0, 3, 'SUBTOTAL-2', S.labelRight).put(4, 4, '14', S.fieldCode, { text: true })
      .put(5, 5, f.subtotal2, S.amountBold).next();
    formula(b.ws, subtotal2Row, 5, `SUM(F${firstOtherRow + 1}:F${firstOtherRow + 4})`);

    // Quadro 10
    b.full('10 – MONTANTE A ENTREGAR AO ESTADO', S.section);
    const dueRow = b.row;
    b.put(0, 0, 'Montante apurado', S.label).put(1, 1, '07', S.fieldCode, { text: true }).put(2, 2, f.amountDue, S.amount)
      .put(3, LAST, `${X(f.paymentMethod === 'numerario')} Numerário`, S.text).next();
    formula(b.ws, dueRow, 2, `F${subtotal1Row + 1}+F${subtotal2Row + 1}`);
    const interestRow = b.row;
    b.put(0, 0, 'Juros compensatórios', S.label).put(1, 1, '08', S.fieldCode, { text: true }).put(2, 2, f.interest, S.fillAmount)
      .put(3, LAST, `${X(f.paymentMethod === 'cheque')} Cheque n.º ${f.paymentMethod === 'cheque' ? f.paymentReference : '________'}   Banco ________`, S.text).next();
    b.put(0, 2, '', S.text).put(3, LAST, `${X(false)} Agência ________   N.º conta ________`, S.text).next();
    const outros = f.paymentMethod === 'outros'
      ? `${f.paymentOther}${f.paymentReference ? ` — Ref. ${f.paymentReference}` : ''}`
      : '________';
    b.put(0, 2, '', S.text).put(3, LAST, `${X(f.paymentMethod === 'outros')} Outros: ${outros}`, S.text).next();
    const totalRow = b.row;
    b.put(0, 3, 'IMPORTÂNCIA A PAGAR', S.labelRight).put(4, 4, '09', S.fieldCode, { text: true })
      .put(5, 5, f.total, S.amountBold).height(18).next();
    formula(b.ws, totalRow, 5, `C${dueRow + 1}+C${interestRow + 1}`);

    // Quadro 11
    b.full('11 – USO EXCLUSIVO DOS SERVIÇOS', S.section);
    b.put(0, 0, 'A presente declaração corresponde à verdade e não omite qualquer informação pedida.', S.text)
      .put(1, 3, 'N.º de Receita', S.labelBold).put(4, LAST, 'N.º de Entrada / N.º de Inserção', S.labelBold).height(28).next();
    b.put(0, 0, 'Data:', S.fill).put(1, 3, 'Data: ___/___/20____', S.text).put(4, LAST, 'Data: ___/___/20____', S.text).next();
    b.put(0, 0, 'Nome:', S.fill).put(1, 3, '', S.text).put(4, LAST, 'Nome do funcionário', S.text).next();
    b.put(0, 0, 'Ass.:', S.text).put(1, 3, 'O RECEBEDOR', S.caption).put(4, LAST, 'Assinatura', S.caption).height(30).next();

    b.next();
    const generated = new Date().toLocaleDateString('pt-MZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
    b.put(0, LAST, `Gerado pelo ISPC Fácil em ${generated} — ${decl.period}º Trimestre ${decl.year}`, S.footer).next();

    // Instruções (nova página ao imprimir)
    b.next();
    const instructionsRow = b.row;
    b.full('COMO PREENCHER O MODELO GERAL (M/G) PARA O ISPC', S.instTitle, 20);
    b.next();
    for (const [heading, text] of MODELO_GERAL_INSTRUCTIONS) {
      if (heading) b.full(heading, S.instHeading);
      b.put(0, LAST, text, S.instText).fit(text, 120).next();
    }

    return { ws: b.finish(), instructionsRow };
  }

  private async loadLogo(): Promise<Uint8Array | null> {
    try {
      const response = await fetch(LOGO_URL);
      if (!response.ok) return null;
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      console.warn('Modelo Geral (Excel): não foi possível carregar o escudo.', error);
      return null;
    }
  }
}

/** [título, texto] */
export const MODELO_GERAL_INSTRUCTIONS: [string, string][] = [
  ['', 'A Declaração Modelo Geral (M/G), aprovada pelo Decreto n.º 63/2022, de 25 de Novembro, é indicada pela AT para declarar e pagar o ISPC enquanto não existir mecanismo próprio (Comunicado n.º 9/2026). Preencha em letra de imprensa. As células a creme (texto azul) são as preenchidas pelo contribuinte.'],
  ['Quadro 1 – Tipo de declaração', 'Assinale «Declaração Inicial». A de Substituição serve apenas para corrigir uma declaração já entregue.'],
  ['Quadro 2 – Período a que respeita', 'Mês e ano do período declarado (preenchido com o último mês do trimestre) e se a entrega é dentro ou fora do prazo. Confirme junto da AT o mês a indicar para o trimestre.'],
  ['Quadro 3 – NUIT e Área Fiscal', 'NUIT do contribuinte (9 dígitos) e a Área Fiscal ou UGC onde está registado.'],
  ['Quadros 5 e 6 – Identificação', 'Nome ou designação social e domicílio fiscal completo, tal como constam do registo na AT.'],
  ['Quadro 8 – Apuramento', 'Descrição da receita (ISPC e trimestre), base tributável no campo 01, taxa do escalão e montante apurado no campo 05; o total repete-se no Subtotal-1 (09). Se no trimestre houver mais de uma taxa (mudança de escalão ou excesso), usa-se uma linha por taxa. Os campos 10 a 14 (Subtotal-2) são para receitas sem base tributável: não se aplicam ao ISPC e ficam em branco.'],
  ['Quadro 10 – Montante a entregar', 'Montante apurado (07), juros compensatórios (08, só se fora do prazo), importância a pagar (09) e o meio de pagamento.'],
  ['Quadro 11 – Assinatura', 'Data, nome e assinatura do declarante. Os restantes campos são de uso exclusivo da AT.'],
  ['Antes de entregar', 'Entrega fora do prazo: assinale a opção 2 no Quadro 2 e inclua os juros compensatórios no campo 08. Mais de uma actividade: aplica-se a taxa da actividade tributada à taxa mais elevada. Depois de pagar, conserve a declaração e o comprovativo de pagamento.'],
];
