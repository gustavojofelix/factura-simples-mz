import { Component, signal, computed, inject, effect, HostListener } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs/operators';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';

import { AiChatComponent } from './ai-chat.component';
import { AiAssistantService } from '../../../core/services/ai-assistant.service';
import { CompanyService } from '../../../core/services/company.service';

/**
 * Lançador flutuante do assistente.
 *
 * O painel só é instanciado depois da primeira abertura: manter o chat montado
 * em todas as páginas custaria um pedido de quota e uma subscrição de sinais a
 * utilizadores que nunca o abrem.
 */
@Component({
  selector: 'app-ai-assistant-widget',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatTooltipModule, AiChatComponent],
  template: `
    @if (!companyService.isCompanySuspended() && !naPaginaDoAssistente()) {
      @if (aberto()) {
        <div class="ai-widget__backdrop md:hidden" (click)="fechar()"></div>

        <div class="ai-widget__panel" role="dialog" aria-label="Assistente Virtual">
          <button mat-icon-button class="ai-widget__close" aria-label="Fechar" (click)="fechar()">
            <mat-icon class="!text-[20px] !w-5 !h-5">close</mat-icon>
          </button>
          <app-ai-chat variant="widget" />
        </div>
      }

      <button
        class="ai-widget__fab"
        [class.ai-widget__fab--open]="aberto()"
        [matTooltip]="aberto() ? 'Fechar assistente' : 'Assistente Virtual'"
        matTooltipPosition="left"
        [attr.aria-expanded]="aberto()"
        aria-label="Assistente Virtual"
        (click)="alternar()">
        <mat-icon class="!text-[24px] !w-6 !h-6">
          {{ aberto() ? 'close' : 'auto_awesome' }}
        </mat-icon>

        @if (!aberto() && ai.unreadAlerts().length > 0) {
          <span class="ai-widget__badge">{{ ai.unreadAlerts().length }}</span>
        }
      </button>
    }
  `,
  styles: [`
    .ai-widget__fab {
      position: fixed;
      right: 20px;
      bottom: 84px;
      z-index: 60;
      width: 54px;
      height: 54px;
      border-radius: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      background: linear-gradient(135deg, #f16c39 0%, #f59e0b 100%);
      box-shadow: 0 8px 24px rgba(241, 108, 57, 0.35);
      transition: transform 0.18s ease, box-shadow 0.18s ease;
    }

    @media (min-width: 768px) {
      .ai-widget__fab { bottom: 24px; right: 24px; }
    }

    .ai-widget__fab:hover { transform: translateY(-2px) scale(1.04); }
    .ai-widget__fab:active { transform: scale(0.96); }
    .ai-widget__fab--open { background: #475569; box-shadow: 0 6px 18px rgba(15, 23, 42, 0.25); }

    .ai-widget__badge {
      position: absolute;
      top: -3px;
      right: -3px;
      min-width: 19px;
      height: 19px;
      padding: 0 5px;
      border-radius: 10px;
      background: #dc2626;
      border: 2px solid #fff;
      color: #fff;
      font-size: 10px;
      font-weight: 700;
      line-height: 15px;
    }

    .ai-widget__backdrop {
      position: fixed;
      inset: 0;
      z-index: 55;
      background: rgba(15, 23, 42, 0.45);
      backdrop-filter: blur(2px);
    }

    /* Telemóvel: ecrã inteiro. Um painel pequeno num ecrã de 5 polegadas não
       deixa espaço para ler uma tabela de facturas. */
    .ai-widget__panel {
      position: fixed;
      inset: 0;
      z-index: 58;
      display: flex;
      flex-direction: column;
      background: #fff;
      animation: ai-slide-up 0.2s ease-out;
    }

    @media (min-width: 768px) {
      .ai-widget__panel {
        inset: auto;
        right: 24px;
        bottom: 92px;
        width: 420px;
        height: min(640px, calc(100vh - 140px));
        border: 1px solid #e2e8f0;
        border-radius: 20px;
        box-shadow: 0 20px 60px rgba(15, 23, 42, 0.18);
        overflow: hidden;
      }
    }

    @keyframes ai-slide-up {
      from { opacity: 0; transform: translateY(12px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    @media (prefers-reduced-motion: reduce) {
      .ai-widget__panel { animation: none; }
      .ai-widget__fab { transition: none; }
    }

    .ai-widget__close {
      position: absolute;
      top: 8px;
      right: 10px;
      z-index: 2;
      color: #64748b;
    }

    @media (min-width: 768px) {
      .ai-widget__close { display: none; }
    }
  `]
})
export class AiAssistantWidgetComponent {
  ai = inject(AiAssistantService);
  companyService = inject(CompanyService);
  private router = inject(Router);

  aberto = signal(false);

  /** Rota actual, seguida como sinal para o lançador reagir à navegação. */
  private urlActual = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(e => e.urlAfterRedirects)
    ),
    { initialValue: this.router.url }
  );

  /** Na página do assistente o chat já ocupa o ecrã; o botão seria redundante. */
  naPaginaDoAssistente = computed(() => this.urlActual().startsWith('/assistente'));

  constructor() {
    effect(() => {
      // A quota decide se o lançador mostra o chat ou a mensagem de upgrade;
      // carrega-se uma vez por empresa, não por abertura.
      if (this.companyService.activeCompany()) {
        this.ai.loadQuota();
        this.ai.loadAlerts();
      }
    });
  }

  alternar(): void {
    this.aberto.update(v => !v);
  }

  fechar(): void {
    this.aberto.set(false);
  }

  @HostListener('document:keydown.escape')
  aoEscape(): void {
    if (this.aberto()) this.fechar();
  }
}
