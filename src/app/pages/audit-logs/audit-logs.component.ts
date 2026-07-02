import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CompanyService } from '../../core/services/company.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { PaginationComponent, PageChangeEvent } from '../../shared/components/pagination.component';

@Component({
  selector: 'app-audit-logs',
  standalone: true,
  imports: [CommonModule, FormsModule, PaginationComponent],
  template: `
    <div class="p-6 max-w-7xl mx-auto space-y-6">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 class="text-3xl font-extrabold text-slate-900 tracking-tight">Registo de Auditoria</h1>
          <p class="text-slate-500 text-sm mt-1">Historial de atividades críticas do sistema para as suas empresas</p>
        </div>
        <button (click)="exportToCSV()" class="flex items-center space-x-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 transition-all font-semibold shadow-sm text-sm">
          <svg class="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          <span>Exportar CSV</span>
        </button>
      </div>

      <!-- Filters Panel -->
      <div class="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <!-- Company Selector -->
          <div class="flex flex-col space-y-1">
            <label class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Empresa</label>
            <select [(ngModel)]="selectedCompanyId" (change)="loadLogs()"
              class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 focus:ring-2 focus:ring-orange-500 outline-none">
              <option value="all">Todas as Empresas</option>
              <option *ngFor="let comp of companyService.companies()" [value]="comp.id">{{ comp.name }}</option>
            </select>
          </div>

          <!-- Category Filter -->
          <div class="flex flex-col space-y-1">
            <label class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Categoria</label>
            <select [(ngModel)]="selectedCategory" (change)="loadLogs()"
              class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 focus:ring-2 focus:ring-orange-500 outline-none">
              <option value="all">Todas as Categorias</option>
              <option *ngFor="let cat of categories" [value]="cat.id">{{ cat.label }}</option>
            </select>
          </div>

          <!-- Start Date -->
          <div class="flex flex-col space-y-1">
            <label class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Data Inicial</label>
            <input type="date" [(ngModel)]="startDate" (change)="loadLogs()"
              class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 focus:ring-2 focus:ring-orange-500 outline-none">
          </div>

          <!-- End Date -->
          <div class="flex flex-col space-y-1">
            <label class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Data Final</label>
            <input type="date" [(ngModel)]="endDate" (change)="loadLogs()"
              class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 focus:ring-2 focus:ring-orange-500 outline-none">
          </div>
        </div>

        <div class="flex items-center gap-4">
          <!-- Text Search -->
          <div class="flex-1">
            <input type="text" [(ngModel)]="searchTerm" (input)="onSearchInput()" placeholder="Pesquisar por ação, utilizador ou detalhes..."
              class="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-500">
          </div>
          <button (click)="clearFilters()" class="text-xs font-semibold text-slate-500 hover:text-orange-500 transition-colors uppercase tracking-wider">
            Limpar Filtros
          </button>
        </div>
      </div>

      <!-- Loading Spinner -->
      <div *ngIf="isLoading()" class="bg-white rounded-2xl border border-slate-100 p-12 flex flex-col items-center justify-center space-y-4">
        <div class="w-10 h-10 border-4 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
        <p class="text-slate-500 text-xs tracking-wider animate-pulse">A CARREGAR REGISTOS...</p>
      </div>

      <!-- Logs Table -->
      <div *ngIf="!isLoading()" class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="bg-slate-50 text-slate-400 text-[10px] font-bold uppercase tracking-wider border-b border-slate-100">
                <th class="px-6 py-4 w-44">Data/Hora</th>
                <th class="px-6 py-4 w-52">Utilizador</th>
                <th class="px-6 py-4">Ação</th>
                <th class="px-6 py-4 w-44">Categoria</th>
                <th class="px-6 py-4 w-40">Entidade</th>
                <th class="px-6 py-4 w-36">IP</th>
                <th class="px-6 py-4 w-20 text-center">Detalhes</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 text-slate-700 text-sm">
              <tr *ngFor="let log of paginatedLogs()" class="hover:bg-slate-50/50 transition-colors">
                <td class="px-6 py-4 font-medium text-slate-500 text-xs">
                  {{ log.created_at | date:'dd/MM/yyyy HH:mm:ss' }}
                </td>
                <td class="px-6 py-4 truncate max-w-[200px]" [title]="log.user_email">
                  {{ log.user_email || 'Sistema' }}
                </td>
                <td class="px-6 py-4 font-semibold text-slate-800">
                  {{ log.action }}
                </td>
                <td class="px-6 py-4">
                  <span class="px-2 py-0.5 text-[10px] font-bold rounded-full border whitespace-nowrap" [ngClass]="getCategoryBadge(log.category)">
                    {{ getCategoryLabel(log.category) }}
                  </span>
                </td>
                <td class="px-6 py-4 text-xs font-mono text-slate-500 truncate max-w-[150px]" [title]="log.entity_name || '—'">
                  {{ log.entity_name || '—' }}
                </td>
                <td class="px-6 py-4 text-xs text-slate-500">
                  {{ log.ip_address || '—' }}
                </td>
                <td class="px-6 py-4 text-center">
                  <button (click)="viewDetails(log)" class="text-orange-500 hover:text-orange-700 font-bold transition-all text-xs focus:outline-none">
                    Ver
                  </button>
                </td>
              </tr>
              <tr *ngIf="filteredLogs().length === 0">
                <td colspan="7" class="px-6 py-12 text-center text-slate-400">
                  Nenhum registo de auditoria encontrado.
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Pagination -->
        <div class="border-t border-slate-100">
          <app-pagination
            [totalItems]="filteredLogs().length"
            [pageSizeOptions]="[10, 20, 50]"
            [defaultPageSize]="10"
            (pageChange)="onPageChange($event)">
          </app-pagination>
        </div>
      </div>
    </div>

    <!-- Details Modal -->
    <div *ngIf="selectedLog" class="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden transform transition-all animate-in fade-in zoom-in-95 duration-200">
        <div class="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <div>
            <h3 class="text-lg font-bold text-slate-800">Detalhes da Atividade</h3>
            <p class="text-xs text-slate-500 font-medium">{{ selectedLog.created_at | date:'dd/MM/yyyy HH:mm:ss' }}</p>
          </div>
          <button (click)="closeDetails()" class="text-slate-400 hover:text-slate-600 focus:outline-none">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div class="p-6 space-y-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
          <div class="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span class="text-[10px] font-bold text-slate-400 uppercase">Utilizador</span>
              <p class="font-semibold text-slate-800 mt-0.5 truncate">{{ selectedLog.user_email || 'Sistema' }}</p>
            </div>
            <div>
              <span class="text-[10px] font-bold text-slate-400 uppercase">Endereço IP</span>
              <p class="font-semibold text-slate-800 mt-0.5">{{ selectedLog.ip_address || '—' }}</p>
            </div>
            <div>
              <span class="text-[10px] font-bold text-slate-400 uppercase">Categoria</span>
              <p class="mt-0.5">
                <span class="px-2 py-0.5 text-[10px] font-bold rounded-full border" [ngClass]="getCategoryBadge(selectedLog.category)">
                  {{ getCategoryLabel(selectedLog.category) }}
                </span>
              </p>
            </div>
            <div>
              <span class="text-[10px] font-bold text-slate-400 uppercase">Ação Realizada</span>
              <p class="font-semibold text-slate-800 mt-0.5">{{ selectedLog.action }}</p>
            </div>
            <div *ngIf="selectedLog.entity_name">
              <span class="text-[10px] font-bold text-slate-400 uppercase">Referência da Entidade</span>
              <p class="font-semibold text-slate-800 mt-0.5 font-mono text-xs">{{ selectedLog.entity_name }}</p>
            </div>
            <div *ngIf="selectedLog.entity_id">
              <span class="text-[10px] font-bold text-slate-400 uppercase">ID da Entidade</span>
              <p class="font-semibold text-slate-800 mt-0.5 font-mono text-[10px] truncate" [title]="selectedLog.entity_id">{{ selectedLog.entity_id }}</p>
            </div>
          </div>

          <div class="border-t border-slate-100 pt-4 space-y-2">
            <span class="text-[10px] font-bold text-slate-400 uppercase">Dados da Atividade (JSON)</span>
            <pre class="bg-slate-50 border border-slate-100 p-4 rounded-xl text-xs font-mono text-slate-600 overflow-x-auto whitespace-pre-wrap">{{ selectedLog.details | json }}</pre>
          </div>
        </div>

        <div class="p-6 bg-slate-50 border-t border-slate-100 flex justify-end">
          <button (click)="closeDetails()" class="px-6 py-2 bg-slate-200 text-slate-700 rounded-xl hover:bg-slate-300 font-semibold text-sm transition-all focus:outline-none">
            Fechar
          </button>
        </div>
      </div>
    </div>
  `
})
export class AuditLogsComponent implements OnInit {
  logs = signal<any[]>([]);
  isLoading = signal(false);

