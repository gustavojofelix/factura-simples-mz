/**
 * Storage síncrono para o supabase-js que guarda a sessão em cookies partilhados
 * por todos os subdomínios (domain=.ispcfacil.co.mz), para que o login feito na
 * raiz continue válido em <conta>.ispcfacil.co.mz.
 *
 * Os cookies têm ~4KB de limite, por isso o valor é partido em blocos
 * `<key>.0`, `<key>.1`, ...; `<key>.n` guarda o número de blocos.
 */
const CHUNK_SIZE = 3000;
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export interface SyncStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function createSharedCookieStorage(domain: string, doc: Document = document): SyncStorage {
  const secure = doc.location?.protocol === 'https:' ? '; Secure' : '';
  const attrs = `; Domain=${domain}; Path=/; SameSite=Lax${secure}`;

  const readAll = (): Map<string, string> => {
    const map = new Map<string, string>();
    for (const part of (doc.cookie || '').split(';')) {
      const index = part.indexOf('=');
      if (index < 0) continue;
      map.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
    }
    return map;
  };

  const write = (name: string, value: string, maxAge: number) => {
    doc.cookie = `${name}=${value}; Max-Age=${maxAge}${attrs}`;
  };

  const removeChunks = (key: string, cookies: Map<string, string>) => {
    const count = Number(cookies.get(`${key}.n`) || 0);
    for (let i = 0; i < count; i++) write(`${key}.${i}`, '', 0);
    write(`${key}.n`, '', 0);
  };

  return {
    getItem(key) {
      const cookies = readAll();
      const count = Number(cookies.get(`${key}.n`) || 0);
      if (!count) return null;
      let encoded = '';
      for (let i = 0; i < count; i++) {
        const chunk = cookies.get(`${key}.${i}`);
        if (chunk === undefined) return null;
        encoded += chunk;
      }
      try {
        return decodeURIComponent(encoded);
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      const cookies = readAll();
      const encoded = encodeURIComponent(value);
      const chunks: string[] = [];
      for (let i = 0; i < encoded.length; i += CHUNK_SIZE) {
        chunks.push(encoded.slice(i, i + CHUNK_SIZE));
      }
      const previous = Number(cookies.get(`${key}.n`) || 0);
      chunks.forEach((chunk, i) => write(`${key}.${i}`, chunk, MAX_AGE_SECONDS));
      for (let i = chunks.length; i < previous; i++) write(`${key}.${i}`, '', 0);
      write(`${key}.n`, String(chunks.length), MAX_AGE_SECONDS);
    },
    removeItem(key) {
      removeChunks(key, readAll());
    }
  };
}

/**
 * Wrapper que lê primeiro dos cookies e, se não houver nada, migra uma sessão
 * antiga guardada no localStorage (utilizadores com sessão anterior a esta versão).
 */
export function withLocalStorageMigration(cookieStorage: SyncStorage, local: Storage = localStorage): SyncStorage {
  return {
    getItem(key) {
      const value = cookieStorage.getItem(key);
      if (value !== null) return value;
      try {
        const legacy = local.getItem(key);
        if (legacy !== null) {
          cookieStorage.setItem(key, legacy);
          local.removeItem(key);
        }
        return legacy;
      } catch {
        return null;
      }
    },
    setItem: (key, value) => cookieStorage.setItem(key, value),
    removeItem(key) {
      cookieStorage.removeItem(key);
      try {
        local.removeItem(key);
      } catch {
        // ignore
      }
    }
  };
}
