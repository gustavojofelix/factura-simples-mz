import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../../core/services/supabase.service';
import { AuthService } from '../../../core/services/auth.service';
import { AuditLogService } from '../../../core/services/audit-log.service';
import { PaginationComponent, PageChangeEvent } from '../../../shared/components/pagination.component';

export interface AdminUserAccess {
  id: string;
  full_name: string;
  email: string;
  phone?: string;
  role: 'admin' | 'user';
  status?: 'active' | 'suspended' | 'trial';
  created_at: string;
}

@Component({
  selector: 'app-admin-access',
  standalone: true,
  imports: [CommonModule, FormsModule, PaginationComponent],
  template: `
    <div class="space-y-6">
      <!-- Header -->
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
        <div>
          <h2 class="text-2xl font-bold text-gray-900 tracking-tight font-serif">Gestão de Acessos ao Back Office</h2>
          <p class="text-sm text-gray-500 mt-1">Gerencie os utilizadores com permissão de administrador e adicione novos acessos ao sistema.</p>
        </div>
        <button
          (click)="openAddModal()"
          class="inline-flex items-center justify-center px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-sm shadow-md shadow-blue-200 transition-all gap-2 flex-shrink-0">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
          </svg>
          Adicionar Administrador
        </button>
      </div>

      <!-- KPI Summary Cards -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <div class="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-4">
          <div class="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <div>
            <p class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Administradores</p>
            <h3 class="text-2xl font-extrabold text-gray-900 mt-0.5">{{ totalAdmins() }}</h3>
          </div>
        </div>

        <div class="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-4">
          <div class="w-12 h-12 rounded-xl bg-slate-50 text-slate-600 flex items-center justify-center font-bold">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          </div>
          <div>
            <p class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Total de Utilizadores</p>
            <h3 class="text-2xl font-extrabold text-gray-900 mt-0.5">{{ totalUsers() }}</h3>
          </div>
        </div>

        <div class="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-4">
          <div class="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Acessos Activos</p>
            <h3 class="text-2xl font-extrabold text-gray-900 mt-0.5">{{ activeUsersCount() }}</h3>
          </div>
        </div>
      </div>

      <!-- Filters & Search Toolbar -->
      <div class="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div class="relative flex-1 max-w-md">
          <svg class="w-5 h-5 absolute left-3.5 top-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            [ngModel]="searchQuery()"
            (ngModelChange)="searchQuery.set($event); onSearchChange()"
            type="text"
            placeholder="Pesquisar por nome, e-mail ou telefone..."
            class="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm outline-none">
        </div>

        <div class="flex items-center gap-2">
          <button
            (click)="setFilter('all')"
            [class]="roleFilter() === 'all' ? 'bg-slate-900 text-white font-bold' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'"
            class="px-3.5 py-1.5 rounded-lg text-xs transition-colors">
            Todos ({{ totalUsers() }})
          </button>
          <button
            (click)="setFilter('admin')"
            [class]="roleFilter() === 'admin' ? 'bg-blue-600 text-white font-bold' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'"
            class="px-3.5 py-1.5 rounded-lg text-xs transition-colors">
            Administradores ({{ totalAdmins() }})
          </button>
          <button
            (click)="setFilter('user')"
            [class]="roleFilter() === 'user' ? 'bg-slate-900 text-white font-bold' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'"
            class="px-3.5 py-1.5 rounded-lg text-xs transition-colors">
            Utilizadores Comuns
          </button>
        </div>
      </div>

      <!-- Users Table -->
      <div class="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div *ngIf="isLoading()" class="p-12 text-center text-gray-500">
          <div class="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-600 border-t-transparent mb-2"></div>
          <p class="text-sm font-medium">A carregar lista de utilizadores e permissões...</p>
        </div>

        <div *ngIf="!isLoading() && paginatedUsers().length === 0" class="p-12 text-center">
          <svg class="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
          <h4 class="text-base font-bold text-gray-800">Nenhum utilizador encontrado</h4>
          <p class="text-xs text-gray-500 mt-1">Tente ajustar a barra de pesquisa ou os filtros de função.</p>
        </div>

        <div *ngIf="!isLoading() && paginatedUsers().length > 0" class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="bg-gray-50/70 border-b border-gray-100 text-[11px] font-bold uppercase tracking-wider text-gray-500">
                <th class="py-3.5 px-6">Utilizador</th>
                <th class="py-3.5 px-6">Telefone</th>
                <th class="py-3.5 px-6">Acesso & Estado</th>
                <th class="py-3.5 px-6">Data de Registo</th>
                <th class="py-3.5 px-6 text-right">Ações</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 text-sm">
              <tr *ngFor="let user of paginatedUsers()" class="hover:bg-slate-50/60 transition-colors">
                <td class="py-4 px-6">
                  <div class="flex items-center gap-3">
                    <div
                      [class]="user.role === 'admin' ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'"
                      class="w-10 h-10 rounded-xl font-bold flex items-center justify-center flex-shrink-0 text-sm shadow-sm">
                      {{ getInitials(user.full_name, user.email) }}
                    </div>
                    <div>
                      <div class="flex items-center gap-2">
                        <span class="font-bold text-gray-900">{{ user.full_name || 'Utilizador sem nome' }}</span>
                        <span *ngIf="user.id === currentUserId" class="px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-extrabold rounded-md uppercase">Você</span>
                      </div>
                      <span class="text-xs text-gray-500 block">{{ user.email }}</span>
                    </div>
                  </div>
                </td>

                <td class="py-4 px-6 text-gray-600 font-medium">
                  {{ user.phone || 'N/A' }}
                </td>

                <td class="py-4 px-6">
                  <div class="flex flex-col gap-1 items-start">
                    <span
                      *ngIf="user.role === 'admin'"
                      class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-xs font-bold">
                      Administrador
                    </span>
                    <span
                      *ngIf="user.role !== 'admin'"
                      class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200 text-xs font-medium">
                      Utilizador Comum
                    </span>
                    <span
                      *ngIf="user.status === 'suspended'"
                      class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-extrabold uppercase">
                      Suspenso
                    </span>
                    <span
                      *ngIf="user.status !== 'suspended'"
                      class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-extrabold uppercase">
                      Ativo
                    </span>
                  </div>
                </td>

                <td class="py-4 px-6 text-xs text-gray-500">
                  {{ formatDate(user.created_at) }}
                </td>

                <td class="py-4 px-6 text-right">
                  <div class="flex items-center justify-end gap-1.5">
                    <!-- View Details -->
                    <button
                      (click)="openDetailsModal(user)"
                      class="p-1.5 bg-gray-50 hover:bg-gray-100 text-gray-600 rounded-lg transition-colors"
                      title="Ver Detalhes">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    </button>

                    <!-- Edit User -->
                    <button
                      (click)="openEditModal(user)"
                      class="p-1.5 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-lg transition-colors"
                      title="Editar Administrador">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>

                    <!-- Toggle Status (Activate / Suspend) -->
                    <button
                      *ngIf="user.status === 'suspended' && user.id !== currentUserId"
                      (click)="toggleUserStatus(user, 'active')"
                      class="p-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-600 rounded-lg transition-colors"
                      title="Ativar Utilizador">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </button>
                    <button
                      *ngIf="user.status !== 'suspended' && user.id !== currentUserId"
                      (click)="toggleUserStatus(user, 'suspended')"
                      class="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg transition-colors"
                      title="Desativar/Suspender Utilizador">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <app-pagination
          [totalItems]="filteredUsers().length"
          [defaultPageSize]="pageSize"
          [currentPage]="currentPage()"
          (pageChange)="onPageChange($event)">
        </app-pagination>
      </div>

      <!-- Modal: Adicionar Novo Administrador -->
      <div *ngIf="isAddModalOpen" class="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all">
          <div class="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
            <div>
              <h3 class="text-xl font-bold text-gray-800 font-serif">Novo Administrador</h3>
              <p class="text-xs text-gray-500 mt-0.5">Conceda acesso total ao Back Office.</p>
            </div>
            <button (click)="closeAddModal()" class="text-gray-400 hover:text-gray-600">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div class="p-6 space-y-4">
            <div class="space-y-1">
              <label class="text-[10px] font-bold text-gray-500 uppercase">Nome Completo *</label>
              <input
                [(ngModel)]="newAdmin.full_name"
                type="text"
                placeholder="Ex: Carlos Mateus"
                class="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm">
            </div>

            <div class="space-y-1">
              <label class="text-[10px] font-bold text-gray-500 uppercase">E-mail de Acesso *</label>
              <input
                [(ngModel)]="newAdmin.email"
                type="email"
                placeholder="admin@empresa.co.mz"
                class="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm">
            </div>

            <div class="space-y-1">
              <label class="text-[10px] font-bold text-gray-500 uppercase">Telefone</label>
              <input
                [(ngModel)]="newAdmin.phone"
                type="text"
                placeholder="Ex: 84 123 4567"
                class="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm">
            </div>

            <div class="pt-2 flex items-start gap-2.5">
              <input
                [(ngModel)]="newAdmin.send_invite"
                id="send_invite"
                type="checkbox"
                class="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500">
              <label for="send_invite" class="text-xs text-gray-600 leading-tight">
                Enviar e-mail de convite para definir a palavra-passe e aceder ao Back Office.
              </label>
            </div>

            <p *ngIf="addError" class="text-xs text-red-600 font-medium bg-red-50 p-3 rounded-lg border border-red-100">
              {{ addError }}
            </p>

            <p *ngIf="addSuccess" class="text-xs text-emerald-700 font-medium bg-emerald-50 p-3 rounded-lg border border-emerald-100">
              {{ addSuccess }}
            </p>
          </div>

          <div class="p-6 bg-gray-50 border-t border-gray-100 flex space-x-3">
            <button
              (click)="closeAddModal()"
              class="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-xl hover:bg-white transition-colors text-xs font-bold uppercase tracking-wider">
              Cancelar
            </button>
            <button
              (click)="submitNewAdmin()"
              [disabled]="isSubmitting()"
              class="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-lg shadow-blue-200 transition-all text-xs font-bold uppercase tracking-wider disabled:opacity-50">
              {{ isSubmitting() ? 'A Adicionar...' : 'Adicionar Admin' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Modal: Editar Administrador -->
      <div *ngIf="isEditModalOpen" class="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all">
          <div class="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
            <div>
              <h3 class="text-xl font-bold text-gray-800 font-serif">Editar Utilizador</h3>
              <p class="text-xs text-gray-500 mt-0.5">Gerencie os metadados de acesso e permissões.</p>
            </div>
            <button (click)="isEditModalOpen = false" class="text-gray-400 hover:text-gray-600">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div class="p-6 space-y-4">
            <div class="space-y-1">
              <label class="text-[10px] font-bold text-gray-500 uppercase">Nome Completo *</label>
              <input
                [(ngModel)]="editAdmin.full_name"
                type="text"
                class="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm">
            </div>

            <div class="space-y-1">
              <label class="text-[10px] font-bold text-gray-500 uppercase">Telefone</label>
              <input
                [(ngModel)]="editAdmin.phone"
                type="text"
                class="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm">
            </div>

            <div class="space-y-1">
              <label class="text-[10px] font-bold text-gray-500 uppercase">Função (Nível de Acesso)</label>
              <select
                [(ngModel)]="editAdmin.role"
                [disabled]="editAdmin.id === currentUserId"
                class="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm bg-white cursor-pointer disabled:opacity-50">
                <option value="admin">Administrador (Acesso Total)</option>
                <option value="user">Utilizador Comum (Apenas Clientes)</option>
              </select>
              <p *ngIf="editAdmin.id === currentUserId" class="text-[10px] text-amber-600 font-medium mt-1">
                ⚠️ Não pode alterar a sua própria função.
              </p>
            </div>

            <div class="space-y-1">
              <label class="text-[10px] font-bold text-gray-500 uppercase">Estado da Conta</label>
              <select
                [(ngModel)]="editAdmin.status"
                [disabled]="editAdmin.id === currentUserId"
                class="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm bg-white cursor-pointer disabled:opacity-50">
                <option value="active">Ativo (Acesso Permitido)</option>
                <option value="suspended">Suspenso (Acesso Bloqueado)</option>
                <option value="trial">Período de Teste</option>
              </select>
              <p *ngIf="editAdmin.id === currentUserId" class="text-[10px] text-amber-600 font-medium mt-1">
                ⚠️ Não pode suspender a sua própria conta.
              </p>
            </div>
          </div>

          <div class="p-6 bg-gray-50 border-t border-gray-100 flex space-x-3">
            <button
              (click)="isEditModalOpen = false"
              class="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-xl hover:bg-white transition-colors text-xs font-bold uppercase tracking-wider">
              Cancelar
            </button>
            <button
              (click)="submitEditAdmin()"
              [disabled]="isSubmitting()"
              class="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-lg shadow-blue-200 transition-all text-xs font-bold uppercase tracking-wider disabled:opacity-50">
              {{ isSubmitting() ? 'A Guardar...' : 'Guardar' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Modal: Detalhes do Utilizador -->
      <div *ngIf="isDetailsModalOpen" class="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all">
          <div class="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
            <div>
              <h3 class="text-xl font-bold text-gray-800 font-serif">Detalhes do Utilizador</h3>
              <p class="text-xs text-gray-500 mt-0.5">Informações detalhadas de registo e auditoria.</p>
            </div>
            <button (click)="isDetailsModalOpen = false" class="text-gray-400 hover:text-gray-600">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div class="p-6 space-y-4">
            <div class="flex items-center gap-4 border-b border-gray-100 pb-4">
              <div
                [class]="selectedUser?.role === 'admin' ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'"
                class="w-16 h-16 rounded-2xl font-black flex items-center justify-center text-xl shadow-md">
                {{ selectedUser ? getInitials(selectedUser.full_name, selectedUser.email) : 'U' }}
              </div>
              <div>
                <h4 class="text-lg font-bold text-gray-900">{{ selectedUser?.full_name || 'Utilizador sem nome' }}</h4>
                <p class="text-sm text-gray-500">{{ selectedUser?.email }}</p>
              </div>
            </div>

            <div class="space-y-3 text-sm">
              <div class="flex justify-between border-b border-gray-50 pb-2">
                <span class="text-xs text-gray-400 font-semibold uppercase">ID do Utilizador:</span>
                <span class="font-mono text-xs text-gray-700 select-all">{{ selectedUser?.id }}</span>
              </div>
              <div class="flex justify-between border-b border-gray-50 pb-2">
                <span class="text-xs text-gray-400 font-semibold uppercase">Telefone:</span>
                <span class="font-medium text-gray-700">{{ selectedUser?.phone || 'N/A' }}</span>
              </div>
              <div class="flex justify-between border-b border-gray-50 pb-2">
                <span class="text-xs text-gray-400 font-semibold uppercase">Função Global:</span>
                <span
                  [class]="selectedUser?.role === 'admin' ? 'text-blue-700 font-bold bg-blue-50 px-2 py-0.5 rounded' : 'text-gray-600 bg-gray-100 px-2 py-0.5 rounded'"
                  class="text-xs font-semibold">
                  {{ selectedUser?.role === 'admin' ? 'Administrador do Back Office' : 'Utilizador Comum' }}
                </span>
              </div>
              <div class="flex justify-between border-b border-gray-50 pb-2">
                <span class="text-xs text-gray-400 font-semibold uppercase">Estado da Conta:</span>
                <span
                  [class]="selectedUser?.status === 'suspended' ? 'text-rose-700 font-bold bg-rose-50 px-2 py-0.5 rounded' : 'text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded'"
                  class="text-xs uppercase">
                  {{ selectedUser?.status === 'suspended' ? 'Suspenso' : 'Ativo' }}
                </span>
              </div>
              <div class="flex justify-between">
                <span class="text-xs text-gray-400 font-semibold uppercase">Registado Em:</span>
                <span class="font-medium text-gray-700">{{ selectedUser ? formatDate(selectedUser.created_at) : 'N/A' }}</span>
              </div>
            </div>
          </div>

          <div class="p-6 bg-gray-50 border-t border-gray-100">
            <button
              (click)="isDetailsModalOpen = false"
              class="w-full px-4 py-2.5 bg-gray-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-colors">
              Fechar Detalhes
            </button>
          </div>
        </div>
      </div>
    </div>
  `
})
export class AdminAccessComponent implements OnInit {
  users = signal<AdminUserAccess[]>([]);
  isLoading = signal(true);
  isSubmitting = signal(false);

