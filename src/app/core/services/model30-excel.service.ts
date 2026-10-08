import { Injectable, inject } from '@angular/core';
import type { CellStyle, WorkSheet } from 'xlsx-js-style';
import type { TaxDeclaration } from './tax.service';
import type { Company } from './company.service';
import { computeModel30Fields, getModel30PaymentMethodLabel, MODEL30_RATE_LABELS } from '../utils/model30-fields';
import { AuditLogService } from './audit-log.service';

/* ------------------------------------------------------------------ */
/* Estilos (aproximam o formulário oficial do Modelo 30)               */
/* ------------------------------------------------------------------ */

const FONT = 'Arial';
const thin = { style: 'thin' as const, color: { rgb: '000000' } };
const BORDER: CellStyle['border'] = { top: thin, bottom: thin, left: thin, right: thin };
const AMOUNT_FMT = '#,##0.00';
const RATE_FMT = '0.00"%"';

function style(extra: {
  bold?: boolean; italic?: boolean; sz?: number; color?: string; fill?: string;
  h?: 'left' | 'center' | 'right'; v?: 'top' | 'center' | 'bottom'; wrap?: boolean;
  border?: boolean; numFmt?: string;
} = {}): CellStyle {
  const s: CellStyle = {
    font: { name: FONT, sz: extra.sz ?? 9, bold: !!extra.bold, italic: !!extra.italic, color: { rgb: extra.color ?? '000000' } },
    alignment: { horizontal: extra.h ?? 'left', vertical: extra.v ?? 'center', wrapText: extra.wrap ?? true },
  };
  if (extra.fill) s.fill = { patternType: 'solid', fgColor: { rgb: extra.fill } };
  if (extra.border !== false) s.border = BORDER;
  if (extra.numFmt) s.numFmt = extra.numFmt;
  return s;
}

const S = {
  headerTop: style({ h: 'center', fill: 'FFFEF0', sz: 10 }),
  headerTopBold: style({ h: 'center', fill: 'FFFEF0', sz: 10, bold: true }),
  modelTitle: style({ h: 'center', fill: 'FFFF00', sz: 16, bold: true }),
  ispcTitle: style({ h: 'center', fill: 'FFFEF0', sz: 11, bold: true }),
  instructionBar: style({ h: 'center', sz: 8, bold: true }),
  section: style({ fill: 'FFFF99', bold: true, sz: 10 }),
  subSection: style({ fill: 'E8E8E8', bold: true }),
  colHeader: style({ fill: 'F5F5F5', bold: true, h: 'center' }),
  label: style(),
  labelBold: style({ bold: true }),
  text: style(),
  textCenter: style({ h: 'center', bold: true }),
  code: style({ fill: 'D0D0D0', bold: true, h: 'center' }),
  amount: style({ h: 'right', numFmt: AMOUNT_FMT }),
  amountBold: style({ h: 'right', bold: true, numFmt: AMOUNT_FMT, fill: 'F0F0F0' }),
  amountTotal: style({ h: 'right', bold: true, numFmt: AMOUNT_FMT, fill: 'E8E8E8' }),
  rate: style({ h: 'right', numFmt: RATE_FMT }),
  caption: style({ italic: true, sz: 8, color: '444444', v: 'bottom' }),
  footer: style({ italic: true, sz: 8, color: '666666', border: false, wrap: false }),
  payTotal: style({ bold: true, fill: 'FFFF99', h: 'right' }),
  payTotalAmount: style({ bold: true, fill: 'FFFF99', h: 'right', numFmt: AMOUNT_FMT }),
  instTitle: style({ bold: true, sz: 12, h: 'center', border: false }),
  instSub: style({ sz: 10, h: 'center', border: false }),
  instHeading: style({ bold: true, sz: 9, border: false, fill: 'FFFF99' }),
  instText: style({ sz: 9, border: false, v: 'top' }),
};

/* ------------------------------------------------------------------ */
/* Pequeno construtor de folhas com células estilizadas e merges       */
/* ------------------------------------------------------------------ */

type CellValue = string | number | null | undefined;

