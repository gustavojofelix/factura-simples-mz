import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SupabaseService } from '../../../core/services/supabase.service';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-6">
      <!-- Loading State Overlay -->
      <div *ngIf="isLoading()" class="fixed inset-0 bg-white/60 backdrop-blur-[2px] z-50 flex flex-col items-center justify-center space-y-4">
        <div class="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
        <p class="text-gray-500 font-medium animate-pulse uppercase tracking-widest text-[10px]">A atualizar dashboard...</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <p class="text-sm font-medium text-gray-500">MRR Estimado</p>
          <p class="text-3xl font-bold text-blue-600 mt-2">{{ stats().mrr | currency:'MZN':'symbol':'1.2-2':'pt-MZ' }}</p>
        </div>
        <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <p class="text-sm font-medium text-gray-500 font-serif uppercase tracking-tight">Total de Subscritores</p>
          <p class="text-3xl font-bold text-gray-900 mt-2">{{ stats().totalSubscribers }}</p>
        </div>
        <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <p class="text-sm font-medium text-gray-500 font-serif uppercase tracking-tight">Contribuintes Activos</p>
          <p class="text-3xl font-bold text-gray-900 mt-2">{{ stats().totalCompanies }}</p>
        </div>
        <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <p class="text-sm font-medium text-gray-500 font-serif uppercase tracking-tight">Utilizadores Totais</p>
          <p class="text-3xl font-bold text-gray-900 mt-2">{{ stats().totalUsers }}</p>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Recent Users Table -->
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div class="p-6 border-b border-gray-100">
            <h2 class="text-lg font-bold text-gray-800 font-serif uppercase tracking-tight">Utilizadores Recentes</h2>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-left">
              <thead>
                <tr class="bg-gray-50 text-gray-500 text-[10px] uppercase tracking-wider font-semibold">
                  <th class="px-6 py-4">Nome</th>
                  <th class="px-6 py-4">Estado</th>
                  <th class="px-6 py-4">Data</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100">
                <tr *ngFor="let user of recentUsers()" class="hover:bg-gray-50 transition-colors">
                  <td class="px-6 py-4">
                    <div class="flex flex-col">
                      <span class="font-medium text-gray-900 text-sm">{{ user.full_name }}</span>
                      <span class="text-[10px] text-gray-500">{{ user.email }}</span>
                    </div>
                  </td>
                  <td class="px-6 py-4">
                    <span [class]="user.status === 'suspended' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'"
                          class="px-2 py-0.5 rounded text-[10px] font-bold uppercase">
                      {{ user.status || 'active' }}
                    </span>
                  </td>
                  <td class="px-6 py-4 text-gray-500 text-xs text-right">
                    {{ user.created_at | date:'dd/MM' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- System Alerts/Activity -->
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col">
          <div class="p-6 border-b border-gray-100">
            <h2 class="text-lg font-bold text-gray-800 font-serif uppercase tracking-tight">Alertas do Sistema</h2>
          </div>
          <div class="p-6 space-y-4">
            <div *ngIf="alerts().length === 0" class="text-center text-gray-500 text-sm py-8">
              Sem alertas críticos no momento.
            </div>
            <div *ngFor="let alert of alerts()" class="flex items-start space-x-3 p-3 rounded-lg" 
                 [class.bg-red-50]="alert.type === 'error'" [class.bg-blue-50]="alert.type === 'info'">
              <span class="mt-1">
                <svg *ngIf="alert.type === 'error'" class="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <svg *ngIf="alert.type === 'info'" class="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </span>
              <div>
                <p class="text-xs font-semibold" [class.text-red-900]="alert.type === 'error'" [class.text-blue-900]="alert.type === 'info'">{{ alert.title }}</p>
                <p class="text-[10px] text-gray-600">{{ alert.message }}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `
})
export class AdminDashboardComponent implements OnInit {
  stats = signal({
    totalSubscribers: 0,
    totalCompanies: 0,
    totalUsers: 0,
    mrr: 0
  });
  
  recentUsers = signal<any[]>([]);
  alerts = signal<any[]>([]);
  isLoading = signal(false);

  constructor(private supabase: SupabaseService) {}

  ngOnInit() {
    this.loadStats();
    this.loadRecentUsers();
  }

  async loadStats() {
    this.isLoading.set(true);
    try {
      // Subscribers are all profiles that have companies (or all profiles in general if we follow AdminSubscribers update)
      // For dashboard, we'll count all profiles as potential subscribers now to stay aligned
      const { count: subCount } = await this.supabase.db
        .from('profiles')
        .select('*', { count: 'exact', head: true });

      const { count: companiesCount } = await this.supabase.db.from('companies').select('*', { count: 'exact', head: true });
    
    // Total users in the system (all profiles)
    const { count: usersCount } = await this.supabase.db.from('profiles').select('*', { count: 'exact', head: true });
    
    // Calculate MRR from active subscriptions
    const { data: subs } = await this.supabase.db
      .from('subscriptions')
      .select('amount, billing_cycle')
      .eq('status', 'active');

    let mrr = 0;
    if (subs) {
      subs.forEach(s => {
        const amount = Number(s.amount) || 0;
        if (s.billing_cycle === 'yearly') mrr += amount / 12;
        else if (s.billing_cycle === 'semiannual') mrr += amount / 6;
        else if (s.billing_cycle === 'quarterly') mrr += amount / 3;
        else mrr += amount;
      });
    }

    this.stats.set({
      totalSubscribers: subCount || 0,
      totalCompanies: companiesCount || 0,
      totalUsers: usersCount || 0,
      mrr
    });

    // Simple Alert Logic
    const alertList = [];
    if (mrr < 1000) alertList.push({ type: 'info', title: 'Novos Passos', message: 'MRR abaixo da meta inicial de 1k MT.' });
    
    // Check for past due subscriptions
    const { count: pastDueCount } = await this.supabase.db
      .from('subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'past_due');
    
    if (pastDueCount && pastDueCount > 0) {
      alertList.push({ type: 'error', title: 'Cobranças Pendentes', message: `${pastDueCount} subscrições estão com pagamento em atraso.` });
    }

    this.alerts.set(alertList);
    } catch (error) {
      console.error('Error loading dashboard stats:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  async loadRecentUsers() {
    const { data } = await this.supabase.db
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(6);
    
    this.recentUsers.set(data || []);
  }
}
