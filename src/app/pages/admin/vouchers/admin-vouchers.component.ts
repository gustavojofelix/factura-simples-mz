import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../../core/services/supabase.service';
import { Voucher, VoucherRedemption, VoucherService } from '../../../core/services/voucher.service';

interface CompanyOption {
  id: string;
  name: string;
  nuit?: string;
  email?: string;
}

@Component({
  selector: 'app-admin-vouchers',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="space-y-6 max-w-7xl mx-auto pb-12">
      <!-- Header Banner -->
      <div class="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-900 rounded-3xl p-8 text-white shadow-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-semibold uppercase tracking-wider mb-3 backdrop-blur-sm border border-indigo-400/20">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"/>
            </svg>
            Gestão de Vouchers & Promocionais
          </div>
          <h2 class="text-3xl font-extrabold tracking-tight">Cupons & Vouchers de Subscrição</h2>
          <p class="text-slate-300 text-sm mt-1 max-w-2xl">
            Crie vouchers de desconto globais (para qualquer cliente) ou direcionados exclusivamente a um único cliente.
          </p>
        </div>

        <button (click)="openCreateModal()" class="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-3 rounded-2xl font-bold text-sm flex items-center gap-2 shadow-lg hover:shadow-indigo-500/25 transition-all transform hover:-translate-y-0.5">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
          </svg>
          <span>Criar Voucher</span>
        </button>
      </div>

      <!-- KPI Summary Row -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <div class="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex items-center gap-4">
          <div class="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h10M7 11h10M7 15h10"/>
            </svg>
          </div>
          <div>
            <span class="text-xs font-semibold text-gray-500 uppercase">Total Vouchers</span>
            <h3 class="text-2xl font-extrabold text-gray-900">{{ vouchers().length }}</h3>
          </div>
        </div>

        <div class="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex items-center gap-4">
          <div class="w-12 h-12 rounded-2xl bg-green-50 text-green-600 flex items-center justify-center font-bold">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
          </div>
          <div>
            <span class="text-xs font-semibold text-gray-500 uppercase">Ativos</span>
            <h3 class="text-2xl font-extrabold text-gray-900">{{ countActive() }}</h3>
          </div>
        </div>

        <div class="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex items-center gap-4">
          <div class="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>
            </svg>
          </div>
          <div>
            <span class="text-xs font-semibold text-gray-500 uppercase">Cliente Específico</span>
            <h3 class="text-2xl font-extrabold text-gray-900">{{ countSpecific() }}</h3>
          </div>
        </div>

        <div class="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex items-center gap-4">
          <div class="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 002 2h1.5a2.5 2.5 0 002.5-2.5V11a2 2 0 00-2-2h-1a2 2 0 01-2-2V4.055"/>
            </svg>
          </div>
          <div>
            <span class="text-xs font-semibold text-gray-500 uppercase">Globais</span>
            <h3 class="text-2xl font-extrabold text-gray-900">{{ countGlobal() }}</h3>
          </div>
        </div>
      </div>

      <!-- Filters & Action Bar -->
      <div class="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between">
        <div class="relative w-full md:w-96">
          <svg class="w-5 h-5 text-gray-400 absolute left-4 top-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
          </svg>
          <input type="text" [(ngModel)]="searchQuery" placeholder="Pesquisar por código, empresa..." class="w-full pl-11 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-2xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
        </div>

        <div class="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <select [(ngModel)]="scopeFilter" class="px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-2xl text-sm font-medium outline-none">
            <option value="all">Todos os Âmbitos</option>
            <option value="global">🌐 Globais (Qualquer Cliente)</option>
            <option value="specific">🔒 Cliente Específico</option>
          </select>

          <select [(ngModel)]="statusFilter" class="px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-2xl text-sm font-medium outline-none">
            <option value="all">Todos os Estados</option>
            <option value="active">🟢 Apenas Ativos</option>
            <option value="inactive">🔴 Inativos / Expirados</option>
          </select>
        </div>
      </div>

      <!-- Vouchers Table Card -->
      <div class="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="bg-gray-50/70 border-b border-gray-100 text-xs font-bold text-gray-500 uppercase tracking-wider">
                <th class="py-4 px-6">Código Voucher</th>
                <th class="py-4 px-6">Âmbito / Cliente Destino</th>
                <th class="py-4 px-6">Benefício / Desconto</th>
                <th class="py-4 px-6 text-center">Utilizações</th>
                <th class="py-4 px-6">Validade</th>
                <th class="py-4 px-6 text-center">Estado</th>
                <th class="py-4 px-6 text-right">Ações</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 text-sm">
              <tr *ngFor="let voucher of filteredVouchers()" class="hover:bg-gray-50/60 transition-colors">
                <td class="py-4 px-6 font-mono font-bold text-indigo-900">
                  <div class="flex items-center gap-2">
                    <span class="px-3 py-1 bg-indigo-50 border border-indigo-100 text-indigo-700 rounded-xl font-bold tracking-wider">
                      {{ voucher.code }}
                    </span>
                  </div>
                  <div *ngIf="voucher.description" class="text-xs text-gray-400 font-sans font-normal mt-1">
                    {{ voucher.description }}
                  </div>
                </td>

                <td class="py-4 px-6">
                  <!-- Global -->
                  <div *ngIf="voucher.scope === 'global'" class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-semibold">
                    <span>🌐 Qualquer Cliente (Global)</span>
                  </div>

                  <!-- Specific Company -->
                  <div *ngIf="voucher.scope === 'specific_company'" class="inline-flex flex-col">
                    <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 text-xs font-bold w-max">
                      🔒 Exclusivo Empresa
                    </span>
                    <span class="text-xs font-bold text-gray-800 mt-1">
                      {{ voucher.target_company?.name || 'Empresa #' + voucher.target_company_id?.substring(0,8) }}
                    </span>
                    <span *ngIf="voucher.target_company?.nuit" class="text-[11px] text-gray-400">
                      NUIT: {{ voucher.target_company?.nuit }}
                    </span>
                  </div>

                  <!-- Specific User -->
                  <div *ngIf="voucher.scope === 'specific_user'" class="inline-flex flex-col">
                    <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-purple-50 text-purple-800 text-xs font-bold w-max">
                      👤 Exclusivo Utilizador
                    </span>
                    <span class="text-xs font-medium text-gray-700 mt-1">
                      {{ voucher.target_user_email }}
                    </span>
                  </div>
                </td>

                <td class="py-4 px-6 font-semibold">
                  <span *ngIf="voucher.discount_type === 'percentage'" class="text-green-600 font-bold text-base">
                    {{ voucher.discount_value }}% Off
                  </span>
                  <span *ngIf="voucher.discount_type === 'fixed_amount'" class="text-green-600 font-bold text-base">
                    {{ voucher.discount_value | number:'1.2-2' }} MZN
                  </span>
                  <span *ngIf="voucher.discount_type === 'trial_days'" class="text-blue-600 font-bold text-base">
                    +{{ voucher.discount_value }} Dias Grátis
                  </span>
                  <div *ngIf="voucher.min_amount" class="text-[11px] text-gray-400 font-normal">
                    Mín. {{ voucher.min_amount | number:'1.2-2' }} MZN
                  </div>
                </td>

                <td class="py-4 px-6 text-center">
                  <span class="px-2.5 py-1 rounded-full bg-gray-100 text-gray-800 text-xs font-bold">
                    {{ voucher.uses_count || 0 }} / {{ voucher.max_uses ? voucher.max_uses : '∞' }}
                  </span>
                </td>

                <td class="py-4 px-6 text-xs text-gray-600">
                  <div *ngIf="voucher.valid_until">
                    <span>Até {{ voucher.valid_until | date:'dd/MM/yyyy' }}</span>
                    <div [class.text-red-500]="isExpired(voucher)" class="text-[11px] font-bold">
                      {{ isExpired(voucher) ? 'Expirado' : 'Válido' }}
                    </div>
                  </div>
                  <div *ngIf="!voucher.valid_until" class="text-gray-400">
                    Sem expiração
                  </div>
                </td>

                <td class="py-4 px-6 text-center">
                  <button (click)="toggleActive(voucher)" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors" [class.bg-green-500]="voucher.is_active" [class.bg-gray-300]="!voucher.is_active">
                    <span class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform" [class.translate-x-6]="voucher.is_active" [class.translate-x-1]="!voucher.is_active"></span>
                  </button>
                </td>

                <td class="py-4 px-6 text-right space-x-2">
                  <button (click)="viewRedemptions(voucher)" title="Ver Histórico de Utilizações" class="p-2 text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                  </button>
                  <button (click)="editVoucher(voucher)" title="Editar" class="p-2 text-gray-600 hover:bg-gray-100 rounded-xl transition-all">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                    </svg>
                  </button>
                  <button (click)="deleteVoucher(voucher)" title="Eliminar" class="p-2 text-red-600 hover:bg-red-50 rounded-xl transition-all">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                    </svg>
                  </button>
                </td>
              </tr>

              <tr *ngIf="filteredVouchers().length === 0">
                <td colspan="7" class="py-12 text-center text-gray-400">
                  Nenhum voucher encontrado com os filtros selecionados.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- MODAL: Create / Edit Voucher -->
      <div *ngIf="showModal" class="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
        <div class="bg-white rounded-3xl border border-gray-100 shadow-2xl max-w-2xl w-full p-8 space-y-6 max-h-[90vh] overflow-y-auto">
          <div class="flex items-center justify-between border-b border-gray-100 pb-4">
            <h3 class="text-xl font-bold text-gray-900">
              {{ editingVoucherId ? 'Editar Voucher Promocional' : 'Criar Novo Voucher' }}
            </h3>
            <button (click)="closeModal()" class="text-gray-400 hover:text-gray-600 p-2 rounded-xl">
              ✕
            </button>
          </div>

          <div class="space-y-4">
            <!-- Code Field -->
            <div>
              <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Código do Voucher *</label>
              <div class="flex gap-2">
                <input type="text" [(ngModel)]="form.code" placeholder="ex: PROMO-2026-X" class="flex-1 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-mono uppercase font-bold focus:ring-2 focus:ring-indigo-500 outline-none">
                <button (click)="generateAutoCode()" type="button" class="bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold px-4 py-2.5 rounded-xl text-xs whitespace-nowrap">
                  🎲 Gerar Automático
                </button>
              </div>
            </div>

            <!-- Description -->
            <div>
              <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Descrição Interna / Promoção</label>
              <input type="text" [(ngModel)]="form.description" placeholder="ex: Cupom exclusivo de boas-vindas" class="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none">
            </div>

            <!-- Scope Selector (Global vs Specific) -->
            <div class="p-4 bg-indigo-50/50 border border-indigo-100 rounded-2xl space-y-3">
              <label class="block text-xs font-bold text-indigo-900 uppercase">Âmbito de Destino do Voucher *</label>
              <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                <label class="flex items-center gap-2 p-3 bg-white border border-gray-200 rounded-xl cursor-pointer hover:border-indigo-500" [class.border-indigo-600]="form.scope === 'global'">
                  <input type="radio" [(ngModel)]="form.scope" value="global" name="scopeRadio">
                  <span class="text-xs font-bold text-gray-800">🌐 Qualquer Cliente</span>
                </label>

                <label class="flex items-center gap-2 p-3 bg-white border border-gray-200 rounded-xl cursor-pointer hover:border-indigo-500" [class.border-indigo-600]="form.scope === 'specific_company'">
                  <input type="radio" [(ngModel)]="form.scope" value="specific_company" name="scopeRadio">
                  <span class="text-xs font-bold text-gray-800">🔒 Cliente Específico</span>
                </label>

                <label class="flex items-center gap-2 p-3 bg-white border border-gray-200 rounded-xl cursor-pointer hover:border-indigo-500" [class.border-indigo-600]="form.scope === 'specific_user'">
                  <input type="radio" [(ngModel)]="form.scope" value="specific_user" name="scopeRadio">
                  <span class="text-xs font-bold text-gray-800">👤 Email Específico</span>
                </label>
              </div>

              <!-- Company Dropdown when specific_company -->
              <div *ngIf="form.scope === 'specific_company'" class="pt-2">
                <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Selecionar Empresa Destino *</label>
                <select [(ngModel)]="form.target_company_id" class="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-semibold outline-none">
                  <option [ngValue]="null">-- Escolha uma empresa --</option>
                  <option *ngFor="let c of companies" [value]="c.id">
                    {{ c.name }} {{ c.nuit ? '(NUIT: ' + c.nuit + ')' : '' }}
                  </option>
                </select>
              </div>

              <!-- User Email input when specific_user -->
              <div *ngIf="form.scope === 'specific_user'" class="pt-2">
                <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Email do Utilizador Autorizado *</label>
                <input type="email" [(ngModel)]="form.target_user_email" placeholder="cliente@empresa.co.mz" class="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm outline-none">
              </div>
            </div>

            <!-- Discount Type & Value -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Tipo de Desconto *</label>
                <select [(ngModel)]="form.discount_type" class="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold outline-none">
                  <option value="percentage">Percentagem (%)</option>
                  <option value="fixed_amount">Valor Fixo (MZN)</option>
                  <option value="trial_days">Dias Grátis Extra</option>
                </select>
              </div>

              <div>
                <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Valor do Desconto *</label>
                <input type="number" [(ngModel)]="form.discount_value" placeholder="ex: 20" class="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold outline-none">
              </div>
            </div>

            <!-- Max Uses & Minimum Purchase -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Limite Máximo de Utilizações</label>
                <input type="number" [(ngModel)]="form.max_uses" placeholder="Vazio para Ilimitado" class="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none">
              </div>

              <div>
                <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Valor Mínimo de Compra (MZN)</label>
                <input type="number" [(ngModel)]="form.min_amount" placeholder="0" class="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none">
              </div>
            </div>

            <!-- Expiration Date -->
            <div>
              <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Data de Expiração (Opcional)</label>
              <input type="date" [(ngModel)]="form.valid_until" class="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none">
            </div>

            <div class="flex items-center gap-2 pt-2">
              <input type="checkbox" id="activeChk" [(ngModel)]="form.is_active" class="w-4 h-4 text-indigo-600 rounded">
              <label for="activeChk" class="text-sm font-bold text-gray-800">Voucher Ativo para Utilização</label>
            </div>
          </div>

          <div class="flex justify-end gap-3 border-t border-gray-100 pt-4">
            <button (click)="closeModal()" type="button" class="px-5 py-2.5 rounded-xl border border-gray-200 text-gray-700 font-semibold text-sm hover:bg-gray-50">
              Cancelar
            </button>
            <button (click)="saveVoucher()" [disabled]="saving" type="button" class="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm shadow-md disabled:opacity-50">
              {{ saving ? 'A guardar...' : 'Guardar Voucher' }}
            </button>
          </div>
        </div>
      </div>

      <!-- MODAL: Redemption History -->
      <div *ngIf="showHistoryModal" class="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
        <div class="bg-white rounded-3xl border border-gray-100 shadow-2xl max-w-2xl w-full p-8 space-y-6 max-h-[85vh] overflow-y-auto">
          <div class="flex items-center justify-between border-b border-gray-100 pb-4">
            <div>
              <h3 class="text-xl font-bold text-gray-900">Histórico de Utilização do Voucher</h3>
              <p class="text-xs text-gray-500">Código: <span class="font-mono font-bold text-indigo-600">{{ selectedVoucherCode }}</span></p>
            </div>
            <button (click)="showHistoryModal = false" class="text-gray-400 hover:text-gray-600 p-2 rounded-xl">
              ✕
            </button>
          </div>

          <div *ngIf="redemptions.length > 0" class="space-y-3">
            <div *ngFor="let red of redemptions" class="p-4 bg-gray-50 border border-gray-200 rounded-2xl flex items-center justify-between">
              <div>
                <h4 class="font-bold text-sm text-gray-800">{{ red.company_name }}</h4>
                <p class="text-xs text-gray-400">Resgatado em: {{ red.redeemed_at | date:'dd/MM/yyyy HH:mm' }}</p>
              </div>
              <span class="text-sm font-bold text-green-600">
                Desconto: {{ red.discount_applied | number:'1.2-2' }} MZN
              </span>
            </div>
          </div>

          <div *ngIf="redemptions.length === 0" class="py-12 text-center text-gray-400">
            Nenhuma utilização registada para este voucher até ao momento.
          </div>

          <div class="flex justify-end border-t border-gray-100 pt-4">
            <button (click)="showHistoryModal = false" class="px-5 py-2 rounded-xl bg-gray-100 text-gray-700 font-bold text-sm">
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  `
})
export class AdminVouchersComponent implements OnInit {
  searchQuery = '';
  scopeFilter: 'all' | 'global' | 'specific' = 'all';
  statusFilter: 'all' | 'active' | 'inactive' = 'all';

  showModal = false;
  showHistoryModal = false;
  editingVoucherId: string | null = null;
  selectedVoucherCode = '';
  saving = false;

  companies: CompanyOption[] = [];
  redemptions: VoucherRedemption[] = [];

  form: Partial<Voucher> = {
    code: '',
    description: '',
    discount_type: 'percentage',
    discount_value: 20,
    scope: 'global',
    target_company_id: null,
    target_user_email: '',
    max_uses: null,
    min_amount: 0,
    valid_until: null,
    is_active: true
  };

  constructor(
    public voucherService: VoucherService,
    private supabase: SupabaseService
  ) {}

  async ngOnInit() {
    await this.voucherService.loadVouchers();
    await this.loadCompanies();
  }

  vouchers() {
    return this.voucherService.vouchers();
  }

  async loadCompanies() {
    try {
      const { data } = await this.supabase.client
        .from('companies')
        .select('id, name, nuit, email')
        .order('name', { ascending: true });

      this.companies = data || [];
    } catch (e) {
      console.error('Error loading companies for voucher dropdown:', e);
    }
  }

  countActive(): number {
    return this.vouchers().filter(v => v.is_active && !this.isExpired(v)).length;
  }

  countSpecific(): number {
    return this.vouchers().filter(v => v.scope !== 'global').length;
  }

  countGlobal(): number {
    return this.vouchers().filter(v => v.scope === 'global').length;
  }

  isExpired(v: Voucher): boolean {
    if (!v.valid_until) return false;
    return new Date(v.valid_until) < new Date();
  }

  filteredVouchers(): Voucher[] {
    return this.vouchers().filter(v => {
      // Search
      const query = this.searchQuery.trim().toLowerCase();
      if (query) {
        const matchesCode = v.code.toLowerCase().includes(query);
        const matchesDesc = (v.description || '').toLowerCase().includes(query);
        const matchesComp = (v.target_company?.name || '').toLowerCase().includes(query);
        if (!matchesCode && !matchesDesc && !matchesComp) return false;
      }

      // Scope
      if (this.scopeFilter === 'global' && v.scope !== 'global') return false;
      if (this.scopeFilter === 'specific' && v.scope === 'global') return false;

      // Status
      if (this.statusFilter === 'active' && (!v.is_active || this.isExpired(v))) return false;
      if (this.statusFilter === 'inactive' && v.is_active && !this.isExpired(v)) return false;

      return true;
    });
  }

  generateAutoCode() {
    const randomHex = Math.random().toString(36).substring(2, 6).toUpperCase();
    this.form.code = `PROMO-${new Date().getFullYear()}-${randomHex}`;
  }

  openCreateModal() {
    this.editingVoucherId = null;
    this.form = {
      code: '',
      description: '',
      discount_type: 'percentage',
      discount_value: 20,
      scope: 'global',
      target_company_id: null,
      target_user_email: '',
      max_uses: null,
      min_amount: 0,
      valid_until: null,
      is_active: true
    };
    this.generateAutoCode();
    this.showModal = true;
  }

  editVoucher(v: Voucher) {
    this.editingVoucherId = v.id || null;
    this.form = {
      code: v.code,
      description: v.description || '',
      discount_type: v.discount_type,
      discount_value: v.discount_value,
      scope: v.scope,
      target_company_id: v.target_company_id || null,
      target_user_email: v.target_user_email || '',
      max_uses: v.max_uses,
      min_amount: v.min_amount || 0,
      valid_until: v.valid_until ? v.valid_until.substring(0, 10) : null,
      is_active: v.is_active
    };
    this.showModal = true;
  }

  closeModal() {
    this.showModal = false;
  }

  async saveVoucher() {
    if (!this.form.code) return;
    this.saving = true;

    try {
      if (this.editingVoucherId) {
        await this.voucherService.updateVoucher(this.editingVoucherId, this.form);
      } else {
        await this.voucherService.createVoucher(this.form);
      }
      this.closeModal();
    } catch (e: any) {
      alert(e.message || 'Erro ao guardar voucher.');
    } finally {
      this.saving = false;
    }
  }

  async toggleActive(v: Voucher) {
    if (!v.id) return;
    await this.voucherService.toggleVoucherActive(v.id, !v.is_active);
  }

  async deleteVoucher(v: Voucher) {
    if (!v.id) return;
    if (confirm(`Tem a certeza que deseja eliminar o voucher "${v.code}"?`)) {
      await this.voucherService.deleteVoucher(v.id);
    }
  }

  async viewRedemptions(v: Voucher) {
    if (!v.id) return;
    this.selectedVoucherCode = v.code;
    this.redemptions = await this.voucherService.getRedemptions(v.id);
    this.showHistoryModal = true;
  }
}
