import { Component, signal, inject, ElementRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

import { AiAssistantService, AiSearchResult } from '../../../core/services/ai-assistant.service';

/**
 * Pesquisa inteligente da barra superior.
 *
 * Duas camadas: a pesquisa literal corre directamente na base de dados, é
 * instantânea e não consome quota; o assistente só é chamado quando o
 * utilizador escreve uma pergunta em vez de um nome. Encaminhar tudo para o
 * modelo tornaria lento e caro o caso mais comum, que é procurar um cliente.
 */
@Component({
  selector: 'app-ai-search',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatButtonModule],
  template: `
    <div class="ai-search" [class.ai-search--active]="aberto()">
      <mat-icon class="ai-search__icon">search</mat-icon>

      <input
        type="text"
        class="ai-search__input"
        placeholder="Procurar ou perguntar…"
        autocomplete="off"
        [ngModel]="termo()"
        (ngModelChange)="aoEscrever($event)"
        (focus)="aberto.set(true)"
        (keydown.enter)="aoEnter()"
        (keydown.escape)="fechar()"
        aria-label="Pesquisar clientes, produtos e facturas" />

      @if (termo()) {
        <button mat-icon-button class="!w-7 !h-7 shrink-0" aria-label="Limpar" (click)="limpar()">
          <mat-icon class="!text-[16px] !w-4 !h-4 text-slate-400">close</mat-icon>
        </button>
      }

      @if (aberto() && termo().length >= 2) {
        <div class="ai-search__panel custom-scrollbar">

          @if (aParecerPergunta()) {
            <button class="ai-search__ask" (click)="perguntarAoAssistente()">
              <span class="ai-search__ask-icon">
                <mat-icon class="!text-[15px] !w-[15px] !h-[15px]">auto_awesome</mat-icon>
              </span>
              <span class="flex-1 text-left min-w-0">
                <span class="block text-[11px] text-slate-400 leading-tight">Perguntar ao assistente</span>
                <span class="block text-[13px] text-slate-800 font-medium truncate">{{ termo() }}</span>
              </span>
              <mat-icon class="!text-[16px] !w-4 !h-4 text-slate-300 shrink-0">arrow_forward</mat-icon>
            </button>
          }

          @if (aProcurar()) {
            <p class="ai-search__empty">A procurar…</p>
          } @else if (resultados().length === 0) {
            <p class="ai-search__empty">Sem resultados para “{{ termo() }}”.</p>
            @if (!aParecerPergunta()) {
              <button class="ai-search__ask" (click)="perguntarAoAssistente()">
                <span class="ai-search__ask-icon">
                  <mat-icon class="!text-[15px] !w-[15px] !h-[15px]">auto_awesome</mat-icon>
                </span>
                <span class="flex-1 text-left text-[13px] text-slate-700">
                  Perguntar ao assistente
                </span>
              </button>
            }
          } @else {
            @for (r of resultados(); track r.tipo + r.id) {
              <button class="ai-search__item" (click)="abrir(r)">
                <span class="ai-search__badge" [class]="'ai-search__badge--' + r.tipo">
                  <mat-icon class="!text-[14px] !w-[14px] !h-[14px]">{{ icone(r.tipo) }}</mat-icon>
                </span>
                <span class="flex-1 min-w-0 text-left">
                  <span class="block text-[13px] font-medium text-slate-800 truncate">{{ r.titulo }}</span>
                  <span class="block text-[11px] text-slate-400 truncate">{{ r.subtitulo }}</span>
                </span>
                @if (r.total !== undefined) {
                  <span class="text-[11px] font-bold text-slate-600 shrink-0">
                    {{ r.total | number:'1.0-2' }}
                  </span>
                }
              </button>
            }
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }

    .ai-search {
      position: relative;
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      max-width: 380px;
      padding: 0 8px 0 11px;
      height: 38px;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      background: #f8fafc;
      transition: border-color 0.15s, background 0.15s;
    }

    .ai-search--active,
    .ai-search:focus-within {
      border-color: #f16c39;
      background: #fff;
    }

    .ai-search__icon {
      font-size: 17px !important;
      width: 17px !important;
      height: 17px !important;
      color: #94a3b8;
      flex-shrink: 0;
    }

    .ai-search__input {
      flex: 1;
      min-width: 0;
      border: 0;
      outline: 0;
      background: transparent;
      font-size: 13px;
      color: #1e293b;
    }

    .ai-search__input::placeholder { color: #94a3b8; }

    .ai-search__panel {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      right: 0;
      z-index: 50;
      max-height: 340px;
      overflow-y: auto;
      padding: 5px;
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      box-shadow: 0 12px 32px rgba(15, 23, 42, 0.12);
    }

    .ai-search__item,
    .ai-search__ask {
      display: flex;
      align-items: center;
      gap: 9px;
      width: 100%;
      padding: 8px 9px;
      border-radius: 10px;
      transition: background 0.12s;
    }

    .ai-search__item:hover,
    .ai-search__ask:hover { background: #f8fafc; }

    .ai-search__ask {
      border-bottom: 1px solid #f1f5f9;
      border-radius: 10px 10px 0 0;
    }

    .ai-search__ask-icon {
      width: 26px;
      height: 26px;
      flex-shrink: 0;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      background: linear-gradient(135deg, #f16c39 0%, #f59e0b 100%);
    }

    .ai-search__badge {
      width: 26px;
      height: 26px;
      flex-shrink: 0;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .ai-search__badge--cliente  { background: #eff6ff; color: #2563eb; }
    .ai-search__badge--produto  { background: #f0fdf4; color: #16a34a; }
    .ai-search__badge--factura  { background: #fff7ed; color: #ea580c; }

    .ai-search__empty {
      padding: 14px 10px;
      text-align: center;
      font-size: 12.5px;
      color: #94a3b8;
    }
  `]
})
export class AiSearchComponent {
  private ai = inject(AiAssistantService);
  private router = inject(Router);
  private host = inject(ElementRef<HTMLElement>);

