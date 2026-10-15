/** Formato de um slug de conta (igual ao CHECK da tabela accounts). */
export const ACCOUNT_SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{1,30}[a-z0-9])$/;

/** Subdomínios que nunca identificam uma conta. */
const NON_ACCOUNT_SUBDOMAINS = new Set(['www']);

/**
 * Extrai o slug da conta a partir do host.
 * `acme.ispcfacil.co.mz` → `acme`; `ispcfacil.co.mz`, `www.ispcfacil.co.mz`,
 * hosts de outros domínios ou subdomínios encadeados → `null`.
 */
export function parseAccountSlug(hostname: string, rootDomain: string): string | null {
  const host = (hostname || '').toLowerCase().replace(/\.$/, '');
  const root = (rootDomain || '').toLowerCase();
  if (!root || host === root || !host.endsWith('.' + root)) return null;

  const sub = host.slice(0, -(root.length + 1));
  if (sub.includes('.') || NON_ACCOUNT_SUBDOMAINS.has(sub)) return null;
  return ACCOUNT_SLUG_PATTERN.test(sub) ? sub : null;
}

/** Sugere um slug a partir de um nome livre (remove acentos e símbolos). */
export function slugifyAccount(text: string): string {
  return (text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '');
}

/** Domínio dos cookies partilhados entre subdomínios (null quando não aplicável). */
export function sharedCookieDomain(hostname: string, rootDomain: string): string | null {
  const host = (hostname || '').toLowerCase();
  const root = (rootDomain || '').toLowerCase();
  // Browsers não aceitam cookies com domain=.localhost; em dev cada host guarda a sua sessão.
  if (!root || root === 'localhost') return null;
  if (host !== root && !host.endsWith('.' + root)) return null;
  return '.' + root;
}
