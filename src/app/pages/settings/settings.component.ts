import { Component, DestroyRef, OnInit, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { SUBSCRIPTION_TAB_INDEX } from '../../core/guards/subscription.guard';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatTabsModule } from '@angular/material/tabs';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CompanyService, Company } from '../../core/services/company.service';
import { AccountService } from '../../core/services/account.service';
import { TenantService } from '../../core/services/tenant.service';
import { SubscriptionService, SubscriptionPlan, BillingCycle } from '../../core/services/subscription.service';
import { UserManagementService, UserWithCompanies } from '../../core/services/user-management.service';
import { AuthService } from '../../core/services/auth.service';
import { CompanyDialogComponent } from '../../shared/components/company-dialog.component';
import { UserCompanyDialogComponent } from '../../shared/components/user-company-dialog.component';
import { PaymentDialogComponent } from '../../shared/components/payment-dialog/payment-dialog.component';
import { ActivityService } from '../../core/services/activity.service';
import { CompanyBankAccountService } from '../../core/services/company-bank-account.service';
import { SubscriptionLimitDialogComponent } from '../../shared/components/subscription-limit-dialog.component';
import { DocumentSettingsTabComponent } from './document-settings-tab/document-settings-tab.component';
import { friendlyErrorMessage } from '../../core/utils/error-message';
import { PreferencesService } from '../../core/services/preferences.service';
import { currentLocale, t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatTabsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatIconModule,
    MatTableModule,
    MatChipsModule,
    MatDialogModule,
    MatSnackBarModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    DocumentSettingsTabComponent,
    TranslatePipe
  ],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.css']
})
export class SettingsComponent implements OnInit {
  companies = this.companyService.companies;
  allUsers = this.userManagementService.allUsers;
  currentUserId = signal<string>('');

  systemForm!: FormGroup;
  selectedCompanyId = signal<string | null>(null);
  /** Lê directamente do serviço: actualiza sozinho quando o plano é activado (polling/webhook). */
  subscription = this.subscriptionService.subscription;

  selectedTab = signal(0);
  private destroyRef = inject(DestroyRef);
  private router = inject(Router);

  /** Subscrição da empresa activa expirada: só o separador de subscrição fica disponível. */
  locked = computed(() => {
    const active = this.companyService.activeCompany();
    const sub = this.subscription();
    return !!active && sub?.company_id === active.id && this.subscriptionService.isExpired();
  });
  loading = signal(false);
  selectedCycle = signal<'monthly' | 'quarterly' | 'semiannual' | 'yearly'>('monthly');

  get availablePlans(): SubscriptionPlan[] {
    return this.subscriptionService.availablePlans
      .filter((p) => p.is_active !== false)
      .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
  }
  companyColumns = ['name', 'nuit', 'phone', 'actions'];
  userColumns = ['email', 'companies', 'actions'];

  timezones = [
    { value: 'Africa/Maputo', label: 'Africa/Maputo (CAT)' },
    { value: 'Africa/Johannesburg', label: 'Africa/Johannesburg (SAST)' },
    { value: 'UTC', label: 'UTC' }
  ];

