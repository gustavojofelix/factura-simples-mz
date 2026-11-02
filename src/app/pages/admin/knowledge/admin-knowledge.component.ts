import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  KNOWLEDGE_CATEGORIES, KNOWLEDGE_STATUS_LABELS, KnowledgeArticle, KnowledgeArticleInput,
  KnowledgeBaseService, KnowledgeGap, KnowledgeGapStatus, KnowledgeSearchHit, KnowledgeStatus
} from '../../../core/services/knowledge-base.service';
import { AuditLogService } from '../../../core/services/audit-log.service';
import { ToastService } from '../../../core/services/toast.service';
import { ConfirmDialogService } from '../../../core/services/confirm-dialog.service';
import { AiMarkdownPipe } from '../../../shared/components/ai-chat/markdown.pipe';

interface ArticleForm {
  title: string;
  slug: string;
  category: string;
  question_variants: string[];
  body: string;
  legal_reference: string;
  company_id: string | null;
  sort_order: number;
}

@Component({
  selector: 'app-admin-knowledge',
  standalone: true,
  imports: [CommonModule, FormsModule, AiMarkdownPipe],
  template: `
    <div class="space-y-6 max-w-7xl mx-auto pb-12">
      <div class="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h2 class="text-2xl font-bold text-gray-800">Base Fiscal do Assistente</h2>
          <p class="text-sm text-gray-500 mt-1 max-w-3xl">
            O assistente só responde a perguntas fiscais a partir dos artigos <strong>publicados</strong> aqui.
            Um artigo em revisão ou arquivado não chega à IA.
          </p>
        </div>
        <button (click)="startNew()" class="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-semibold">
          + Novo artigo
        </button>
      </div>

      <!-- Separadores -->
      <div class="flex gap-1 border-b border-gray-200">
        <button type="button" (click)="tab.set('artigos')" class="tab" [class.tab-active]="tab() === 'artigos'">
          Artigos <span class="tab-count">{{ articles().length }}</span>
        </button>
        <button type="button" (click)="openGapsTab()" class="tab" [class.tab-active]="tab() === 'perguntas'">
          Perguntas sem resposta
          @if (openGapCount() > 0) { <span class="tab-count bg-amber-100 text-amber-800">{{ openGapCount() }}</span> }
        </button>
      </div>

      @if (tab() === 'artigos') {
        <div class="grid grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)] gap-6">
          <!-- Lista -->
          <section class="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden self-start">
            <div class="p-4 border-b border-gray-100 space-y-2">
              <input type="text" class="input" placeholder="Pesquisar título ou slug…"
                     [ngModel]="search()" (ngModelChange)="search.set($event)">
              <div class="grid grid-cols-2 gap-2">
                <select class="input" [ngModel]="categoryFilter()" (ngModelChange)="categoryFilter.set($event)">
                  <option value="">Todas as categorias</option>
                  @for (c of categories; track c.value) { <option [value]="c.value">{{ c.label }}</option> }
                </select>
                <select class="input" [ngModel]="statusFilter()" (ngModelChange)="statusFilter.set($event)">
                  <option value="">Todos os estados</option>
                  <option value="publicado">Publicados</option>
                  <option value="revisao_pendente">Em revisão</option>
                  <option value="arquivado">Arquivados</option>
                </select>
              </div>
            </div>

            @if (loading()) {
              <div class="p-6 text-sm text-gray-400 text-center">A carregar…</div>
            } @else {
              <div class="divide-y divide-gray-100 max-h-[70vh] overflow-y-auto">
                @for (a of filteredArticles(); track a.id) {
                  <button type="button" (click)="select(a)" class="w-full text-left p-4 hover:bg-gray-50 cursor-pointer"
                          [class.bg-blue-50]="selectedId() === a.id">
                    <div class="flex items-start justify-between gap-2">
                      <span class="font-semibold text-gray-800 text-sm">{{ a.title }}</span>
                      <span class="badge shrink-0" [ngClass]="statusClass(a.status)">{{ statusLabels[a.status] }}</span>
                    </div>
                    <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-400">
                      <span>{{ categoryLabel(a.category) }}</span>
                      <span class="font-mono">{{ a.slug }}</span>
                      @if (a.company_id) {
                        <span class="badge bg-purple-50 text-purple-700">{{ a.company?.name || 'Empresa' }}</span>
                      }
                    </div>
                  </button>
                } @empty {
                  <div class="p-6 text-sm text-gray-400 text-center">Nenhum artigo encontrado.</div>
                }
              </div>
            }
          </section>

          <div class="space-y-6 min-w-0">
            <!-- Editor -->
            <section class="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 class="font-bold text-gray-800 text-lg">{{ selectedId() ? 'Editar artigo' : 'Novo artigo' }}</h3>
                  @if (selected(); as s) {
                    <p class="text-xs text-gray-400 mt-1">
                      <span class="badge" [ngClass]="statusClass(s.status)">{{ statusLabels[s.status] }}</span>
                      · Actualizado {{ s.updated_at | date:'dd/MM/yyyy HH:mm' }}
                      @if (s.reviewed_at) { · Publicado/revisto em {{ s.reviewed_at | date:'dd/MM/yyyy HH:mm' }} }
                    </p>
                  }
                </div>
              </div>

              @if (gapLink(); as g) {
                <div class="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm flex items-start justify-between gap-3">
                  <span>A responder à pergunta <strong>“{{ g.exemplo }}”</strong>. Ao publicar, a pergunta é marcada como resolvida.</span>
                  <button type="button" (click)="gapLink.set(null)" class="text-amber-700 hover:text-amber-900 text-xs font-semibold shrink-0">Desligar</button>
                </div>
              }

              @if (selected()?.status === 'publicado') {
                <div class="p-3 rounded-lg bg-blue-50 border border-blue-100 text-blue-900 text-sm">
                  Este artigo está publicado: guardar alterações muda imediatamente o que a IA responde.
                  Para rever com calma, use <strong>Retirar para revisão</strong>.
                </div>
              }

              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="md:col-span-2">
                  <label class="label">Título (a pergunta a que responde) *</label>
                  <input class="input" [(ngModel)]="form.title" (ngModelChange)="onTitleChange()" placeholder="Ex.: Posso emitir facturas em dólares?">
                </div>
                <div>
                  <label class="label">Slug *</label>
                  <input class="input font-mono" [(ngModel)]="form.slug" (ngModelChange)="slugTouched = true" placeholder="posso-emitir-facturas-em-dolares">
                </div>
                <div>
                  <label class="label">Categoria *</label>
                  <select class="input" [(ngModel)]="form.category">
                    @for (c of categories; track c.value) { <option [value]="c.value">{{ c.label }}</option> }
                  </select>
                </div>
                <div>
                  <label class="label">Referência legal</label>
                  <input class="input" [(ngModel)]="form.legal_reference" placeholder="Ex.: Código do ISPC — artigo 5">
                </div>
                <div class="grid grid-cols-[1fr_110px] gap-3">
                  <div>
                    <label class="label">Âmbito</label>
                    <select class="input" [(ngModel)]="form.company_id">
                      <option [ngValue]="null">Todas as empresas</option>
                      @for (c of companies(); track c.id) { <option [ngValue]="c.id">Só: {{ c.name }}</option> }
                    </select>
                  </div>
                  <div>
                    <label class="label">Ordem</label>
                    <input class="input" type="number" [(ngModel)]="form.sort_order">
                  </div>
                </div>
              </div>

              <!-- Variantes -->
              <div>
                <label class="label">Outras formas de fazer a pergunta</label>
                <p class="text-xs text-gray-400 mb-2">
                  Ajudam a pesquisa a encontrar este artigo. Escreva como um cliente escreveria, e prima Enter.
                </p>
                <div class="flex flex-wrap gap-2 mb-2">
                  @for (v of form.question_variants; track $index) {
                    <span class="inline-flex items-center gap-1 pl-3 pr-1 py-1 rounded-full bg-gray-100 text-gray-700 text-xs">
                      {{ v }}
                      <button type="button" (click)="removeVariant($index)" class="w-5 h-5 rounded-full hover:bg-gray-200 text-gray-500" aria-label="Remover">×</button>
                    </span>
                  }
                </div>
                <input class="input" [(ngModel)]="variantDraft" (keydown.enter)="addVariant($event)"
                       placeholder="Ex.: posso facturar em moeda estrangeira">
              </div>

              <!-- Corpo -->
              <div>
                <div class="flex items-center justify-between mb-1">
                  <label class="label mb-0">Conteúdo (Markdown) *</label>
                  <div class="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-semibold">
                    <button type="button" (click)="bodyView.set('editar')" class="px-3 py-1"
                            [class.bg-gray-800]="bodyView() === 'editar'" [class.text-white]="bodyView() === 'editar'">Editar</button>
                    <button type="button" (click)="bodyView.set('lado')" class="px-3 py-1 hidden lg:block"
                            [class.bg-gray-800]="bodyView() === 'lado'" [class.text-white]="bodyView() === 'lado'">Lado a lado</button>
                    <button type="button" (click)="bodyView.set('ver')" class="px-3 py-1"
                            [class.bg-gray-800]="bodyView() === 'ver'" [class.text-white]="bodyView() === 'ver'">Pré-visualizar</button>
                  </div>
                </div>
                <p class="text-xs text-gray-400 mb-2">
                  Suporta **negrito**, *itálico*, listas com "- ", títulos com "## " e tabelas com "|". A pré-visualização é igual ao que o cliente vê no chat.
                </p>
                <div class="grid gap-3" [class.lg:grid-cols-2]="bodyView() === 'lado'">
                  @if (bodyView() !== 'ver') {
                    <textarea class="input font-mono text-[13px] leading-relaxed min-h-[360px]" [(ngModel)]="form.body"></textarea>
                  }
                  @if (bodyView() !== 'editar') {
                    <div class="kb-preview ai-prose min-h-[360px] max-h-[600px] overflow-y-auto border border-gray-200 rounded-lg p-4 bg-gray-50">
                      @if (form.body.trim()) {
                        <div [innerHTML]="form.body | aiMarkdown"></div>
                      } @else {
                        <span class="text-gray-400 text-sm">Sem conteúdo.</span>
                      }
                      @if (form.legal_reference.trim()) {
                        <p class="mt-3 text-xs text-gray-500 italic">Referência: {{ form.legal_reference }}</p>
                      }
                    </div>
                  }
                </div>
              </div>

              <!-- Acções -->
              <div class="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
                <div class="flex flex-wrap gap-2">
                  @if (selected(); as s) {
                    @if (s.status !== 'arquivado') {
                      <button type="button" (click)="archive()" [disabled]="saving()" class="btn-secondary">Arquivar</button>
                    }
                    @if (s.status !== 'publicado') {
                      <button type="button" (click)="remove()" [disabled]="saving()" class="btn-secondary text-red-600 hover:bg-red-50">Eliminar</button>
                    }
                  }
                </div>
                <div class="flex flex-wrap gap-2">
                  @if (selected()?.status === 'publicado') {
                    <button type="button" (click)="save('revisao_pendente')" [disabled]="saving()" class="btn-secondary">Retirar para revisão</button>
                    <button type="button" (click)="save('publicado')" [disabled]="saving()" class="btn-primary">
                      {{ saving() ? 'A guardar…' : 'Guardar alterações publicadas' }}
                    </button>
                  } @else {
                    <button type="button" (click)="save('revisao_pendente')" [disabled]="saving()" class="btn-secondary">
                      {{ saving() ? 'A guardar…' : 'Guardar em revisão' }}
                    </button>
                    <button type="button" (click)="save('publicado')" [disabled]="saving()" class="btn-primary">Publicar</button>
                  }
                </div>
              </div>
            </section>

            <!-- Testar pergunta -->
            <section class="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
              <div>
                <h3 class="font-bold text-gray-800">Testar pergunta</h3>
                <p class="text-xs text-gray-500 mt-1">
                  Escreva a pergunta como um cliente a faria e veja que artigos o assistente receberia, por ordem de relevância.
                  Só os artigos guardados entram no teste.
                </p>
              </div>
              <div class="flex flex-col md:flex-row gap-2">
                <input class="input flex-1" [(ngModel)]="testQuery" (keydown.enter)="runTest()" placeholder="Ex.: até quando tenho de pagar o imposto?">
                <select class="input md:w-56" [(ngModel)]="testCompanyId">
                  <option [ngValue]="null">Empresa sem FAQ próprio</option>
                  @for (c of companies(); track c.id) { <option [ngValue]="c.id">Como {{ c.name }}</option> }
                </select>
                <button type="button" (click)="runTest()" [disabled]="testing()" class="btn-primary whitespace-nowrap">
                  {{ testing() ? 'A pesquisar…' : 'Testar' }}
                </button>
              </div>
              <label class="text-xs text-gray-600 flex items-center gap-2">
                <input type="checkbox" [(ngModel)]="testIncludeDrafts"> Incluir artigos em revisão (assinalados)
              </label>

              @if (testHits(); as hits) {
                @if (hits.length === 0) {
                  <div class="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
                    Nenhum artigo encontrado — o assistente diria que não tem informação sobre isto.
                  </div>
                } @else {
                  <ol class="divide-y divide-gray-100 border border-gray-100 rounded-lg">
                    @for (h of hits; track h.id; let i = $index) {
                      <li class="p-3 flex items-center justify-between gap-3">
                        <button type="button" class="text-left min-w-0 cursor-pointer" (click)="selectById(h.id)">
                          <span class="text-sm font-semibold text-gray-800">{{ i + 1 }}. {{ h.title }}</span>
                          <span class="block text-xs text-gray-400">
                            {{ categoryLabel(h.category) }} · relevância {{ h.relevancia | number:'1.3-3' }}
                            @if (h.tentativa === 'qualquer_palavra') { · encontrado só por algumas palavras }
                          </span>
                        </button>
                        @if (h.status !== 'publicado') {
                          <span class="badge shrink-0" [ngClass]="statusClass(h.status)">{{ statusLabels[h.status] }}</span>
                        }
                      </li>
                    }
                  </ol>
                  @if (hits[0].tentativa === 'qualquer_palavra') {
                    <p class="text-xs text-amber-700">
                      Nenhum artigo tem todas as palavras da pergunta; os resultados vêm da pesquisa alargada.
                      Acrescentar esta pergunta como variante ao artigo certo melhora a precisão.
                    </p>
                  }
                }
              }
            </section>
          </div>
        </div>
      }

      @if (tab() === 'perguntas') {
        <section class="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div class="p-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
            <p class="text-sm text-gray-500 max-w-3xl">
              Perguntas que os clientes fizeram ao assistente e para as quais nenhum artigo publicado foi encontrado.
              Perguntas iguais (ignorando acentos e maiúsculas) aparecem agrupadas.
            </p>
            <select class="input w-48" [ngModel]="gapStatus()" (ngModelChange)="gapStatus.set($event); loadGaps()">
              <option value="aberta">Por responder</option>
              <option value="resolvida">Resolvidas</option>
              <option value="ignorada">Ignoradas</option>
            </select>
          </div>

          @if (loadingGaps()) {
            <div class="p-6 text-sm text-gray-400 text-center">A carregar…</div>
          } @else {
            <div class="divide-y divide-gray-100">
              @for (g of gaps(); track g.query_norm) {
                <div class="p-4 flex flex-col lg:flex-row lg:items-center gap-3">
                  <div class="flex-1 min-w-0">
                    <p class="font-semibold text-gray-800 text-sm">“{{ g.exemplo }}”</p>
                    <p class="text-xs text-gray-400 mt-1">
                      {{ g.ocorrencias }} {{ g.ocorrencias === 1 ? 'vez' : 'vezes' }}
                      · {{ g.empresas }} {{ g.empresas === 1 ? 'empresa' : 'empresas' }}
                      · última {{ g.ultima | date:'dd/MM/yyyy HH:mm' }}
                    </p>
                    @if (g.variantes.length > 1) {
                      <p class="text-xs text-gray-500 mt-1 truncate" [title]="g.variantes.join(' · ')">
                        Também: {{ g.variantes.join(' · ') }}
                      </p>
                    }
                    @if (g.resolved_article_id && articleTitle(g.resolved_article_id); as t) {
                      <p class="text-xs text-green-700 mt-1">Coberta por: {{ t }}</p>
                    }
                  </div>
                  <div class="flex flex-wrap gap-2 shrink-0">
                    <button type="button" (click)="testGap(g)" class="btn-secondary">Testar</button>
                    @if (gapStatus() === 'aberta') {
                      <select class="input w-56 text-xs" [ngModel]="''" (ngModelChange)="addGapToArticle(g, $event)">
                        <option value="" disabled>Acrescentar a artigo…</option>
                        @for (a of articles(); track a.id) {
                          @if (a.status !== 'arquivado') { <option [value]="a.id">{{ a.title }}</option> }
                        }
                      </select>
                      <button type="button" (click)="createFromGap(g)" class="btn-primary">Criar artigo</button>
                      <button type="button" (click)="setGapStatus(g, 'ignorada')" class="btn-secondary">Ignorar</button>
                    } @else {
                      <button type="button" (click)="setGapStatus(g, 'aberta')" class="btn-secondary">Reabrir</button>
                    }
                  </div>
                </div>
              } @empty {
                <div class="p-8 text-sm text-gray-400 text-center">
                  {{ gapStatus() === 'aberta' ? 'Nenhuma pergunta por responder.' : 'Nada a mostrar.' }}
                </div>
              }
            </div>
          }
        </section>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .label { display: block; font-size: 10px; font-weight: 700; color: #6b7280; text-transform: uppercase; margin-bottom: 5px; }
    .input { width: 100%; padding: 9px 12px; border: 1px solid #e5e7eb; border-radius: 8px; outline: none; font-size: 14px; background: white; }
    .input:focus { border-color: #3b82f6; box-shadow: 0 0 0 2px #dbeafe; }
    .badge { display: inline-block; font-size: 10px; font-weight: 700; text-transform: uppercase; border-radius: 4px; padding: 2px 8px; }
    .tab { padding: 10px 16px; font-size: 14px; font-weight: 600; color: #6b7280; border-bottom: 2px solid transparent; margin-bottom: -1px; display: inline-flex; align-items: center; gap: 8px; }
    .tab:hover { color: #111827; }
    .tab-active { color: #2563eb; border-bottom-color: #2563eb; }
    .tab-count { font-size: 11px; font-weight: 700; padding: 1px 8px; border-radius: 999px; background: #f3f4f6; color: #4b5563; }
    .btn-primary { padding: 8px 16px; border-radius: 8px; background: #2563eb; color: white; font-weight: 600; font-size: 13px; }
    .btn-primary:hover { background: #1d4ed8; }
    .btn-secondary { padding: 8px 14px; border-radius: 8px; border: 1px solid #e5e7eb; color: #374151; font-weight: 600; font-size: 13px; background: white; }
    .btn-secondary:hover { background: #f9fafb; }
    button:disabled { opacity: .5; cursor: not-allowed; }

    /* O HTML do pipe é inserido por innerHTML: os estilos do chat são
       replicados aqui para a pré-visualização ser fiel. */
    .kb-preview { font-size: 13.5px; line-height: 1.55; color: #1e293b; word-break: break-word; }
    .kb-preview ::ng-deep .ai-p { margin: 0 0 8px; }
    .kb-preview ::ng-deep .ai-h { margin: 12px 0 6px; font-size: 13.5px; font-weight: 700; color: #0f172a; }
    .kb-preview ::ng-deep .ai-list { margin: 0 0 8px; padding-left: 18px; list-style: disc; }
    .kb-preview ::ng-deep ol.ai-list { list-style: decimal; }
    .kb-preview ::ng-deep .ai-list li { margin-bottom: 3px; }
    .kb-preview ::ng-deep .ai-code { padding: 1px 5px; border-radius: 5px; background: #f1f5f9; font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
    .kb-preview ::ng-deep .ai-table-wrap { margin: 8px 0; overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 10px; }
    .kb-preview ::ng-deep .ai-table { width: 100%; border-collapse: collapse; font-size: 12px; background: #fff; }
    .kb-preview ::ng-deep .ai-table th { padding: 7px 10px; text-align: left; font-weight: 700; font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; color: #64748b; background: #f8fafc; white-space: nowrap; border-bottom: 1px solid #e2e8f0; }
    .kb-preview ::ng-deep .ai-table td { padding: 7px 10px; color: #334155; border-bottom: 1px solid #f1f5f9; white-space: nowrap; }
  `]
})
export class AdminKnowledgeComponent implements OnInit {
  private kb = inject(KnowledgeBaseService);
  private audit = inject(AuditLogService);
  private toast = inject(ToastService);
  private confirmDialog = inject(ConfirmDialogService);

