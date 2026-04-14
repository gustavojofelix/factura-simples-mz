import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../../core/services/supabase.service';
import { createClient } from '@supabase/supabase-js';
import { environment } from '../../../../environments/environment';
import { PaginationComponent, PageChangeEvent } from '../../../shared/components/pagination.component';

@Component({
  selector: 'app-admin-subscribers',
  standalone: true,
  imports: [CommonModule, FormsModule, PaginationComponent],
  template: `
      <div class="space-y-6">
         <!-- Create Subscriber Modal -->
          <div *ngIf="isCreateModalOpen" class="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all animate-in fade-in zoom-in duration-200">
              <div class="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                <h3 class="text-xl font-bold text-gray-800 font-serif uppercase tracking-tight">Novo Subscritor</h3>
                <button (click)="closeCreateModal()" class="text-gray-400 hover:text-gray-600">
                  <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div class="p-6 space-y-4">
                <div class="space-y-1">
                  <label class="text-[10px] font-bold text-gray-500 uppercase">Nome Completo *</label>
                  <input [(ngModel)]="newSub.full_name" type="text" placeholder="Ex: João Silva"
                    class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
                </div>
                <div class="space-y-1">
                  <label class="text-[10px] font-bold text-gray-500 uppercase">E-mail*</label>
                  <input [(ngModel)]="newSub.email" type="email" placeholder="email@exemplo.com"
                    class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
                </div>
                <div class="space-y-1">
                  <label class="text-[10px] font-bold text-gray-500 uppercase">Palavra-passe *</label>
                  <input [(ngModel)]="newSub.password" type="password" placeholder="Mínimo 6 caracteres"
                    class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
                </div>
                <div class="grid grid-cols-2 gap-4">
                  <div class="space-y-1">
                    <label class="text-[10px] font-bold text-gray-500 uppercase">Telefone</label>
                    <input [(ngModel)]="newSub.phone" type="text" placeholder="Ex: 84 000 0000"
                      class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
                  </div>
                  <div class="space-y-1">
                    <label class="text-[10px] font-bold text-gray-500 uppercase">Estado</label>
                    <select [(ngModel)]="newSub.status" class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
                      <option value="active">Activo</option>
                      <option value="suspended">Suspenso</option>
                    </select>
                  </div>
                </div>
                <p *ngIf="createError" class="text-xs text-red-600 font-medium">{{createError }}</p>
              </div>

              <div class="p-6 bg-gray-50 border-t border-gray-100 flex space-x-3">
                <button (click)="closeCreateModal()" class="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-xl hover:bg-white transition-colors text-sm font-semibold uppercase tracking-tight">
                  Cancelar
                </button>
                <button (click)="createSubscriber()" [disabled]="isCreating"
                  class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all text-sm font-bold uppercase tracking-tight disabled:opacity-50">
                  {{ isCreating ? 'A criar...' : 'Criar' }}
                </button>
              </div>
            </div>
          </div>

        <!-- Edit Modal -->
        <div *ngIf="isEditModalOpen" class="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all animate-in fade-in zoom-in duration-200">
            <div class="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h3 class="text-xl font-bold text-gray-800 font-serif uppercase tracking-tight">Gerir Subscritor</h3>
              <button (click)="closeEditModal()" class="text-gray-400 hover:text-gray-600">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div class="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              <div class="space-y-1">
                <label class="text-[10px] font-bold text-gray-500 uppercase">Nome Completo</label>
                <input [(ngModel)]="editingSub.full_name" type="text" class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
              </div>

              <div class="grid grid-cols-2 gap-4">
                <div class="space-y-1">
                  <label class="text-[10px] font-bold text-gray-500 uppercase">Telefone</label>
                  <input [(ngModel)]="editingSub.phone" type="text" class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
                </div>
                <div class="space-y-1">
                  <label class="text-[10px] font-bold text-gray-500 uppercase">Estado Geral</label>
                  <select [(ngModel)]="editingSub.status" class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="active">Activo</option>
                    <option value="suspended">Suspenso</option>
                  </select>
                </div>
              </div>
            </div>

            <div class="p-6 bg-gray-50 border-t border-gray-100 flex space-x-3">
              <button (click)="closeEditModal()" class="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-xl hover:bg-white transition-colors text-sm font-semibold uppercase tracking-tight">
                Cancelar
              </button>
              <button (click)="saveSubscriber()" class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all text-sm font-bold uppercase tracking-tight">
                Guardar
              </button>
            </div>
          </div>
        </div>

        <!-- Details Slide-over -->
        <div *ngIf="isDetailsOpen" class="fixed inset-0 z-50 overflow-hidden">
          <div class="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity" (click)="closeDetails()"></div>
          <div class="fixed inset-y-0 right-0 max-w-lg w-full bg-white shadow-2xl flex flex-col transform transition-transform animate-in slide-in-from-right duration-300">
            <div class="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <div>
                <h3 class="text-xl font-bold text-gray-800 font-serif uppercase tracking-tight">{{ selectedSub().full_name }}</h3>
                <p class="text-xs text-gray-500 font-medium">{{ selectedSub().email }}</p>
              </div>
              <button (click)="closeDetails()" class="text-gray-400 hover:text-gray-600 transition-colors">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div class="flex-1 overflow-y-auto p-6 space-y-8">
              <!-- Stats Grid -->
              <div class="grid grid-cols-1 gap-4">
                <div class="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                  <span class="text-[10px] font-bold text-gray-400 uppercase">Total Empresas</span>
                  <p class="text-lg font-bold text-gray-800">{{ selectedSub().company_count }}</p>
                </div>
              </div>

              <!-- Hierarchy: Companies & Users -->
              <div class="space-y-4">
                <h4 class="text-xs font-bold text-gray-500 uppercase tracking-widest flex items-center">
                  <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m4 0h1m-5 10h1m4 0h1m-5-5h1m4 0h1" />
                  </svg>
                  Contribuintes & Utilizadores
                </h4>

                <div *ngFor="let company of selectedSub().companies" class="border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
                  <div class="bg-gray-50/50 p-4 flex justify-between items-center">
                    <span class="font-bold text-gray-800">{{ company.name }}</span>
                  </div>
                  <div class="p-4 space-y-2">
                    <div *ngFor="let user of company.company_users" class="flex items-center space-x-3 text-sm text-gray-600">
                      <div class="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 font-bold text-xs uppercase">
                        {{ user.profiles?.full_name?.charAt(0) || 'U' }}
                      </div>
                      <div class="flex flex-col">
                        <span class="font-medium text-gray-900 leading-tight">{{ user.profiles?.full_name || 'Utilizador Desconhecido' }}</span>
                        <span class="text-[10px] text-gray-500 line-clamp-1 truncate">{{ user.profiles?.email }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="flex justify-between items-center">
          <h2 class="text-2xl font-bold text-gray-800">Gestão de Subscritores</h2>
          <div class="flex space-x-2">
           <button (click)="openCreateModal()" class="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors flex items-center space-x-2">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                </svg>
                <span>Novo Subscritor</span>
            </button>
           <button (click)="exportSubscribers()" class="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors flex items-center space-x-2">
              <svg class="w-4 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span>Exportar</span>
            </button>
          </div>
        </div>

        <!-- Filters -->
        <div class="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-wrap gap-4 items-center">
          <div class="w-full md:flex-1 min-w-0 md:min-w-[200px]">
            <input [ngModel]="searchTerm()" (ngModelChange)="searchTerm.set($event)" type="text" placeholder="Procurar por nome ou email..."
                   class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
          </div>
          <div class="flex space-x-2">
            <button *ngFor="let s of statuses"
                    (click)="activeStatus.set(s.id)"
                    [class]="activeStatus() === s.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'"
                    class="px-4 py-2 rounded-lg text-sm font-medium transition-colors">
              {{ s.label }}
            </button>
          </div>
        </div>

        <!-- Loading State -->
        <div *ngIf="isLoading()" class="bg-white rounded-xl shadow-sm border border-gray-100 p-12 flex flex-col items-center justify-center space-y-4">
          <div class="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <p class="text-gray-500 font-medium animate-pulse uppercase tracking-widest text-[10px]">A carregar subscritores...</p>
        </div>

        <!-- Subscribers Table -->
        <div *ngIf="!isLoading()" class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full text-left">
              <thead>
                < <tr class="bg-gray-50 text-gray-500 text-[10px] uppercase tracking-wider font-semibold select-none">
                  <th (click)="toggleSort('display_id')" class="px-6 py-4 w-20 cursor-pointer hover:bg-gray-100 transition-colors">
                    <div class="flex items-center space-x-1">
                      <span>ID</span>
                      <svg *ngIf="sortColumn() === 'display_id'" class="w-3 h-3" [class.rotate-180]="sortDirection() === 'desc'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
                      </svg>
                    </div>
                  </th>
                  <th (click)="toggleSort('full_name')" class="px-6 py-4 cursor-pointer hover:bg-gray-100 transition-colors">
                    <div class="flex items-center space-x-1">
                      <span>Subscritor (SaaS)</span>
                      <svg *ngIf="sortColumn() === 'full_name'" class="w-3 h-3" [class.rotate-180]="sortDirection() === 'desc'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
                      </svg>
                    </div>
                  </th>
                  <th (click)="toggleSort('email')" class="px-6 py-4 cursor-pointer hover:bg-gray-100 transition-colors">
                    <div class="flex items-center space-x-1">
                      <span>E-mail</span>
                      <svg *ngIf="sortColumn() === 'email'" class="w-3 h-3" [class.rotate-180]="sortDirection() === 'desc'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
                      </svg>
                    </div>
                  </th>
                  <th (click)="toggleSort('status')" class="px-6 py-4 cursor-pointer hover:bg-gray-100 transition-colors">
                    <div class="flex items-center space-x-1">
                      <span>Estado</span>
                      <svg *ngIf="sortColumn() === 'status'" class="w-3 h-3" [class.rotate-180]="sortDirection() === 'desc'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
                      </svg>
                    </div>
                  </th>
                  <th (click)="toggleSort('company_count')" class="px-6 py-4 cursor-pointer hover:bg-gray-100 transition-colors">
                    <div class="flex items-center space-x-1">
                      <span>Estrutura</span>
                      <svg *ngIf="sortColumn() === 'company_count'" class="w-3 h-3" [class.rotate-180]="sortDirection() === 'desc'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
                      </svg>
                    </div>
                  </th>
                  <th (click)="toggleSort('created_at')" class="px-6 py-4 cursor-pointer hover:bg-gray-100 transition-colors">
                    <div class="flex items-center space-x-1">
                      <span>Data de Criação</span>
                      <svg *ngIf="sortColumn() === 'created_at'" class="w-3 h-3" [class.rotate-180]="sortDirection() === 'desc'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
                      </svg>
                    </div>
                  </th>
                  <th class="px-6 py-4 text-center">Ações</th>
                </tr>
              </thead>
              <tbody>
                 <tr *ngFor="let sub of paginatedSubscribers(); let i = index" class="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                  <td class="px-6 py-4 text-xs font-bold text-gray-500">
                    {{ sub.display_id || i + 1 }}
                  </td>
                  <td class="px-6 py-4">
                    <div class="flex items-center space-x-3">
                      <div class="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 font-bold text-sm uppercase">
                        {{ sub.full_name?.charAt(0) || 'U' }}
                      </div>
                      <span class="font-medium text-gray-900 leading-tight">{{ sub.full_name }}</span>
                    </div>
                  </td>
                  <td class="px-6 py-4 text-sm text-gray-700">
                    {{ sub.email }}
                  </td>
                  <td class="px-6 py-4">
                    <span class="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase border"
                          [ngClass]="getStatusClass(sub.status || 'active')">
                      {{ sub.status || 'Activo' }}
                    </span>
                  </td>
                  <td class="px-6 py-4 text-sm text-gray-700">
                    <p class="font-medium">{{ sub.company_count }} Contribuintes</p>
                    <p class="text-xs text-gray-500">{{ sub.user_count }} Utilizadores</p>
                  </td>
                  <td class="px-6 py-4 text-sm text-gray-700">
                    {{ sub.created_at | date:'dd/MM/yyyy' }}
                  </td>
                  <td class="px-6 py-4 text-center">
                    <div class="flex justify-center space-x-3">
                      <button *ngIf="sub.status !== 'suspended'" (click)="toggleSuspend(sub)"
                              title="Suspender" class="text-red-600 hover:text-red-800">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                        </svg>
                      </button>
                      <button *ngIf="sub.status === 'suspended'" (click)="toggleSuspend(sub)"
                              title="Ativar" class="text-green-600 hover:text-green-800">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </button>
                      <button (click)="openEditModal(sub)" class="text-blue-600 hover:text-blue-800" title="Editar Perfil">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button (click)="openDetails(sub)" class="text-orange-600 hover:text-orange-800" title="Ver Hierarquia">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16m-7 6h7" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <div *ngIf="paginatedSubscribers().length === 0" class="p-12 text-center text-gray-500">
              Nenhum subscritor encontrado.
            </div>
        </div>

        <!-- Pagination -->
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 mt-1">
          <app-pagination
            [totalItems]="filteredSubscribers().length"
            [pageSizeOptions]="[10, 20, 50]"
            [defaultPageSize]="10"
            (pageChange)="onPageChange($event)">
          </app-pagination>
        </div>
      </div>
    </div>
  `
})
export class AdminSubscribersComponent implements OnInit {
  subscribers = signal<any[]>([]);
  searchTerm = signal('');
  activeStatus = signal('all');
  isLoading = signal(false);

