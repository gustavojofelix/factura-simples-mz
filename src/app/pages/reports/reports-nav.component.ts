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
    <!-- No telemóvel os separadores ficam só com texto e deslizam (setas do Material) se não couberem. -->
    <nav mat-tab-nav-bar [tabPanel]="tabPanel" mat-stretch-tabs="false" class="reports-nav mb-4 sm:mb-6">
      @for (link of links; track link.route) {
        <a
          mat-tab-link
          [routerLink]="link.route"
          routerLinkActive
          #rla="routerLinkActive"
          [routerLinkActiveOptions]="{ exact: link.exact }"
          [active]="rla.isActive"
        >
          <mat-icon class="!hidden sm:!inline-block mr-2 !text-[20px]">{{ link.icon }}</mat-icon>
          {{ link.label | t }}
        </a>
      }
    </nav>
    <mat-tab-nav-panel #tabPanel></mat-tab-nav-panel>
  `,
  styles: [`
    :host { display: block; max-width: 100%; overflow: hidden; }
    @media (max-width: 599.98px) {
      .reports-nav ::ng-deep .mdc-tab { min-width: 0; padding: 0 .875rem; }
    }
  `]
})
export class ReportsNavComponent {
  links = [
    { label: 'reports.nav.sales', icon: 'assessment', route: '/relatorios', exact: true },
    { label: 'reports.nav.clientStatements', icon: 'account_balance_wallet', route: '/relatorios/extractos', exact: false },
    { label: 'reports.nav.saft', icon: 'description', route: '/relatorios/saft', exact: false }
  ];
}