  readonly categories = KNOWLEDGE_CATEGORIES;
  readonly statusLabels = KNOWLEDGE_STATUS_LABELS;

  tab = signal<'artigos' | 'perguntas'>('artigos');
  articles = signal<KnowledgeArticle[]>([]);
  companies = signal<{ id: string; name: string }[]>([]);
  loading = signal(false);
  saving = signal(false);

  search = signal('');
  categoryFilter = signal('');
  statusFilter = signal('');

  selectedId = signal<string | null>(null);
  selected = computed(() => this.articles().find(a => a.id === this.selectedId()) ?? null);
  form: ArticleForm = this.emptyForm();
  slugTouched = false;
  variantDraft = '';
  bodyView = signal<'editar' | 'lado' | 'ver'>('lado');

  testQuery = '';
  testCompanyId: string | null = null;
  testIncludeDrafts = true;
  testing = signal(false);
  testHits = signal<KnowledgeSearchHit[] | null>(null);

  gaps = signal<KnowledgeGap[]>([]);
  gapStatus = signal<KnowledgeGapStatus>('aberta');
  loadingGaps = signal(false);
  openGapCount = signal(0);
  /** Pergunta sem resposta a que o artigo em edição está a responder. */
  gapLink = signal<KnowledgeGap | null>(null);

