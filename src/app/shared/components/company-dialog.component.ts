import { Component, DestroyRef, Inject, inject, signal } from '@angular/core';
import { friendlyErrorMessage } from '../../core/utils/error-message';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormArray, FormBuilder, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { DocumentProcessingService, CompanyDocument } from '../../core/services/document-processing.service';
import { Company, CompanyService } from '../../core/services/company.service';
import { AuthService } from '../../core/services/auth.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { ActivityService, ActivityType, CompanyActivity } from '../../core/services/activity.service';
import {
  BANK_OTHER_OPTION,
  CompanyBankAccount,
  CompanyBankAccountService,
  MAX_RECOMMENDED_INVOICE_BANKS,
  MOZAMBIQUE_BANKS,
  ibanWarning,
  nibWarning,
  swiftWarning
} from '../../core/services/company-bank-account.service';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

/** Valores gravados em companies.country → chave da etiqueta traduzida. */
const COUNTRIES: ReadonlyArray<{ value: string; key: string }> = [
  { value: 'Moçambique', key: 'mozambique' },
  { value: 'África do Sul', key: 'southAfrica' },
  { value: 'Angola', key: 'angola' },
  { value: 'Brasil', key: 'brazil' },
  { value: 'Eswatini', key: 'eswatini' },
  { value: 'Malawi', key: 'malawi' },
  { value: 'Portugal', key: 'portugal' },
  { value: 'Tanzânia', key: 'tanzania' },
  { value: 'Zâmbia', key: 'zambia' },
  { value: 'Zimbabué', key: 'zimbabwe' }
];

