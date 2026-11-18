/**
 * Ponto de quebra "compacto" (telemóvel). Abaixo dele os diálogos abrem em ecrã
 * inteiro e os componentes adaptativos usam o layout de telemóvel.
 * Mantém-se igual ao `sm` do Tailwind (640px) menos a margem habitual do Material.
 */
export const COMPACT_MEDIA_QUERY = '(max-width: 599.98px)';

export function isCompactViewport(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.(COMPACT_MEDIA_QUERY).matches;
}