  // Pagination state
  currentPage = signal(1);
  pageSize = signal(10);

  // Create Modal
  isCreateModalOpen = false;
  isCreating = false;
  createError = '';
  newSub: any = { status: 'active' };

  // Phase 2 & 3: UI Logic
  isEditModalOpen = false;
  isDetailsOpen = false;
  editingSub: any = {};
  selectedSub = signal<any>({});

  // Sorting
  sortColumn = signal<string>('display_id');
  sortDirection = signal<'asc' | 'desc'>('asc');

  statuses = [
    { id: 'all', label: 'Todos' },
    { id: 'active', label: 'Ativos' },
    { id: 'suspended', label: 'Suspensos' }
  ];

  filteredSubscribers = computed(() => {
    let list = this.subscribers();

    if (this.activeStatus() !== 'all') {
      list = list.filter(s => (s.status || 'active') === this.activeStatus());
    }

    if (this.searchTerm) {
      const term = this.searchTerm().toLowerCase();
      list = list.filter(s =>
        s.full_name?.toLowerCase().includes(term) ||
        s.email?.toLowerCase().includes(term)
      );
    }

    // Apply Sorting
    const col = this.sortColumn();
    const dir = this.sortDirection();

    list.sort((a, b) => {
      let valA = a[col];
      let valB = b[col];

      // Handle nulls
      if (valA === null || valA === undefined) valA = '';
      if (valB === null || valB === undefined) valB = '';

      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();

      if (valA < valB) return dir === 'asc' ? -1 : 1;
      if (valA > valB) return dir === 'asc' ? 1 : -1;
      return 0;
    });

    return list;
  });

