import { Component, Inject, OnInit, signal } from '@angular/core';
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
    MatIconModule
  ],
  template: `
    <h2 mat-dialog-title>{{ data.userId ? 'Gerir Acesso às Empresas' : 'Adicionar Utilizador' }}</h2>
    <mat-dialog-content>
      @if (!data.userId) {
        <form [formGroup]="form" class="space-y-4">
          <mat-form-field appearance="outline" class="w-full">
            <mat-label>Email do Utilizador</mat-label>
            <input matInput type="email" formControlName="email" required>
            <mat-error *ngIf="form.get('email')?.hasError('required')">
              Email é obrigatório
            </mat-error>
            <mat-error *ngIf="form.get('email')?.hasError('email')">
              Email inválido
            </mat-error>
          </mat-form-field>

          <div class="mb-4">
            <p class="text-sm font-semibold mb-2">Selecione as empresas e papéis:</p>
            <div class="space-y-2 max-h-64 overflow-y-auto">
              @for (company of companies(); track company.id) {
                <div class="flex items-center gap-4 p-2 border rounded">
                  <mat-checkbox
                    [checked]="isCompanySelected(company.id)"
                    (change)="toggleCompany(company.id, $event.checked)">
                    {{ company.name }}
                  </mat-checkbox>
                  @if (isCompanySelected(company.id)) {
                    <mat-form-field appearance="outline" class="flex-1">
                      <mat-label>Papel</mat-label>
                      <mat-select [value]="getCompanyRole(company.id)" (selectionChange)="updateCompanyRole(company.id, $event.value)">
                        <mat-option value="admin">Administrador</mat-option>
                        <mat-option value="manager">Gestor</mat-option>
                        <mat-option value="user">Utilizador</mat-option>
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
          <p class="text-sm text-gray-600 mb-4">Gerir o acesso de <strong>{{ data.userEmail }}</strong> às empresas:</p>
          <div class="space-y-2 max-h-96 overflow-y-auto">
            @for (company of companies(); track company.id) {
              <div class="flex items-center gap-4 p-3 border rounded hover:bg-gray-50">
                <mat-checkbox
                  [checked]="isCompanySelected(company.id)"
                  (change)="toggleCompany(company.id, $event.checked)">
                  {{ company.name }}
                </mat-checkbox>
                @if (isCompanySelected(company.id)) {
                  <mat-form-field appearance="outline" class="flex-1">
                    <mat-label>Papel</mat-label>
                    <mat-select [value]="getCompanyRole(company.id)" (selectionChange)="updateCompanyRole(company.id, $event.value)">
                      <mat-option value="admin">Administrador</mat-option>
                      <mat-option value="manager">Gestor</mat-option>
                      <mat-option value="user">Utilizador</mat-option>
                    </mat-select>
                  </mat-form-field>
                }
              </div>
            }
          </div>

          @if (selectedCompanies().size === 0) {
            <div class="text-center py-4 text-gray-500">
              <mat-icon class="text-4xl">info</mat-icon>
              <p>Nenhuma empresa selecionada</p>
            </div>
          }
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">Cancelar</button>
      <button mat-raised-button color="primary" (click)="onSave()"
              [disabled]="(!data.userId && form.invalid) || selectedCompanies().size === 0 || loading()">
        {{ data.userId ? 'Atualizar' : 'Adicionar' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content {
      min-width: 600px;
      max-width: 700px;
    }
  `]
})
export class UserCompanyDialogComponent implements OnInit {
  form: FormGroup;
  loading = signal(false);
  companies = this.companyService.companies;
  selectedCompanies = signal<Map<string, string>>(new Map());

  roles = [
    { value: 'admin', label: 'Administrador' },
    { value: 'manager', label: 'Gestor' },
    { value: 'user', label: 'Utilizador' }
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
      email: ['', [Validators.required, Validators.email]]
    });
  }

  async ngOnInit() {
    if (this.data.userId && this.data.userCompanies) {
      const companyMap = new Map<string, string>();
      this.data.userCompanies.forEach(uc => {
        companyMap.set(uc.company_id, uc.role);
      });
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
    if (!this.data.userId && this.form.invalid) return;
    if (this.selectedCompanies().size === 0) return;

    const result = {
      email: this.data.userId ? this.data.userEmail : this.form.value.email,
      companies: Array.from(this.selectedCompanies().entries()).map(([company_id, role]) => ({
        company_id,
        role
      }))
    };

    this.dialogRef.close(result);
  }
}
