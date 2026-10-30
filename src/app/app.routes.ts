import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/guards/auth.guard';
import { adminGuard, adminGuestGuard } from './core/guards/admin.guard';
import { roleGuard, REPORT_ROLES } from './core/guards/role.guard';
import { subscriptionGuard } from './core/guards/subscription.guard';
import {
  accountGuard,
  accountLandingGuard,
  ownedAccountGuard,
  rootDomainOnlyGuard
} from './core/guards/account.guard';

export const routes: Routes = [
  // Rotas normais para clientes (ispcfacil.com e <conta>.ispcfacil.com)
  {
    path: '',
    pathMatch: 'full',
    canActivate: [accountLandingGuard],
    loadComponent: () => import('./pages/landing/landing.component').then(m => m.LandingComponent)
  },
  {
    path: 'entrar',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/login/login.component').then(m => m.LoginComponent)
  },
  {
    path: 'registar',
    canActivate: [rootDomainOnlyGuard, guestGuard],
    loadComponent: () => import('./pages/register/register.component').then(m => m.RegisterComponent)
  },
  {
    path: 'auth/callback',
    loadComponent: () => import('./pages/auth-callback/auth-callback.component').then(m => m.AuthCallbackComponent)
  },
  {
    path: 'resetar-senha',
    loadComponent: () => import('./pages/reset-password/reset-password.component').then(m => m.ResetPasswordComponent)
  },
  {
    path: 'configurar-empresa',
    canActivate: [authGuard, ownedAccountGuard],
    loadComponent: () => import('./pages/company-setup/company-setup.component').then(m => m.CompanySetupComponent)
  },
  {
    path: 'configurar-conta',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/account/account-setup.component').then(m => m.AccountSetupComponent)
  },
  {
    path: 'escolher-conta',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/account/account-select.component').then(m => m.AccountSelectComponent)
  },
  {
    path: 'sem-acesso',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/account/account-denied.component').then(m => m.AccountDeniedComponent)
  },
  // Ponto de Venda: aplicação à parte em /pos (o index.html reencaminha /pos para #/pos).
  // Demonstração com dados JSON: sem login, a entrada é feita com o PIN do operador.
  {
    path: 'pos',
    loadComponent: () => import('./pages/pos/pos.component').then(m => m.PosComponent)
  },
  {
    path: '',
    canActivate: [authGuard, accountGuard],
    canActivateChild: [subscriptionGuard],
    loadComponent: () => import('./shared/layout/main-layout.component').then(m => m.MainLayoutComponent),
    children: [
      {
        path: 'painel',
        loadComponent: () => import('./pages/dashboard/dashboard.component').then(m => m.DashboardComponent)
      },
      {
        path: 'facturas',
        loadComponent: () => import('./pages/invoices/invoices.component').then(m => m.InvoicesComponent)
      },
      {
        path: 'facturas/:id',
        loadComponent: () => import('./shared/components/invoice-detail.component').then(m => m.InvoiceDetailComponent)
      },
      {
        path: 'clientes',
        loadComponent: () => import('./pages/clients/clients.component').then(m => m.ClientsComponent)
      },
      {
        path: 'produtos',
        loadComponent: () => import('./pages/products/products.component').then(m => m.ProductsComponent)
      },
      {
        path: 'impostos',
        loadComponent: () => import('./pages/taxes/taxes.component').then(m => m.TaxesComponent)
      },
      {
        path: 'relatorios',
        canActivate: [roleGuard(REPORT_ROLES)],
        loadComponent: () => import('./pages/reports/reports.component').then(m => m.ReportsComponent)
      },
      {
        path: 'relatorios/extractos',
        canActivate: [roleGuard(REPORT_ROLES)],
        loadComponent: () => import('./pages/reports/client-statements/client-statements.component').then(m => m.ClientStatementsComponent)
      },
      {
        path: 'relatorios/extractos/:clientId',
        canActivate: [roleGuard(REPORT_ROLES)],
        loadComponent: () => import('./pages/reports/client-statements/client-statement-detail.component').then(m => m.ClientStatementDetailComponent)
      },
      {
        path: 'relatorios/saft',
        canActivate: [roleGuard(REPORT_ROLES)],
        loadComponent: () => import('./pages/reports/saft-export/saft-export.component').then(m => m.SaftExportComponent)
      },
      {
        path: 'assistente',
        loadComponent: () => import('./pages/assistant/assistant.component').then(m => m.AssistantComponent)
      },
      {
        path: 'configuracoes',
        loadComponent: () => import('./pages/settings/settings.component').then(m => m.SettingsComponent)
      },
      {
        path: 'perfil',
        loadComponent: () => import('./pages/profile/profile.component').then(m => m.ProfileComponent)
      },
      {
        path: 'auditoria',
        loadComponent: () => import('./pages/audit-logs/audit-logs.component').then(m => m.AuditLogsComponent)
      }
    ]
  },
  // Rotas do Back-Office sob /admin
  {
    path: 'admin',
    children: [
      {
        path: 'entrar',
        canActivate: [adminGuestGuard],
        loadComponent: () => import('./pages/admin/login/admin-login.component').then(m => m.AdminLoginComponent)
      },
      {
        path: '',
        canActivate: [adminGuard],
        loadComponent: () => import('./pages/admin/layout/admin-layout.component').then(m => m.AdminLayoutComponent),
        children: [
          {
            path: '',
            loadComponent: () => import('./pages/admin/dashboard/admin-dashboard.component').then(m => m.AdminDashboardComponent)
          },
          {
            path: 'subscritores',
            loadComponent: () => import('./pages/admin/subscribers/admin-subscribers.component').then(m => m.AdminSubscribersComponent)
          },
          {
            path: 'empresas',
            loadComponent: () => import('./pages/admin/companies/admin-companies.component').then(m => m.AdminCompaniesComponent)
          },
          {
            path: 'actividades',
            loadComponent: () => import('./pages/admin/activities/admin-activities.component').then(m => m.AdminActivitiesComponent)
          },
          {
            path: 'financeiro',
            loadComponent: () => import('./pages/admin/revenue/admin-revenue.component').then(m => m.AdminRevenueComponent)
          },
          {
            path: 'planos',
            loadComponent: () => import('./pages/admin/plans/admin-plans.component').then(m => m.AdminPlansComponent)
          },
          {
            path: 'vouchers',
            loadComponent: () => import('./pages/admin/vouchers/admin-vouchers.component').then(m => m.AdminVouchersComponent)
          },
          {
            path: 'conteudo',
            loadComponent: () => import('./pages/admin/cms/admin-landing-cms.component').then(m => m.AdminLandingCmsComponent)
          },
          {
            path: 'acessos',
            loadComponent: () => import('./pages/admin/access/admin-access.component').then(m => m.AdminAccessComponent)
          },
          {
            path: 'auditoria',
            loadComponent: () => import('./pages/admin/audit-logs/admin-audit-logs.component').then(m => m.AdminAuditLogsComponent)
          }
        ]
      }
    ]
  },
  {
    path: '**',
    redirectTo: ''
  }
];
