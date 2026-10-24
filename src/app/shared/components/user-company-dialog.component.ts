import { Component, Inject, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { CompanyService } from '../../core/services/company.service';
import { UserManagementService } from '../../core/services/user-management.service';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

@Component({
  selector: 'app-user-company-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSelectModule,
    MatCheckboxModule,
    MatChipsModule,
    MatIconModule,
    TranslatePipe
  ],
  template: `
    <h2 mat-dialog-title>{{ (data.userId ? 'company.userAccess.manageTitle' : 'company.userAccess.addTitle') | t }}</h2>
    <mat-dialog-content>
      @if (!data.userId) {
        <form [formGroup]="form" class="space-y-4">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <mat-form-field appearance="outline" class="w-full">
              <mat-label>{{ 'company.userAccess.fullName' | t }}</mat-label>
              <input matInput formControlName="fullName" required>
              <mat-error *ngIf="form.get('fullName')?.hasError('required')">
                {{ 'company.userAccess.nameRequired' | t }}
              </mat-error>
            </mat-form-field>

            <mat-form-field appearance="outline" class="w-full">
              <mat-label>{{ 'common.fields.phone' | t }}</mat-label>
              <input matInput formControlName="phone">
            </mat-form-field>
          </div>

          <mat-form-field appearance="outline" class="w-full">
            <mat-label>{{ 'company.userAccess.userEmail' | t }}</mat-label>
            <input matInput type="email" formControlName="email" required>
            <mat-error *ngIf="form.get('email')?.hasError('required')">
              {{ 'company.userAccess.emailRequired' | t }}
            </mat-error>
            <mat-error *ngIf="form.get('email')?.hasError('email')">
              {{ 'company.userAccess.emailInvalid' | t }}
            </mat-error>
          </mat-form-field>

          <div class="mb-4">
            <p class="text-sm font-semibold mb-2">{{ 'company.userAccess.selectCompanies' | t }}</p>
            <div class="space-y-2 max-h-64 overflow-y-auto">
              @for (company of companies(); track company.id) {
                <div class="flex items-center gap-4 p-2 border rounded">
                  <mat-checkbox
                    [checked]="isCompanySelected(company.id)"
                    (change)="toggleCompany(company.id, $event.checked)">
                    {{ company.name }}
                  </mat-checkbox>
                  @if (isCompanySelected(company.id)) {
                    <mat-form-field appearance="outline" class="flex-1 !mb-[-1.25em]">
                      <mat-label>{{ 'company.userAccess.role' | t }}</mat-label>
                      <mat-select [value]="getCompanyRole(company.id)" (selectionChange)="updateCompanyRole(company.id, $event.value)">
                        <mat-option value="admin">{{ 'company.roles.admin' | t }}</mat-option>
                        <mat-option value="manager">{{ 'company.roles.manager' | t }}</mat-option>
                        <mat-option value="user">{{ 'company.roles.user' | t }}</mat-option>
                      </mat-select>
                    </mat-form-field>
                  }
                </div>
              }
            </div>
          </div>
        </form>
      } @else {
        <div class="space-y-4">
          <p class="text-sm text-gray-600 mb-4">{{ 'company.userAccess.manageAccessBefore' | t }} <strong>{{ data.userEmail }}</strong> {{ 'company.userAccess.manageAccessAfter' | t }}</p>
          <div class="space-y-2 max-h-96 overflow-y-auto">
            @for (company of companies(); track company.id) {
              <div class="flex items-center gap-4 p-3 border rounded hover:bg-gray-50">
                <mat-checkbox
                  [checked]="isCompanySelected(company.id)"
                  (change)="toggleCompany(company.id, $event.checked)">
                  {{ company.name }}
                </mat-checkbox>
                @if (isCompanySelected(company.id)) {
                  <mat-form-field appearance="outline" class="flex-1 !mb-[-1.25em]">
                    <mat-label>{{ 'company.userAccess.role' | t }}</mat-label>
                    <mat-select [value]="getCompanyRole(company.id)" (selectionChange)="updateCompanyRole(company.id, $event.value)">
                      <mat-option value="admin">{{ 'company.roles.admin' | t }}</mat-option>
                      <mat-option value="manager">{{ 'company.roles.manager' | t }}</mat-option>
                      <mat-option value="user">{{ 'company.roles.user' | t }}</mat-option>
                    </mat-select>
                  </mat-form-field>
                }
              </div>
            }
          </div>

          @if (selectedCompanies().size === 0) {
            <div class="text-center py-4 text-gray-500">
              <mat-icon class="text-4xl">info</mat-icon>
              <p>{{ 'company.userAccess.noneSelected' | t }}</p>
            </div>
          }
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">{{ 'common.actions.cancel' | t }}</button>
      <button mat-raised-button color="primary" (click)="onSave()"
              [disabled]="(!data.userId && (form.invalid || selectedCompanies().size === 0)) || loading()">
        {{ (data.userId ? 'company.userAccess.update' : 'common.actions.add') | t }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content {
      min-width: min(600px, 85vw);
      max-width: 700px;
    }
  `]
})
export class UserCompanyDialogComponent implements OnInit {
  form: FormGroup;
  loading = signal(false);
  /** Só o proprietário pode gerir acessos (RLS de company_users), por isso só listamos as empresas dele. */
  companies = computed(() => this.companyService.companies().filter(c => this.companyService.isOwner(c.id)));
  selectedCompanies = signal<Map<string, string>>(new Map());

