import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatTabsModule } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';

/** Separadores de navegação entre os relatórios. */
@Component({
  selector: 'app-reports-nav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, MatTabsModule, MatIconModule],
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
          {{ link.label }}
        </a>
      }
    </nav>
    <mat-tab-nav-panel #tabPanel></mat-tab-nav-panel>
  `
})
export class ReportsNavComponent {
  links = [
    { label: 'Vendas', icon: 'assessment', route: '/relatorios', exact: true },
    { label: 'Extracto de clientes', icon: 'account_balance_wallet', route: '/relatorios/extractos', exact: false },
    { label: 'Ficheiro SAF-T', icon: 'description', route: '/relatorios/saft', exact: false }
  ];
}
