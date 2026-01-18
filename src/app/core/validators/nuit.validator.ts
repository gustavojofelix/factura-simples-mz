import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export function nuitValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    if (!control.value) {
      return null;
    }

    const nuit = control.value.toString().replace(/\D/g, '');

    if (nuit.length !== 9) {
      return { nuit: 'O NUIT deve ter exatamente 9 dígitos' };
    }

    if (!/^\d{9}$/.test(nuit)) {
      return { nuit: 'O NUIT deve conter apenas números' };
    }

    if (!validateNuitChecksum(nuit)) {
      return { nuit: 'NUIT inválido' };
    }

    return null;
  };
}

function validateNuitChecksum(nuit: string): boolean {
  const digits = nuit.split('').map(d => parseInt(d, 10));
  const checkDigit = digits[8];

  const weights = [2, 7, 6, 5, 4, 3, 2];
  let sum = 0;

  for (let i = 0; i < 7; i++) {
    sum += digits[i] * weights[i];
  }

  const mod = sum % 11;
  let calculatedCheckDigit: number;

  if (mod === 0 || mod === 1) {
    calculatedCheckDigit = 0;
  } else {
    calculatedCheckDigit = 11 - mod;
  }

  return checkDigit === calculatedCheckDigit;
}

export function formatNuit(nuit: string): string {
  const cleaned = nuit.replace(/\D/g, '');
  if (cleaned.length <= 9) {
    return cleaned;
  }
  return cleaned.substring(0, 9);
}
