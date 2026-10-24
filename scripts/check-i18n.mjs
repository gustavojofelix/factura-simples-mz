#!/usr/bin/env node
/**
 * Verifica as traduções em src/app/i18n:
 *  1. JSON válido e as mesmas chaves (e os mesmos {parâmetros}) nas três línguas;
 *  2. todas as chaves usadas no código (`'x.y' | t` e `t('x.y')`) existem em pt-MZ.
 *
 *   node scripts/check-i18n.mjs              → tudo
 *   node scripts/check-i18n.mjs invoices     → só os namespaces indicados
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const I18N = join(ROOT, 'src/app/i18n');
const SRC = join(ROOT, 'src/app');
const LANGS = ['pt-MZ', 'en-GB', 'fr-FR'];
const BASE = 'pt-MZ';
const PLURAL_FORMS = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);
const only = new Set(process.argv.slice(2));

let problems = 0;
const report = (msg) => { problems++; console.log('  ✗ ' + msg); };

function isPlural(node) {
  return node && typeof node === 'object' && Object.keys(node).length > 0
    && Object.keys(node).every(k => PLURAL_FORMS.has(k)) && 'other' in node;
}

function flatten(node, prefix, out) {
  for (const [k, v] of Object.entries(node)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.set(key, v);
    else if (isPlural(v)) out.set(key, Object.values(v).join(' '));
    else if (v && typeof v === 'object') flatten(v, key, out);
    else report(`${key}: valor inválido (${typeof v})`);
  }
  return out;
}

const params = (text) => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');

// 1. Consistência entre línguas
const namespaces = readdirSync(join(I18N, BASE)).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));
const keys = {};
for (const lang of LANGS) {
  keys[lang] = new Map();
  for (const ns of namespaces) {
    if (only.size && !only.has(ns)) continue;
    let data;
    try {
      data = JSON.parse(readFileSync(join(I18N, lang, `${ns}.json`), 'utf8'));
    } catch (e) {
      report(`${lang}/${ns}.json: ${e.message}`);
      continue;
    }
    for (const [k, v] of flatten(data, ns, new Map())) keys[lang].set(k, v);
  }
}

console.log('Consistência entre línguas');
for (const lang of LANGS.filter(l => l !== BASE)) {
  for (const [k, v] of keys[BASE]) {
    if (!keys[lang].has(k)) report(`${lang}: falta ${k}`);
    else if (params(v) !== params(keys[lang].get(k))) report(`${lang}: parâmetros diferentes em ${k}`);
  }
  for (const k of keys[lang].keys()) if (!keys[BASE].has(k)) report(`${lang}: chave a mais ${k}`);
}

// 2. Chaves usadas no código
console.log('Chaves usadas no código');
const usage = [
  /(['"])([a-zA-Z]+(?:\.[\w-]+)+)\1\s*\|\s*t\b/g,
  /\bt\(\s*(['"`])([a-zA-Z]+(?:\.[\w-]+)+)\1/g
];
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) { if (entry !== 'i18n') walk(path); continue; }
    if (!/\.(ts|html)$/.test(entry) || entry.endsWith('.spec.ts')) continue;
    const text = readFileSync(path, 'utf8');
    for (const re of usage) {
      for (const m of text.matchAll(re)) {
        const key = m[2];
        const ns = key.split('.')[0];
        if (!namespaces.includes(ns)) continue;
        if (only.size && !only.has(ns)) continue;
        if (!keys[BASE].has(key)) {
          const line = text.slice(0, m.index).split('\n').length;
          report(`${relative(ROOT, path).replace(/\\/g, '/')}:${line} usa ${key}, que não existe em ${BASE}`);
        }
      }
    }
  }
}
walk(SRC);

console.log(problems ? `\n${problems} problema(s).` : '\nTudo certo.');
process.exit(problems ? 1 : 0);
