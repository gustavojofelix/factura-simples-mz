import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { startWith } from 'rxjs/operators';
import { SupabaseService } from '../../../core/services/supabase.service';
import { SubscriptionService } from '../../../core/services/subscription.service';
import { AuditLogService } from '../../../core/services/audit-log.service';

type PaymentStatus = 'pending' | 'completed' | 'failed' | 'cancelled';
type SortKey = 'date' | 'company' | 'plan' | 'method' | 'status' | 'amount';

interface PaymentTransaction {
  id: string;
  company_id: string;
  company_name: string;
  plan_name: string;
  billing_cycle: string;
  amount: number;
  currency: string;
  payment_method: string;
  phone_number: string;
  reference_code: string;
  status: PaymentStatus;
  sislog_response: Record<string, unknown> | null;
  officegest_document_id?: string | null;
  officegest_document_number?: string | null;
  officegest_synced_at?: string | null;
  created_at: string;
  updated_at: string;
}

interface Subscription { status: string; amount: number; billing_cycle: string; }

@Component({
  selector: 'app-admin-revenue',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <main class="finance-page">
      <!-- Hero -->
      <section class="finance-hero">
        <div>
          <span class="eyebrow"><i></i>Centro de controlo</span>
          <h2>Gestão financeira</h2>
          <p>Acompanhe os pagamentos da plataforma e tome decisões a partir de dados reais.</p>
        </div>
      </section>

      @if (isLoading()) {
        <section class="state-panel">
          <div class="spinner"></div>
          <strong>A sincronizar dados financeiros</strong>
          <span>Estamos a preparar o seu resumo.</span>
        </section>
      } @else if (loadError()) {
        <section class="error-panel">
          <strong>Não foi possível carregar os dados financeiros.</strong>
          <span>{{ loadError() }}</span>
        </section>
      } @else {

        <!-- KPI Cards -->
        <section class="metrics-grid" aria-label="Resumo financeiro">
          <article class="metric-card received">
            <div class="metric-top"><span class="metric-icon">↓</span><span>Receita recebida</span></div>
            <strong>{{ paymentStats().received | currency:'MZN':'symbol':'1.2-2':'pt-MZ' }}</strong>
            <p>Pagamentos concluídos no período selecionado.</p>
          </article>
          <article class="metric-card pending">
            <div class="metric-top"><span class="metric-icon">◷</span><span>Por receber</span></div>
            <strong>{{ paymentStats().pendingAmount | currency:'MZN':'symbol':'1.2-2':'pt-MZ' }}</strong>
            <p>{{ paymentStats().pendingCount }} transação(ões) aguardam confirmação.</p>
          </article>
          <article class="metric-card failed">
            <div class="metric-top"><span class="metric-icon">!</span><span>Por recuperar</span></div>
            <strong>{{ paymentStats().failedAmount | currency:'MZN':'symbol':'1.2-2':'pt-MZ' }}</strong>
            <p>{{ paymentStats().failedCount }} pagamento(s) falhado(s).</p>
          </article>
          <article class="metric-card mrr">
            <div class="metric-top"><span class="metric-icon">↗</span><span>MRR estimado</span></div>
            <strong>{{ mrr() | currency:'MZN':'symbol':'1.2-2':'pt-MZ' }}</strong>
            <p>Previsão mensal · {{ activeSubscriptions() }} subscrição(ões) ativa(s).</p>
          </article>
        </section>

        <!-- ─── FASE 2: Gráfico SVG de receita mensal ─── -->
        <section class="chart-panel" aria-label="Receita mensal">
          <header class="chart-header">
            <div>
              <span class="eyebrow table-eyebrow">Análise temporal</span>
              <h3>Receita mensal</h3>
              <p>Últimos 12 meses · pagamentos concluídos</p>
            </div>
          </header>
          <div class="chart-wrap">
            @if (chartData().max === 0) {
              <div class="chart-empty">Sem dados de receita para o período.</div>
            } @else {
              <div class="bar-chart" role="img" aria-label="Gráfico de barras de receita mensal">
                @for (bar of chartData().bars; track bar.label) {
                  <div class="bar-col">
                    <div class="bar-tooltip">{{ bar.value | currency:'MZN':'symbol':'1.0-0':'pt-MZ' }}</div>
                    <div class="bar-track">
                      <div class="bar-fill"
                        [style.height.%]="chartData().max > 0 ? (bar.value / chartData().max) * 100 : 0"
                        [class.bar-fill--active]="bar.value > 0">
                      </div>
                    </div>
                    <span class="bar-label">{{ bar.label }}</span>
                  </div>
                }
              </div>
            }
          </div>
        </section>

        <!-- ─── Tabela de transacções ─── -->
        <section class="transactions-panel">
          <header class="table-header">
            <div>
              <span class="eyebrow table-eyebrow">Registo financeiro</span>
              <h3>Histórico de transações</h3>
              <p>{{ filteredPayments().length }} resultado(s) · página {{ currentPage() }} de {{ totalPages() }}</p>
            </div>
            <div class="header-actions">
              <!-- Refresh -->
              <button (click)="refresh()" [disabled]="isLoading()" class="refresh-button" title="Actualizar dados" aria-label="Actualizar dados">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                </svg>
              </button>
              <!-- Sync OfficeGest -->
              <button
                (click)="syncWithOfficeGest()"
                [disabled]="isSyncingOfficeGest()"
                class="og-sync-button"
                title="Emitir faturas pendentes no OfficeGest">
                @if (isSyncingOfficeGest()) {
                  <div class="spinner spinner--xs"></div>
                  <span>A emitir…</span>
                } @else {
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
                  </svg>
                  <span>Emitir no OfficeGest</span>
                }
              </button>
              <!-- Export -->
              <button (click)="exportToCSV()" [disabled]="filteredPayments().length === 0" class="export-button">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v12m0 0l4-4m-4 4l-4-4m-5 7v1a2 2 0 002 2h14a2 2 0 002-2v-1"/>
                </svg>
                Exportar resultados
              </button>
            </div>
          </header>

          @if (ogSyncFeedback()) {
            <div class="og-feedback-banner" [class.og-feedback-banner--error]="ogSyncFeedback()!.isError">
              <span>{{ ogSyncFeedback()!.message }}</span>
              <button (click)="ogSyncFeedback.set(null)" class="og-feedback-close">✕</button>
            </div>
          }

          <!-- ─── FASE 1: Filtros expandidos ─── -->
          <div class="filter-toolbar">
            <div class="filter-title">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h18M6 12h12m-9 8h6"/>
              </svg>
              <span>Filtrar transações</span>
            </div>
            <form [formGroup]="filterForm" class="filter-form">
              <!-- Pesquisa textual -->
              <label class="filter-search-label">
                <span>Pesquisar</span>
                <div class="search-input-wrap">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" class="search-icon">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                  </svg>
                  <input type="text" formControlName="search" placeholder="Empresa ou referência…">
                </div>
              </label>
              <!-- Estado -->
              <label>
                <span>Estado</span>
                <select formControlName="status">
                  <option value="">Todos os estados</option>
                  <option value="completed">Concluído</option>
                  <option value="pending">Pendente</option>
                  <option value="failed">Falhado</option>
                  <option value="cancelled">Cancelado</option>
                </select>
              </label>
              <!-- Método -->
              <label>
                <span>Método</span>
                <select formControlName="paymentMethod">
                  <option value="">Todos os métodos</option>
                  @for (method of paymentMethods(); track method) {
                    <option [value]="method">{{ paymentMethodLabel(method) }}</option>
                  }
                </select>
              </label>
              <!-- Plano -->
              <label>
                <span>Plano</span>
                <select formControlName="plan">
                  <option value="">Todos os planos</option>
                  @for (plan of availablePlans(); track plan) {
                    <option [value]="plan">{{ plan }}</option>
                  }
                </select>
              </label>
              <!-- Datas -->
              <label>
                <span>De</span>
                <input type="date" formControlName="startDate">
              </label>
              <label>
                <span>Até</span>
                <input type="date" formControlName="endDate">
              </label>
              <button type="button" (click)="clearFilters()" class="clear-button">Limpar</button>
            </form>
          </div>

          <!-- Tabela -->
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th [attr.aria-sort]="ariaSort('date')"><button (click)="setSort('date')">Data <span>{{ sortIcon('date') }}</span></button></th>
                  <th [attr.aria-sort]="ariaSort('company')"><button (click)="setSort('company')">Empresa <span>{{ sortIcon('company') }}</span></button></th>
                  <th [attr.aria-sort]="ariaSort('plan')"><button (click)="setSort('plan')">Plano <span>{{ sortIcon('plan') }}</span></button></th>
                  <th [attr.aria-sort]="ariaSort('method')"><button (click)="setSort('method')">Método / referência <span>{{ sortIcon('method') }}</span></button></th>
                  <th [attr.aria-sort]="ariaSort('status')"><button (click)="setSort('status')">Estado <span>{{ sortIcon('status') }}</span></button></th>
                  <th [attr.aria-sort]="ariaSort('amount')" class="amount-cell"><button (click)="setSort('amount')">Valor <span>{{ sortIcon('amount') }}</span></button></th>
                </tr>
              </thead>
              <tbody>
                @for (payment of paginatedPayments(); track payment.id) {
                  <tr (click)="selectPayment(payment)" class="clickable-row" [class.row-selected]="selectedPayment()?.id === payment.id">
                    <td class="date-cell">{{ payment.created_at | date:'dd/MM/yyyy, HH:mm' }}</td>
                    <td><strong class="company-name">{{ payment.company_name }}</strong></td>
                    <td>
                      <div class="plan-cell">
                        <strong>{{ payment.plan_name }}</strong>
                        <span>{{ payment.billing_cycle }}</span>
                      </div>
                    </td>
                    <td>
                      <div class="payment-cell">
                        <strong>{{ paymentMethodLabel(payment.payment_method) }}</strong>
                        <span>{{ payment.reference_code }}</span>
                      </div>
                    </td>
                    <td>
                      <div class="status-col">
                        <span [class]="getStatusClass(payment.status)" class="status-badge"><i></i>{{ statusLabel(payment.status) }}</span>
                        @if (payment.officegest_document_number) {
                          <span class="og-badge" title="Fatura emitida no OfficeGest">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                            </svg>
                            {{ payment.officegest_document_number }}
                          </span>
                        }
                      </div>
                    </td>
                    <td class="amount-cell"><strong>{{ payment.amount | currency:payment.currency:'symbol':'1.2-2':'pt-MZ' }}</strong></td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="6">
                      <div class="empty-state">
                        <strong>Sem transações</strong>
                        <p>Não foram encontrados pagamentos com os filtros selecionados.</p>
                        <button type="button" (click)="clearFilters()">Limpar filtros</button>
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          <!-- Paginação -->
          @if (filteredPayments().length > 0) {
            <footer class="pagination">
              <div>
                <span>Mostrar</span>
                <select [value]="pageSize()" (change)="changePageSize($any($event.target).value)">
                  <option value="10">10</option>
                  <option value="25">25</option>
                  <option value="50">50</option>
                </select>
                <span>por página</span>
              </div>
              <div class="pagination-controls">
                <button (click)="setPage(currentPage() - 1)" [disabled]="currentPage() === 1" aria-label="Página anterior">←</button>
                <span>Página <strong>{{ currentPage() }}</strong> de {{ totalPages() }}</span>
                <button (click)="setPage(currentPage() + 1)" [disabled]="currentPage() === totalPages()" aria-label="Próxima página">→</button>
              </div>
            </footer>
          }
        </section>

        <!-- ─── FASE 3 + 4: Painel de detalhe / drawer ─── -->
        @if (selectedPayment()) {
          <div class="drawer-overlay" (click)="closeDrawer()"></div>
          <aside class="detail-drawer" role="dialog" aria-modal="true" aria-label="Detalhe da transação">
            <header class="drawer-header">
              <div>
                <span class="eyebrow">Transação</span>
                <h3>{{ selectedPayment()!.company_name }}</h3>
              </div>
              <button class="drawer-close" (click)="closeDrawer()" aria-label="Fechar painel">✕</button>
            </header>

            <div class="drawer-body">
              <!-- Estado + Valor -->
              <div class="drawer-hero">
                <span [class]="getStatusClass(selectedPayment()!.status)" class="status-badge status-badge--lg"><i></i>{{ statusLabel(selectedPayment()!.status) }}</span>
                <strong class="drawer-amount">{{ selectedPayment()!.amount | currency:selectedPayment()!.currency:'symbol':'1.2-2':'pt-MZ' }}</strong>
              </div>

              <!-- Dados principais -->
              <dl class="drawer-dl">
                <dt>Plano</dt>
                <dd>{{ selectedPayment()!.plan_name }} · {{ selectedPayment()!.billing_cycle }}</dd>

                <dt>Método de pagamento</dt>
                <dd>{{ paymentMethodLabel(selectedPayment()!.payment_method) }}</dd>

                <dt>Número de telefone</dt>
                <dd class="mono">{{ selectedPayment()!.phone_number || '—' }}</dd>

                <dt>Código de referência</dt>
                <dd class="mono">{{ selectedPayment()!.reference_code }}</dd>

                <dt>Criado em</dt>
                <dd>{{ selectedPayment()!.created_at | date:'dd/MM/yyyy, HH:mm:ss' }}</dd>

                <dt>Actualizado em</dt>
                <dd>{{ selectedPayment()!.updated_at | date:'dd/MM/yyyy, HH:mm:ss' }}</dd>

                <dt>Fatura OfficeGest</dt>
                <dd>
                  @if (selectedPayment()!.officegest_document_number) {
                    <span class="og-badge og-badge--drawer">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                      </svg>
                      {{ selectedPayment()!.officegest_document_number }}
                    </span>
                    @if (selectedPayment()!.officegest_synced_at) {
                      <small class="og-sync-time">Emitida em {{ selectedPayment()!.officegest_synced_at | date:'dd/MM/yyyy, HH:mm' }}</small>
                    }
                  } @else {
                    <span class="text-gray-400 font-medium">Ainda não emitida</span>
                  }
                </dd>
              </dl>

              <!-- Resposta Sislog -->
              <div class="drawer-section">
                <span class="drawer-section-label">Resposta Sislog</span>
                <pre class="sislog-pre">{{ formatSislog(selectedPayment()!.sislog_response) }}</pre>
              </div>

              <!-- ─── FASE 4: Acções ─── -->
              @if (selectedPayment()!.status === 'pending' || selectedPayment()!.status === 'failed' || (selectedPayment()!.status === 'completed' && !selectedPayment()!.officegest_document_id)) {
                <div class="drawer-actions">
                  @if (actionLoading()) {
                    <div class="action-loading">
                      <div class="spinner spinner--sm"></div>
                      <span>A processar…</span>
                    </div>
                  } @else {
                    @if (selectedPayment()!.status === 'pending') {
                      <button class="action-btn action-btn--confirm" (click)="confirmPayment(selectedPayment()!)">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
                        </svg>
                        Confirmar pagamento
                      </button>
                    }
                    @if (selectedPayment()!.status === 'completed' && !selectedPayment()!.officegest_document_id) {
                      <button class="action-btn action-btn--og" (click)="syncSingleWithOfficeGest(selectedPayment()!)">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
                        </svg>
                        Emitir fatura no OfficeGest
                      </button>
                    }
                    @if (selectedPayment()!.status === 'pending' || selectedPayment()!.status === 'failed') {
                      <button class="action-btn action-btn--cancel" (click)="cancelPayment(selectedPayment()!)">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                        </svg>
                        Cancelar transação
                      </button>
                    }
                  }

                  @if (actionError()) {
                    <p class="action-error">{{ actionError() }}</p>
                  }
                  @if (actionSuccess()) {
                    <p class="action-success">{{ actionSuccess() }}</p>
                  }
                </div>
              }
            </div>
          </aside>
        }

      }
    </main>
  `,
  styles: [`
    /* ── Layout ── */
    .finance-page{min-height:100%;padding:28px;background:#f5f7fb;color:#172033}

    /* ── Hero ── */
    .finance-hero{padding:29px 32px;border-radius:18px;background:linear-gradient(116deg,#102a5f,#1b4fa3 58%,#2772cf);color:#fff;box-shadow:0 18px 38px rgba(29,78,153,.16)}
    .finance-hero h2{margin:7px 0;font-size:29px;line-height:1.1;letter-spacing:-.03em;font-weight:750}
    .finance-hero p{margin:0;color:#d8e7ff}
    .eyebrow{display:flex;align-items:center;gap:7px;font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}
    .eyebrow i{width:7px;height:7px;border-radius:50%;background:#6ee7b7;box-shadow:0 0 0 4px rgba(110,231,183,.15)}

    /* ── KPI Cards ── */
    .metrics-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin-top:22px}
    .metric-card{min-height:148px;padding:18px;border:1px solid #e8edf5;border-radius:16px;background:#fff;box-shadow:0 5px 18px rgba(30,41,59,.04);overflow:hidden;position:relative}
    .metric-card:after{position:absolute;right:-23px;bottom:-31px;width:99px;height:99px;border-radius:50%;content:'';opacity:.7}
    .metric-top{display:flex;align-items:center;gap:9px;color:#728097;font-size:10px;font-weight:800;letter-spacing:.09em;text-transform:uppercase}
    .metric-icon{display:grid;place-items:center;width:30px;height:30px;border-radius:9px;font-size:17px;font-weight:900}
    .metric-card>strong{display:block;margin-top:17px;color:#172033;font-size:22px;line-height:1.1;letter-spacing:-.03em}
    .metric-card p{position:relative;margin:9px 0 0;color:#77859a;font-size:11px;line-height:1.35}
    .received .metric-icon{color:#159264;background:#eafaf3}.received:after{background:#e5f8ef}
    .pending .metric-icon{color:#c88613;background:#fff7df}.pending:after{background:#fff3d4}
    .failed .metric-icon{color:#db5050;background:#fff0f0}.failed:after{background:#ffe6e6}
    .mrr .metric-icon{color:#3d6fd1;background:#edf3ff}.mrr:after{background:#e7efff}

    /* ── Chart ── */
    .chart-panel{margin-top:22px;overflow:hidden;border:1px solid #e8edf5;border-radius:16px;background:#fff;box-shadow:0 5px 18px rgba(30,41,59,.04)}
    .chart-header{padding:23px 24px 16px;border-bottom:1px solid #edf0f4}
    .chart-header h3{margin:6px 0 3px;font-size:18px;letter-spacing:-.02em}
    .chart-header p{margin:0;color:#8491a5;font-size:12px}
    .chart-wrap{padding:20px 24px 10px}
    .chart-empty{padding:40px 0;text-align:center;color:#9eaabb;font-size:13px}
    .bar-chart{display:flex;align-items:flex-end;gap:8px;height:160px;padding-top:12px}
    .bar-col{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;height:100%;position:relative}
    .bar-col:hover .bar-tooltip{opacity:1;transform:translateX(-50%) translateY(0)}
    .bar-tooltip{position:absolute;top:0;left:50%;transform:translateX(-50%) translateY(-4px);background:#172033;color:#fff;font-size:10px;font-weight:700;padding:4px 8px;border-radius:6px;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .15s,transform .15s;z-index:10}
    .bar-tooltip:after{content:'';position:absolute;top:100%;left:50%;transform:translateX(-50%);border:4px solid transparent;border-top-color:#172033}
    .bar-track{flex:1;width:100%;position:relative;background:#f0f4fb;border-radius:6px 6px 0 0;overflow:hidden;min-height:4px}
    .bar-fill{position:absolute;bottom:0;left:0;right:0;background:#dbe9f7;border-radius:6px 6px 0 0;transition:height .4s cubic-bezier(.4,0,.2,1)}
    .bar-fill--active{background:linear-gradient(180deg,#60a5fa,#1d4ed8)}
    .bar-label{flex-shrink:0;font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#9eaabb;white-space:nowrap;padding-bottom:2px}

    /* ── Transactions Panel ── */
    .transactions-panel{margin-top:22px;overflow:hidden;border:1px solid #e8edf5;border-radius:16px;background:#fff;box-shadow:0 5px 18px rgba(30,41,59,.04)}
    .table-header{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:23px 24px 19px}
    .table-eyebrow{color:#4679c8}
    .table-header h3{margin:6px 0 3px;font-size:18px;letter-spacing:-.02em}
    .table-header p{margin:0;color:#8491a5;font-size:12px}
    .header-actions{display:flex;align-items:center;gap:8px;flex-shrink:0}
    .export-button{display:flex;align-items:center;gap:8px;border:0;border-radius:9px;padding:10px 14px;background:#2165c4;color:#fff;font-size:12px;font-weight:750;box-shadow:0 4px 12px rgba(33,101,196,.2);transition:.15s;cursor:pointer}
    .export-button:hover:not(:disabled){background:#174e9b}
    .export-button:disabled{cursor:not-allowed;opacity:.45}
    .export-button svg{width:16px;height:16px}
    .refresh-button{display:grid;place-items:center;width:38px;height:38px;border:1px solid #e1e7f0;border-radius:9px;background:#fff;color:#4679c8;cursor:pointer;transition:.15s}
    .refresh-button:hover:not(:disabled){background:#f0f6ff;border-color:#c3d9f5}
    .refresh-button:disabled{opacity:.45;cursor:not-allowed}
    .refresh-button svg{width:16px;height:16px}
    .og-sync-button{display:flex;align-items:center;gap:7px;border:1px solid #c7d9f8;border-radius:9px;padding:9px 13px;background:#f0f6ff;color:#1e5bb8;font-size:12px;font-weight:750;transition:.15s;cursor:pointer}
    .og-sync-button:hover:not(:disabled){background:#e1eeff;border-color:#9ebbfa;color:#124494}
    .og-sync-button:disabled{cursor:not-allowed;opacity:.55}
    .og-sync-button svg{width:15px;height:15px}
    .spinner--xs{width:14px;height:14px;border-width:2px}
    .og-feedback-banner{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 24px;background:#ecfdf5;border-bottom:1px solid #a7f3d0;color:#065f46;font-size:12px;font-weight:600}
    .og-feedback-banner--error{background:#fef2f2;border-bottom-color:#fecaca;color:#991b1b}
    .og-feedback-close{border:none;background:transparent;color:inherit;font-size:13px;cursor:pointer;opacity:.6}
    .og-feedback-close:hover{opacity:1}
    .status-col{display:flex;flex-direction:column;gap:4px;align-items:flex-start}
    .og-badge{display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:700;color:#1e40af;background:#eff6ff;border:1px solid #bfdbfe;border-radius:5px;padding:1px 6px;white-space:nowrap}
    .og-badge svg{width:11px;height:11px;color:#2563eb}
    .og-badge--drawer{font-size:11px;padding:3px 8px}
    .og-sync-time{display:block;color:#94a3b8;font-size:10px;margin-top:2px}
    .action-btn--og{background:#1e5bb8;color:#fff}
    .action-btn--og:hover{background:#154796}

    /* ── Filter Toolbar ── */
    .filter-toolbar{display:flex;align-items:end;gap:19px;padding:15px 24px 18px;border-top:1px solid #edf0f4;border-bottom:1px solid #edf0f4;background:#fbfcfe}
    .filter-title{display:flex;align-items:center;gap:8px;min-width:126px;color:#4b5b73;font-size:11px;font-weight:800}
    .filter-title svg{width:17px;color:#3b74c4}
    .filter-form{display:grid;grid-template-columns:1.6fr 1fr 1fr 1fr .8fr .8fr auto;gap:9px;align-items:end;width:100%}
    .filter-form label span{display:block;margin:0 0 5px 2px;color:#8491a5;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
    .filter-search-label{position:relative}
    .search-input-wrap{position:relative}
    .search-icon{position:absolute;left:9px;top:50%;transform:translateY(-50%);width:13px;height:13px;color:#9eaabb;pointer-events:none}
    .filter-form select,.filter-form input{box-sizing:border-box;width:100%;height:36px;border:1px solid #e1e7f0;border-radius:8px;background:#fff;padding:0 9px;color:#34425a;font-size:12px;outline:none;transition:.15s}
    .search-input-wrap input{padding-left:30px}
    .filter-form select:focus,.filter-form input:focus{border-color:#3d7dd3;box-shadow:0 0 0 3px #dceaff}
    .clear-button{height:36px;padding:0 12px;border:1px solid #e1e7f0;border-radius:8px;background:#fff;color:#63728a;font-size:12px;font-weight:700;cursor:pointer}
    .clear-button:hover{border-color:#f2c7c7;color:#c24141}

    /* ── Table ── */
    .table-wrap{overflow:auto}
    .transactions-panel table{width:100%;border-collapse:collapse;min-width:860px}
    .transactions-panel th{padding:0;background:#fbfcfe;text-align:left}
    .transactions-panel th button{display:flex;align-items:center;gap:5px;width:100%;padding:12px 24px;border:0;background:none;color:#8a96aa;font-size:10px;font-weight:800;letter-spacing:.08em;text-align:left;text-transform:uppercase;cursor:pointer}
    .transactions-panel th button:hover{color:#326cbd}
    .transactions-panel th button span{font-size:12px;letter-spacing:0}
    .transactions-panel td{padding:16px 24px;border-top:1px solid #eff2f6;color:#44526a;font-size:12px}
    .clickable-row{cursor:pointer;transition:background .1s}
    .transactions-panel tbody tr.clickable-row:hover{background:#f4f8ff}
    .row-selected{background:#edf4ff!important}
    .date-cell{white-space:nowrap;color:#63728a!important}
    .company-name{color:#26344c}
    .plan-cell,.payment-cell{display:flex;flex-direction:column;gap:3px}
    .plan-cell strong,.payment-cell strong{color:#34425a;font-weight:700}
    .plan-cell span{color:#8b97a9;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}
    .payment-cell span{max-width:145px;overflow:hidden;color:#92a0b3;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;text-overflow:ellipsis;white-space:nowrap}
    .status-badge{display:inline-flex;align-items:center;gap:6px;border-radius:20px;padding:5px 9px;font-size:10px;font-weight:800;letter-spacing:.03em}
    .status-badge i{width:5px;height:5px;border-radius:50%;background:currentColor}
    .status-badge--lg{font-size:12px;padding:7px 13px}
    .amount-cell{text-align:right!important;white-space:nowrap}
    .amount-cell button{justify-content:flex-end;text-align:right!important}
    .amount-cell strong{color:#1f2d45}

    /* ── Pagination ── */
    .pagination{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 24px;border-top:1px solid #edf0f4;color:#7b899d;font-size:12px}
    .pagination>div{display:flex;align-items:center;gap:8px}
    .pagination select{height:31px;border:1px solid #dfe6ef;border-radius:7px;background:#fff;padding:0 6px;color:#4c5a71}
    .pagination-controls button{display:grid;place-items:center;width:31px;height:31px;border:1px solid #dfe6ef;border-radius:7px;background:#fff;color:#356cbc;font-size:16px;font-weight:700;cursor:pointer}
    .pagination-controls button:disabled{cursor:not-allowed;color:#b4bfce}

    /* ── Empty / State ── */
    .empty-state{padding:46px 20px;text-align:center}
    .empty-state strong{color:#41506a;font-size:14px}
    .empty-state p{margin:6px 0 14px;color:#8491a5}
    .empty-state button{border:0;background:none;color:#2e6ec1;font-size:12px;font-weight:700;cursor:pointer}
    .state-panel,.error-panel{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;margin-top:22px;min-height:270px;border:1px solid #e8edf5;border-radius:16px;background:#fff;color:#45536b}
    .state-panel span{font-size:12px;color:#8a96a9}
    .spinner{width:34px;height:34px;margin-bottom:7px;border:3px solid #dbeafe;border-top-color:#2d70c5;border-radius:50%;animation:spin .8s linear infinite}
    .spinner--sm{width:18px;height:18px;margin-bottom:0;border-width:2px}
    .error-panel{min-height:0;align-items:flex-start;padding:20px;border-color:#f5cccc;background:#fff8f8;color:#b83c3c}
    .error-panel span{font-size:12px}

    /* ── Detail Drawer ── */
    .drawer-overlay{position:fixed;inset:0;background:rgba(10,20,40,.35);z-index:40;animation:fade-in .15s ease}
    .detail-drawer{position:fixed;top:0;right:0;bottom:0;width:420px;max-width:95vw;background:#fff;box-shadow:-12px 0 40px rgba(10,20,40,.14);z-index:50;display:flex;flex-direction:column;animation:slide-in .2s ease}
    .drawer-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:24px 24px 18px;border-bottom:1px solid #edf0f4}
    .drawer-header h3{margin:5px 0 0;font-size:17px;letter-spacing:-.02em;color:#172033}
    .drawer-close{display:grid;place-items:center;width:34px;height:34px;border:1px solid #e1e7f0;border-radius:8px;background:#fff;color:#63728a;font-size:14px;cursor:pointer;flex-shrink:0;transition:.15s}
    .drawer-close:hover{background:#f7f9fc;border-color:#d0d9e5}
    .drawer-body{flex:1;overflow-y:auto;padding:20px 24px 32px;display:flex;flex-direction:column;gap:20px}
    .drawer-hero{display:flex;align-items:center;justify-content:space-between}
    .drawer-amount{font-size:22px;font-weight:800;letter-spacing:-.03em;color:#172033}
    .drawer-dl{display:grid;grid-template-columns:auto 1fr;gap:8px 16px;margin:0;font-size:13px}
    .drawer-dl dt{color:#8491a5;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.07em;white-space:nowrap;padding-top:1px}
    .drawer-dl dd{margin:0;color:#2c3a50;font-weight:500}
    .drawer-dl dd.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:#415069}
    .drawer-section{display:flex;flex-direction:column;gap:7px}
    .drawer-section-label{font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#8491a5}
    .sislog-pre{margin:0;padding:12px;border:1px solid #e8edf5;border-radius:10px;background:#f8fafb;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;line-height:1.6;color:#415069;overflow:auto;max-height:200px;white-space:pre-wrap;word-break:break-all}
    .drawer-actions{display:flex;flex-direction:column;gap:10px;padding-top:4px;border-top:1px solid #edf0f4}
    .action-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:11px;border:0;border-radius:10px;font-size:13px;font-weight:750;cursor:pointer;transition:.15s}
    .action-btn svg{width:16px;height:16px}
    .action-btn--confirm{background:#e8f8f0;color:#14795a}
    .action-btn--confirm:hover{background:#d0f4e3}
    .action-btn--cancel{background:#fff0f0;color:#b83c3c}
    .action-btn--cancel:hover{background:#ffe0e0}
    .action-loading{display:flex;align-items:center;justify-content:center;gap:10px;padding:11px;color:#63728a;font-size:13px}
    .action-error{margin:0;padding:10px;border-radius:8px;background:#fff0f0;color:#b83c3c;font-size:12px}
    .action-success{margin:0;padding:10px;border-radius:8px;background:#e8f8f0;color:#14795a;font-size:12px;font-weight:600}

    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes fade-in{from{opacity:0}to{opacity:1}}
    @keyframes slide-in{from{transform:translateX(100%)}to{transform:translateX(0)}}

    /* ── Responsive ── */
    @media(max-width:1100px){
      .metrics-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
      .filter-toolbar{align-items:flex-start;flex-direction:column}
      .filter-form{grid-template-columns:repeat(3,1fr)}
      .filter-form .clear-button{grid-column:span 3}
    }
    @media(max-width:640px){
      .finance-page{padding:16px}
      .finance-hero{padding:23px}
      .finance-hero h2{font-size:25px}
      .metrics-grid{grid-template-columns:1fr}
      .chart-panel{display:none}
      .table-header{align-items:flex-start;flex-direction:column;padding:19px}
      .header-actions{width:100%}
      .export-button{flex:1;justify-content:center}
      .filter-toolbar{padding:15px 16px}
      .filter-form{grid-template-columns:1fr 1fr}
      .filter-form .clear-button{grid-column:span 2}
      .pagination{align-items:flex-start;flex-direction:column;padding:14px 16px}
      .detail-drawer{width:100%;top:auto;border-radius:16px 16px 0 0}
    }
  `]
})
export class AdminRevenueComponent implements OnInit {
  private supabase = inject(SupabaseService);
  private fb = inject(FormBuilder);
  private subscriptionService = inject(SubscriptionService);
  private auditLogService = inject(AuditLogService);

  // ── Data signals ──
  private allPayments = signal<PaymentTransaction[]>([]);
  private subscriptions = signal<Subscription[]>([]);

  // ── UI state ──
  isLoading = signal(false);
  loadError = signal('');
  currentPage = signal(1);
  pageSize = signal(10);
  sortKey = signal<SortKey>('date');
  sortDirection = signal<'asc' | 'desc'>('desc');

  // ── Fase 3/4: Drawer ──
  selectedPayment = signal<PaymentTransaction | null>(null);
  actionLoading = signal(false);
  actionError = signal('');
  actionSuccess = signal('');

  // ── OfficeGest Sync state ──
  isSyncingOfficeGest = signal(false);
  ogSyncFeedback = signal<{ message: string; isError: boolean } | null>(null);

  // ── Filter form (Fase 1: added search + plan) ──
  filterForm: FormGroup = this.fb.group({
    search: [''],
    status: [''],
    paymentMethod: [''],
    plan: [''],
    startDate: [''],
    endDate: ['']
  });

  private filters = toSignal(
    this.filterForm.valueChanges.pipe(startWith(this.filterForm.value)),
    { initialValue: this.filterForm.value }
  );

  // ── Computed: unique values for filter dropdowns ──
  paymentMethods = computed(() =>
    [...new Set(this.allPayments().map(p => p.payment_method).filter(Boolean))].sort()
  );

  // Fase 1: dynamic plan list
  availablePlans = computed(() =>
    [...new Set(this.allPayments().map(p => p.plan_name).filter(Boolean))].sort()
  );

  // ── Computed: filtered payments (Fase 1: includes search + plan filter) ──
  filteredPayments = computed(() => {
    const f = this.filters();
    const searchTerm = (f.search ?? '').toLowerCase().trim();
    return this.allPayments().filter(p => {
      if (f.status && p.status !== f.status) return false;
      if (f.paymentMethod && p.payment_method !== f.paymentMethod) return false;
      if (f.plan && p.plan_name !== f.plan) return false;
      const date = new Date(p.created_at);
      if (f.startDate && date < new Date(`${f.startDate}T00:00:00`)) return false;
      if (f.endDate && date > new Date(`${f.endDate}T23:59:59.999`)) return false;
      if (searchTerm) {
        const inCompany = p.company_name.toLowerCase().includes(searchTerm);
        const inRef = p.reference_code.toLowerCase().includes(searchTerm);
        if (!inCompany && !inRef) return false;
      }
      return true;
    });
  });

  sortedPayments = computed(() => {
    const key = this.sortKey();
    const dir = this.sortDirection() === 'asc' ? 1 : -1;
    return [...this.filteredPayments()].sort((a, b) => {
      const vals: Record<SortKey, [string | number, string | number]> = {
        date: [new Date(a.created_at).getTime(), new Date(b.created_at).getTime()],
        company: [a.company_name, b.company_name],
        plan: [a.plan_name, b.plan_name],
        method: [a.payment_method, b.payment_method],
        status: [a.status, b.status],
        amount: [a.amount, b.amount]
      };
      const [first, second] = vals[key];
      return typeof first === 'number' && typeof second === 'number'
        ? (first - second) * dir
        : String(first).localeCompare(String(second), 'pt') * dir;
    });
  });

  totalPages = computed(() => Math.max(1, Math.ceil(this.sortedPayments().length / this.pageSize())));
  paginatedPayments = computed(() => {
    const page = Math.min(this.currentPage(), this.totalPages());
    const start = (page - 1) * this.pageSize();
    return this.sortedPayments().slice(start, start + this.pageSize());
  });

  paymentStats = computed(() =>
    this.filteredPayments().reduce((s, p) => {
      const amount = Number(p.amount) || 0;
      if (p.status === 'completed') s.received += amount;
      if (p.status === 'pending') { s.pendingCount++; s.pendingAmount += amount; }
      if (p.status === 'failed') { s.failedCount++; s.failedAmount += amount; }
      return s;
    }, { received: 0, pendingAmount: 0, pendingCount: 0, failedAmount: 0, failedCount: 0 })
  );

  activeSubscriptions = computed(() =>
    this.subscriptions().filter(s => s.status === 'active').length
  );

  mrr = computed(() =>
    this.subscriptions()
      .filter(s => s.status === 'active')
      .reduce((total, s) => {
        const divisor = s.billing_cycle === 'yearly' ? 12
          : s.billing_cycle === 'semiannual' ? 6
          : s.billing_cycle === 'quarterly' ? 3 : 1;
        return total + (Number(s.amount) || 0) / divisor;
      }, 0)
  );

  // ── Fase 2: Chart data (last 12 months, completed payments) ──
  chartData = computed(() => {
    const months: { label: string; value: number }[] = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = d.getFullYear();
      const month = d.getMonth();
      const label = d.toLocaleString('pt-MZ', { month: 'short' }).replace('.', '');
      const value = this.allPayments()
        .filter(p => {
          if (p.status !== 'completed') return false;
          const pd = new Date(p.created_at);
          return pd.getFullYear() === year && pd.getMonth() === month;
        })
        .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
      months.push({ label, value });
    }
    const max = Math.max(...months.map(m => m.value), 0);
    return { bars: months, max };
  });

  ngOnInit() {
    this.filterForm.valueChanges.subscribe(() => this.currentPage.set(1));
    this.loadFinancialData();
  }

  async loadFinancialData() {
    this.isLoading.set(true);
    this.loadError.set('');
    try {
      const [payments, subs] = await Promise.all([
        this.supabase.db
          .from('subscription_payments')
          .select('*, companies(name)')
          .order('created_at', { ascending: false }),
        this.supabase.db
          .from('subscriptions')
          .select('status, amount, billing_cycle')
      ]);
      if (payments.error) throw payments.error;
      if (subs.error) throw subs.error;

      this.allPayments.set(
        (payments.data ?? []).map((p: any) => ({
          ...p,
          amount: Number(p.amount) || 0,
          company_name: p.companies?.name ?? 'Empresa não disponível',
          phone_number: p.phone_number ?? '',
          sislog_response: p.sislog_response ?? null,
          officegest_document_id: p.officegest_document_id ?? null,
          officegest_document_number: p.officegest_document_number ?? null,
          officegest_synced_at: p.officegest_synced_at ?? null,
          updated_at: p.updated_at ?? p.created_at
        }))
      );
      this.subscriptions.set(
        (subs.data ?? []).map((s: any) => ({ ...s, amount: Number(s.amount) || 0 }))
      );
    } catch (error: any) {
      console.error('Erro ao carregar dados financeiros:', error);
      this.loadError.set(error?.message || 'Tente actualizar a página.');
    } finally {
      this.isLoading.set(false);
    }
  }

  // ── Fase 1: Refresh button ──
  refresh() { this.loadFinancialData(); }

  // ── Sort ──
  setSort(key: SortKey) {
    this.sortDirection.set(this.sortKey() === key && this.sortDirection() === 'asc' ? 'desc' : 'asc');
    this.sortKey.set(key);
    this.currentPage.set(1);
  }
  sortIcon(key: SortKey) { return this.sortKey() !== key ? '↕' : this.sortDirection() === 'asc' ? '↑' : '↓'; }
  ariaSort(key: SortKey) { return this.sortKey() !== key ? 'none' : this.sortDirection() === 'asc' ? 'ascending' : 'descending'; }

  // ── Pagination ──
  setPage(page: number) { this.currentPage.set(Math.max(1, Math.min(page, this.totalPages()))); }
  changePageSize(size: string) { this.pageSize.set(Number(size)); this.currentPage.set(1); }

  // ── Filters ──
  clearFilters() {
    this.filterForm.reset({ search: '', status: '', paymentMethod: '', plan: '', startDate: '', endDate: '' });
  }

  // ── Labels ──
  paymentMethodLabel(method: string) {
    return ({ mpesa: 'M-Pesa', emola: 'e-Mola' } as Record<string, string>)[method] ?? method ?? 'Não definido';
  }
  statusLabel(status: PaymentStatus) {
    return ({ completed: 'Concluído', pending: 'Pendente', failed: 'Falhado', cancelled: 'Cancelado' } as Record<PaymentStatus, string>)[status] ?? status;
  }
  getStatusClass(status: PaymentStatus) {
    return ({
      completed: 'bg-green-100 text-green-700 ring-1 ring-green-200',
      pending: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200',
      failed: 'bg-red-100 text-red-700 ring-1 ring-red-200',
      cancelled: 'bg-gray-100 text-gray-700 ring-1 ring-gray-200'
    } as Record<PaymentStatus, string>)[status] ?? 'bg-gray-100 text-gray-700';
  }

  // ── Export CSV ──
  exportToCSV() {
    const rows = this.sortedPayments();
    if (!rows.length) return;
    const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const content = '\uFEFF'
      + ['Data', 'Empresa', 'Plano', 'Ciclo', 'Estado', 'Fatura OfficeGest', 'Método', 'Telefone', 'Referência', 'Valor', 'Moeda'].join(';')
      + '\n'
      + rows.map(p => [
          new Date(p.created_at).toLocaleString('pt-MZ'),
          p.company_name, p.plan_name, p.billing_cycle,
          this.statusLabel(p.status),
          p.officegest_document_number || 'Não emitida',
          this.paymentMethodLabel(p.payment_method),
          p.phone_number, p.reference_code, p.amount, p.currency
        ].map(escape).join(';')).join('\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `transacoes_financeiras_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // ── Fase 3: Drawer ──
  selectPayment(payment: PaymentTransaction) {
    this.actionError.set('');
    this.actionSuccess.set('');
    this.selectedPayment.set(payment);
  }
  closeDrawer() { this.selectedPayment.set(null); }

  formatSislog(data: Record<string, unknown> | null): string {
    if (!data || Object.keys(data).length === 0) return '{}';
    try { return JSON.stringify(data, null, 2); } catch { return '{}'; }
  }

  // ── Fase 4: Acções sobre transacções ──
  async confirmPayment(payment: PaymentTransaction) {
    this.actionLoading.set(true);
    this.actionError.set('');
    this.actionSuccess.set('');
    try {
      const { error } = await this.supabase.db
        .from('subscription_payments')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', payment.id);

      if (error) throw error;

      // Activar subscrição da empresa
      const subUpdated = await this.subscriptionService.upsertSubscription(
        payment.company_id,
        {
          plan_name: payment.plan_name,
          billing_cycle: payment.billing_cycle as any,
          amount: payment.amount,
          currency: payment.currency,
          payment_method: payment.payment_method as any,
          status: 'active'
        }
      );

      if (!subUpdated) {
        throw new Error('Pagamento confirmado mas não foi possível activar a subscrição. Verifique manualmente.');
      }

      // Auditoria
      await this.auditLogService.log(
        'Confirmou Pagamento Manualmente',
        'subscription_payments',
        { payment_id: payment.id, company: payment.company_name, amount: payment.amount, plan: payment.plan_name },
        payment.id,
        payment.reference_code
      );

      // Actualizar estado local
      this.allPayments.update(all =>
        all.map(p => p.id === payment.id ? { ...p, status: 'completed' as PaymentStatus } : p)
      );
      this.selectedPayment.update(p => p ? { ...p, status: 'completed' as PaymentStatus } : p);
      this.actionSuccess.set('Pagamento confirmado e subscrição activada com sucesso.');
    } catch (err: any) {
      console.error('Erro ao confirmar pagamento:', err);
      this.actionError.set(err?.message || 'Erro ao confirmar pagamento. Tente novamente.');
    } finally {
      this.actionLoading.set(false);
    }
  }

  async cancelPayment(payment: PaymentTransaction) {
    this.actionLoading.set(true);
    this.actionError.set('');
    this.actionSuccess.set('');
    try {
      const { error } = await this.supabase.db
        .from('subscription_payments')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', payment.id);

      if (error) throw error;

      // Auditoria
      await this.auditLogService.log(
        'Cancelou Transação Manualmente',
        'subscription_payments',
        { payment_id: payment.id, company: payment.company_name, amount: payment.amount },
        payment.id,
        payment.reference_code
      );

      // Actualizar estado local
      this.allPayments.update(all =>
        all.map(p => p.id === payment.id ? { ...p, status: 'cancelled' as PaymentStatus } : p)
      );
      this.selectedPayment.update(p => p ? { ...p, status: 'cancelled' as PaymentStatus } : p);
      this.actionSuccess.set('Transação cancelada com sucesso.');
    } catch (err: any) {
      console.error('Erro ao cancelar pagamento:', err);
      this.actionError.set(err?.message || 'Erro ao cancelar pagamento. Tente novamente.');
    } finally {
      this.actionLoading.set(false);
    }
  }

  // ── Sincronização com OfficeGest ──
  async syncWithOfficeGest() {
    this.isSyncingOfficeGest.set(true);
    this.ogSyncFeedback.set(null);
    try {
      const res = await this.supabase.client.functions.invoke('sync-officegest', {
        body: {}
      });

      if (res.error) throw res.error;

      const data = res.data;
      if (data?.synced > 0) {
        this.ogSyncFeedback.set({
          message: `Sucesso! ${data.synced} fatura(s) emitida(s) no OfficeGest.${data.failed > 0 ? ` (${data.failed} falha(s))` : ''}`,
          isError: false
        });
        await this.loadFinancialData();
      } else if (data?.failed > 0) {
        this.ogSyncFeedback.set({
          message: `Falha ao sincronizar: ${data.errors?.join('; ') || 'Erro desconhecido'}`,
          isError: true
        });
      } else {
        this.ogSyncFeedback.set({
          message: data?.message || 'Não há pagamentos pendentes de emissão no OfficeGest.',
          isError: false
        });
      }
    } catch (err: any) {
      console.error('Erro ao sincronizar com OfficeGest:', err);
      this.ogSyncFeedback.set({
        message: err?.message || 'Erro ao comunicar com o serviço de sincronização do OfficeGest.',
        isError: true
      });
    } finally {
      this.isSyncingOfficeGest.set(false);
    }
  }

  async syncSingleWithOfficeGest(payment: PaymentTransaction) {
    this.actionLoading.set(true);
    this.actionError.set('');
    this.actionSuccess.set('');
    try {
      const res = await this.supabase.client.functions.invoke('sync-officegest', {
        body: { payment_ids: [payment.id] }
      });

      if (res.error) throw res.error;

      const data = res.data;
      if (data?.synced > 0) {
        const docNumber = data.documents?.[0]?.document_number || 'emitida';
        this.actionSuccess.set(`Fatura ${docNumber} emitida no OfficeGest com sucesso.`);
        // Recarregar dados para actualizar tabelas e drawer
        await this.loadFinancialData();
        const updated = this.allPayments().find(p => p.id === payment.id);
        if (updated) this.selectedPayment.set(updated);
      } else {
        const errMsg = data?.errors?.[0] || data?.message || 'Falha ao emitir fatura no OfficeGest.';
        this.actionError.set(errMsg);
      }
    } catch (err: any) {
      console.error('Erro ao emitir fatura no OfficeGest:', err);
      this.actionError.set(err?.message || 'Erro ao emitir fatura no OfficeGest.');
    } finally {
      this.actionLoading.set(false);
    }
  }
}
