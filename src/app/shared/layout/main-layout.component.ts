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
import { AuthService } from '../../core/services/auth.service';
import { CompanyService } from '../../core/services/company.service';

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
    MatSelectModule
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
    { icon: 'inventory_2', label: 'Produtos', route: '/produtos' },
    { icon: 'account_balance', label: 'Impostos', route: '/impostos' },
    { icon: 'assessment', label: 'Relatórios', route: '/relatorios' },
    { icon: 'settings', label: 'Configurações', route: '/configuracoes' }
  ];

  constructor(
    public authService: AuthService,
    public companyService: CompanyService,
    private router: Router
  ) {}

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
