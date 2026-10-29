import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { PosSale, PosService } from '../../core/services/pos.service';
import { CompanyService } from '../../core/services/company.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { formatPosDate, formatPosMoney } from './pos-format';

export interface PosReceiptDialogData {
  sale: PosSale;
  /** true logo após finalizar: mostra "Nova venda" em vez de "Fechar". */
  justCompleted?: boolean;
}

/** Labels fixos em PT: o talão impresso é um documento fiscal (ver i18n.ts). */
const PRINT_LABELS: Record<string, string> = {
  cash: 'Numerário', mpesa: 'M-Pesa', emola: 'e-Mola', card: 'Cartão', transfer: 'Transferência'
};

@Component({
  selector: 'app-pos-receipt-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, TranslatePipe],
  template: `
    <div class="p-6 max-w-md">
      <div class="text-center mb-5">
        @if (data.justCompleted) {
          <div class="w-14 h-14 mx-auto mb-3 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
            <i class="fa-solid fa-check text-2xl" aria-hidden="true"></i>
          </div>
          <h2 class="text-xl font-bold text-slate-900">{{ 'pos.receipt.title' | t }}</h2>
        } @else {
          <h2 class="text-xl font-bold text-slate-900">{{ 'pos.receipt.titleView' | t: { number: sale.number } }}</h2>
        }
        <p class="text-sm text-slate-500 mt-1">{{ sale.number }} · {{ date(sale.created_at) }}</p>
        @if (sale.status === 'cancelled') {
          <span class="inline-block mt-2 px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-700 text-xs font-bold">{{ 'pos.history.statuses.cancelled' | t }}</span>
        }
      </div>

      <div class="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-4 font-mono text-[13px]">
        <div class="flex justify-between text-slate-500 text-xs mb-2">
          <span>{{ 'pos.history.seller' | t }}: {{ pos.seller(sale.seller_id)?.name }}</span>
          <span>{{ pos.client(sale.client_id)?.name }}</span>
        </div>
        <div class="border-t border-slate-200 my-2"></div>
        @for (item of sale.items; track item.product_id) {
          <div class="py-1">
            <div class="text-slate-800">{{ item.name }}</div>
            <div class="flex justify-between text-slate-500">
              <span>{{ item.quantity }} × {{ money(item.unit_price) }}</span>
              <span class="text-slate-800">{{ money(item.total) }}</span>
            </div>
          </div>
        }
        <div class="border-t border-slate-200 my-2"></div>
        <div class="flex justify-between text-slate-500"><span>{{ 'pos.cart.subtotal' | t }}</span><span>{{ money(sale.subtotal) }}</span></div>
        <div class="flex justify-between text-slate-500"><span>{{ 'pos.cart.tax' | t }}</span><span>{{ money(sale.tax_total) }}</span></div>
        <div class="flex justify-between text-base font-bold text-slate-900 mt-1"><span>{{ 'common.fields.total' | t }}</span><span>{{ money(sale.total) }}</span></div>
        <div class="border-t border-slate-200 my-2"></div>
        <div class="flex justify-between text-slate-500"><span>{{ 'pos.payment.methods.' + sale.payment_method | t }}</span><span>{{ money(sale.amount_received) }}</span></div>
        @if (sale.change > 0) {
          <div class="flex justify-between font-semibold text-emerald-700"><span>{{ 'pos.receipt.change' | t }}</span><span>{{ money(sale.change) }}</span></div>
        }
      </div>

      <div class="flex flex-col-reverse sm:flex-row gap-2 mt-6">
        <button mat-stroked-button class="flex-1 !h-11" (click)="print()">
          <mat-icon>print</mat-icon>
          <span>{{ 'common.actions.print' | t }}</span>
        </button>
        <button mat-raised-button class="flex-1 !h-11 !bg-ispc-orange !text-white" (click)="ref.close()">
          @if (data.justCompleted) {
            <mat-icon>add_shopping_cart</mat-icon>
          }
          <span>{{ (data.justCompleted ? 'pos.receipt.newSale' : 'common.actions.close') | t }}</span>
        </button>
      </div>
    </div>
  `
})
export class PosReceiptDialogComponent {
  readonly sale: PosSale;

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: PosReceiptDialogData,
    public ref: MatDialogRef<PosReceiptDialogComponent>,
    public pos: PosService,
    private companyService: CompanyService
  ) {
    this.sale = data.sale;
  }

  money(value: number) { return formatPosMoney(value); }
  date(iso: string) { return formatPosDate(iso); }

  /** Talão de 80 mm numa janela própria, sempre em português. */
  print() {
    const sale = this.sale;
    const company = this.companyService.activeCompany();
    const pt = (v: number) => formatPosMoney(v, 'pt-MZ');
    const esc = (s: string | undefined) => (s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

    const rows = sale.items.map(item => `
      <tr><td colspan="2">${esc(item.name)}</td></tr>
      <tr><td>${item.quantity} x ${pt(item.unit_price)}</td><td class="r">${pt(item.total)}</td></tr>`).join('');

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(sale.number)}</title>
      <style>
        body { font-family: 'Courier New', monospace; font-size: 12px; width: 72mm; margin: 0 auto; padding: 8px; color: #000; }
        h1 { font-size: 14px; text-align: center; margin: 0; } p { margin: 2px 0; text-align: center; }
        table { width: 100%; border-collapse: collapse; } td { padding: 1px 0; } .r { text-align: right; }
        hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; } .b { font-weight: bold; font-size: 14px; }
      </style></head><body>
      <h1>${esc(company?.name)}</h1>
      ${company?.nuit ? `<p>NUIT: ${esc(company.nuit)}</p>` : ''}
      <hr><p><strong>VENDA A DINHEIRO ${esc(sale.number)}</strong></p>
      <p>${formatPosDate(sale.created_at, 'pt-MZ')}</p>
      ${sale.status === 'cancelled' ? '<p class="b">*** ANULADA ***</p>' : ''}
      <p>Cliente: ${esc(this.pos.client(sale.client_id)?.name)}</p>
      <p>Vendedor: ${esc(this.pos.seller(sale.seller_id)?.name)}</p>
      <hr><table>${rows}</table><hr>
      <table>
        <tr><td>Subtotal</td><td class="r">${pt(sale.subtotal)}</td></tr>
        <tr><td>IVA incluído</td><td class="r">${pt(sale.tax_total)}</td></tr>
        <tr class="b"><td>TOTAL</td><td class="r">${pt(sale.total)}</td></tr>
        <tr><td>${PRINT_LABELS[sale.payment_method]}</td><td class="r">${pt(sale.amount_received)}</td></tr>
        ${sale.change > 0 ? `<tr><td>Troco</td><td class="r">${pt(sale.change)}</td></tr>` : ''}
      </table>
      <hr><p>Obrigado pela preferência!</p><p>Processado por ISPC Fácil</p>
      <script>window.onload = () => { window.print(); setTimeout(() => window.close(), 300); };</script>
      </body></html>`;

    const win = window.open('', '_blank', 'width=360,height=640');
    if (!win) return;
    win.document.write(html);
    win.document.close();
  }
}
