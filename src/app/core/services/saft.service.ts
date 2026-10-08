import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { SAFT_CONFIG, SAFT_PAYMENT_MECHANISMS } from '../constants/saft';
import { toIsoDate } from '../utils/date.util';

// ---------------------------------------------------------------------------
// Dados de entrada do gerador (independentes do Supabase, para testes)
// ---------------------------------------------------------------------------

export interface SaftCompany {
  name: string;
  nuit: string;
  address?: string | null;
  postal_code?: string | null;
  phone?: string | null;
  email?: string | null;
  currency?: string | null;
  documents_metadata?: { province?: string; district?: string } | null;
}

export interface SaftCustomer {
  id: string;
  client_code?: string | null;
  name: string;
  nuit?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface SaftProduct {
  id: string;
  code?: string | null;
  barcode?: string | null;
  name: string;
  type?: 'produto' | 'servico' | string | null;
  unit?: string | null;
}

export interface SaftInvoiceLine {
  product_id?: string | null;
  product_name?: string | null;
  description?: string | null;
  quantity: number;
  unit_price: number;
  subtotal: number;
}

export interface SaftInvoice {
  id: string;
  invoice_number: string;
  /** 'FT' factura; 'NC' nota de crédito (ainda não existe na aplicação). */
  type?: 'FT' | 'NC';
  date: string;
  status: string;
  client_id?: string | null;
  subtotal: number;
  total: number;
  created_at: string;
  issued_at?: string | null;
  annulled_at?: string | null;
  annulment_reason?: string | null;
  source_id?: string | null;
  items: SaftInvoiceLine[];
}

export interface SaftPayment {
  id: string;
  receipt_number?: string | null;
  payment_date: string;
  payment_method: string;
  amount: number;
  status?: string | null;
  created_at: string;
  annulled_at?: string | null;
  annulment_reason?: string | null;
  source_id?: string | null;
  client_id?: string | null;
  invoice_number?: string | null;
  invoice_date?: string | null;
}

export interface SaftData {
  company: SaftCompany;
  startDate: string;
  endDate: string;
  /** Data de criação do ficheiro (AAAA-MM-DD). */
  dateCreated: string;
  customers: SaftCustomer[];
  products: SaftProduct[];
  invoices: SaftInvoice[];
  payments: SaftPayment[];
}

export interface SaftSummary {
  invoices: number;
  annulledInvoices: number;
  invoicesTotal: number;
  payments: number;
  annulledPayments: number;
  paymentsTotal: number;
  customers: number;
  products: number;
}

export interface SaftResult {
  xml: string;
  summary: SaftSummary;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------

/** Escapa texto para XML e remove caracteres de controlo inválidos. */
export function escapeXml(value: unknown): string {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Valor monetário com 2 casas e ponto decimal. */
export function fmtAmount(value: unknown): string {
  const n = Number(value) || 0;
  return (Math.round(n * 100) / 100).toFixed(2);
}

/** Quantidades e preços unitários: até 6 casas, mínimo 2. */
export function fmtDecimal(value: unknown): string {
  const n = Math.round((Number(value) || 0) * 1e6) / 1e6;
  const text = n.toFixed(6).replace(/0+$/, '');
  const decimals = text.split('.')[1]?.length ?? 0;
  return decimals < 2 ? n.toFixed(2) : text;
}

const MAPUTO_DATE_TIME = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Africa/Maputo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
});

/** timestamptz → 'AAAA-MM-DDThh:mm:ss' na hora de Maputo. */
export function fmtDateTime(value: string | null | undefined, fallbackDate?: string): string {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return `${(fallbackDate || toIsoDate(new Date())).substring(0, 10)}T00:00:00`;
  }
  return MAPUTO_DATE_TIME.format(date).replace(' ', 'T');
}

function truncate(value: unknown, max: number): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.substring(0, max) : text;
}

function round2(value: unknown): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * 'FAC00012' → { series: 'FAC', number: 12 }. A série não pode ter espaços
 * nem '/', por causa do formato "Tipo Série/Número" do SAF-T.
 */
