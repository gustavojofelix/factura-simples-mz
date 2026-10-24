import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LoginFormComponent } from '../../shared/components/login-form/login-form.component';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { AccountService, PublicAccountInfo } from '../../core/services/account.service';
import { TenantService } from '../../core/services/tenant.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { LanguageSwitcherComponent } from '../../shared/components/language-switcher/language-switcher.component';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule,
    LoginFormComponent,
    RouterLink,
    MatIconModule,
    TranslatePipe,
    LanguageSwitcherComponent
  ],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent implements OnInit {
  /** Conta do subdomínio actual (null na raiz). */
  account = signal<PublicAccountInfo | null>(null);
  accountNotFound = signal(false);

  constructor(
    private accountService: AccountService,
    readonly tenant: TenantService
  ) {}

  async ngOnInit() {
    const slug = this.tenant.currentSlug();
    if (!slug) return;
    const account = await this.accountService.getPublicAccount(slug);
    if (account) {
      this.account.set(account);
    } else {
      this.accountNotFound.set(true);
    }
  }
}
