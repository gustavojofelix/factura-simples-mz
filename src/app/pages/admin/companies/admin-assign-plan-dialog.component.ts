import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AdminAssignPlanResult, AdminPaymentMethod, BillingCycle, SubscriptionPlan, SubscriptionService
} from '../../../core/services/subscription.service';

/**
 * Back office: atribuir um plano de subscrição a um contribuinte.
 * Emite a factura no OfficeGest (excepto ofertas) e envia ao cliente o e-mail
 * a informar que o plano está activo, com a factura em anexo.
 */
@Component({
  selector: 'app-admin-assign-plan-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" (click)="close()">
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" (click)="$event.stopPropagation()">
        <div class="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <div>
            <h3 class="text-xl font-bold text-gray-800">Atribuir plano</h3>
            <p class="text-sm text-gray-500 mt-0.5">{{ company.name }}</p>
          </div>
          <button type="button" (click)="close()" class="text-gray-400 hover:text-gray-600" aria-label="Fechar">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- Resultado -->
        <div *ngIf="result?.ok; else formTpl" class="p-6 space-y-4">
          <div class="p-4 rounded-xl bg-green-50 border border-green-200 text-green-800 text-sm">
            <p class="font-semibold">Plano {{ planName }} activo.</p>
            <p *ngIf="result?.period as p" class="mt-1">
              Período: {{ p.start_date | date:'dd/MM/yyyy' }} a {{ p.end_date | date:'dd/MM/yyyy' }}
              <span *ngIf="isQueued(p.start_date)"> (começa depois do período já pago)</span>
            </p>
          </div>
          <ul class="text-sm space-y-2">
            <li *ngIf="method !== 'offer'" class="flex gap-2">
              <span>{{ result?.invoiceNumber ? '✅' : '⚠️' }}</span>
              <span *ngIf="result?.invoiceNumber">Factura {{ result?.invoiceNumber }} emitida no OfficeGest.</span>
              <span *ngIf="!result?.invoiceNumber">Factura não emitida: {{ result?.invoiceError }}. Pode emiti-la em Receitas e reenviar o e-mail.</span>
            </li>
            <li class="flex gap-2">
              <span>{{ result?.emailOk ? '✅' : '⚠️' }}</span>
              <span>{{ result?.emailMessage }}</span>
            </li>
          </ul>
          <div class="flex justify-end">
            <button type="button" (click)="close()" class="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg text-sm">Fechar</button>
          </div>
        </div>

        <ng-template #formTpl>
          <form (ngSubmit)="submit()" class="p-6 space-y-4">
            <div *ngIf="result?.error" class="p-3 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">{{ result?.error }}</div>

            <div>
              <label class="block text-[10px] font-bold text-gray-500 uppercase mb-1">Plano *</label>
              <select [(ngModel)]="planName" name="plan" (ngModelChange)="updateAmount()" required
                class="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option *ngFor="let p of paidPlans" [value]="p.name">{{ p.name }}</option>
              </select>
            </div>

            <div>
              <label class="block text-[10px] font-bold text-gray-500 uppercase mb-1">Duração *</label>
              <div class="grid grid-cols-4 gap-1 p-1 bg-gray-100 rounded-lg text-xs font-semibold">
                <button type="button" *ngFor="let c of cycles" (click)="cycle = c.value; updateAmount()"
                  class="py-1.5 rounded-md transition-colors"
                  [class.bg-white]="cycle === c.value" [class.text-blue-600]="cycle === c.value" [class.shadow-sm]="cycle === c.value">
                  {{ c.label }}
                </button>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-[10px] font-bold text-gray-500 uppercase mb-1">Forma de pagamento *</label>
                <select [(ngModel)]="method" name="method"
                  class="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option *ngFor="let m of methods" [value]="m.value">{{ m.label }}</option>
                </select>
              </div>
              <div>
                <label class="block text-[10px] font-bold text-gray-500 uppercase mb-1">Valor pago (MZN) *</label>
                <input type="number" min="0" step="0.01" [(ngModel)]="amount" name="amount" [disabled]="method === 'offer'"
                  class="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50">
              </div>
            </div>

            <div *ngIf="method !== 'offer'">
              <label class="block text-[10px] font-bold text-gray-500 uppercase mb-1">Referência do pagamento</label>
              <input type="text" [(ngModel)]="reference" name="reference" placeholder="Opcional (ex.: nº da transferência)"
                class="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>

            <div class="p-3 rounded-lg bg-blue-50 border border-blue-100 text-blue-900 text-xs space-y-1">
              <p>Se a empresa ainda tiver tempo pago, o novo período começa no dia seguinte ao fim do actual.</p>
              <p *ngIf="method !== 'offer'">É emitida a factura no OfficeGest (documento fiscal real) e o cliente recebe um e-mail a informar que o plano está activo, com a factura em anexo.</p>
              <p *ngIf="method === 'offer'">Oferta: sem factura. O cliente recebe um e-mail a informar que o plano está activo.</p>
            </div>

            <div class="flex gap-2 pt-1">
              <button type="submit" [disabled]="saving || !planName"
                class="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg text-sm transition-colors disabled:opacity-50">
                {{ saving ? 'A activar…' : 'Atribuir plano' }}
              </button>
              <button type="button" (click)="close()" [disabled]="saving"
                class="bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2 px-4 rounded-lg text-sm">Cancelar</button>
            </div>
          </form>
        </ng-template>
      </div>
    </div>
  `
})
export class AdminAssignPlanDialogComponent implements OnInit {
  @Input({ required: true }) company!: { id: string; name: string };
  /** Fecha o diálogo; `true` se um plano foi atribuído (para recarregar a lista). */
  @Output() closed = new EventEmitter<boolean>();

  private subscriptionService = inject(SubscriptionService);

  readonly cycles: { value: BillingCycle; label: string }[] = [
    { value: 'monthly', label: '1 mês' },
    { value: 'quarterly', label: '3 meses' },
    { value: 'semiannual', label: '6 meses' },
    { value: 'yearly', label: '1 ano' },
  ];
  readonly methods: { value: AdminPaymentMethod; label: string }[] = [
    { value: 'transfer', label: 'Transferência bancária' },
    { value: 'cash', label: 'Numerário' },
    { value: 'mpesa', label: 'M-Pesa' },
    { value: 'emola', label: 'e-Mola' },
    { value: 'offer', label: 'Oferta (sem pagamento)' },
  ];

  paidPlans: SubscriptionPlan[] = [];
  planName = '';
  cycle: BillingCycle = 'monthly';
  method: AdminPaymentMethod = 'transfer';
  amount = 0;
  reference = '';
  saving = false;
  result: AdminAssignPlanResult | null = null;

  async ngOnInit() {
    const plans = await this.subscriptionService.loadPlans();
    this.paidPlans = plans.filter(p => (p.monthly_price || 0) > 0 && p.is_active !== false && !!p.id);
    const popular = this.paidPlans.find(p => p.is_popular) ?? this.paidPlans[0];
    this.planName = popular?.name ?? '';
    this.updateAmount();
  }

  updateAmount() {
    const plan = this.paidPlans.find(p => p.name === this.planName);
    if (!plan) return;
    const prices: Record<BillingCycle, number> = {
      monthly: plan.monthly_price,
      quarterly: plan.three_months_price || plan.monthly_price * 3,
      semiannual: plan.six_months_price || plan.monthly_price * 6,
      yearly: plan.yearly_price || plan.monthly_price * 12,
    };
    this.amount = Number(prices[this.cycle]) || 0;
  }

  isQueued(startDate: string): boolean {
    return startDate > new Date().toISOString().substring(0, 10);
  }

  async submit() {
    if (!this.planName || this.saving) return;
    this.saving = true;
    this.result = null;
    try {
      this.result = await this.subscriptionService.adminAssignPlan({
        companyId: this.company.id,
        companyName: this.company.name,
        planName: this.planName,
        billingCycle: this.cycle,
        amount: this.amount,
        paymentMethod: this.method,
        reference: this.reference,
      });
    } catch (e: any) {
      this.result = { ok: false, error: e?.message || 'Erro inesperado.' };
    } finally {
      this.saving = false;
    }
  }

  close() {
    if (this.saving) return;
    this.closed.emit(!!this.result?.ok);
  }
}
