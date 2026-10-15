// URL da app no subdomínio da conta a que a empresa pertence
// (ex.: https://acme.ispcfacil.co.mz). Sem conta, ou se a consulta falhar,
// devolve o SITE_URL da raiz.

// deno-lint-ignore no-explicit-any
type Admin = any;

export function siteUrl(): string {
  return (Deno.env.get("SITE_URL") ?? "https://ispcfacil.co.mz").replace(/\/+$/, "");
}

export function accountOrigin(slug: string | null | undefined): string {
  const root = siteUrl();
  if (!slug) return root;
  try {
    const url = new URL(root);
    url.hostname = `${slug}.${url.hostname.replace(/^www\./, "")}`;
    return url.origin;
  } catch {
    return root;
  }
}

export async function accountUrlForCompany(admin: Admin, companyId: string | null | undefined): Promise<string> {
  if (!companyId) return siteUrl();
  const { data, error } = await admin
    .from("companies")
    .select("accounts(slug)")
    .eq("id", companyId)
    .maybeSingle();
  if (error) {
    console.warn("accountUrlForCompany:", error.message);
    return siteUrl();
  }
  return accountOrigin(data?.accounts?.slug);
}

/** Slug por empresa, numa só consulta (para envios em lote). */
export async function accountUrlsForCompanies(admin: Admin, companyIds: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (companyIds.length === 0) return result;
  const { data, error } = await admin
    .from("companies")
    .select("id, accounts(slug)")
    .in("id", companyIds);
  if (error) console.warn("accountUrlsForCompanies:", error.message);
  for (const row of (data ?? []) as Array<{ id: string; accounts?: { slug?: string } | null }>) {
    result.set(row.id, accountOrigin(row.accounts?.slug));
  }
  return result;
}