  termo = signal('');
  resultados = signal<AiSearchResult[]>([]);
  aProcurar = signal(false);
  aberto = signal(false);

  private debounce?: ReturnType<typeof setTimeout>;
  /** Protege contra respostas lentas de uma pesquisa anterior. */
  private pedidoActual = 0;

  /**
   * Uma pergunta distingue-se de uma procura por ter palavra interrogativa,
   * ponto de interrogação, ou simplesmente por ser uma frase. Procurar um
   * cliente são uma ou duas palavras; perguntar são quatro ou mais.
   */
  aParecerPergunta(): boolean {
    const t = this.termo().trim().toLowerCase();
    if (t.includes('?')) return true;
    if (t.split(/\s+/).length >= 4) return true;
    return /^(quanto|quantos|quantas|qual|quais|quem|quando|onde|porque|porquê|como|o que)\b/.test(t);
  }

  aoEscrever(valor: string): void {
    this.termo.set(valor);
    this.aberto.set(true);
    clearTimeout(this.debounce);

    if (valor.trim().length < 2) {
      this.resultados.set([]);
      this.aProcurar.set(false);
      return;
    }

    this.aProcurar.set(true);
    this.debounce = setTimeout(() => this.procurar(valor), 280);
  }

  private async procurar(valor: string): Promise<void> {
    const pedido = ++this.pedidoActual;
    const encontrados = await this.ai.search(valor);

    // Uma pesquisa mais recente já partiu; descarta-se este resultado.
    if (pedido !== this.pedidoActual) return;

    this.resultados.set(encontrados);
    this.aProcurar.set(false);
  }

  aoEnter(): void {
    if (this.aParecerPergunta() || this.resultados().length === 0) {
      this.perguntarAoAssistente();
    } else {
      this.abrir(this.resultados()[0]);
    }
  }

  abrir(r: AiSearchResult): void {
    this.router.navigateByUrl(r.rota);
    this.limpar();
  }

  perguntarAoAssistente(): void {
    const pergunta = this.termo().trim();
    if (!pergunta) return;
    this.router.navigate(['/assistente'], { queryParams: { q: pergunta } });
    this.limpar();
  }

  limpar(): void {
    this.termo.set('');
    this.resultados.set([]);
    this.aberto.set(false);
  }

  fechar(): void {
    this.aberto.set(false);
  }

  icone(tipo: string): string {
    return tipo === 'cliente' ? 'person' : tipo === 'produto' ? 'inventory_2' : 'receipt_long';
  }

  @HostListener('document:click', ['$event'])
  aoClicarFora(evento: MouseEvent): void {
    if (this.aberto() && !this.host.nativeElement.contains(evento.target as Node)) {
      this.aberto.set(false);
    }
  }
}
