import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { t } from '../i18n/i18n';

export function nuitValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    if (!control.value) {
      return null;
    }

    const nuit = control.value.toString().trim();

    if (!/^\d{9}$/.test(nuit)) {
      return { nuit: t('companySetup.validation.nuitDigits') };
    }

    return null;
  };
}

export function formatNuit(nuit: string): string {
  const cleaned = nuit.replace(/\D/g, '');
  if (cleaned.length <= 9) {
    return cleaned;
  }
  return cleaned.substring(0, 9);
}
