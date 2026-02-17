import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { MatCardModule } from '@angular/material/card';
import { AuthService } from '../../core/services/auth.service';
import { CompanyService } from '../../core/services/company.service';
import { SubscriptionService } from '../../core/services/subscription.service';
import { effect } from '@angular/core';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    RouterOutlet,
    MatSidenavModule,
    MatToolbarModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatSelectModule,
    MatCardModule
  ],
  templateUrl: './main-layout.component.html',
  styleUrls: ['./main-layout.component.css']
})
export class MainLayoutComponent {
  isMobileMenuOpen = signal(false);

  menuItems = [
    { icon: 'dashboard', label: 'Painel', route: '/painel' },
    { icon: 'receipt_long', label: 'Facturas', route: '/facturas' },
    { icon: 'people', label: 'Clientes', route: '/clientes' },
    { icon: 'inventory_2', label: 'Produtos e Serviços', route: '/produtos' },
    { icon: 'account_balance', label: 'Impostos', route: '/impostos' },
    { icon: 'assessment', label: 'Relatórios', route: '/relatorios' },
    { icon: 'settings', label: 'Configurações', route: '/configuracoes' }
  ];

  constructor(
    public authService: AuthService,
    public companyService: CompanyService,
    public subscriptionService: SubscriptionService,
    private router: Router
  ) {
    effect(() => {
      const company = this.companyService.activeCompany();
      if (company) {
        this.subscriptionService.loadSubscription(company.id);
      }
    });
  }

  async logout() {
    await this.authService.signOut();
  }

  onCompanyChange(companyId: string) {
    const company = this.companyService.companies().find(c => c.id === companyId);
    if (company) {
      this.companyService.setActiveCompany(company);
      this.router.navigate(['/painel']);
    }
  }

  toggleMobileMenu() {
    this.isMobileMenuOpen.update(v => !v);
  }
}