  // Filters state
  selectedCompanyId = 'all';
  selectedCategory = 'all';
  startDate = '';
  endDate = '';
  searchTerm = '';

  // Pagination state
  currentPage = signal(1);
  pageSize = signal(10);

  // Dialog details
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
        (l.entity_name || '').toLowerCase().includes(term) ||
        (l.ip_address || '').toLowerCase().includes(term) ||
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

  constructor(
    public companyService: CompanyService,
    private supabase: SupabaseService,
    private router: Router
  ) {}

  async ngOnInit() {
    await this.companyService.loadCompanies();
    const role = this.companyService.activeRole();
    if (role !== 'owner' && role !== 'admin') {
      this.router.navigate(['/painel']);
      return;
    }
    await this.loadLogs();
  }

  async loadLogs() {
    this.isLoading.set(true);

    try {
      let query = this.supabase.db
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false });

      if (this.selectedCompanyId !== 'all') {
        query = query.eq('company_id', this.selectedCompanyId);
      } else {
        // Limit to only companies the user is authorized to manage
        const compIds = this.companyService.companies().map(c => c.id);
        if (compIds.length > 0) {
          query = query.in('company_id', compIds);
        } else {
          this.logs.set([]);
          this.isLoading.set(false);
          return;
        }
      }

      if (this.startDate) {
        query = query.gte('created_at', `${this.startDate}T00:00:00Z`);
      }
      if (this.endDate) {
        query = query.lte('created_at', `${this.endDate}T23:59:59Z`);
      }

      const { data, error } = await query;
      if (error) throw error;

      this.logs.set(data || []);
      this.currentPage.set(1); // Reset to first page when data loads/filters
    } catch (error) {
      console.error('Erro ao carregar registos de auditoria:', error);
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
    this.selectedCompanyId = 'all';
    this.selectedCategory = 'all';
    this.startDate = '';
    this.endDate = '';
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

  exportToCSV() {
    const data = this.filteredLogs();
    if (data.length === 0) return;

    const headers = ['Data/Hora', 'Utilizador', 'Ação', 'Categoria', 'Entidade', 'ID Entidade', 'IP', 'Detalhes'];

    const rows = data.map(l => [
      `"${new Date(l.created_at).toLocaleString('pt-MZ')}"`,
      `"${l.user_email || 'Sistema'}"`,
      `"${l.action.replace(/"/g, '""')}"`,
      `"${this.getCategoryLabel(l.category)}"`,
      `"${(l.entity_name || '').replace(/"/g, '""')}"`,
      `"${l.entity_id || ''}"`,
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
    link.setAttribute('download', `auditoria_${timestamp}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}