export function splitDocumentNumber(value: string, fallbackSeries: string): { series: string; number: number | null } {
  const match = /^(.*?)(\d+)$/.exec((value || '').trim());
  const clean = (s: string) => s.replace(/[\s/]+/g, '').replace(/[-_.]+$/, '');
  if (!match) return { series: clean(value || '') || fallbackSeries, number: null };
  return { series: clean(match[1]) || fallbackSeries, number: Number(match[2]) };
}

function documentRef(type: string, value: string, fallbackSeries: string): string {
  const { series, number } = splitDocumentNumber(value, fallbackSeries);
  return `${type} ${series}/${number ?? 0}`;
}

// ---------------------------------------------------------------------------
// Gerador de XML (função pura)
// ---------------------------------------------------------------------------

class XmlWriter {
  private lines: string[] = [];
  private depth = 0;

  raw(line: string) {
    this.lines.push(line);
  }

  open(tag: string, attrs = '') {
    this.lines.push(`${'  '.repeat(this.depth)}<${tag}${attrs}>`);
    this.depth++;
  }

  close(tag: string) {
    this.depth--;
    this.lines.push(`${'  '.repeat(this.depth)}</${tag}>`);
  }

  el(tag: string, value: unknown) {
    this.lines.push(`${'  '.repeat(this.depth)}<${tag}>${escapeXml(value)}</${tag}>`);
  }

  /** Elemento opcional: omitido quando vazio. */
  opt(tag: string, value: unknown) {
    if (value !== null && value !== undefined && String(value).trim() !== '') this.el(tag, value);
  }

  toString() {
    return this.lines.join('\n') + '\n';
  }
}

function customerIdOf(customer: SaftCustomer | undefined): string {
  if (!customer) return SAFT_CONFIG.consumerCustomerID;
  return truncate(customer.client_code || customer.id, 30);
}

function productCodeOf(product: SaftProduct | undefined): string {
  if (!product) return SAFT_CONFIG.genericProductCode;
  return truncate(product.code || product.id, 60);
}

function sourceIdOf(value: string | null | undefined): string {
  return truncate(value || 'Sistema', 30);
}

/**
 * Constrói o AuditFile SAF-T (estrutura PT 1.04_01, adaptada a Moçambique).
 * Os documentos anulados constam do ficheiro (estado 'A') mas não entram nos
 * totais de controlo.
 */
