import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SupabaseService } from '../../../core/services/supabase.service';

interface DashboardStats {
  totalSubscribers: number;
  totalCompanies: number;
  totalUsers: number;
  mrr: number;
}

interface AlertItem {
  type: 'error' | 'info';
  title: string;
  message: string;
}

interface RecentUser {
  id: string;
  full_name: string;
  email: string;
  status?: string;
  created_at: string;
}

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-6">

      <div class="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <p class="text-sm font-medium text-gray-500">MRR Estimado</p>
          @if (isLoading()) {
            <div class="h-9 w-32 bg-gray-200 rounded animate-pulse mt-2"></div>
          } @else {
            <p class="text-3xl font-bold text-blue-600 mt-2">{{ stats().mrr | currency:'MZN':'symbol':'1.2-2':'pt-MZ' }}</p>
          }
        </div>
        <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <p class="text-sm font-medium text-gray-500 uppercase tracking-tight">Total de Subscritores</p>
          @if (isLoading()) {
            <div class="h-9 w-16 bg-gray-200 rounded animate-pulse mt-2"></div>
          } @else {
            <p class="text-3xl font-bold text-gray-900 mt-2">{{ stats().totalSubscribers }}</p>
          }
        </div>
        <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <p class="text-sm font-medium text-gray-500 uppercase tracking-tight">Contribuintes Activos</p>
          @if (isLoading()) {
            <div class="h-9 w-16 bg-gray-200 rounded animate-pulse mt-2"></div>
          } @else {
            <p class="text-3xl font-bold text-gray-900 mt-2">{{ stats().totalCompanies }}</p>
          }
        </div>
        <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <p class="text-sm font-medium text-gray-500 uppercase tracking-tight">Utilizadores Totais</p>
          @if (isLoading()) {
            <div class="h-9 w-16 bg-gray-200 rounded animate-pulse mt-2"></div>
          } @else {
            <p class="text-3xl font-bold text-gray-900 mt-2">{{ stats().totalUsers }}</p>
          }
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Recent Users Table -->
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div class="p-6 border-b border-gray-100">
            <h2 class="text-lg font-bold text-gray-800 uppercase tracking-tight">Utilizadores Recentes</h2>
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
                @if (isLoading()) {
                  @for (_ of skeletonRows; track $index) {
                    <tr>
                      <td class="px-6 py-4">
                        <div class="flex flex-col gap-1">
                          <div class="h-3 w-28 bg-gray-200 rounded animate-pulse"></div>
                          <div class="h-2 w-36 bg-gray-100 rounded animate-pulse"></div>
                        </div>
                      </td>
                      <td class="px-6 py-4"><div class="h-4 w-14 bg-gray-200 rounded-full animate-pulse"></div></td>
                      <td class="px-6 py-4"><div class="h-3 w-10 bg-gray-200 rounded animate-pulse"></div></td>
                    </tr>
                  }
                } @else {
                  @for (user of recentUsers(); track user.id) {
                    <tr class="hover:bg-gray-50 transition-colors">
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
                  }
                  @if (recentUsers().length === 0) {
                    <tr><td colspan="3" class="px-6 py-8 text-center text-sm text-gray-400">Sem utilizadores registados.</td></tr>
                  }
                }
              </tbody>
            </table>
          </div>
        </div>

        <!-- System Alerts -->
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col">
          <div class="p-6 border-b border-gray-100">
            <h2 class="text-lg font-bold text-gray-800 uppercase tracking-tight">Alertas do Sistema</h2>
          </div>
          <div class="p-6 space-y-4">
            @if (isLoading()) {
              <div class="h-16 bg-gray-100 rounded-lg animate-pulse"></div>
              <div class="h-16 bg-gray-100 rounded-lg animate-pulse"></div>
            } @else if (alerts().length === 0) {
              <div class="text-center text-gray-500 text-sm py-8 flex flex-col items-center gap-3">
                <svg class="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
                Sem alertas críticos no momento.
              </div>
            } @else {
              @for (alert of alerts(); track alert.title) {
                <div class="flex items-start space-x-3 p-3 rounded-lg"
                     [class.bg-red-50]="alert.type === 'error'"
                     [class.bg-blue-50]="alert.type === 'info'">
                  <span class="mt-1">
                    @if (alert.type === 'error') {
                      <svg class="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                      </svg>
                    }
                    @if (alert.type === 'info') {
                      <svg class="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                      </svg>
                    }
                  </span>
                  <div>
                    <p class="text-xs font-semibold" [class.text-red-900]="alert.type === 'error'" [class.text-blue-900]="alert.type === 'info'">{{ alert.title }}</p>
                    <p class="text-[10px] text-gray-600">{{ alert.message }}</p>
                  </div>
                </div>
              }
            }
          </div>
        </div>
      </div>
    </div>
  `
})
export class AdminDashboardComponent implements OnInit {
  stats = signal<DashboardStats>({
    totalSubscribers: 0,
    totalCompanies: 0,
    totalUsers: 0,
    mrr: 0
  });

  recentUsers = signal<RecentUser[]>([]);
  alerts = signal<AlertItem[]>([]);
  isLoading = signal(true);
  skeletonRows = [1, 2, 3, 4, 5, 6];

  constructor(private supabase: SupabaseService) {}

  ngOnInit() {
    this.loadDashboard();
  }

  async loadDashboard() {
    this.isLoading.set(true);
    try {
      // All queries run in parallel — no sequential awaits
      const [
        { count: profilesCount },
        { count: companiesCount },
        { data: activeSubs },
        { count: pastDueCount },
        { data: recentProfiles }
      ] = await Promise.all([
        this.supabase.db.from('profiles').select('*', { count: 'exact', head: true }),
        this.supabase.db.from('companies').select('*', { count: 'exact', head: true }),
        this.supabase.db.from('subscriptions').select('amount, billing_cycle').eq('status', 'active'),
        this.supabase.db.from('subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'past_due'),
        this.supabase.db.from('profiles').select('id, full_name, email, status, created_at').order('created_at', { ascending: false }).limit(6)
      ]);

      // Calculate MRR
      const mrr = (activeSubs || []).reduce((acc, s) => {
        const amount = Number(s.amount) || 0;
        const divisors: Record<string, number> = { yearly: 12, semiannual: 6, quarterly: 3 };
        return acc + amount / (divisors[s.billing_cycle] ?? 1);
      }, 0);

      this.stats.set({
        totalSubscribers: profilesCount || 0,
        totalCompanies: companiesCount || 0,
        totalUsers: profilesCount || 0, // Same source — no duplicate query
        mrr
      });

      this.recentUsers.set((recentProfiles || []) as RecentUser[]);

      // Build alert list
      const alertList: AlertItem[] = [];
      if (mrr < 1000) {
        alertList.push({ type: 'info', title: 'Novos Passos', message: 'MRR abaixo da meta inicial de 1k MT.' });
      }
      if ((pastDueCount || 0) > 0) {
        alertList.push({ type: 'error', title: 'Cobranças Pendentes', message: `${pastDueCount} subscrições com pagamento em atraso.` });
      }
      this.alerts.set(alertList);
    } catch (error) {
      console.error('Error loading dashboard stats:', error);
    } finally {
      this.isLoading.set(false);
    }
  }
}
