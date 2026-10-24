import { AbstractControl, AsyncValidatorFn, ValidationErrors, ValidatorFn } from '@angular/forms';
import { from, map, Observable, of, switchMap, timer } from 'rxjs';
import { AccountService } from '../services/account.service';
import { ACCOUNT_SLUG_PATTERN } from '../utils/tenant.util';
import { t } from '../i18n/i18n';

/** Formato do endereço da conta: 3 a 32 caracteres, letras minúsculas, números e hífens. */
export function accountSlugFormatValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = (control.value || '').toString();
    if (!value) return null;
    return ACCOUNT_SLUG_PATTERN.test(value) ? null : { slugFormat: true };
  };
}

/** Verifica (com debounce) se o endereço está livre. */
export function accountSlugAvailableValidator(accountService: AccountService): AsyncValidatorFn {
  return (control: AbstractControl): Observable<ValidationErrors | null> => {
    const value = (control.value || '').toString();
    if (!ACCOUNT_SLUG_PATTERN.test(value)) return of(null);
    return timer(400).pipe(
      switchMap(() => from(accountService.isSlugAvailable(value))),
      map(available => (available ? null : { slugTaken: true }))
    );
  };
}

export function accountSlugErrorMessage(control: AbstractControl | null): string {
  if (!control) return '';
  if (control.hasError('required')) return t('account.slug.required');
  if (control.hasError('slugFormat')) {
    return t('account.slug.format');
  }
  if (control.hasError('slugTaken')) return t('account.slug.taken');
  return '';
}
