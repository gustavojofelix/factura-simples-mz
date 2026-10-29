/**
 * Internacionalização da interface (pt-MZ, en-GB, fr-FR).
 *
 * As traduções são carregadas uma única vez antes do arranque (initI18n em main.ts);
 * mudar de língua grava a escolha e recarrega a página, para que tudo — textos,
 * pipes nativos do Angular (date/number/currency) e textos calculados nos .ts —
 * fique coerente. Por isso t() é síncrono e o pipe `t` pode ser puro.
 *
 * Os documentos fiscais (PDF de factura/recibo, SAF-T, Modelo 30) NÃO usam isto:
 * ficam sempre em português.
 *
 * Chaves: 'namespace.secção.chave' — ver src/app/i18n/<língua>/<namespace>.json.
 * Parâmetros: {nome} no texto → t('x.y', { nome: 'Ana' }).
 * Plural: um objecto { "one": "...", "other": "..." } (+ "zero" opcional) e o
 * parâmetro `count` → t('x.items', { count: 3 }).
 */

import { Capacitor } from '@capacitor/core';
import { environment } from '../../../environments/environment';
import { sharedCookieDomain } from '../utils/tenant.util';

export type AppLanguage = 'pt-MZ' | 'en-GB' | 'fr-FR';

export interface LanguageOption {
  code: AppLanguage;
  /** Nome na própria língua, mostrado no seletor. */
  label: string;
  short: string;
  flag: string;
}

export const DEFAULT_LANGUAGE: AppLanguage = 'pt-MZ';

export const LANGUAGES: readonly LanguageOption[] = [
  { code: 'pt-MZ', label: 'Português', short: 'PT', flag: 'assets/flags/mz.svg' },
  { code: 'en-GB', label: 'English (UK)', short: 'EN', flag: 'assets/flags/gb.svg' },
  { code: 'fr-FR', label: 'Français', short: 'FR', flag: 'assets/flags/fr.svg' }
];

export const LANGUAGE_STORAGE_KEY = 'uiLanguage';

type Dictionary = { [key: string]: string | Dictionary };
export type TranslateParams = Record<string, string | number | null | undefined>;

const loaders: Record<AppLanguage, () => Promise<{ default: Dictionary }>> = {
  'pt-MZ': () => import('../../i18n/pt-MZ'),
  'en-GB': () => import('../../i18n/en-GB'),
  'fr-FR': () => import('../../i18n/fr-FR')
};

let language: AppLanguage = DEFAULT_LANGUAGE;
let dictionary: Dictionary = {};
let fallback: Dictionary = {};
const pluralRules = new Map<string, Intl.PluralRules>();

export function isAppLanguage(value: unknown): value is AppLanguage {
  return typeof value === 'string' && LANGUAGES.some(l => l.code === value);
}

/** Cookie em .<rootDomain> para a escolha valer em todos os subdomínios das contas. */
function languageCookieDomain(): string | null {
  if (typeof window === 'undefined' || Capacitor.isNativePlatform()) return null;
  return sharedCookieDomain(window.location.hostname, environment.rootDomain);
}

function readCookie(name: string): string | null {
  try {
    const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

/** Língua guardada (cookie partilhado → localStorage) → língua do browser → pt-MZ. */
export function detectLanguage(): AppLanguage {
  const cookie = readCookie(LANGUAGE_STORAGE_KEY);
  if (isAppLanguage(cookie)) return cookie;
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (isAppLanguage(stored)) return stored;
  } catch { /* armazenamento indisponível */ }

  const preferred = typeof navigator !== 'undefined'
    ? (navigator.languages?.length ? navigator.languages : [navigator.language])
    : [];
  for (const tag of preferred) {
    const base = (tag || '').toLowerCase().split('-')[0];
    if (base === 'pt') return 'pt-MZ';
    if (base === 'en') return 'en-GB';
    if (base === 'fr') return 'fr-FR';
  }
  return DEFAULT_LANGUAGE;
}

/** Carrega a língua activa (e o português como recurso para chaves em falta). */
export async function initI18n(): Promise<void> {
  language = detectLanguage();
  const [current, pt] = await Promise.all([
    loaders[language](),
    language === DEFAULT_LANGUAGE ? Promise.resolve(null) : loaders[DEFAULT_LANGUAGE]()
  ]);
  dictionary = current.default;
  fallback = pt?.default ?? current.default;
  if (typeof document !== 'undefined') document.documentElement.lang = language;
}

/** Língua da interface. */
export function currentLanguage(): AppLanguage {
  return language;
}

/** Locale para Intl.* / pipes do Angular na interface (não usar em documentos fiscais). */
export function currentLocale(): string {
  return language;
}

/** Grava a língua localmente. Devolve true se mudou (e é preciso recarregar). */
export function storeLanguage(code: AppLanguage): boolean {
  try { localStorage.setItem(LANGUAGE_STORAGE_KEY, code); } catch { /* ignora */ }
  const domain = languageCookieDomain();
  if (domain) {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${LANGUAGE_STORAGE_KEY}=${code}; Domain=${domain}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  }
  return code !== language;
}

function lookup(dict: Dictionary, key: string): string | Dictionary | undefined {
  let node: string | Dictionary | undefined = dict;
  for (const part of key.split('.')) {
    if (!node || typeof node === 'string') return undefined;
    node = node[part];
  }
  return node;
}

function pluralForm(node: Dictionary, count: number): string | undefined {
  if (count === 0 && typeof node['zero'] === 'string') return node['zero'];
  let rules = pluralRules.get(language);
  if (!rules) {
    rules = new Intl.PluralRules(language);
    pluralRules.set(language, rules);
  }
  const form = node[rules.select(count)] ?? node['other'];
  return typeof form === 'string' ? form : undefined;
}

function resolve(dict: Dictionary, key: string, params?: TranslateParams): string | undefined {
  const node = lookup(dict, key);
  if (typeof node === 'string') return node;
  if (node && typeof params?.['count'] === 'number') return pluralForm(node, params['count']);
  return undefined;
}

/** Tradução na língua actual, ou undefined se não existir (sem aviso nem recurso ao português). */
export function tOptional(key: string): string | undefined {
  return resolve(dictionary, key);
}

/** Traduz uma chave. Chave em falta → texto em português → a própria chave. */
export function t(key: string, params?: TranslateParams): string {
  let text = resolve(dictionary, key, params) ?? resolve(fallback, key, params);
  if (text === undefined) {
    console.warn(`[i18n] Chave em falta: ${key}`);
    return key;
  }
  if (params) {
    text = text.replace(/\{(\w+)\}/g, (match, name: string) => {
      const value = params[name];
      return value === null || value === undefined ? match : String(value);
    });
  }
  return text;
}
