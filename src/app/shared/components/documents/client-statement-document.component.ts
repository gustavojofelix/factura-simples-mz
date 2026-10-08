import { Component, computed, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Company, companyHasBankDetails } from '../../../core/services/company.service';
import { CompanyBankAccount, documentBankAccounts } from '../../../core/services/company-bank-account.service';
import {
  DocumentBranding,
  DEFAULT_DOCUMENT_BRANDING
} from '../../../core/services/document-settings.service';
import {
  ClientStatement,
  MovementKind,
  StatementService
} from '../../../core/services/statement.service';
import { formatIsoDate } from '../../../core/utils/date.util';
import { PreferencesService } from '../../../core/services/preferences.service';
import { documentThemeVars } from './document-theme';

/**
 * Extracto de um cliente: movimentos do período com saldo corrido.
 *
 * Quando o filtro mostra só facturas ou só recibos, o saldo corrido deixa de
 * bater certo linha a linha e a coluna é ocultada. O saldo final no resumo
 * conta sempre com todos os movimentos.
 */
@Component({
  selector: 'app-client-statement-document',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div [class]="'doc doc--' + branding().template_code" [style]="themeVars()">
      <div class="doc-header">
        <div class="doc-header__identity">
          <p class="doc-caption">EXTRACTO DO CLIENTE</p>
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
          <h3 class="doc-section-title">CLIENTE</h3>
          <p class="doc-party__name">{{ statement().client.name }}</p>
          @if (statement().client.client_code) {
            <p class="doc-party__line">ID: {{ statement().client.client_code }}</p>
          }
          @if (statement().client.nuit) {
            <p class="doc-party__line">NUIT: {{ statement().client.nuit }}</p>
          }
          @if (statement().client.address) {
            <p class="doc-party__line">{{ statement().client.address }}</p>
          }
          @if (statement().client.phone) {
            <p class="doc-party__line">Tel.: {{ statement().client.phone }}</p>
          }
          @if (statement().client.email) {
            <p class="doc-party__line">{{ statement().client.email }}</p>
          }
        </div>
      </div>

      <div class="doc-items">
        <h3 class="doc-block-title">
          Movimentos do período{{ filter() === 'factura' ? ' · só facturas' : filter() === 'recibo' ? ' · só recibos' : '' }}
        </h3>
        <div class="doc-table-wrap">
          <table class="doc-table statement-table">
            <thead>
              <tr>
                <th class="is-left">Data</th>
                <th class="is-left">Documento</th>
                <th class="is-left">Descrição</th>
                <th class="is-right">Facturado</th>
                <th class="is-right">Pago</th>
                @if (showBalance()) {
                  <th class="is-right">Saldo</th>
                }
              </tr>
            </thead>
            <tbody>
              @if (showBalance()) {
                <tr class="opening-row">
                  <td class="is-left">{{ formatDate(start()) }}</td>
                  <td class="is-left">—</td>
                  <td class="is-left">Saldo anterior</td>
                  <td class="is-right">—</td>
                  <td class="is-right">—</td>
                  <td class="is-right is-strong">{{ formatCurrency(statement().opening_balance) }}</td>
                </tr>
              }
              @for (m of visibleMovements(); track m.kind + m.document + m.date) {
                <tr>
                  <td class="is-left">{{ formatDate(m.date) }}</td>
                  <td class="is-left">{{ m.document }}</td>
                  <td class="is-left">{{ m.description }}</td>
                  <td class="is-right">{{ m.invoiced ? formatCurrency(m.invoiced) : '—' }}</td>
                  <td class="is-right">{{ m.paid ? formatCurrency(m.paid) : '—' }}</td>
                  @if (showBalance()) {
                    <td class="is-right is-strong">{{ formatCurrency(m.balance) }}</td>
                  }
                </tr>
              } @empty {
                <tr>
                  <td class="is-left" [attr.colspan]="showBalance() ? 6 : 5">Sem movimentos no período.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>

      <div class="doc-totals">
        <div class="doc-totals__inner">
          @if (showBalance()) {
            <div class="doc-total-line">
              <span>Saldo anterior:</span>
              <span>{{ formatCurrency(statement().opening_balance) }}</span>
            </div>
          }
          @if (filter() !== 'recibo') {
            <div class="doc-total-line">
              <span>Total facturado:</span>
              <span>{{ formatCurrency(totalInvoiced()) }}</span>
            </div>
          }
          @if (filter() !== 'factura') {
            <div class="doc-total-line doc-total-line--paid">
              <span>Total pago:</span>
              <span>{{ formatCurrency(totalPaid()) }}</span>
            </div>
          }
          <div class="doc-total-line doc-total-line--main" [class.doc-total-line--due]="finalBalance() > 0">
            <span>Saldo em dívida:</span>
            <span class="doc-total-value">{{ formatCurrency(finalBalance()) }}</span>
          </div>
        </div>
      </div>

      @if (notes()) {
        <div class="doc-notes">
          <h3 class="doc-section-title">OBSERVAÇÕES</h3>
          <p class="doc-notes__text">{{ notes() }}</p>
        </div>
      }

      @if (branding().show_bank_details && hasBankDetails() && finalBalance() > 0) {
        <div class="doc-bank">
          <h3 class="doc-section-title">COORDENADAS BANCÁRIAS</h3>
          @if (visibleBankAccounts().length > 0) {
            <div class="doc-bank__accounts">
              @for (acc of visibleBankAccounts(); track acc.id ?? $index) {
                <div class="doc-bank__account">
                  @if (acc.bank_name) {
                    <span class="doc-bank__bank">{{ acc.bank_name }}{{ acc.currency && acc.currency !== 'MZN' ? ' (' + acc.currency + ')' : '' }}</span>
                  }
                  <div class="doc-bank__rows">
                    @if (acc.account_holder) {
                      <div><span class="doc-bank__label">Titular</span><span class="doc-bank__value">{{ acc.account_holder }}</span></div>
                    }
                    @if (acc.account_number) {
                      <div><span class="doc-bank__label">Conta</span><span class="doc-bank__value">{{ acc.account_number }}</span></div>
                    }
                    @if (acc.nib) {
                      <div><span class="doc-bank__label">NIB</span><span class="doc-bank__value">{{ acc.nib }}</span></div>
                    }
                    @if (acc.iban) {
                      <div><span class="doc-bank__label">IBAN</span><span class="doc-bank__value">{{ acc.iban }}</span></div>
                    }
                    @if (acc.swift) {
                      <div><span class="doc-bank__label">SWIFT/BIC</span><span class="doc-bank__value">{{ acc.swift }}</span></div>
                    }
                  </div>
                </div>
              }
            </div>
          }
          @if (company()!.mpesa_number || company()!.emola_number) {
            <div class="doc-bank__grid doc-bank__mobile">
              @if (company()!.mpesa_number) {
                <div>
                  <span class="doc-bank__label">M-Pesa</span>
                  <span class="doc-bank__value">{{ company()!.mpesa_number }}</span>
                </div>
              }
              @if (company()!.emola_number) {
                <div>
                  <span class="doc-bank__label">e-Mola</span>
                  <span class="doc-bank__value">{{ company()!.emola_number }}</span>
                </div>
              }
            </div>
          }
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

    .opening-row td {
      font-style: italic;
      background: #f9fafb;
    }
  `]
})
export class ClientStatementDocumentComponent {
  statement = input.required<ClientStatement>();
  filter = input<'all' | MovementKind>('all');
  start = input.required<string>();
  end = input.required<string>();
  issuedAt = input.required<string>();
  issuerName = input<string>('');
  notes = input<string>('');
  company = input<Company | null>(null);
  branding = input<DocumentBranding>(DEFAULT_DOCUMENT_BRANDING);
  /**
   * Contas bancárias da empresa (company_bank_accounts). null = não disponíveis,
   * caso em que se mostra o banco antigo guardado em companies.
   */
  bankAccounts = input<CompanyBankAccount[] | null>(null);

  private statementService = inject(StatementService);
  /** Formato de data de Configurações > Sistema. */
  private preferences = inject(PreferencesService);

  themeVars = computed(() => documentThemeVars(this.branding()));
  hasBankDetails = computed(() => companyHasBankDetails(this.company(), this.bankAccounts()));
  /** Contas visíveis, a conta por omissão primeiro (ou o banco antigo de companies). */
  visibleBankAccounts = computed(() => documentBankAccounts(this.company(), this.bankAccounts()));
  showBalance = computed(() => this.filter() === 'all');

  visibleMovements = computed(() => {
    const filter = this.filter();
    const movements = this.statement().movements;
    return filter === 'all' ? movements : movements.filter(m => m.kind === filter);
  });

  private clientTotals = computed(() => this.statementService.clientTotals(this.statement()));
  totalInvoiced = computed(() => this.clientTotals().invoiced);
  totalPaid = computed(() => this.clientTotals().paid);
  finalBalance = computed(() => this.clientTotals().balance);

  formatCurrency(value: number): string {
    return this.statementService.formatCurrency(value);
  }

  formatDate(iso: string): string {
    return formatIsoDate(iso, this.preferences.dateFormat());
  }
}
