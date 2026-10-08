import { Component, computed, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Company } from '../../../core/services/company.service';
import {
  DocumentBranding,
  DEFAULT_DOCUMENT_BRANDING
} from '../../../core/services/document-settings.service';
import {
  ClientStatementSummaryRow,
  StatementService
} from '../../../core/services/statement.service';
import { formatIsoDate } from '../../../core/utils/date.util';
import { PreferencesService } from '../../../core/services/preferences.service';
import { documentThemeVars } from './document-theme';

/**
 * Extracto geral dos clientes: a posição de cada cliente da empresa no período.
 *
 * Usa as mesmas folhas de estilo da factura e do recibo, por isso segue o
 * modelo e as cores escolhidos em Configurações → Documentos.
 */
@Component({
  selector: 'app-summary-statement-document',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div [class]="'doc doc--' + branding().template_code" [style]="themeVars()">
      <div class="doc-header">
        <div class="doc-header__identity">
          <p class="doc-caption">EXTRACTO DOS CLIENTES</p>
          <h1 class="doc-number">{{ formatDate(start()) }} a {{ formatDate(end()) }}</h1>
          <p class="doc-issued">Data do extracto: {{ formatDate(issuedAt()) }}</p>
          <p class="doc-issuer">Emitido por: {{ issuerName() || '-' }}</p>
        </div>

        @if (branding().show_logo && company()?.logo_url) {
          <div class="doc-logo">
            <img [src]="company()!.logo_url" alt="Logótipo">
          </div>
        }
      </div>

      <div class="doc-parties">
        <div class="doc-party">
          <h3 class="doc-section-title">EMPRESA</h3>
          @if (company()) {
            <p class="doc-party__name">{{ company()!.name }}</p>
            @if (company()!.nuit) {
              <p class="doc-party__line">NUIT: {{ company()!.nuit }}</p>
            }
            @if (company()!.address) {
              <p class="doc-party__line">{{ company()!.address }}</p>
            }
            @if (company()!.phone) {
              <p class="doc-party__line">Tel.: {{ company()!.phone }}</p>
            }
            @if (company()!.email) {
              <p class="doc-party__line">{{ company()!.email }}</p>
            }
          }
        </div>

        <div class="doc-party">
          <h3 class="doc-section-title">RESUMO</h3>
          <p class="doc-party__line">Clientes: {{ rows().length }}</p>
          <p class="doc-party__line">Em dívida: {{ debtorCount() }}</p>
          <p class="doc-party__line">Saldo total: {{ formatCurrency(totals().balance) }}</p>
        </div>
      </div>

      <div class="doc-items">
        <div class="doc-table-wrap">
          <table class="doc-table statement-table">
            <thead>
              <tr>
                <th class="is-left">ID</th>
                <th class="is-left">Cliente</th>
                <th class="is-right">Saldo anterior</th>
                <th class="is-right">Total facturado</th>
                <th class="is-right">Total pago</th>
                <th class="is-right">Saldo</th>
                <th class="is-left">Estado</th>
              </tr>
            </thead>
            <tbody>
              @for (row of rows(); track row.client_id) {
                <tr>
                  <td class="is-left">{{ row.client_code || '-' }}</td>
                  <td class="is-left">{{ row.client_name }}</td>
                  <td class="is-right">{{ formatCurrency(row.opening_balance) }}</td>
                  <td class="is-right">{{ formatCurrency(row.total_invoiced) }}</td>
                  <td class="is-right">{{ formatCurrency(row.total_paid) }}</td>
                  <td class="is-right is-strong">{{ formatCurrency(row.balance) }}</td>
                  <td class="is-left" [class]="'status status--' + row.status">{{ statusLabel(row) }}</td>
                </tr>
              }
            </tbody>
            <tfoot>
              <tr>
                <td class="is-left" colspan="2">TOTAL</td>
                <td class="is-right">{{ formatCurrency(totals().opening_balance) }}</td>
                <td class="is-right">{{ formatCurrency(totals().total_invoiced) }}</td>
                <td class="is-right">{{ formatCurrency(totals().total_paid) }}</td>
                <td class="is-right">{{ formatCurrency(totals().balance) }}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      @if (notes()) {
        <div class="doc-notes">
          <h3 class="doc-section-title">OBSERVAÇÕES</h3>
          <p class="doc-notes__text">{{ notes() }}</p>
        </div>
      }

      @if (branding().footer_text) {
        <div class="doc-footer">
          <p class="doc-footer__text">{{ branding().footer_text }}</p>
        </div>
      }
    </div>
  `,
  styleUrls: ['./document-skins.css'],
  styles: [`
    .statement-table th,
    .statement-table td {
      font-size: 12px;
      padding: 8px 10px;
    }

    .statement-table tfoot td {
      font-weight: 700;
      border-top: 2px solid #1f2937;
      padding-top: 10px;
    }

    .status--pago { color: #15803d; font-weight: 600; }
    .status--em_divida { color: #b45309; font-weight: 600; }
    .status--vencido { color: #b91c1c; font-weight: 600; }
  `]
})
export class SummaryStatementDocumentComponent {
  rows = input.required<ClientStatementSummaryRow[]>();
  start = input.required<string>();
  end = input.required<string>();
  issuedAt = input.required<string>();
  issuerName = input<string>('');
  notes = input<string>('');
  company = input<Company | null>(null);
  branding = input<DocumentBranding>(DEFAULT_DOCUMENT_BRANDING);

  private statementService = inject(StatementService);
  /** Formato de data de Configurações > Sistema. */
  private preferences = inject(PreferencesService);

  themeVars = computed(() => documentThemeVars(this.branding()));
  totals = computed(() => this.statementService.totals(this.rows()));
  debtorCount = computed(() => this.rows().filter(r => r.status !== 'pago').length);

  statusLabel(row: ClientStatementSummaryRow): string {
    return this.statementService.getStatusLabel(row.status);
  }

  formatCurrency(value: number): string {
    return this.statementService.formatCurrency(value);
  }

  formatDate(iso: string): string {
    return formatIsoDate(iso, this.preferences.dateFormat());
  }
}
