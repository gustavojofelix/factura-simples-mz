// Língua dos e-mails e das respostas das funções edge.
//
// A língua de cada utilizador está em public.profiles.language
// ('pt-MZ' | 'en-GB' | 'fr-FR'; NULL = ainda não escolhida → 'pt-MZ').
// As funções de IA recebem-na no corpo do pedido (`language`).
//
// Regras:
// - E-mails para utilizadores da plataforma (donos de conta, convidados)
//   seguem a língua do destinatário.
// - E-mails para a LTS (admin) e documentos fiscais (facturas enviadas aos
//   clientes da empresa) ficam sempre em português.
// - As funções daqui nunca lançam excepção: em caso de dúvida, 'pt-MZ'.

import type { DbClient } from "./email.ts";

export type EmailLanguage = "pt-MZ" | "en-GB" | "fr-FR";

export const DEFAULT_LANGUAGE: EmailLanguage = "pt-MZ";

/** Texto nas três línguas. */
export type Localized<T = string> = Record<EmailLanguage, T>;

/**
 * Converte um valor qualquer numa língua suportada. Aceita os códigos completos
 * e os prefixos ('pt', 'en', 'fr', 'en-US', 'fr_FR'...). Tudo o resto → 'pt-MZ'.
 */
export function normalizeLanguage(value: unknown): EmailLanguage {
  if (typeof value !== "string") return DEFAULT_LANGUAGE;
  const prefix = value.trim().toLowerCase().slice(0, 2);
  if (prefix === "en") return "en-GB";
  if (prefix === "fr") return "fr-FR";
  return DEFAULT_LANGUAGE;
}

/** Escolhe o texto da língua pedida (com recurso ao português). */
export function pick<T>(texts: Localized<T>, language: EmailLanguage): T {
  return texts[language] ?? texts[DEFAULT_LANGUAGE];
}

/** Atributo `lang` do HTML ('pt', 'en', 'fr'). */
export function htmlLang(language: EmailLanguage): string {
  return language.slice(0, 2);
}

/** Língua de um utilizador (profiles.language). Nunca lança. */
export async function getUserLanguage(
  db: DbClient,
  userId: string | null | undefined,
): Promise<EmailLanguage> {
  if (!userId) return DEFAULT_LANGUAGE;
  try {
    const { data, error } = await db
      .from("profiles")
      .select("language")
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      console.warn(`[i18n] profiles.language ${userId}:`, error.message ?? error);
      return DEFAULT_LANGUAGE;
    }
    return normalizeLanguage(data?.language);
  } catch (e) {
    console.warn("[i18n] language lookup threw:", e);
    return DEFAULT_LANGUAGE;
  }
}

/** Língua de vários utilizadores numa só consulta. Utilizadores sem linha ficam com 'pt-MZ'. */
export async function getUsersLanguages(
  db: DbClient,
  userIds: Array<string | null | undefined>,
): Promise<Map<string, EmailLanguage>> {
  const ids = [...new Set(userIds.filter((id): id is string => !!id))];
  const out = new Map<string, EmailLanguage>();
  for (const id of ids) out.set(id, DEFAULT_LANGUAGE);
  if (!ids.length) return out;
  try {
    const { data, error } = await db
      .from("profiles")
      .select("id, language")
      .in("id", ids);
    if (error) {
      console.warn("[i18n] profiles.language (lote):", error.message ?? error);
      return out;
    }
    for (const row of (data ?? []) as Array<{ id: string; language?: unknown }>) {
      out.set(row.id, normalizeLanguage(row.language));
    }
  } catch (e) {
    console.warn("[i18n] batch language lookup threw:", e);
  }
  return out;
}

/** Rodapé por omissão dos e-mails automáticos (emailLayout). */
export const DEFAULT_EMAIL_FOOTER: Localized = {
  "pt-MZ": "E-mail automático do ISPC Fácil. Não responda a este e-mail.",
  "en-GB": "Automated e-mail from ISPC Fácil. Please do not reply to this e-mail.",
  "fr-FR": "E-mail automatique d'ISPC Fácil. Merci de ne pas répondre à cet e-mail.",
};