/** Tipos de documento gravados em company_documents.type → chave da etiqueta traduzida. */
const DOCUMENT_TYPES: ReadonlyArray<{ value: string; key: string }> = [
  { value: 'Certidão de Registo Comercial', key: 'commercialRegistry' },
  { value: 'Boletim da República', key: 'republicBulletin' },
  { value: 'Documento de Identificação (Sócios)', key: 'partnersId' },
  { value: 'Contrato de Arrendamento', key: 'leaseAgreement' },
  { value: 'Comprovativo de Dados Bancários', key: 'bankProof' },
  { value: 'Outros', key: 'other' },
  { value: 'Alvará', key: 'licence' }
];

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
    MatSelectModule,
    MatIconModule,
    MatTooltipModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
    TranslatePipe
  ],
  template: `
    <h2 mat-dialog-title>{{ (data.company ? 'company.dialog.editTitle' : 'company.dialog.newTitle') | t }}</h2>
    <mat-dialog-content>
      <div class="px-6 py-4 overflow-y-auto max-h-[calc(80vh-140px)]">
        <!-- Logo Upload -->
        <div class="flex flex-col items-center mb-8 pb-6 border-b border-gray-100">
          <div class="relative group">
            <div 
              class="w-32 h-32 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center bg-gray-50 overflow-hidden cursor-pointer hover:border-ispc-orange transition-colors"
              (click)="logoInput.click()"
            >
              @if (logoUrl()) {
                <img [src]="logoUrl()" class="w-full h-full object-contain">
              } @else {
                <div class="text-center p-4">
                  <mat-icon class="!text-gray-400 !text-3xl">add_photo_alternate</mat-icon>
                  <p class="text-xs text-gray-500 mt-1">{{ 'company.dialog.logo' | t }}</p>
                </div>
              }
            </div>
            
            @if (logoUrl()) {
              <button 
                type="button"
                mat-mini-fab 
                class="!absolute -top-2 -right-2 !bg-red-500 !text-white !w-8 !h-8"
                (click)="removeLogo($event)"
                [matTooltip]="'company.dialog.removeLogo' | t"
              >
                <mat-icon class="!text-lg">close</mat-icon>
              </button>
            }
          </div>
          <p class="text-xs text-gray-400 mt-2">{{ 'company.dialog.logoFormats' | t }}</p>
          <input 
            type="file" 
            #logoInput 
            class="hidden" 
            accept="image/*" 
            (change)="onLogoSelected($event)"
          >
        </div>

        <form [formGroup]="form" class="space-y-6">
          <mat-form-field appearance="outline" class="w-full">
            <mat-label>{{ 'company.dialog.entityType' | t }}</mat-label>
            <mat-select formControlName="entity_type" required>
              <mat-option value="singular">{{ 'company.entityTypes.singular' | t }}</mat-option>
              <mat-option value="collective">{{ 'company.entityTypes.collective' | t }}</mat-option>
            </mat-select>
            <mat-icon matPrefix class="text-gray-400">person</mat-icon>
            @if (form.get('entity_type')?.hasError('required')) {
              <mat-error>{{ 'company.dialog.entityTypeRequired' | t }}</mat-error>
            }
          </mat-form-field>

         <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <mat-form-field appearance="outline" class="w-full">
                <mat-label>{{ 'company.dialog.entityName' | t }}</mat-label>
                <input matInput formControlName="name" [placeholder]="'company.dialog.entityNamePlaceholder' | t">
                <mat-icon matPrefix class="text-gray-400">business</mat-icon>
                @if (form.get('name')?.hasError('required')) {
                  <mat-error>{{ 'company.dialog.nameRequired' | t }}</mat-error>
                }
              </mat-form-field>


            <mat-form-field appearance="outline" class="w-full">
              <mat-label>NUIT</mat-label>
              <input matInput formControlName="nuit" [placeholder]="'company.dialog.nuitPlaceholder' | t" maxlength="9" (input)="formatNuit()">
              <mat-icon matPrefix class="text-gray-400">badge</mat-icon>
              
              <div matSuffix class="flex items-center">
                @if (isUploadingNuit()) {
                  <mat-spinner diameter="20" class="mr-2"></mat-spinner>
                } @else {
                  @if (nuitDocumentUrl()) {
                    <mat-icon class="text-green-500 mr-2" [matTooltip]="'company.dialog.documentUploaded' | t">check_circle</mat-icon>
                    <button type="button" mat-icon-button (click)="viewDocument()" [matTooltip]="'company.dialog.viewDocument' | t">
                      <mat-icon class="text-blue-500">visibility</mat-icon>
                    </button>
                    <button type="button" mat-icon-button (click)="nuitInput.click()" [matTooltip]="'company.dialog.changeDocument' | t">
                      <mat-icon class="text-gray-400">file_upload</mat-icon>
                    </button>
                  } @else {
                    <button type="button" mat-icon-button (click)="nuitInput.click()" [matTooltip]="'company.dialog.uploadNuit' | t">
                      <mat-icon class="text-gray-400">file_upload</mat-icon>
                    </button>
                  }
                }
                <input type="file" #nuitInput class="hidden" accept=".pdf,.jpg,.jpeg,.png" (change)="onNuitDocumentSelected($event)">
              </div>

              @if (form.get('nuit')?.hasError('required')) {
                <mat-error>{{ 'company.dialog.nuitRequired' | t }}</mat-error>
              }
              @if (form.get('nuit')?.hasError('invalidNuit')) {
                <mat-error>{{ 'company.dialog.nuitInvalid' | t }}</mat-error>
              }
            </mat-form-field>
          </div>

          <mat-form-field appearance="outline" class="w-full">
            <mat-label>{{ 'common.fields.address' | t }}</mat-label>
            <textarea matInput formControlName="address" rows="2" [placeholder]="'company.dialog.addressPlaceholder' | t" required></textarea>
            <mat-icon matPrefix class="text-gray-400">location_on</mat-icon>
            @if (form.get('address')?.hasError('required')) {
              <mat-error>{{ 'company.dialog.addressRequired' | t }}</mat-error>
            }
          </mat-form-field>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <mat-form-field appearance="outline" class="w-full">
              <mat-label>{{ 'company.dialog.email' | t }}</mat-label>
              <input matInput formControlName="email" type="email" [placeholder]="'company.dialog.emailPlaceholder' | t" required>
              <mat-icon matPrefix class="text-gray-400">email</mat-icon>
              @if (form.get('email')?.hasError('required')) {
                <mat-error>{{ 'company.dialog.emailRequired' | t }}</mat-error>
              }
              @if (form.get('email')?.hasError('email')) {
                <mat-error>{{ 'company.dialog.emailInvalid' | t }}</mat-error>
              }
            </mat-form-field>

            <mat-form-field appearance="outline" class="w-full">
              <mat-label>{{ 'company.dialog.country' | t }}</mat-label>
              <mat-select formControlName="country">
                @for (country of countries; track country.value) {
                  <mat-option [value]="country.value">{{ country.label }}</mat-option>
                }
              </mat-select>
              <mat-icon matPrefix class="text-gray-400">public</mat-icon>
            </mat-form-field>

            <mat-form-field appearance="outline" class="w-full">
              <mat-label>{{ 'company.dialog.postalCode' | t }}</mat-label>
              <input matInput formControlName="postal_code" [placeholder]="'company.dialog.postalCodePlaceholder' | t">
              <mat-icon matPrefix class="text-gray-400">markunread_mailbox</mat-icon>
            </mat-form-field>
          </div>

          <div class="border-t border-gray-100 pt-6 mt-6">
            <h3 class="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <mat-icon class="mr-2 text-ispc-orange">business_center</mat-icon>
              {{ 'company.dialog.activitiesTitle' | t }}
            </h3>
            
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <mat-form-field appearance="outline" class="w-full">
                <mat-label>{{ 'company.dialog.mainActivity' | t }}</mat-label>
                <mat-select formControlName="category1">
                  @for (cat of getCat1Options(); track cat.id) {
                    <mat-option [value]="cat.id">{{ cat.label }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>

              @if (getCat2Options().length > 0) {
                <mat-form-field appearance="outline" class="w-full">
                  <mat-label>{{ 'company.dialog.commercialActivities' | t }}</mat-label>
                  <mat-select formControlName="category2">
                    @for (cat of getCat2Options(); track cat.id) {
                      <mat-option [value]="cat.id">{{ cat.label }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
              }

              @if (getCat3Options().length > 0) {
                <mat-form-field appearance="outline" class="w-full">
                  <mat-label>{{ 'company.dialog.serviceActivities' | t }}</mat-label>
                  <mat-select formControlName="category3">
                  @for (cat of getCat3Options(); track cat.id) {
                  <mat-option [value]="cat.id">{{ cat.label }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
              }
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <mat-form-field appearance="outline" class="w-full">
              <mat-label>{{ 'company.dialog.businessVolume' | t }}</mat-label>
              <mat-select formControlName="business_volume">
                @if (isISPCScaleActivity()) {
                  <mat-option value="3">{{ 'company.businessVolume.ispc3' | t }}</mat-option>
                  <mat-option value="4">{{ 'company.businessVolume.ispc4' | t }}</mat-option>
                  <mat-option value="5">{{ 'company.businessVolume.ispc5' | t }}</mat-option>
                  <mat-option value="20">{{ 'company.businessVolume.ispc20' | t }}</mat-option>
                } @else {
                  @if (getServiceType() === 'nao_liberais') {
                    <mat-option value="12">{{ 'company.businessVolume.nonLiberal12' | t }}</mat-option>
                    <mat-option value="20">{{ 'company.businessVolume.services20' | t }}</mat-option>
                  } @else if (getServiceType() === 'liberal') {
                    <mat-option value="15">{{ 'company.businessVolume.liberal15' | t }}</mat-option>
                    <mat-option value="20">{{ 'company.businessVolume.services20' | t }}</mat-option>
                  }
                }
              </mat-select>
              <mat-icon matPrefix class="text-gray-400">trending_up</mat-icon>
            </mat-form-field>

            <mat-form-field appearance="outline" class="w-full">
              <mat-label>{{ 'company.dialog.currency' | t }}</mat-label>
              <mat-select formControlName="currency">
                <mat-option value="MZN">{{ 'company.currencies.MZN' | t }}</mat-option>
                <mat-option value="USD">{{ 'company.currencies.USD' | t }}</mat-option>
                <mat-option value="EUR">{{ 'company.currencies.EUR' | t }}</mat-option>
                <mat-option value="ZAR">{{ 'company.currencies.ZAR' | t }}</mat-option>
              </mat-select>
              <mat-icon matPrefix class="text-gray-400">payments</mat-icon>
            </mat-form-field>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <mat-form-field appearance="outline" class="w-full">
              <mat-label>{{ 'company.dialog.invoicePrefix' | t }}</mat-label>
              <input matInput formControlName="invoice_prefix" [placeholder]="'company.dialog.invoicePrefixPlaceholder' | t">
              <mat-icon matPrefix class="text-gray-400">tag</mat-icon>
            </mat-form-field>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <mat-form-field appearance="outline" class="w-full">
                  <mat-label>{{ 'company.dialog.province' | t }}</mat-label>
                  <mat-select formControlName="province">
                    @for (province of provinces; track province) {
                      <mat-option [value]="province">{{ province }}</mat-option>
                    }
                  </mat-select>
                  <mat-icon matPrefix class="text-gray-400">map</mat-icon>
                </mat-form-field>

              </div>
          </div>



          <div class="border-t border-gray-100 pt-6 mt-6">
            <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
              <h3 class="text-lg font-semibold text-gray-900 flex items-center">
                <mat-icon class="mr-2 text-ispc-orange">account_balance</mat-icon>
                {{ 'company.bank.title' | t }}
              </h3>
              @if (canEditBanks()) {
                <button type="button" mat-stroked-button (click)="addBankAccount()"
                  [disabled]="isLoadingBanks() || bankLoadFailed()">
                  <mat-icon>add</mat-icon>
                  {{ 'company.bank.add' | t }}
                </button>
              }
            </div>

            @if (!canEditBanks() && !isLoadingBanks()) {
              <p class="flex items-start gap-1 text-xs text-gray-500 mb-3">
                <mat-icon class="!text-[16px] !w-4 !h-4 shrink-0">lock</mat-icon>
                {{ 'company.bank.readOnly' | t }}
              </p>
            }

            @if (isLoadingBanks()) {
              <div class="flex items-center gap-2 text-sm text-gray-500 mb-4">
                <mat-spinner diameter="18"></mat-spinner>
                {{ 'company.bank.loading' | t }}
              </div>
            } @else if (bankLoadFailed()) {
              <p class="flex items-start gap-1 text-sm text-red-600 mb-4">
                <mat-icon class="!text-base shrink-0">error</mat-icon>
                {{ 'company.bank.loadFailed' | t }}
              </p>
            } @else if (bankAccountsArray.length === 0) {
              <p class="text-center text-gray-500 py-4 italic">{{ 'company.bank.empty' | t }}</p>
            }

            @if (visibleBankCount() > maxRecommendedBanks) {
              <p class="flex items-start gap-1 text-xs text-amber-700 mb-3">
                <mat-icon class="!text-amber-600 !text-[16px] !w-4 !h-4 shrink-0">warning</mat-icon>
                {{ 'company.bank.tooManyVisible' | t: { count: visibleBankCount(), max: maxRecommendedBanks } }}
              </p>
            }

            <div formArrayName="bankAccounts" class="space-y-4">
              @for (bank of bankAccountsArray.controls; track bank; let i = $index) {
                <div [formGroupName]="i" class="border border-gray-200 rounded-lg p-4 bg-gray-50">
                  <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div class="flex items-center gap-2">
                      <span class="text-sm font-semibold text-gray-700">{{ 'company.bank.bankNumber' | t: { number: i + 1 } }}</span>
                      @if (bank.get('is_default')?.value) {
                        <span class="text-xs font-medium px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">{{ 'company.bank.default' | t }}</span>
                      }
                    </div>
                    @if (canEditBanks()) {
                    <div class="flex items-center">
                      @if (!bank.get('is_default')?.value) {
                        <button type="button" mat-icon-button (click)="setDefaultBank(i)" [matTooltip]="'company.bank.makeDefault' | t">
                          <mat-icon class="text-gray-400">star_outline</mat-icon>
                        </button>
                      }
                      <button type="button" mat-icon-button (click)="moveBankAccount(i, -1)" [disabled]="i === 0" [matTooltip]="'company.bank.moveUp' | t">
                        <mat-icon>arrow_upward</mat-icon>
                      </button>
                      <button type="button" mat-icon-button (click)="moveBankAccount(i, 1)" [disabled]="i === bankAccountsArray.length - 1" [matTooltip]="'company.bank.moveDown' | t">
                        <mat-icon>arrow_downward</mat-icon>
                      </button>
                      <button type="button" mat-icon-button color="warn" (click)="removeBankAccount(i)" [matTooltip]="'company.bank.remove' | t">
                        <mat-icon>delete</mat-icon>
                      </button>
                    </div>
                    }
                  </div>

                  <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <mat-form-field appearance="outline" class="w-full">
                      <mat-label>{{ 'company.bank.bank' | t }}</mat-label>
                      <mat-select formControlName="bank_choice">
                        @for (name of bankOptions; track name) {
                          <mat-option [value]="name">{{ name }}</mat-option>
                        }
                        <mat-option [value]="bankOtherOption">{{ 'company.bank.other' | t }}</mat-option>
                      </mat-select>
                      <mat-icon matPrefix class="text-gray-400">account_balance</mat-icon>
                    </mat-form-field>

                    @if (bank.get('bank_choice')?.value === bankOtherOption) {
                      <mat-form-field appearance="outline" class="w-full">
                        <mat-label>{{ 'company.bank.bankName' | t }}</mat-label>
                        <input matInput formControlName="bank_name_other" maxlength="120" [placeholder]="'company.bank.bankNamePlaceholder' | t">
                      </mat-form-field>
                    }

                    <mat-form-field appearance="outline" class="w-full">
                      <mat-label>{{ 'company.bank.accountHolder' | t }}</mat-label>
                      <input matInput formControlName="account_holder" maxlength="160" [placeholder]="'company.bank.optional' | t">
                    </mat-form-field>

                    <mat-form-field appearance="outline" class="w-full">
                      <mat-label>{{ 'company.bank.accountNumber' | t }}</mat-label>
                      <input matInput formControlName="account_number" maxlength="60" [placeholder]="'company.bank.accountNumberPlaceholder' | t">
                    </mat-form-field>

                    <mat-form-field appearance="outline" class="w-full">
                      <mat-label>NIB</mat-label>
                      <input matInput formControlName="nib" maxlength="40" [placeholder]="'company.bank.nibPlaceholder' | t">
                      @if (nibWarningFor(bank); as warning) {
                        <mat-hint class="!text-amber-700">{{ warning }}</mat-hint>
                      }
                    </mat-form-field>

                    <mat-form-field appearance="outline" class="w-full">
                      <mat-label>IBAN</mat-label>
                      <input matInput formControlName="iban" maxlength="40" placeholder="MZ59 0000...">
                      @if (ibanWarningFor(bank); as warning) {
                        <mat-hint class="!text-amber-700">{{ warning }}</mat-hint>
                      }
                    </mat-form-field>

                    <mat-form-field appearance="outline" class="w-full">
                      <mat-label>SWIFT/BIC</mat-label>
                      <input matInput formControlName="swift" maxlength="15" [placeholder]="'company.bank.swiftPlaceholder' | t">
                      @if (swiftWarningFor(bank); as warning) {
                        <mat-hint class="!text-amber-700">{{ warning }}</mat-hint>
                      }
                    </mat-form-field>

                    <mat-form-field appearance="outline" class="w-full">
                      <mat-label>{{ 'company.bank.accountCurrency' | t }}</mat-label>
                      <mat-select formControlName="currency">
                        <mat-option value="MZN">MZN</mat-option>
                        <mat-option value="USD">USD</mat-option>
                        <mat-option value="EUR">EUR</mat-option>
                        <mat-option value="ZAR">ZAR</mat-option>
                      </mat-select>
                    </mat-form-field>
                  </div>

                  @if (bank.hasError('bankNameRequired') && (bank.touched || bank.dirty)) {
                    <p class="text-xs text-red-600 mb-2">{{ 'company.bank.bankNameRequired' | t }}</p>
                  }
                  @if (bank.hasError('identifierRequired') && (bank.touched || bank.dirty)) {
                    <p class="text-xs text-red-600 mb-2">{{ 'company.bank.identifierRequired' | t }}</p>
                  }

                  <div class="flex flex-wrap items-center justify-between gap-3 mt-1">
                    <mat-slide-toggle formControlName="show_on_invoice" color="primary">
                      <span class="text-sm">{{ 'company.bank.showOnInvoices' | t }}</span>
                    </mat-slide-toggle>

                    <div class="flex items-center gap-2 min-w-0">
                      @if (bank.get('document_path')?.value) {
                        <mat-icon class="text-green-500 shrink-0">description</mat-icon>
                        <span class="text-sm truncate max-w-[220px]" [title]="bank.get('document_file_name')?.value || ''">
                          {{ bank.get('document_file_name')?.value || ('company.bank.proof' | t) }}
                        </span>
                        <button type="button" mat-icon-button color="primary" (click)="viewBankDocument(i)" [matTooltip]="'company.bank.viewProof' | t">
                          <mat-icon>visibility</mat-icon>
                        </button>
                        @if (canEditBanks()) {
                          <button type="button" mat-icon-button (click)="bankDocInput.click()" [disabled]="uploadingBankIndex() !== null" [matTooltip]="'company.bank.replaceProof' | t">
                            <mat-icon>file_upload</mat-icon>
                          </button>
                          <button type="button" mat-icon-button color="warn" (click)="removeBankDocument(i)" [matTooltip]="'company.bank.removeProof' | t">
                            <mat-icon>delete</mat-icon>
                          </button>
                        }
                      } @else if (canEditBanks()) {
                        <button type="button" mat-stroked-button (click)="bankDocInput.click()"
                          [disabled]="!data.company?.id || uploadingBankIndex() !== null"
                          [matTooltip]="(data.company?.id ? 'company.bank.proofFormats' : 'company.bank.saveCompanyFirstTooltip') | t">
                          <mat-icon>file_upload</mat-icon>
                          {{ (uploadingBankIndex() === i ? 'company.dialog.uploading' : 'company.bank.uploadProof') | t }}
                        </button>
                      }
                      <input type="file" #bankDocInput class="hidden" accept=".pdf,.jpg,.jpeg,.png" (change)="onBankDocumentSelected($event, i)">
                    </div>
                  </div>
                  @if (!data.company?.id && canEditBanks()) {
                    <p class="text-xs text-gray-500 mt-2">{{ 'company.bank.saveCompanyFirst' | t }}</p>
                  }
                </div>
              }
            </div>

            <h4 class="text-sm font-semibold text-gray-700 mt-6 mb-3">{{ 'company.bank.mobileWallets' | t }}</h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <mat-form-field appearance="outline" class="w-full">
                <mat-label>M-Pesa</mat-label>
                <input matInput formControlName="mpesa_number" [placeholder]="'company.bank.mpesaPlaceholder' | t">
                <mat-icon matPrefix class="text-gray-400">smartphone</mat-icon>
              </mat-form-field>

              <mat-form-field appearance="outline" class="w-full">
                <mat-label>e-Mola</mat-label>
                <input matInput formControlName="emola_number" [placeholder]="'company.bank.emolaPlaceholder' | t">
                <mat-icon matPrefix class="text-gray-400">smartphone</mat-icon>
              </mat-form-field>
            </div>
          </div>

           <!-- Seccao Alvará -->
            <div class="border-t border-gray-100 pt-6 mt-6">
              <h3 class="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <mat-icon class="mr-2 text-ispc-orange">verified</mat-icon>
                {{ 'company.documentTypes.licence' | t }}
              </h3>
              <div class="bg-gray-50 p-4 rounded-lg">
                @if (alvaraDoc) {
                  <div class="flex items-center justify-between bg-white p-3 rounded border">
                    <span class="text-sm truncate">{{ alvaraDoc.file_name }}</span>
                    <div class="flex items-center">
                      <button type="button" mat-icon-button color="primary" (click)="viewOtherDocument(alvaraDoc)" [matTooltip]="'company.dialog.view' | t">
                        <mat-icon>visibility</mat-icon>
                      </button>
                      <button type="button" mat-icon-button color="warn" (click)="removeOtherDocument(alvaraDoc)" [matTooltip]="'common.actions.remove' | t">
                        <mat-icon>delete</mat-icon>
                      </button>
                    </div>
                  </div>
                } @else {
                  <div class="flex items-center gap-3">
                    <button type="button" mat-raised-button (click)="alvaraInput.click()" [disabled]="isUploadingAlvara()">
                      <mat-icon>file_upload</mat-icon>
                      {{ (isUploadingAlvara() ? 'company.dialog.uploading' : 'company.dialog.uploadLicence') | t }}
                    </button>
                    <span class="text-xs text-gray-500">{{ 'company.dialog.fileFormats' | t }}</span>
                    <input type="file" #alvaraInput class="hidden" accept=".pdf,.jpg,.jpeg,.png" (change)="onAlvaraDocumentSelected($event)">
                  </div>
                }
              </div>
            </div>
             <!-- Seccao Início de Actividade -->
                <div class="border-t border-gray-100 pt-6 mt-6">
                  <h3 class="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                    <mat-icon class="mr-2 text-ispc-orange">event_available</mat-icon>
                    {{ 'company.dialog.activityStart' | t }}
                  </h3>
                  <div class="bg-gray-100 p-4 rounded-lg">
                    @if (commercialActivityUrl()) {
                      <div class="flex items-center justify-between bg-white p-3 rounded border">
                        <span class="text-sm text-green-600 flex items-center gap-1">
                          <mat-icon class="!text-base">check_circle</mat-icon>
                          {{ 'company.dialog.documentUploaded' | t }}
                        </span>
                        <div class="flex items-center">
                            <button type="button" mat-icon-button color="primary" (click)="viewCommercialDocument()" [matTooltip]="'company.dialog.view' | t">
                              <mat-icon class="!text-lg">visibility</mat-icon>
                            </button>
                            <button type="button" mat-icon-button (click)="commercialInput.click()" [disabled]="isUploadingCommercial()" [matTooltip]="'company.dialog.changeDocument' | t">
                              <mat-icon class="!text-lg">file_upload</mat-icon>
                            </button>
                            <button type="button" mat-icon-button color="warn" (click)="clearCommercialDocument()" [matTooltip]="'company.dialog.deleteDocument' | t">
                              <mat-icon class="!text-lg">delete</mat-icon>
                            </button>
                          </div>
                      </div>
                    } @else {
                      <div class="flex items-center gap-3">
                        <button type="button" mat-raised-button (click)="commercialInput.click()" [disabled]="isUploadingCommercial()">
                          <mat-icon>file_upload</mat-icon>
                          {{ (isUploadingCommercial() ? 'company.dialog.uploading' : 'company.dialog.uploadActivityStart') | t }}
                        </button>
                        <span class="text-xs text-gray-500">{{ 'company.dialog.fileFormats' | t }}</span>
                      </div>
                    }
                    <input type="file" #commercialInput class="hidden" accept=".pdf,.jpg,.jpeg,.png"
                      (change)="onCommercialDocumentSelected($event)">
                  </div>
                </div>
          <!-- Seccao de Documentos Adicionais -->
          <div class="border-t border-gray-100 pt-6 mt-6">
            <h3 class="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <mat-icon class="mr-2 text-ispc-orange">folder</mat-icon>
              {{ 'company.dialog.otherDocuments' | t }}
            </h3>

            <div class="bg-gray-50 p-4 rounded-lg mb-4">
              <div class="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                <mat-form-field appearance="outline" class="w-full">
                  <mat-label>{{ 'company.dialog.documentType' | t }}</mat-label>
                  <mat-select [formControl]="newDocType">
                    @for (type of documentTypes; track type.value) {
                      <mat-option [value]="type.value" [disabled]="isDocTypeSelected(type.value)">
                        {{ type.label }}
                      </mat-option>
                    }
                  </mat-select>
                </mat-form-field>

                <div class="flex items-center gap-2 mb-2">
                  <button type="button" mat-raised-button (click)="otherInput.click()" [disabled]="!newDocType.value || isUploadingOther()">
                    <mat-icon>file_upload</mat-icon>
                    {{ (isUploadingOther() ? 'company.dialog.uploading' : 'company.dialog.upload') | t }}
                  </button>
                  <input type="file" #otherInput class="hidden" accept=".pdf,.jpg,.jpeg,.png" (change)="onOtherDocumentSelected($event)">
                </div>

                <div class="text-xs text-gray-500 mb-2">
                  {{ 'company.dialog.onePerType' | t }}
                </div>
              </div>
            </div>

            @if (otherDocsWithoutAlvara.length > 0) {
              <div class="border rounded-lg overflow-hidden">
                <table class="w-full text-sm text-left">
                  <thead class="bg-gray-50 text-gray-700 uppercase text-xs">
                    <tr>
                      <th class="px-4 py-2">{{ 'common.fields.type' | t }}</th>
                      <th class="px-4 py-2">{{ 'company.dialog.file' | t }}</th>
                      <th class="px-4 py-2 text-right">{{ 'common.fields.actions' | t }}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y">
                    @for (doc of otherDocsWithoutAlvara; track doc.id) {
                      <tr>
                        <td class="px-4 py-3 font-medium">{{ documentTypeLabel(doc.type) }}</td>
                        <td class="px-4 py-3 text-gray-500">{{ doc.file_name }}</td>
                        <td class="px-4 py-3 text-right">
                          <button type="button" mat-icon-button color="primary" (click)="viewOtherDocument(doc)" [matTooltip]="'company.dialog.view' | t">
                            <mat-icon>visibility</mat-icon>
                          </button>
                          <button type="button" mat-icon-button color="warn" (click)="removeOtherDocument(doc)" [matTooltip]="'common.actions.remove' | t">
                            <mat-icon>delete</mat-icon>
                          </button>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <p class="text-center text-gray-500 py-4 italic">{{ 'company.dialog.noOtherDocuments' | t }}</p>
            }
          </div>

        </form>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (bankAccountsArray.invalid && !isLoadingBanks()) {
        <span class="text-xs text-red-600 mr-auto pl-2">{{ 'company.bank.invalidFooter' | t }}</span>
      }
      <button mat-button (click)="onCancel()">{{ 'common.actions.cancel' | t }}</button>
      <button mat-raised-button color="primary" (click)="onSave()" [disabled]="form.invalid || loading()">
        {{ (data.company ? 'common.actions.save' : 'common.actions.create') | t }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    :host ::ng-deep .mat-mdc-dialog-container {
      max-width: none !important;
      width: auto !important;
    }

    mat-dialog-content {
      min-width: 1000px;
      width: 85vw;
      max-width: 1400px;
      max-height: 80vh;
      overflow-y: auto;
      overflow-x: hidden;
    }

    form {
      width: 100%;
    }

    mat-form-field {
      width: 100%;
    }
  `]
})
export class CompanyDialogComponent {
  private readonly destroyRef = inject(DestroyRef);
  form: FormGroup;
  loading = signal(false);
  logoUrl = signal<string | null>(this.data.company?.logo_url || null);
  nuitDocumentUrl = signal<string | null>(this.data.company?.nuit_document_url || null);
  isUploadingNuit = signal(false);
  commercialActivityUrl = signal<string | null>(this.data.company?.commercial_activity_document_url || null);
  isUploadingCommercial = signal(false);

