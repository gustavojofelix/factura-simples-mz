import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivityRule, ActivityService, ActivityType } from '../../../core/services/activity.service';
import { AuditLogService } from '../../../core/services/audit-log.service';

@Component({
  selector: 'app-admin-activities',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="space-y-6">
      <div class="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h2 class="text-2xl font-bold text-gray-800">Tipos de Actividades</h2>
          <p class="text-sm text-gray-500 mt-1">Configure o catálogo e os valores fiscais associados.</p>
        </div>
        <button (click)="startNew()" class="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-semibold">
          + Nova actividade
        </button>
      </div>

      <div *ngIf="error" class="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{{ error }}</div>
      <div *ngIf="message" class="p-3 rounded-lg bg-green-50 text-green-700 text-sm">{{ message }}</div>

      <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-6">
        <section class="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div class="p-4 border-b border-gray-100 flex justify-between items-center">
            <span class="font-bold text-gray-800">Catálogo</span>
            <label class="text-xs text-gray-500 flex items-center gap-2">
              <input type="checkbox" [(ngModel)]="showInactive" (change)="load()"> Mostrar inactivas
            </label>
          </div>
          <div class="divide-y divide-gray-100">
            <div *ngFor="let activity of activities" class="p-4 hover:bg-gray-50 cursor-pointer" [class.bg-blue-50]="selected?.id === activity.id" (click)="select(activity)">
              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0" [style.padding-left.px]="(activity.level - 1) * 24">
                  <div class="flex items-center gap-2">
                    <span class="font-semibold text-gray-800">{{ activity.name }}</span>
                    <span class="text-[10px] uppercase rounded px-2 py-0.5" [class.bg-green-100]="activity.is_active" [class.text-green-700]="activity.is_active" [class.bg-gray-100]="!activity.is_active" [class.text-gray-500]="!activity.is_active">
                      {{ activity.is_active ? 'Activa' : 'Inactiva' }}
                    </span>
                  </div>
                  <span class="text-xs text-gray-400 font-mono">{{ activity.code }}</span>
                </div>
                <span class="text-xs text-gray-500">{{ activity.activity_type_rules?.[0]?.tax_rate ?? '—' }}%</span>
              </div>
            </div>
            <div *ngIf="!loading && activities.length === 0" class="p-8 text-center text-gray-500">Nenhuma actividade encontrada.</div>
            <div *ngIf="loading" class="p-8 text-center text-gray-500">A carregar...</div>
          </div>
        </section>

        <section class="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h3 class="font-bold text-gray-800 mb-4">{{ editingId ? 'Editar actividade' : 'Nova actividade' }}</h3>
          <div class="space-y-4">
            <div>
              <label class="label">Nome *</label>
              <input [(ngModel)]="form.name" class="input" placeholder="Ex: Comércio geral">
            </div>
            <div>
              <label class="label">Código *</label>
              <input [(ngModel)]="form.code" [disabled]="!!editingId" class="input font-mono" placeholder="ex: comercio_geral">
            </div>
            <div>
              <label class="label">Actividade pai</label>
              <select [(ngModel)]="form.parent_id" (change)="syncLevel()" class="input">
                <option [ngValue]="null">— Categoria principal —</option>
                <option *ngFor="let parent of parentOptions" [ngValue]="parent.id">{{ parent.name }}</option>
              </select>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div><label class="label">Ordem</label><input [(ngModel)]="form.display_order" type="number" class="input"></div>
              <div><label class="label">Taxa (%)</label><input [(ngModel)]="form.tax_rate" type="number" min="0" max="100" step="0.01" class="input"></div>
            </div>
            <label *ngIf="editingId" class="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" [(ngModel)]="form.is_active"> Actividade activa</label>
            <div class="flex gap-2 pt-2">
              <button (click)="save()" [disabled]="saving" class="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">{{ saving ? 'A guardar...' : 'Guardar' }}</button>
              <button *ngIf="editingId" (click)="startNew()" class="px-4 py-2 border rounded-lg text-gray-600">Cancelar</button>
            </div>
          </div>
        </section>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .label { display: block; font-size: 10px; font-weight: 700; color: #6b7280; text-transform: uppercase; margin-bottom: 5px; }
    .input { width: 100%; padding: 9px 12px; border: 1px solid #e5e7eb; border-radius: 8px; outline: none; font-size: 14px; background: white; }
    .input:focus { border-color: #3b82f6; box-shadow: 0 0 0 2px #dbeafe; }
    .input:disabled { background: #f3f4f6; color: #6b7280; }
  `]
})
export class AdminActivitiesComponent implements OnInit {
  activities: ActivityType[] = [];
  selected: ActivityType | null = null;
  parentOptions: ActivityType[] = [];
  showInactive = true;
  loading = false;
  saving = false;
  editingId: string | null = null;
  error = '';
  message = '';
  form: { name: string; code: string; parent_id: string | null; level: number; display_order: number; tax_rate: number; rule_id?: string; is_active: boolean } = this.emptyForm();

  constructor(
    private activityService: ActivityService,
    private auditLogService: AuditLogService,
    private changeDetectorRef: ChangeDetectorRef
  ) {}

  ngOnInit() { this.load(); }

  async load() {
    this.loading = true;
    this.error = '';
    try {
      this.activities = await this.activityService.list(this.showInactive);
      this.parentOptions = this.activities.filter(a => a.level < 3);
      if (this.selected) this.selected = this.activities.find(a => a.id === this.selected?.id) || null;
    } catch (error: any) {
      this.error = error?.message || 'Não foi possível carregar o catálogo.';
    } finally {
      this.loading = false;
      // O Supabase usa Promises nativas; actualizar explicitamente garante que
      // a lista e o estado de carregamento sejam reflectidos no backoffice.
      this.changeDetectorRef.detectChanges();
    }
  }

  select(activity: ActivityType) {
    this.selected = activity;
    this.editingId = activity.id;
    this.form = {
      name: activity.name, code: activity.code, parent_id: activity.parent_id,
      level: activity.level, display_order: activity.display_order,
      tax_rate: activity.activity_type_rules?.[0]?.tax_rate ?? 0, rule_id: activity.activity_type_rules?.[0]?.id, is_active: activity.is_active
    };
  }

  startNew() { this.editingId = null; this.selected = null; this.form = this.emptyForm(); this.error = ''; }

  syncLevel() {
    const parent = this.activities.find(activity => activity.id === this.form.parent_id);
    this.form.level = parent ? Math.min(parent.level + 1, 3) : 1;
  }

  async save() {
    this.error = ''; this.message = '';
    if (!this.form.name.trim() || !this.form.code.trim()) { this.error = 'Nome e código são obrigatórios.'; return; }
    this.saving = true;
    try {
      let activity: ActivityType;
      const payload = { code: this.form.code.trim().toLowerCase(), name: this.form.name.trim(), parent_id: this.form.parent_id, level: this.form.level, display_order: Number(this.form.display_order) || 0, is_active: this.form.is_active };
      if (this.editingId) activity = await this.activityService.update(this.editingId, payload);
      else activity = await this.activityService.create(payload);
      await this.activityService.saveRule({ id: this.form.rule_id, activity_type_id: activity.id, rule_type: 'ispc_rate', tax_rate: Number(this.form.tax_rate) || 0, is_active: true });
      await this.auditLogService.log(this.editingId ? 'Actualizou Tipo de Actividade' : 'Criou Tipo de Actividade', 'admin_activities', { code: activity.code, name: activity.name, tax_rate: this.form.tax_rate }, activity.id, activity.name);
      this.message = 'Alterações guardadas com sucesso.';
      await this.load();
      this.select(this.activities.find(a => a.id === activity.id) || activity);
    } catch (error: any) { this.error = error?.message || 'Não foi possível guardar a actividade.'; }
    finally { this.saving = false; }
  }

  private emptyForm() { return { name: '', code: '', parent_id: null, level: 1, display_order: 0, tax_rate: 3, rule_id: undefined, is_active: true }; }
}