  filteredArticles = computed(() => {
    const q = this.normalize(this.search());
    const cat = this.categoryFilter();
    const status = this.statusFilter();
    return this.articles().filter(a =>
      (!cat || a.category === cat) &&
      (!status || a.status === status) &&
      (!q || this.normalize(`${a.title} ${a.slug} ${a.question_variants.join(' ')}`).includes(q)));
  });

  async ngOnInit() {
    await Promise.all([this.load(), this.loadCompanies(), this.loadGaps()]);
  }

  async load() {
    this.loading.set(true);
    try {
      this.articles.set(await this.kb.list());
    } catch (e: any) {
      this.toast.error('Não foi possível carregar os artigos', e?.message);
    } finally {
      this.loading.set(false);
    }
  }

  private async loadCompanies() {
    try {
      this.companies.set(await this.kb.listCompanies());
    } catch {
      // Sem a lista, o âmbito fica limitado a "todas as empresas".
    }
  }

  async loadGaps() {
    this.loadingGaps.set(true);
    try {
      const gaps = await this.kb.listGaps(this.gapStatus());
      this.gaps.set(gaps);
      if (this.gapStatus() === 'aberta') this.openGapCount.set(gaps.length);
    } catch (e: any) {
      this.toast.error('Não foi possível carregar as perguntas', e?.message);
    } finally {
      this.loadingGaps.set(false);
    }
  }

