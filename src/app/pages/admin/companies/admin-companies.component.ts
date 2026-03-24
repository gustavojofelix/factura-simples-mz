import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../../core/services/supabase.service';
import { ACTIVITY_HIERARCHY } from '../../../core/constants/activity-categories';

@Component({
  selector: 'app-admin-companies',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
      <div class="space-y-6">
        <!-- Edit Modal -->
        <div *ngIf="isEditModalOpen" class="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all animate-in fade-in zoom-in duration-200">
            <div class="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h3 class="text-xl font-bold text-gray-800 font-serif uppercase tracking-tight">Gerir Contribuinte</h3>
              <button (click)="closeEditModal()" class="text-gray-400 hover:text-gray-600">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div class="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              <div class="space-y-1">
                <label class="text-[10px] font-bold text-gray-500 uppercase">Nome da Empresa</label>
                <input [(ngModel)]="editingCompany.name" type="text" class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm">
              </div>

              <div class="grid grid-cols-2 gap-4">
                <div class="space-y-1">
                  <label class="text-[10px] font-bold text-gray-500 uppercase">NUIT</label>
                  <input [(ngModel)]="editingCompany.nuit" type="text" class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm">
                </div>
                <div class="space-y-1">
                  <label class="text-[10px] font-bold text-gray-500 uppercase">Estado</label>
                  <select [(ngModel)]="editingCompany.status" class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm">
                    <option value="active">Activo</option>
                    <option value="suspended">Suspenso</option>
                    <option value="trial">Trial</option>
                  </select>
                </div>
              </div>

              <div class="grid grid-cols-2 gap-4">
                <div class="space-y-1">
                  <label class="text-[10px] font-bold text-gray-500 uppercase">Província</label>
                  <select [(ngModel)]="editingCompany.province" class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm">
                    <option *ngFor="let p of provinces" [value]="p">{{ p }}</option>
                  </select>
                </div>
                <div class="space-y-1">
                  <label class="text-[10px] font-bold text-gray-500 uppercase">Distrito</label>
                  <input [(ngModel)]="editingCompany.district" type="text" class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm">
                </div>
              </div>

              <div class="space-y-1">
                <label class="text-[10px] font-bold text-gray-500 uppercase">Endereço</label>
                <textarea [(ngModel)]="editingCompany.address" rows="2" class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"></textarea>
              </div>
            </div>

            <div class="p-6 bg-gray-50 border-t border-gray-100 flex space-x-3">
              <button (click)="closeEditModal()" class="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-xl hover:bg-white transition-colors text-sm font-semibold uppercase tracking-tight">
                Cancelar
              </button>
              <button (click)="saveCompany()" class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all text-sm font-bold uppercase tracking-tight">
                Guardar
              </button>
            </div>
          </div>
        </div>
        
        <!-- Create Company Modal -->                                                                                                                                               <div *ngIf="isCreateModalOpen" class="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all animate-in fade-in zoom-in duration-200">
              <div class="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                <h3 class="text-xl font-bold text-gray-800 font-serif uppercase tracking-tight">Novo Contribuinte</h3>
                <button (click)="closeCreateModal()" class="text-gray-400 hover:text-gray-600">
                  <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div class="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                <div class="space-y-1">
                  <label class="text-[10px] font-bold text-gray-500 uppercase">Nome da Empresa *</label>
                  <input [(ngModel)]="newCompany.name" type="text" placeholder="Ex: Empresa XYZ, Lda"
                    class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm">
                </div>

                <div class="space-y-1">
                  <label class="text-[10px] font-bold text-gray-500 uppercase">NUIT *</label>
                  <input [(ngModel)]="newCompany.nuit" type="text" placeholder="Ex: 400123456"
                    class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm">
                </div>

                 <div class="space-y-1">
                  <label class="text-[10px] font-bold text-gray-500 uppercase">Tipo de Entidade *</label>
                  <select [(ngModel)]="newCompany.entity_type"
                    class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm">
                    <option value="">Selecionar...</option>
                    <option value="singular">Singular</option>
                    <option value="collective">Colectiva</option>
                  </select>
                </div>

                 <div class="space-y-1">
                  <label class="text-[10px] font-bold text-gray-500 uppercase">E-mail da Empresa *</label>
                  <input [(ngModel)]="newCompany.email" type="email" placeholder="Ex: geral@empresa.co.mz"
                    class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm">
                </div>

                <div class="space-y-1">
                  <label class="text-[10px] font-bold text-gray-500 uppercase">Associar a Empresa *</label>
                  <select [(ngModel)]="newCompany.ref_company_id" (ngModelChange)="onCompanySelected($event)"
                    class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm">
                    <option value="">Selecionar empresa...</option>
                    <option *ngFor="let c of companies()" [value]="c.id">{{ c.name }}</option>
                  </select>
                </div>


                <div class="grid grid-cols-2 gap-4">
                  <div class="space-y-1">
                    <label class="text-[10px] font-bold text-gray-500 uppercase">Província</label>
                    <select [(ngModel)]="newCompany.province"
                      class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm">
                      <option value="">Selecionar...</option>
                      <option *ngFor="let p of provinces" [value]="p">{{ p }}</option>
                    </select>
                  </div>
                  <div class="space-y-1">
                    <label class="text-[10px] font-bold text-gray-500 uppercase">Distrito</label>
                    <input [(ngModel)]="newCompany.district" type="text" placeholder="Ex: Maputo"
                      class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm">
                  </div>
                </div>

                <div class="space-y-1">
                  <label class="text-[10px] font-bold text-gray-500 uppercase">Endereço</label>
                  <textarea [(ngModel)]="newCompany.address" rows="2" placeholder="Ex: Av. 25 de Setembro, nº 123"
                    class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"></textarea>
                </div>

                <p *ngIf="createError" class="text-xs text-red-600 font-medium">{{ createError }}</p>
              </div>

              <div class="p-6 bg-gray-50 border-t border-gray-100 flex space-x-3">
                <button (click)="closeCreateModal()" class="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-xl hover:bg-white transition-colors text-sm font-semibold uppercase tracking-tight">
                  Cancelar
                </button>
                <button (click)="createCompany()" [disabled]="isCreating"
                  class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all text-sm font-bold uppercase tracking-tight disabled:opacity-50">
                  {{ isCreating ? 'A criar...' : 'Criar' }}
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
                <h3 class="text-xl font-bold text-gray-800 font-serif uppercase tracking-tight">{{ selectedCompany().name }}</h3>
                <p class="text-[10px] text-gray-500 font-bold uppercase tracking-widest">NUIT: {{ selectedCompany().nuit }}</p>
              </div>
              <button (click)="closeDetails()" class="text-gray-400 hover:text-gray-600 transition-colors">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div class="flex-1 overflow-y-auto p-6 space-y-8">
              <!-- Stats Grid -->
              <div class="grid grid-cols-3 gap-4">
                <div class="bg-blue-50 p-4 rounded-2xl border border-blue-100 text-center">
                  <span class="text-[10px] font-bold text-blue-400 uppercase">Utilizadores</span>
                  <p class="text-xl font-bold text-blue-700">{{ selectedCompany().user_count }}</p>
                </div>
                <div class="bg-orange-50 p-4 rounded-2xl border border-orange-100 text-center">
                  <span class="text-[10px] font-bold text-orange-400 uppercase">Produtos</span>
                  <p class="text-xl font-bold text-orange-700">{{ selectedCompany().product_count || 0 }}</p>
                </div>
                <div class="bg-green-50 p-4 rounded-2xl border border-green-100 text-center">
                  <span class="text-[10px] font-bold text-green-400 uppercase">Faturas</span>
                  <p class="text-xl font-bold text-green-700">{{ selectedCompany().invoice_count || 0 }}</p>
                </div>
              </div>

              <!-- Users Section -->
              <div class="space-y-4">
                <h4 class="text-xs font-bold text-gray-500 uppercase tracking-widest flex items-center">
                  <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                  Equipa (Operadores)
                </h4>
                <div class="space-y-2">
                  <div *ngFor="let user of selectedCompany().users" class="flex items-center space-x-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
                    <div class="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-xs">
                      {{ user.profiles?.full_name?.charAt(0) || 'U' }}
                    </div>
                    <div>
                      <p class="text-sm font-bold text-gray-800 leading-tight">{{ user.profiles?.full_name }}</p>
                      <p class="text-[10px] text-gray-500">{{ user.profiles?.email || 'Sem email' }}</p>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Recent Invoices -->
              <div class="space-y-4">
                <h4 class="text-xs font-bold text-gray-500 uppercase tracking-widest flex items-center">
                  <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Últimas Faturas
                </h4>
                <div class="space-y-2">
                  <div *ngFor="let inv of selectedCompany().recent_invoices" class="flex justify-between items-center p-3 bg-gray-50 rounded-xl border border-gray-100">
                    <div>
                      <p class="text-xs font-bold text-gray-800">{{ inv.invoice_number }}</p>
                      <p class="text-[10px] text-gray-500">{{ inv.date | date:'dd/MM/yyyy' }}</p>
                    </div>
                    <div class="text-right">
                      <p class="text-sm font-bold text-gray-900">{{ inv.total | currency:'MZN':'symbol':'1.2-2':'pt-MZ' }}</p>
                      <span class="text-[8px] px-1.5 py-0.5 rounded-full font-bold uppercase border"
                            [class]="inv.status === 'paga' ? 'bg-green-50 text-green-600 border-green-100' : 'bg-yellow-50 text-yellow-600 border-yellow-100'">
                        {{ inv.status }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

       <div class="flex justify-between items-center">
            <h2 class="text-2xl font-bold text-gray-800">Inventário de Contribuintes (Empresas)</h2>
            <div class="flex space-x-2">
              <button (click)="openCreateModal()" class="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors flex items-center space-x-2 text-sm">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                </svg>
                <span>Novo Contribuinte</span>
              </button>
              <button (click)="exportCompanies()" class="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors flex items-center space-x-2 text-sm">
                <svg class="w-4 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span>Exportar</span>
              </button>
            </div>
          </div>

        <!-- Filters -->
        <div class="bg-white p-4 rounded-xl shadow-sm border border-gray-100 space-y-3">
          <!-- Row 1: Search + Província -->
          <div class="flex flex-wrap gap-3">
            <div class="flex-1 min-w-[200px]">
              <input [ngModel]="searchTerm()" (ngModelChange)="searchTerm.set($event)" type="text" placeholder="Procurar por nome, NUIT ou subscritor..."
                     class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm">
            </div>
            <div>
              <select [ngModel]="providerFilter()" (ngModelChange)="providerFilter.set($event)" class="px-4 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50">
                <option value="all">Todas as Províncias</option>
                <option *ngFor="let p of provinces" [value]="p">{{ p }}</option>
              </select>
            </div>
          </div>
          <!-- Row 2: New Filters -->
          <div class="flex flex-wrap gap-3">
            <div>
              <select [ngModel]="planFilter()" (ngModelChange)="planFilter.set($event)" class="px-4 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50">
                <option value="all">Todos os Planos</option>
                <option *ngFor="let p of availablePlans()" [value]="p">{{ p }}</option>
              </select>
            </div>  
            <div>
              <select [ngModel]="subscriberFilter()" (ngModelChange)="subscriberFilter.set($event)" class="px-4 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50">
                <option value="all">Todos os Subscritores</option>
                <option *ngFor="let s of availableSubscribers()" [value]="s">{{ s }}</option>
              </select>
            </div>
            <div>
              <select [ngModel]="activityTypeFilter()" (ngModelChange)="activityTypeFilter.set($event)" class="px-4 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50">
                <option value="all">Tipo de Actividade</option>
                <option *ngFor="let a of activityTypes" [value]="a.key">{{ a.label }}</option>
              </select>
            </div>
            <div>
              <select [ngModel]="businessVolumeFilter()" (ngModelChange)="businessVolumeFilter.set($event)" class="px-4 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50">
                <option value="all">Volume de Negócio</option>
                <option value="low">Baixo (&lt; 50,000 MZN)</option>
                <option value="medium">Médio (50,000 - 500,000 MZN)</option>
                <option value="high">Alto (&gt; 500,000 MZN)</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Loading State -->
        <div *ngIf="isLoading()" class="bg-white rounded-xl shadow-sm border border-gray-100 p-12 flex flex-col items-center justify-center space-y-4">
          <div class="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <p class="text-gray-500 font-medium animate-pulse uppercase tracking-widest text-[10px]">A carregar contribuintes...</p>
        </div>

        <!-- Companies Table -->
        <div *ngIf="!isLoading()" class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full text-left">
              <thead>
                <tr class="bg-gray-50 text-gray-500 text-[10px] uppercase tracking-wider font-semibold select-none">
                  <th class="px-4 py-4 w-20">
                    <span>ID</span>
                  </th>
                  <th (click)="toggleSort('name')" class="px-4 py-4 cursor-pointer hover:bg-gray-100 transition-colors">
                    <div class="flex items-center space-x-1">
                      <span>Empresa</span>
                      <svg *ngIf="sortColumn() === 'name'" class="w-3 h-3" [class.rotate-180]="sortDirection() === 'desc'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
                      </svg>
                    </div>
                  </th>
                  <th (click)="toggleSort('nuit')" class="px-4 py-4 cursor-pointer hover:bg-gray-100 transition-colors">
                    <div class="flex items-center space-x-1">
                      <span>NUIT</span>
                      <svg *ngIf="sortColumn() === 'nuit'" class="w-3 h-3" [class.rotate-180]="sortDirection() === 'desc'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
                      </svg>
                    </div>
                  </th>
                  <th (click)="toggleSort('province')" class="px-4 py-4 cursor-pointer hover:bg-gray-100 transition-colors">
                    <div class="flex items-center space-x-1">
                      <span>Localização</span>
                      <svg *ngIf="sortColumn() === 'province'" class="w-3 h-3" [class.rotate-180]="sortDirection() === 'desc'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
                      </svg>
                    </div>
                  </th>
                  <th (click)="toggleSort('owner_name')" class="px-4 py-4 cursor-pointer hover:bg-gray-100 transition-colors">
                    <div class="flex items-center space-x-1">
                      <span>Subscritor</span>
                      <svg *ngIf="sortColumn() === 'owner_name'" class="w-3 h-3" [class.rotate-180]="sortDirection() === 'desc'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
                      </svg>
                    </div>
                  </th>
                  <th (click)="toggleSort('plan')" class="px-4 py-4 cursor-pointer hover:bg-gray-100 transition-colors">
                    <div class="flex items-center space-x-1">
                      <span>Plano / Data Limite</span>
                      <svg *ngIf="sortColumn() === 'plan'" class="w-3 h-3" [class.rotate-180]="sortDirection() === 'desc'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
                      </svg>
                    </div>
                  </th>
                  <th (click)="toggleSort('last_access')" class="px-4 py-4 cursor-pointer hover:bg-gray-100 transition-colors">
                    <div class="flex items-center space-x-1">
                      <span>Último Acesso</span>
                      <svg *ngIf="sortColumn() === 'last_access'" class="w-3 h-3" [class.rotate-180]="sortDirection() === 'desc'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
                      </svg>
                    </div>
                  </th>
                  <th (click)="toggleSort('usage_30d')" class="px-4 py-4 text-right cursor-pointer hover:bg-gray-100 transition-colors">
                    <div class="flex items-center justify-end space-x-1">
                      <span>Uso (30d)</span>
                      <svg *ngIf="sortColumn() === 'usage_30d'" class="w-3 h-3" [class.rotate-180]="sortDirection() === 'desc'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
                      </svg>
                    </div>
                  </th>
                  <th class="px-4 py-4 text-center">Ações</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100">
                <tr *ngFor="let company of filteredCompanies(); let i = index" class="hover:bg-gray-50 transition-colors text-sm">
                  <!-- ID -->
                  <td class="px-4 py-4">
                    <span class="text-xs font-bold text-gray-500">
                      {{ i + 1 }}
                    </span>
                  </td>
                  <!-- Empresa -->
                  <td class="px-4 py-4">
                    <div class="flex flex-col">
                      <span class="font-medium text-gray-900 text-xs uppercase font-serif tracking-tight">{{ company.name }}</span>
                      <span *ngIf="company.activity_type" class="text-[10px] text-gray-400 mt-0.5">{{ getActivityLabel(company.activity_type) }}</span>
                    </div>
                  </td>
                  <!-- NUIT (coluna separada) -->
                  <td class="px-4 py-4">
                    <span class="font-mono text-gray-700 text-xs font-semibold">{{ company.nuit || '—' }}</span>
                  </td>
                  <!-- Localização -->
                  <td class="px-4 py-4 text-gray-600">
                    <div class="flex flex-col">
                      <span class="font-medium text-gray-900 text-xs">{{ company.province || 'N/A' }}</span>
                      <span class="text-[10px] text-gray-500">{{ company.district || 'N/A' }}</span>
                    </div>
                  </td>
                  <!-- Subscritor -->
                  <td class="px-4 py-4 text-gray-600">
                    <div class="flex flex-col">
                      <span class="font-medium text-gray-900 text-xs">{{ company.owner_name }}</span>
                      <span class="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase border w-fit mt-1"
                            [ngClass]="getStatusClass(company.status || 'active')">
                        {{ company.status || 'Activo' }}
                      </span>
                    </div>
                  </td>
                  <!-- Plano / Data Limite -->
                  <td class="px-4 py-4">
                    <div class="flex flex-col">
                      <span class="px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded text-[10px] font-bold uppercase border border-yellow-200 w-fit">
                        {{ company.plan || 'TRIAL' }}
                      </span>
                      <span *ngIf="company.plan_expiry" class="text-[10px] mt-1"
                            [class.text-red-600]="isPlanExpired(company.plan_expiry)"
                            [class.text-gray-500]="!isPlanExpired(company.plan_expiry)">
                        Expira: {{ company.plan_expiry | date:'dd/MM/yyyy' }}
                      </span>
                      <span *ngIf="!company.plan_expiry" class="text-[10px] text-gray-400 mt-1">Sem data limite</span>
                    </div>
                  </td>
                  <!-- Último Acesso -->
                  <td class="px-4 py-4">
                    <div class="flex flex-col">
                      <span *ngIf="company.last_access" class="text-xs text-gray-700">
                        {{ company.last_access | date:'dd/MM/yyyy' }}
                      </span>
                      <span *ngIf="company.last_access" class="text-[10px] text-gray-400">
                        {{ company.last_access | date:'HH:mm' }}
                      </span>
                      <span *ngIf="!company.last_access" class="text-[10px] text-gray-400">—</span>
                    </div>
                  </td>
                  <!-- Uso (30d) -->
                  <td class="px-4 py-4 text-right">
                    <div class="flex flex-col">
                      <span class="font-bold text-gray-900 text-xs">{{ company.usage_30d | currency:'MZN':'symbol':'1.2-2':'pt-MZ' }}</span>
                      <span class="text-[10px] text-gray-500">{{ company.usage_count_30d }} faturas</span>
                    </div>
                  </td>
                  <!-- Ações -->
                  <td class="px-4 py-4 text-center">
                    <div class="flex items-center justify-center space-x-2">
                      <button *ngIf="company.status !== 'suspended'" (click)="toggleSuspend(company)"
                              title="Suspender" class="text-red-600 hover:text-red-800 p-1">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                        </svg>
                      </button>
                      <button *ngIf="company.status === 'suspended'" (click)="toggleSuspend(company)"
                              title="Ativar" class="text-green-600 hover:text-green-800 p-1">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </button>
                      <button (click)="openDetails(company)" class="text-orange-600 hover:text-orange-800 p-1" title="Ver Detalhes">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      </button>
                      <button (click)="openEditModal(company)" class="text-blue-600 hover:text-blue-800 p-1" title="Editar Contribuinte">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <div *ngIf="filteredCompanies().length === 0" class="p-12 text-center text-gray-500">
              Nenhuma empresa encontrada.
            </div>
          </div>
        </div>
      </div>
    `
})
export class AdminCompaniesComponent implements OnInit {
  companies = signal<any[]>([]);
  searchTerm = signal('');
  providerFilter = signal('all');
  planFilter = signal('all');
  subscriberFilter = signal('all');
  activityTypeFilter = signal('all');
  businessVolumeFilter = signal('all');
  // Create Company
  isCreateModalOpen = false;
  isCreating = false;
  createError = '';
  newCompany: any = {};
  allCompanies = signal<any[]>([]);


  provinces = ['Maputo', 'Gaza', 'Inhambane', 'Sofala', 'Manica', 'Tete', 'Zambézia', 'Nampula', 'Cabo Delgado', 'Niassa'];

  activityTypes = Object.entries(ACTIVITY_HIERARCHY).map(([key, value]) => ({
    key,
    label: value.label
  }));

  // Phase 2 & 3: UI Logic
  isEditModalOpen = false;
  editingCompany: any = {};
  isDetailsOpen = false;
  selectedCompany = signal<any>({});
  isLoading = signal(false);

  // Ordering
  sortColumn = signal<string>('name');
  sortDirection = signal<'asc' | 'desc'>('asc');

  availablePlans = computed(() => {
    const plans = new Set<string>();
    this.companies().forEach(c => { if (c.plan) plans.add(c.plan); });
    return Array.from(plans).sort();
  });

  availableSubscribers = computed(() => {
    const subs = new Set<string>();
    this.companies().forEach(c => { if (c.owner_name && c.owner_name !== 'N/A') subs.add(c.owner_name); });
    return Array.from(subs).sort();
  });

  filteredCompanies = computed(() => {
    let list = this.companies();

    if (this.providerFilter() !== 'all') {
      list = list.filter(c => c.province === this.providerFilter());
    }

    if (this.planFilter() !== 'all') {
      list = list.filter(c => c.plan === this.planFilter());
    }

    if (this.subscriberFilter() !== 'all') {
      list = list.filter(c => c.owner_name === this.subscriberFilter());
    }

    if (this.activityTypeFilter() !== 'all') {
      list = list.filter(c => c.activity_type === this.activityTypeFilter());
    }

    if (this.businessVolumeFilter() !== 'all') {
      list = list.filter(c => {
        const vol = c.usage_30d || 0;
        if (this.businessVolumeFilter() === 'low') return vol < 50000;
        if (this.businessVolumeFilter() === 'medium') return vol >= 50000 && vol <= 500000;
        if (this.businessVolumeFilter() === 'high') return vol > 500000;
        return true;
      });
    }

    if (this.searchTerm()) {
      const term = this.searchTerm().toLowerCase();
      list = list.filter(c =>
        c.name?.toLowerCase().includes(term) ||
        c.nuit?.toLowerCase().includes(term) ||
        c.owner_name?.toLowerCase().includes(term)
      );
    }

    // Apply Sorting
    const col = this.sortColumn();
    const dir = this.sortDirection();

    list = [...list].sort((a, b) => {
      let valA = a[col];
      let valB = b[col];

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

  constructor(private supabase: SupabaseService) { }

  ngOnInit() {
    this.loadCompanies();
    this.loadAllCompanies();
  }

  async loadCompanies() {
    this.isLoading.set(true);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    try {
      const { data, error } = await this.supabase.db
        .from('companies')
        .select(`
          *,
          profiles (full_name, last_sign_in_at),
          subscriptions (plan_name, next_billing_date, status),
          company_users (count),
          invoices (total, created_at)
        `)
        .order('name', { ascending: true });

      if (error) throw error;

      this.companies.set(data?.map(c => {
        // Aggregate 30d usage
        let usage30d = 0;
        let usageCount30d = 0;
        c.invoices?.forEach((inv: any) => {
          const invDate = new Date(inv.created_at);
          if (invDate >= thirtyDaysAgo) {
            usage30d += Number(inv.total) || 0;
            usageCount30d++;
          }
        });

        // Active subscription
        const activeSub = c.subscriptions?.find((s: any) => s.status === 'active') || c.subscriptions?.[0];

        return {
          ...c,
          owner_name: c.profiles?.full_name || 'N/A',
          last_access: c.profiles?.last_sign_in_at || null,
          plan: activeSub?.plan_name || 'Trial',
          plan_expiry: activeSub?.next_billing_date || null,
          user_count: c.company_users?.[0]?.count || 0,
          usage_30d: usage30d,
          usage_count_30d: usageCount30d
        };
      }) || []);
    } catch (error) {
      console.error('Error loading companies:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  isPlanExpired(date: string | null): boolean {
    if (!date) return false;
    return new Date(date) < new Date();
  }

  getActivityLabel(key: string): string {
    return ACTIVITY_HIERARCHY[key]?.label || key;
  }

  toggleSort(column: string) {
    if (this.sortColumn() === column) {
      this.sortDirection.set(this.sortDirection() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortColumn.set(column);
      this.sortDirection.set('asc');
    }
  }

  getStatusClass(status: string) {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-700 border-green-200';
      case 'suspended': return 'bg-red-100 text-red-700 border-red-200';
      case 'trial': return 'bg-blue-100 text-blue-700 border-blue-200';
      default: return 'bg-green-100 text-green-700 border-green-200';
    }
  }

  async toggleSuspend(company: any) {
    const newStatus = company.status === 'suspended' ? 'active' : 'suspended';
    const { error } = await this.supabase.db
      .from('companies')
      .update({ status: newStatus })
      .eq('id', company.id);

    if (error) {
      console.error('Error updating company status:', error);
      return;
    }
    this.loadCompanies();
  }

  // Phase 2: Edit Methods
  openEditModal(company: any) {
    this.editingCompany = { ...company };
    this.isEditModalOpen = true;
  }

  closeEditModal() {
    this.isEditModalOpen = false;
    this.editingCompany = {};
  }

  async saveCompany() {
    const { error } = await this.supabase.db
      .from('companies')
      .update({
        name: this.editingCompany.name,
        nuit: this.editingCompany.nuit,
        status: this.editingCompany.status,
        province: this.editingCompany.province,
        district: this.editingCompany.district,
        address: this.editingCompany.address
      })
      .eq('id', this.editingCompany.id);

    if (error) {
      console.error('Error saving company:', error);
      alert('Erro ao guardar contribuinte');
      return;
    }

    this.closeEditModal();
    this.loadCompanies();
  }

  async openDetails(company: any) {
    this.selectedCompany.set({ ...company, users: [], recent_invoices: [], product_count: 0, invoice_count: 0 });
    this.isDetailsOpen = true;

    const [usersRes, invRes, prodRes] = await Promise.all([
      this.supabase.db
        .from('company_users')
        .select('*, profiles:profiles!company_users_user_id_fkey(full_name, email)')
        .eq('company_id', company.id),
      this.supabase.db
        .from('invoices')
        .select('*')
        .eq('company_id', company.id)
        .order('date', { ascending: false })
        .limit(5),
      this.supabase.db
        .from('products')
        .select('id', { count: 'exact' })
        .eq('company_id', company.id)
    ]);

    const invCount = await this.supabase.db
      .from('invoices')
      .select('id', { count: 'exact' })
      .eq('company_id', company.id);

    this.selectedCompany.set({
      ...company,
      users: usersRes.data || [],
      recent_invoices: invRes.data || [],
      product_count: prodRes.count || 0,
      invoice_count: invCount.count || 0
    });
  }

  closeDetails() {
    this.isDetailsOpen = false;
    this.selectedCompany.set({});
  }

  async loadAllCompanies() {
    const { data } = await this.supabase.db
      .from('companies')
      .select('id, name, user_id')
      .order('name', { ascending: true });
    this.allCompanies.set(data || []);
  }

  onCompanySelected(companyId: string) {
    const company = this.allCompanies().find(c => c.id === companyId);
    if (company) this.newCompany.user_id = company.user_id;
  }

  openCreateModal() {
    this.newCompany = {};
    this.createError = '';
    this.isCreateModalOpen = true;
  }

  closeCreateModal() {
    this.isCreateModalOpen = false;
    this.newCompany = {};
    this.createError = '';
  }

  async createCompany() {
    if (!this.newCompany.name || !this.newCompany.nuit || !this.newCompany.user_id || !this.newCompany.email || !this.newCompany.entity_type) {
      this.createError = 'Nome, NUIT, E-mail, Tipo de Entidade e Subscritor são obrigatórios.';
      return;
    }

    this.isCreating = true;
    this.createError = '';

    try {
      const { error } = await this.supabase.db
        .from('companies')
        .insert({
          name: this.newCompany.name,
          nuit: this.newCompany.nuit,
          user_id: this.newCompany.user_id,
          province: this.newCompany.province || null,
          district: this.newCompany.district || null,
          address: this.newCompany.address || 'Endereço não especificado',
          email: this.newCompany.email,
          entity_type: this.newCompany.entity_type,
          status: 'active'

        });

      if (error) throw error;
      this.closeCreateModal();
      this.loadCompanies();
    } catch (error: any) {
      this.createError = error.message || 'Erro ao criar contribuinte.';
    } finally {
      this.isCreating = false;
    }
  }

  exportCompanies() {
    const headers = ['ID', 'Nome', 'NUIT', 'Provincia', 'Distrito', 'Proprietario', 'Plano', 'Data Limite Plano', 'Ultimo Acesso', 'Utilizadores', 'Uso (30d)', 'Faturas (30d)'];
    const rows = this.filteredCompanies().map(c => [
      c.id,
      c.name,
      c.nuit,
      c.province || 'N/A',
      c.district || 'N/A',
      c.owner_name,
      c.plan,
      c.plan_expiry || 'N/A',
      c.last_access || 'N/A',
      c.user_count,
      c.usage_30d,
      c.usage_count_30d
    ]);

    const csvContent = "data:text/csv;charset=utf-8,"
      + headers.join(",") + "\n"
      + rows.map(e => e.join(",")).join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `empresas_ispcfacil_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
