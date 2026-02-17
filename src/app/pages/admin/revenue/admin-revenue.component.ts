import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SupabaseService } from '../../../core/services/supabase.service';

@Component({
  selector: 'app-admin-revenue',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-6 text-sm">
      <div class="flex justify-between items-center">
        <h2 class="text-2xl font-bold text-gray-800">Gestão Financeira (SaaS)</h2>
      </div>

      <!-- Loading State Overlay -->
      <div *ngIf="isLoading()" class="bg-white rounded-xl shadow-sm border border-gray-100 p-12 flex flex-col items-center justify-center space-y-4">
        <div class="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
        <p class="text-gray-500 font-medium animate-pulse uppercase tracking-widest text-[10px]">A processar dados financeiros...</p>
      </div>

      <div *ngIf="!isLoading()" class="space-y-6">

      <!-- Stats Cards -->
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div class="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col">
          <span class="text-gray-500 text-xs font-medium uppercase">MRR Estimado</span>
          <span class="text-2xl font-bold text-gray-900 mt-1">{{ stats().mrr | currency:'MZN':'symbol':'1.2-2':'pt-MZ' }}</span>
        </div>
        <div class="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col">
          <span class="text-gray-500 text-xs font-medium uppercase">Subscrições Ativas</span>
          <span class="text-2xl font-bold text-gray-900 mt-1">{{ stats().activeSubs }}</span>
        </div>
        <div class="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col">
          <span class="text-gray-500 text-xs font-medium uppercase">Trialing</span>
          <span class="text-2xl font-bold text-gray-900 mt-1">{{ stats().trialingSubs }}</span>
        </div>
        <div class="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col">
          <span class="text-gray-500 text-xs font-medium uppercase">Vencidas (Past Due)</span>
          <span class="text-2xl font-bold text-red-600 mt-1">{{ stats().pastDueSubs }}</span>
        </div>
      </div>

      <!-- Plans Table -->
      <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div class="p-6 border-b border-gray-100">
          <h3 class="text-lg font-bold text-gray-800">Controlo de Subscrições</h3>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left">
            <thead>
              <tr class="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider font-semibold">
                <th class="px-6 py-4">Empresa</th>
                <th class="px-6 py-4">Plano / Ciclo</th>
                <th class="px-6 py-4">Estado</th>
                <th class="px-6 py-4">Início</th>
                <th class="px-6 py-4">Próxima Cobrança</th>
                <th class="px-6 py-4">Valor</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              <tr *ngFor="let sub of subscriptions()" class="hover:bg-gray-50 transition-colors">
                <td class="px-6 py-4 font-medium text-gray-900">{{ sub.company_name }}</td>
                <td class="px-6 py-4">
                  <div class="flex flex-col">
                    <span>{{ sub.plan_name }}</span>
                    <span class="text-xs text-gray-500">{{ sub.billing_cycle }}</span>
                  </div>
                </td>
                <td class="px-6 py-4">
                  <span [class]="getStatusClass(sub.status)" class="px-2 py-1 rounded text-xs font-medium uppercase">
                    {{ sub.status }}
                  </span>
                </td>
                <td class="px-6 py-4 text-gray-600">{{ sub.start_date | date:'dd/MM/yyyy' }}</td>
                <td class="px-6 py-4">
                  <div class="flex flex-col">
                    <span [class]="isOverdue(sub.next_billing_date) ? 'text-red-600 font-bold' : 'text-gray-600'">
                      {{ sub.next_billing_date | date:'dd/MM/yyyy' }}
                    </span>
                    <span *ngIf="sub.grace_period_until" class="text-[10px] text-orange-600 font-medium">
                      Grace: {{ sub.grace_period_until | date:'dd/MM/yyyy' }}
                    </span>
                  </div>
                </td>
                <td class="px-6 py-4 font-medium text-gray-900">
                  {{ sub.amount | currency:'MZN':'symbol':'1.2-2':'pt-MZ' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      </div>
    </div>
`
})
export class AdminRevenueComponent implements OnInit {
  subscriptions = signal<any[]>([]);
  stats = signal({
    mrr: 0,
    activeSubs: 0,
    trialingSubs: 0,
    pastDueSubs: 0
  });
  isLoading = signal(false);

  constructor(private supabase: SupabaseService) {}

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

      this.subscriptions.set(formatted);
      this.calculateStats(formatted);
    } catch (error) {
      console.error('Error loading revenue data:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  calculateStats(subs: any[]) {
    let mrr = 0;
    let active = 0;
    let trialing = 0;
    let pastDue = 0;

    subs.forEach(s => {
      if (s.status === 'active') {
        active++;
        // Normalize yearly to monthly for MRR
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

    this.stats.set({ mrr, activeSubs: active, trialingSubs: trialing, pastDueSubs: pastDue });
  }

  getStatusClass(status: string) {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-700';
      case 'past_due': return 'bg-red-100 text-red-700';
      case 'trialing': return 'bg-blue-100 text-blue-700';
      case 'cancelled': return 'bg-gray-100 text-gray-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  }

  isOverdue(date: string) {
    if (!date) return false;
    return new Date(date) < new Date();
  }
}