class SheetBuilder {
  readonly ws: WorkSheet = {};
  private merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];
  private heights: { [row: number]: number } = {};
  private maxCol = 0;
  row = 0;

  constructor(private colWidths: number[]) {
    this.maxCol = colWidths.length - 1;
  }

  private addr(r: number, c: number): string {
    let col = '';
    let n = c + 1;
    while (n > 0) {
      const m = (n - 1) % 26;
      col = String.fromCharCode(65 + m) + col;
      n = Math.floor((n - 1) / 26);
    }
    return `${col}${r + 1}`;
  }

  /** Escreve um valor em [row, c0..c1] (merge quando c1 > c0), aplicando o estilo a todo o intervalo. */
  put(c0: number, c1: number, value: CellValue, s: CellStyle, opts: { text?: boolean; r?: number } = {}): this {
    const r = opts.r ?? this.row;
    for (let c = c0; c <= c1; c++) {
      const a = this.addr(r, c);
      if (c === c0 && value !== null && value !== undefined && value !== '') {
        if (typeof value === 'number' && !opts.text) {
          this.ws[a] = { t: 'n', v: value, s, ...(s.numFmt ? { z: s.numFmt as string } : {}) };
        } else {
          this.ws[a] = { t: 's', v: String(value), s };
        }
      } else {
        this.ws[a] = { t: 's', v: '', s };
      }
    }
    if (c1 > c0) this.merges.push({ s: { r, c: c0 }, e: { r, c: c1 } });
    return this;
  }

  /** Linha completa (todas as colunas) com um único texto. */
  full(value: CellValue, s: CellStyle, height?: number): this {
    this.put(0, this.maxCol, value, s);
    if (height) this.height(height);
    return this.next();
  }

  height(hpt: number): this {
    this.heights[this.row] = Math.max(this.heights[this.row] || 0, hpt);
    return this;
  }

  /** Ajusta a altura da linha actual para texto com quebra numa largura de `chars` caracteres. */
  fit(text: string, chars: number, lineHeight = 12): this {
    const lines = (text || '').split('\n')
      .reduce((n, l) => n + Math.max(1, Math.ceil(l.length / Math.max(1, chars))), 0);
    if (lines > 1) this.height(lines * lineHeight + 4);
    return this;
  }

  next(): this {
    this.row++;
    return this;
  }

  finish(): WorkSheet {
    const lastRow = Math.max(0, this.row - 1);
    this.ws['!ref'] = `A1:${this.addr(lastRow, this.maxCol)}`;
    this.ws['!merges'] = this.merges;
    this.ws['!cols'] = this.colWidths.map(wch => ({ wch }));
    const rows: { hpt?: number }[] = [];
    for (let r = 0; r <= lastRow; r++) rows.push(this.heights[r] ? { hpt: this.heights[r] } : {});
    this.ws['!rows'] = rows;
    this.ws['!margins'] = { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 };
    return this.ws;
  }
}

const chk = (b: boolean) => (b ? '[X]' : '[  ]');

/**
 * Exportação do Modelo 30 (Declaração Periódica ISPC) para Excel (.xlsx),
 * com aspecto próximo do formulário oficial: cabeçalhos amarelos, bordas,
 * quebra de linha, células unidas e larguras de coluna.
 *
 * A biblioteca `xlsx-js-style` é carregada só quando se exporta (import dinâmico),
 * para não pesar no bundle principal.
 */
@Injectable({ providedIn: 'root' })
export class Model30ExcelService {
  private auditLog = inject(AuditLogService);

  async exportModel30(decl: TaxDeclaration, company: Company): Promise<void> {
    const mod: any = await import('xlsx-js-style');
    const XLSX = (mod.default ?? mod) as typeof import('xlsx-js-style');

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, this.buildModelSheet(decl, company), 'Modelo 30');

    const payments = decl.payments || [];
    if (payments.length > 0) {
      XLSX.utils.book_append_sheet(wb, this.buildPaymentsSheet(decl), 'Pagamentos');
    }
    XLSX.utils.book_append_sheet(wb, this.buildInstructionsSheet(), 'Instruções');

    wb.Props = {
      Title: `Modelo 30 — ${decl.period}º Trimestre ${decl.year}`,
      Subject: 'Declaração Periódica ISPC',
      Author: 'ISPC Fácil',
      Company: company.name,
    };

    XLSX.writeFile(wb, `Modelo_30_${decl.year}_T${decl.period}.xlsx`, { compression: true });

