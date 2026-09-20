import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

import { AiChatComponent } from '../../shared/components/ai-chat/ai-chat.component';
import { AiAssistantService } from '../../core/services/ai-assistant.service';

/**
 * Página inteira do assistente.
 *
 * Existe além do painel flutuante porque conversas longas — um relatório com
 * várias tabelas, uma análise trimestral — não cabem confortavelmente numa
 * janela de 420px. É também o destino da pesquisa inteligente e dos alertas
 * quando o utilizador pede uma explicação.
 */
@Component({
  selector: 'app-assistant',
  standalone: true,
  imports: [CommonModule, MatIconModule, AiChatComponent],
  template: `
    <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <header class="mb-5 shrink-0">
        <div class="flex items-center gap-2 mb-1.5">
          <h1 class="text-2xl font-bold text-slate-900">Assistente Virtual</h1>
          <span class="px-2 py-0.5 rounded-full bg-gold/15 text-gold text-[10px] font-extrabold uppercase tracking-wider">
            IA
          </span>
        </div>
        <p class="text-sm text-slate-500 leading-relaxed">
          Pergunte sobre facturação, clientes, produtos e impostos. As respostas usam
          os dados reais da empresa activa; as questões fiscais são respondidas a
          partir da base de conhecimento do ISPC Fácil.
        </p>
      </header>

      <!-- Altura fixa em vez de 100%: o contentor pai já tem o seu próprio
           scroll e avisos de subscrição de altura variável, e um flex-1 aqui
           faria o chat encolher de forma imprevisível. -->
      <div class="h-[70vh] min-h-[440px] max-h-[860px]">
        <app-ai-chat variant="page" />
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
  `]
})
export class AssistantComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private ai = inject(AiAssistantService);

  ngOnInit(): void {
    const pergunta = this.route.snapshot.queryParamMap.get('q');
    if (!pergunta) return;

    // Limpa o parâmetro antes de enviar: recarregar a página não deve repetir
    // a pergunta e voltar a gastar uma unidade de quota.
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {},
      replaceUrl: true
    });

    this.ai.startNewConversation();
    this.ai.ask(pergunta);
  }
}
