import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SubscriptionPlan, SubscriptionService } from '../../../core/services/subscription.service';

@Component({
  selector: 'app-admin-plans',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="space-y-6">
      <!-- Header -->
      <div class="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h2 class="text-2xl font-bold text-gray-800">Planos de Subscrição</h2>
          <p class="text-sm text-gray-500 mt-1">Gerencie os tarifários, preços e funcionalidades visíveis aos clientes.</p>
        </div>
        <button (click)="startNew()" class="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-semibold flex items-center gap-2 shadow-sm transition-colors">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
          </svg>
          Novo Plano
        </button>
      </div>

      <!-- Messages -->
      <div *ngIf="error" class="p-3 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">{{ error }}</div>
      <div *ngIf="message" class="p-3 rounded-lg bg-green-50 text-green-700 text-sm border border-green-200">{{ message }}</div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Plans List (Left Columns) -->
        <div class="lg:col-span-2 space-y-4">
          <div *ngIf="subscriptionService.loadingPlans()" class="p-8 text-center bg-white rounded-xl border border-gray-100 text-gray-500">
            A carregar planos da base de dados...
          </div>

          <div *ngIf="!subscriptionService.loadingPlans() && plans.length === 0" class="p-8 text-center bg-white rounded-xl border border-gray-100 text-gray-500">
            Nenhum plano encontrado na base de dados.
          </div>

          <div *ngFor="let plan of plans" class="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 relative transition-all hover:shadow-md" [class.ring-2]="selectedPlan?.id === plan.id || selectedPlan?.code === plan.code" [class.ring-blue-500]="selectedPlan?.id === plan.id || selectedPlan?.code === plan.code">
            <div class="flex items-start justify-between gap-4 mb-4">
              <div>
                <div class="flex items-center gap-2">
                  <h3 class="text-xl font-bold text-gray-900">{{ plan.name }}</h3>
                  <span *ngIf="plan.is_popular" class="bg-amber-100 text-amber-800 text-xs font-semibold px-2.5 py-0.5 rounded-full flex items-center gap-1">
                    ★ Popular
                  </span>
                  <span class="text-xs uppercase px-2 py-0.5 rounded-full font-semibold" [class.bg-green-100]="plan.is_active" [class.text-green-700]="plan.is_active" [class.bg-gray-100]="!plan.is_active" [class.text-gray-500]="!plan.is_active">
                    {{ plan.is_active ? 'Activo' : 'Inactivo' }}
                  </span>
                </div>
                <p class="text-sm text-gray-500 mt-1">{{ plan.description }}</p>
                <span class="text-xs font-mono text-gray-400">Código: {{ plan.code }}</span>
              </div>

              <div class="flex items-center gap-2">
                <button (click)="selectPlan(plan)" class="text-sm bg-gray-50 text-gray-700 hover:bg-gray-100 px-3 py-1.5 rounded-lg border border-gray-200 font-medium transition-colors">
                  Editar
                </button>
                <button (click)="toggleActive(plan)" class="text-sm px-3 py-1.5 rounded-lg border font-medium transition-colors" [class.border-red-200]="plan.is_active" [class.text-red-600]="plan.is_active" [class.hover:bg-red-50]="plan.is_active" [class.border-green-200]="!plan.is_active" [class.text-green-600]="!plan.is_active" [class.hover:bg-green-50]="!plan.is_active">
                  {{ plan.is_active ? 'Desactivar' : 'Activar' }}
                </button>
              </div>
            </div>

            <!-- Prices -->
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-gray-50 rounded-xl mb-4 text-sm">
              <div>
                <span class="text-xs text-gray-500 block">1 Mês (Mensal)</span>
                <span class="text-base font-bold text-gray-800">{{ plan.monthly_price | number:'1.2-2' }} {{ plan.currency || 'MZN' }}</span>
              </div>
              <div>
                <span class="text-xs text-gray-500 block">3 Meses (Trimestral)</span>
                <span class="text-base font-bold text-gray-800">{{ (plan.three_months_price || plan.monthly_price * 3) | number:'1.2-2' }} {{ plan.currency || 'MZN' }}</span>
              </div>
              <div>
                <span class="text-xs text-gray-500 block">6 Meses (Semestral)</span>
                <span class="text-base font-bold text-gray-800">{{ (plan.six_months_price || plan.monthly_price * 6) | number:'1.2-2' }} {{ plan.currency || 'MZN' }}</span>
              </div>
              <div>
                <span class="text-xs text-gray-500 block">1 Ano (Anual)</span>
                <span class="text-base font-bold text-gray-800">{{ plan.yearly_price | number:'1.2-2' }} {{ plan.currency || 'MZN' }}</span>
              </div>
            </div>

            <!-- Features -->
            <div>
              <span class="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-2">Vantagens & Funcionalidades</span>
              <ul class="space-y-1.5">
                <li *ngFor="let feat of plan.features" class="text-sm text-gray-600 flex items-center gap-2">
                  <svg class="w-4 h-4 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
                  </svg>
                  <span>{{ feat }}</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <!-- Form Panel (Right Column) -->
        <div class="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 h-fit sticky top-6">
          <h3 class="text-lg font-bold text-gray-800 mb-4">
            {{ isEditing ? 'Editar Plano: ' + form.name : 'Novo Plano de Subscrição' }}
          </h3>

          <form (ngSubmit)="savePlan()" class="space-y-4">
            <div>
              <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Nome do Plano *</label>
              <input type="text" [(ngModel)]="form.name" name="name" required placeholder="Ex: Empresarial" class="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>

            <div>
              <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Código Único *</label>
              <input type="text" [(ngModel)]="form.code" name="code" required [disabled]="isEditing" placeholder="Ex: empresarial" class="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60">
            </div>

            <div>
              <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Descrição</label>
              <textarea [(ngModel)]="form.description" name="description" rows="2" placeholder="Resumo do público-alvo ou benefício" class="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"></textarea>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Preço 1 Mês (MZN)</label>
                <input type="number" [(ngModel)]="form.monthly_price" name="monthly_price" min="0" step="0.01" class="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              </div>
              <div>
                <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Preço 3 Meses (MZN)</label>
                <input type="number" [(ngModel)]="form.three_months_price" name="three_months_price" min="0" step="0.01" class="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              </div>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Preço 6 Meses (MZN)</label>
                <input type="number" [(ngModel)]="form.six_months_price" name="six_months_price" min="0" step="0.01" class="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              </div>
              <div>
                <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Preço 1 Ano (MZN)</label>
                <input type="number" [(ngModel)]="form.yearly_price" name="yearly_price" min="0" step="0.01" class="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              </div>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Ordem de Exibição</label>
                <input type="number" [(ngModel)]="form.sort_order" name="sort_order" min="0" class="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              </div>
              <div>
                <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Moeda</label>
                <input type="text" [(ngModel)]="form.currency" name="currency" class="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm uppercase focus:outline-none focus:ring-2 focus:ring-blue-500">
              </div>
            </div>

            <div class="flex items-center gap-6 py-2">
              <label class="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" [(ngModel)]="form.is_active" name="is_active" class="rounded border-gray-300 text-blue-600 focus:ring-blue-500">
                <span>Activo</span>
              </label>

              <label class="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" [(ngModel)]="form.is_popular" name="is_popular" class="rounded border-gray-300 text-amber-600 focus:ring-amber-500">
                <span>Destaque (Popular)</span>
              </label>
            </div>

            <!-- Features Array Input -->
            <div>
              <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Funcionalidades (Linha a linha)</label>
              <textarea [(ngModel)]="featuresRaw" name="featuresRaw" rows="5" placeholder="Digite uma funcionalidade por linha..." class="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-sans"></textarea>
            </div>

            <div class="flex gap-2 pt-2">
              <button type="submit" [disabled]="saving" class="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg text-sm transition-colors disabled:opacity-50">
                {{ saving ? 'A guardar...' : (isEditing ? 'Guardar Alterações' : 'Criar Plano') }}
              </button>
              <button type="button" (click)="resetForm()" class="bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2 px-4 rounded-lg text-sm transition-colors">
                Cancelar
              </button>
            </div>

            <div *ngIf="isEditing && selectedPlan?.id" class="pt-2 border-t border-gray-100">
              <button type="button" (click)="confirmDelete()" class="w-full text-red-600 hover:bg-red-50 font-semibold py-1.5 px-4 rounded-lg text-xs transition-colors">
                Eliminar Plano
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `
})
export class AdminPlansComponent implements OnInit {
  message = '';
  error = '';
  saving = false;
  selectedPlan: SubscriptionPlan | null = null;
  isEditing = false;

  form: Partial<SubscriptionPlan> = {
    name: '',
    code: '',
    description: '',
    monthly_price: 0,
    three_months_price: 0,
    six_months_price: 0,
    yearly_price: 0,
    currency: 'MZN',
    features: [],
    is_active: true,
    is_popular: false,
    sort_order: 1
  };

  featuresRaw = '';

  constructor(public subscriptionService: SubscriptionService) {}

  ngOnInit() {
    this.subscriptionService.loadPlans();
  }

  get plans(): SubscriptionPlan[] {
    return this.subscriptionService.availablePlans;
  }

  startNew() {
    this.selectedPlan = null;
    this.isEditing = false;
    this.form = {
      name: '',
      code: '',
      description: '',
      monthly_price: 0,
      three_months_price: 0,
      six_months_price: 0,
      yearly_price: 0,
      currency: 'MZN',
      features: [],
      is_active: true,
      is_popular: false,
      sort_order: this.plans.length + 1
    };
    this.featuresRaw = '';
    this.message = '';
    this.error = '';
  }

  selectPlan(plan: SubscriptionPlan) {
    this.selectedPlan = plan;
    this.isEditing = true;
    this.form = { ...plan };
    this.featuresRaw = (plan.features || []).join('\n');
    this.message = '';
    this.error = '';
  }

  resetForm() {
    this.startNew();
  }

  async toggleActive(plan: SubscriptionPlan) {
    if (!plan.id) return;
    const ok = await this.subscriptionService.updatePlan(plan.id, {
      is_active: !plan.is_active
    });
    if (ok) {
      this.message = `Plano ${plan.name} ${!plan.is_active ? 'activado' : 'desactivado'} com sucesso.`;
    } else {
      this.error = 'Erro ao alterar estado do plano.';
    }
  }

  async savePlan() {
    if (!this.form.name || (!this.isEditing && !this.form.code)) {
      this.error = 'Por favor preencha os campos obrigatórios (Nome e Código).';
      return;
    }

    this.saving = true;
    this.error = '';
    this.message = '';

    const featuresList = this.featuresRaw
      .split('\n')
      .map(f => f.trim())
      .filter(f => f.length > 0);

    const payload: Partial<SubscriptionPlan> = {
      ...this.form,
      features: featuresList,
      monthly_price: Number(this.form.monthly_price || 0),
      three_months_price: Number(this.form.three_months_price || 0),
      six_months_price: Number(this.form.six_months_price || 0),
      yearly_price: Number(this.form.yearly_price || 0),
      sort_order: Number(this.form.sort_order || 0)
    };

    let success = false;
    if (this.isEditing && this.selectedPlan?.id) {
      success = await this.subscriptionService.updatePlan(this.selectedPlan.id, payload);
      if (success) this.message = 'Plano actualizado com sucesso.';
    } else {
      success = await this.subscriptionService.createPlan(payload);
      if (success) this.message = 'Novo plano criado com sucesso.';
    }

    this.saving = false;
    if (success) {
      this.resetForm();
    } else {
      this.error = 'Erro ao guardar as alterações no plano.';
    }
  }

  async confirmDelete() {
    if (!this.selectedPlan?.id) return;
    if (!confirm(`Tem a certeza que deseja eliminar o plano "${this.selectedPlan.name}"?`)) return;

    this.saving = true;
    const success = await this.subscriptionService.deletePlan(this.selectedPlan.id);
    this.saving = false;

    if (success) {
      this.message = 'Plano eliminado com sucesso.';
      this.resetForm();
    } else {
      this.error = 'Erro ao eliminar o plano.';
    }
  }
}