  openGapsTab() {
    this.tab.set('perguntas');
    this.loadGaps();
  }

  // ---------------------------------------------------------------------
  // Editor
  // ---------------------------------------------------------------------

  select(a: KnowledgeArticle) {
    this.selectedId.set(a.id);
    this.form = {
      title: a.title,
      slug: a.slug,
      category: a.category,
      question_variants: [...(a.question_variants || [])],
      body: a.body,
      legal_reference: a.legal_reference || '',
      company_id: a.company_id,
      sort_order: a.sort_order
    };
    this.slugTouched = true;
    this.variantDraft = '';
    if (this.gapLink() && this.gapLink()!.resolved_article_id !== a.id) this.gapLink.set(null);
  }

  selectById(id: string) {
    const a = this.articles().find(x => x.id === id);
    if (a) this.select(a);
  }

  startNew() {
    this.tab.set('artigos');
    this.selectedId.set(null);
    this.form = this.emptyForm();
    this.slugTouched = false;
    this.variantDraft = '';
    this.gapLink.set(null);
  }

  onTitleChange() {
    if (!this.slugTouched) this.form.slug = this.slugify(this.form.title);
  }

  addVariant(event: Event) {
    event.preventDefault();
    const v = this.variantDraft.trim();
    if (v && !this.form.question_variants.some(x => this.normalize(x) === this.normalize(v))) {
      this.form.question_variants = [...this.form.question_variants, v];
    }
    this.variantDraft = '';
  }

