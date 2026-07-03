import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router } from '@angular/router';
import { CompanyService } from '../../core/services/company.service';
import { SupabaseService } from '../../core/services/supabase.service';

interface Insight {
  title: string;
  description: string;
  type: 'warning' | 'success' | 'info' | 'danger';
  icon: string;
  action?: string;
  actionRoute?: string;
}

interface FinancialMetrics {
  totalRevenue: number;
  pendingRevenue: number;
  overdueRevenue: number;
  totalInvoices: number;
  pendingInvoices: number;
  overdueInvoices: number;
  activeClients: number;
  activeProducts: number;
  topClientConcentration: number;
}

interface FiscalData {
  currentQuarter: number;
  quarterRevenue: number;
  ispcEstimate: number;
  daysUntilIspcDue: number;
}

@Component({
  selector: 'app-ai-insights',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule
  ],
  template: `
    <div class="insights-page">
      <!-- Header -->
      <div class="insights-header">
        <div class="insights-header-left">
          <a routerLink="/painel" class="back-link">
            <mat-icon>arrow_back</mat-icon>
          </a>
          <div class="insights-header-text">
            <div class="insights-badge">
              <mat-icon>auto_awesome</mat-icon>
              Powered by IA
            </div>
            <h1 class="insights-title">Insights Inteligentes</h1>
            <p class="insights-subtitle">
              Análise financeira e alertas proactivos gerados automaticamente para 
              <strong>{{ companyService.activeCompany()?.name }}</strong>
            </p>
          </div>
        </div>
        <button class="refresh-btn" (click)="loadInsights()" [disabled]="loading()">
          <mat-icon [class.spinning]="loading()">refresh</mat-icon>
          Actualizar
        </button>
      </div>

      @if (loading()) {
        <div class="loading-state">
          <div class="loading-brain">
            <mat-icon>psychology</mat-icon>
          </div>
          <h3>A IA está a analisar os seus dados...</h3>
          <p>Processando facturas, clientes e calculando obrigações fiscais</p>
          <div class="loading-steps">
            <div class="loading-step" [class.step-done]="loadStep() >= 1">
              <mat-icon>{{ loadStep() >= 1 ? 'check_circle' : 'hourglass_empty' }}</mat-icon>
              <span>A recolher dados financeiros</span>
            </div>
            <div class="loading-step" [class.step-done]="loadStep() >= 2">
              <mat-icon>{{ loadStep() >= 2 ? 'check_circle' : 'hourglass_empty' }}</mat-icon>
              <span>A calcular ISPC e obrigações</span>
            </div>
            <div class="loading-step" [class.step-done]="loadStep() >= 3">
              <mat-icon>{{ loadStep() >= 3 ? 'check_circle' : 'hourglass_empty' }}</mat-icon>
              <span>A gerar insights com IA Gemini</span>
            </div>
          </div>
        </div>
      } @else if (error()) {
        <div class="error-state">
          <mat-icon>error_outline</mat-icon>
          <h3>Erro ao carregar insights</h3>
          <p>{{ error() }}</p>
          <button mat-raised-button (click)="loadInsights()">Tentar novamente</button>
        </div>
      } @else {
        <!-- Metric Cards -->
        @if (metrics()) {
          <div class="metrics-grid">
            <div class="metric-card metric-card-revenue">
              <div class="metric-icon">
                <mat-icon>trending_up</mat-icon>
              </div>
              <div>
                <p class="metric-label">Receita Total (Ano)</p>
                <p class="metric-value">{{ formatCurrency(metrics()!.totalRevenue) }}</p>
                <p class="metric-sub">{{ metrics()!.totalInvoices }} facturas emitidas</p>
              </div>
            </div>
            <div class="metric-card metric-card-pending">
              <div class="metric-icon">
                <mat-icon>schedule</mat-icon>
              </div>
              <div>
                <p class="metric-label">Valores Pendentes</p>
                <p class="metric-value">{{ formatCurrency(metrics()!.pendingRevenue) }}</p>
                <p class="metric-sub">{{ metrics()!.pendingInvoices }} facturas por receber</p>
              </div>
            </div>
            <div class="metric-card" [class.metric-card-danger]="metrics()!.overdueInvoices > 0" [class.metric-card-ok]="metrics()!.overdueInvoices === 0">
              <div class="metric-icon">
                <mat-icon>{{ metrics()!.overdueInvoices > 0 ? 'warning' : 'check_circle' }}</mat-icon>
              </div>
              <div>
                <p class="metric-label">Facturas Vencidas</p>
                <p class="metric-value">{{ metrics()!.overdueInvoices }}</p>
                <p class="metric-sub">{{ formatCurrency(metrics()!.overdueRevenue) }} em dívida</p>
              </div>
            </div>
            <div class="metric-card metric-card-fiscal">
              <div class="metric-icon">
                <mat-icon>account_balance</mat-icon>
              </div>
              <div>
                <p class="metric-label">ISPC Estimado (T{{ fiscal()?.currentQuarter }})</p>
                <p class="metric-value">{{ formatCurrency(fiscal()?.ispcEstimate || 0) }}</p>
                <p class="metric-sub">
                  @if ((fiscal()?.daysUntilIspcDue || 0) > 0) {
                    Vence em {{ fiscal()?.daysUntilIspcDue }} dias
                  } @else {
                    ⚠️ Prazo ultrapassado!
                  }
                </p>
              </div>
            </div>
          </div>
        }

        <!-- Monthly Revenue Chart (simple bar chart) -->
        @if (monthlyRevenue() && hasRevenue()) {
          <div class="chart-section">
            <h2 class="section-title">
              <mat-icon>bar_chart</mat-icon>
              Receita Mensal {{ currentYear }}
            </h2>
            <div class="bar-chart">
              @for (item of monthlyChartData(); track item.month) {
                <div class="bar-item">
                  <div class="bar-container">
                    <div
                      class="bar"
                      [style.height]="item.heightPct + '%'"
                      [title]="item.month + ': ' + formatCurrency(item.value)"
                    ></div>
                  </div>
                  <span class="bar-label">{{ item.month }}</span>
                  <span class="bar-value">{{ item.value > 0 ? formatCurrencyShort(item.value) : '' }}</span>
                </div>
              }
            </div>
          </div>
        }

        <!-- AI Insights -->
        @if (insights().length > 0) {
          <div class="insights-section">
            <h2 class="section-title">
              <mat-icon>auto_awesome</mat-icon>
              Análise da IA
              @if (summary()) {
                <span class="summary-text">— {{ summary() }}</span>
              }
            </h2>
            <div class="insights-grid">
              @for (insight of insights(); track insight.title) {
                <div class="insight-card" [class]="'insight-card-' + insight.type">
                  <div class="insight-icon-area">
                    <div class="insight-icon-circle" [class]="'insight-icon-' + insight.type">
                      <mat-icon>{{ insight.icon }}</mat-icon>
                    </div>
                  </div>
                  <div class="insight-content">
                    <h3 class="insight-title">{{ insight.title }}</h3>
                    <p class="insight-description">{{ insight.description }}</p>
                    @if (insight.action && insight.actionRoute) {
                      <a [routerLink]="insight.actionRoute" class="insight-action-btn" [class]="'insight-action-' + insight.type">
                        {{ insight.action }}
                        <mat-icon>arrow_forward</mat-icon>
                      </a>
                    }
                  </div>
                </div>
              }
            </div>
          </div>
        }

        <!-- Quick Actions -->
        <div class="quick-actions-section">
          <h2 class="section-title">
            <mat-icon>bolt</mat-icon>
            Acções Rápidas
          </h2>
          <div class="quick-actions-grid">
            <a routerLink="/facturas" class="quick-action-card">
              <mat-icon>receipt_long</mat-icon>
              <span>Ver Facturas</span>
            </a>
            <a routerLink="/clientes" class="quick-action-card">
              <mat-icon>people</mat-icon>
              <span>Gerir Clientes</span>
            </a>
            <a routerLink="/relatorios" class="quick-action-card">
              <mat-icon>assessment</mat-icon>
              <span>Relatórios</span>
            </a>
            <a routerLink="/assistente" class="quick-action-card quick-action-ai">
              <mat-icon>auto_awesome</mat-icon>
              <span>Falar com a IA</span>
            </a>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .insights-page {
      padding: 28px;
      max-width: 1200px;
      margin: 0 auto;
    }

    /* Header */
    .insights-header {
      display: flex; align-items: flex-start; justify-content: space-between;
      margin-bottom: 28px; flex-wrap: wrap; gap: 16px;
    }
    .insights-header-left { display: flex; align-items: flex-start; gap: 16px; }
    .back-link {
      color: #64748b; width: 40px; height: 40px;
      display: flex; align-items: center; justify-content: center;
      border-radius: 10px; transition: all 0.2s; margin-top: 4px;
    }
    .back-link:hover { background: #e2e8f0; color: #1e293b; }
    .insights-badge {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 12px; border-radius: 20px;
      background: linear-gradient(135deg, rgba(249,115,22,0.1), rgba(251,146,60,0.05));
      border: 1px solid rgba(249,115,22,0.2);
      color: #f97316; font-size: 11px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.05em;
      margin-bottom: 8px;
    }
    .insights-badge mat-icon { font-size: 14px; }
    .insights-title { font-size: 28px; font-weight: 800; color: #1e293b; margin: 0 0 6px; }
    .insights-subtitle { color: #64748b; font-size: 14px; margin: 0; }
    .refresh-btn {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 20px; border-radius: 12px;
      border: 1px solid #e2e8f0; background: white;
      color: #475569; font-size: 14px; font-weight: 600;
      cursor: pointer; transition: all 0.2s;
    }
    .refresh-btn:hover { background: #f8fafc; border-color: #f97316; color: #f97316; }
    .refresh-btn:disabled { opacity: 0.5; }
    .spinning { animation: spin 1s linear infinite; }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

    /* Loading State */
    .loading-state {
      display: flex; flex-direction: column; align-items: center;
      padding: 80px 40px; text-align: center; gap: 12px;
    }
    .loading-brain {
      width: 80px; height: 80px; border-radius: 24px;
      background: linear-gradient(135deg, rgba(249,115,22,0.15), rgba(251,146,60,0.05));
      border: 1px solid rgba(249,115,22,0.2);
      display: flex; align-items: center; justify-content: center;
      margin-bottom: 16px;
      animation: pulse-glow 2s infinite;
    }
    .loading-brain mat-icon { font-size: 40px; color: #f97316; }
    @keyframes pulse-glow {
      0%, 100% { box-shadow: 0 0 0 rgba(249,115,22,0); }
      50% { box-shadow: 0 0 20px rgba(249,115,22,0.3); }
    }
    .loading-state h3 { font-size: 20px; font-weight: 700; color: #1e293b; margin: 0; }
    .loading-state p { color: #64748b; margin: 0; }
    .loading-steps {
      display: flex; flex-direction: column; gap: 8px;
      margin-top: 16px; text-align: left;
    }
    .loading-step {
      display: flex; align-items: center; gap: 10px;
      color: #94a3b8; font-size: 13px; padding: 8px 16px;
      border-radius: 10px; background: #f8fafc;
    }
    .loading-step mat-icon { font-size: 18px; color: #cbd5e1; }
    .step-done { color: #059669; }
    .step-done mat-icon { color: #059669; }

    /* Error State */
    .error-state {
      display: flex; flex-direction: column; align-items: center;
      padding: 60px; text-align: center; gap: 12px; color: #64748b;
    }
    .error-state mat-icon { font-size: 60px; color: #ef4444; }

    /* Metric Cards */
    .metrics-grid {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px;
      margin-bottom: 28px;
    }
    @media (max-width: 900px) { .metrics-grid { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 500px) { .metrics-grid { grid-template-columns: 1fr; } }

    .metric-card {
      background: white; border-radius: 16px; padding: 20px;
      border: 1px solid rgba(0,0,0,0.06);
      box-shadow: 0 2px 8px rgba(0,0,0,0.04);
      display: flex; align-items: flex-start; gap: 14px;
      transition: transform 0.2s;
    }
    .metric-card:hover { transform: translateY(-2px); }
    .metric-icon {
      width: 44px; height: 44px; border-radius: 12px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .metric-icon mat-icon { font-size: 22px; }
    .metric-card-revenue .metric-icon { background: rgba(34,197,94,0.1); }
    .metric-card-revenue .metric-icon mat-icon { color: #16a34a; }
    .metric-card-pending .metric-icon { background: rgba(249,115,22,0.1); }
    .metric-card-pending .metric-icon mat-icon { color: #f97316; }
    .metric-card-danger .metric-icon { background: rgba(239,68,68,0.1); }
    .metric-card-danger .metric-icon mat-icon { color: #ef4444; }
    .metric-card-ok .metric-icon { background: rgba(34,197,94,0.1); }
    .metric-card-ok .metric-icon mat-icon { color: #16a34a; }
    .metric-card-fiscal .metric-icon { background: rgba(99,102,241,0.1); }
    .metric-card-fiscal .metric-icon mat-icon { color: #6366f1; }

    .metric-label { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 4px; }
    .metric-value { font-size: 20px; font-weight: 800; color: #1e293b; margin: 0 0 4px; }
    .metric-sub { font-size: 11px; color: #94a3b8; margin: 0; }
    .metric-card-danger .metric-value { color: #ef4444; }

    /* Section Title */
    .section-title {
      display: flex; align-items: center; gap: 8px;
      font-size: 16px; font-weight: 700; color: #1e293b; margin: 0 0 16px;
    }
    .section-title mat-icon { font-size: 20px; color: #f97316; }
    .summary-text { font-size: 14px; font-weight: 400; color: #64748b; }

    /* Bar Chart */
    .chart-section {
      background: white; border-radius: 16px; padding: 24px;
      border: 1px solid rgba(0,0,0,0.06); margin-bottom: 28px;
    }
    .bar-chart {
      display: flex; align-items: flex-end; gap: 8px;
      height: 140px;
    }
    .bar-item {
      flex: 1; display: flex; flex-direction: column;
      align-items: center; gap: 4px;
    }
    .bar-container { flex: 1; width: 100%; display: flex; align-items: flex-end; }
    .bar {
      width: 100%; min-height: 4px; border-radius: 6px 6px 0 0;
      background: linear-gradient(to top, #f97316, #fb923c);
      transition: height 0.5s ease;
    }
    .bar-label { font-size: 10px; color: #94a3b8; font-weight: 600; }
    .bar-value { font-size: 9px; color: #64748b; }

    /* AI Insights */
    .insights-section {
      margin-bottom: 28px;
    }
    .insights-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
    @media (max-width: 768px) { .insights-grid { grid-template-columns: 1fr; } }

    .insight-card {
      background: white; border-radius: 16px; padding: 20px;
      border: 1px solid rgba(0,0,0,0.06);
      box-shadow: 0 2px 8px rgba(0,0,0,0.04);
      display: flex; gap: 16px;
      border-left: 4px solid transparent;
      transition: transform 0.2s;
    }
    .insight-card:hover { transform: translateY(-2px); }
    .insight-card-warning { border-left-color: #f59e0b; }
    .insight-card-success { border-left-color: #22c55e; }
    .insight-card-info { border-left-color: #3b82f6; }
    .insight-card-danger { border-left-color: #ef4444; }

    .insight-icon-circle {
      width: 42px; height: 42px; border-radius: 12px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .insight-icon-circle mat-icon { font-size: 22px; }
    .insight-icon-warning { background: rgba(245,158,11,0.1); }
    .insight-icon-warning mat-icon { color: #f59e0b; }
    .insight-icon-success { background: rgba(34,197,94,0.1); }
    .insight-icon-success mat-icon { color: #16a34a; }
    .insight-icon-info { background: rgba(59,130,246,0.1); }
    .insight-icon-info mat-icon { color: #3b82f6; }
    .insight-icon-danger { background: rgba(239,68,68,0.1); }
    .insight-icon-danger mat-icon { color: #ef4444; }

    .insight-content { flex: 1; }
    .insight-title { font-size: 14px; font-weight: 700; color: #1e293b; margin: 0 0 6px; }
    .insight-description { font-size: 13px; color: #64748b; line-height: 1.5; margin: 0 0 12px; }
    .insight-action-btn {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 12px; font-weight: 700; text-decoration: none;
      padding: 6px 14px; border-radius: 20px; transition: all 0.15s;
    }
    .insight-action-btn mat-icon { font-size: 14px; }
    .insight-action-warning { color: #f59e0b; background: rgba(245,158,11,0.1); }
    .insight-action-warning:hover { background: rgba(245,158,11,0.2); }
    .insight-action-success { color: #16a34a; background: rgba(34,197,94,0.1); }
    .insight-action-danger { color: #ef4444; background: rgba(239,68,68,0.1); }
    .insight-action-info { color: #3b82f6; background: rgba(59,130,246,0.1); }

    /* Quick Actions */
    .quick-actions-section { margin-bottom: 28px; }
    .quick-actions-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    @media (max-width: 600px) { .quick-actions-grid { grid-template-columns: repeat(2, 1fr); } }
    .quick-action-card {
      display: flex; flex-direction: column; align-items: center; gap: 10px;
      padding: 20px 16px; border-radius: 16px;
      background: white; border: 1px solid rgba(0,0,0,0.06);
      color: #475569; text-decoration: none; font-size: 13px; font-weight: 600;
      transition: all 0.2s;
    }
    .quick-action-card mat-icon { font-size: 28px; color: #94a3b8; transition: color 0.2s; }
    .quick-action-card:hover { border-color: #f97316; color: #f97316; transform: translateY(-2px); }
    .quick-action-card:hover mat-icon { color: #f97316; }
    .quick-action-ai {
      background: linear-gradient(135deg, rgba(249,115,22,0.05), rgba(251,146,60,0.03));
      border-color: rgba(249,115,22,0.2) !important; color: #f97316 !important;
    }
    .quick-action-ai mat-icon { color: #f97316 !important; }
    .quick-action-ai:hover { background: linear-gradient(135deg, rgba(249,115,22,0.1), rgba(251,146,60,0.07)) !important; }
  `]
})
export class AiInsightsComponent implements OnInit {
  loading = signal(true);
  error = signal('');
  loadStep = signal(0);
  metrics = signal<FinancialMetrics | null>(null);
  fiscal = signal<FiscalData | null>(null);
  monthlyRevenue = signal<Record<string, number>>({});
  insights = signal<Insight[]>([]);
  summary = signal('');
  currentYear = new Date().getFullYear();

