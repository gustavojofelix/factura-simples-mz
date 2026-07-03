import {
  Component,
  inject,
  computed,
  signal,
  OnDestroy,
  ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { trigger, transition, style, animate } from '@angular/animations';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatRippleModule } from '@angular/material/core';
import { MatTooltipModule } from '@angular/material/tooltip';

import {
  AiActionsService,
  AIActionItem,
  AIActionType
} from '../../../core/services/ai-actions.service';

// ─── Metadata for rendering each action type ─────────────────────────────────

interface ActionMeta {
  icon: string;
  color: string;        // Tailwind text colour class
  bgColor: string;      // Tailwind bg colour class
}

const ACTION_META: Record<AIActionType, ActionMeta> = {
  CREATE_PRODUCTS: { icon: 'inventory_2',    color: 'text-orange-600',  bgColor: 'bg-orange-50'  },
  CREATE_CLIENTS:  { icon: 'person_add',     color: 'text-blue-600',    bgColor: 'bg-blue-50'    },
  NAVIGATE:        { icon: 'navigation',     color: 'text-purple-600',  bgColor: 'bg-purple-50'  },
  FILTER_DATA:     { icon: 'filter_list',    color: 'text-teal-600',    bgColor: 'bg-teal-50'    },
  GENERATE_REPORT: { icon: 'bar_chart',      color: 'text-indigo-600',  bgColor: 'bg-indigo-50'  }
};

// ─── Component ────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-ai-action-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatRippleModule,
    MatTooltipModule
  ],
  animations: [
    trigger('slideUp', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(40px) scale(0.95)' }),
        animate('320ms cubic-bezier(0.16, 1, 0.3, 1)',
          style({ opacity: 1, transform: 'translateY(0) scale(1)' }))
      ]),
      transition(':leave', [
        animate('200ms ease-in',
          style({ opacity: 0, transform: 'translateY(20px) scale(0.96)' }))
      ])
    ])
  ],
  template: `
    @if (isVisible()) {
      <div
        [@slideUp]
        class="fixed z-[900] flex flex-col overflow-hidden"
        style="
          bottom: 108px;
          right: 24px;
          width: 380px;
          max-height: 70vh;
          border-radius: 20px;
          box-shadow: 0 24px 48px -8px rgba(0,0,0,0.18), 0 0 0 1px rgba(255,255,255,0.6);
          background: rgba(255,255,255,0.97);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
        "
      >
        <!-- ── Header ────────────────────────────────────────────────────── -->
        <div class="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
          <!-- Gradient spark icon -->
          <div class="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center"
               style="background: linear-gradient(135deg, #f97316, #ea580c);">
            <mat-icon class="text-white" style="font-size:18px; width:18px; height:18px;">auto_awesome</mat-icon>
          </div>

          <div class="flex-1 min-w-0">
            <p class="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-0.5">Assistente IA</p>
            <h3 class="text-sm font-bold text-gray-800 leading-tight">
              ✨ A IA quer fazer isto:
            </h3>
          </div>

          <!-- Close button -->
          <button
            mat-icon-button
            class="!w-8 !h-8 !text-gray-400 hover:!text-gray-600"
            [disabled]="aiActionsService.isExecuting()"
            (click)="cancel()"
            matTooltip="Cancelar"
          >
            <mat-icon style="font-size:18px; width:18px; height:18px;">close</mat-icon>
          </button>
        </div>

        <!-- ── Success Banner ────────────────────────────────────────────── -->
        @if (showSuccess()) {
          <div class="px-5 py-4 flex items-center gap-3"
               style="background: linear-gradient(135deg, #f0fdf4, #dcfce7); border-bottom: 1px solid #bbf7d0;">
            <div class="w-9 h-9 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
              <mat-icon class="text-white" style="font-size:20px; width:20px; height:20px;">check</mat-icon>
            </div>
            <div>
              <p class="text-sm font-semibold text-green-800">Concluído com sucesso!</p>
              <p class="text-xs text-green-600 mt-0.5">O painel vai fechar automaticamente…</p>
            </div>
          </div>
        }

        <!-- ── Action List ────────────────────────────────────────────────── -->
        <div class="overflow-y-auto flex-1 px-4 py-3 space-y-2"
             style="scrollbar-width: thin; scrollbar-color: #e5e7eb transparent;">

          @for (action of aiActionsService.pendingActions(); track action.label) {
            <div
              class="rounded-xl border transition-all duration-200"
              [class]="getActionCardClass(action)"
            >
              <!-- Action header row -->
              <div class="flex items-center gap-3 px-3 py-2.5">
                <!-- Icon chip -->
                <div
                  class="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
                  [class]="getActionMeta(action.type).bgColor"
                >
                  <mat-icon
                    [class]="getActionMeta(action.type).color"
                    style="font-size:16px; width:16px; height:16px;"
                  >{{ getActionMeta(action.type).icon }}</mat-icon>
                </div>

                <!-- Label -->
                <span class="flex-1 text-sm font-medium text-gray-700 leading-snug">
                  {{ action.label }}
                </span>

                <!-- Status indicator -->
                <div class="flex-shrink-0">
                  @switch (action.status) {
                    @case ('executing') {
                      <mat-spinner diameter="18" class="!text-orange-500" />
                    }
                    @case ('done') {
                      <div class="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                        <mat-icon class="text-white" style="font-size:13px; width:13px; height:13px;">check</mat-icon>
                      </div>
                    }
                    @case ('error') {
                      <div class="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center">
                        <mat-icon class="text-white" style="font-size:13px; width:13px; height:13px;">close</mat-icon>
                      </div>
                    }
                    @default {
                      <div class="w-5 h-5 rounded-full border-2 border-gray-300"></div>
                    }
                  }
                </div>
              </div>

              <!-- Expandable item preview for CREATE actions -->
              @if (hasPreviewItems(action) && action.status !== 'done') {
                <div class="border-t border-gray-100 mx-3 mb-2">
                  <div
                    class="mt-2 space-y-1 max-h-32 overflow-y-auto pr-1"
                    style="scrollbar-width: thin; scrollbar-color: #e5e7eb transparent;"
                  >
                    @for (item of getPreviewItems(action); track $index) {
                      <div class="flex items-center gap-2 py-1 px-2 rounded-lg bg-gray-50">
                        <mat-icon class="text-gray-400 flex-shrink-0"
                                  style="font-size:12px; width:12px; height:12px;">
                          {{ action.type === 'CREATE_PRODUCTS' ? 'inventory_2' : 'person' }}
                        </mat-icon>
                        <span class="text-xs text-gray-600 truncate flex-1">{{ item.name }}</span>
                        @if (item.price !== undefined) {
                          <span class="text-xs font-semibold text-orange-600 flex-shrink-0">
                            MT {{ item.price | number:'1.2-2' }}
                          </span>
                        }
                      </div>
                    }
                  </div>
                </div>
              }

              <!-- Result message for done/error -->
              @if (action.result && (action.status === 'done' || action.status === 'error')) {
                <div class="px-3 pb-2.5">
                  <p class="text-xs leading-relaxed"
                     [class]="action.status === 'done' ? 'text-green-600' : 'text-red-500'">
                    {{ action.result }}
                  </p>
                </div>
              }
            </div>
          }
        </div>

        <!-- ── Footer Buttons ─────────────────────────────────────────────── -->
        @if (!showSuccess()) {
          <div class="px-4 pb-4 pt-3 border-t border-gray-100 flex gap-2">
            <!-- Cancel -->
            <button
              mat-stroked-button
              class="flex-1 !rounded-xl !border-gray-200 !text-gray-600 hover:!bg-gray-50"
              [disabled]="aiActionsService.isExecuting()"
              (click)="cancel()"
            >
              Cancelar
            </button>

            <!-- Confirm all -->
            <button
              mat-flat-button
              class="flex-[2] !rounded-xl !font-semibold"
              style="background: linear-gradient(135deg, #f97316, #ea580c); color: white;"
              [disabled]="aiActionsService.isExecuting()"
              (click)="confirmAll()"
            >
              @if (aiActionsService.isExecuting()) {
                <div class="flex items-center justify-center gap-2">
                  <mat-spinner diameter="16" class="!text-white" />
                  <span>A executar…</span>
                </div>
              } @else {
                <div class="flex items-center justify-center gap-1.5">
                  <mat-icon style="font-size:16px; width:16px; height:16px;">bolt</mat-icon>
                  <span>Confirmar Tudo</span>
                </div>
              }
            </button>
          </div>
        }
      </div>
    }
  `,
  styles: [`
    :host {
      /* Ensure we don't interfere with layout */
      display: contents;
    }

    /* Smooth spinner colour inside buttons */
    ::ng-deep .mat-mdc-progress-spinner.text-white circle {
      stroke: white !important;
    }
  `]
})
export class AiActionPanelComponent implements OnDestroy {