  otherDocuments = signal<CompanyDocument[]>([]);
  isUploadingOther = signal(false);
  isUploadingAlvara = signal(false);
  newDocType = this.fb.control('');

  /** Valor gravado (em português) + etiqueta traduzida. O Alvará tem secção própria. */
  documentTypes = DOCUMENT_TYPES
    .filter(type => type.value !== 'Alvará')
    .map(type => ({ value: type.value, label: t(`company.documentTypes.${type.key}`) }));

  provinces = [
    'Maputo', 'Gaza', 'Inhambane', 'Sofala', 'Manica', 'Tete',
    'Zambézia', 'Nampula', 'Niassa', 'Cabo Delgado'
  ];

  countries = COUNTRIES.map(country => ({ value: country.value, label: t(`company.countries.${country.key}`) }));

  activityTypes = signal<ActivityType[]>([]);
  isLoadingActivities = signal(false);
  companyActivities = signal<CompanyActivity[]>([]);

  // Contas bancárias
  readonly bankOptions = MOZAMBIQUE_BANKS;
  readonly bankOtherOption = BANK_OTHER_OPTION;
  readonly maxRecommendedBanks = MAX_RECOMMENDED_INVOICE_BANKS;
  isLoadingBanks = signal(false);
  bankLoadFailed = signal(false);
  uploadingBankIndex = signal<number | null>(null);
  /** Comprovativos já gravados na base de dados (os restantes foram carregados nesta sessão). */
  private persistedBankDocPaths = new Set<string>();
  private bankAccountService = inject(CompanyBankAccountService);
  private companyService = inject(CompanyService);
  private authService = inject(AuthService);
  /** Dono/administrador da empresa ou super administrador. Uma empresa nova é sempre do próprio. */
  canEditBanks = signal(!this.data.company?.id);