  removeVariant(index: number) {
    this.form.question_variants = this.form.question_variants.filter((_, i) => i !== index);
  }

  async save(status: KnowledgeStatus) {
    const title = this.form.title.trim();
    const slug = this.slugify(this.form.slug || title);
    const body = this.form.body.trim();
    if (!title || !slug || !body) {
      this.toast.warning('Campos em falta', 'Título, slug e conteúdo são obrigatórios.');
      return;
    }

    const current = this.selected();
    if (status === 'publicado') {
      const ok = await this.confirmDialog.confirm({
        title: current?.status === 'publicado' ? 'Guardar alterações publicadas' : 'Publicar artigo',
        message: 'A partir de agora o assistente usa este texto para responder aos clientes. Confirma que o conteúdo fiscal foi revisto? O seu nome fica registado como revisor.',
        confirmLabel: current?.status === 'publicado' ? 'Guardar' : 'Publicar'
      });
      if (!ok) return;
    }

    // A variante pendente no campo conta, para não se perder ao gravar.
    if (this.variantDraft.trim()) this.addVariant(new Event('submit'));

    const payload: KnowledgeArticleInput = {
      title,
      slug,
      category: this.form.category,
      question_variants: this.form.question_variants.map(v => v.trim()).filter(Boolean),
      body,
      legal_reference: this.form.legal_reference.trim() || null,
      status,
      company_id: this.form.company_id,
      sort_order: Number(this.form.sort_order) || 0
    };

    this.saving.set(true);
    try {
      const saved = current
        ? await this.kb.update(current.id, payload)
        : await this.kb.create(payload);

      await this.audit.log(
        this.auditAction(current?.status ?? null, status, !current),
        'ai_knowledge',
        { slug: saved.slug, status: saved.status, category: saved.category, company_id: saved.company_id },
        saved.id,
        saved.title
      );

      const gap = this.gapLink();
      if (gap && status === 'publicado') {
        await this.kb.setGapStatus(gap.query_norm, 'resolvida', saved.id);
        this.gapLink.set(null);
        this.loadGaps();
      } else if (gap) {
        // Ainda em revisão: a ligação mantém-se até o artigo ser publicado.
        this.gapLink.set({ ...gap, resolved_article_id: saved.id });
      }

      this.toast.success(status === 'publicado' ? 'Artigo publicado' : 'Artigo guardado em revisão');
      await this.load();
      this.selectById(saved.id);
    } catch (e: any) {
      const msg = e?.code === '23505' ? 'Já existe um artigo com este slug.' : e?.message;
      this.toast.error('Não foi possível guardar o artigo', msg);
    } finally {
      this.saving.set(false);
    }
  }

