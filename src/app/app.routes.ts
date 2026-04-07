import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/guards/auth.guard';
import { adminGuard } from './core/guards/admin.guard';

const isHostAdmin = () => {
  if (typeof window !== 'undefined') {
    return window.location.hostname.startsWith('backadmin.') || window.location.href.includes('backadmin=true');
  }
  return false;
};

// Rotas normais para clientes (ispcfacil.co.mz)
const baseAppRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/landing/landing.component').then(m => m.LandingComponent)
  },
  {
    path: 'entrar',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/login/login.component').then(m => m.LoginComponent)
  },
  {
    path: 'registar',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/register/register.component').then(m => m.RegisterComponent)
  },
  {
    path: 'configurar-empresa',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/company-setup/company-setup.component').then(m => m.CompanySetupComponent)
  },
  {
    path: '',
    canActivate: [authGuard],
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
        loadComponent: () => import('./pages/reports/reports.component').then(m => m.ReportsComponent)
      },
      {
        path: 'configuracoes',
        loadComponent: () => import('./pages/settings/settings.component').then(m => m.SettingsComponent)
      },
      {
        path: 'perfil',
        loadComponent: () => import('./pages/profile/profile.component').then(m => m.ProfileComponent)
      }
    ]
  },
  {
    path: '**',
    redirectTo: ''
  }
];

// Rotas exclusivas para o Back-Office (admin.ispcfacil.co.mz)
const adminRoutes: Routes = [
  {
    path: 'entrar',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/login/login.component').then(m => m.LoginComponent)
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
        path: 'financeiro',
        loadComponent: () => import('./pages/admin/revenue/admin-revenue.component').then(m => m.AdminRevenueComponent)
      }
    ]
  },
  {
    path: '**',
    redirectTo: ''
  }
];

export const routes: Routes = isHostAdmin() ? adminRoutes : baseAppRoutes;
