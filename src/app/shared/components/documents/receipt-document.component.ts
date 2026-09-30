import { Component, computed, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Invoice, InvoiceService } from '../../../core/services/invoice.service';
import { Payment, PaymentService } from '../../../core/services/payment.service';
import { Company } from '../../../core/services/company.service';
import {
  DocumentBranding,
  DEFAULT_DOCUMENT_BRANDING
} from '../../../core/services/document-settings.service';
import { documentThemeVars } from './document-theme';

/**
 * O recibo de pagamento.
 *
 * Tem corpo próprio, porque um recibo não é uma factura, mas partilha o
 * cabeçalho de marca, o rodapé e as folhas de estilo dos modelos com a
 * factura. Assim os dois documentos de uma empresa saem coerentes entre si.
 */
@Component({
  selector: 'app-receipt-document',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="doc" [class]="'doc doc--' + branding().template_code" [style]="themeVars()">

      @if (payment().status === 'anulado') {
        <div class="doc-watermark doc-watermark--annulled">ANULADO</div>
      }

      <div class="doc-header">
        <div class="doc-header__identity">
          <p class="doc-caption">RECIBO DE PAGAMENTO</p>
          <h1 class="doc-number">{{ receiptNumber() }}</h1>
          <p class="doc-issued">Data: {{ formatDate(payment().payment_date) }}</p>
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
              <p class="doc-party__line">Tel: {{ company()!.phone }}</p>
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
          }
        </div>
      </div>

      <div class="doc-items">
        <h3 class="doc-block-title">Referente à factura {{ invoice().invoice_number }}</h3>
        <div class="doc-table-wrap">
          <table class="doc-table">
            <thead>
              <tr>
                <th class="is-left">Descrição</th>
                <th class="is-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td class="is-left">
                  <span class="doc-receipt__description">Pagamento da factura {{ invoice().invoice_number }}</span>
                  <span class="doc-receipt__meta">Método: {{ paymentMethodLabel() }}</span>
                  @if (payment().reference) {
                    <span class="doc-receipt__meta">Referência: {{ payment().reference }}</span>
                  }
                </td>
                <td class="is-right is-strong">{{ formatCurrency(payment().amount) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="doc-totals">
        <div class="doc-totals__inner">
          <div class="doc-total-line doc-total-line--main">
            <span>Total pago:</span>
            <span class="doc-total-value">{{ formatCurrency(payment().amount) }}</span>
          </div>
          <div class="doc-total-line">
            <span>Total da factura:</span>
            <span>{{ formatCurrency(invoice().total) }}</span>
          </div>
          <div class="doc-total-line doc-total-line--paid">
            <span>Pago acumulado:</span>
            <span>{{ formatCurrency(invoice().amount_paid) }}</span>
          </div>
          <div class="doc-total-line" [class.doc-total-line--due]="invoice().amount_pending > 0">
            <span>Saldo restante:</span>
            <span>{{ formatCurrency(invoice().amount_pending) }}</span>
          </div>
        </div>
      </div>

      @if (payment().notes) {
        <div class="doc-notes">
          <h3 class="doc-section-title">OBSERVAÇÕES</h3>
          <p class="doc-notes__text">{{ payment().notes }}</p>
        </div>
      }

      <div class="doc-footer">
        @if (branding().thank_you_message) {
          <p class="doc-footer__thanks">{{ branding().thank_you_message }}</p>
        }
        <p class="doc-footer__text">Este documento é válido sem assinatura.</p>
        @if (branding().footer_text) {
          <p class="doc-footer__text">{{ branding().footer_text }}</p>
        }
      </div>
    </div>
  `,
  styleUrls: ['./document-skins.css'],
  styles: [`
    .doc-receipt__description {
      display: block;
      font-weight: 600;
      color: #1e293b;
      white-space: normal;
    }

    .doc-receipt__meta {
      display: block;
      margin-top: 2px;
      font-size: 12px;
      color: #6b7280;
      white-space: normal;
    }
  `]
})
export class ReceiptDocumentComponent {
  payment = input.required<Payment>();
  invoice = input.required<Invoice>();
  company = input<Company | null>(null);
  branding = input<DocumentBranding>(DEFAULT_DOCUMENT_BRANDING);

  private invoiceService = inject(InvoiceService);
  private paymentService = inject(PaymentService);

  themeVars = computed(() => documentThemeVars(this.branding()));

  receiptNumber = computed(() => this.paymentService.getReceiptNumber(this.payment()));

  paymentMethodLabel = computed(() =>
    this.paymentService.getPaymentMethodLabel(this.payment().payment_method)
  );

  formatCurrency(value: number): string {
    return this.invoiceService.formatCurrency(value);
  }

  formatDate(date: string): string {
    return this.invoiceService.formatDate(date);
  }
}
