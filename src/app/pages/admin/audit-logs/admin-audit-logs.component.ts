import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../../core/services/supabase.service';
import { PaginationComponent, PageChangeEvent } from '../../../shared/components/pagination.component';

@Component({
  selector: 'app-admin-audit-logs',
  standalone: true,
  imports: [CommonModule, FormsModule, PaginationComponent],
  template: `
    <div class="space-y-6">
      <div class="flex justify-between items-center">
        <div>
          <h2 class="text-2xl font-bold text-gray-800">Histórico Global de Auditoria</h2>
          <p class="text-xs text-gray-500 font-medium">Acompanhe todas as atividades dos utilizadores e alterações no sistema globalmente</p>
        </div>
        <button (click)="exportCSV()" class="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors flex items-center space-x-2 text-sm font-semibold">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          <span>Exportar CSV</span>
        </button>
      </div>

      <!-- Advanced Filters -->
      <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 space-y-4">
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <!-- Filter by Subscriber -->
          <div class="flex flex-col space-y-1">
            <label class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Subscritor</label>
            <select [(ngModel)]="selectedUserEmail" (change)="loadLogs()"
              class="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700 focus:ring-2 focus:ring-blue-500 outline-none">
              <option value="all">Todos os Subscritores</option>
              <option *ngFor="let p of profiles" [value]="p.email">{{ p.full_name || p.email }} ({{ p.email }})</option>
            </select>
          </div>

          <!-- Filter by Company -->
          <div class="flex flex-col space-y-1">
            <label class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Empresa / Contribuinte</label>
            <select [(ngModel)]="selectedCompanyId" (change)="loadLogs()"
              class="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700 focus:ring-2 focus:ring-blue-500 outline-none">
              <option value="all">Todas as Empresas</option>
              <option *ngFor="let c of companies" [value]="c.id">{{ c.name }} (NUIT: {{ c.nuit }})</option>
            </select>
          </div>

          <!-- Filter by Category -->
          <div class="flex flex-col space-y-1">
            <label class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Categoria</label>
            <select [(ngModel)]="selectedCategory" (change)="loadLogs()"
              class="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700 focus:ring-2 focus:ring-blue-500 outline-none">
              <option value="all">Todas as Categorias</option>
              <option *ngFor="let cat of categories" [value]="cat.id">{{ cat.label }}</option>
            </select>
          </div>

          <!-- Filter by Date -->
          <div class="flex flex-col space-y-1">
            <label class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Data Mínima</label>
            <input type="date" [(ngModel)]="startDate" (change)="loadLogs()"
              class="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700 focus:ring-2 focus:ring-blue-500 outline-none">
          </div>
        </div>

        <div class="flex items-center gap-4">
          <!-- Text Search -->
          <div class="flex-1">
            <input type="text" [(ngModel)]="searchTerm" (input)="onSearchInput()" placeholder="Pesquise por ação, IP ou detalhes específicos..."
              class="w-full px-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          </div>
          <button (click)="clearFilters()" class="text-xs font-semibold text-gray-500 hover:text-blue-600 transition-colors uppercase tracking-wider">
            Limpar Filtros
          </button>
        </div>
      </div>

      <!-- Loading State -->
      <div *ngIf="isLoading()" class="bg-white rounded-xl shadow-sm border border-gray-100 p-12 flex flex-col items-center justify-center space-y-4">
        <div class="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
        <p class="text-gray-500 text-xs tracking-wider animate-pulse">A CARREGAR DADOS DE AUDITORIA...</p>
      </div>

      <!-- Audit Logs Table -->
      <div *ngIf="!isLoading()" class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="bg-gray-50 text-gray-500 text-[10px] font-bold uppercase tracking-wider border-b border-gray-100">
                <th class="px-6 py-4 w-44">Data/Hora</th>
                <th class="px-6 py-4 w-48">Utilizador</th>
                <th class="px-6 py-4 w-44">Empresa</th>
                <th class="px-6 py-4">Ação</th>
                <th class="px-6 py-4 w-44">Categoria</th>
                <th class="px-6 py-4 w-32">IP</th>
                <th class="px-6 py-4 w-20 text-center">Detalhes</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 text-gray-700 text-sm">
              <tr *ngFor="let log of paginatedLogs()" class="hover:bg-gray-50/50 transition-colors">
                <td class="px-6 py-4 text-xs text-gray-500 font-medium">
                  {{ log.created_at | date:'dd/MM/yyyy HH:mm:ss' }}
                </td>
                <td class="px-6 py-4 truncate max-w-[180px]" [title]="log.user_email">
                  {{ log.user_email || 'Sistema' }}
                </td>
                <td class="px-6 py-4 truncate max-w-[160px]" [title]="log.company?.name || 'Sem Empresa'">
                  {{ log.company?.name || '—' }}
                </td>
                <td class="px-6 py-4 font-semibold text-gray-800">
                  {{ log.action }}
                </td>
                <td class="px-6 py-4">
                  <span class="px-2 py-0.5 text-[10px] font-bold rounded-full border whitespace-nowrap" [ngClass]="getCategoryBadge(log.category)">
                    {{ getCategoryLabel(log.category) }}
                  </span>
                </td>
                <td class="px-6 py-4 text-xs text-gray-500">
                  {{ log.ip_address || '—' }}
                </td>
                <td class="px-6 py-4 text-center">
                  <button (click)="viewDetails(log)" class="text-blue-600 hover:text-blue-800 font-bold transition-all text-xs">
                    Ver
                  </button>
                </td>
              </tr>
              <tr *ngIf="filteredLogs().length === 0">
                <td colspan="7" class="px-6 py-12 text-center text-gray-400">
                  Nenhum registo de auditoria encontrado.
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Pagination -->
        <div class="border-t border-gray-100">
          <app-pagination
            [totalItems]="filteredLogs().length"
            [pageSizeOptions]="[10, 20, 50]"
            [defaultPageSize]="10"
            (pageChange)="onPageChange($event)">
          </app-pagination>
        </div>
      </div>
    </div>

    <!-- Details Slide-over -->
    <div *ngIf="selectedLog" class="fixed inset-0 z-50 overflow-hidden">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity" (click)="closeDetails()"></div>
      <div class="fixed inset-y-0 right-0 max-w-lg w-full bg-white shadow-2xl flex flex-col transform transition-transform animate-in slide-in-from-right duration-300">
        <div class="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <div>
            <h3 class="text-xl font-bold text-gray-800 font-serif uppercase tracking-tight">Atividade do Sistema</h3>
            <p class="text-xs text-gray-500 font-medium">{{ selectedLog.created_at | date:'dd/MM/yyyy HH:mm:ss' }}</p>
          </div>
          <button (click)="closeDetails()" class="text-gray-400 hover:text-gray-600 transition-colors">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div class="flex-1 overflow-y-auto p-6 space-y-6">
          <div class="grid grid-cols-1 gap-4">
            <div class="bg-gray-50 p-4 rounded-xl border border-gray-100 space-y-3">
              <div>
                <span class="text-[10px] font-bold text-gray-400 uppercase">Utilizador</span>
                <p class="font-semibold text-gray-800 truncate text-sm">{{ selectedLog.user_email || 'Sistema' }}</p>
              </div>
              <div>
                <span class="text-[10px] font-bold text-gray-400 uppercase">Ação</span>
                <p class="font-bold text-blue-600 text-sm">{{ selectedLog.action }}</p>
              </div>
              <div>
                <span class="text-[10px] font-bold text-gray-400 uppercase">Empresa Relacionada</span>
                <p class="font-semibold text-gray-800 text-sm">{{ selectedLog.company?.name || '—' }}</p>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <span class="text-[10px] font-bold text-gray-400 uppercase">Endereço IP</span>
                  <p class="font-semibold text-gray-800 text-xs">{{ selectedLog.ip_address || '—' }}</p>
                </div>
                <div>
                  <span class="text-[10px] font-bold text-gray-400 uppercase">Categoria</span>
                  <p class="mt-0.5">
                    <span class="px-2 py-0.5 text-[10px] font-bold rounded-full border" [ngClass]="getCategoryBadge(selectedLog.category)">
                      {{ getCategoryLabel(selectedLog.category) }}
                    </span>
                  </p>
                </div>
              </div>
            </div>

            <div class="space-y-2">
              <span class="text-[10px] font-bold text-gray-400 uppercase">Metadados da Atividade (JSON)</span>
              <pre class="bg-slate-900 text-green-400 p-4 rounded-xl text-xs font-mono overflow-x-auto whitespace-pre-wrap">{{ selectedLog.details | json }}</pre>
            </div>
          </div>
        </div>

        <div class="p-6 border-t border-gray-100 bg-gray-50 flex justify-end">
          <button (click)="closeDetails()" class="px-6 py-2 bg-gray-200 text-gray-700 hover:bg-gray-300 font-semibold text-sm rounded-xl transition-all">
            Fechar
          </button>
        </div>
      </div>
    </div>
  `
})
export class AdminAuditLogsComponent implements OnInit {
  logs = signal<any[]>([]);
  profiles: any[] = [];
  companies: any[] = [];
  isLoading = signal(false);

