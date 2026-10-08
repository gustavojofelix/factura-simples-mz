/**
 * Configuração do ficheiro SAF-T (MZ).
 *
 * A AT de Moçambique ainda não publicou um XSD próprio: o ficheiro segue a
 * estrutura SAF-T (PT) 1.04_01, com TaxCountryRegion 'MZ' e moeda MZN.
 * Todos os valores que dependem dessa confirmação estão aqui, num só lugar.
 */
export const SAFT_CONFIG = {
  /** Namespace do AuditFile. Trocar quando existir o XSD oficial SAF-T (MZ). */
  namespace: 'urn:OECD:StandardAuditFile-Tax:PT_1.04_01',
  auditFileVersion: '1.04_01',
  countryCode: 'MZ',
  defaultCurrency: 'MZN',
  /** 'F' = facturação (só documentos comerciais, sem contabilidade). */
  taxAccountingBasis: 'F',
  taxEntity: 'Global',

  /** Produtor do software. */
  // TODO: substituir pelo NUIT da Law Technology Solutions (a fornecer pelo cliente).
  productCompanyTaxID: '000000000',
  productID: 'ISPC Fácil/Law Technology Solutions',
  productVersion: '1.0.0',
  /** Software ainda não certificado pela AT. */
  softwareCertificateNumber: '0',

  /** Sem assinatura digital dos documentos: ficheiro informativo. */
  hash: '0',
  hashControl: '0',
  atcud: '0',

  /** Clientes sem NUIT. */
  consumerTaxID: '999999999',
  consumerName: 'Consumidor final',
  consumerCustomerID: 'CONSUMIDOR-FINAL',

  /** Empresas no ISPC: não liquidam IVA. */
  tax: {
    type: 'IVA',
    code: 'ISE',
    percentage: 0,
    description: 'Isento — Regime ISPC',
    exemptionReason: 'Isento de IVA — sujeito ao ISPC (Lei n.º 5/2009)',
    exemptionCode: 'M99'
  },

  /** Valores por omissão para moradas incompletas. */
  unknown: 'Desconhecido',
  unknownPostalCode: '0000',

  /** Artigo genérico para linhas cujo produto foi eliminado. */
  genericProductCode: 'DIV',
  genericProductDescription: 'Diversos',

  /** Limite de linhas por pedido ao Supabase. */
  pageSize: 1000
} as const;

/** payments.payment_method → PaymentMechanism do SAF-T. */
export const SAFT_PAYMENT_MECHANISMS: Record<string, string> = {
  dinheiro: 'NU',
  transferencia: 'TB',
  cheque: 'CH',
  carteira_movel: 'OU',
  mpesa: 'OU',
  emola: 'OU',
  outro: 'OU'
};
