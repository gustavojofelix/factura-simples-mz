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
import { MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CompanyService } from '../../core/services/company.service';
import { SubscriptionService, SubscriptionPlan } from '../../core/services/subscription.service';
import { UserManagementService, CompanyUser } from '../../core/services/user-management.service';
import { AuthService } from '../../core/services/auth.service';

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
    MatTooltipModule
  ],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.css']
})
export class SettingsComponent implements OnInit {
  company = this.companyService.activeCompany;
  subscription = this.subscriptionService.subscription;
  users = this.userManagementService.users;
  systemSettings = this.userManagementService.settings;
  currentUserId = signal<string>('');

  systemForm!: FormGroup;
  companyForm!: FormGroup;
  bankForm!: FormGroup;

  selectedTab = signal(0);
  loading = signal(false);

  availablePlans: SubscriptionPlan[] = [];
  userColumns = ['email', 'role', 'is_active', 'actions'];

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

  roles = [
    { value: 'owner', label: 'Proprietário' },
    { value: 'admin', label: 'Administrador' },
    { value: 'manager', label: 'Gestor' },
    { value: 'user', label: 'Utilizador' }
  ];

  constructor(
    private fb: FormBuilder,
    private companyService: CompanyService,
    private subscriptionService: SubscriptionService,
    private userManagementService: UserManagementService,
    private authService: AuthService,
    private snackBar: MatSnackBar
  ) {
    this.availablePlans = this.subscriptionService.availablePlans;
  }

  async ngOnInit() {
    const company = this.company();
    if (!company) return;

    const user = this.authService.currentUser();
    if (user) {
      this.currentUserId.set(user.id);
    }

    this.initializeForms();
    await this.loadData();
  }

  initializeForms() {
    const settings = this.systemSettings();

    this.systemForm = this.fb.group({
      language: [settings?.language || 'pt'],
      timezone: [settings?.timezone || 'Africa/Maputo'],
      currency: [settings?.currency || 'MZN'],
      date_format: [settings?.date_format || 'DD/MM/YYYY'],
      fiscal_year_start: [settings?.fiscal_year_start || '01-01'],
      enable_notifications: [settings?.enable_notifications ?? true],
      notification_email: [settings?.notification_email || '']
    });

    const company = this.company();
    this.companyForm = this.fb.group({
      name: [company?.name || '', Validators.required],
      nuit: [company?.nuit || '', Validators.required],
      address: [company?.address || '', Validators.required],
      phone: [company?.phone || ''],
      email: [company?.email || '', [Validators.email]],
      business_type: [company?.business_type || '']
    });

    this.bankForm = this.fb.group({
      bank_name: [company?.bank_name || ''],
      bank_account: [company?.bank_account || ''],
      bank_iban: [company?.bank_iban || ''],
      bank_swift: [company?.bank_swift || '']
    });
  }

  async loadData() {
    const company = this.company();
    if (!company) return;

    this.loading.set(true);

    await Promise.all([
      this.subscriptionService.loadSubscription(company.id),
      this.userManagementService.loadCompanyUsers(company.id),
      this.userManagementService.loadSystemSettings(company.id)
    ]);

    this.initializeForms();
    this.loading.set(false);
  }

  async saveSystemSettings() {
    if (this.systemForm.invalid) return;

    const company = this.company();
    if (!company) return;

    this.loading.set(true);
    const success = await this.userManagementService.updateSystemSettings(
      company.id,
      this.systemForm.value
    );

    this.loading.set(false);

    if (success) {
      this.snackBar.open('Configurações do sistema atualizadas com sucesso', 'Fechar', {
        duration: 3000
      });
    } else {
      this.snackBar.open('Erro ao atualizar configurações', 'Fechar', {
        duration: 3000
      });
    }
  }

  async saveCompanyDetails() {
    if (this.companyForm.invalid) return;

    const company = this.company();
    if (!company) return;

    this.loading.set(true);
    const success = await this.companyService.updateCompany(
      company.id,
      this.companyForm.value
    );

    this.loading.set(false);

    if (success) {
      this.snackBar.open('Dados da empresa atualizados com sucesso', 'Fechar', {
        duration: 3000
      });
    } else {
      this.snackBar.open('Erro ao atualizar dados da empresa', 'Fechar', {
        duration: 3000
      });
    }
  }

  async saveBankDetails() {
    if (this.bankForm.invalid) return;

    const company = this.company();
    if (!company) return;

    this.loading.set(true);
    const success = await this.companyService.updateCompany(
      company.id,
      this.bankForm.value
    );

    this.loading.set(false);

    if (success) {
      this.snackBar.open('Dados bancários atualizados com sucesso', 'Fechar', {
        duration: 3000
      });
    } else {
      this.snackBar.open('Erro ao atualizar dados bancários', 'Fechar', {
        duration: 3000
      });
    }
  }

  async uploadLogo(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    this.snackBar.open('Upload de logo será implementado em breve', 'Fechar', {
      duration: 3000
    });
  }

  async uploadNuitDocument(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    this.snackBar.open('Upload de documento NUIT será implementado em breve', 'Fechar', {
      duration: 3000
    });
  }

  async changePlan(plan: SubscriptionPlan, cycle: 'monthly' | 'yearly') {
    const subscription = this.subscription();
    if (!subscription) return;

    this.loading.set(true);
    const success = await this.subscriptionService.changePlan(
      subscription.id,
      plan.name,
      cycle
    );

    this.loading.set(false);

    if (success) {
      this.snackBar.open('Plano alterado com sucesso', 'Fechar', {
        duration: 3000
      });
    } else {
      this.snackBar.open('Erro ao alterar plano', 'Fechar', {
        duration: 3000
      });
    }
  }

  async updateUserRole(user: CompanyUser, newRole: string) {
    const company = this.company();
    if (!company) return;

    const success = await this.userManagementService.updateUserRole(
      user.user_id,
      company.id,
      newRole as CompanyUser['role']
    );

    if (success) {
      this.snackBar.open('Papel do utilizador atualizado', 'Fechar', {
        duration: 3000
      });
    } else {
      this.snackBar.open('Erro ao atualizar papel do utilizador', 'Fechar', {
        duration: 3000
      });
    }
  }

  async toggleUserActive(user: CompanyUser) {
    const company = this.company();
    if (!company) return;

    const success = await this.userManagementService.toggleUserActive(
      user.user_id,
      company.id,
      !user.is_active
    );

    if (success) {
      this.snackBar.open(
        user.is_active ? 'Utilizador desativado' : 'Utilizador ativado',
        'Fechar',
        { duration: 3000 }
      );
    } else {
      this.snackBar.open('Erro ao alterar status do utilizador', 'Fechar', {
        duration: 3000
      });
    }
  }

  async removeUser(user: CompanyUser) {
    if (!confirm(`Tem certeza que deseja remover ${user.user_email}?`)) return;

    const company = this.company();
    if (!company) return;

    const success = await this.userManagementService.removeUser(
      user.user_id,
      company.id
    );

    if (success) {
      this.snackBar.open('Utilizador removido', 'Fechar', {
        duration: 3000
      });
    } else {
      this.snackBar.open('Erro ao remover utilizador', 'Fechar', {
        duration: 3000
      });
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

  getRoleLabel(role: string): string {
    const labels: Record<string, string> = {
      owner: 'Proprietário',
      admin: 'Administrador',
      manager: 'Gestor',
      user: 'Utilizador'
    };
    return labels[role] || role;
  }

  canManageUsers(): boolean {
    const userId = this.currentUserId();
    return this.userManagementService.isUserOwnerOrAdmin(userId);
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