  dateFormats = [
    { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY' },
    { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
    { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD' }
  ];

  constructor(
    private fb: FormBuilder,
    private companyService: CompanyService,
    public subscriptionService: SubscriptionService,
    private userManagementService: UserManagementService,
    private authService: AuthService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar,
    private activityService: ActivityService,
    private bankAccountService: CompanyBankAccountService,
    private route: ActivatedRoute,
    private preferences: PreferencesService,
    public accountService: AccountService,
    private tenant: TenantService
  ) {
    effect(() => {
      const account = this.accountService.activeAccount();
      if (account && !this.accountNameControl.dirty) {
        this.accountNameControl.setValue(account.name || '', { emitEvent: false });
      }
    });

    effect(() => {
      if (this.locked() && this.selectedTab() !== SUBSCRIPTION_TAB_INDEX) {
        this.selectedTab.set(SUBSCRIPTION_TAB_INDEX);
      }
    }, { allowSignalWrites: true });
  }

  async ngOnInit() {
    const user = this.authService.currentUser();
    if (user) {
      this.currentUserId.set(user.id);
    }

    // ?tab=subscricao ("Ver Planos", limite do plano, subscrição expirada) abre o
    // separador Subscrições — também quando já se está nesta página, porque o
    // componente é reaproveitado e o ngOnInit não volta a correr.
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      if (params.get('tab') === 'subscricao') {
        this.selectedTab.set(SUBSCRIPTION_TAB_INDEX);
      }
    });

    this.initializeForms();
    await this.loadAllData();
  }

  /**
   * Ao sair do separador Subscrições, retira ?tab=subscricao do URL; senão um
   * novo "Ver Planos" navegaria para o mesmo URL e o router ignorá-lo-ia.
   */
  onTabChange(index: number) {
    if (index !== SUBSCRIPTION_TAB_INDEX && this.route.snapshot.queryParamMap.get('tab') === 'subscricao') {
      this.router.navigate([], { relativeTo: this.route, queryParams: { tab: null }, queryParamsHandling: 'merge', replaceUrl: true });
    }
  }

  initializeForms() {
    this.systemForm = this.fb.group({
      // Moeda Padrão e Início do Ano Fiscal não são usados pela aplicação
      // (moeda é sempre MZN; o ano fiscal é o ano civil) — por isso não aparecem.
      timezone: ['Africa/Maputo', Validators.required],
      date_format: ['DD/MM/YYYY', Validators.required],
      enable_notifications: [true],
      // Mesma regra do CHECK system_settings_notification_email_check e do isEmail() das edge functions
      notification_email: ['', [Validators.email, Validators.pattern(/^[^@\s]+@[^@\s]+\.[^@\s]+$/), Validators.maxLength(254)]]
    });
  }

  async loadAllData() {
    this.loading.set(true);
    // Os utilizadores dependem das empresas do subscritor, por isso vêm depois.
    await this.companyService.loadCompanies();
    await this.loadUsers();
    const list = this.companies();
    if (list.length > 0 && !this.selectedCompanyId()) {
      const active = this.companyService.activeCompany();
      await this.loadCompanySettings(active && list.some(c => c.id === active.id) ? active.id : list[0].id);
    }
    this.loading.set(false);
  }

  async loadCompanySettings(companyId: string) {
    this.selectedCompanyId.set(companyId);
    this.loading.set(true);

    await Promise.all([
      this.subscriptionService.loadSubscription(companyId),
      this.userManagementService.loadSystemSettings(companyId)
    ]);

    const settings = this.userManagementService.settings();
    this.systemForm.reset({
      timezone: settings?.timezone || 'Africa/Maputo',
      date_format: settings?.date_format || 'DD/MM/YYYY',
      enable_notifications: settings?.enable_notifications ?? true,
      notification_email: settings?.notification_email || ''
    });
    // Só o proprietário pode alterar (RLS): para os restantes o formulário fica só de leitura.
    if (this.canEditSystemSettings()) {
      this.systemForm.enable();
    } else {
      this.systemForm.disable();
    }

    this.loading.set(false);
  }

  accountNameControl = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(2)] });
  savingAccountName = signal(false);

  accountAddress(): string {
    const account = this.accountService.activeAccount();
    return account ? this.tenant.accountOrigin(account.slug) : '';
  }

  async saveAccountName() {
    if (this.accountNameControl.invalid) return;
    this.savingAccountName.set(true);
    try {
      await this.accountService.updateAccountName(this.accountNameControl.value.trim());
      this.accountNameControl.markAsPristine();
      this.snackBar.open(t('settings.messages.accountNameUpdated'), t('common.actions.close'), { duration: 3000, panelClass: ['success-snackbar'] });
    } catch (error) {
      this.snackBar.open(friendlyErrorMessage(error, t('settings.messages.accountUpdateFailed')), t('common.actions.close'), {
        duration: 5000,
        panelClass: ['error-snackbar']
      });
    } finally {
      this.savingAccountName.set(false);
    }
  }

  /** As configurações do sistema só podem ser alteradas pelo proprietário da empresa. */
  canEditSystemSettings(): boolean {
    const id = this.selectedCompanyId();
    return !!id && this.companyService.isOwner(id);
  }

  async saveSystemSettings() {
    if (!this.canEditSystemSettings()) {
      this.snackBar.open(t('settings.messages.ownerOnly'), t('common.actions.close'), { duration: 5000 });
      return;
    }
    if (this.systemForm.invalid) {
      this.systemForm.markAllAsTouched();
      return;
    }

    const companyId = this.selectedCompanyId();
    if (!companyId) {
      this.snackBar.open(t('settings.messages.selectCompanyFirst'), t('common.actions.close'), { duration: 3000 });
      return;
    }

    this.loading.set(true);
    const values = this.systemForm.getRawValue();
    const notificationEmail = (values.notification_email || '').trim();
    const result = await this.userManagementService.updateSystemSettings(companyId, {
      ...values,
      language: 'pt',
      notification_email: notificationEmail || null
    } as any);

    this.loading.set(false);

    if (result.ok) {
      if (result.data) this.preferences.applyIfActive(companyId, result.data);
      this.snackBar.open(t('settings.messages.settingsUpdated'), t('common.actions.close'), {
        duration: 3000
      });
    } else {
      this.snackBar.open(result.error || t('settings.messages.settingsUpdateError'), t('common.actions.close'), {
        duration: 6000
      });
    }
  }

  openCompanyDialog(company?: Company) {
    const dialogRef = this.dialog.open(CompanyDialogComponent, {
      data: { company },
      maxWidth: '95vw'
    });

    dialogRef.afterClosed().subscribe(async (result) => {
      if (!result) return;
      const { companyActivities, bankAccounts, ...companyData } = result;
      try {
        if (company) {
          await this.companyService.updateCompanyOrThrow(company.id, companyData);
          await this.activityService.saveCompanyActivities(company.id, companyActivities || []);
          // undefined = as contas não chegaram a ser carregadas no diálogo; não mexer.
          if (bankAccounts) await this.bankAccountService.saveForCompany(company.id, bankAccounts);
          this.snackBar.open(t('settings.messages.companyUpdated'), t('common.actions.close'), { duration: 3000 });
          await this.companyService.loadCompanies();
        } else {
          const newCompany = await this.companyService.createCompany(companyData);
          if (newCompany) {
            await this.activityService.saveCompanyActivities(newCompany.id, companyActivities || []);
            if (bankAccounts?.length) await this.bankAccountService.saveForCompany(newCompany.id, bankAccounts);
            this.snackBar.open(t('settings.messages.companyCreated'), t('common.actions.close'), { duration: 3000 });
            await this.companyService.loadCompanies();
          } else {
            this.snackBar.open(t('settings.messages.sessionExpiredCreate'), t('common.actions.close'), { duration: 6000 });
          }
        }
      } catch (error: any) {
        console.error(company ? 'Erro ao actualizar empresa:' : 'Erro ao criar empresa:', error);
        if (this.isPlanLimitError(error)) {
          this.dialog.open(SubscriptionLimitDialogComponent, {
            width: '420px',
            panelClass: 'subscription-limit-dialog',
            data: { errorMessage: error?.message }
          });
          return;
        }
        const fallback = company ? t('settings.messages.companyUpdateFailed') : t('settings.messages.companyCreateFailed');
        this.snackBar.open(friendlyErrorMessage(error, fallback), t('common.actions.close'), { duration: 8000 });
      }
    });
  }

  /** Erros de limite/funcionalidade do plano levantados pelos triggers de subscrição. */
  private isPlanLimitError(error: any): boolean {
    if (error?.code !== 'P0001') return false;
    if (['SUBSCRIPTION_FEATURE_DISABLED', 'SUBSCRIPTION_LIMIT_REACHED', 'SUBSCRIPTION_EXPIRED'].includes(error?.details)) return true;
    return /plano|subscri/i.test(error?.message ?? '');
  }

  async deleteCompany(company: Company) {
    if (!confirm(t('settings.messages.deleteCompanyConfirm', { name: company.name }))) return;

    const result = await this.companyService.deleteCompany(company.id);
    if (result.success) {
      this.snackBar.open(t('settings.messages.companyDeleted'), t('common.actions.close'), { duration: 3000 });
    } else {
      this.snackBar.open(result.error || t('settings.messages.companyDeleteFailed'), t('common.actions.close'), { duration: 6000 });
    }
  }

  openUserDialog(user?: UserWithCompanies) {
    const dialogRef = this.dialog.open(UserCompanyDialogComponent, {
      data: {
        userId: user?.user_id,
        userEmail: user?.user_email,
        userCompanies: user?.companies
      },
      maxWidth: '95vw'
    });

    dialogRef.afterClosed().subscribe(async (result) => {
      if (!result) return;
      this.loading.set(true);
      const inviter = this.authService.currentUser();
      const inviterName = inviter?.user_metadata?.['full_name'] || inviter?.email || undefined;

      const newCompanies: Array<{ company_id: string; role: string }> = result.companies || [];
      const newCompanyIds = new Set(newCompanies.map(c => c.company_id));
      const errors: string[] = [];
      const warnings: string[] = [];

      // Ao editar, remover o acesso às empresas desmarcadas (só as do proprietário, nunca o próprio owner)
      if (user) {
        for (const oldComp of user.companies) {
          if (oldComp.role === 'owner' || !this.companyService.isOwner(oldComp.company_id)) continue;
          if (!newCompanyIds.has(oldComp.company_id)) {
            const res = await this.userManagementService.removeUserFromCompany(user.user_id, oldComp.company_id);
            if (!res.ok) errors.push(`${oldComp.company_name}: ${res.error}`);
          }
        }
      }

      for (let i = 0; i < newCompanies.length; i++) {
        const { company_id, role } = newCompanies[i];
        const companyName = this.getCompanyName(company_id);
        const res = await this.userManagementService.addUserToCompany(
          result.email,
          company_id,
          role as any,
          result.fullName || undefined,
          result.phone || undefined,
          companyName,
          inviterName
        );
        if (!res.ok) errors.push(newCompanies.length > 1 ? `${companyName}: ${res.error}` : res.error!);
        if (res.warning) warnings.push(res.warning);
      }

      this.loading.set(false);
      await this.loadUsers();

      if (errors.length) {
        this.snackBar.open(errors.join(' | '), t('common.actions.close'), { duration: 10000 });
      } else if (warnings.length) {
        this.snackBar.open(warnings[0], t('common.actions.close'), { duration: 10000 });
      } else {
        this.snackBar.open(
          user ? t('settings.messages.accessUpdated') : t('settings.messages.inviteSent', { email: result.email }),
          t('common.actions.close'),
          { duration: 4000 }
        );
      }
    });
  }

  /** Utilizadores das empresas do subscritor activo. */
  private loadUsers(): Promise<void> {
    return this.userManagementService.loadAllUsers(this.companies().map(c => c.id));
  }

  /** Só o proprietário de pelo menos uma empresa pode convidar (RLS e função invite-user). */
  canInviteUsers = computed(() => this.companies().some(c => this.companyService.isOwner(c.id)));

  /** O proprietário (e o próprio utilizador) não são geridos a partir desta lista. */
  canManageUser(user: UserWithCompanies): boolean {
    if (user.user_id === this.currentUserId()) return false;
    return user.companies.some(c => c.role !== 'owner' && this.companyService.isOwner(c.company_id));
  }

  /** Retira ao utilizador o acesso a todas as empresas que o utilizador actual gere. */
  async revokeUserAccess(user: UserWithCompanies) {
    const managed = user.companies.filter(c => c.role !== 'owner' && this.companyService.isOwner(c.company_id));
    if (!managed.length) return;
    if (!confirm(t('settings.messages.revokeAccessConfirm', {
      email: user.user_email,
      companies: managed.map(c => c.company_name).join(', ')
    }))) return;

    this.loading.set(true);
    const errors: string[] = [];
    for (const company of managed) {
      const res = await this.userManagementService.removeUserFromCompany(user.user_id, company.company_id);
      if (!res.ok) errors.push(managed.length > 1 ? `${company.company_name}: ${res.error}` : res.error!);
    }
    await this.loadUsers();
    this.loading.set(false);

    if (errors.length) {
      this.snackBar.open(errors.join(' | '), t('common.actions.close'), { duration: 8000 });
    } else {
      this.snackBar.open(t('settings.messages.accessRemoved'), t('common.actions.close'), { duration: 3000 });
    }
  }

  async removeUserFromCompany(userId: string, companyId: string) {
    if (!confirm(t('settings.messages.removeAccessConfirm'))) return;

    const result = await this.userManagementService.removeUserFromCompany(userId, companyId);
    if (result.ok) {
      await this.loadUsers();
      this.snackBar.open(t('settings.messages.accessRemoved'), t('common.actions.close'), { duration: 3000 });
    } else {
      this.snackBar.open(result.error || t('settings.messages.removeAccessFailed'), t('common.actions.close'), { duration: 6000 });
    }
  }

  async changePlan(plan: SubscriptionPlan, cycle?: 'monthly' | 'quarterly' | 'semiannual' | 'yearly') {
    const targetCycle = cycle || this.selectedCycle();
    const sub = this.subscription();
    const companyId = this.selectedCompanyId();

    if (!companyId) {
      this.snackBar.open(t('settings.messages.selectCompanyFirst'), t('common.actions.close'), { duration: 3000 });
      return;
    }

    if (this.isDowngrade(plan, targetCycle)) {
      this.snackBar.open(this.downgradeBlockedMessage(plan, targetCycle), t('common.actions.close'), { duration: 6000 });
      return;
    }

    if (plan.monthly_price > 0) {
      // Launch Mobile Payment Dialog for M-Pesa / e-Mola
      const dialogRef = this.dialog.open(PaymentDialogComponent, {
        data: {
          companyId,
          subscriptionId: sub?.id,
          plan,
          billingCycle: targetCycle
        },
        width: '450px',
        maxWidth: '95vw',
        panelClass: 'dark-dialog'
      });

      dialogRef.afterClosed().subscribe(async (success) => {
        if (success) {
          await this.loadCompanySettings(companyId);
        }
      });
      return;
    }

    this.loading.set(true);
    const success = await this.subscriptionService.changePlan(
      sub?.id || '',
      plan.name,
      targetCycle,
      companyId
    );

    if (success) {
      await this.loadCompanySettings(companyId);
    }

    this.loading.set(false);

    if (success) {
      this.snackBar.open(t('settings.messages.planChanged'), t('common.actions.close'), { duration: 3000 });
    } else {
      this.snackBar.open(t('settings.messages.planChangeError'), t('common.actions.close'), { duration: 3000 });
    }
  }

  getStatusColor(status: string): string {
    const colors: Record<string, string> = {
      active: 'bg-green-500',
      trialing: 'bg-blue-500',
      past_due: 'bg-red-500',
      cancelled: 'bg-gray-500'
    };
    return colors[status] || 'bg-gray-500';
  }

  getStatusLabel(status: string): string {
    const keys: Record<string, string> = {
      active: 'settings.status.active',
      trialing: 'settings.status.trialing',
      past_due: 'settings.status.pastDue',
      cancelled: 'settings.status.cancelled'
    };
    return keys[status] ? t(keys[status]) : status;
  }

  getCycleLabel(cycle: string): string {
    const keys: Record<string, string> = {
      monthly: 'settings.cycles.monthly',
      quarterly: 'settings.cycles.quarterly',
      semiannual: 'settings.cycles.semiannual',
      yearly: 'settings.cycles.yearly'
    };
    return keys[cycle] ? t(keys[cycle]) : cycle;
  }

  getPlanPriceForCycle(plan: SubscriptionPlan, cycle: 'monthly' | 'quarterly' | 'semiannual' | 'yearly'): number {
    switch (cycle) {
      case 'quarterly':
        return plan.three_months_price || (plan.monthly_price * 3);
      case 'semiannual':
        return plan.six_months_price || (plan.monthly_price * 6);
      case 'yearly':
        return plan.yearly_price;
      case 'monthly':
      default:
        return plan.monthly_price;
    }
  }

  getRoleLabel(role: string): string {
    const keys: Record<string, string> = {
      owner: 'settings.roles.owner',
      admin: 'settings.roles.admin',
      manager: 'settings.roles.manager',
      user: 'settings.roles.user',
      invited: 'settings.roles.invited'
    };
    return keys[role] ? t(keys[role]) : role;
  }

  getCompanyName(companyId: string): string {
    return this.companies().find(c => c.id === companyId)?.name || 'Unknown';
  }

  formatCurrency(value: number, currency?: string): string {
    const curr = currency || 'MZN';
    const formatted = new Intl.NumberFormat(currentLocale(), {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
    return `${formatted} ${curr}`;
  }

  formatDate(date: string): string {
    return this.preferences.formatDate(date);
  }

  /** Mudar para este plano (no ciclo seleccionado) seria um downgrade bloqueado? */
  isDowngrade(plan: SubscriptionPlan, cycle: BillingCycle = this.selectedCycle()): boolean {
    return this.subscriptionService.isDowngrade(plan, cycle);
  }

  /** Subscrição actual activa (não expirada): só é possível fazer upgrade. */
  hasActivePeriod(): boolean {
    return this.subscriptionService.hasActivePeriod();
  }

  /** O plano é de nível superior ao actual (para mostrar "Fazer Upgrade"). */
  isUpgrade(plan: SubscriptionPlan): boolean {
    const current = this.subscriptionService.currentPlanLevel();
    if (!current || !this.hasActivePeriod()) return false;
    const curTier = current.tier ?? 0;
    const newTier = this.subscriptionService.planTier(plan) ?? 0;
    return newTier > curTier;
  }

  downgradeBlockedMessage(plan: SubscriptionPlan, cycle: BillingCycle = this.selectedCycle()): string {
    if (plan.monthly_price === 0) {
      return t('settings.messages.downgradeToTrial');
    }
    if (this.subscriptionService.isDowngrade(plan)) {
      return t('settings.messages.downgradeActive');
    }
    return t('settings.messages.shorterCycleBlocked');
  }

  /** O bloqueio deste plano é só pelo ciclo mais curto (deixa de valer quando a subscrição expirar). */
  isCycleOnlyDowngrade(plan: SubscriptionPlan): boolean {
    return this.isDowngrade(plan) && !this.subscriptionService.isDowngrade(plan);
  }
}
