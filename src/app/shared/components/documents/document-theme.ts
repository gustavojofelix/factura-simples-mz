import { DocumentBranding } from '../../../core/services/document-settings.service';

/**
 * Converte a marca da empresa nas variáveis CSS usadas pelos modelos.
 *
 * Todos os valores saem em hexadecimal de seis dígitos, sem excepção. O
 * html2canvas 1.4.1 rebenta a analisar funções de cor modernas, por isso as
 * misturas e os contrastes são calculados aqui e não em CSS.
 */
export function documentThemeVars(branding: DocumentBranding): Record<string, string> {
  const brand = normalizeHex(branding.primary_color, '#f16c39');
  const accent = normalizeHex(branding.accent_color, '#332d2a');

  return {
    '--doc-brand': brand,
    '--doc-brand-soft': mixWithWhite(brand, 0.9),
    '--doc-brand-tint': mixWithWhite(brand, 0.72),
    '--doc-on-brand': readableTextOn(brand),
    '--doc-accent': accent,
    '--doc-on-accent': readableTextOn(accent)
  };
}

/** Garante um hexadecimal de seis dígitos, aceitando também a forma curta. */
export function normalizeHex(value: string | null | undefined, fallback: string): string {
  const raw = String(value ?? '').trim();

  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();

  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    const [r, g, b] = raw.slice(1).split('');
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }

  return fallback;
}

/**
 * Mistura a cor com branco. Um peso de 0.9 devolve algo quase branco, próprio
 * para fundos suaves.
 */
export function mixWithWhite(hex: string, weight: number): string {
  const { r, g, b } = toRgb(hex);
  const w = Math.min(1, Math.max(0, weight));

  return toHex(
    Math.round(r + (255 - r) * w),
    Math.round(g + (255 - g) * w),
    Math.round(b + (255 - b) * w)
  );
}

/**
 * Escolhe texto escuro ou claro conforme a luminosidade do fundo. Sem isto,
 * uma empresa que escolha um amarelo claro fica com texto branco ilegível no
 * cabeçalho da sua própria factura.
 */
export function readableTextOn(hex: string): string {
  const { r, g, b } = toRgb(hex);

  // Luminância relativa, conforme a fórmula das normas de acessibilidade.
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };

  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

  return luminance > 0.45 ? '#1f1a17' : '#ffffff';
}

function toRgb(hex: string): { r: number; g: number; b: number } {
  const safe = normalizeHex(hex, '#000000').slice(1);
  return {
    r: parseInt(safe.slice(0, 2), 16),
    g: parseInt(safe.slice(2, 4), 16),
    b: parseInt(safe.slice(4, 6), 16)
  };
}

function toHex(r: number, g: number, b: number): string {
  const part = (value: number) =>
    Math.min(255, Math.max(0, value)).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}