  paginatedSubscribers = computed(() => {
    const list = this.filteredSubscribers();
    const start = (this.currentPage() - 1) * this.pageSize();
    return list.slice(start, start + this.pageSize());
  });

  constructor(private supabase: SupabaseService) { }

  ngOnInit() {
    this.loadSubscribers();
  }

  async loadSubscribers() {
    this.isLoading.set(true);

    try {
      const { data, error } = await this.supabase.db
        .from('profiles')
        .select(`
            *,
            companies (
              id,
              name,
              company_users (
                user_id,
                profiles:profiles!company_users_user_id_fkey (full_name, email)
              )
            )
          `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const totalSubs = data?.length || 0;
      const formatted = data?.map((s, index) => {
        const companies = s.companies || [];
        const companyCount = companies.length;
        const uniqueUsers = new Set<string>();
        companies.forEach((c: any) => {
          c.company_users?.forEach((cu: any) => uniqueUsers.add(cu.user_id));
        });
        return {
          ...s,
          display_id: totalSubs - index,
          company_count: companyCount,
          user_count: uniqueUsers.size
        };
      }) || [];

      this.subscribers.set(formatted);
    } catch (error) {
      console.error('Error loading subscribers:', error);
    } finally {
      this.isLoading.set(false);
    }
  }
  getStatusClass(status: string) {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-700 border-green-200';
      case 'suspended': return 'bg-red-100 text-red-700 border-red-200';
      default: return 'bg-green-100 text-green-700 border-green-200';
    }
  }

