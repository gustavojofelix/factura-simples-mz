import {
  SaftData,
  buildSaftXml,
  escapeXml,
  fmtAmount,
  fmtDateTime,
  fmtDecimal,
  splitDocumentNumber
} from './saft.service';
import { SAFT_CONFIG } from '../constants/saft';

function baseData(overrides: Partial<SaftData> = {}): SaftData {
  return {
    company: {
      name: 'Loja <A & B>',
      nuit: '400123456',
      address: 'Av. 25 de Setembro',
      postal_code: '1100',
      phone: '841234567',
      email: 'loja@exemplo.co.mz',
      currency: 'MZN',
      documents_metadata: { province: 'Maputo', district: 'KaMpfumo' }
    },
    startDate: '2026-01-01',
    endDate: '2026-03-31',
    dateCreated: '2026-04-02',
    customers: [
      { id: 'c1', client_code: 'CL0001', name: 'Cliente Um', nuit: '100000001' },
      { id: 'c2', client_code: 'CL0002', name: 'Cliente Sem NUIT', nuit: null }
    ],
    products: [
      { id: 'p1', code: 'P0001', barcode: '5601234567890', name: 'Arroz', type: 'produto', unit: 'kg' },
      { id: 'p2', code: 'S0001', name: 'Consultoria', type: 'servico' }
    ],
    invoices: [
      {
        id: 'i1', invoice_number: 'FAC00001', date: '2026-01-10', status: 'paga', client_id: 'c1',
        subtotal: 150, total: 150, created_at: '2026-01-10T08:00:00Z', issued_at: '2026-01-10T08:30:00Z',
        source_id: 'Ana',
        items: [
          { product_id: 'p1', product_name: 'Arroz', quantity: 2, unit_price: 50, subtotal: 100 },
          { product_id: 'p2', product_name: 'Consultoria', quantity: 1, unit_price: 50, subtotal: 50 }
        ]
      },
      {
        id: 'i2', invoice_number: 'FAC00002', date: '2026-02-01', status: 'anulada', client_id: 'c2',
        subtotal: 1000, total: 1000, created_at: '2026-02-01T09:00:00Z', annulled_at: '2026-02-02T10:00:00Z',
        items: [{ product_id: null, product_name: 'Item apagado', quantity: 1, unit_price: 1000, subtotal: 1000 }]
      }
    ],
    payments: [
      {
        id: 'r1', receipt_number: 'REC00001', payment_date: '2026-01-15', payment_method: 'transferencia',
        amount: 150, status: 'emitido', created_at: '2026-01-15T10:00:00Z', client_id: 'c1',
        invoice_number: 'FAC00001', invoice_date: '2026-01-10'
      },
      {
        id: 'r2', receipt_number: 'REC00002', payment_date: '2026-01-20', payment_method: 'dinheiro',
        amount: 80, status: 'anulado', created_at: '2026-01-20T10:00:00Z', annulled_at: '2026-01-21T10:00:00Z',
        annulment_reason: 'Valor errado', client_id: 'c1', invoice_number: 'FAC00001', invoice_date: '2026-01-10'
      }
    ],
    ...overrides
  };
}

/** Conteúdo de um bloco <tag>...</tag> (primeira ocorrência a partir de um texto). */
function block(xml: string, tag: string, from = 0): string {
  const start = xml.indexOf(`<${tag}>`, from);
  const end = xml.indexOf(`</${tag}>`, start);
  return start < 0 || end < 0 ? '' : xml.substring(start, end + tag.length + 3);
}

