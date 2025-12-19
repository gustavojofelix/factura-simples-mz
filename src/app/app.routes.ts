import { Routes } from '@angular/router';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { authGuard, guestGuard } from './core/guards/auth.guard';
import { DeviceDetectionService } from './core/services/device-detection.service';

const deviceRedirectGuard = () => {
  const deviceService = inject(DeviceDetectionService);
  const router = inject(Router);
  const isMobile = deviceService.isMobile();
  const currentUrl = router.url;

  if (isMobile && !currentUrl.startsWith('/mobile')) {
    router.navigate(['/mobile/login']);
    return false;
  }
  if (!isMobile && currentUrl.startsWith('/mobile')) {
    router.navigate(['/entrar']);
    return false;
  }
  return true;
};

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/landing/landing.component').then(m => m.LandingComponent)
  },
  {
    path: 'entrar',
    canActivate: [guestGuard, deviceRedirectGuard],
    loadComponent: () => import('./pages/login/login.component').then(m => m.LoginComponent)
  },
  {
    path: 'registar',
    canActivate: [guestGuard, deviceRedirectGuard],
    loadComponent: () => import('./pages/register/register.component').then(m => m.RegisterComponent)
  },
  {
    path: 'configurar-empresa',
    canActivate: [authGuard, deviceRedirectGuard],
    loadComponent: () => import('./pages/company-setup/company-setup.component').then(m => m.CompanySetupComponent)
  },
  {
    path: '',
    canActivate: [authGuard, deviceRedirectGuard],
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
        path: 'configuracoes',
        loadComponent: () => import('./pages/settings/settings.component').then(m => m.SettingsComponent)
      }
    ]
  },
  {
    path: 'mobile',
    children: [
      {
        path: 'login',
        canActivate: [guestGuard],
        loadComponent: () => import('./pages/mobile-login/mobile-login.component').then(m => m.MobileLoginComponent)
      },
      {
        path: 'register',
        canActivate: [guestGuard],
        loadComponent: () => import('./pages/mobile-register/mobile-register.component').then(m => m.MobileRegisterComponent)
      },
      {
        path: 'dashboard',
        canActivate: [authGuard],
        loadComponent: () => import('./pages/mobile-dashboard/mobile-dashboard.component').then(m => m.MobileDashboardComponent)
      },
      {
        path: 'company-setup',
        canActivate: [authGuard],
        loadComponent: () => import('./pages/company-setup/company-setup.component').then(m => m.CompanySetupComponent)
      },
      {
        path: '',
        redirectTo: 'login',
        pathMatch: 'full'
      }
    ]
  },
  {
    path: '**',
    redirectTo: ''
  }
];