  aiActionsService = inject(AiActionsService);

  /** True once execution finished successfully — triggers success banner & auto-close */
  showSuccess = signal(false);

  /** The panel is visible when there are pending actions OR success is showing */
  isVisible = computed(
    () => this.aiActionsService.pendingActions().length > 0 || this.showSuccess()
  );

  private _autoCloseTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Event handlers ─────────────────────────────────────────────────────────

  async confirmAll(): Promise<void> {
    const summary = await this.aiActionsService.executeAll();
    console.log('[AiActionPanel] Resumo da execução:', summary);

    // Show success state and auto-dismiss
    this.showSuccess.set(true);
    this._autoCloseTimer = setTimeout(() => {
      this.showSuccess.set(false);
      this.aiActionsService.clearPendingActions();
    }, 3000);
  }

  cancel(): void {
    this.aiActionsService.clearPendingActions();
    this.showSuccess.set(false);
  }

  // ── Template helpers ───────────────────────────────────────────────────────

  getActionMeta(type: AIActionType): ActionMeta {
    return ACTION_META[type] ?? { icon: 'smart_toy', color: 'text-gray-600', bgColor: 'bg-gray-50' };
  }

  getActionCardClass(action: AIActionItem): string {
    const base = 'border transition-colors duration-200';
    switch (action.status) {
      case 'executing': return `${base} border-orange-200 bg-orange-50/40`;
      case 'done':      return `${base} border-green-200 bg-green-50/40`;
      case 'error':     return `${base} border-red-200   bg-red-50/40`;
      default:          return `${base} border-gray-100  bg-white`;
    }
  }

  hasPreviewItems(action: AIActionItem): boolean {
    if (action.type === 'CREATE_PRODUCTS') {
      return (action.payload?.products?.length ?? 0) > 0;
    }
    if (action.type === 'CREATE_CLIENTS') {
      return (action.payload?.clients?.length ?? 0) > 0;
    }
    return false;
  }

  getPreviewItems(action: AIActionItem): Array<{ name: string; price?: number }> {
    if (action.type === 'CREATE_PRODUCTS') {
      return (action.payload?.products ?? []).map((p: any) => ({
        name:  p.name,
        price: p.price
      }));
    }
    if (action.type === 'CREATE_CLIENTS') {
      return (action.payload?.clients ?? []).map((c: any) => ({
        name: c.name
      }));
    }
    return [];
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  ngOnDestroy(): void {
    if (this._autoCloseTimer) clearTimeout(this._autoCloseTimer);
  }
}
