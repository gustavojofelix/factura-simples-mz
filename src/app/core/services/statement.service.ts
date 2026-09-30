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