  async toggleSuspend(subscriber: any) {
    const newStatus = subscriber.status === 'suspended' ? 'active' : 'suspended';

    const { error } = await this.supabase.db
      .from('profiles')
      .update({ status: newStatus })
      .eq('id', subscriber.id);

    if (error) {
      console.error('Error updating status:', error);
      return;
    }

    this.loadSubscribers();
  }

  toggleSort(column: string) {
    if (this.sortColumn() === column) {
      this.sortDirection.set(this.sortDirection() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortColumn.set(column);
      this.sortDirection.set('asc');
    }
  }

  openEditModal(sub: any) {
    this.editingSub = { ...sub };
    this.isEditModalOpen = true;
  }

  closeEditModal() {
    this.isEditModalOpen = false;
    this.editingSub = {};
  }

  async saveSubscriber() {
    const { error } = await this.supabase.db
      .from('profiles')
      .update({
        full_name: this.editingSub.full_name,
        phone: this.editingSub.phone,
        status: this.editingSub.status
      })
      .eq('id', this.editingSub.id);

    if (error) {
      console.error('Error saving profile:', error);
      alert('Erro ao guardar perfil');
      return;
    }

    this.closeEditModal();
    this.loadSubscribers();
  }

  openDetails(sub: any) {
    this.selectedSub.set(sub);
    this.isDetailsOpen = true;
  }

  closeDetails() {
    this.isDetailsOpen = false;
    this.selectedSub.set({});
  }

  exportSubscribers() {
    const data = this.filteredSubscribers();
    if (data.length === 0) return;

    const headers = ['Nome', 'E-mail', 'Telefone', 'Estado', 'Contribuintes', 'Utilizadores', 'Data de Criação'];

    const rows = data.map(s => [
      `"${(s.full_name || '').replace(/"/g, '""')}"`,
      `"${(s.email || '').replace(/"/g, '""')}"`,
      `"${(s.phone || 'N/A').replace(/"/g, '""')}"`,
      `"${s.status === 'suspended' ? 'Suspenso' : 'Activo'}"`,
      s.company_count ?? 0,
      s.user_count ?? 0,
      `"${s.created_at ? new Date(s.created_at).toLocaleDateString('pt-MZ') : 'N/A'}"`
    ]);

    const csvContent = '\uFEFF'
      + headers.join(';') + '\n'
      + rows.map(r => r.join(';')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    const timestamp = new Date().toISOString().split('T')[0];
    link.setAttribute('href', url);
    link.setAttribute('download', `subscritores_${timestamp}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  onPageChange(event: PageChangeEvent) {
    this.currentPage.set(event.page);
    this.pageSize.set(event.pageSize);
  }

  openCreateModal() {
    this.newSub = { status: 'active' };
    this.createError = '';
    this.isCreateModalOpen = true;
  }

  closeCreateModal() {
    this.isCreateModalOpen = false;
    this.newSub = { status: 'active' };
    this.createError = '';
  }

  async createSubscriber() {
    if (!this.newSub.full_name || !this.newSub.email || !this.newSub.password) {
      this.createError = 'Nome, e-mail e palavra-passe são obrigatórios.';
      return;
    }
    if (this.newSub.password.length < 6) {
      this.createError = 'A palavra-passe deve ter pelo menos 6 caracteres.';
      return;
    }

    this.isCreating = true;
    this.createError = '';

    try {
      const tempClient = createClient(environment.supabaseUrl, environment.supabaseKey, {
        auth: { persistSession: false }
      });

      const { data, error } = await tempClient.auth.signUp({
        email: this.newSub.email,
        password: this.newSub.password,
        options: {
          data: {
            full_name: this.newSub.full_name,
            phone: this.newSub.phone || null
          }
        }
      });

      if (error) throw error;

      if (data.user) {
        await this.supabase.db
          .from('profiles')
          .update({
            full_name: this.newSub.full_name,
            phone: this.newSub.phone || null,
            status: this.newSub.status
          })
          .eq('id', data.user.id);
      }

      this.closeCreateModal();
      this.loadSubscribers();
    } catch (error: any) {
      this.createError = error.message || 'Erro ao criar subscritor.';
    } finally {
      this.isCreating = false;
    }
  }
}
