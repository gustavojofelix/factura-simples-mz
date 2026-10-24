import { bootstrapApplication } from '@angular/platform-browser';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideRouter, withHashLocation } from '@angular/router';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { LOCALE_ID, importProvidersFrom, inject, provideAppInitializer } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localePt from '@angular/common/locales/pt';
import localeEnGb from '@angular/common/locales/en-GB';
import localeFr from '@angular/common/locales/fr';
import { provideNativeDateAdapter } from '@angular/material/core';
import { PreferencesService } from './app/core/services/preferences.service';
import { currentLocale, initI18n } from './app/core/i18n/i18n';

registerLocaleData(localePt, 'pt-MZ');
registerLocaleData(localeEnGb, 'en-GB');
registerLocaleData(localeFr, 'fr-FR');

// As traduções carregam antes do arranque para que t() seja síncrono em todo o lado.
initI18n().then(() => bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(routes, withHashLocation()),
    provideAnimations(),
    provideNativeDateAdapter(),
    // Locale da interface (pipes date/number/currency, Material). Documentos fiscais usam 'pt-MZ' explícito.
    { provide: LOCALE_ID, useValue: currentLocale() },
    // Sem fuso global no DatePipe: nas páginas /admin/* os campos timestamp passam
    // ':+0200' (Maputo) explicitamente; datas sem hora ('YYYY-MM-DD') ficam sem
    // conversão. As páginas da empresa usam o pipe appDate (Configurações > Sistema).
    // Carrega as preferências (fuso/formato de data) da empresa activa desde o arranque.
    provideAppInitializer(() => { inject(PreferencesService); })
  ]
})).catch(err => console.error(err));
