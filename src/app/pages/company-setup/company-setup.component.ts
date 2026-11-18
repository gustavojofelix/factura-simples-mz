import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthService } from '../../core/services/auth.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { CompanyService } from '../../core/services/company.service';
import { AccountService } from '../../core/services/account.service';
import { AuditLogService } from '../../core/services/audit-log.service';
import { ErrorDialogService } from '../../core/services/error-dialog.service';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { LanguageSwitcherComponent } from '../../shared/components/language-switcher/language-switcher.component';
import { DEMO_BUSINESS_TYPES, asDemoBusinessType } from '../../core/constants/demo-business-types';

/**
 * /configurar-empresa: cria a primeira empresa da conta só com o nome.
 * NUIT, endereço, tipo de entidade e actividades completam-se depois em
 * Configurações. Quem acabou de se registar já indicou o nome (e se quer dados
 * de demonstração) no registo: nesse caso a empresa é criada sem perguntar nada.
 */
@Component({
  selector: 'app-company-setup',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatCheckboxModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    TranslatePipe,
    LanguageSwitcherComponent
  ],
  templateUrl: './company-setup.component.html',
  styleUrls: ['./company-setup.component.css']
})
export class CompanySetupComponent implements OnInit {
  private readonly errorDialog = inject(ErrorDialogService);
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly supabase = inject(SupabaseService);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);
  private readonly companyService = inject(CompanyService);
  private readonly accountService = inject(AccountService);
  private readonly auditLogService = inject(AuditLogService);

  form: FormGroup = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    loadDemoData: [true],
    demoBusinessType: ['services']
  });

  readonly demoBusinessTypes = DEMO_BUSINESS_TYPES;

  isLoading = signal(false);
  /** A criar a empresa pedida no registo (sem mostrar o formulário). */
  isAutoCreating = signal(false);

  async ngOnInit() {
    const account = this.accountService.activeAccount();

    // Já tem empresa (ex.: recarregou a página depois de a criar).
    if (account && (await this.accountService.homeRouteFor(account)) === '/painel') {
      if (this.authService.pendingCompanySetup()) await this.authService.clearPendingCompanySetup();
      this.router.navigate(['/painel']);
      return;
    }

    const pending = this.authService.pendingCompanySetup();
    if (pending) {
      this.form.setValue({ name: pending.name, loadDemoData: pending.loadDemoData, demoBusinessType: pending.businessType });
      this.isAutoCreating.set(true);
      const created = await this.createCompany();
      if (!created) this.isAutoCreating.set(false);
      return;
    }

    if (account?.name) this.form.patchValue({ name: account.name });
  }

  async onSubmit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    await this.createCompany();
  }

  private async createCompany(): Promise<boolean> {
    this.isLoading.set(true);

    const user = (await this.supabase.auth.getUser()).data.user;
    if (!user) {
      this.errorDialog.show(t('companySetup.errors.sessionEnded'), {
        title: t('companySetup.errors.sessionExpiredTitle'),
        context: t('companySetup.errors.contextCreateCompany')
      });
      this.isLoading.set(false);
      return false;
    }

    const account = this.accountService.activeAccount();
    const name = (this.form.value.name as string).trim();
    const loadDemoData = !!this.form.value.loadDemoData;
    const businessType = asDemoBusinessType(this.form.value.demoBusinessType);

    try {
      const { data, error } = await this.supabase.db
        .from('companies')
        .insert({
          user_id: user.id,
          // O trigger assign_company_account usa a conta do titular quando vem vazio.
          ...(account?.is_owner ? { account_id: account.id } : {}),
          name,
          // Os restantes dados completam-se em Configurações (o NUIT vazio não conta para a unicidade).
          nuit: '',
          entity_type: 'singular',
          email: user.email ?? '',
          address: '',
          currency: 'MZN',
          invoice_prefix: 'FAC',
          invoice_number: 1,
          business_volume: '3'
        })
        .select()
        .single();

      if (error) throw error;

      // O vínculo do titular, a subscrição de teste e as definições são criados
      // pelo trigger da própria inserção.
      await this.auditLogService.log(
        'Criou Empresa',
        'settings',
        { company_name: data.name },
        data.id,
        data.name,
        data.id
      );

      if (loadDemoData) {
        const { error: demoError } = await this.supabase.db.rpc('seed_demo_data', { p_company_id: data.id, p_business_type: businessType });
        if (demoError) {
          console.error('Erro ao carregar dados de demonstração:', demoError);
          this.snackBar.open(t('companySetup.quick.demoFailed'), t('common.actions.close'), { duration: 5000 });
        } else {
          await this.auditLogService.log(
            'Carregou Dados de Demonstração',
            'settings',
            { company_name: data.name, business_type: businessType },
            data.id,
            data.name,
            data.id
          );
        }
      }

      await this.authService.clearPendingCompanySetup();
      await this.companyService.loadCompanies();
      this.router.navigate(['/painel']);
      return true;
    } catch (error: any) {
      console.error('Erro ao criar empresa:', error);
      this.errorDialog.show(error, {
        title: t('companySetup.errors.createCompanyTitle'),
        context: t('companySetup.errors.contextCreateCompany')
      });
      return false;
    } finally {
      this.isLoading.set(false);
    }
  }

  async signOut() {
    await this.authService.signOut();
    this.router.navigate(['/entrar']);
  }
}