  async archive() {
    const a = this.selected();
    if (!a) return;
    const ok = await this.confirmDialog.confirm({
      title: 'Arquivar artigo',
      message: `“${a.title}” deixa de ser usado pelo assistente. Pode voltar a publicá-lo mais tarde.`,
      confirmLabel: 'Arquivar',
      danger: true
    });
    if (!ok) return;
    await this.changeStatus(a, 'arquivado', 'Arquivou Artigo da Base Fiscal');
  }

  async remove() {
    const a = this.selected();
    if (!a) return;
    const ok = await this.confirmDialog.confirm({
      title: 'Eliminar artigo',
      message: `Eliminar definitivamente “${a.title}”? Esta acção não pode ser desfeita.`,
      confirmLabel: 'Eliminar',
      danger: true
    });
    if (!ok) return;
    this.saving.set(true);
    try {
      await this.kb.remove(a.id);
      await this.audit.log('Eliminou Artigo da Base Fiscal', 'ai_knowledge', { slug: a.slug, status: a.status }, a.id, a.title);
      this.toast.success('Artigo eliminado');
      this.startNew();
      await this.load();
    } catch (e: any) {
      this.toast.error('Não foi possível eliminar o artigo', e?.message);
    } finally {
      this.saving.set(false);
    }
  }