  // Filters state
  selectedUserEmail = 'all';
  selectedCompanyId = 'all';
  selectedCategory = 'all';
  startDate = '';
  searchTerm = '';

  // Pagination state
  currentPage = signal(1);
  pageSize = signal(10);

  // Dialog state
  selectedLog: any = null;

  categories = [
    { id: 'auth', label: 'Login e Logout' },
    { id: 'clients', label: 'Clientes' },
    { id: 'products', label: 'Produtos e Serviços' },
    { id: 'invoices', label: 'Facturas' },
    { id: 'reports', label: 'Relatórios' },
    { id: 'declarations', label: 'Declarações Fiscais' },
    { id: 'payments', label: 'Pagamentos' },
    { id: 'settings', label: 'Configurações' },
    { id: 'users', label: 'Utilizadores' },
    { id: 'subscriptions', label: 'Subscrições' },
    { id: 'system', label: 'Sistema' }
  ];

  filteredLogs = computed(() => {
    let list = this.logs();

    if (this.selectedCategory !== 'all') {
      list = list.filter(l => l.category === this.selectedCategory);
    }

    if (this.searchTerm) {
      const term = this.searchTerm.toLowerCase();
      list = list.filter(l =>
        (l.action || '').toLowerCase().includes(term) ||
        (l.user_email || '').toLowerCase().includes(term) ||
        (l.ip_address || '').toLowerCase().includes(term) ||
        (l.company?.name || '').toLowerCase().includes(term) ||
        JSON.stringify(l.details || {}).toLowerCase().includes(term)
      );
    }

    return list;
  });