    // Registo de auditoria só depois de o ficheiro ser gerado com sucesso
    // (ponto único para o botão do diálogo e o ícone da tabela).
    void this.auditLog.log(
      'Exportou Modelo 30 (Excel)',
      'declarations',
      { year: decl.year, period: decl.period },
      decl.id,
      `${decl.period}º Trim ${decl.year}`,
      decl.company_id
    );
  }

  /* -------------------------------------------------------------- */
  /* Folha principal                                                 */
  /* -------------------------------------------------------------- */
  // Colunas: A,B = rótulos/valores largos | C = código | D = valor | E = código | F = valor
  private buildModelSheet(decl: TaxDeclaration, company: Company): WorkSheet {
    const f = computeModel30Fields(decl, company);
    const meta = company.documents_metadata || {};
    const b = new SheetBuilder([28, 28, 6, 20, 6, 20]);
    const LAST = 5;

    // Pares rótulo/valor em duas metades: (A | B) e (C:D | E:F)
    const pair = (l1: string, v1: CellValue, l2?: string, v2?: CellValue) => {
      b.put(0, 0, l1, S.label).put(1, 1, v1, S.text, { text: true });
      if (l2 !== undefined) {
        b.put(2, 3, l2, S.label).put(4, LAST, v2, S.text, { text: true });
      } else {
        b.put(2, LAST, '', S.text);
      }
      const longest = Math.max(String(v1 ?? '').length / 26, String(v2 ?? '').length / 24, l1.length / 26, (l2 || '').length / 24);
      if (longest > 1) b.height(Math.ceil(longest) * 12 + 4);
      b.next();
    };

    // Cabeçalho
    b.full('República de Moçambique — Ministério das Finanças', S.headerTop);
    b.full('Autoridade Tributária de Moçambique — DIRECÇÃO GERAL DE IMPOSTOS', S.headerTopBold);
    b.full('DECLARAÇÃO PERIÓDICA — MODELO 30', S.modelTitle, 26);
    b.full('ISPC — IMPOSTO SIMPLIFICADO PARA PEQUENOS CONTRIBUINTES', S.ispcTitle, 18);
    b.full('SE PREENCHER MANUALMENTE, POR FAVOR UTILIZE LETRA DE IMPRENSA', S.instructionBar);

    // Quadro 1
    b.full('1 – TIPO DE DECLARAÇÃO', S.section);
    b.put(0, 1, `${chk(false)} Declaração inicial`, S.text)
      .put(2, LAST, `${chk(false)} Declaração de Substituição`, S.text).next();

    // Quadro 2
    b.full('2 – PERÍODO A QUE RESPEITA', S.section);
    b.put(0, 0, 'Mês', S.label).put(1, 1, f.month, S.textCenter, { text: true })
      .put(2, 3, 'Ano', S.label).put(4, LAST, String(f.year), S.textCenter, { text: true }).next();
    b.put(0, 0, 'Trimestre', S.label).put(1, 1, `${f.quarter}º`, S.textCenter, { text: true })
      .put(2, 3, `${chk(true)} Dentro do Prazo`, S.text)
      .put(4, LAST, `${chk(false)} Fora do Prazo`, S.text).next();

    // Quadro 3
    b.full('3 – NÚMERO ÚNICO DE IDENTIFICAÇÃO TRIBUTÁRIA (NUIT)', S.section);
    b.put(0, 0, 'NUIT', S.labelBold).put(1, LAST, f.nuit, S.textCenter, { text: true }).next();
    pair('Unidade de Cobrança', '', 'Código', '');

    // Quadro 4
    b.full('4 – NOME/DESIGNAÇÃO SOCIAL', S.section);
    b.put(0, LAST, company.name, S.labelBold).fit(company.name, 100).next();

    // Quadro 5
    b.full('5 – DESIGNAÇÃO DA ACTIVIDADE PRINCIPAL', S.section);
    const activity = company.category1 || '';
    b.put(0, LAST, activity, S.text).fit(activity, 100).next();
    b.put(0, 0, 'Código de Actividade Económica (CAE)', S.label).put(1, LAST, '', S.text).height(24).next();

    // Quadro 6
    b.full('6 – DOMICÍLIO FISCAL DA ACTIVIDADE', S.section);
    const address = company.address || '';
    b.put(0, 0, 'Rua / Avenida', S.label).put(1, LAST, address, S.text).fit(address, 75).next();
    pair('Nº', '', 'Andar', '');
    pair('Flat', '', 'Código Postal', company.postal_code || '');
    pair('Caixa Postal', '', 'Província', meta.province || '');
    pair('Distrito / Município', meta.district || '', 'Posto Administrativo / Distrito Municipal', meta.administrativePost || '');
    pair('Localidade', '', 'Bairro', '');
    pair('Povoação', '', 'Célula', '');
    pair('Quarteirão', '', 'Nº da casa', '');
    pair('Tel. Fixo', '', 'Telemóvel', company.phone || '');
    pair('Fax', '', 'E-mail', company.email || '');
    b.put(0, 0, 'E-mail alternativo', S.label).put(1, LAST, '', S.text).next();

    // Quadro 7
    b.full('7 – INEXISTÊNCIA DE OPERAÇÕES', S.section);
    b.put(0, 4, 'Se no período a que esta declaração respeita não realizou operações activas nem passivas, assinale e passe para o quadro 11', S.text)
      .put(5, 5, chk(f.noOperations), S.textCenter).height(28).next();

    // Quadro 8
    b.full('8 – TAXAS DO ISPC', S.section);
    b.full('8.1 – TAXAS SOBRE TRANSMISSÃO DE BENS', S.subSection);
    b.full(`${chk(f.bens[3])} ${MODEL30_RATE_LABELS.bens3}`, S.text);
    b.full(`${chk(f.bens[4])} ${MODEL30_RATE_LABELS.bens4}`, S.text);
    b.full(`${chk(f.bens[5])} ${MODEL30_RATE_LABELS.bens5}`, S.text);
    b.full('8.2 – TAXAS SOBRE PRESTAÇÃO DE SERVIÇOS', S.subSection);
    const s12 = `${chk(f.servicos[12])} ${MODEL30_RATE_LABELS.serv12}`;
    const s15 = `${chk(f.servicos[15])} ${MODEL30_RATE_LABELS.serv15}`;
    b.put(0, LAST, s12, S.text).fit(s12, 100).next();
    b.put(0, LAST, s15, S.text).fit(s15, 100).next();

    // Quadro 9
    const pos = (n: number) => (n > 0 ? n : null);
    b.full('9 – APURAMENTO DO IMPOSTO', S.section);
    b.put(0, 1, '', S.colHeader)
      .put(2, 3, 'Valor respeitante ao trimestre', S.colHeader)
      .put(4, LAST, 'Valor acumulado no ano', S.colHeader).height(24).next();
    const q9 = (label: string, c1: string, v1: CellValue, c2?: string, v2?: CellValue, total = false) => {
      b.put(0, 1, label, total ? S.labelBold : S.label)
        .put(2, 2, c1, S.code, { text: true })
        .put(3, 3, v1, total ? S.amountBold : S.amount);
      if (c2) {
        b.put(4, 4, c2, S.code, { text: true }).put(5, 5, v2, S.amount);
      } else {
        b.put(4, 5, '', total ? S.amountBold : S.text);
      }
      b.fit(label, 52).next();
    };
    q9('Volume das vendas e/ou serviços prestados', '01', f.f01, '06', f.f06);
    q9('Imposto liquidado', '02', f.f02, '07', f.f07);
    q9('Excesso do volume de vendas (20%)', '03', pos(f.f03), '08', pos(f.f08));
    q9('Tributação sobre o excesso de volume de vendas (alínea d) do nº1 do artigo 8, Código do ISPC)', '04', pos(f.f04), '09', pos(f.f09));
    q9('Total do imposto liquidado (05 = 02 + 04)', '05', f.f05, undefined, undefined, true);

    // Quadro 10
    b.full('10 – LIQUIDAÇÃO ADICIONAL (A EFECTUAR NO IV TRIMESTRE)', S.section);
    const q10 = (label: string, code: string, value: CellValue, s: CellStyle = S.amount) => {
      b.put(0, 1, label, S.label).put(2, 2, code, S.code, { text: true }).put(3, 3, value, s).put(4, LAST, '', S.text).next();
    };
    q10('Volume de negócios anual', '10', f.showQ10 ? f.f10 : null);
    q10('Taxa de imposto', '11', f.showQ10 ? f.f11 : null, S.rate);
    q10('Imposto', '12', f.showQ10 ? f.f12 : null);
    q10('Imposto corrigido (13 = 12 − 07)', '13', f.f13);

    // Quadro 11
    b.full('11 – IMPOSTO A ENTREGAR AO ESTADO', S.section);
    q10('ISPC (14 = 05 + 13)', '14', f.f14);
    q10('Juros compensatórios', '15', f.f15);
    b.put(0, 1, 'Importância a pagar (16 = 14 + 15)', S.labelBold).put(2, 2, '16', S.code, { text: true })
      .put(3, 3, f.f16, S.amountTotal).put(4, LAST, '', S.text).next();
    b.full('MEIO DE PAGAMENTO', S.subSection);
    b.put(0, 1, `${chk(false)} Numerário`, S.text).put(2, LAST, '', S.text).next();
    b.put(0, 1, `${chk(false)} Transferência — Referência:`, S.text).put(2, LAST, '', S.text).next();
    pair(`${chk(false)} Cheque nº`, '', 'Banco', '');
    pair('Agência', '', 'Nº de Conta', '');
    b.put(0, 1, `${chk(false)} Outros:`, S.text).put(2, LAST, '', S.text).next();

    // Quadros 12 + 13 (lado a lado)
    b.put(0, 1, '12 – AUTENTICAÇÃO DO SUJEITO PASSIVO', S.section)
      .put(2, LAST, '13 – USO EXCLUSIVO DOS SERVIÇOS', S.section).next();
    const q1213 = (left: string, mid: string, right: string, ls: CellStyle = S.text, rs: CellStyle = S.text, h?: number) => {
      b.put(0, 1, left, ls).put(2, 3, mid, rs).put(4, LAST, right, rs);
      if (h) b.height(h);
      b.next();
    };
    q1213('A presente declaração corresponde à verdade e não omite qualquer informação solicitada.',
      'Nº de entrada:', 'Nº de Receita:', S.text, S.text, 28);
    q1213('Data: ____/____/20____', 'Nº de inserção:', 'Data: ____/____/20____');
    q1213('Nome:', 'Data: ____/____/20____', 'Nome:');
    q1213('', 'Nome:', '', S.text, S.text, 30);
    q1213('(Assinatura do Sujeito Passivo e carimbo)', '(Assinatura do funcionário e carimbo)',
      '(Assinatura do recebedor e carimbo)', S.caption, S.caption, 24);

    b.next();
    const generated = new Date().toLocaleDateString('pt-MZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
    b.put(0, LAST, `Gerado pelo ISPC Fácil em ${generated} — ${decl.period}º Trimestre ${decl.year}`, S.footer).next();

    return b.finish();
  }

  /* -------------------------------------------------------------- */
  /* Folha de pagamentos (só quando existem)                         */
  /* -------------------------------------------------------------- */
  private buildPaymentsSheet(decl: TaxDeclaration): WorkSheet {
    const b = new SheetBuilder([14, 22, 30, 18]);
    b.full(`COMPROVATIVO DE PAGAMENTOS — ${decl.period}º Trimestre ${decl.year}`, S.section, 20);
    b.put(0, 0, 'Data', S.colHeader).put(1, 1, 'Método', S.colHeader)
      .put(2, 2, 'Referência', S.colHeader).put(3, 3, 'Valor (MZN)', S.colHeader).next();
    let total = 0;
    for (const p of decl.payments || []) {
      const amount = Number(p.amount) || 0;
      total += amount;
      b.put(0, 0, this.formatDate(p.payment_date), S.textCenter, { text: true })
        .put(1, 1, getModel30PaymentMethodLabel(p.payment_method), S.text)
        .put(2, 2, p.reference || '-', S.text, { text: true })
        .put(3, 3, amount, S.amount).next();
    }
    b.put(0, 2, 'TOTAL PAGO:', S.payTotal).put(3, 3, total, S.payTotalAmount).next();
    return b.finish();
  }

  /* -------------------------------------------------------------- */
  /* Folha de instruções (texto da página 4 do PDF)                  */
  /* -------------------------------------------------------------- */
  private buildInstructionsSheet(): WorkSheet {
    const b = new SheetBuilder([110]);
    b.full('INSTRUÇÕES DE PREENCHIMENTO', S.instTitle, 20);
    b.full('Declaração Periódica - ISPC — MODELO 30', S.instSub);
    b.next();
    for (const [heading, text] of MODEL30_INSTRUCTIONS) {
      if (heading) b.full(heading, S.instHeading);
      if (text) {
        b.put(0, 0, text, S.instText).fit(text, 115).next();
      }
    }
    return b.finish();
  }

  private formatDate(dateString?: string): string {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('pt-MZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
}

/** [título, texto] — copiado da página de instruções do Modelo 30. */
const MODEL30_INSTRUCTIONS: [string, string][] = [
  ['', 'Esta declaração deve ser preenchida com a utilização de uma máquina de escrever ou de qualquer outro processo mecânico descrita ou ainda através de impressora de computador, se para isso se instalarem os programas de impressão adequados.'],
  ['', 'Se tal não for todo possível deve utilizar-se esferográfica a escrever-se de forma legível.'],
  ['', 'Em cada quadrícula só deve ser inscrito um algarismo, devendo o valor, representado por conjunto de algarismos, ser totalmente encostado à direita.'],
  ['Quadro 1', 'Este quadro destina-se à indicação do tipo de declaração, inicial ou de substituição, consoante o caso.'],
  ['Quadro 2', '1. Indicar o mês e o ano referente a submissão a declaração 2. Indicar o trimestre a que respeita a declaração. 3. Assinalar com x a quadrícula correspondente ao estado da declaração, considerando o prazo da entrega legalmente estabelecido.'],
  ['Quadro 3', '1. Indicar o número único de identificação tributária do sujeito passivo declarante. 2. Indicar o código da unidade de cobrança que se encontra adstrito o sujeito passivo declarante.'],
  ['Quadro 4', 'Indicar o nome e/ou denominação social da firma do sujeito passivo declarante, legalmente autorizado.'],
  ['Quadro 5', '1. Indicar a designação da actividade principal do sujeito passivo 2. Indicar o Código de Actividade Económica (CAE).'],
  ['Quadro 6', 'Identificar de forma detalhada o endereço do exercício da actividade do sujeito passivo, indicando todos os elementos de localização solicitados no quadro.'],
  ['Quadro 7', 'Assinalar com "x" na quadrícula se no período a que se refere a declaração não tiver realizado qualquer operação activa bem como passiva.'],
  ['Quadro 8', 'Indicação da taxa aplicável do ISPC em função do volume de negócio ou a natureza da actividade (prestação de serviços).'],
  ['Quadro 9', 'Este quadro destina-se ao apuramento do imposto do período a que respeita a declaração e deverá ser preenchido com base nos elementos que o sujeito passivo disponha nos registos contabilístico.'],
  ['', 'Campo 01: indicar o montante do volume de vendas e/ou das prestações de serviços realizados pelo sujeito passivo durante o período a que se refere a declaração, incluindo as vendas de investimento que tenham sido utilizados na actividade da empresa.'],
  ['', 'Campo 02: indicar o valor do imposto liquidado consoante a taxa aplicável, considerando o volume de venda inscrito no campo 1.'],
  ['', 'Campo 03: quando no decurso do exercício da sua actividade o sujeito passivo exceder o volume de negócio de 4.000.000,00MT previstos para o ISPC, deverá indicar o montante do excesso neste campo.'],
  ['', 'Campo 04: liquidação do imposto à taxa de 20% sobre o excesso inscrito no campo 03.'],
  ['', 'Campo 05: indicação do imposto liquidado no trimestre, com base na soma dos campos 02 e 04, caso sujeito passivo tenha excedido o volume de negócio.'],
  ['', 'Campo 06: correspondente ao cumulativo do volume de vendas ao longo do exercício fiscal, referente a soma dos campos 01 ao longo dos trimestres.'],
  ['', 'Campo 07: corresponde ao cumulativo do montante do imposto pago ao longo dos trimestres.'],
  ['', 'Campo 08: indica o cumulativo dos montantes referentes ao excesso do volume de negócio ao longo dos trimestres, caso sujeito passivo tenha excedido o volume de negócio.'],
  ['', 'Campo 09: corresponde o valor acumulado do imposto pago em virtude do sujeito passivo ter excedido o volume do negócio em sede do ISPC.'],
  ['Quadro 10', 'A preencher no quarto trimestre. O preenchimento deste quadro resultará na liquidação adicional do imposto na última declaração a ser submetida no final do exercício em conformidade com o volume de negócios acumulado efectivamente registado.'],
  ['', 'Campo 10: corresponde o volume anual de negócios acumulados ao longo do exercício fiscal.'],
  ['', 'Campo 11: indica a taxa do imposto correspondente ao volume de negócios acumulado ao longo do ano.'],
  ['', 'Campo 12: corresponde ao imposto liquidado com base no volume de negócios acumulado ao longo do ano.'],
  ['', 'Campo 13: corresponde o ajuste do imposto que resulta da diferença entre os campos 12 e 07.'],
  ['Quadro 11', 'Este quadro destina-se à indicação do imposto a entregar ao Estado.'],
  ['', 'Campo 14: indica o imposto a pagar no trimestre.'],
  ['', 'Campo 15: corresponde aos juros compensatórios, pelo pagamento fora do prazo legalmente previsto.'],
  ['', 'Campo 16: indica a importância a pagar.'],
  ['Quadro 12', 'Indicação da data e assinatura do sujeito passivo, autenticação da declaração pelo sujeito passivo.'],
  ['Quadro 13', 'Espaço a ser preenchido pela administração fiscal.'],
];