  private async changeStatus(a: KnowledgeArticle, status: KnowledgeStatus, action: string) {
    this.saving.set(true);
    try {
      await this.kb.update(a.id, { status });
      await this.audit.log(action, 'ai_knowledge', { slug: a.slug, de: a.status, para: status }, a.id, a.title);
      this.toast.success(`Artigo ${this.statusLabels[status].toLowerCase()}`);
      await this.load();
      this.selectById(a.id);
    } catch (e: any) {
      this.toast.error('Não foi possível alterar o estado', e?.message);
    } finally {
      this.saving.set(false);
    }
  }

  // ---------------------------------------------------------------------
  // Testar pergunta
  // ---------------------------------------------------------------------

  async runTest() {
    const q = this.testQuery.trim();
    if (q.length < 2) return;
    this.testing.set(true);
    try {
      this.testHits.set(await this.kb.testSearch(q, this.testIncludeDrafts, this.testCompanyId));
    } catch (e: any) {
      this.toast.error('O teste falhou', e?.message);
    } finally {
      this.testing.set(false);
    }
  }

  // ---------------------------------------------------------------------
  // Perguntas sem resposta
  // ---------------------------------------------------------------------

  testGap(g: KnowledgeGap) {
    this.tab.set('artigos');
    this.testQuery = g.exemplo;
    this.runTest();
  }

