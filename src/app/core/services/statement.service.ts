import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';

export type StatementStatus = 'pago' | 'em_divida' | 'vencido';

/** Uma linha do extracto geral: a posição de um cliente no período. */
export interface ClientStatementSummaryRow {
  client_id: string;
  client_code: string | null;
  client_name: string;
  client_nuit: string | null;
  opening_balance: number;
  total_invoiced: number;
  total_paid: number;
  balance: number;
  overdue_amount: number;
  invoice_count: number;
  receipt_count: number;
  status: StatementStatus;
}

export interface StatementClient {
  id: string;
  client_code: string | null;
  name: string;
  nuit: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
}

export type MovementKind = 'factura' | 'recibo';

/** Um movimento do extracto de um cliente: uma factura ou um recibo. */
export interface StatementMovement {
  kind: MovementKind;
  date: string;
  document: string;
  description: string;
  invoice_id: string;
  invoice_number: string;
  payment_id: string | null;
  invoiced: number;
  paid: number;
  /** Saldo acumulado depois deste movimento, contando com o saldo anterior. */
  balance: number;
}

export interface ClientStatement {
  client: StatementClient;
  opening_balance: number;
  movements: StatementMovement[];
}

export interface StatementTotals {
  opening_balance: number;
  total_invoiced: number;
  total_paid: number;
  balance: number;
}

/**
 * Extractos de clientes. Os cálculos são feitos no servidor
 * (migração create_client_statement_functions), onde também é validado
 * o acesso: só Proprietário, Admin e Gestor.
 */
@Injectable({
  providedIn: 'root'
})
export class StatementService {
  private supabase = inject(SupabaseService);

  /**
   * @param start 'AAAA-MM-DD'
   * @param end 'AAAA-MM-DD'
   * @param clientIds limita o extracto a estes clientes; vazio = todos
   */
  async getSummary(
    companyId: string,
    start: string,
    end: string,
    clientIds?: string[]
  ): Promise<ClientStatementSummaryRow[]> {
    const { data, error } = await this.supabase.db.rpc('client_statement_summary', {
      p_company_id: companyId,
      p_start: start,
      p_end: end,
      p_client_ids: clientIds && clientIds.length > 0 ? clientIds : null
    });

    if (error) throw error;

    return (data || []).map((row: any) => ({
      ...row,
      opening_balance: Number(row.opening_balance) || 0,
      total_invoiced: Number(row.total_invoiced) || 0,
      total_paid: Number(row.total_paid) || 0,
      balance: Number(row.balance) || 0,
      overdue_amount: Number(row.overdue_amount) || 0
    }));
  }

  async getClientStatement(
    companyId: string,
    clientId: string,
    start: string,
    end: string
  ): Promise<ClientStatement> {
    const { data, error } = await this.supabase.db.rpc('client_statement_movements', {
      p_company_id: companyId,
      p_client_id: clientId,
      p_start: start,
      p_end: end
    });

    if (error) throw error;

    const opening = Number(data?.opening_balance) || 0;
    let running = opening;

    const movements: StatementMovement[] = (data?.movements || []).map((m: any) => {
      const invoiced = Number(m.invoiced) || 0;
      const paid = Number(m.paid) || 0;
      running = Math.round((running + invoiced - paid) * 100) / 100;

      return {
        kind: m.kind,
        date: m.date,
        document: m.document || '',
        description: this.describeMovement(m),
        invoice_id: m.invoice_id,
        invoice_number: m.invoice_number,
        payment_id: m.payment_id,
        invoiced,
        paid,
        balance: running
      };
    });

    return { client: data.client, opening_balance: opening, movements };
  }

  private describeMovement(m: any): string {
    if (m.kind === 'recibo') {
      const method = this.paymentMethodLabel(m.payment_method);
      return `Pagamento da ${m.invoice_number}${method ? ' · ' + method : ''}`;
    }

    const count = Number(m.item_count) || 0;
    if (!m.first_item) return 'Venda';
    return count > 1 ? `${m.first_item} e mais ${count - 1} item(s)` : m.first_item;
  }

  private paymentMethodLabel(method: string | null): string {
    const labels: Record<string, string> = {
      dinheiro: 'Dinheiro',
      transferencia: 'Transferência',
      cheque: 'Cheque',
      carteira_movel: 'Carteira móvel',
      outro: 'Outro'
    };
    return method ? labels[method] || method : '';
  }

  /** Totais do período e saldo final, sempre com todos os movimentos. */
  clientTotals(statement: ClientStatement): { invoiced: number; paid: number; balance: number } {
    const invoiced = statement.movements.reduce((sum, m) => sum + m.invoiced, 0);
    const paid = statement.movements.reduce((sum, m) => sum + m.paid, 0);
    const balance = Math.round((statement.opening_balance + invoiced - paid) * 100) / 100;
    return { invoiced, paid, balance };
  }

  totals(rows: ClientStatementSummaryRow[]): StatementTotals {
    return rows.reduce<StatementTotals>((acc, row) => ({
      opening_balance: acc.opening_balance + row.opening_balance,
      total_invoiced: acc.total_invoiced + row.total_invoiced,
      total_paid: acc.total_paid + row.total_paid,
      balance: acc.balance + row.balance
    }), { opening_balance: 0, total_invoiced: 0, total_paid: 0, balance: 0 });
  }

  /** Cliente sem qualquer movimento nem saldo no período. */
  isInactive(row: ClientStatementSummaryRow): boolean {
    return row.invoice_count === 0
      && row.receipt_count === 0
      && Math.abs(row.opening_balance) < 0.005;
  }

  getStatusLabel(status: StatementStatus): string {
    const labels: Record<StatementStatus, string> = {
      pago: 'Pago',
      em_divida: 'Em dívida',
      vencido: 'Vencido'
    };
    return labels[status] || status;
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('pt-MZ', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value || 0) + ' MZN';
  }
}
