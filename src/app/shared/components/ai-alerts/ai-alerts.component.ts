import { Component, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';

import { AiAssistantService, AiAlert } from '../../../core/services/ai-assistant.service';
import { CompanyService } from '../../../core/services/company.service';

/**
 * Sino de alertas inteligentes.
 *
 * Os alertas são calculados em SQL por um trabalho diário; este componente
 * apenas os lê. O botão de actualizar existe porque um utilizador que acabou de
 * receber um pagamento quer ver o alerta desaparecer sem esperar pela noite.
 */
@Component({
  selector: 'app-ai-alerts',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatMenuModule, MatTooltipModule],
  template: `
    @if (ai.quota()?.alerts_enabled) {
      <button
        mat-icon-button
        class="relative !w-10 !h-10"
        [matMenuTriggerFor]="menu"
        matTooltip="Alertas inteligentes"
        aria-label="Alertas inteligentes">
        <mat-icon class="!text-[21px] !w-[21px] !h-[21px] text-slate-500">notifications</mat-icon>
        @if (ai.unreadAlerts().length > 0) {
          <span class="ai-alerts__badge"
                [class.ai-alerts__badge--critical]="ai.criticalAlerts().length > 0">
            {{ ai.unreadAlerts().length }}
          </span>
        }
      </button>

      <mat-menu #menu="matMenu" class="ai-alerts__menu" xPosition="before">
        <div class="ai-alerts" (click)="$event.stopPropagation()">
          <header class="ai-alerts__header">
            <span class="text-[13px] font-bold text-slate-900">Alertas inteligentes</span>
            <button mat-icon-button class="!w-8 !h-8" matTooltip="Actualizar"
                    [disabled]="aActualizar()" (click)="actualizar()">
              <mat-icon class="!text-[16px] !w-4 !h-4 text-slate-400"
                        [class.ai-alerts__spin]="aActualizar()">refresh</mat-icon>
            </button>
          </header>

          <div class="ai-alerts__list custom-scrollbar">
            @if (ai.alerts().length === 0) {
              <div class="ai-alerts__empty">
                <mat-icon class="!text-[28px] !w-7 !h-7 text-emerald-400 mb-2">check_circle</mat-icon>
                <p class="text-[13px] font-medium text-slate-700">Está tudo em ordem</p>
                <p class="text-[11.5px] text-slate-400 mt-0.5 leading-snug">
                  Sem facturas vencidas, prazos próximos ou quedas de vendas a assinalar.
                </p>
              </div>
            }

            @for (a of ai.alerts(); track a.id) {
              <article class="ai-alerts__item" [class.ai-alerts__item--unread]="a.status === 'nova'">
                <span class="ai-alerts__dot" [class]="'ai-alerts__dot--' + a.severity"></span>

                <div class="flex-1 min-w-0">
                  <p class="text-[12.5px] font-bold text-slate-900 leading-snug">{{ a.title }}</p>
                  <p class="text-[11.5px] text-slate-500 leading-snug mt-0.5">{{ a.body }}</p>

                  <div class="flex items-center gap-2.5 mt-2">
                    @if (a.action_route) {
                      <button class="ai-alerts__action" (click)="irPara(a)">
                        {{ a.action_label || 'Ver' }}
                      </button>
                    }
                    <button class="ai-alerts__link" (click)="explicar(a)">Perguntar ao assistente</button>
                    <button class="ai-alerts__link ai-alerts__link--muted"
                            (click)="ai.dismissAlert(a.id)">Dispensar</button>
                  </div>
                </div>
              </article>
            }
          </div>
        </div>
      </mat-menu>
    }
  `,
  styles: [`
    .ai-alerts__badge {
      position: absolute;
      top: 4px;
      right: 4px;
      min-width: 17px;
      height: 17px;
      padding: 0 4px;
      border-radius: 9px;
      background: #f59e0b;
      border: 2px solid #fff;
      color: #fff;
      font-size: 9.5px;
      font-weight: 700;
      line-height: 13px;
    }

    .ai-alerts__badge--critical { background: #dc2626; }

    .ai-alerts { width: min(380px, calc(100vw - 32px)); }

    .ai-alerts__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 8px 10px 14px;
      border-bottom: 1px solid #f1f5f9;
    }

    .ai-alerts__list { max-height: 420px; overflow-y: auto; }

    .ai-alerts__empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      padding: 28px 24px;
    }

    .ai-alerts__item {
      display: flex;
      gap: 9px;
      padding: 12px 14px;
      border-bottom: 1px solid #f8fafc;
    }

    .ai-alerts__item--unread { background: #fffdf7; }

    .ai-alerts__dot {
      width: 7px;
      height: 7px;
      margin-top: 5px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .ai-alerts__dot--info    { background: #38bdf8; }
    .ai-alerts__dot--aviso   { background: #f59e0b; }
    .ai-alerts__dot--critico { background: #dc2626; }

    .ai-alerts__action {
      padding: 3px 9px;
      border-radius: 7px;
      background: #332d2a;
      color: #fff;
      font-size: 11px;
      font-weight: 600;
    }

    .ai-alerts__link {
      font-size: 11px;
      font-weight: 600;
      color: #f16c39;
    }

    .ai-alerts__link--muted { color: #94a3b8; font-weight: 500; }

    .ai-alerts__spin { animation: ai-spin 0.9s linear infinite; }

    @keyframes ai-spin { to { transform: rotate(360deg); } }

    @media (prefers-reduced-motion: reduce) {
      .ai-alerts__spin { animation: none; }
    }
  `]
})
export class AiAlertsComponent {
  ai = inject(AiAssistantService);
  private companyService = inject(CompanyService);
  private router = inject(Router);

  aActualizar = signal(false);

  constructor() {
    effect(() => {
      if (this.companyService.activeCompany()) {
        this.ai.loadAlerts();
      }
    });
  }

  async actualizar(): Promise<void> {
    this.aActualizar.set(true);
    try {
      await this.ai.refreshAlerts();
    } finally {
      this.aActualizar.set(false);
    }
  }

  irPara(a: AiAlert): void {
    this.ai.markAlertRead(a.id);
    if (a.action_route) this.router.navigateByUrl(a.action_route);
  }

  /** Leva o alerta ao assistente, que o explica com os números por detrás. */
  explicar(a: AiAlert): void {
    this.ai.markAlertRead(a.id);
    this.router.navigate(['/assistente'], {
      queryParams: { q: `Explique-me este alerta: ${a.title}. ${a.body}` }
    });
  }
}
