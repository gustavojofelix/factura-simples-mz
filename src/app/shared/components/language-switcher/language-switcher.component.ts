import { Component, inject, input } from '@angular/core';
import { MatMenuModule } from '@angular/material/menu';
import { AppLanguage, LANGUAGES } from '../../../core/i18n/i18n';
import { LanguageService } from '../../../core/i18n/language.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';

/**
 * Seletor de língua (bandeira + código) para o canto superior direito.
 * `variant="dark"` para fundos escuros/transparentes (ex.: hero da landing).
 */
@Component({
  selector: 'app-language-switcher',
  standalone: true,
  imports: [MatMenuModule, TranslatePipe],
  template: `
    <button type="button" class="lang-trigger" [class.lang-trigger-dark]="variant() === 'dark'"
      [matMenuTriggerFor]="langMenu" [attr.aria-label]="'common.language.choose' | t"
      [title]="'common.language.choose' | t">
      <img [src]="active.flag" alt="" class="lang-flag" width="22" height="16">
      @if (!compact()) {
        <span class="lang-code">{{ active.short }}</span>
      }
      <svg class="lang-caret" viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 7.5 10 12l4.5-4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>

    <mat-menu #langMenu="matMenu" xPosition="before" class="lang-menu-panel">
      @for (lang of languages; track lang.code) {
        <button mat-menu-item type="button" (click)="select(lang.code)" [attr.lang]="lang.code"
          [attr.aria-current]="lang.code === active.code ? 'true' : null">
          <span class="lang-option" [class.lang-option-active]="lang.code === active.code">
            <img [src]="lang.flag" alt="" class="lang-flag" width="22" height="16">
            <span class="lang-option-label">{{ lang.label }}</span>
            @if (lang.code === active.code) {
              <svg class="lang-check" viewBox="0 0 20 20" aria-hidden="true"><path d="m5 10.5 3.2 3.2L15 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            }
          </span>
        </button>
      }
    </mat-menu>
  `,
  styles: [`
    :host { display: inline-flex; }
    .lang-trigger {
      display: inline-flex; align-items: center; gap: .4rem;
      height: 2.25rem; padding: 0 .55rem 0 .5rem;
      border-radius: .75rem; border: 1px solid rgb(226 232 240);
      background: rgba(255,255,255,.85); color: rgb(51 65 85);
      font-size: .8rem; font-weight: 700; letter-spacing: .04em;
      cursor: pointer; transition: background-color .15s, border-color .15s, box-shadow .15s;
    }
    .lang-trigger:hover { border-color: rgb(253 186 116); background: #fff; box-shadow: 0 1px 3px rgba(15,23,42,.08); }
    .lang-trigger:focus-visible { outline: 2px solid rgb(249 115 22); outline-offset: 2px; }
    .lang-trigger-dark { background: rgba(255,255,255,.12); border-color: rgba(255,255,255,.35); color: #fff; }
    .lang-trigger-dark:hover { background: rgba(255,255,255,.22); border-color: rgba(255,255,255,.6); }
    .lang-flag {
      width: 22px; height: 16px; border-radius: 3px; object-fit: cover; flex-shrink: 0;
      box-shadow: 0 0 0 1px rgba(15,23,42,.12);
    }
    .lang-caret { width: 14px; height: 14px; opacity: .7; }
    .lang-option { display: flex; align-items: center; gap: .65rem; min-width: 10rem; }
    .lang-option-label { flex: 1; font-size: .875rem; color: rgb(30 41 59); }
    .lang-option-active .lang-option-label { font-weight: 700; }
    .lang-check { width: 18px; height: 18px; color: rgb(249 115 22); }
  `]
})
export class LanguageSwitcherComponent {
  private languageService = inject(LanguageService);

  readonly variant = input<'light' | 'dark'>('light');
  /** Só a bandeira (sem o código), para headers estreitos. */
  readonly compact = input(false);

  readonly languages = LANGUAGES;
  readonly active = LANGUAGES.find(l => l.code === this.languageService.current) ?? LANGUAGES[0];

  select(code: AppLanguage): void {
    void this.languageService.setLanguage(code);
  }
}