export function buildSaftXml(data: SaftData): SaftResult {
  const cfg = SAFT_CONFIG;
  const warnings: string[] = [];
  const company = data.company;
  const meta = company.documents_metadata || {};

  const customersById = new Map(data.customers.map(c => [c.id, c]));
  const productsById = new Map(data.products.map(p => [p.id, p]));

  const invoices = [...data.invoices].sort((a, b) =>
    a.date.localeCompare(b.date) || a.invoice_number.localeCompare(b.invoice_number, undefined, { numeric: true })
  );
  const payments = [...data.payments].sort((a, b) =>
    a.payment_date.localeCompare(b.payment_date)
    || (a.receipt_number || '').localeCompare(b.receipt_number || '', undefined, { numeric: true })
  );

  // Avisos sobre a empresa
  if (!company.nuit) warnings.push('A empresa não tem NUIT definido.');
  if (!company.postal_code) warnings.push('A empresa não tem código postal: foi usado "0000".');
  if (!meta.district && !meta.province) warnings.push('A empresa não tem distrito/província: a cidade ficou "Desconhecido".');

  // Clientes e artigos referenciados
  const usedCustomerIds = new Set<string>();
  let needsConsumer = false;
  for (const doc of [...invoices, ...payments]) {
    if (doc.client_id && customersById.has(doc.client_id)) usedCustomerIds.add(doc.client_id);
    else needsConsumer = true;
  }
  const customers = [...usedCustomerIds].map(id => customersById.get(id)!)
    .sort((a, b) => customerIdOf(a).localeCompare(customerIdOf(b), undefined, { numeric: true }));

  const usedProductIds = new Set<string>();
  let needsGenericProduct = false;
  let linesWithoutProduct = 0;
  for (const inv of invoices) {
    for (const item of inv.items) {
      if (item.product_id && productsById.has(item.product_id)) usedProductIds.add(item.product_id);
      else { needsGenericProduct = true; linesWithoutProduct++; }
    }
  }
  const products = [...usedProductIds].map(id => productsById.get(id)!)
    .sort((a, b) => productCodeOf(a).localeCompare(productCodeOf(b), undefined, { numeric: true }));

  const withoutNuit = customers.filter(c => !c.nuit?.trim()).length;
  if (withoutNuit) warnings.push(`${withoutNuit} cliente(s) sem NUIT: exportados como "${cfg.consumerName}" (${cfg.consumerTaxID}).`);
  if (linesWithoutProduct) warnings.push(`${linesWithoutProduct} linha(s) sem artigo associado: exportadas como "${cfg.genericProductDescription}".`);

  const w = new XmlWriter();
  w.raw('<?xml version="1.0" encoding="UTF-8"?>');
  w.open('AuditFile', ` xmlns="${cfg.namespace}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"`);

  // Header -------------------------------------------------------------------
  w.open('Header');
  w.el('AuditFileVersion', cfg.auditFileVersion);
  w.el('CompanyID', company.nuit || cfg.unknown);
  w.el('TaxRegistrationNumber', company.nuit || '0');
  w.el('TaxAccountingBasis', cfg.taxAccountingBasis);
  w.el('CompanyName', truncate(company.name, 100));
  w.open('CompanyAddress');
  w.el('AddressDetail', truncate(company.address || cfg.unknown, 210));
  w.el('City', truncate(meta.district || meta.province || cfg.unknown, 50));
  w.el('PostalCode', truncate(company.postal_code || cfg.unknownPostalCode, 20));
  w.opt('Region', truncate(meta.province, 50));
  w.el('Country', cfg.countryCode);
  w.close('CompanyAddress');
  w.el('FiscalYear', data.startDate.substring(0, 4));
  w.el('StartDate', data.startDate);
  w.el('EndDate', data.endDate);
  w.el('CurrencyCode', company.currency || cfg.defaultCurrency);
  w.el('DateCreated', data.dateCreated);
  w.el('TaxEntity', cfg.taxEntity);
  w.el('ProductCompanyTaxID', cfg.productCompanyTaxID);
  w.el('SoftwareCertificateNumber', cfg.softwareCertificateNumber);
  w.el('ProductID', cfg.productID);
  w.el('ProductVersion', cfg.productVersion);
  w.el('HeaderComment', 'Ficheiro informativo: documentos sem assinatura digital (software não certificado).');
  w.opt('Telephone', truncate(company.phone, 20));
  w.opt('Email', truncate(company.email, 254));
  w.close('Header');

  // MasterFiles --------------------------------------------------------------
  w.open('MasterFiles');

  const writeCustomer = (id: string, taxId: string, name: string, contact: string | null, c?: SaftCustomer) => {
    w.open('Customer');
    w.el('CustomerID', id);
    w.el('AccountID', cfg.unknown);
    w.el('CustomerTaxID', taxId);
    w.el('CompanyName', truncate(name, 100));
    w.opt('Contact', contact ? truncate(contact, 50) : null);
    w.open('BillingAddress');
    w.el('AddressDetail', truncate(c?.address || cfg.unknown, 210));
    w.el('City', cfg.unknown);
    w.el('PostalCode', cfg.unknownPostalCode);
    w.el('Country', cfg.countryCode);
    w.close('BillingAddress');
    w.opt('Telephone', truncate(c?.phone, 20));
    w.opt('Email', truncate(c?.email, 254));
    w.el('SelfBillingIndicator', 0);
    w.close('Customer');
  };

  for (const c of customers) {
    const nuit = c.nuit?.trim();
    if (nuit) writeCustomer(customerIdOf(c), nuit, c.name, null, c);
    else writeCustomer(customerIdOf(c), cfg.consumerTaxID, cfg.consumerName, c.name, c);
  }
  if (needsConsumer) writeCustomer(cfg.consumerCustomerID, cfg.consumerTaxID, cfg.consumerName, null);

  for (const p of products) {
    w.open('Product');
    w.el('ProductType', p.type === 'servico' ? 'S' : 'P');
    w.el('ProductCode', productCodeOf(p));
    w.el('ProductGroup', p.type === 'servico' ? 'Serviço' : 'Produto');
    w.el('ProductDescription', truncate(p.name, 200));
    w.el('ProductNumberCode', truncate(p.barcode || p.code || p.id, 60));
    w.close('Product');
  }
  if (needsGenericProduct) {
    w.open('Product');
    w.el('ProductType', 'O');
    w.el('ProductCode', cfg.genericProductCode);
    w.el('ProductDescription', cfg.genericProductDescription);
    w.el('ProductNumberCode', cfg.genericProductCode);
    w.close('Product');
  }

  w.open('TaxTable');
  w.open('TaxTableEntry');
  w.el('TaxType', cfg.tax.type);
  w.el('TaxCountryRegion', cfg.countryCode);
  w.el('TaxCode', cfg.tax.code);
  w.el('Description', cfg.tax.description);
  w.el('TaxPercentage', fmtAmount(cfg.tax.percentage));
  w.close('TaxTableEntry');
  w.close('TaxTable');

  w.close('MasterFiles');

  // SourceDocuments ----------------------------------------------------------
  w.open('SourceDocuments');

  // SalesInvoices
  let totalDebit = 0;
  let totalCredit = 0;
  let annulledInvoices = 0;
  for (const inv of invoices) {
    const annulled = inv.status === 'anulada';
    if (annulled) { annulledInvoices++; continue; }
    if ((inv.type || 'FT') === 'NC') totalDebit += round2(inv.subtotal);
    else totalCredit += round2(inv.subtotal);
  }

  w.open('SalesInvoices');
  w.el('NumberOfEntries', invoices.length);
  w.el('TotalDebit', fmtAmount(totalDebit));
  w.el('TotalCredit', fmtAmount(totalCredit));

  const seriesNumbers = new Map<string, number[]>();

  for (const inv of invoices) {
    const type = inv.type || 'FT';
    const annulled = inv.status === 'anulada';
    const { series, number } = splitDocumentNumber(inv.invoice_number, type);
    if (number !== null) {
      const key = `${type} ${series}`;
      seriesNumbers.set(key, [...(seriesNumbers.get(key) || []), number]);
    }
    const customer = inv.client_id ? customersById.get(inv.client_id) : undefined;
    const sourceId = sourceIdOf(inv.source_id);
    const linesTotal = round2(inv.items.reduce((sum, i) => sum + round2(i.subtotal), 0));
    if (Math.abs(linesTotal - round2(inv.subtotal)) > 0.01) {
      warnings.push(`Factura ${inv.invoice_number}: o total (${fmtAmount(inv.subtotal)}) difere da soma das linhas (${fmtAmount(linesTotal)}).`);
    }
    if (!inv.items.length) warnings.push(`Factura ${inv.invoice_number} sem linhas.`);

    w.open('Invoice');
    w.el('InvoiceNo', documentRef(type, inv.invoice_number, type));
    w.el('ATCUD', cfg.atcud);
    w.open('DocumentStatus');
    w.el('InvoiceStatus', annulled ? 'A' : 'N');
    w.el('InvoiceStatusDate', annulled
      ? fmtDateTime(inv.annulled_at, inv.date)
      : fmtDateTime(inv.issued_at || inv.created_at, inv.date));
    if (annulled) w.el('Reason', truncate(inv.annulment_reason || 'Anulação', 50));
    w.el('SourceID', sourceId);
    w.el('SourceBilling', 'P');
    w.close('DocumentStatus');
    w.el('Hash', cfg.hash);
    w.el('HashControl', cfg.hashControl);
    w.el('Period', Number(inv.date.substring(5, 7)));
    w.el('InvoiceDate', inv.date);
    w.el('InvoiceType', type);
    w.open('SpecialRegimes');
    w.el('SelfBillingIndicator', 0);
    w.el('CashVATSchemeIndicator', 0);
    w.el('ThirdPartiesBillingIndicator', 0);
    w.close('SpecialRegimes');
    w.el('SourceID', sourceId);
    w.el('SystemEntryDate', fmtDateTime(inv.issued_at || inv.created_at, inv.date));
    w.el('CustomerID', customerIdOf(customer));

    inv.items.forEach((item, index) => {
      const product = item.product_id ? productsById.get(item.product_id) : undefined;
      const description = truncate(item.product_name || item.description || product?.name || cfg.genericProductDescription, 200);
      w.open('Line');
      w.el('LineNumber', index + 1);
      w.el('ProductCode', productCodeOf(product));
      w.el('ProductDescription', product ? truncate(product.name, 200) : description);
      w.el('Quantity', fmtDecimal(item.quantity));
      w.el('UnitOfMeasure', truncate(product?.unit || 'UN', 20));
      w.el('UnitPrice', fmtDecimal(item.unit_price));
      w.el('TaxPointDate', inv.date);
      w.el('Description', description);
      w.el(type === 'NC' ? 'DebitAmount' : 'CreditAmount', fmtAmount(item.subtotal));
      w.open('Tax');
      w.el('TaxType', cfg.tax.type);
      w.el('TaxCountryRegion', cfg.countryCode);
      w.el('TaxCode', cfg.tax.code);
      w.el('TaxPercentage', fmtAmount(cfg.tax.percentage));
      w.close('Tax');
      w.el('TaxExemptionReason', cfg.tax.exemptionReason);
      w.el('TaxExemptionCode', cfg.tax.exemptionCode);
      w.el('SettlementAmount', '0.00');
      w.close('Line');
    });

    w.open('DocumentTotals');
    w.el('TaxPayable', '0.00');
    w.el('NetTotal', fmtAmount(inv.subtotal));
    w.el('GrossTotal', fmtAmount(inv.total));
    w.close('DocumentTotals');
    w.close('Invoice');
  }
  w.close('SalesInvoices');

  // Payments (recibos)
  let paymentsTotal = 0;
  let annulledPayments = 0;
  for (const p of payments) {
    if (p.status === 'anulado') annulledPayments++;
    else paymentsTotal += round2(p.amount);
  }

  w.open('Payments');
  w.el('NumberOfEntries', payments.length);
  w.el('TotalDebit', '0.00');
  w.el('TotalCredit', fmtAmount(paymentsTotal));

  for (const p of payments) {
    const annulled = p.status === 'anulado';
    const customer = p.client_id ? customersById.get(p.client_id) : undefined;
    const sourceId = sourceIdOf(p.source_id);
    if (!p.receipt_number) warnings.push(`Recibo de ${p.payment_date} sem número atribuído.`);
    const receiptNumber = p.receipt_number || `REC${(p.id || '').replace(/\D/g, '').substring(0, 8) || '0'}`;

    w.open('Payment');
    w.el('PaymentRefNo', documentRef('RG', receiptNumber, 'REC'));
    w.el('ATCUD', cfg.atcud);
    w.el('Period', Number(p.payment_date.substring(5, 7)));
    w.el('TransactionDate', p.payment_date);
    w.el('PaymentType', 'RG');
    w.open('DocumentStatus');
    w.el('PaymentStatus', annulled ? 'A' : 'N');
    w.el('PaymentStatusDate', fmtDateTime(annulled ? (p.annulled_at || p.created_at) : p.created_at, p.payment_date));
    if (annulled) w.el('Reason', truncate(p.annulment_reason || 'Anulação', 50));
    w.el('SourceID', sourceId);
    w.el('SourcePayment', 'P');
    w.close('DocumentStatus');
    w.open('PaymentMethod');
    w.el('PaymentMechanism', SAFT_PAYMENT_MECHANISMS[p.payment_method] || 'OU');
    w.el('PaymentAmount', fmtAmount(p.amount));
    w.el('PaymentDate', p.payment_date);
    w.close('PaymentMethod');
    w.el('SourceID', sourceId);
    w.el('SystemEntryDate', fmtDateTime(p.created_at, p.payment_date));
    w.el('CustomerID', customerIdOf(customer));
    w.open('Line');
    w.el('LineNumber', 1);
    w.open('SourceDocumentID');
    w.el('OriginatingON', documentRef('FT', p.invoice_number || '', 'FT'));
    w.el('InvoiceDate', p.invoice_date || p.payment_date);
    w.close('SourceDocumentID');
    w.el('CreditAmount', fmtAmount(p.amount));
    w.close('Line');
    w.open('DocumentTotals');
    w.el('TaxPayable', '0.00');
    w.el('NetTotal', fmtAmount(p.amount));
    w.el('GrossTotal', fmtAmount(p.amount));
    w.close('DocumentTotals');
    w.close('Payment');
  }
  w.close('Payments');

  w.close('SourceDocuments');
  w.close('AuditFile');

  // Lacunas de numeração dentro do período
  for (const [series, numbers] of seriesNumbers) {
    const sorted = [...new Set(numbers)].sort((a, b) => a - b);
    const missing: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      for (let n = sorted[i - 1] + 1; n < sorted[i] && missing.length < 20; n++) missing.push(n);
    }
    if (missing.length) {
      warnings.push(`Série ${series}: números em falta no período (${missing.join(', ')}${missing.length >= 20 ? ', ...' : ''}).`);
    }
  }

  return {
    xml: w.toString(),
    warnings,
    summary: {
      invoices: invoices.length,
      annulledInvoices,
      invoicesTotal: round2(totalCredit - totalDebit),
      payments: payments.length,
      annulledPayments,
      paymentsTotal: round2(paymentsTotal),
      customers: customers.length + (needsConsumer ? 1 : 0),
      products: products.length + (needsGenericProduct ? 1 : 0)
    }
  };
}