  createFromGap(g: KnowledgeGap) {
    this.startNew();
    const title = g.exemplo.trim();
    this.form.title = title.charAt(0).toUpperCase() + title.slice(1);
    this.form.question_variants = g.variantes.filter(v => this.normalize(v) !== this.normalize(title));
    this.onTitleChange();
    this.gapLink.set(g);
    this.testQuery = g.exemplo;
  }

  /** O caso mais comum: o artigo existe, mas a pesquisa não o encontrou com estas palavras. */
  addGapToArticle(g: KnowledgeGap, articleId: string) {
    const a = this.articles().find(x => x.id === articleId);
    if (!a) return;
    this.tab.set('artigos');
    this.select(a);
    const existing = new Set(this.form.question_variants.map(v => this.normalize(v)));
    const novas = g.variantes.filter(v => !existing.has(this.normalize(v)));
    this.form.question_variants = [...this.form.question_variants, ...novas];
    this.gapLink.set({ ...g, resolved_article_id: a.id });
    this.testQuery = g.exemplo;
    this.toast.info('Variante acrescentada', a.status === 'publicado'
      ? 'Reveja e guarde as alterações para a pergunta passar a ser respondida.'
      : 'Reveja e publique o artigo para a pergunta passar a ser respondida.');
  }

  async setGapStatus(g: KnowledgeGap, status: KnowledgeGapStatus) {
    try {
      await this.kb.setGapStatus(g.query_norm, status);
      await this.audit.log(
        status === 'ignorada' ? 'Ignorou Pergunta sem Resposta' : 'Reabriu Pergunta sem Resposta',
        'ai_knowledge', { pergunta: g.exemplo, ocorrencias: g.ocorrencias }, undefined, g.exemplo);
      await this.loadGaps();
      if (status === 'aberta') this.openGapCount.update(n => n + 1);
    } catch (e: any) {
      this.toast.error('Não foi possível actualizar a pergunta', e?.message);
    }
  }

  // ---------------------------------------------------------------------
  // Auxiliares
  // ---------------------------------------------------------------------

  categoryLabel(value: string) {
    return this.categories.find(c => c.value === value)?.label ?? value;
  }

  articleTitle(id: string) {
    return this.articles().find(a => a.id === id)?.title ?? null;
  }

  statusClass(status: KnowledgeStatus) {
    return {
      publicado: 'bg-green-100 text-green-700',
      revisao_pendente: 'bg-amber-100 text-amber-800',
      arquivado: 'bg-gray-100 text-gray-500'
    }[status];
  }

  private auditAction(from: KnowledgeStatus | null, to: KnowledgeStatus, isNew: boolean) {
    if (to === 'publicado' && from !== 'publicado') return 'Publicou Artigo da Base Fiscal';
    if (to === 'revisao_pendente' && from === 'publicado') return 'Retirou Artigo da Base Fiscal para Revisão';
    if (isNew) return 'Criou Artigo da Base Fiscal';
    return 'Actualizou Artigo da Base Fiscal';
  }

  private normalize(s: string) {
    return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  private slugify(s: string) {
    return this.normalize(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  }

  private emptyForm(): ArticleForm {
    return { title: '', slug: '', category: 'ispc', question_variants: [], body: '', legal_reference: '', company_id: null, sort_order: 0 };
  }
}
