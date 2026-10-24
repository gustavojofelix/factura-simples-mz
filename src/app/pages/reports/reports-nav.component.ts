import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatTabsModule } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

/** Separadores de navegação entre os relatórios. */
@Component({
  selector: 'app-reports-nav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, MatTabsModule, MatIconModule, TranslatePipe],
  template: `
    <nav mat-tab-nav-bar [tabPanel]="tabPanel" class="mb-6">
      @for (link of links; track link.route) {
        <a
          mat-tab-link
          [routerLink]="link.route"
          routerLinkActive
          #rla="routerLinkActive"
          [routerLinkActiveOptions]="{ exact: link.exact }"
          [active]="rla.isActive"
        >
          <mat-icon class="mr-2 !text-[20px]">{{ link.icon }}</mat-icon>
          {{ link.label | t }}
        </a>
      }
    </nav>
    <mat-tab-nav-panel #tabPanel></mat-tab-nav-panel>
  `
})
export class ReportsNavComponent {
  links = [
    { label: 'reports.nav.sales', icon: 'assessment', route: '/relatorios', exact: true },
    { label: 'reports.nav.clientStatements', icon: 'account_balance_wallet', route: '/relatorios/extractos', exact: false },
    { label: 'reports.nav.saft', icon: 'description', route: '/relatorios/saft', exact: false }
  ];
}
