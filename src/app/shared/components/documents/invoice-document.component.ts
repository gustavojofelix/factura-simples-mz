import { Component, computed, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Invoice, InvoiceService } from '../../../core/services/invoice.service';
import { Company, companyHasBankDetails } from '../../../core/services/company.service';
import {
  DocumentBranding,
  DEFAULT_DOCUMENT_BRANDING
} from '../../../core/services/document-settings.service';
import { documentThemeVars } from './document-theme';

/**
 * O documento fiscal da factura.
 *
 * Existe um único template. Os modelos visuais são folhas de estilo aplicadas
 * pela classe da raiz, nunca cópias da marcação. Isto é deliberado: os campos
 * exigidos por lei são escritos uma só vez, por isso nenhum modelo os pode
 * perder.
 *
 * Nada aqui dentro é interface da aplicação. Sem botões, sem histórico de
 * pagamentos, sem ícones tipográficos. O que estiver neste componente é o que
 * o cliente recebe em PDF.
 */
@Component({
  selector: 'app-invoice-document',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="doc" [class]="'doc doc--' + branding().template_code" [style]="themeVars()">

      @if (invoice().status === 'anulada') {
        <div class="doc-watermark doc-watermark--annulled">ANULADO</div>
      } @else if (isReprint()) {
        <div class="doc-watermark doc-watermark--reprint">2ª VIA</div>
      }

      <!-- ================================================================
           ZONA FIXA — os campos abaixo são exigidos por lei.
           Não devem ser condicionados por definições de personalização.
           ================================================================ -->
      <div class="doc-header">
        <div class="doc-header__identity">
          <p class="doc-caption">FACTURA</p>
          <h1 class="doc-number">{{ invoice().invoice_number }}</h1>
          <p class="doc-issued">Data e Hora de Emissão: {{ formatDateTime(invoice().created_at || invoice().date) }}</p>
          @if (invoice().due_date) {
            <p class="doc-issued">Data de Vencimento: {{ formatDate(invoice().due_date!) }}</p>
          }
          <p class="doc-issuer">Emitido por: {{ invoice().issuer_name || '-' }}</p>
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
          }
        </div>

        <div class="doc-party">
          <h3 class="doc-section-title">CLIENTE</h3>
          @if (invoice().client) {
            <p class="doc-party__name">{{ invoice().client!.name }}</p>
            @if (invoice().client!.document_type || invoice().client!.nuit) {
              <p class="doc-party__line">{{ invoice().client!.document_type || 'NUIT: ' + invoice().client!.nuit }}</p>
            }
            @if (invoice().client!.address) {
              <p class="doc-party__line">{{ invoice().client!.address }}</p>
            }
            @if (invoice().client!.phone) {
              <p class="doc-party__line">Tel: {{ invoice().client!.phone }}</p>
            }
            @if (invoice().client!.email) {
              <p class="doc-party__line">{{ invoice().client!.email }}</p>
            }
          }
        </div>
      </div>

      <div class="doc-items">
        <h3 class="doc-block-title">Itens da Factura</h3>
        <div class="doc-table-wrap">
          <table class="doc-table">
            <thead>
              <tr>
                <th class="is-left">Produto/Serviço</th>
                <th class="is-center">Quantidade</th>
                <th class="is-right">Preço Unit.</th>
                <th class="is-right">Subtotal</th>
                <th class="is-right">Total</th>
              </tr>
            </thead>
            <tbody>
              @for (item of invoice().items || []; track item.id) {
                <tr>
                  <td class="is-left">{{ item.product_name }}</td>
                  <td class="is-center">{{ item.quantity }}</td>
                  <td class="is-right">{{ formatCurrency(item.unit_price) }}</td>
                  <td class="is-right">{{ formatCurrency(item.subtotal) }}</td>
                  <td class="is-right is-strong">{{ formatCurrency(item.total) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>

      <div class="doc-totals">
        <div class="doc-totals__inner">
          <div class="doc-total-line doc-total-line--main">
            <span>Total:</span>
            <span class="doc-total-value">{{ formatCurrency(invoice().total) }}</span>
          </div>
          @if (invoice().amount_paid > 0) {
            <div class="doc-total-line doc-total-line--paid">
              <span>Pago:</span>
              <span>{{ formatCurrency(invoice().amount_paid) }}</span>
            </div>
            <div class="doc-total-line" [class.doc-total-line--due]="invoice().amount_pending > 0">
              <span>Pendente:</span>
              <span>{{ formatCurrency(invoice().amount_pending) }}</span>
            </div>
          }
        </div>
      </div>
      <!-- ================= FIM DA ZONA FIXA ============================= -->

      @if (invoice().notes) {
        <div class="doc-notes">
          <h3 class="doc-section-title">OBSERVAÇÕES</h3>
          <p class="doc-notes__text">{{ invoice().notes }}</p>
        </div>
      }

      @if (branding().show_bank_details && hasBankDetails()) {
        <div class="doc-bank">
          <h3 class="doc-section-title">COORDENADAS BANCÁRIAS</h3>
          <div class="doc-bank__grid">
            @if (company()!.bank_name) {
              <div>
                <span class="doc-bank__label">Banco</span>
                <span class="doc-bank__value">{{ company()!.bank_name }}</span>
              </div>
            }
            @if (company()!.bank_account) {
              <div>
                <span class="doc-bank__label">Conta</span>
                <span class="doc-bank__value">{{ company()!.bank_account }}</span>
              </div>
            }
            @if (company()!.bank_iban) {
              <div class="doc-bank__wide">
                <span class="doc-bank__label">IBAN</span>
                <span class="doc-bank__value">{{ company()!.bank_iban }}</span>
              </div>
            }
            @if (company()!.bank_swift) {
              <div>
                <span class="doc-bank__label">SWIFT/BIC</span>
                <span class="doc-bank__value">{{ company()!.bank_swift }}</span>
              </div>
            }
            @if (company()!.nib) {
              <div class="doc-bank__wide">
                <span class="doc-bank__label">NIB</span>
                <span class="doc-bank__value">{{ company()!.nib }}</span>
              </div>
            }
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
        </div>
      }

      @if (branding().thank_you_message || branding().footer_text) {
        <div class="doc-footer">
          @if (branding().thank_you_message) {
            <p class="doc-footer__thanks">{{ branding().thank_you_message }}</p>
          }
          @if (branding().footer_text) {
            <p class="doc-footer__text">{{ branding().footer_text }}</p>
          }
        </div>
      }
    </div>
  `,
  styleUrls: ['./document-skins.css']
})
export class InvoiceDocumentComponent {
  invoice = input.required<Invoice>();
  company = input<Company | null>(null);
  branding = input<DocumentBranding>(DEFAULT_DOCUMENT_BRANDING);

  /**
   * Na pré-visualização não faz sentido mostrar a marca de água de segunda via,
   * que depende do histórico de impressões de um documento real.
   */
  preview = input(false);

  private invoiceService = inject(InvoiceService);

  themeVars = computed(() => documentThemeVars(this.branding()));
  hasBankDetails = computed(() => companyHasBankDetails(this.company()));

  isReprint = computed(() =>
    !this.preview() && (this.invoice().print_count || 0) > 1
  );

  formatCurrency(value: number): string {
    return this.invoiceService.formatCurrency(value);
  }

  formatDateTime(date?: string): string {
    return this.invoiceService.formatDateTime(date);
  }

  formatDate(date: string): string {
    return this.invoiceService.formatDate(date);
  }
}