  roles = [
    { value: 'admin', label: t('company.roles.admin') },
    { value: 'manager', label: t('company.roles.manager') },
    { value: 'user', label: t('company.roles.user') }
  ];

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<UserCompanyDialogComponent>,
    private companyService: CompanyService,
    private userManagementService: UserManagementService,
    @Inject(MAT_DIALOG_DATA) public data: {
      userId?: string;
      userEmail?: string;
      userCompanies?: Array<{ company_id: string; role: string }>;
    }
  ) {
    this.form = this.fb.group({
      fullName: ['', Validators.required],
      phone: [''],
      email: ['', [Validators.required, Validators.email]]
    });
  }

  async ngOnInit() {
    if (this.data.userId && this.data.userCompanies) {
      const companyMap = new Map<string, string>();
      this.data.userCompanies
        .filter(uc => uc.role !== 'owner' && this.companyService.isOwner(uc.company_id))
        .forEach(uc => companyMap.set(uc.company_id, uc.role));
      this.selectedCompanies.set(companyMap);
    }
  }

  isCompanySelected(companyId: string): boolean {
    return this.selectedCompanies().has(companyId);
  }

  getCompanyRole(companyId: string): string {
    return this.selectedCompanies().get(companyId) || 'user';
  }

  toggleCompany(companyId: string, selected: boolean): void {
    const companies = new Map(this.selectedCompanies());
    if (selected) {
      companies.set(companyId, 'user');
    } else {
      companies.delete(companyId);
    }
    this.selectedCompanies.set(companies);
  }

  updateCompanyRole(companyId: string, role: string): void {
    const companies = new Map(this.selectedCompanies());
    companies.set(companyId, role);
    this.selectedCompanies.set(companies);
  }

  onCancel(): void {
    this.dialogRef.close();
  }

  onSave(): void {
    if (!this.data.userId && this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    // Ao criar é preciso pelo menos uma empresa; ao editar, nenhuma = remover todos os acessos.
    if (!this.data.userId && this.selectedCompanies().size === 0) return;

    const result = {
      email: this.data.userId ? this.data.userEmail : this.form.value.email,
      fullName: this.form.value.fullName,
      phone: this.form.value.phone,
      companies: Array.from(this.selectedCompanies().entries()).map(([company_id, role]) => ({
        company_id,
        role
      }))
    };

    this.dialogRef.close(result);
  }
}
