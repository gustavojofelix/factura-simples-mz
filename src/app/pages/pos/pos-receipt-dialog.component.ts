import { Component, Inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { PosDocument } from '../../core/services/pos.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { formatPosDate, formatPosMoney } from './pos-format';

export interface PosReceiptDialogData {
  doc: PosDocument;
  /** true logo após cobrar: mostra "Nova venda" em vez de "Fechar". */
  justCompleted?: boolean;
}

export type PosReceiptAction = 'print' | 'reprint' | 'refund' | 'void';

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
          <h2 class="!m-0 text-xl font-bold text-slate-900">{{ 'pos.documents.' + doc.document_type | t }}</h2>
        }
        <p class="text-sm text-slate-500 mt-1">{{ doc.number }} · {{ date(doc.issued_at) }}</p>
        @if (doc.status === 'anulada') {
          <span class="inline-block mt-2 px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-700 text-xs font-bold">{{ 'pos.history.statuses.cancelled' | t }}</span>
        }
      </div>

      <div class="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-4 font-mono text-[13px]">
        <div class="flex justify-between gap-3 text-slate-500 text-xs">
          <span>{{ 'pos.history.seller' | t }}: {{ doc.staff }}</span>
          <span class="text-right">{{ doc.client.walk_in ? ('pos.client.walkIn' | t) : doc.client.name }}@if (doc.client.nuit) {<br>NUIT {{ doc.client.nuit }}}</span>
        </div>
        @if (doc.table_label) {
          <div class="text-xs text-slate-500 mt-1">{{ doc.table_label }}@if (doc.covers) { · {{ 'pos.tables.covers' | t: { count: doc.covers } }}}</div>
        }
        <div class="border-t border-slate-200 my-2"></div>
        @for (item of doc.items; track item.id) {
          <div class="py-1">
            <div class="text-slate-800">{{ item.name }}</div>
            <div class="flex justify-between text-slate-500">
              <span>{{ abs(item.quantity) }} × {{ money(item.unit_price) }}</span>
              <span class="text-slate-800">{{ money(item.unit_price * item.quantity) }}</span>
            </div>
            @if (item.returned > 0) {
              <div class="text-[11px] text-amber-700">{{ 'pos.refund.returnedQty' | t: { count: item.returned } }}</div>
            }
          </div>
        }
        <div class="border-t border-slate-200 my-2"></div>
        @if (doc.discount_total > 0) {
          <div class="flex justify-between text-rose-600"><span>{{ 'pos.discount.label' | t }}</span><span>−{{ money(doc.discount_total) }}</span></div>
        }
        <div class="flex justify-between text-base font-bold mt-1" [class.text-slate-900]="doc.total >= 0" [class.text-rose-600]="doc.total < 0">
          <span>{{ 'common.fields.total' | t }}</span><span>{{ money(doc.total) }}</span>
        </div>
        <div class="border-t border-slate-200 my-2"></div>
        @for (p of doc.payments; track $index) {
          <div class="flex justify-between text-slate-500">
            <span>{{ 'pos.payment.methods.' + p.method | t }}@if (p.simulated) { <span class="text-amber-700">· {{ 'pos.mobile.simulation' | t }}</span> }</span>
            <span>{{ money(p.amount) }}</span>
          </div>
        }
        @if (change() > 0) {
          <div class="flex justify-between font-semibold text-emerald-700"><span>{{ 'pos.receipt.change' | t }}</span><span>{{ money(change()) }}</span></div>
        }
        @if (doc.related) {
          <div class="text-xs text-slate-500 mt-2">{{ 'pos.refund.ref' | t: { number: doc.related.number } }}@if (doc.credit_reason) { · {{ doc.credit_reason }}}</div>
        }
        @if (doc.annulment_reason) {
          <div class="text-xs text-rose-600 mt-2">{{ doc.annulment_reason }}</div>
        }
        @for (nc of doc.credit_notes; track nc.id) {
          <div class="text-xs font-semibold text-amber-700 mt-2">{{ nc.number }} · {{ money(nc.total) }}</div>
        }
        <div class="text-[11px] text-slate-400 mt-2">{{ 'pos.receipt.taxNote' | t }}</div>
      </div>

      <div class="grid grid-cols-2 gap-2 mt-6">
        <button mat-stroked-button class="!h-12 !rounded-xl" (click)="ref.close(data.justCompleted || doc.print_count === 0 ? 'print' : 'reprint')">
          <mat-icon>print</mat-icon>
          <span>{{ (data.justCompleted || doc.print_count === 0 ? 'common.actions.print' : 'pos.receipt.reprint') | t }}</span>
        </button>
        @if (canRefund()) {
          <button mat-stroked-button class="!h-12 !rounded-xl !text-rose-600" (click)="ref.close('refund')">
            <mat-icon>undo</mat-icon>
            <span>{{ 'pos.refund.action' | t }}</span>
          </button>
        }
        @if (canVoid()) {
          <button mat-stroked-button class="!h-12 !rounded-xl !text-rose-600" (click)="ref.close('void')">
            <mat-icon>block</mat-icon>
            <span>{{ 'pos.history.cancel' | t }}</span>
          </button>
        }
        <button mat-raised-button class="!h-12 !rounded-xl !bg-ispc-orange !text-white col-span-2" (click)="ref.close()">
          @if (data.justCompleted) { <mat-icon>add_shopping_cart</mat-icon> }
          <span>{{ (data.justCompleted ? 'pos.receipt.newSale' : 'common.actions.close') | t }}</span>
        </button>
      </div>
    </div>
  `
})
export class PosReceiptDialogComponent {
  readonly doc: PosDocument;
  change = computed(() => this.doc.payments.reduce((sum, p) => sum + Number(p.change || 0), 0));

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: PosReceiptDialogData,
    public ref: MatDialogRef<PosReceiptDialogComponent, PosReceiptAction | undefined>
  ) {
    this.doc = data.doc;
  }

  /** FR activa com artigos ainda por devolver. */
  canRefund() {
    return !this.data.justCompleted && this.doc.document_type === 'FR' && this.doc.status === 'paga'
      && this.doc.items.some(i => Number(i.quantity) > Number(i.returned));
  }

  /** Anular: só FR do próprio dia, sem notas de crédito. */
  canVoid() {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Maputo' });
    return !this.data.justCompleted && this.doc.document_type === 'FR' && this.doc.status === 'paga'
      && this.doc.date === today && this.doc.credit_notes.length === 0;
  }

  abs(v: number) { return Math.abs(Number(v)); }
  money(value: number) { return formatPosMoney(Number(value)); }
  date(iso: string) { return formatPosDate(iso); }
}