  paginatedLogs = computed(() => {
    const list = this.filteredLogs();
    const start = (this.currentPage() - 1) * this.pageSize();
    return list.slice(start, start + this.pageSize());
  });

  constructor(private supabase: SupabaseService) {}

  async ngOnInit() {
    await this.loadFilterMetadata();
    await this.loadLogs();
  }

  async loadFilterMetadata() {
    try {
      // Load all subscribers/profiles
      const { data: profs } = await this.supabase.db
        .from('profiles')
        .select('email, full_name')
        .order('full_name', { ascending: true });
      this.profiles = profs || [];

      // Load all companies
      const { data: comps } = await this.supabase.db
        .from('companies')
        .select('id, name, nuit')
        .order('name', { ascending: true });
      this.companies = comps || [];
    } catch (error) {
      console.error('Erro ao carregar metadados dos filtros:', error);
    }
  }

  async loadLogs() {
    this.isLoading.set(true);
    try {
      let query = this.supabase.db
        .from('audit_logs')
        .select(`
          *,
          company:companies (id, name, nuit)
        `)
        .order('created_at', { ascending: false });

      if (this.selectedUserEmail !== 'all') {
        query = query.eq('user_email', this.selectedUserEmail);
      }
      if (this.selectedCompanyId !== 'all') {
        query = query.eq('company_id', this.selectedCompanyId);
      }
      if (this.startDate) {
        query = query.gte('created_at', `${this.startDate}T00:00:00Z`);
      }

      const { data, error } = await query;
      if (error) throw error;

      this.logs.set(data || []);
      this.currentPage.set(1);
    } catch (error) {
      console.error('Erro ao carregar histórico global de auditoria:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  onSearchInput() {
    this.currentPage.set(1);
  }

  onPageChange(event: PageChangeEvent) {
    this.currentPage.set(event.page);
    this.pageSize.set(event.pageSize);
  }

  clearFilters() {
    this.selectedUserEmail = 'all';
    this.selectedCompanyId = 'all';
    this.selectedCategory = 'all';
    this.startDate = '';
    this.searchTerm = '';
    this.loadLogs();
  }

  viewDetails(log: any) {
    this.selectedLog = log;
  }

  closeDetails() {
    this.selectedLog = null;
  }

  getCategoryLabel(category: string): string {
    const found = this.categories.find(c => c.id === category);
    return found ? found.label : category;
  }

  getCategoryBadge(category: string): string {
    switch (category) {
      case 'auth': return 'bg-cyan-50 border-cyan-200 text-cyan-700';
      case 'clients': return 'bg-sky-50 border-sky-200 text-sky-700';
      case 'products': return 'bg-violet-50 border-violet-200 text-violet-700';
      case 'invoices': return 'bg-indigo-50 border-indigo-200 text-indigo-700';
      case 'reports': return 'bg-emerald-50 border-emerald-200 text-emerald-700';
      case 'declarations': return 'bg-amber-50 border-amber-200 text-amber-700';
      case 'payments': return 'bg-green-50 border-green-200 text-green-700';
      case 'settings': return 'bg-purple-50 border-purple-200 text-purple-700';
      case 'users': return 'bg-pink-50 border-pink-200 text-pink-700';
      case 'subscriptions': return 'bg-rose-50 border-rose-200 text-rose-700';
      default: return 'bg-slate-50 border-slate-200 text-slate-700';
    }
  }

  exportCSV() {
    const data = this.filteredLogs();
    if (data.length === 0) return;

    const headers = ['Data/Hora', 'Utilizador', 'Empresa', 'NUIT', 'Ação', 'Categoria', 'IP', 'Detalhes'];

    const rows = data.map(l => [
      `"${new Date(l.created_at).toLocaleString('pt-MZ')}"`,
      `"${l.user_email || 'Sistema'}"`,
      `"${(l.company?.name || '').replace(/"/g, '""')}"`,
      `"${l.company?.nuit || ''}"`,
      `"${l.action.replace(/"/g, '""')}"`,
      `"${this.getCategoryLabel(l.category)}"`,
      `"${l.ip_address || ''}"`,
      `"${JSON.stringify(l.details || {}).replace(/"/g, '""')}"`
    ]);

    const csvContent = '\uFEFF'
      + headers.join(';') + '\n'
      + rows.map(r => r.join(';')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    const timestamp = new Date().toISOString().split('T')[0];
    link.setAttribute('href', url);
    link.setAttribute('download', `auditoria_global_${timestamp}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}