describe('SAF-T', () => {
  describe('formatação', () => {
    it('escapa caracteres especiais de XML', () => {
      expect(escapeXml(`A & B <x> "y" 'z'`)).toBe('A &amp; B &lt;x&gt; &quot;y&quot; &apos;z&apos;');
      expect(escapeXml('a\u0001b')).toBe('ab');
      expect(escapeXml(null)).toBe('');
    });

    it('formata valores com 2 casas e ponto decimal', () => {
      expect(fmtAmount(10)).toBe('10.00');
      expect(fmtAmount(1234.567)).toBe('1234.57');
      expect(fmtAmount('abc')).toBe('0.00');
    });

    it('formata quantidades com até 6 casas', () => {
      expect(fmtDecimal(2)).toBe('2.00');
      expect(fmtDecimal(1.5)).toBe('1.50');
      expect(fmtDecimal(0.333333333)).toBe('0.333333');
    });

    it('converte datas para a hora de Maputo', () => {
      expect(fmtDateTime('2026-01-10T23:30:00Z')).toBe('2026-01-11T01:30:00');
      expect(fmtDateTime(null, '2026-01-10')).toBe('2026-01-10T00:00:00');
    });

    it('separa série e número do documento', () => {
      expect(splitDocumentNumber('FAC00012', 'FT')).toEqual({ series: 'FAC', number: 12 });
      expect(splitDocumentNumber('00012', 'FT')).toEqual({ series: 'FT', number: 12 });
      expect(splitDocumentNumber('FT 2026/7', 'FT')).toEqual({ series: 'FT2026', number: 7 });
    });
  });

  describe('buildSaftXml', () => {
    it('gera o cabeçalho com a configuração de Moçambique', () => {
      const { xml } = buildSaftXml(baseData());
      expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBeTrue();
      expect(xml).toContain(`<AuditFile xmlns="${SAFT_CONFIG.namespace}"`);
      const header = block(xml, 'Header');
      expect(header).toContain('<AuditFileVersion>1.04_01</AuditFileVersion>');
      expect(header).toContain('<TaxRegistrationNumber>400123456</TaxRegistrationNumber>');
      expect(header).toContain('<CompanyName>Loja &lt;A &amp; B&gt;</CompanyName>');
      expect(header).toContain('<City>KaMpfumo</City>');
      expect(header).toContain('<Country>MZ</Country>');
      expect(header).toContain('<FiscalYear>2026</FiscalYear>');
      expect(header).toContain('<CurrencyCode>MZN</CurrencyCode>');
      expect(header).toContain(`<ProductID>${SAFT_CONFIG.productID}</ProductID>`);
    });

    it('exporta clientes sem NUIT como consumidor final', () => {
      const { xml } = buildSaftXml(baseData());
      const customers = xml.split('<Customer>').slice(1);
      expect(customers.length).toBe(2);
      expect(customers[0]).toContain('<CustomerTaxID>100000001</CustomerTaxID>');
      expect(customers[1]).toContain('<CustomerID>CL0002</CustomerID>');
      expect(customers[1]).toContain('<CustomerTaxID>999999999</CustomerTaxID>');
      expect(customers[1]).toContain('<CompanyName>Consumidor final</CompanyName>');
      expect(customers[1]).toContain('<Contact>Cliente Sem NUIT</Contact>');
    });

    it('inclui só artigos usados e um artigo genérico para linhas sem produto', () => {
      const { xml, warnings } = buildSaftXml(baseData());
      expect(xml).toContain('<ProductType>S</ProductType>');
      expect(xml).toContain('<ProductNumberCode>5601234567890</ProductNumberCode>');
      expect(xml).toContain(`<ProductCode>${SAFT_CONFIG.genericProductCode}</ProductCode>`);
      expect(warnings.some(w => w.includes('sem artigo'))).toBeTrue();
    });

    it('declara a isenção de IVA do regime ISPC', () => {
      const { xml } = buildSaftXml(baseData());
      const table = block(xml, 'TaxTable');
      expect(table).toContain('<TaxCode>ISE</TaxCode>');
      expect(table).toContain('<TaxPercentage>0.00</TaxPercentage>');
      expect(xml).toContain(`<TaxExemptionReason>${escapeXml(SAFT_CONFIG.tax.exemptionReason)}</TaxExemptionReason>`);
      expect(xml).toContain('<TaxExemptionCode>M99</TaxExemptionCode>');
    });

    it('lista facturas anuladas com estado A, fora dos totais de controlo', () => {
      const { xml, summary } = buildSaftXml(baseData());
      const sales = block(xml, 'SalesInvoices');
      expect(sales).toContain('<NumberOfEntries>2</NumberOfEntries>');
      expect(sales).toContain('<TotalCredit>150.00</TotalCredit>');
      expect(sales).toContain('<InvoiceNo>FT FAC/1</InvoiceNo>');

      const annulled = sales.substring(sales.indexOf('<InvoiceNo>FT FAC/2</InvoiceNo>'));
      expect(annulled).toContain('<InvoiceStatus>A</InvoiceStatus>');
      expect(annulled).toContain('<InvoiceStatusDate>2026-02-02T12:00:00</InvoiceStatusDate>');
      expect(sales).toContain('<SystemEntryDate>2026-01-10T10:30:00</SystemEntryDate>');
      expect(sales).toContain('<Hash>0</Hash>');

      expect(summary.invoices).toBe(2);
      expect(summary.annulledInvoices).toBe(1);
      expect(summary.invoicesTotal).toBe(150);
    });

    it('exporta recibos em Payments com o meio de pagamento mapeado', () => {
      const { xml, summary } = buildSaftXml(baseData());
      const payments = block(xml, 'Payments');
      expect(payments).toContain('<NumberOfEntries>2</NumberOfEntries>');
      expect(payments).toContain('<TotalCredit>150.00</TotalCredit>');
      expect(payments).toContain('<PaymentRefNo>RG REC/1</PaymentRefNo>');
      expect(payments).toContain('<PaymentMechanism>TB</PaymentMechanism>');
      expect(payments).toContain('<PaymentMechanism>NU</PaymentMechanism>');
      expect(payments).toContain('<OriginatingON>FT FAC/1</OriginatingON>');

      const annulled = payments.substring(payments.indexOf('<PaymentRefNo>RG REC/2</PaymentRefNo>'));
      expect(annulled).toContain('<PaymentStatus>A</PaymentStatus>');
      expect(annulled).toContain('<Reason>Valor errado</Reason>');

      expect(summary.payments).toBe(2);
      expect(summary.annulledPayments).toBe(1);
      expect(summary.paymentsTotal).toBe(150);
    });

    it('avisa sobre números em falta na série', () => {
      const data = baseData();
      data.invoices[1].invoice_number = 'FAC00004';
      const { warnings } = buildSaftXml(data);
      expect(warnings.some(w => w.includes('FT FAC') && w.includes('2, 3'))).toBeTrue();
    });

    it('avisa quando o total da factura difere da soma das linhas', () => {
      const data = baseData();
      data.invoices[0].subtotal = 999;
      const { warnings } = buildSaftXml(data);
      expect(warnings.some(w => w.includes('FAC00001') && w.includes('soma das linhas'))).toBeTrue();
    });
  });
});
