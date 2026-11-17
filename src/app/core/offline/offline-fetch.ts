import { signal } from '@angular/core';
import { offlineStore } from './offline-store';

/**
 * Modo offline (só leitura) da app nativa.
 *
 * Envolve o fetch do cliente Supabase: cada leitura bem-sucedida da API REST
 * (consultas e RPCs de leitura) fica guardada em IndexedDB; sem rede, a mesma
 * leitura devolve a última resposta guardada. Escritas nunca usam o cache —
 * sem rede falham como antes.
 */

/** RPCs que só lêem dados (seguras para devolver do cache). */
const READ_RPCS = new Set([
  'get_my_accounts',
  'get_company_plan_level',
  'subscription_feature_value',
  'company_pos_access',
  'resolve_account_by_slug',
  'client_statement_summary',
  'client_statement_movements',
  'ai_quota_status',
  'calculate_ispc_for_period'
]);

/** Cabeçalhos da resposta que o supabase-js lê (contagens, formato). */
const KEPT_RESPONSE_HEADERS = ['content-type', 'content-range', 'preference-applied'];

/** Com rede fraca, ao fim deste tempo usa-se o cache (o pedido continua e actualiza-o). */
const SLOW_NETWORK_MS = 10_000;

const OWNER_KEY = 'ispc-offline-owner';

interface CachedResponse {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: string;
  savedAt: number;
}

/** True enquanto a app mostra dados guardados por falta de ligação. */
export const offlineMode = signal(false);

/**
 * Associa o cache ao utilizador autenticado: se entrar outra pessoa, o cache
 * anterior é apagado. Com `null` (logout explícito) apaga tudo.
 */
export async function bindOfflineCacheToUser(userId: string | null): Promise<void> {
  let owner: string | null = null;
  try {
    owner = localStorage.getItem(OWNER_KEY);
  } catch {
    owner = null;
  }
  if (owner === userId) return;
  if (owner !== null || userId === null) await offlineStore.clear();
  try {
    if (userId) localStorage.setItem(OWNER_KEY, userId);
    else localStorage.removeItem(OWNER_KEY);
  } catch {
    // ignore
  }
}

export function createOfflineFetch(supabaseUrl: string, anonKey: string): typeof fetch {
  const restPrefix = `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/`;

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));

    const key = cacheKey(url, method, headers, init?.body, restPrefix);
    if (!key) return fetch(input, init);

    // Só se guardam respostas pedidas com o token do utilizador: pedidos anónimos
    // (ex.: token expirado ainda por renovar) devolvem listas vazias por causa do
    // RLS e estragariam o cache. Ler do cache sem rede funciona nos dois casos.
    const auth = headers.get('Authorization') ?? '';
    const canStore = auth !== '' && auth !== `Bearer ${anonKey}`;

    const cachedPromise = offlineStore.get<CachedResponse>(key);

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      const cached = await cachedPromise;
      if (cached) return fromCache(cached);
      return fetch(input, init);
    }

    const network = fetch(input, init).then(async response => {
      offlineMode.set(false);
      if (canStore && (response.status === 200 || response.status === 206)) {
        const body = method === 'HEAD' ? '' : await response.clone().text();
        void offlineStore.set(key, {
          status: response.status,
          statusText: response.statusText,
          headers: KEPT_RESPONSE_HEADERS
            .map(h => [h, response.headers.get(h)] as [string, string | null])
            .filter((h): h is [string, string] => h[1] !== null),
          body,
          savedAt: Date.now()
        } satisfies CachedResponse);
      }
      return response;
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const slow = new Promise<'slow'>(resolve => { timer = setTimeout(() => resolve('slow'), SLOW_NETWORK_MS); });

    try {
      const winner = await Promise.race([network, slow]);
      if (winner !== 'slow') return winner;
      const cached = await cachedPromise;
      return cached ? fromCache(cached) : await network;
    } catch (error) {
      const cached = await cachedPromise;
      if (cached) return fromCache(cached);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Chave do cache, ou null se o pedido não é uma leitura REST (consulta ou RPC de leitura). */
function cacheKey(
  url: string,
  method: string,
  headers: Headers,
  body: BodyInit | null | undefined,
  restPrefix: string
): string | null {
  if (!url.startsWith(restPrefix)) return null;

  const path = url.slice(restPrefix.length).split('?')[0];
  const isRead = method === 'GET' || method === 'HEAD';
  const isReadRpc = method === 'POST' && path.startsWith('rpc/') && READ_RPCS.has(path.slice(4));
  if (!isRead && !isReadRpc) return null;
  if (body !== undefined && body !== null && typeof body !== 'string') return null;

  return [
    method,
    url,
    body ?? '',
    headers.get('Accept') ?? '',
    headers.get('Prefer') ?? '',
    headers.get('Range') ?? ''
  ].join('\u0001');
}

function fromCache(cached: CachedResponse): Response {
  offlineMode.set(true);
  return new Response(cached.body === '' ? null : cached.body, {
    status: cached.status,
    statusText: cached.statusText,
    headers: cached.headers
  });
}