  get alvaraDoc(): CompanyDocument | undefined {
    return this.otherDocuments().find(d => d.type === 'Alvará');
  }
  get otherDocsWithoutAlvara() {
    return this.otherDocuments().filter(doc => doc.type !== 'Alvará');
  }

  /** Etiqueta traduzida de um tipo de documento gravado (tipos desconhecidos ficam como estão). */
  documentTypeLabel(type: string): string {
    const match = DOCUMENT_TYPES.find(item => item.value === type);
    return match ? t(`company.documentTypes.${match.key}`) : type;
  }


  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<CompanyDialogComponent>,
    private documentService: DocumentProcessingService,
    private snackBar: MatSnackBar,
    private supabase: SupabaseService,
    private activityService: ActivityService,
    @Inject(MAT_DIALOG_DATA) public data: { company?: Company }

  ) {
    this.form = this.fb.group({
      name: [data.company?.name || '', Validators.required],
      entity_type: [data.company?.entity_type || '', Validators.required],
      nuit: [data.company?.nuit || '', [Validators.required]],
      address: [data.company?.address || '', Validators.required],
      email: [data.company?.email || '', [Validators.required, Validators.email]],
      country: [data.company?.country || 'Moçambique'],
      postal_code: [(data.company as any)?.postal_code || ''],
      business_volume: [(data.company as any)?.business_volume || '3', Validators.required],
      currency: [data.company?.currency || 'MZN'],
      invoice_prefix: [data.company?.invoice_prefix || 'FAC'],
      province: [data.company?.documents_metadata?.province || ''],
      bankAccounts: this.fb.array<FormGroup>([]),
      mpesa_number: [data.company?.mpesa_number || ''],
      emola_number: [data.company?.emola_number || ''],
      category1: [data.company?.category1 || ''],
      category2: [data.company?.category2 || ''],
      category3: [data.company?.category3 || '']
    });

    this.setupCategoryWatchers();
    this.loadActivityCatalog();
    this.loadOtherDocuments();
    this.loadBankAccounts();
  }

  get bankAccountsArray(): FormArray<FormGroup> {
    return this.form.get('bankAccounts') as FormArray<FormGroup>;
  }

  async loadBankAccounts() {
    const companyId = this.data.company?.id;
    if (!companyId) return;

    this.isLoadingBanks.set(true);
    try {
      const [accounts, role, isSuperAdmin] = await Promise.all([
        this.bankAccountService.loadForEdit(companyId),
        this.companyService.getUserRole(companyId).catch(() => null),
        this.authService.isAdmin().catch(() => false)
      ]);
      const canEdit = isSuperAdmin || role === 'owner' || role === 'admin';
      this.canEditBanks.set(canEdit);

      this.bankAccountsArray.clear();
      accounts.forEach(account => {
        const group = this.createBankGroup(account);
        // Contas antigas incompletas (ex.: migradas só com o nome do banco)
        // mostram logo o erro, para o utilizador perceber porque não pode guardar.
        if (canEdit && group.invalid) group.markAllAsTouched();
        this.bankAccountsArray.push(group);
        if (account.document_path) this.persistedBankDocPaths.add(account.document_path);
      });
      this.bankAccountsArray.markAsPristine();
      // Só leitura: controlos desactivados não contam para a validade do formulário.
      if (!canEdit) this.bankAccountsArray.disable();
    } catch (error) {
      console.error('Erro ao carregar contas bancárias:', error);
      this.bankLoadFailed.set(true);
      this.snackBar.open(t('company.messages.banksLoadFailed'), t('common.actions.close'), { duration: 5000 });
    } finally {
      this.isLoadingBanks.set(false);
    }
  }

  private createBankGroup(account?: Partial<CompanyBankAccount>): FormGroup {
    const name = (account?.bank_name || '').trim();
    const known = MOZAMBIQUE_BANKS.includes(name);
    return this.fb.group({
      id: [account?.id || null],
      bank_choice: [known ? name : (name ? BANK_OTHER_OPTION : '')],
      bank_name_other: [known ? '' : name],
      account_holder: [account?.account_holder || ''],
      account_number: [account?.account_number || ''],
      nib: [account?.nib || ''],
      iban: [account?.iban || ''],
      swift: [account?.swift || ''],
      currency: [account?.currency || this.form?.get('currency')?.value || 'MZN'],
      is_default: [!!account?.is_default],
      show_on_invoice: [account?.show_on_invoice ?? true],
      document_path: [account?.document_path || null],
      document_file_name: [account?.document_file_name || null]
    }, { validators: CompanyDialogComponent.bankAccountValidator });
  }

  /** Banco obrigatório e pelo menos um identificador (conta, NIB ou IBAN). */
  private static bankAccountValidator(group: AbstractControl): ValidationErrors | null {
    const value = group.value || {};
    const errors: ValidationErrors = {};
    const choice = value.bank_choice;
    if (!choice || (choice === BANK_OTHER_OPTION && !(value.bank_name_other || '').trim())) {
      errors['bankNameRequired'] = true;
    }
    if (![value.account_number, value.nib, value.iban].some((v: string | null) => !!(v || '').trim())) {
      errors['identifierRequired'] = true;
    }
    return Object.keys(errors).length ? errors : null;
  }

  addBankAccount() {
    this.bankAccountsArray.push(this.createBankGroup({ is_default: this.bankAccountsArray.length === 0 }));
    this.bankAccountsArray.markAsDirty();
  }

  removeBankAccount(index: number) {
    const group = this.bankAccountsArray.at(index);
    const name = this.bankNameOf(group) || t('company.bank.bankNumber', { number: index + 1 });
    if (!confirm(t('company.messages.confirmRemoveBank', { name }))) return;

    const path = group.get('document_path')?.value as string | null;
    const wasDefault = !!group.get('is_default')?.value;
    this.bankAccountsArray.removeAt(index);
    this.discardUnsavedBankDocument(path);

    if (wasDefault && this.bankAccountsArray.length > 0) this.setDefaultBank(0);
    this.bankAccountsArray.markAsDirty();
  }

  moveBankAccount(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= this.bankAccountsArray.length) return;
    const group = this.bankAccountsArray.at(index);
    this.bankAccountsArray.removeAt(index, { emitEvent: false });
    this.bankAccountsArray.insert(target, group);
    this.bankAccountsArray.markAsDirty();
  }

  setDefaultBank(index: number) {
    this.bankAccountsArray.controls.forEach((group, i) =>
      group.get('is_default')?.setValue(i === index)
    );
    this.bankAccountsArray.markAsDirty();
  }

  visibleBankCount(): number {
    return this.bankAccountsArray.controls.filter(group => !!group.get('show_on_invoice')?.value).length;
  }

  nibWarningFor(group: AbstractControl): string | null {
    return nibWarning(group.get('nib')?.value);
  }

  ibanWarningFor(group: AbstractControl): string | null {
    return ibanWarning(group.get('iban')?.value);
  }

  swiftWarningFor(group: AbstractControl): string | null {
    return swiftWarning(group.get('swift')?.value);
  }

  private bankNameOf(group: AbstractControl): string {
    const choice = group.get('bank_choice')?.value;
    const name = choice === BANK_OTHER_OPTION ? group.get('bank_name_other')?.value : choice;
    return (name || '').trim();
  }

  async onBankDocumentSelected(event: Event, index: number) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const companyId = this.data.company?.id;
    if (!companyId) {
      this.snackBar.open(t('company.bank.saveCompanyFirst'), t('common.actions.close'), { duration: 3000 });
      input.value = '';
      return;
    }

    const allowed = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!allowed.includes(file.type)) {
      this.snackBar.open(t('company.messages.unsupportedFormat'), t('common.actions.close'), { duration: 4000 });
      input.value = '';
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      this.snackBar.open(t('company.messages.fileTooLarge10'), t('common.actions.close'), { duration: 4000 });
      input.value = '';
      return;
    }

    const group = this.bankAccountsArray.at(index);
    this.uploadingBankIndex.set(index);
    try {
      const result = await this.documentService.uploadDocument(file, companyId, 'bank_details');
      const previous = group.get('document_path')?.value as string | null;
      group.patchValue({
        document_path: this.documentService.storagePath(result.url),
        document_file_name: file.name
      });
      group.markAsDirty();
      this.discardUnsavedBankDocument(previous);
      this.snackBar.open(t('company.messages.proofUploaded'), t('common.actions.close'), { duration: 3000 });
    } catch (error: any) {
      console.error('Erro ao carregar comprovativo bancário:', error);
      this.snackBar.open(friendlyErrorMessage(error, t('company.messages.documentUploadFailed')), t('common.actions.close'), { duration: 6000 });
    } finally {
      this.uploadingBankIndex.set(null);
      input.value = '';
    }
  }

  async viewBankDocument(index: number) {
    const path = this.bankAccountsArray.at(index).get('document_path')?.value;
    if (!path) return;
    const signedUrl = await this.documentService.getSignedUrl(path);
    window.open(signedUrl, '_blank');
  }

  removeBankDocument(index: number) {
    if (!confirm(t('company.messages.confirmRemoveProof'))) return;
    const group = this.bankAccountsArray.at(index);
    const path = group.get('document_path')?.value as string | null;
    group.patchValue({ document_path: null, document_file_name: null });
    group.markAsDirty();
    this.discardUnsavedBankDocument(path);
  }

  /**
   * Um comprovativo carregado nesta sessão e ainda não gravado pode ser apagado
   * já. Os que estão gravados só são removidos depois de guardar a empresa.
   */
  private discardUnsavedBankDocument(path: string | null | undefined) {
    if (!path || this.persistedBankDocPaths.has(path)) return;
    this.documentService.deleteDocument(path).catch(error =>
      console.warn('Não foi possível remover o comprovativo temporário:', error)
    );
  }

  /**
   * Contas a gravar. undefined quando a leitura falhou, para que a gravação
   * não apague as contas existentes que não chegaram a ser mostradas.
   */
  private bankAccountsResult(): CompanyBankAccount[] | undefined {
    if (this.data.company?.id && this.bankLoadFailed()) return undefined;
    // Sem permissão, ou sem alterações na secção: não mexer nas contas gravadas.
    if (!this.canEditBanks()) return undefined;
    if (this.data.company?.id && !this.bankAccountsArray.dirty) return undefined;

    const groups = this.bankAccountsArray.controls;
    const defaultIndex = Math.max(0, groups.findIndex(group => !!group.get('is_default')?.value));
    return groups.map((group, index) => {
      const value = group.getRawValue();
      return {
        id: value.id || undefined,
        bank_name: this.bankNameOf(group),
        account_holder: value.account_holder,
        account_number: value.account_number,
        nib: value.nib,
        iban: value.iban,
        swift: value.swift,
        currency: value.currency || 'MZN',
        is_default: index === defaultIndex,
        show_on_invoice: !!value.show_on_invoice,
        sort_order: index,
        document_path: value.document_path,
        document_file_name: value.document_file_name
      };
    });
  }

  async loadActivityCatalog() {
    this.isLoadingActivities.set(true);
    try {
      this.activityTypes.set(await this.activityService.list(false));
      if (this.data.company?.id) await this.loadCompanyActivities(this.data.company.id);
    } catch (error) {
      console.error('Erro ao carregar catálogo de actividades:', error);
      this.snackBar.open(t('company.messages.activitiesLoadFailed'), t('common.actions.close'), { duration: 5000 });
    } finally {
      this.isLoadingActivities.set(false);
    }
  }

  async loadCompanyActivities(companyId: string) {
    const activities = await this.activityService.getCompanyActivities(companyId);
    this.companyActivities.set(activities);

    const principal = activities.find(a => a.activity_role === 'principal')?.activity_type;
    const category2 = activities.find(a => a.activity_type?.level === 2)?.activity_type;
    const category3 = activities.find(a => a.activity_type?.level === 3)?.activity_type;
    this.form.patchValue({
      category1: principal?.code || this.form.get('category1')?.value || '',
      category2: category2?.code || this.form.get('category2')?.value || '',
      category3: category3?.code || this.form.get('category3')?.value || ''
    }, { emitEvent: false });
  }

  async loadOtherDocuments() {
    if (this.data.company?.id) {
      const docs = await this.documentService.getCompanyDocuments(this.data.company.id);
      this.otherDocuments.set(docs);
    }
  }

  setupCategoryWatchers() {
    this.form.get('category1')?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.form.patchValue({ category2: '', category3: '' }, { emitEvent: false });
    });

    this.form.get('category2')?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((cat2) => {
      this.form.patchValue({ category3: '' }, { emitEvent: false });

      if (cat2 === 'servicos_nao_liberais') {
        this.form.patchValue({ business_volume: '12' });
      } else if (cat2 === 'servicos_liberais') {
        this.form.patchValue({ business_volume: '15' });
      } else {
        const currentVol = this.form.get('business_volume')?.value;
        if (currentVol === '12' || currentVol === '15' || currentVol === '20') {
          this.form.patchValue({ business_volume: '3' });
        }
      }
    });
  }

  isISPCScaleActivity() {
    const cat2 = this.form.get('category2')?.value;
    return cat2 !== 'servicos_nao_liberais' && cat2 !== 'servicos_liberais';
  }

  getServiceType(): 'liberal' | 'nao_liberais' | null {
    const cat2 = this.form.get('category2')?.value;
    if (cat2 === 'servicos_nao_liberais') return 'nao_liberais';
    if (cat2 === 'servicos_liberais') return 'liberal';
    return null;
  }

  getCat1Options() {
    return this.activityTypes().filter(activity => !activity.parent_id)
      .map(activity => ({ id: activity.code, label: activity.name }));
  }

  getCat2Options() {
    const cat1 = this.form.get('category1')?.value;
    if (!cat1) return [];
    const parent = this.activityTypes().find(activity => activity.code === cat1);
    if (!parent) return [];
    return this.activityTypes().filter(activity => activity.parent_id === parent.id)
      .map(activity => ({ id: activity.code, label: activity.name }));
  }

  getCat3Options() {
    const cat1 = this.form.get('category1')?.value;
    const cat2 = this.form.get('category2')?.value;

    if (!cat1 || !cat2) return [];
    const parent = this.activityTypes().find(activity => activity.code === cat2);
    if (!parent) return [];
    return this.activityTypes().filter(activity => activity.parent_id === parent.id)
      .map(activity => ({ id: activity.code, label: activity.name }));
  }

  onLogoSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        alert(t('company.messages.logoTooLarge'));
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        this.logoUrl.set(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  }

  removeLogo(event: Event) {
    event.stopPropagation();
    this.logoUrl.set(null);
  }

  async onNuitDocumentSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    this.isUploadingNuit.set(true);

    try {
      const companyId = this.data.company?.id || 'temp';
      const result = await this.documentService.uploadDocument(file, companyId, 'nuit');

      this.nuitDocumentUrl.set(result.url);

      if (result.extractedData) {
        if (result.extractedData.nuit) {
          this.form.patchValue({ nuit: result.extractedData.nuit });
          this.formatNuit();
        }
        if (result.extractedData.tradeName && !this.form.get('name')?.value) {
          this.form.patchValue({ name: result.extractedData.tradeName });
        }
        if (result.extractedData.address && !this.form.get('address')?.value) {
          this.form.patchValue({ address: result.extractedData.address });
        }

        this.snackBar.open(t('company.messages.dataExtracted'), t('common.actions.close'), { duration: 3000 });
      } else {
        this.snackBar.open(t('company.messages.documentUploaded'), t('common.actions.close'), { duration: 3000 });
      }
    } catch (error: any) {
      console.error('Erro ao subir NUIT:', error);
      this.snackBar.open(friendlyErrorMessage(error, t('company.messages.documentUploadFailed')), t('common.actions.close'), { duration: 6000 });
    } finally {
      this.isUploadingNuit.set(false);
      input.value = '';
    }
  }

  async onCommercialDocumentSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    this.isUploadingCommercial.set(true);

    try {
      const companyId = this.data.company?.id || 'temp';
      const result = await this.documentService.uploadDocument(file, companyId, 'commercial_activity');

      this.commercialActivityUrl.set(result.url);

      if (result.extractedData) {
        if (result.extractedData.tradeName && !this.form.get('name')?.value) {
          this.form.patchValue({ name: result.extractedData.tradeName });
        }
        this.snackBar.open(t('company.messages.dataExtracted'), t('common.actions.close'), { duration: 3000 });
      } else {
        this.snackBar.open(t('company.messages.documentUploaded'), t('common.actions.close'), { duration: 3000 });
      }
    } catch (error: any) {
      console.error('Erro ao subir Exercício de Actividade Comercial:', error);
      this.snackBar.open(friendlyErrorMessage(error, t('company.messages.documentUploadFailed')), t('common.actions.close'), { duration: 6000 });
    } finally {
      this.isUploadingCommercial.set(false);
      input.value = '';
    }
  }

  async onOtherDocumentSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const type = this.newDocType.value;

    if (!input.files || input.files.length === 0 || !type) return;

    if (this.isDocTypeSelected(type)) {
      this.snackBar.open(t('company.messages.documentTypeExists', { type: this.documentTypeLabel(type) }), t('common.actions.close'), { duration: 3000 });
      input.value = '';
      return;
    }

    const file = input.files[0];
    this.isUploadingOther.set(true);

    try {
      const companyId = this.data.company?.id;
      if (!companyId) {
        this.snackBar.open(t('company.messages.saveBeforeOtherDocs'), t('common.actions.close'), { duration: 3000 });
        return;
      }

      const result = await this.documentService.uploadDocument(file, companyId, 'other' as any);
      const savedDoc = await this.documentService.saveDocument(companyId, type, result.url, file.name);

      if (savedDoc) {
        this.otherDocuments.update(docs => [...docs, savedDoc]);
        this.newDocType.setValue('');
        this.snackBar.open(t('company.messages.documentAdded'), t('common.actions.close'), { duration: 3000 });
      }
    } catch (error: any) {
      console.error('Erro ao subir documento:', error);
      this.snackBar.open(friendlyErrorMessage(error, t('company.messages.documentUploadFailed')), t('common.actions.close'), { duration: 6000 });
    } finally {
      this.isUploadingOther.set(false);
      input.value = '';
    }
  }

  async onAlvaraDocumentSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    this.isUploadingAlvara.set(true);

    try {
      const companyId = this.data.company?.id;
      if (!companyId) {
        this.snackBar.open(t('company.messages.saveBeforeLicence'), t('common.actions.close'), { duration: 3000 });
        return;
      }

      const result = await this.documentService.uploadDocument(file, companyId, 'other' as any);
      const savedDoc = await this.documentService.saveDocument(companyId, 'Alvará', result.url, file.name);

      if (savedDoc) {
        this.otherDocuments.update(docs => [...docs, savedDoc]);
        this.snackBar.open(t('company.messages.licenceUploaded'), t('common.actions.close'), { duration: 3000 });
      }
    } catch (error: any) {
      console.error('Erro ao subir alvará:', error);
      this.snackBar.open(friendlyErrorMessage(error, t('company.messages.licenceUploadFailed')), t('common.actions.close'), { duration: 6000 });
    } finally {
      this.isUploadingAlvara.set(false);
      input.value = '';
    }
  }

  isDocTypeSelected(type: string): boolean {
    return this.otherDocuments().some(d => d.type === type);
  }

  async viewOtherDocument(doc: CompanyDocument) {
    const signedUrl = await this.documentService.getSignedUrl(doc.url);
    window.open(signedUrl, '_blank');
  }

  async removeOtherDocument(doc: CompanyDocument) {
    if (confirm(t('company.messages.confirmRemoveDocument', { type: this.documentTypeLabel(doc.type) }))) {
      try {
        await this.documentService.deleteDocument(doc.url);
        await this.documentService.deleteCompanyDocument(doc.id);
        this.otherDocuments.update(docs => docs.filter(d => d.id !== doc.id));
        this.snackBar.open(t('company.messages.documentRemoved'), t('common.actions.close'), { duration: 3000 });
      } catch (error) {
        console.error('Erro ao remover documento:', error);
        this.snackBar.open(friendlyErrorMessage(error, t('company.messages.documentRemoveFailed')), t('common.actions.close'), { duration: 6000 });
      }
    }
  }

  async viewDocument() {
    const url = this.nuitDocumentUrl();
    if (url) {
      const signedUrl = await this.documentService.getSignedUrl(url);
      window.open(signedUrl, '_blank');
    }
  }

  async viewCommercialDocument() {
    const url = this.commercialActivityUrl();
    if (url) {
      const signedUrl = await this.documentService.getSignedUrl(url);
      window.open(signedUrl, '_blank');
    }
  }

  formatNuit() {
    const nuitControl = this.form.get('nuit');
    if (!nuitControl) return;

    let value = nuitControl.value.replace(/\D/g, '');
    if (value.length > 9) {
      value = value.substring(0, 9);
    }
    nuitControl.setValue(value, { emitEvent: false });
  }

  async clearCommercialDocument() {
    const url = this.commercialActivityUrl();
    if (!url) return;
    try {
      await this.documentService.deleteDocument(url);

      if (this.data.company?.id) {
        await this.supabase.db
          .from('companies')
          .update({ commercial_activity_document_url: null })
          .eq('id', this.data.company.id);
      }

      this.commercialActivityUrl.set(null);
      this.snackBar.open(t('company.messages.documentRemovedShort'), t('common.actions.close'), { duration: 3000 });
    } catch (error) {
      console.error('Erro ao remover documento:', error);
      this.snackBar.open(friendlyErrorMessage(error, t('company.messages.documentRemoveFailed')), t('common.actions.close'), { duration: 6000 });
    }
  }

  onCancel(): void {
    this.dialogRef.close();
  }

  onSave(): void {
    if (this.form.valid) {
      const formValue = this.form.value;
      const serviceRole = this.getServiceType() ? 'servico' as const : 'comercial' as const;
      const selectedActivities = [
        formValue.category1 ? { activity_type_id: this.activityTypes().find(a => a.code === formValue.category1)?.id, activity_role: 'principal' as const, is_primary: true } : null,
        formValue.category2 ? { activity_type_id: this.activityTypes().find(a => a.code === formValue.category2)?.id, activity_role: serviceRole, is_primary: false } : null,
        formValue.category3 ? { activity_type_id: this.activityTypes().find(a => a.code === formValue.category3)?.id, activity_role: serviceRole, is_primary: false } : null
      ].filter((activity): activity is { activity_type_id: string; activity_role: 'principal' | 'comercial' | 'servico'; is_primary: boolean } => !!activity?.activity_type_id);

      const formData: Partial<Company> & {
        companyActivities: typeof selectedActivities;
        bankAccounts?: CompanyBankAccount[];
      } = {
        name: formValue.name,
        nuit: formValue.nuit,
        entity_type: formValue.entity_type,
        address: formValue.address,
        email: formValue.email,
        country: formValue.country,
        postal_code: formValue.postal_code,
        currency: formValue.currency,
        invoice_prefix: formValue.invoice_prefix,
        logo_url: this.logoUrl() || undefined,
        nuit_document_url: this.nuitDocumentUrl() || undefined,
        commercial_activity_document_url: this.commercialActivityUrl() || undefined,
        documents_metadata: {
          province: formValue.province
        },
        mpesa_number: formValue.mpesa_number,
        emola_number: formValue.emola_number,
        category1: formValue.category1,
        category2: formValue.category2,
        category3: formValue.category3,
        business_volume: formValue.business_volume,
        companyActivities: selectedActivities,
        bankAccounts: this.bankAccountsResult()
      };

      this.dialogRef.close(formData);
    }
  }
}
