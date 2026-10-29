import { Component, signal, computed } from '@angular/core';
import { isSubscriptionFreeUrl } from '../../core/guards/subscription.guard';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { AuthService } from '../../core/services/auth.service';
import { CompanyService } from '../../core/services/company.service';
import { AccountService } from '../../core/services/account.service';
import { TenantService } from '../../core/services/tenant.service';
import { SubscriptionService } from '../../core/services/subscription.service';
import { AiSearchComponent } from '../components/ai-search/ai-search.component';
import { AiAlertsComponent } from '../components/ai-alerts/ai-alerts.component';
import { AiAssistantWidgetComponent } from '../components/ai-chat/ai-assistant-widget.component';
import { LanguageSwitcherComponent } from '../components/language-switcher/language-switcher.component';
import { SupportContactDialogComponent } from '../components/support-contact-dialog.component';
import { effect } from '@angular/core';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { t } from '../../core/i18n/i18n';

interface MenuItem {
  icon: string;
  label: string;
  route: string;
}

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    MatSidenavModule,
    MatToolbarModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    LanguageSwitcherComponent,
    MatSelectModule,
    MatCardModule,
    MatDialogModule,
    AiSearchComponent,
    AiAlertsComponent,
    AiAssistantWidgetComponent,
    TranslatePipe
  ],
  templateUrl: './main-layout.component.html',
  styleUrls: ['./main-layout.component.css']
})
export class MainLayoutComponent {
  isMobileMenuOpen = signal(false);

  menuItems: MenuItem[] = [
    { icon: 'fa-house', label: t('layout.nav.dashboard'), route: '/painel' },
    { icon: 'fa-headset', label: t('layout.nav.assistant'), route: '/assistente' },
    { icon: 'fa-cash-register', label: t('layout.nav.pos'), route: '/pos' },
    { icon: 'fa-file-invoice-dollar', label: t('layout.nav.invoices'), route: '/facturas' },
    { icon: 'fa-address-book', label: t('layout.nav.clients'), route: '/clientes' },
    { icon: 'fa-boxes-stacked', label: t('layout.nav.products'), route: '/produtos' },
    { icon: 'fa-landmark', label: t('layout.nav.taxes'), route: '/impostos' },
    { icon: 'fa-chart-column', label: t('layout.nav.reports'), route: '/relatorios' },
    { icon: 'fa-sliders', label: t('layout.nav.settings'), route: '/configuracoes' },
    { icon: 'fa-clipboard-check', label: t('layout.nav.audit'), route: '/auditoria' }
  ];

  filteredMenuItems = computed(() => {
    const role = this.companyService.activeRole();
    
    return this.menuItems.filter(item => {
      // Vendedor (user) only gets the POS, Invoices, Clients, Products and the assistant
      if (role === 'user') {
        return ['/pos', '/facturas', '/clientes', '/produtos', '/assistente'].includes(item.route);
      }
      
      // Gestor (manager) gets everything except Settings and Auditoria
      if (role === 'manager') {
        return item.route !== '/configuracoes' && item.route !== '/auditoria';
      }
      
      // Administrador/Owner gets everything
      return true;
    });
  });

  nonSuspendedCompanies = computed(() => {
    return this.companyService.companies().filter(c => c.status !== 'suspended');
  });

  constructor(
    public authService: AuthService,
    public companyService: CompanyService,
    public subscriptionService: SubscriptionService,
    public accountService: AccountService,
    private tenant: TenantService,
    private router: Router,
    private dialog: MatDialog
  ) {
    effect(() => {
      const company = this.companyService.activeCompany();
      if (company) {
        this.subscriptionService.loadSubscription(company.id);
      }
    });

    // Se a subscrição da empresa activa expirar (ou se mudar para uma empresa
    // expirada) enquanto o utilizador está numa página bloqueada, sai dela.
    effect(() => {
      const company = this.companyService.activeCompany();
      const sub = this.subscriptionService.subscription();
      if (!company || sub?.company_id !== company.id || !this.subscriptionService.isExpired()) return;
      if (!isSubscriptionFreeUrl(this.router.url)) {
        this.router.navigate(['/configuracoes'], { queryParams: { tab: 'subscricao' } });
      }
    });
  }

  async logout() {
    await this.authService.signOut();
  }

  /** Contribuinte suspenso: abre os canais de apoio com o pedido já preenchido. */
  contactSupport() {
    const company = this.companyService.activeCompany();
    const params = {
      company: company?.name || '—',
      nuit: company?.nuit || '—',
      email: this.authService.currentUser()?.email || '—'
    };
    this.dialog.open(SupportContactDialogComponent, {
      maxWidth: '95vw',
      data: {
        subject: t('layout.suspended.supportSubject', params),
        message: t('layout.suspended.supportMessage', params)
      }
    });
  }

  onCompanyChange(companyId: string) {
    const company = this.companyService.companies().find(c => c.id === companyId);
    if (company) {
      this.companyService.setActiveCompany(company);
      this.router.navigate(['/painel']);
    }
  }

  /** Na web abre o subdomínio da outra conta; na app nativa troca no momento. */
  async onAccountChange(accountId: string) {
    const account = this.accountService.accounts().find(a => a.id === accountId);
    if (!account || account.id === this.accountService.activeAccount()?.id) return;
    const route = await this.accountService.homeRouteFor(account);
    this.accountService.switchAccount(account, route);
    if (!this.tenant.usesSubdomains) this.router.navigate([route]);
  }

  toggleMobileMenu() {
    this.isMobileMenuOpen.update(v => !v);
  }

  userInitials = computed(() => {
    const user = this.authService.currentUser();
    if (!user) return '';
    const fullName = user.user_metadata?.['full_name'];
    if (!fullName) {
      const email = user.email || '';
      return email.substring(0, 2).toUpperCase();
    }
    const parts = fullName.trim().split(' ').filter((p: string) => p.length > 0);
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  });

  navGroups = computed(() => {
    const overview = t('layout.navGroups.overview');
    const operations = t('layout.navGroups.operations');
    const tax = t('layout.navGroups.tax');
    const system = t('layout.navGroups.system');
    const groupNames: Record<string, string> = {
      '/painel': overview, '/assistente': overview,
      '/pos': operations, '/facturas': operations, '/clientes': operations,
      '/produtos': operations, '/impostos': tax, '/relatorios': tax,
      '/configuracoes': system, '/auditoria': system
    };
    const groups: { label: string; items: MenuItem[] }[] = [];
    for (const item of this.filteredMenuItems()) {
      const label = groupNames[item.route] || t('layout.mobile.menu');
      let group = groups.find(candidate => candidate.label === label);
      if (!group) { group = { label, items: [] }; groups.push(group); }
      group.items.push(item);
    }
    return groups;
  });

  userDisplayName = computed(() => {
    const user = this.authService.currentUser();
    return user?.user_metadata?.['full_name'] || user?.email?.split('@')[0] || t('layout.profile.user');
  });

  userRoleLabel = computed(() => {
    const role = this.companyService.activeRole();
    return t(role === 'owner' ? 'layout.roles.owner' : role === 'manager' ? 'layout.roles.manager' : 'layout.roles.user');
  });
}
