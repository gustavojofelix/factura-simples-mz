import { parseAccountSlug, sharedCookieDomain, slugifyAccount } from './tenant.util';

describe('tenant.util', () => {
  describe('parseAccountSlug', () => {
    const root = 'ispcfacil.com';

    it('extrai o slug de um subdomínio de conta', () => {
      expect(parseAccountSlug('acme.ispcfacil.com', root)).toBe('acme');
      expect(parseAccountSlug('ACME-2.ispcfacil.com', root)).toBe('acme-2');
    });

    it('devolve null na raiz, em www e noutros domínios', () => {
      expect(parseAccountSlug('ispcfacil.com', root)).toBeNull();
      expect(parseAccountSlug('www.ispcfacil.com', root)).toBeNull();
      expect(parseAccountSlug('acme.netlify.app', root)).toBeNull();
      expect(parseAccountSlug('fakeispcfacil.com', root)).toBeNull();
    });

    it('ignora subdomínios encadeados ou inválidos', () => {
      expect(parseAccountSlug('a.b.ispcfacil.com', root)).toBeNull();
      expect(parseAccountSlug('ab.ispcfacil.com', root)).toBeNull();
      expect(parseAccountSlug('-acme.ispcfacil.com', root)).toBeNull();
    });

    it('suporta slug.localhost em desenvolvimento', () => {
      expect(parseAccountSlug('acme.localhost', 'localhost')).toBe('acme');
      expect(parseAccountSlug('localhost', 'localhost')).toBeNull();
    });
  });

  describe('slugifyAccount', () => {
    it('remove acentos, símbolos e hífens nas pontas', () => {
      expect(slugifyAccount('  Construções São João, Lda. ')).toBe('construcoes-sao-joao-lda');
    });

    it('limita a 32 caracteres sem terminar em hífen', () => {
      const slug = slugifyAccount('a'.repeat(31) + ' bcd');
      expect(slug.length).toBeLessThanOrEqual(32);
      expect(slug.endsWith('-')).toBe(false);
    });
  });

  describe('sharedCookieDomain', () => {
    it('partilha cookies entre a raiz e os subdomínios', () => {
      expect(sharedCookieDomain('acme.ispcfacil.com', 'ispcfacil.com')).toBe('.ispcfacil.com');
      expect(sharedCookieDomain('ispcfacil.com', 'ispcfacil.com')).toBe('.ispcfacil.com');
    });

    it('não usa cookies em localhost nem noutros domínios', () => {
      expect(sharedCookieDomain('acme.localhost', 'localhost')).toBeNull();
      expect(sharedCookieDomain('preview.netlify.app', 'ispcfacil.com')).toBeNull();
    });
  });
});
