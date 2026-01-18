import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export function nuitValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    if (!control.value) {
      return null;
    }

    const nuit = control.value.toString().trim();

    if (!/^\d{9}$/.test(nuit)) {
      return { nuit: 'NUIT deve ter 9 dígitos' };
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
