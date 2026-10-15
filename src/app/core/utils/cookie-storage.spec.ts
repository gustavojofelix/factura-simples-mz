import { createSharedCookieStorage, withLocalStorageMigration } from './cookie-storage';

/** Document mínimo com um "cookie jar" que respeita Max-Age=0. */
function fakeDocument() {
  const jar = new Map<string, string>();
  const doc = {
    location: { protocol: 'https:' },
    get cookie() {
      return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    set cookie(value: string) {
      const [pair, ...attrs] = value.split(';').map(p => p.trim());
      const index = pair.indexOf('=');
      const name = pair.slice(0, index);
      if (attrs.some(a => a === 'Max-Age=0')) jar.delete(name);
      else jar.set(name, pair.slice(index + 1));
    }
  };
  return { doc: doc as unknown as Document, jar };
}

describe('cookie-storage', () => {
  it('guarda e lê valores grandes em blocos', () => {
    const { doc, jar } = fakeDocument();
    const storage = createSharedCookieStorage('.ispcfacil.com', doc);
    const value = JSON.stringify({ token: 'x'.repeat(7000), name: 'Jõão; =' });

    storage.setItem('sb-auth', value);

    expect(Number(jar.get('sb-auth.n'))).toBeGreaterThan(1);
    expect(storage.getItem('sb-auth')).toBe(value);
  });

  it('remove blocos que sobram quando o valor encolhe', () => {
    const { doc, jar } = fakeDocument();
    const storage = createSharedCookieStorage('.ispcfacil.com', doc);

    storage.setItem('k', 'y'.repeat(7000));
    storage.setItem('k', 'curto');

    expect(storage.getItem('k')).toBe('curto');
    expect(jar.has('k.1')).toBe(false);
  });

  it('removeItem apaga todos os blocos', () => {
    const { doc, jar } = fakeDocument();
    const storage = createSharedCookieStorage('.ispcfacil.com', doc);

    storage.setItem('k', 'z'.repeat(7000));
    storage.removeItem('k');

    expect(storage.getItem('k')).toBeNull();
    expect(jar.size).toBe(0);
  });

  it('migra uma sessão antiga do localStorage para os cookies', () => {
    const { doc } = fakeDocument();
    const cookies = createSharedCookieStorage('.ispcfacil.com', doc);
    localStorage.setItem('sb-auth', 'sessao-antiga');

    const storage = withLocalStorageMigration(cookies, localStorage);

    expect(storage.getItem('sb-auth')).toBe('sessao-antiga');
    expect(cookies.getItem('sb-auth')).toBe('sessao-antiga');
    expect(localStorage.getItem('sb-auth')).toBeNull();
  });
});
