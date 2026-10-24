import { Pipe, PipeTransform } from '@angular/core';
import { TranslateParams, t } from './i18n';

/**
 * Traduz uma chave na língua da interface.
 *
 *   {{ 'common.actions.save' | t }}
 *   {{ 'invoices.list.count' | t: { count: total } }}
 *
 * Puro: a língua só muda com recarregamento da página.
 */
@Pipe({ name: 't', standalone: true })
export class TranslatePipe implements PipeTransform {
  transform(key: string, params?: TranslateParams): string {
    return t(key, params);
  }
}
