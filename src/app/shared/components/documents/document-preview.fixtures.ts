import { Invoice } from '../../../core/services/invoice.service';
import { Payment } from '../../../core/services/payment.service';
import { Company } from '../../../core/services/company.service';

/**
 * Dados de exemplo para a pré-visualização no ecrã de configurações.
 *
 * Servem apenas para desenhar o documento enquanto o utilizador escolhe o
 * modelo e as cores. Nunca são gravados nem enviados.
 */
export const SAMPLE_INVOICE: Invoice = {
  id: 'pre-visualizacao',
  company_id: 'pre-visualizacao',
  client_id: 'pre-visualizacao',
  invoice_number: 'FAC00042',
  date: '2026-09-15',
  due_date: '2026-09-30',
  subtotal: 18750,
  total: 18750,
  amount_paid: 6750,
  amount_pending: 12000,
  status: 'pendente',
  notes: 'Entrega efectuada nas instalações do cliente.',
  created_at: '2026-09-15T10:24:00.000Z',
  issuer_name: 'Ana Machava',
  print_count: 1,
  client: {
    name: 'Comercial Zambeze, Lda',
    nuit: '400123456',
    email: 'geral@zambeze.co.mz',
    phone: '+258 84 000 0000',
    address: 'Av. 25 de Setembro, 1200, Maputo'
  },
  items: [
    {
      id: 'exemplo-1',
      product_id: 'exemplo-1',
      product_name: 'Consultoria contabilística',
      quantity: 3,
      unit_price: 3500,
      subtotal: 10500,
      total: 10500
    },
    {
      id: 'exemplo-2',
      product_id: 'exemplo-2',
      product_name: 'Resmas de papel A4',
      quantity: 15,
      unit_price: 350,
      subtotal: 5250,
      total: 5250
    },
    {
      id: 'exemplo-3',
      product_id: 'exemplo-3',
      product_name: 'Manutenção de equipamento',
      quantity: 1,
      unit_price: 3000,
      subtotal: 3000,
      total: 3000
    }
  ]
};

/**
 * Pagamento de exemplo, coerente com a factura acima: corresponde ao valor já
 * pago, para que os totais do recibo façam sentido na pré-visualização.
 */
export const SAMPLE_PAYMENT: Payment = {
  id: 'a1b2c3d4-0000-0000-0000-000000000000',
  invoice_id: 'pre-visualizacao',
  receipt_number: 'REC00031',
  amount: 6750,
  payment_date: '2026-09-22',
  payment_method: 'transferencia',
  reference: 'TRF 884213',
  notes: 'Pagamento parcial acordado com o cliente.',
  created_at: '2026-09-22T09:10:00.000Z'
};

/** Empresa de exemplo, usada quando ainda não há dados reais carregados. */
export const SAMPLE_COMPANY: Company = {
  id: 'pre-visualizacao',
  user_id: 'pre-visualizacao',
  name: 'A Sua Empresa, Lda',
  nuit: '400999888',
  address: 'Rua dos Desportistas, 45, Maputo',
  currency: 'MZN',
  invoice_prefix: 'FAC',
  invoice_number: 42,
  bank_name: 'Banco Exemplo',
  bank_account: '000123456789',
  bank_iban: 'MZ59000100000011834194157',
  bank_swift: 'EXMPMZMX'
} as Company;
