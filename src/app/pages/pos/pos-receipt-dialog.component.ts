import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { PosSale, PosService } from '../../core/services/pos.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { formatPosDate, formatPosMoney } from './pos-format';
import { PrintContext, printSale } from './pos-print';

export interface PosReceiptDialogData {
  sale: PosSale;
  /** true logo após finalizar: mostra "Nova venda" em vez de "Fechar". */
  justCompleted?: boolean;
}

export function posPrintContext(pos: PosService): PrintContext {
  return {
    store: pos.store(),
    width: pos.settings().paper_width,
    sellerName: id => pos.seller(id)?.name ?? '',
    tableName: id => pos.table(id)?.name ?? '',
    saleNumber: id => pos.sale(id)?.number ?? ''
  };
}

@Component({
  selector: 'app-pos-receipt-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, TranslatePipe],
  template: `
    <div class="p-5 sm:p-6 w-full max-w-md">
      <div class="text-center mb-5">
        @if (data.justCompleted) {
          <div class="w-14 h-14 mx-auto mb-3 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
            <i class="fa-solid fa-check text-2xl" aria-hidden="true"></i>
          </div>
          <h2 class="!m-0 text-xl font-bold text-slate-900">{{ 'pos.receipt.title' | t }}</h2>
        } @else {
          <h2 class="!m-0 text-xl font-bold text-slate-900">{{ 'pos.documents.' + sale.document_type | t }}</h2>
        }
        <p class="text-sm text-slate-500 mt-1">{{ sale.number }} · {{ date(sale.created_at) }}</p>
        @if (sale.status === 'cancelled') {
          <span class="inline-block mt-2 px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-700 text-xs font-bold">{{ 'pos.history.statuses.cancelled' | t }}</span>
        }
      </div>

      <div class="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-4 font-mono text-[13px]">
        <div class="flex justify-between gap-3 text-slate-500 text-xs">
          <span>{{ 'pos.history.seller' | t }}: {{ pos.seller(sale.seller_id)?.name }}</span>
          <span class="text-right">{{ sale.client_name }}@if (sale.client_nuit) {<br>NUIT {{ sale.client_nuit }}}</span>
        </div>
        @if (sale.table_id) {
          <div class="text-xs text-slate-500 mt-1">{{ 'pos.tables.table' | t }} {{ pos.table(sale.table_id)?.name }} · {{ 'pos.tables.covers' | t: { count: sale.covers ?? 1 } }}</div>
        }
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
        @if (sale.discount > 0 && sale.document_type !== 'NC') {
          <div class="flex justify-between text-rose-600"><span>{{ 'pos.discount.label' | t }}</span><span>−{{ money(sale.discount) }}</span></div>
        }
        <div class="flex justify-between text-slate-500"><span>{{ 'pos.cart.subtotal' | t }}</span><span>{{ money(sale.subtotal) }}</span></div>
        <div class="flex justify-between text-slate-500"><span>{{ 'pos.cart.tax' | t }}</span><span>{{ money(sale.tax_total) }}</span></div>
        <div class="flex justify-between text-base font-bold mt-1" [class.text-slate-900]="sale.total >= 0" [class.text-rose-600]="sale.total < 0">
          <span>{{ 'common.fields.total' | t }}</span><span>{{ money(sale.total) }}</span>
        </div>
        <div class="border-t border-slate-200 my-2"></div>
        @for (p of sale.payments; track p.method) {
          <div class="flex justify-between text-slate-500"><span>{{ 'pos.payment.methods.' + p.method | t }}</span><span>{{ money(p.amount) }}</span></div>
        }
        @if (sale.change > 0) {
          <div class="flex justify-between font-semibold text-emerald-700"><span>{{ 'pos.receipt.change' | t }}</span><span>{{ money(sale.change) }}</span></div>
        }
        @if (sale.refund_of) {
          <div class="text-xs text-slate-500 mt-2">{{ 'pos.refund.ref' | t: { number: pos.sale(sale.refund_of)?.number ?? '' } }}@if (sale.refund_reason) { · {{ sale.refund_reason }}}</div>
        }
        @if (refunded()) {
          <div class="text-xs font-semibold text-amber-700 mt-2">{{ 'pos.refund.partiallyReturned' | t }}</div>
        }
      </div>

      <div class="flex flex-col-reverse sm:flex-row gap-2 mt-6">
        <button mat-stroked-button class="flex-1 !h-12 !rounded-xl" (click)="print()">
          <mat-icon>print</mat-icon>
          <span>{{ 'common.actions.print' | t }}</span>
        </button>
        @if (canRefund()) {
          <button mat-stroked-button class="flex-1 !h-12 !rounded-xl !text-rose-600" (click)="ref.close('refund')">
            <mat-icon>undo</mat-icon>
            <span>{{ 'pos.refund.action' | t }}</span>
          </button>
        }
        <button mat-raised-button class="flex-1 !h-12 !rounded-xl !bg-ispc-orange !text-white" (click)="ref.close()">
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
    public ref: MatDialogRef<PosReceiptDialogComponent, 'refund' | undefined>,
    public pos: PosService
  ) {
    this.sale = data.sale;
  }

  /** Só vendas concluídas (não NC) com artigos ainda por devolver. */
  canRefund() {
    const current = this.pos.sale(this.sale.id) ?? this.sale;
    return !this.data.justCompleted && current.status === 'completed' && current.document_type !== 'NC' && this.pos.returnable(current).length > 0;
  }

  refunded() {
    const current = this.pos.sale(this.sale.id) ?? this.sale;
    return Object.keys(current.returned ?? {}).length > 0;
  }

  money(value: number) { return formatPosMoney(value); }
  date(iso: string) { return formatPosDate(iso); }

  print() {
    printSale(this.sale, posPrintContext(this.pos));
  }
}
