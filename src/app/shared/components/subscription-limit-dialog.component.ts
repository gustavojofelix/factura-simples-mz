import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

export interface SubscriptionLimitDialogData {
  /** Human-readable feature that was blocked, e.g. "produtos" */
  featureLabel?: string;
  /** Raw error code from Supabase, e.g. "SUBSCRIPTION_FEATURE_DISABLED" */
  errorCode?: string;
  /** Raw error message from Supabase */
  errorMessage?: string;
}

@Component({
  selector: 'app-subscription-limit-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, TranslatePipe],
  template: `
    <div class="flex flex-col items-center text-center px-2 py-4 max-w-sm mx-auto">

      <!-- Icon badge -->
      <div class="w-20 h-20 rounded-full bg-amber-100 flex items-center justify-center mb-5 shadow-inner">
        <mat-icon class="!text-amber-500 !text-5xl !w-12 !h-12">workspace_premium</mat-icon>
      </div>

      <!-- Heading -->
      <h2 class="text-xl font-bold text-gray-800 mb-2">
        {{ 'messages.planLimit.title' | t }}
      </h2>

      <!-- Body -->
      <p class="text-sm text-gray-600 leading-relaxed mb-1">
        {{ 'messages.planLimit.bodyBefore' | t }}
        <span class="font-semibold text-gray-800">{{ featureLabel }}</span>{{ 'messages.planLimit.bodyAfter' | t }}
      </p>
      <p class="text-sm text-gray-500 leading-relaxed mb-6">
        {{ 'messages.planLimit.upgradeHint' | t: { feature: featureLabel } }}
      </p>

      <!-- Feature bullets -->
      <div class="w-full bg-gradient-to-br from-orange-50 to-amber-50 rounded-xl border border-amber-100 p-4 mb-6 text-left space-y-2">
        <div class="flex items-start gap-2 text-sm text-gray-700">
          <mat-icon class="!text-emerald-500 !text-base !w-5 !h-5 mt-0.5 flex-shrink-0">check_circle</mat-icon>
          <span>{{ 'messages.planLimit.benefitProducts' | t }}</span>
        </div>
        <div class="flex items-start gap-2 text-sm text-gray-700">
          <mat-icon class="!text-emerald-500 !text-base !w-5 !h-5 mt-0.5 flex-shrink-0">check_circle</mat-icon>
          <span>{{ 'messages.planLimit.benefitInvoicing' | t }}</span>
        </div>
        <div class="flex items-start gap-2 text-sm text-gray-700">
          <mat-icon class="!text-emerald-500 !text-base !w-5 !h-5 mt-0.5 flex-shrink-0">check_circle</mat-icon>
          <span>{{ 'messages.planLimit.benefitSupport' | t }}</span>
        </div>
      </div>

      <!-- Actions -->
      <div class="flex flex-col gap-3 w-full">
        <button
          mat-raised-button
          class="!bg-ispc-orange !text-white !font-semibold !py-3 !rounded-xl w-full"
          (click)="upgrade()"
        >
          <mat-icon class="mr-1">rocket_launch</mat-icon>
          {{ 'messages.planLimit.upgradeNow' | t }}
        </button>
        <button
          mat-button
          class="!text-gray-500 !font-medium w-full"
          mat-dialog-close
        >
          {{ 'messages.planLimit.later' | t }}
        </button>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
  `]
})
export class SubscriptionLimitDialogComponent {
  featureLabel: string;

  constructor(
    private router: Router,
    private dialogRef: MatDialogRef<SubscriptionLimitDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: SubscriptionLimitDialogData
  ) {
    // Map known feature codes to friendly labels, or fall back to data.featureLabel
    const featureMap: Record<string, string> = {
      max_products:  t('messages.planLimit.features.products'),
      max_invoices:  t('messages.planLimit.features.invoices'),
      max_clients:   t('messages.planLimit.features.clients'),
      max_companies: t('messages.planLimit.features.companies'),
      max_users:     t('messages.planLimit.features.users'),
    };

    // Try to extract feature code from errorMessage, e.g. "max_products"
    const msg = data.errorMessage || '';
    const matchedCode = Object.keys(featureMap).find(k => msg.includes(k));

    this.featureLabel =
      data.featureLabel ||
      (matchedCode ? featureMap[matchedCode] : t('messages.planLimit.features.items')) ;
  }

  upgrade() {
    this.dialogRef.close();
    // Navigate to /configuracoes and set the Subscrições tab (index 1) via state
    this.router.navigate(['/configuracoes'], { state: { tab: 1 } });
  }
}
