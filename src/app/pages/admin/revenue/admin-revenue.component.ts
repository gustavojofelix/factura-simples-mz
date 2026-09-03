import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { startWith } from 'rxjs/operators';
import { SupabaseService } from '../../../core/services/supabase.service';

type PaymentStatus = 'pending' | 'completed' | 'failed' | 'cancelled';

interface PaymentTransaction {
  id: string;
  company_name: string;
  plan_name: string;
  billing_cycle: string;
  amount: number;
  currency: string;
  payment_method: string;
  reference_code: string;
  status: PaymentStatus;
  created_at: string;
}

interface Subscription { status: string; amount: number; billing_cycle: string; }

@Component({
  selector: 'app-admin-revenue',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="min-h-screen space-y-6 bg-gray-50 p-4 text-sm md:p-6">
      <div class="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div><h2 class="text-2xl font-bold text-gray-900">Gestão Financeira</h2><p class="mt-1 text-gray-500">Acompanhe pagamentos reais, cobranças pendentes e receita recorrente.</p></div>
        <button (click)="exportToCSV()" [disabled]="isLoading() || filteredPayments().length === 0" class="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1M16 9l-4-4m0 0L8 9m4-4v12" /></svg> Exportar transações
        </button>
      </div>

      <div class="rounded-xl border border-gray-100 bg-white p-6 shadow-sm"><form [formGroup]="filterForm" class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div class="flex flex-col gap-1"><label class="filter-label">Estado do pagamento</label><select formControlName="status" class="filter-control"><option value="">Todos os estados</option><option value="completed">Concluído</option><option value="pending">Pendente</option><option value="failed">Falhado</option><option value="cancelled">Cancelado</option></select></div>
        <div class="flex flex-col gap-1"><label class="filter-label">Método de pagamento</label><select formControlName="paymentMethod" class="filter-control"><option value="">Todos os métodos</option>@for (method of paymentMethods(); track method) {<option [value]="method">{{ paymentMethodLabel(method) }}</option>}</select></div>
        <div class="flex flex-col gap-1"><label class="filter-label">Data de início</label><input type="date" formControlName="startDate" class="filter-control"></div>
        <div class="flex flex-col gap-1"><label class="filter-label">Data de fim</label><input type="date" formControlName="endDate" class="filter-control"></div>
        <div class="flex items-end"><button type="button" (click)="clearFilters()" class="w-full rounded-lg border border-gray-200 px-4 py-2 font-medium text-gray-500 transition-colors hover:border-red-200 hover:text-red-600">Limpar filtros</button></div>
      </form></div>

      @if (isLoading()) {
        <div class="flex flex-col items-center justify-center space-y-4 rounded-xl border border-gray-100 bg-white p-12 shadow-sm"><div class="h-12 w-12 animate-spin rounded-full border-4 border-blue-600 border-t-transparent"></div><p class="text-[10px] font-medium uppercase tracking-widest text-gray-500">A sincronizar dados financeiros...</p></div>
      } @else if (loadError()) {
        <div class="rounded-xl border border-red-200 bg-red-50 p-5 text-red-700">Não foi possível carregar os dados financeiros. {{ loadError() }}</div>
      } @else {
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div class="metric-card"><span class="metric-label">Receita recebida (filtrada)</span><span class="metric-value text-green-600">{{ paymentStats().received | currency:'MZN':'symbol':'1.2-2':'pt-MZ' }}</span><span class="metric-note">Pagamentos concluídos</span></div>
          <div class="metric-card"><span class="metric-label">A aguardar pagamento</span><span class="metric-value text-amber-600">{{ paymentStats().pendingAmount | currency:'MZN':'symbol':'1.2-2':'pt-MZ' }}</span><span class="metric-note">{{ paymentStats().pendingCount }} transação(ões) pendente(s)</span></div>
          <div class="metric-card"><span class="metric-label">Pagamentos falhados</span><span class="metric-value text-red-600">{{ paymentStats().failedCount }}</span><span class="metric-note">{{ paymentStats().failedAmount | currency:'MZN':'symbol':'1.2-2':'pt-MZ' }} por recuperar</span></div>
          <div class="metric-card"><span class="metric-label">MRR estimado</span><span class="metric-value text-blue-600">{{ mrr() | currency:'MZN':'symbol':'1.2-2':'pt-MZ' }}</span><span class="metric-note">{{ activeSubscriptions() }} subscrição(ões) ativas</span></div>
        </div>
        <div class="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm"><div class="border-b border-gray-100 p-6"><h3 class="text-lg font-bold text-gray-900">Histórico de transações</h3><p class="mt-1 text-xs text-gray-500">{{ filteredPayments().length }} registo(s) encontrado(s)</p></div>
          <div class="overflow-x-auto"><table class="w-full border-collapse text-left"><thead><tr class="border-b border-gray-100 bg-gray-50 text-[10px] font-bold uppercase tracking-widest text-gray-400"><th class="px-6 py-4">Data</th><th class="px-6 py-4">Empresa</th><th class="px-6 py-4">Plano</th><th class="px-6 py-4">Método / Referência</th><th class="px-6 py-4">Estado</th><th class="px-6 py-4 text-right">Valor</th></tr></thead><tbody class="divide-y divide-gray-50">
            @for (payment of filteredPayments(); track payment.id) {<tr class="transition-colors hover:bg-blue-50/30"><td class="whitespace-nowrap px-6 py-4 text-gray-600">{{ payment.created_at | date:'dd/MM/yyyy, HH:mm' }}</td><td class="px-6 py-4 font-semibold text-gray-900">{{ payment.company_name }}</td><td class="px-6 py-4"><div class="flex flex-col"><span class="font-medium text-gray-800">{{ payment.plan_name }}</span><span class="text-[10px] font-bold uppercase text-gray-400">{{ payment.billing_cycle }}</span></div></td><td class="px-6 py-4"><div class="flex flex-col"><span class="font-medium text-gray-700">{{ paymentMethodLabel(payment.payment_method) }}</span><span class="font-mono text-[10px] text-gray-400">{{ payment.reference_code }}</span></div></td><td class="px-6 py-4"><span [class]="getStatusClass(payment.status)" class="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">{{ statusLabel(payment.status) }}</span></td><td class="whitespace-nowrap px-6 py-4 text-right font-black text-gray-900">{{ payment.amount | currency:payment.currency:'symbol':'1.2-2':'pt-MZ' }}</td></tr>} @empty {<tr><td colspan="6" class="px-6 py-20 text-center italic text-gray-400">Nenhuma transação encontrada para os filtros selecionados.</td></tr>}
          </tbody></table></div>
        </div>
      }
    </div>
  `,
  styles: [`.filter-label{font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#9ca3af}.filter-control{width:100%;border:1px solid #e5e7eb;border-radius:.5rem;background:#f9fafb;padding:.5rem .75rem;outline:none}.filter-control:focus{border-color:#3b82f6;box-shadow:0 0 0 2px #bfdbfe}.metric-card{display:flex;min-height:128px;flex-direction:column;border:1px solid #f3f4f6;border-radius:.75rem;background:#fff;padding:1.25rem;box-shadow:0 1px 2px rgb(0 0 0 / .05)}.metric-label{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#9ca3af}.metric-value{margin-top:.25rem;font-size:1.5rem;font-weight:900}.metric-note{margin-top:auto;padding-top:.5rem;font-size:.75rem;color:#6b7280}`]
})
export class AdminRevenueComponent implements OnInit {
  private supabase = inject(SupabaseService); private fb = inject(FormBuilder);
  private allPayments = signal<PaymentTransaction[]>([]); private subscriptions = signal<Subscription[]>([]);
  isLoading = signal(false); loadError = signal('');
  filterForm: FormGroup = this.fb.group({ status: [''], paymentMethod: [''], startDate: [''], endDate: [''] });
  private filters = toSignal(this.filterForm.valueChanges.pipe(startWith(this.filterForm.value)), { initialValue: this.filterForm.value });
  paymentMethods = computed(() => [...new Set(this.allPayments().map(payment => payment.payment_method).filter(Boolean))].sort());
  filteredPayments = computed(() => { const filters = this.filters(); return this.allPayments().filter(payment => { if (filters.status && payment.status !== filters.status) return false; if (filters.paymentMethod && payment.payment_method !== filters.paymentMethod) return false; const paymentDate = new Date(payment.created_at); if (filters.startDate && paymentDate < new Date(`${filters.startDate}T00:00:00`)) return false; if (filters.endDate && paymentDate > new Date(`${filters.endDate}T23:59:59.999`)) return false; return true; }); });
  paymentStats = computed(() => this.filteredPayments().reduce((stats, payment) => { const amount = Number(payment.amount) || 0; if (payment.status === 'completed') stats.received += amount; if (payment.status === 'pending') { stats.pendingCount++; stats.pendingAmount += amount; } if (payment.status === 'failed') { stats.failedCount++; stats.failedAmount += amount; } return stats; }, { received: 0, pendingAmount: 0, pendingCount: 0, failedAmount: 0, failedCount: 0 }));
  activeSubscriptions = computed(() => this.subscriptions().filter(subscription => subscription.status === 'active').length);
  mrr = computed(() => this.subscriptions().filter(subscription => subscription.status === 'active').reduce((total, subscription) => { const amount = Number(subscription.amount) || 0; const months = subscription.billing_cycle === 'yearly' ? 12 : subscription.billing_cycle === 'semiannual' ? 6 : subscription.billing_cycle === 'quarterly' ? 3 : 1; return total + amount / months; }, 0));
  ngOnInit() { this.loadFinancialData(); }
  async loadFinancialData() { this.isLoading.set(true); this.loadError.set(''); try { const [paymentsResult, subscriptionsResult] = await Promise.all([this.supabase.db.from('subscription_payments').select('*, companies(name)').order('created_at', { ascending: false }), this.supabase.db.from('subscriptions').select('status, amount, billing_cycle')]); if (paymentsResult.error) throw paymentsResult.error; if (subscriptionsResult.error) throw subscriptionsResult.error; this.allPayments.set((paymentsResult.data ?? []).map((payment: any) => ({ ...payment, amount: Number(payment.amount) || 0, company_name: payment.companies?.name ?? 'Empresa não disponível' }))); this.subscriptions.set((subscriptionsResult.data ?? []).map((subscription: any) => ({ ...subscription, amount: Number(subscription.amount) || 0 }))); } catch (error: any) { console.error('Erro ao carregar dados financeiros:', error); this.loadError.set(error?.message || 'Tente atualizar a página.'); } finally { this.isLoading.set(false); } }
  clearFilters() { this.filterForm.reset({ status: '', paymentMethod: '', startDate: '', endDate: '' }); }
  paymentMethodLabel(method: string) { return ({ mpesa: 'M-Pesa', emola: 'e-Mola' } as Record<string, string>)[method] ?? method ?? 'Não definido'; }
  statusLabel(status: PaymentStatus) { return ({ completed: 'Concluído', pending: 'Pendente', failed: 'Falhado', cancelled: 'Cancelado' } as Record<PaymentStatus, string>)[status] ?? status; }
  getStatusClass(status: PaymentStatus) { return ({ completed: 'bg-green-100 text-green-700 ring-1 ring-green-200', pending: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200', failed: 'bg-red-100 text-red-700 ring-1 ring-red-200', cancelled: 'bg-gray-100 text-gray-700 ring-1 ring-gray-200' } as Record<PaymentStatus, string>)[status] ?? 'bg-gray-100 text-gray-700'; }
  exportToCSV() { const rows = this.filteredPayments(); if (!rows.length) return; const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`; const content = '\uFEFF' + ['Data', 'Empresa', 'Plano', 'Ciclo', 'Estado', 'Método', 'Referência', 'Valor', 'Moeda'].join(';') + '\n' + rows.map(payment => [new Date(payment.created_at).toLocaleString('pt-MZ'), payment.company_name, payment.plan_name, payment.billing_cycle, this.statusLabel(payment.status), this.paymentMethodLabel(payment.payment_method), payment.reference_code, payment.amount, payment.currency].map(escape).join(';')).join('\n'); const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8;' })); const link = document.createElement('a'); link.href = url; link.download = `transacoes_financeiras_${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url); }
}
