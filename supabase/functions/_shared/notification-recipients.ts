// Preferências de notificação/apresentação da empresa (Configurações > Sistema,
// tabela public.system_settings) usadas pelas funções que enviam e-mails.
//
// Regras:
// - notification_email é ACRESCENTADO aos destinatários habituais (dono da
//   conta, etc.), nunca os substitui; a lista é deduplicada sem distinguir
//   maiúsculas/minúsculas (uniqueEmails).
// - enable_notifications = false suspende só os avisos não transaccionais
//   (lembretes fiscais). Confirmações de pagamento/subscrição e facturas que o
//   utilizador envia explicitamente continuam a ser enviadas.
// - timezone / date_format servem para formatar datas nos e-mails. Datas de
//   calendário 'AAAA-MM-DD' são formatadas a partir das partes, sem conversão
//   de fuso (senão podiam aparecer com o dia anterior).

import { type DbClient, isEmail, uniqueEmails } from "./email.ts";

export type DateFormat = "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";

export interface CompanyNotificationSettings {
  enableNotifications: boolean;
  notificationEmail: string | null;
  timezone: string;
  dateFormat: DateFormat;
}

export const DEFAULT_NOTIFICATION_SETTINGS: CompanyNotificationSettings = {
  enableNotifications: true,
  notificationEmail: null,
  timezone: "Africa/Maputo",
  dateFormat: "DD/MM/YYYY",
};

const DATE_FORMATS: DateFormat[] = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"];
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function validTimezone(tz: unknown): string {
  if (typeof tz !== "string" || !tz) return DEFAULT_NOTIFICATION_SETTINGS.timezone;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_NOTIFICATION_SETTINGS.timezone;
  }
}

// deno-lint-ignore no-explicit-any
function fromRow(row: any): CompanyNotificationSettings {
  if (!row) return { ...DEFAULT_NOTIFICATION_SETTINGS };
  const email = typeof row.notification_email === "string" ? row.notification_email.trim() : "";
  return {
    // Só "false" explícito desliga; linha em falta ou nulo = ligado.
    enableNotifications: row.enable_notifications !== false,
    notificationEmail: isEmail(email) ? email : null,
    timezone: validTimezone(row.timezone),
    dateFormat: DATE_FORMATS.includes(row.date_format) ? row.date_format : "DD/MM/YYYY",
  };
}

const SELECT = "company_id, enable_notifications, notification_email, timezone, date_format";

/** Configurações de uma empresa. Nunca lança: em caso de erro devolve os valores por omissão. */
export async function getCompanyNotificationSettings(
  db: DbClient,
  companyId: string,
): Promise<CompanyNotificationSettings> {
  try {
    const { data, error } = await db
      .from("system_settings")
      .select(SELECT)
      .eq("company_id", companyId)
      .maybeSingle();
    if (error) {
      console.warn(`[notification-recipients] system_settings ${companyId}:`, error.message ?? error);
      return { ...DEFAULT_NOTIFICATION_SETTINGS };
    }
    return fromRow(data);
  } catch (e) {
    console.warn("[notification-recipients] lookup threw:", e);
    return { ...DEFAULT_NOTIFICATION_SETTINGS };
  }
}

/** Configurações de várias empresas numa só consulta. Empresas sem linha ficam com os valores por omissão. */
export async function getCompaniesNotificationSettings(
  db: DbClient,
  companyIds: string[],
): Promise<Map<string, CompanyNotificationSettings>> {
  const out = new Map<string, CompanyNotificationSettings>();
  for (const id of companyIds) out.set(id, { ...DEFAULT_NOTIFICATION_SETTINGS });
  if (!companyIds.length) return out;
  try {
    const { data, error } = await db
      .from("system_settings")
      .select(SELECT)
      .in("company_id", companyIds);
    if (error) {
      console.warn("[notification-recipients] system_settings (lote):", error.message ?? error);
      return out;
    }
    // deno-lint-ignore no-explicit-any
    for (const row of (data ?? []) as any[]) out.set(row.company_id, fromRow(row));
  } catch (e) {
    console.warn("[notification-recipients] batch lookup threw:", e);
  }
  return out;
}

/** Junta os destinatários base com o e-mail de notificações (se válido), sem duplicados. */
export function withNotificationEmail(
  base: Array<string | null | undefined>,
  settings: CompanyNotificationSettings | null | undefined,
): string[] {
  return uniqueEmails([...base, settings?.notificationEmail ?? null]);
}

function joinParts(y: string, m: string, d: string, format: DateFormat): string {
  if (format === "MM/DD/YYYY") return `${m}/${d}/${y}`;
  if (format === "YYYY-MM-DD") return `${y}-${m}-${d}`;
  return `${d}/${m}/${y}`;
}

/**
 * Formata uma data segundo as configurações da empresa.
 * 'AAAA-MM-DD' é tratada como data de calendário (sem conversão de fuso);
 * timestamps são convertidos para o fuso horário da empresa.
 */
export function formatCompanyDate(
  value: string | Date | null | undefined,
  settings: Pick<CompanyNotificationSettings, "timezone" | "dateFormat"> = DEFAULT_NOTIFICATION_SETTINGS,
  opts: { time?: boolean } = {},
): string {
  if (!value) return "";
  if (typeof value === "string" && DATE_ONLY.test(value)) {
    const [y, m, d] = value.split("-");
    return joinParts(y, m, d, settings.dateFormat);
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const parts: Record<string, string> = {};
  for (
    const p of new Intl.DateTimeFormat("en-GB", {
      timeZone: settings.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date)
  ) parts[p.type] = p.value;
  const datePart = joinParts(parts.year, parts.month, parts.day, settings.dateFormat);
  if (!opts.time) return datePart;
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${datePart} ${hour}:${parts.minute}`;
}