  hasRevenue = () => Object.values(this.monthlyRevenue()).some(v => v > 0);

  monthlyChartData = () => {
    const data = this.monthlyRevenue();
    const values = Object.values(data);
    const max = Math.max(1, ...values);
    const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    return Object.entries(data).map(([key, value], i) => ({
      month: months[i] || key,
      value,
      heightPct: Math.max(2, Math.round((value / max) * 100))
    }));
  };

  constructor(
    public companyService: CompanyService,
    private supabase: SupabaseService,
    private router: Router
  ) {}

  ngOnInit() {
    this.loadInsights();
  }

  async loadInsights() {
    const company = this.companyService.activeCompany();
    if (!company) {
      this.error.set('Nenhuma empresa seleccionada.');
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    this.error.set('');
    this.loadStep.set(0);

    // Animate loading steps
    const stepTimer1 = setTimeout(() => this.loadStep.set(1), 800);
    const stepTimer2 = setTimeout(() => this.loadStep.set(2), 1800);

    try {
      const { data, error } = await this.supabase.client.functions.invoke('ai-insights', {
        body: {
          companyId: company.id,
          companyName: company.name
        }
      });

      clearTimeout(stepTimer1);
      clearTimeout(stepTimer2);
      this.loadStep.set(3);

      if (error) throw error;

      this.metrics.set(data?.metrics || null);
      this.fiscal.set(data?.fiscal || null);
      this.monthlyRevenue.set(data?.monthlyRevenue || {});
      this.insights.set(data?.insights || []);
      this.summary.set(data?.summary || '');

    } catch (err: any) {
      console.error('Error loading insights:', err);
      this.error.set(err.message || 'Erro ao carregar insights. Verifique a ligação.');
    } finally {
      this.loading.set(false);
    }
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('pt-MZ', {
      style: 'decimal',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value) + ' MT';
  }

  formatCurrencyShort(value: number): string {
    if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M';
    if (value >= 1000) return (value / 1000).toFixed(0) + 'k';
    return value.toString();
  }
}
