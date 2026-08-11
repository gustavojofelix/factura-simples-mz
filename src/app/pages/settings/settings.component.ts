import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
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
import { SubscriptionService, SubscriptionPlan } from '../../core/services/subscription.service';
import { UserManagementService, UserWithCompanies } from '../../core/services/user-management.service';
import { AuthService } from '../../core/services/auth.service';
import { CompanyDialogComponent } from '../../shared/components/company-dialog.component';
import { UserCompanyDialogComponent } from '../../shared/components/user-company-dialog.component';
import { PaymentDialogComponent } from '../../shared/components/payment-dialog/payment-dialog.component';
import { ActivityService } from '../../core/services/activity.service';

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
    MatProgressSpinnerModule
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
  subscription = signal<any>(null);

  selectedTab = signal(0);
  loading = signal(false);
  selectedCycle = signal<'monthly' | 'quarterly' | 'semiannual' | 'yearly'>('monthly');

  get availablePlans(): SubscriptionPlan[] {
    return this.subscriptionService.availablePlans.filter((p) => p.is_active !== false);
  }
  companyColumns = ['name', 'nuit', 'phone', 'actions'];
  userColumns = ['email', 'companies', 'actions'];

  languages = [
    { value: 'pt', label: 'Português' },
    { value: 'en', label: 'English' }
  ];

  timezones = [
    { value: 'Africa/Maputo', label: 'Africa/Maputo (CAT)' },
    { value: 'Africa/Johannesburg', label: 'Africa/Johannesburg (SAST)' },
    { value: 'UTC', label: 'UTC' }
  ];

  currencies = [
    { value: 'MZN', label: 'Metical (MZN)' },
    { value: 'USD', label: 'Dólar (USD)' },
    { value: 'EUR', label: 'Euro (EUR)' }
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
    private activityService: ActivityService
  ) {}

  async ngOnInit() {
    const user = this.authService.currentUser();
    if (user) {
      this.currentUserId.set(user.id);
    }

    this.initializeForms();
    await this.loadAllData();
  }

  initializeForms() {
    this.systemForm = this.fb.group({
      language: ['pt'],
      timezone: ['Africa/Maputo'],
      currency: ['MZN'],
      date_format: ['DD/MM/YYYY'],
      fiscal_year_start: ['01-01'],
      enable_notifications: [true],
      notification_email: ['']
    });
  }

  async loadAllData() {
    this.loading.set(true);
    await Promise.all([
      this.companyService.loadCompanies(),
      this.userManagementService.loadAllUsers()
    ]);
    const list = this.companies();
    if (list.length > 0 && !this.selectedCompanyId()) {
      await this.loadCompanySettings(list[0].id);
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

    const sub = this.subscriptionService.subscription();
    this.subscription.set(sub);

    const settings = this.userManagementService.settings();
    if (settings) {
      this.systemForm.patchValue(settings);
    }

    this.loading.set(false);
  }

  async saveSystemSettings() {
    if (this.systemForm.invalid) return;

    const companyId = this.selectedCompanyId();
    if (!companyId) {
      this.snackBar.open('Selecione uma empresa primeiro', 'Fechar', { duration: 3000 });
      return;
    }

    this.loading.set(true);
    const success = await this.userManagementService.updateSystemSettings(
      companyId,
      this.systemForm.value
    );

    this.loading.set(false);

    if (success) {
      this.snackBar.open('Configurações atualizadas com sucesso', 'Fechar', {
        duration: 3000
      });
    } else {
      this.snackBar.open('Erro ao atualizar configurações', 'Fechar', {
        duration: 3000
      });
    }
  }

  openCompanyDialog(company?: Company) {
    const dialogRef = this.dialog.open(CompanyDialogComponent, {
      data: { company },
      maxWidth: '95vw'
    });

    dialogRef.afterClosed().subscribe(async (result) => {
      if (result) {
        const { companyActivities, ...companyData } = result;
        if (company) {
          const success = await this.companyService.updateCompany(company.id, companyData);
          if (success) {
            await this.activityService.saveCompanyActivities(company.id, companyActivities || []);
            this.snackBar.open('Empresa atualizada com sucesso', 'Fechar', { duration: 3000 });
            await this.companyService.loadCompanies();
          }
        } else {
          const newCompany = await this.companyService.createCompany(companyData);
          if (newCompany) {
            await this.activityService.saveCompanyActivities(newCompany.id, companyActivities || []);
            this.snackBar.open('Empresa criada com sucesso', 'Fechar', { duration: 3000 });
            await this.companyService.loadCompanies();
          }
        }
      }
    });
  }

  async deleteCompany(company: Company) {
    if (!confirm(`Tem certeza que deseja eliminar a empresa "${company.name}"?`)) return;

    const success = await this.companyService.deleteCompany(company.id);
    if (success) {
      this.snackBar.open('Empresa eliminada com sucesso', 'Fechar', { duration: 3000 });
    }
  }

  openUserDialog(user?: UserWithCompanies) {
    const dialogRef = this.dialog.open(UserCompanyDialogComponent, {
      data: { user, companies: this.companies() },
      maxWidth: '95vw'
    });

    dialogRef.afterClosed().subscribe(async (result) => {
      if (result) {
        this.loading.set(true);
        const inviter = this.authService.currentUser();
        const inviterName = inviter?.user_metadata?.['full_name'] || inviter?.email || 'Um administrador';

        for (let i = 0; i < result.assignments.length; i++) {
          const { company_id, role } = result.assignments[i];
          const companyName = this.getCompanyName(company_id);
          const translatedRole = this.getRoleLabel(role);

          await this.userManagementService.addUserToCompany(
            result.email,
            company_id,
            role as any,
            i === 0 ? result.fullName : undefined,
            i === 0 ? result.phone : undefined,
            companyName,
            inviterName,
            translatedRole
          );
        }

        this.loading.set(false);
        await this.userManagementService.loadAllUsers();

        this.snackBar.open(
          user ? 'Acesso atualizado com sucesso' : 'Utilizador adicionado com sucesso',
          'Fechar',
          { duration: 3000 }
        );
      }
    });
  }

  async removeUserFromCompany(userId: string, companyId: string) {
    if (!confirm('Tem certeza que deseja remover este acesso?')) return;

    const success = await this.userManagementService.removeUserFromCompany(userId, companyId);
    if (success) {
      await this.userManagementService.loadAllUsers();
      this.snackBar.open('Acesso removido com sucesso', 'Fechar', { duration: 3000 });
    }
  }

  async changePlan(plan: SubscriptionPlan, cycle?: 'monthly' | 'quarterly' | 'semiannual' | 'yearly') {
    const targetCycle = cycle || this.selectedCycle();
    const sub = this.subscription();
    const companyId = this.selectedCompanyId();

    if (!companyId) {
      this.snackBar.open('Selecione uma empresa primeiro', 'Fechar', { duration: 3000 });
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
      this.snackBar.open('Plano alterado com sucesso', 'Fechar', { duration: 3000 });
    } else {
      this.snackBar.open('Erro ao alterar plano', 'Fechar', { duration: 3000 });
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
    const labels: Record<string, string> = {
      active: 'Ativo',
      trialing: 'Teste',
      past_due: 'Em Atraso',
      cancelled: 'Cancelado'
    };
    return labels[status] || status;
  }

  getCycleLabel(cycle: string): string {
    const labels: Record<string, string> = {
      monthly: 'Mensal (1 Mês)',
      quarterly: 'Trimestral (3 Meses)',
      semiannual: 'Semestral (6 Meses)',
      yearly: 'Anual (1 Ano)'
    };
    return labels[cycle] || cycle;
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
    const labels: Record<string, string> = {
      owner: 'Proprietário',
      admin: 'Administrador',
      manager: 'Gestor',
      user: 'Utilizador',
      invited: 'Convidado'
    };
    return labels[role] || role;
  }

  getCompanyName(companyId: string): string {
    return this.companies().find(c => c.id === companyId)?.name || 'Unknown';
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('pt-MZ', {
      style: 'currency',
      currency: 'MZN'
    }).format(value);
  }

  formatDate(date: string): string {
    return new Date(date).toLocaleDateString('pt-MZ');
  }
}
