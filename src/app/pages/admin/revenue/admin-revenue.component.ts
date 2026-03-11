import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup } from '@angular/forms';
import { SupabaseService } from '../../../core/services/supabase.service';
import { startWith } from 'rxjs/operators';

@Component({
  selector: 'app-admin-revenue',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  template: `
    <div class="space-y-6 text-sm p-4 md:p-6 bg-gray-50 min-h-screen">
      <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 class="text-2xl font-bold text-gray-900">Gestão Financeira (SaaS)</h2>
          <p class="text-gray-500 mt-1">Monitore e analise a receita de subscrições do sistema</p>
        </div>
        <button 
          (click)="exportToCSV()" 
          [disabled]="isLoading() || filteredSubscriptions().length === 0"
          class="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a2 2 0 002 2h12 a2 2 0 002-2v-1M16 9l-4-4m0 0L8 9m4-4v12" />
          </svg>
          Exportar CSV
        </button>
      </div>

      <!-- Filters Section -->
      <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <form [formGroup]="filterForm" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div class="flex flex-col gap-1">
            <label class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Estado</label>
            <select formControlName="status" class="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all outline-none">
              <option value="">Todos os Estados</option>
              <option value="active">Ativo</option>
              <option value="trialing">Trialing</option>
              <option value="past_due">Em Atraso (Past Due)</option>
              <option value="cancelled">Cancelado</option>
            </select>
          </div>

          <div class="flex flex-col gap-1">
            <label class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Plano</label>
            <select formControlName="plan" class="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all outline-none">
              <option value="">Todos os Planos</option>
              @for (plan of availablePlans(); track plan) {
                <option [value]="plan">{{ plan }}</option>
              }
            </select>
          </div>

          <div class="flex flex-col gap-1">
            <label class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Valor Mínimo</label>
            <input type="number" formControlName="minValue" placeholder="0.00" class="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all outline-none">
          </div>

          <div class="flex flex-col gap-1">
            <label class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Valor Máximo</label>
            <input type="number" formControlName="maxValue" placeholder="Max" class="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all outline-none">
          </div>

          <div class="flex flex-col gap-1">
            <label class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Método de Pagamento</label>
            <select formControlName="paymentMethod" class="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all outline-none">
              <option value="">Todos os Métodos</option>
              @for (method of paymentMethods(); track method) {
                <option [value]="method">{{ method || 'Não definido' }}</option>
              }
            </select>
          </div>

          <div class="flex flex-col gap-1">
            <label class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Data Início</label>
            <input type="date" formControlName="startDate" class="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all outline-none">
          </div>

          <div class="flex flex-col gap-1">
            <label class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Data Fim</label>
            <input type="date" formControlName="endDate" class="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all outline-none">
          </div>

          <div class="flex items-end">
            <button 
              type="button"
              (click)="clearFilters()"
              class="w-full flex items-center justify-center gap-2 text-gray-500 hover:text-red-600 font-medium px-4 py-2 border border-gray-200 hover:border-red-200 rounded-lg transition-all"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Limpar Filtros
            </button>
          </div>
        </form>
      </div>

      <!-- Loading State Overlay -->
      @if (isLoading()) {
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-12 flex flex-col items-center justify-center space-y-4">
          <div class="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <p class="text-gray-500 font-medium animate-pulse uppercase tracking-widest text-[10px]">A sincronizar dados financeiros...</p>
        </div>
      }

      @if (!isLoading()) {
        <div class="space-y-6 animate-in fade-in duration-500">
          <!-- Stats Cards -->
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div class="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex flex-col hover:shadow-md transition-shadow">
              <span class="text-gray-400 text-[10px] font-bold uppercase tracking-widest">MRR Estimado (Filtrado)</span>
              <span class="text-2xl font-black text-gray-900 mt-1">{{ stats().mrr | currency:'MZN':'symbol':'1.2-2':'pt-MZ' }}</span>
            </div>
            <div class="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex flex-col hover:shadow-md transition-shadow">
              <span class="text-gray-400 text-[10px] font-bold uppercase tracking-widest">Subscrições Ativas</span>
              <span class="text-2xl font-black text-green-600 mt-1">{{ stats().activeSubs }}</span>
            </div>
            <div class="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex flex-col hover:shadow-md transition-shadow">
              <span class="text-gray-400 text-[10px] font-bold uppercase tracking-widest">Trialing</span>
              <span class="text-2xl font-black text-blue-600 mt-1">{{ stats().trialingSubs }}</span>
            </div>
            <div class="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex flex-col hover:shadow-md transition-shadow">
              <span class="text-gray-400 text-[10px] font-bold uppercase tracking-widest">Vencidas (Past Due)</span>
              <span class="text-2xl font-black text-red-600 mt-1">{{ stats().pastDueSubs }}</span>
            </div>
          </div>

          <!-- Subscriptions Table -->
          <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div class="p-6 border-b border-gray-100 flex justify-between items-center">
              <div>
                <h3 class="text-lg font-bold text-gray-900">Resultados da Pesquisa</h3>
                <p class="text-xs text-gray-500 mt-1">Total de {{ filteredSubscriptions().length }} registos encontrados</p>
              </div>
            </div>
            <div class="overflow-x-auto">
              <table class="w-full text-left border-collapse">
                <thead>
                  <tr class="bg-gray-50 text-gray-400 text-[10px] uppercase tracking-widest font-bold border-b border-gray-100">
                    <th class="px-6 py-4">Empresa</th>
                    <th class="px-6 py-4">Plano / Ciclo</th>
                    <th class="px-6 py-4">Estado</th>
                    <th class="px-6 py-4">Início</th>
                    <th class="px-6 py-4">Próxima Cobrança</th>
                    <th class="px-6 py-4 text-right">Valor</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-50">
                  @for (sub of filteredSubscriptions(); track sub.id) {
                    <tr class="hover:bg-blue-50/30 transition-colors group">
                      <td class="px-6 py-4 font-semibold text-gray-900">{{ sub.company_name }}</td>
                      <td class="px-6 py-4">
                        <div class="flex flex-col">
                          <span class="font-medium text-gray-800">{{ sub.plan_name }}</span>
                          <span class="text-[10px] text-gray-400 uppercase font-bold">{{ sub.billing_cycle }}</span>
                        </div>
                      </td>
                      <td class="px-6 py-4">
                        <span [class]="getStatusClass(sub.status)" class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider">
                          {{ sub.status }}
                        </span>
                      </td>
                      <td class="px-6 py-4 text-gray-600">{{ sub.start_date | date:'dd/MM/yyyy' }}</td>
                      <td class="px-6 py-4">
                        <div class="flex flex-col">
                          <span [class]="isOverdue(sub.next_billing_date) ? 'text-red-600 font-bold' : 'text-gray-600'">
                            {{ sub.next_billing_date | date:'dd/MM/yyyy' }}
                          </span>
                          @if (sub.grace_period_until) {
                            <span class="text-[10px] text-orange-600 font-bold uppercase">Grace: {{ sub.grace_period_until | date:'dd/MM/yyyy' }}</span>
                          }
                        </div>
                      </td>
                      <td class="px-6 py-4 font-black text-gray-900 text-right">
                        {{ sub.amount | currency:'MZN':'symbol':'1.2-2':'pt-MZ' }}
                      </td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="6" class="px-6 py-20 text-center text-gray-400 italic">
                        Nenhum registro encontrado para os filtros selecionados.
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: []
})
export class AdminRevenueComponent implements OnInit {
  private supabase = inject(SupabaseService);
  private fb = inject(FormBuilder);

  private allSubscriptions = signal<any[]>([]);
  isLoading = signal(false);

  filterForm: FormGroup = this.fb.group({
    status: [''],
    plan: [''],
    minValue: [null],
    maxValue: [null],
    paymentMethod: [''],
    startDate: [''],
    endDate: ['']
  });

  private filters = toSignal(
    this.filterForm.valueChanges.pipe(startWith(this.filterForm.value)),
    { initialValue: this.filterForm.value }
  );

  // Unique lists for filters
  availablePlans = computed(() => {
    const plans = this.allSubscriptions().map(s => s.plan_name);
    return [...new Set(plans)].sort();
  });

  paymentMethods = computed(() => {
    const methods = this.allSubscriptions().map(s => s.payment_method);
    return [...new Set(methods)].sort();
  });

  // Filtered computed signal
  filteredSubscriptions = computed(() => {
    const subs = this.allSubscriptions();
    const currentFilters = this.filters();

    return subs.filter(s => {
      // Status filter
      if (currentFilters.status && s.status !== currentFilters.status) return false;

      // Plan filter
      if (currentFilters.plan && s.plan_name !== currentFilters.plan) return false;

      // Value range
      const amount = Number(s.amount) || 0;
      if (currentFilters.minValue !== null && currentFilters.minValue !== undefined && amount < currentFilters.minValue) return false;
      if (currentFilters.maxValue !== null && currentFilters.maxValue !== undefined && amount > currentFilters.maxValue) return false;

      // Payment Method
      if (currentFilters.paymentMethod && s.payment_method !== currentFilters.paymentMethod) return false;

      // Date range (based on start_date)
      if (currentFilters.startDate) {
        const start = new Date(currentFilters.startDate);
        const subDate = new Date(s.start_date);
        if (subDate < start) return false;
      }
      if (currentFilters.endDate) {
        const end = new Date(currentFilters.endDate);
        const subDate = new Date(s.start_date);
        if (subDate > end) return false;
      }

      return true;
    });
  });

  // Stats computed from filtered results
  stats = computed(() => {
    const subs = this.filteredSubscriptions();
    let mrr = 0;
    let active = 0;
    let trialing = 0;
    let pastDue = 0;

    subs.forEach(s => {
      if (s.status === 'active') {
        active++;
        const amount = Number(s.amount) || 0;
        if (s.billing_cycle === 'yearly') mrr += amount / 12;
        else if (s.billing_cycle === 'semiannual') mrr += amount / 6;
        else if (s.billing_cycle === 'quarterly') mrr += amount / 3;
        else mrr += amount;
      } else if (s.status === 'trialing') {
        trialing++;
      } else if (s.status === 'past_due') {
        pastDue++;
      }
    });

    return { mrr, activeSubs: active, trialingSubs: trialing, pastDueSubs: pastDue };
  });

  ngOnInit() {
    this.loadRevenueData();
  }

  async loadRevenueData() {
    this.isLoading.set(true);
    try {
      const { data, error } = await this.supabase.db
        .from('subscriptions')
        .select(`
          *,
          companies (name)
        `)
        .order('next_billing_date', { ascending: true });

      if (error) throw error;

      const formatted = data?.map(s => ({
        ...s,
        company_name: s.companies?.name || 'N/A'
      })) || [];

      this.allSubscriptions.set(formatted);
    } catch (error) {
      console.error('Error loading revenue data:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  clearFilters() {
    this.filterForm.reset({
      status: '',
      plan: '',
      minValue: null,
      maxValue: null,
      paymentMethod: '',
      startDate: '',
      endDate: ''
    });
  }

  exportToCSV() {
    const data = this.filteredSubscriptions();
    if (data.length === 0) return;

    // Headers
    const headers = ['Empresa', 'Plano', 'Ciclo', 'Estado', 'Data Início', 'Próxima Cobrança', 'Valor', 'Método Pagamento'];

    // Rows
    const rows = data.map(s => [
      `"${s.company_name.replace(/"/g, '""')}"`,
      s.plan_name,
      s.billing_cycle,
      s.status,
      s.start_date,
      s.next_billing_date,
      s.amount,
      s.payment_method || 'N/A'
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(r => r.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    const timestamp = new Date().toISOString().split('T')[0];
    link.setAttribute('href', url);
    link.setAttribute('download', `receita_admin_${timestamp}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  getStatusClass(status: string) {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-700 ring-1 ring-green-200';
      case 'past_due': return 'bg-red-100 text-red-700 ring-1 ring-red-200';
      case 'trialing': return 'bg-blue-100 text-blue-700 ring-1 ring-blue-200';
      case 'cancelled': return 'bg-gray-100 text-gray-700 ring-1 ring-gray-200';
      default: return 'bg-gray-100 text-gray-700 ring-1 ring-gray-200';
    }
  }

  isOverdue(date: string) {
    if (!date) return false;
    return new Date(date) < new Date();
  }
}