  searchQuery = signal('');
  roleFilter = signal<'all' | 'admin' | 'user'>('all');

  pageSize = 10;
  currentPage = signal(1);

  currentUserId: string | null = null;

  // Add modal state
  isAddModalOpen = false;
  newAdmin = {
    full_name: '',
    email: '',
    phone: '',
    send_invite: true
  };
  addError: string | null = null;
  addSuccess: string | null = null;

  // Details Modal
  isDetailsModalOpen = false;
  selectedUser: AdminUserAccess | null = null;

  // Edit Modal
  isEditModalOpen = false;
  editAdmin = {
    id: '',
    full_name: '',
    phone: '',
    role: 'user' as 'admin' | 'user',
    status: 'active' as 'active' | 'suspended' | 'trial'
  };

  constructor(
    private supabase: SupabaseService,
    private authService: AuthService,
    private auditLogService: AuditLogService
  ) {}

  async ngOnInit() {
    const user = await this.authService.getCurrentUser();
    this.currentUserId = user?.id || null;
    await this.loadUsers();
  }

  async loadUsers() {
    this.isLoading.set(true);
    try {
      const { data, error } = await this.supabase.db
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.warn('Aviso ao carregar perfis na Gestão de Acessos:', error.message);
        const current = this.authService.currentUser();
        if (current) {
          this.users.set([{
            id: current.id,
            full_name: current.user_metadata?.['full_name'] || 'Administrador',
            email: current.email || 'gustavojofelix@gmail.com',
            phone: current.user_metadata?.['phone'] || '',
            role: 'admin',
            status: 'active',
            created_at: new Date().toISOString()
          }]);
        }
        return;
      }

      const formatted: AdminUserAccess[] = (data || []).map((p: any) => ({
        id: p.id,
        full_name: p.full_name || '',
        email: p.email || 'N/A',
        phone: p.phone || '',
        role: (p.role === 'admin' ? 'admin' : 'user') as 'admin' | 'user',
        status: (p.status || 'active') as 'active' | 'suspended' | 'trial',
        created_at: p.created_at || new Date().toISOString()
      }));

      this.users.set(formatted);
    } catch (error) {
      console.error('Erro ao carregar utilizadores:', error);
      const current = this.authService.currentUser();
      if (current) {
        this.users.set([{
          id: current.id,
          full_name: current.user_metadata?.['full_name'] || 'Administrador',
          email: current.email || 'gustavojofelix@gmail.com',
          phone: current.user_metadata?.['phone'] || '',
          role: 'admin',
          status: 'active',
          created_at: new Date().toISOString()
        }]);
      }
    } finally {
      this.isLoading.set(false);
    }
  }

  filteredUsers = computed(() => {
    let list = this.users();
    const filter = this.roleFilter();
    const query = this.searchQuery().trim().toLowerCase();

    if (filter === 'admin') {
      list = list.filter(u => u.role === 'admin');
    } else if (filter === 'user') {
      list = list.filter(u => u.role !== 'admin');
    }

    if (query) {
      list = list.filter(u =>
        (u.full_name || '').toLowerCase().includes(query) ||
        (u.email || '').toLowerCase().includes(query) ||
        (u.phone && u.phone.toLowerCase().includes(query))
      );
    }

    return list;
  });

  paginatedUsers = computed(() => {
    const start = (this.currentPage() - 1) * this.pageSize;
    return this.filteredUsers().slice(start, start + this.pageSize);
  });

  totalUsers = computed(() => this.users().length);
  totalAdmins = computed(() => this.users().filter(u => u.role === 'admin').length);
  activeUsersCount = computed(() => this.users().filter(u => u.status !== 'suspended').length);

  setFilter(filter: 'all' | 'admin' | 'user') {
    this.roleFilter.set(filter);
    this.currentPage.set(1);
  }

  onSearchChange() {
    this.currentPage.set(1);
  }

  onPageChange(event: PageChangeEvent) {
    this.currentPage.set(event.page);
  }

  getInitials(name: string, email: string): string {
    if (name && name.trim()) {
      const parts = name.trim().split(' ');
      if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      }
      return parts[0].substring(0, 2).toUpperCase();
    }
    return (email || 'AD').substring(0, 2).toUpperCase();
  }

  formatDate(dateStr: string): string {
    if (!dateStr) return 'N/A';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('pt-MZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch {
      return dateStr;
    }
  }

  // Modal handlers for adding Admin
  openAddModal() {
    this.newAdmin = { full_name: '', email: '', phone: '', send_invite: true };
    this.addError = null;
    this.addSuccess = null;
    this.isAddModalOpen = true;
  }

  closeAddModal() {
    this.isAddModalOpen = false;
  }

  async submitNewAdmin() {
    this.addError = null;
    this.addSuccess = null;

    if (!this.newAdmin.full_name.trim()) {
      this.addError = 'Por favor, insira o nome completo do administrador.';
      return;
    }
    if (!this.newAdmin.email.trim() || !this.newAdmin.email.includes('@')) {
      this.addError = 'Por favor, insira um endereço de e-mail válido.';
      return;
    }

    this.isSubmitting.set(true);

    try {
      const cleanEmail = this.newAdmin.email.trim().toLowerCase();
      const currentAdminProfile = await this.authService.getCurrentProfile();

      // 1. Invoke invite-user Edge Function to handle Auth user creation & send invitation email
      const { data: inviteRes, error: inviteErr } = await this.supabase.client.functions.invoke('invite-user', {
        body: {
          email: cleanEmail,
          fullName: this.newAdmin.full_name.trim(),
          phone: this.newAdmin.phone.trim(),
          role: 'Administrador',
          inviterName: currentAdminProfile?.full_name || 'Administrador do ISPC Fácil',
          isPlatformAdmin: true // Pass isPlatformAdmin to customize email content
        }
      }).catch(err => {
        console.warn('Erro ao invocar Edge Function invite-user:', err);
        return { data: null, error: err };
      });

      // 2. Ensure the admin profile exists and is admin via RPC (bypasses RLS and handles race conditions)
      await this.supabase.client.rpc('make_user_admin', { target_email: cleanEmail });

      // 3. Update full name and phone safely now that the profile is guaranteed to exist
      const { data: updatedProfile } = await this.supabase.db
        .from('profiles')
        .update({
          full_name: this.newAdmin.full_name.trim(),
          phone: this.newAdmin.phone.trim() || undefined
        })
        .ilike('email', cleanEmail)
        .select('id')
        .maybeSingle();

      const targetUserId = updatedProfile?.id || inviteRes?.user?.id || null;

      await this.auditLogService.log(
        'Adicionou Novo Administrador',
        'security',
        { email: cleanEmail, full_name: this.newAdmin.full_name },
        targetUserId,
        cleanEmail
      );

      this.addSuccess = 'Administrador adicionado com sucesso! O e-mail de convite foi enviado.';
      await this.loadUsers();

      setTimeout(() => {
        if (this.addSuccess) {
          this.closeAddModal();
        }
      }, 1500);

    } catch (error: any) {
      console.error('Erro ao adicionar administrador:', error);
      this.addError = error.message || 'Ocorreu um erro ao adicionar o administrador.';
    } finally {
      this.isSubmitting.set(false);
    }
  }

  // Details Modal Handlers
  openDetailsModal(user: AdminUserAccess) {
    this.selectedUser = user;
    this.isDetailsModalOpen = true;
  }

  // Edit Modal Handlers
  openEditModal(user: AdminUserAccess) {
    this.selectedUser = user;
    this.editAdmin = {
      id: user.id,
      full_name: user.full_name,
      phone: user.phone || '',
      role: user.role,
      status: (user.status || 'active') as 'active' | 'suspended' | 'trial'
    };
    this.isEditModalOpen = true;
  }

  async submitEditAdmin() {
    if (!this.selectedUser) return;
    this.isSubmitting.set(true);

    try {
      const payload: any = {
        full_name: this.editAdmin.full_name.trim(),
        phone: this.editAdmin.phone.trim() || null,
        updated_at: new Date().toISOString()
      };

      // Only allow editing role and status if not self
      if (this.selectedUser.id !== this.currentUserId) {
        payload.role = this.editAdmin.role;
        payload.status = this.editAdmin.status;
      }

      const { error } = await this.supabase.db
        .from('profiles')
        .update(payload)
        .eq('id', this.selectedUser.id);

      if (error) throw error;

      await this.auditLogService.log(
        'Editou Administrador',
        'security',
        { 
          target_user_id: this.selectedUser.id, 
          email: this.selectedUser.email,
          new_role: payload.role || this.selectedUser.role,
          new_status: payload.status || this.selectedUser.status
        },
        this.selectedUser.id,
        this.selectedUser.email
      );

      this.isEditModalOpen = false;
      await this.loadUsers();
    } catch (e: any) {
      alert(e.message || 'Erro ao guardar alterações.');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  // Toggle user status (Activate / Suspend)
  async toggleUserStatus(user: AdminUserAccess, newStatus: 'active' | 'suspended') {
    if (user.id === this.currentUserId) return;
    this.isSubmitting.set(true);

    try {
      const { error } = await this.supabase.db
        .from('profiles')
        .update({ status: newStatus })
        .eq('id', user.id);

      if (error) throw error;

      await this.auditLogService.log(
        newStatus === 'suspended' ? 'Desativou Acesso de Utilizador' : 'Reativou Acesso de Utilizador',
        'security',
        { target_user_id: user.id, email: user.email, new_status: newStatus },
        user.id,
        user.email
      );

      await this.loadUsers();
    } catch (e: any) {
      alert(e.message || 'Erro ao alterar estado do utilizador.');
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
