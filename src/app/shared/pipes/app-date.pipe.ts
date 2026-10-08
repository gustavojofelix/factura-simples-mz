import { Pipe, PipeTransform, inject } from '@angular/core';
import { AppDateStyle, PreferencesService } from '../../core/services/preferences.service';

/**
 * Formata datas segundo Configurações > Sistema (formato de data + fuso horário).
 *
 *   {{ x | appDate }}                   → data
 *   {{ x | appDate:'datetime' }}        → data HH:mm
 *   {{ x | appDate:'datetime-seconds' }}→ data HH:mm:ss
 *   {{ x | appDate:'time' }}            → HH:mm
 *   {{ x | appDate:'short' }}           → dia e mês
 *
 * Impuro para reflectir de imediato uma alteração das preferências; o custo é
 * apenas uma formatação por ciclo de detecção.
 */
@Pipe({ name: 'appDate', standalone: true, pure: false })
export class AppDatePipe implements PipeTransform {
  private prefs = inject(PreferencesService);

  transform(value: string | Date | number | null | undefined, style: AppDateStyle = 'date'): string {
    return this.prefs.format(value, style);
  }
}
