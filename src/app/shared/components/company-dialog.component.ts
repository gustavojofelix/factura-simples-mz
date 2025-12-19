import { Component, Inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { Company } from '../../core/services/company.service';

@Component({
  selector: 'app-company-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSelectModule
  ],
  template: `
    <h2 mat-dialog-title>{{ data.company ? 'Editar Empresa' : 'Nova Empresa' }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="space-y-4">
        <mat-form-field appearance="outline" class="w-full">
          <mat-label>Nome da Empresa</mat-label>
          <input matInput formControlName="name" required>
          <mat-error *ngIf="form.get('name')?.hasError('required')">
            Nome é obrigatório
          </mat-error>
        </mat-form-field>

        <mat-form-field appearance="outline" class="w-full">
          <mat-label>NUIT</mat-label>
          <input matInput formControlName="nuit" required>
          <mat-error *ngIf="form.get('nuit')?.hasError('required')">
            NUIT é obrigatório
          </mat-error>
        </mat-form-field>

        <mat-form-field appearance="outline" class="w-full">
          <mat-label>Endereço</mat-label>
          <textarea matInput formControlName="address" rows="2"></textarea>
        </mat-form-field>

        <div class="grid grid-cols-2 gap-4">
          <mat-form-field appearance="outline" class="w-full">
            <mat-label>Telefone</mat-label>
            <input matInput formControlName="phone">
          </mat-form-field>

          <mat-form-field appearance="outline" class="w-full">
            <mat-label>Email</mat-label>
            <input matInput type="email" formControlName="email">
            <mat-error *ngIf="form.get('email')?.hasError('email')">
              Email inválido
            </mat-error>
          </mat-form-field>
        </div>

        <mat-form-field appearance="outline" class="w-full">
          <mat-label>Tipo de Negócio</mat-label>
          <input matInput formControlName="business_type">
        </mat-form-field>

        <div class="grid grid-cols-2 gap-4">
          <mat-form-field appearance="outline" class="w-full">
            <mat-label>Moeda</mat-label>
            <mat-select formControlName="currency">
              <mat-option value="MZN">Metical (MZN)</mat-option>
              <mat-option value="USD">Dólar (USD)</mat-option>
              <mat-option value="EUR">Euro (EUR)</mat-option>
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline" class="w-full">
            <mat-label>Prefixo de Fatura</mat-label>
            <input matInput formControlName="invoice_prefix">
          </mat-form-field>
        </div>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">Cancelar</button>
      <button mat-raised-button color="primary" (click)="onSave()" [disabled]="form.invalid || loading()">
        {{ data.company ? 'Guardar' : 'Criar' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content {
      min-width: 500px;
      max-width: 600px;
    }
  `]
})
export class CompanyDialogComponent {
  form: FormGroup;
  loading = signal(false);

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<CompanyDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { company?: Company }
  ) {
    this.form = this.fb.group({
      name: [data.company?.name || '', Validators.required],
      nuit: [data.company?.nuit || '', Validators.required],
      address: [data.company?.address || ''],
      phone: [data.company?.phone || ''],
      email: [data.company?.email || '', Validators.email],
      business_type: [data.company?.business_type || ''],
      currency: [data.company?.currency || 'MZN'],
      invoice_prefix: [data.company?.invoice_prefix || 'FAC']
    });
  }

  onCancel(): void {
    this.dialogRef.close();
  }

  onSave(): void {
    if (this.form.valid) {
      this.dialogRef.close(this.form.value);
    }
  }
}