// ---------------------------------------------------------------------------
// Serviço: recolha dos dados no Supabase
// ---------------------------------------------------------------------------

@Injectable({
  providedIn: 'root'
})
export class SaftService {
  private supabase = inject(SupabaseService);

  /** True se o plano da empresa inclui os Relatórios (onde está o SAF-T). */
  async isEnabled(companyId: string): Promise<boolean> {
    const { data, error } = await this.supabase.db.rpc('subscription_feature_value', {
      p_company_id: companyId,
      p_feature_code: 'reports'
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return !!row?.enabled;
  }

  /** Gera o SAF-T da empresa para o período [startDate, endDate] (AAAA-MM-DD). */
  async generate(company: SaftCompany & { id: string }, startDate: string, endDate: string): Promise<SaftResult> {
    if (startDate.substring(0, 4) !== endDate.substring(0, 4)) {
      throw new Error('O período do SAF-T tem de estar dentro de um único ano fiscal.');
    }
    if (!(await this.isEnabled(company.id))) {
      throw new Error('O ficheiro SAF-T não está disponível no seu plano (requer Relatórios).');
    }

    const [invoiceRows, paymentRows] = await Promise.all([
      this.fetchAll<any>(() => this.supabase.db
        .from('invoices')
        .select('*, items:invoice_items(*), issuer:profiles(full_name)')
        .eq('company_id', company.id)
        .neq('status', 'rascunho')
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true })
        .order('invoice_number', { ascending: true })
        .order('id', { ascending: true })),
      this.fetchAll<any>(() => this.supabase.db
        .from('payments')
        .select('*, invoice:invoices(invoice_number, date, client_id)')
        .eq('company_id', company.id)
        .gte('payment_date', startDate)
        .lte('payment_date', endDate)
        .order('payment_date', { ascending: true })
        .order('id', { ascending: true }))
    ]);

    const invoicesRaw = invoiceRows.filter(i => !String(i.invoice_number || '').startsWith('RSC-'));

    // Data de anulação: coluna própria ou, para registos antigos, a auditoria.
    const annulledWithoutDate = invoicesRaw.filter(i => i.status === 'anulada' && !i.annulled_at).map(i => String(i.id));
    const annulmentDates = new Map<string, string>();
    for (const ids of this.chunk(annulledWithoutDate, 200)) {
      const rows = await this.fetchAll<any>(() => this.supabase.db
        .from('audit_logs')
        .select('entity_id, created_at')
        .eq('company_id', company.id)
        .eq('action', 'Anulou Factura')
        .in('entity_id', ids)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true }));
      for (const row of rows) annulmentDates.set(row.entity_id, row.created_at);
    }

    // Nomes dos utilizadores dos recibos (SourceID)
    const paymentUserIds = [...new Set(paymentRows.map(p => p.created_by).filter(Boolean))] as string[];
    const userNames = new Map<string, string>();
    for (const ids of this.chunk(paymentUserIds, 200)) {
      const { data } = await this.supabase.db.from('profiles').select('id, full_name').in('id', ids);
      for (const row of data || []) if (row.full_name) userNames.set(row.id, row.full_name);
    }

    const invoices: SaftInvoice[] = invoicesRaw.map(i => ({
      id: i.id,
      invoice_number: i.invoice_number,
      type: 'FT',
      date: String(i.date).substring(0, 10),
      status: i.status,
      client_id: i.client_id,
      subtotal: Number(i.subtotal) || 0,
      total: Number(i.total) || 0,
      created_at: i.created_at,
      issued_at: i.issued_at ?? null,
      annulled_at: i.annulled_at ?? annulmentDates.get(String(i.id)) ?? i.updated_at ?? null,
      annulment_reason: i.annulment_reason ?? null,
      source_id: i.issuer?.full_name || i.created_by || null,
      items: [...(i.items || [])]
        // created_at é igual para todas as linhas inseridas no mesmo lote; o id desempata
        // para que a numeração (LineNumber) seja determinística entre exportações.
        .sort((a: any, b: any) =>
          String(a.created_at || '').localeCompare(String(b.created_at || '')) ||
          String(a.id || '').localeCompare(String(b.id || '')))
        .map((item: any) => ({
          product_id: item.product_id,
          product_name: item.product_name,
          description: item.description,
          quantity: Number(item.quantity) || 0,
          unit_price: Number(item.unit_price) || 0,
          subtotal: Number(item.subtotal ?? item.total) || 0
        }))
    }));

    const payments: SaftPayment[] = paymentRows.map(p => ({
      id: p.id,
      receipt_number: p.receipt_number,
      payment_date: String(p.payment_date).substring(0, 10),
      payment_method: p.payment_method,
      amount: Number(p.amount) || 0,
      status: p.status || 'emitido',
      created_at: p.created_at,
      annulled_at: p.annulled_at,
      annulment_reason: p.annulment_reason,
      source_id: userNames.get(p.created_by) || p.created_by || null,
      client_id: p.invoice?.client_id ?? null,
      invoice_number: p.invoice?.invoice_number ?? null,
      invoice_date: p.invoice?.date ? String(p.invoice.date).substring(0, 10) : null
    }));

    // Ficheiros mestre: só clientes e artigos referenciados.
    const clientIds = [...new Set([...invoices, ...payments].map(d => d.client_id).filter(Boolean))] as string[];
    const productIds = [...new Set(invoices.flatMap(i => i.items.map(it => it.product_id)).filter(Boolean))] as string[];

    const customers: SaftCustomer[] = [];
    for (const ids of this.chunk(clientIds, 200)) {
      customers.push(...await this.fetchAll<SaftCustomer>(() => this.supabase.db
        .from('clients')
        .select('id, client_code, name, nuit, address, phone, email')
        .in('id', ids)
        .order('id', { ascending: true })));
    }

    const products: SaftProduct[] = [];
    for (const ids of this.chunk(productIds, 200)) {
      products.push(...await this.fetchAll<SaftProduct>(() => this.supabase.db
        .from('products')
        .select('*')
        .in('id', ids)
        .order('id', { ascending: true })));
    }

    return buildSaftXml({
      company,
      startDate,
      endDate,
      dateCreated: toIsoDate(new Date()),
      customers,
      products,
      invoices,
      payments
    });
  }

  fileName(company: SaftCompany, startDate: string, endDate: string): string {
    return `SAFT_MZ_${company.nuit || 'SEM-NUIT'}_${startDate}_${endDate}.xml`;
  }

  /** Lê todas as páginas de uma consulta (o Supabase devolve no máximo 1000 linhas). */
  private async fetchAll<T>(query: () => any): Promise<T[]> {
    const size = SAFT_CONFIG.pageSize;
    const rows: T[] = [];
    for (let from = 0; ; from += size) {
      const { data, error } = await query().range(from, from + size - 1);
      if (error) throw error;
      rows.push(...((data || []) as T[]));
      if (!data || data.length < size) break;
    }
    return rows;
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
    return chunks;
  }
}
