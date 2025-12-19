import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { InvoiceService } from '../../core/services/invoice.service';
import { CompanyService } from '../../core/services/company.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-mobile-dashboard',
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-title>Dashboard</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="logout()">
            <ion-icon slot="icon-only" name="log-out-outline"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="handleRefresh($event)">
        <ion-refresher-content></ion-refresher-content>
      </ion-refresher>

      <div class="dashboard-container">
        <div class="company-info" *ngIf="company">
          <h2>{{ company.name }}</h2>
          <p>NUIT: {{ company.nuit }}</p>
        </div>

        <div class="metrics-grid">
          <ion-card class="metric-card">
            <ion-card-content>
              <div class="metric-icon">
                <ion-icon name="document-text-outline" color="primary"></ion-icon>
              </div>
              <div class="metric-value">{{ stats.totalInvoices }}</div>
              <div class="metric-label">Total Facturas</div>
            </ion-card-content>
          </ion-card>

          <ion-card class="metric-card">
            <ion-card-content>
              <div class="metric-icon">
                <ion-icon name="checkmark-circle-outline" color="success"></ion-icon>
              </div>
              <div class="metric-value">{{ stats.paidInvoices }}</div>
              <div class="metric-label">Pagas</div>
            </ion-card-content>
          </ion-card>

          <ion-card class="metric-card">
            <ion-card-content>
              <div class="metric-icon">
                <ion-icon name="time-outline" color="warning"></ion-icon>
              </div>
              <div class="metric-value">{{ stats.pendingInvoices }}</div>
              <div class="metric-label">Pendentes</div>
            </ion-card-content>
          </ion-card>

          <ion-card class="metric-card">
            <ion-card-content>
              <div class="metric-icon">
                <ion-icon name="cash-outline" color="primary"></ion-icon>
              </div>
              <div class="metric-value">{{ stats.totalRevenue | number:'1.2-2' }} MT</div>
              <div class="metric-label">Receita Total</div>
            </ion-card-content>
          </ion-card>
        </div>

        <ion-card>
          <ion-card-header>
            <ion-card-title>Facturas Recentes</ion-card-title>
          </ion-card-header>
          <ion-card-content>
            <ion-list *ngIf="recentInvoices.length > 0; else noInvoices">
              <ion-item *ngFor="let invoice of recentInvoices" [routerLink]="['/mobile/invoices', invoice.id]">
                <ion-label>
                  <h3>{{ invoice.client_name }}</h3>
                  <p>{{ invoice.invoice_number }} - {{ invoice.issue_date | date:'dd/MM/yyyy' }}</p>
                </ion-label>
                <ion-badge slot="end" [color]="getStatusColor(invoice.status)">
                  {{ getStatusLabel(invoice.status) }}
                </ion-badge>
              </ion-item>
            </ion-list>
            <ng-template #noInvoices>
              <div class="empty-state">
                <ion-icon name="document-outline" size="large" color="medium"></ion-icon>
                <p>Nenhuma factura encontrada</p>
              </div>
            </ng-template>
          </ion-card-content>
        </ion-card>

        <ion-fab slot="fixed" vertical="bottom" horizontal="end">
          <ion-fab-button color="primary">
            <ion-icon name="add"></ion-icon>
          </ion-fab-button>
          <ion-fab-list side="top">
            <ion-fab-button routerLink="/mobile/invoices/new">
              <ion-icon name="document-text-outline"></ion-icon>
            </ion-fab-button>
            <ion-fab-button routerLink="/mobile/clients/new">
              <ion-icon name="person-outline"></ion-icon>
            </ion-fab-button>
            <ion-fab-button routerLink="/mobile/products/new">
              <ion-icon name="cube-outline"></ion-icon>
            </ion-fab-button>
          </ion-fab-list>
        </ion-fab>
      </div>
    </ion-content>

    <ion-tabs>
      <ion-tab-bar slot="bottom">
        <ion-tab-button tab="dashboard" href="/mobile/dashboard">
          <ion-icon name="home-outline"></ion-icon>
          <ion-label>Início</ion-label>
        </ion-tab-button>

        <ion-tab-button tab="invoices" href="/mobile/invoices">
          <ion-icon name="document-text-outline"></ion-icon>
          <ion-label>Facturas</ion-label>
        </ion-tab-button>

        <ion-tab-button tab="clients" href="/mobile/clients">
          <ion-icon name="people-outline"></ion-icon>
          <ion-label>Clientes</ion-label>
        </ion-tab-button>

        <ion-tab-button tab="settings" href="/mobile/settings">
          <ion-icon name="settings-outline"></ion-icon>
          <ion-label>Definições</ion-label>
        </ion-tab-button>
      </ion-tab-bar>
    </ion-tabs>
  `,
  styles: [`
    .dashboard-container {
      padding: 16px;
      padding-bottom: 80px;
    }

    .company-info {
      background: var(--ion-color-primary);
      color: white;
      padding: 20px;
      border-radius: 12px;
      margin-bottom: 20px;
    }

    .company-info h2 {
      margin: 0 0 8px 0;
      font-size: 1.5rem;
      font-weight: 600;
    }

    .company-info p {
      margin: 0;
      opacity: 0.9;
    }

    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
      margin-bottom: 20px;
    }

    .metric-card {
      margin: 0;
    }

    .metric-card ion-card-content {
      text-align: center;
      padding: 16px;
    }

    .metric-icon {
      margin-bottom: 8px;
    }

    .metric-icon ion-icon {
      font-size: 32px;
    }

    .metric-value {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--ion-color-dark);
      margin-bottom: 4px;
    }

    .metric-label {
      font-size: 0.875rem;
      color: var(--ion-color-medium);
    }

    .empty-state {
      text-align: center;
      padding: 40px 20px;
      color: var(--ion-color-medium);
    }

    .empty-state ion-icon {
      font-size: 64px;
      margin-bottom: 16px;
    }

    ion-tabs {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
    }

    ion-fab {
      margin-bottom: 70px;
    }
  `]
})
export class MobileDashboardComponent implements OnInit {
  company: any = null;
  recentInvoices: any[] = [];
  stats = {
    totalInvoices: 0,
    paidInvoices: 0,
    pendingInvoices: 0,
    totalRevenue: 0
  };

  constructor(
    private invoiceService: InvoiceService,
    private companyService: CompanyService,
    private authService: AuthService,
    private router: Router
  ) {}

  async ngOnInit() {
    await this.loadData();
  }

  async loadData() {
    try {
      this.company = this.companyService.activeCompany();

      await this.invoiceService.loadInvoices();
      const invoices = this.invoiceService.invoices();
      this.recentInvoices = invoices.slice(0, 5);

      this.stats.totalInvoices = invoices.length;
      this.stats.paidInvoices = invoices.filter((i: any) => i.status === 'paid' || i.status === 'paga').length;
      this.stats.pendingInvoices = invoices.filter((i: any) => i.status === 'pending' || i.status === 'pendente').length;
      this.stats.totalRevenue = invoices
        .filter((i: any) => i.status === 'paid' || i.status === 'paga')
        .reduce((sum: number, i: any) => sum + (i.total || 0), 0);
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    }
  }

  async handleRefresh(event: any) {
    await this.loadData();
    event.target.complete();
  }

  getStatusColor(status: string): string {
    const colors: any = {
      draft: 'medium',
      pending: 'warning',
      paid: 'success',
      cancelled: 'danger',
      overdue: 'danger'
    };
    return colors[status] || 'medium';
  }

  getStatusLabel(status: string): string {
    const labels: any = {
      draft: 'Rascunho',
      pending: 'Pendente',
      paid: 'Paga',
      cancelled: 'Cancelada',
      overdue: 'Vencida'
    };
    return labels[status] || status;
  }

  async logout() {
    await this.authService.signOut();
    this.router.navigate(['/mobile/login']);
  }
}
