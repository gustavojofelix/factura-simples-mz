import { Injectable, signal } from "@angular/core";
import { SupabaseService } from "./supabase.service";
import { AuditLogService } from "./audit-log.service";
import { AppLanguage, currentLanguage, t } from "../i18n/i18n";

export interface Subscription {
  id: string;
  company_id: string;
  plan_id?: string;
  plan_name: string;
  status: "active" | "past_due" | "cancelled" | "trialing";
  billing_cycle: BillingCycle;
  amount: number;
  currency: string;
  payment_method?: string;
  start_date: string;
  end_date?: string;
  next_billing_date?: string;
  auto_renew: boolean;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionPlan {
  id?: string;
  code: string;
  name: string;
  description: string;
  monthly_price: number;
  three_months_price?: number;
  six_months_price?: number;
  yearly_price: number;
  currency?: string;
  features: string[];
  entitlements?: PlanEntitlement[];
  is_active?: boolean;
  is_popular?: boolean;
  sort_order?: number;
  /** Nível do plano (maior = superior). Usado para bloquear downgrade. */
  tier?: number;
  created_at?: string;
  updated_at?: string;
}

/** Textos da página de Subscrição editados no back office (vazio = texto por omissão). */
export interface SubscriptionPageText {
  title: string;
  intro: string;
  notice: string;
}

export type SubscriptionPageTexts = Partial<Record<AppLanguage, Partial<SubscriptionPageText>>>;

const SUBSCRIPTION_PAGE_TEXT_KEY = 'subscription_page_text';

/** Data de hoje (YYYY-MM-DD) no fuso de Moçambique, igual a public.subscription_today(). */
export function maputoToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Maputo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export type BillingCycle = "monthly" | "quarterly" | "semiannual" | "yearly";

/** Formas de pagamento de um plano atribuído no back office ('offer' = sem pagamento, sem factura). */
export type AdminPaymentMethod = 'transfer' | 'cash' | 'mpesa' | 'emola' | 'offer';

export interface AdminAssignPlanResult {
  ok: boolean;
  error?: string;
  paymentId?: string;
  period?: SubscriptionPeriod;
  /** Número da factura emitida no OfficeGest (null se não houve factura ou falhou). */
  invoiceNumber?: string | null;
  invoiceError?: string | null;
  emailOk?: boolean;
  emailMessage?: string;
}

/**
 * Um período pago da fila de subscrições (public.subscription_periods).
 * Cada pagamento cria um período com o seu plano; se a empresa ainda tem tempo
 * pago, o período começa no dia seguinte ao fim do último. Datas inclusivas.
 */
export interface SubscriptionPeriod {
  id: string;
  company_id: string;
  plan_id?: string | null;
  plan_name: string;
  billing_cycle: BillingCycle;
  amount: number;
  currency: string;
  payment_method?: string | null;
  start_date: string;
  end_date: string;
  payment_id?: string | null;
  source: 'payment' | 'manual' | 'voucher' | 'legacy';
  cancelled_at?: string | null;
  created_at: string;
}

/** Um período novo não pode começar mais do que isto depois de hoje (igual ao SQL). */
export const SUBSCRIPTION_QUEUE_LIMIT_DAYS = 360;

/** Soma dias a uma data YYYY-MM-DD (sem fuso horário). */
export function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date.substring(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().substring(0, 10);
}

/** Dias entre duas datas YYYY-MM-DD (b - a). */
export function daysBetweenIso(a: string, b: string): number {
  const ms = new Date(`${b.substring(0, 10)}T00:00:00Z`).getTime() - new Date(`${a.substring(0, 10)}T00:00:00Z`).getTime();
  return Math.round(ms / 86400000);
}

/** Duração do ciclo em dias, igual a public.subscription_cycle_days() no SQL. */
export function cycleDays(cycle: string): number {
  switch (cycle) {
    case 'quarterly': return 90;
    case 'semiannual': return 180;
    case 'yearly': return 360;
    default: return 30;
  }
}

/** Nível por omissão de um plano (igual ao backfill da migração 20261009120000). */
export function defaultPlanTier(code?: string | null, sortOrder?: number | null): number {
  switch ((code || '').trim().toLowerCase()) {
    case 'trial': return 0;
    case 'essencial': return 10;
    case 'profissional': return 20;
    case 'standard': return 20;
    default: return Math.max(Number(sortOrder) || 0, 0) * 10;
  }
}

export interface SubscriptionFeature {
  id: string;
  code: string;
  name: string;
  description?: string;
  value_type: 'boolean' | 'limit';
  scope: 'account' | 'company';
  unit?: string;
  is_active: boolean;
  sort_order: number;
}

export interface PlanEntitlement {
  feature_id: string;
  feature: SubscriptionFeature;
  enabled: boolean;
  limit_value: number | null;
}

/** Cada pacote conta em dias: 1 mês = 30 dias. Manter igual a subscription_cycle_days() no SQL. */
export const SUBSCRIPTION_CYCLE_DAYS: Record<Subscription['billing_cycle'], number> = {
  monthly: 30,
  quarterly: 90,
  semiannual: 180,
  yearly: 360,
};

@Injectable({
  providedIn: "root",
})
export class SubscriptionService {
  private subscriptionSignal = signal<Subscription | null>(null);
  subscription = this.subscriptionSignal.asReadonly();

  /** Períodos (não cancelados) da empresa carregada, por data de início. */
  private periodsSignal = signal<SubscriptionPeriod[]>([]);
  periods = this.periodsSignal.asReadonly();

  private plansSignal = signal<SubscriptionPlan[]>([]);
  plans = this.plansSignal.asReadonly();
  loadingPlans = signal<boolean>(false);
  private featuresSignal = signal<SubscriptionFeature[]>([]);
  features = this.featuresSignal.asReadonly();
  /**
   * Funcionalidades do plano da empresa carregada (subscription_feature_value,
   * que já conta com as excepções por empresa). Só as que escondem secções do
   * front office. null = ainda não carregadas.
   */
  private planFeaturesSignal = signal<{ companyId: string; flags: Record<string, boolean> } | null>(null);
  /** Nível/preço do plano actual vindo do servidor (cobre planos desactivados, invisíveis pela RLS). */
  private currentPlanLevelSignal = signal<{ plan_name: string; tier: number | null; monthly_price: number } | null>(null);

  private defaultPlans: SubscriptionPlan[] = [
    {
      code: "trial",
      name: "Trial",
      description: "Período de teste de 14 dias",
      monthly_price: 0,
      three_months_price: 0,
      six_months_price: 0,
      yearly_price: 0,
      currency: "MZN",
      features: [
        "Acesso completo durante 14 dias",
        "Faturação ilimitada no período",
        "Gestão de clientes e produtos",
        "Cálculo automático de ISPC",
      ],
      is_active: true,
      sort_order: 1,
      tier: 0,
    },
    {
      code: "essencial",
      name: "Essencial",
      description: "Ideal para autónomos e microempresas",
      monthly_price: 2500,
      three_months_price: 7500,
      six_months_price: 14000,
      yearly_price: 25000,
      currency: "MZN",
      features: [
        "Até 100 facturas/mês",
        "Clientes ilimitados",
        "Cálculo automático de ISPC",
        "Envio por email",
        "1 empresa",
        "Suporte por email",
      ],
      is_active: true,
      sort_order: 2,
      tier: 10,
    },
    {
      code: "profissional",
      name: "Profissional",
      description: "Para empresas em crescimento que precisam de mais recursos",
      monthly_price: 7500,
      three_months_price: 22500,
      six_months_price: 42000,
      yearly_price: 75000,
      currency: "MZN",
      features: [
        "Facturação ilimitada",
        "Utilizadores ilimitados",
        "Suporte prioritário 24/7",
        "Relatórios e modelos fiscais",
        "Backup automático",
        "Múltiplas empresas",
      ],
      is_active: true,
      is_popular: true,
      sort_order: 3,
      tier: 20,
    },
    {
      code: "standard",
      name: "Standard",
      description: "Plano completo e ilimitado para a sua empresa",
      monthly_price: 7500,
      three_months_price: 22500,
      six_months_price: 42000,
      yearly_price: 75000,
      currency: "MZN",
      features: [
        "Faturação e recibos ilimitados",
        "Utilizadores e acessos ilimitados",
        "Suporte prioritário 24/7",
        "Modelos fiscais e relatórios completos",
        "Backup automático na nuvem",
        "Conformidade legal e fiscal total (AT / MZN)",
      ],
      is_active: true,
      sort_order: 4,
      tier: 20,
    },
  ];

  get availablePlans(): SubscriptionPlan[] {
    const loaded = this.plansSignal();
    return loaded.length > 0 ? loaded : this.defaultPlans;
  }

  constructor(
    private supabase: SupabaseService,
    private auditLogService: AuditLogService,
  ) {
    this.loadPlans();
  }

  async loadPlans(): Promise<SubscriptionPlan[]> {
    this.loadingPlans.set(true);
    try {
      const { data, error } = await this.supabase.client
        .from("subscription_plans")
        .select("*, plan_features:subscription_plan_features(feature_id, enabled, limit_value, feature:subscription_features(*))")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });

      if (error) {
        console.warn("Nao foi possivel carregar planos da base de dados (erro de rede/timeout); a usar planos padrao.", error);
        this.plansSignal.set(this.defaultPlans);
        return this.defaultPlans;
      }

      if (data && data.length > 0) {
        const parsedPlans: SubscriptionPlan[] = data.map((p: any) => ({
          ...p,
          features: Array.isArray(p.features)
            ? p.features
            : typeof p.features === "string"
              ? JSON.parse(p.features)
              : [],
          monthly_price: Number(p.monthly_price || 0),
          three_months_price: p.three_months_price !== undefined && p.three_months_price !== null ? Number(p.three_months_price) : Number(p.monthly_price || 0) * 3,
          six_months_price: p.six_months_price !== undefined && p.six_months_price !== null ? Number(p.six_months_price) : Number(p.monthly_price || 0) * 6,
          yearly_price: Number(p.yearly_price || 0),
          tier: p.tier !== undefined && p.tier !== null ? Number(p.tier) : defaultPlanTier(p.code, p.sort_order),
          entitlements: (p.plan_features || []).map((pf: any) => ({
            feature_id: pf.feature_id,
            feature: pf.feature,
            enabled: pf.enabled,
            limit_value: pf.limit_value == null ? null : Number(pf.limit_value)
          })),
        }));
        this.plansSignal.set(parsedPlans);
        return parsedPlans;
      } else {
        this.plansSignal.set(this.defaultPlans);
        return this.defaultPlans;
      }
    } catch (err) {
      console.warn("Excepcao ao carregar planos de subscricao; a usar planos padrao.", err);
      this.plansSignal.set(this.defaultPlans);
      return this.defaultPlans;
    } finally {
      this.loadingPlans.set(false);
    }
  }

  /** Textos personalizados da página de Subscrição, em todas as línguas (back office). */
  async loadSubscriptionPageTexts(): Promise<SubscriptionPageTexts> {
    const { data, error } = await this.supabase.client
      .from('platform_settings')
      .select('value')
      .eq('key', SUBSCRIPTION_PAGE_TEXT_KEY)
      .maybeSingle();
    if (error || !data?.value || typeof data.value !== 'object') return {};
    return data.value as SubscriptionPageTexts;
  }

  /**
   * Texto a mostrar na língua actual: o da língua, senão o português (o back
   * office escreve primeiro em português), senão vazio (texto por omissão).
   */
  async subscriptionPageText(): Promise<SubscriptionPageText> {
    const all = await this.loadSubscriptionPageTexts();
    const lang = all[currentLanguage()] ?? {};
    const pt = all['pt-MZ'] ?? {};
    const pickText = (key: keyof SubscriptionPageText) => (lang[key] || pt[key] || '').trim();
    return { title: pickText('title'), intro: pickText('intro'), notice: pickText('notice') };
  }

  async saveSubscriptionPageTexts(texts: SubscriptionPageTexts): Promise<boolean> {
    const { error } = await this.supabase.client
      .from('platform_settings')
      .upsert({
        key: SUBSCRIPTION_PAGE_TEXT_KEY,
        value: texts,
        description: 'Textos personalizados da página de Subscrição do front office (título, introdução e aviso), por língua.',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
    if (error) {
      console.error('Erro ao guardar o texto da página de subscrição:', error);
      return false;
    }
    await this.auditLogService.log('Actualizou Texto da Página de Subscrição', 'platform_settings', texts);
    return true;
  }

  async loadFeatures(): Promise<SubscriptionFeature[]> {
    const { data, error } = await this.supabase.client
      .from('subscription_features')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (error) {
      console.error('Erro ao carregar catálogo de funcionalidades:', error);
      return [];
    }
    this.featuresSignal.set((data || []) as SubscriptionFeature[]);
    return (data || []) as SubscriptionFeature[];
  }

  async savePlanEntitlements(planId: string, entitlements: PlanEntitlement[]): Promise<boolean> {
    const rows = entitlements.map(e => ({
      plan_id: planId,
      feature_id: e.feature_id,
      enabled: !!e.enabled,
      limit_value: e.limit_value == null || e.limit_value === ('' as any) ? null : Number(e.limit_value)
    }));
    const { error: deleteError } = await this.supabase.client
      .from('subscription_plan_features').delete().eq('plan_id', planId);
    if (deleteError) return false;
    if (!rows.length) return true;
    const { error } = await this.supabase.client.from('subscription_plan_features').insert(rows);
    return !error;
  }

  async createPlan(plan: Partial<SubscriptionPlan>): Promise<boolean> {
    const code =
      plan.code ||
      plan.name?.toLowerCase().replace(/\s+/g, "_") ||
      `plan_${Date.now()}`;
    const payload = {
      code,
      name: plan.name,
      description: plan.description || "",
      monthly_price: plan.monthly_price || 0,
      three_months_price: plan.three_months_price || (plan.monthly_price ? plan.monthly_price * 3 : 0),
      six_months_price: plan.six_months_price || (plan.monthly_price ? plan.monthly_price * 6 : 0),
      yearly_price: plan.yearly_price || 0,
      currency: plan.currency || "MZN",
      features: plan.features || [],
      is_active: plan.is_active ?? true,
      is_popular: plan.is_popular ?? false,
      sort_order: plan.sort_order ?? 0,
      tier: plan.tier ?? defaultPlanTier(code, plan.sort_order),
    };

    const { data, error } = await this.supabase.client
      .from("subscription_plans")
      .insert(payload)
      .select('id')
      .single();


    if (error) {
      console.error("Error creating subscription plan:", error);
      return false;
    }

    if (data?.id && plan.entitlements && !(await this.savePlanEntitlements(data.id, plan.entitlements))) return false;

    await this.auditLogService.log(
      "Criou Plano de Subscrição",
      "subscription_plans",
      payload,
    );
    await this.loadPlans();
    return true;
  }

  async updatePlan(
    id: string,
    updates: Partial<SubscriptionPlan>,
  ): Promise<boolean> {
    const { entitlements, ...planUpdates } = updates;
    
    // Only keep keys that exist as columns on subscription_plans table
    const allowedKeys: (keyof SubscriptionPlan)[] = [
      'code',
      'name',
      'description',
      'monthly_price',
      'three_months_price',
      'six_months_price',
      'yearly_price',
      'currency',
      'features',
      'is_active',
      'is_popular',
      'sort_order',
      'tier'
    ];

    const payloadToUpdate: any = {};
    const planUpdatesAny = planUpdates as any;
    for (const key of allowedKeys) {
      if (planUpdatesAny[key] !== undefined) {
        payloadToUpdate[key] = planUpdatesAny[key];
      }
    }
    payloadToUpdate.updated_at = new Date().toISOString();

    const { error } = await this.supabase.client
      .from("subscription_plans")
      .update(payloadToUpdate)
      .eq("id", id);

    if (error) {
      console.error("Error updating subscription plan:", error);
      return false;
    }

    if (entitlements && !(await this.savePlanEntitlements(id, entitlements))) return false;

    await this.auditLogService.log(
      "Atualizou Plano de Subscrição",
      "subscription_plans",
      { id, updates },
    );
    await this.loadPlans();
    return true;
  }

  async deletePlan(id: string): Promise<boolean> {
    const { error } = await this.supabase.client
      .from("subscription_plans")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("Error deleting subscription plan:", error);
      return false;
    }

    await this.auditLogService.log(
      "Eliminou Plano de Subscrição",
      "subscription_plans",
      { id },
    );
    await this.loadPlans();
    return true;
  }

  /** Pedido em curso: o guard, o layout e o painel pedem a subscrição em simultâneo no arranque. */
  private loadingSubscription: { companyId: string; promise: Promise<void> } | null = null;

  loadSubscription(companyId: string): Promise<void> {
    if (this.loadingSubscription?.companyId === companyId) return this.loadingSubscription.promise;
    const promise = this.fetchSubscription(companyId).finally(() => {
      if (this.loadingSubscription?.promise === promise) this.loadingSubscription = null;
    });
    this.loadingSubscription = { companyId, promise };
    return promise;
  }

  private async fetchSubscription(companyId: string): Promise<void> {
    // Põe a linha de subscriptions em dia com o período em vigor (ex.: hoje
    // começou o período seguinte da fila). Falha em silêncio: o servidor já
    // usa o período em vigor nas suas verificações.
    try {
      await this.supabase.client.rpc('refresh_company_subscription', { p_company_id: companyId });
    } catch {
      /* migração por aplicar ou erro transitório */
    }

    // O nível do plano e os períodos não dependem da subscrição: os pedidos correm em paralelo.
    const [{ data, error }] = await Promise.all([
      this.supabase.client
        .from("subscriptions")
        .select("*")
        .eq("company_id", companyId)
        .order("updated_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      this.loadCurrentPlanLevel(companyId),
      this.loadPeriods(companyId),
      this.loadPlanFeatures(companyId),
    ]);

    if (error) {
      console.error("Error loading subscription:", error);
      return;
    }

    this.subscriptionSignal.set(data);
  }

  private async loadPeriods(companyId: string): Promise<void> {
    const { data, error } = await this.supabase.client
      .from('subscription_periods')
      .select('*')
      .eq('company_id', companyId)
      .is('cancelled_at', null)
      .order('start_date', { ascending: true });
    if (error) {
      // Migração por aplicar: sem fila, a interface usa só a linha de subscriptions.
      this.periodsSignal.set([]);
      return;
    }
    this.periodsSignal.set((data || []) as SubscriptionPeriod[]);
  }

  /** Funcionalidades que mostram/escondem secções do front office. */
  static readonly GATED_FEATURES = ['reports'] as const;

  private async loadPlanFeatures(companyId: string): Promise<void> {
    const flags: Record<string, boolean> = {};
    await Promise.all(SubscriptionService.GATED_FEATURES.map(async (code) => {
      try {
        const { data, error } = await this.supabase.client.rpc('subscription_feature_value', {
          p_company_id: companyId,
          p_feature_code: code,
        });
        if (error) return; // erro de rede/servidor: não esconde nada
        const row = Array.isArray(data) ? data[0] : data;
        // Sem linha = a funcionalidade não está no plano nem numa excepção.
        flags[code] = !!row?.enabled;
      } catch {
        /* não esconde nada */
      }
    }));
    this.planFeaturesSignal.set({ companyId, flags });
  }

  /**
   * O plano da empresa inclui a funcionalidade? Enquanto não se sabe (ou se a
   * verificação falhar) devolve true: o servidor valida de novo onde importa.
   */
  hasPlanFeature(code: string, companyId?: string): boolean {
    const state = this.planFeaturesSignal();
    if (!state || (companyId && state.companyId !== companyId)) return true;
    return state.flags[code] ?? true;
  }

  /** As funcionalidades do plano já foram carregadas para esta empresa. */
  planFeaturesLoadedFor(companyId: string): boolean {
    return this.planFeaturesSignal()?.companyId === companyId;
  }

  /** Carrega o nível e preço do plano actual (mesmo que o plano esteja desactivado). */
  private async loadCurrentPlanLevel(companyId: string): Promise<void> {
    try {
      const { data, error } = await this.supabase.client.rpc('get_company_plan_level', {
        p_company_id: companyId,
      });
      const row = Array.isArray(data) ? data[0] : data;
      if (error || !row) {
        this.currentPlanLevelSignal.set(null);
        return;
      }
      this.currentPlanLevelSignal.set({
        plan_name: row.plan_name,
        tier: row.tier === null || row.tier === undefined ? null : Number(row.tier),
        monthly_price: Number(row.monthly_price || 0),
      });
    } catch {
      this.currentPlanLevelSignal.set(null);
    }
  }

  async updateSubscription(
    subscriptionId: string,
    updates: Partial<Subscription>,
  ): Promise<boolean> {
    const currentSub = this.subscriptionSignal();
    const { error } = await this.supabase.client
      .from("subscriptions")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", subscriptionId);

    if (error) {
      console.error("Error updating subscription:", error);
      return false;
    }

    if (currentSub && currentSub.id === subscriptionId) {
      this.subscriptionSignal.set({ ...currentSub, ...updates });
    }

    await this.auditLogService.log(
      "Alterou Subscrição",
      "subscriptions",
      {
        updates,
        old: currentSub
          ? {
              plan_name: currentSub.plan_name,
              status: currentSub.status,
              amount: currentSub.amount,
            }
          : null,
      },
      subscriptionId,
      updates.plan_name || currentSub?.plan_name,
      currentSub?.company_id,
    );

    return true;
  }

  /**
   * Cria um período na fila de subscrições (enqueue_subscription_period).
   * - 'voucher': activação a 0 MZN feita pelo próprio cliente;
   * - 'manual': pagamento confirmado pelo admin (passar paymentId).
   * Os pagamentos M-Pesa/e-Mola criam o período no sislog-webhook.
   */
  async enqueuePeriod(
    companyId: string,
    input: {
      planName: string;
      billingCycle: BillingCycle;
      amount: number;
      currency?: string;
      paymentMethod?: string | null;
      paymentId?: string | null;
      source: 'voucher' | 'manual';
    },
  ): Promise<{ ok: boolean; period?: SubscriptionPeriod; error?: string; code?: string }> {
    const { data, error } = await this.supabase.client.rpc('enqueue_subscription_period', {
      p_company_id: companyId,
      p_plan_name: input.planName,
      p_billing_cycle: input.billingCycle,
      p_amount: input.amount,
      p_currency: input.currency || 'MZN',
      p_payment_method: input.paymentMethod ?? null,
      p_payment_id: input.paymentId ?? null,
      p_source: input.source,
    });

    if (error) {
      console.error('Error enqueuing subscription period:', error);
      return { ok: false, error: error.message, code: (error as { details?: string }).details || undefined };
    }

    const period = (Array.isArray(data) ? data[0] : data) as SubscriptionPeriod | undefined;
    await this.loadSubscription(companyId);

    await this.auditLogService.log(
      'Ativou/Atualizou Subscrição da Empresa',
      'subscription_periods',
      { ...input, start_date: period?.start_date, end_date: period?.end_date },
      period?.id,
      input.planName,
      companyId,
    );

    return { ok: true, period };
  }

  /**
   * Back office: atribui um plano a uma empresa. Usa o mesmo caminho de um
   * pagamento confirmado manualmente:
   *   1. regista o pagamento em subscription_payments;
   *   2. cria o período (entra na fila se a empresa ainda tem tempo pago);
   *   3. marca o pagamento como concluído;
   *   4. emite a factura no OfficeGest (excepto ofertas a 0 MZN);
   *   5. envia ao cliente o e-mail "plano activo", com a factura em anexo.
   */
  async adminAssignPlan(input: {
    companyId: string;
    companyName?: string;
    planName: string;
    billingCycle: BillingCycle;
    amount: number;
    paymentMethod: AdminPaymentMethod;
    reference?: string;
  }): Promise<AdminAssignPlanResult> {
    const offer = input.paymentMethod === 'offer';
    const amount = offer ? 0 : Math.max(0, Number(input.amount) || 0);
    if (!offer && amount <= 0) {
      return { ok: false, error: 'Indique o valor pago, ou escolha "Oferta" se o plano não for pago.' };
    }

    const { data: sub } = await this.supabase.client
      .from('subscriptions')
      .select('id')
      .eq('company_id', input.companyId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const stamp = new Date().toISOString().replace(/\D/g, '').substring(0, 14);
    const referenceCode = `BO-${stamp}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    const { data: payment, error: insertError } = await this.supabase.client
      .from('subscription_payments')
      .insert({
        company_id: input.companyId,
        subscription_id: sub?.id ?? null,
        plan_name: input.planName,
        billing_cycle: input.billingCycle,
        amount,
        currency: 'MZN',
        payment_method: input.paymentMethod,
        phone_number: null,
        reference_code: referenceCode,
        status: 'pending',
        sislog_response: {
          origin: 'backoffice',
          ...(input.reference?.trim() ? { reference: input.reference.trim() } : {}),
        },
      })
      .select('id')
      .single();
    if (insertError || !payment) {
      return { ok: false, error: insertError?.message || 'Não foi possível registar a atribuição.' };
    }

    const enqueued = await this.enqueuePeriod(input.companyId, {
      planName: input.planName,
      billingCycle: input.billingCycle,
      amount,
      paymentMethod: input.paymentMethod,
      paymentId: payment.id,
      source: 'manual',
    });
    if (!enqueued.ok) {
      await this.supabase.client.from('subscription_payments')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', payment.id);
      return { ok: false, paymentId: payment.id, error: `Não foi possível activar o plano: ${enqueued.error || 'erro desconhecido'}.` };
    }

    const { data: completed, error: completeError } = await this.supabase.client
      .from('subscription_payments')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', payment.id)
      .select('id');
    if (completeError || !completed?.length) {
      // Sem linhas actualizadas = o RLS bloqueou (migração 20261116100000 por aplicar).
      const reason = completeError?.message || 'sem permissão para actualizar o pagamento';
      return { ok: false, paymentId: payment.id, period: enqueued.period, error: `Plano activado, mas o pagamento não ficou concluído (${reason}). A factura e o e-mail não foram enviados.` };
    }

    // Factura no OfficeGest antes do e-mail, para seguir em anexo.
    let invoiceNumber: string | null = null;
    let invoiceError: string | null = null;
    if (!offer) {
      try {
        const { data, error } = await this.supabase.client.functions.invoke('sync-officegest', {
          body: { payment_ids: [payment.id] },
        });
        invoiceNumber = data?.documents?.[0]?.document_number ?? null;
        if (error || !invoiceNumber) {
          invoiceError = data?.errors?.[0] || error?.message || 'Factura não emitida.';
        }
      } catch (e: any) {
        invoiceError = e?.message || 'Erro ao contactar o OfficeGest.';
      }
    }

    let emailOk = false;
    let emailMessage = '';
    try {
      const { data, error } = await this.supabase.client.functions.invoke('subscription-notify', {
        body: { paymentId: payment.id, force: false, source: 'manual' },
      });
      const client = data?.client;
      emailOk = !error && !!client?.ok;
      emailMessage = emailOk
        ? `E-mail enviado ao cliente${client?.recipients?.length ? ` (${client.recipients.join(', ')})` : ''}.`
        : `O e-mail ao cliente não foi enviado: ${client?.error || data?.error || error?.message || 'erro desconhecido'}.`;
    } catch (e: any) {
      emailMessage = `O e-mail ao cliente não foi enviado: ${e?.message || 'erro desconhecido'}.`;
    }

    await this.auditLogService.log(
      'Atribuiu Plano no Back Office',
      'subscription_payments',
      {
        company: input.companyName,
        plan: input.planName,
        billing_cycle: input.billingCycle,
        amount,
        payment_method: input.paymentMethod,
        reference: input.reference || null,
        start_date: enqueued.period?.start_date,
        end_date: enqueued.period?.end_date,
        invoice: invoiceNumber,
      },
      payment.id,
      input.planName,
      input.companyId,
    );

    return { ok: true, paymentId: payment.id, period: enqueued.period, invoiceNumber, invoiceError, emailOk, emailMessage };
  }

  async updatePaymentMethod(
    subscriptionId: string,
    paymentMethod: string,
  ): Promise<boolean> {
    return await this.updateSubscription(subscriptionId, {
      payment_method: paymentMethod,
    });
  }

  async cancelSubscription(subscriptionId: string): Promise<boolean> {
    return await this.updateSubscription(subscriptionId, {
      status: "cancelled",
      auto_renew: false,
    });
  }

  async reactivateSubscription(subscriptionId: string): Promise<boolean> {
    return await this.updateSubscription(subscriptionId, {
      status: "active",
      auto_renew: true,
    });
  }

  /** Procura um plano pelo nome ou código (sem distinguir maiúsculas). */
  findPlan(nameOrCode?: string | null): SubscriptionPlan | undefined {
    const key = (nameOrCode || '').trim().toLowerCase();
    if (!key) return undefined;
    return this.availablePlans.find(
      (p) => p.name.trim().toLowerCase() === key || (!!p.code && p.code.trim().toLowerCase() === key),
    );
  }

  planTier(plan?: SubscriptionPlan | null): number | null {
    if (!plan) return null;
    return plan.tier ?? defaultPlanTier(plan.code, plan.sort_order);
  }

  /**
   * Subscrição actual activa e dentro do período.
   * Compara datas no fuso de Moçambique, como public.subscription_today() no SQL,
   * para que a interface e o servidor concordem sobre o dia da expiração.
   */
  hasActivePeriod(): boolean {
    const sub = this.subscriptionSignal();
    if (!sub) return false;
    if (sub.status !== "active" && sub.status !== "trialing") return false;
    if (!sub.end_date) return !this.isExpired();
    return sub.end_date.substring(0, 10) >= maputoToday();
  }

  /** Nível e preço do plano actual: do catálogo carregado ou, se o plano estiver desactivado, do servidor. */
  currentPlanLevel(): { tier: number | null; monthly_price: number } | null {
    const sub = this.subscriptionSignal();
    if (!sub) return null;
    const current = this.findPlan(sub.plan_name);
    if (current) return { tier: this.planTier(current), monthly_price: current.monthly_price };
    const level = this.currentPlanLevelSignal();
    if (level && level.plan_name?.trim().toLowerCase() === (sub.plan_name || '').trim().toLowerCase()) {
      return { tier: level.tier, monthly_price: level.monthly_price };
    }
    return null;
  }

  /**
   * Planos gratuitos (Trial) não se compram: o Trial é atribuído ao criar a
   * empresa e não se volta a ele. Qualquer plano pago pode ser comprado; se
   * ainda houver tempo pago, entra na fila. Igual a subscription_purchase_block_reason().
   */
  isPlanUnavailable(target: SubscriptionPlan): boolean {
    return (target.monthly_price || 0) === 0;
  }

  /** Período em vigor hoje (fila), se houver. */
  currentPeriod(): SubscriptionPeriod | null {
    const today = maputoToday();
    return this.periodsSignal().find((p) => p.start_date <= today && p.end_date >= today) ?? null;
  }

  /** Períodos já pagos que ainda não começaram. */
  upcomingPeriods(): SubscriptionPeriod[] {
    const today = maputoToday();
    return this.periodsSignal().filter((p) => p.start_date > today);
  }

  /**
   * Onde começaria um período comprado agora: hoje, ou no dia seguinte ao fim
   * do último período pago. O Trial não segura a fila.
   */
  nextPeriodStart(): string {
    const today = maputoToday();
    let lastEnd: string | null = null;
    for (const p of this.periodsSignal()) {
      if (!lastEnd || p.end_date > lastEnd) lastEnd = p.end_date;
    }
    if (!lastEnd) {
      // Ainda sem fila: uma subscrição paga activa (anterior à fila) conta.
      const sub = this.subscriptionSignal();
      const level = this.currentPlanLevel();
      if (sub?.end_date && this.hasActivePeriod() && (level?.monthly_price ?? 0) > 0) {
        lastEnd = sub.end_date.substring(0, 10);
      }
    }
    if (!lastEnd) return today;
    const next = addDaysIso(lastEnd, 1);
    return next > today ? next : today;
  }

  /** Fim (inclusivo) de um período de `cycle` comprado agora. */
  nextPeriodEnd(cycle: BillingCycle): string {
    return addDaysIso(this.nextPeriodStart(), cycleDays(cycle) - 1);
  }

  /** A fila já tem mais de 360 dias pagos à frente: não é possível comprar mais por agora. */
  queueLimitReached(): boolean {
    return daysBetweenIso(maputoToday(), this.nextPeriodStart()) > SUBSCRIPTION_QUEUE_LIMIT_DAYS;
  }

  isSubscriptionActive(): boolean {
    const sub = this.subscriptionSignal();
    return sub?.status === "active" || sub?.status === "trialing";
  }

  isPastDue(): boolean {
    const sub = this.subscriptionSignal();
    return sub?.status === "past_due";
  }

  getDaysUntilNextBilling(): number {
    const sub = this.subscriptionSignal();
    if (!sub?.next_billing_date) return 0;

    const nextBilling = new Date(sub.next_billing_date);
    const today = new Date();
    const diff = nextBilling.getTime() - today.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  isTrialing(): boolean {
    const sub = this.subscriptionSignal();
    return sub?.status === "trialing";
  }

  /** Fim do período (inclusive): a subscrição vale até ao fim do dia de end_date, como no servidor. */
  private periodEnd(sub: Subscription): Date {
    if (sub.end_date) {
      const [y, m, d] = sub.end_date.substring(0, 10).split("-").map(Number);
      return new Date(y, m - 1, d, 23, 59, 59, 999);
    }
    const start = sub.start_date ? new Date(sub.start_date) : new Date(sub.created_at || Date.now());
    return new Date(start.getTime() + 14 * 24 * 60 * 60 * 1000);
  }

  isTrialExpired(): boolean {
    const sub = this.subscriptionSignal();
    if (!sub || sub.status !== "trialing") return false;
    return new Date() > this.periodEnd(sub);
  }

  /** Subscrição (trial ou paga) expirada/cancelada: o sistema fica bloqueado excepto a subscrição. */
  isExpired(): boolean {
    const sub = this.subscriptionSignal();
    if (!sub) return false;
    if (sub.status !== "active" && sub.status !== "trialing") return true;
    return new Date() > this.periodEnd(sub);
  }

  getDaysRemaining(): number {
    const sub = this.subscriptionSignal();
    if (!sub) return 0;
    const diff = this.periodEnd(sub).getTime() - Date.now();
    return diff > 0 ? Math.ceil(diff / (1000 * 60 * 60 * 24)) : 0;
  }

  getDaysRemainingInTrial(): number {
    const sub = this.subscriptionSignal();
    if (!sub || sub.status !== "trialing") return 0;
    return this.getDaysRemaining();
  }

  canAccessFeatures(): boolean {
    return !!this.subscriptionSignal() && !this.isExpired();
  }

  /** Estado do pagamento de subscrição pendente (actualizado pelo sislog-webhook). */
  async getSubscriptionPaymentStatus(referenceCode: string): Promise<string | null> {
    const { data, error } = await this.supabase.client
      .from("subscription_payments")
      .select("status")
      .eq("reference_code", referenceCode)
      .maybeSingle();
    if (error) {
      console.error("Error loading subscription payment status:", error);
      return null;
    }
    return data?.status ?? null;
  }

  async processMobilePayment(
    companyId: string,
    subscriptionId: string | undefined,
    planName: string,
    billingCycle: "monthly" | "quarterly" | "semiannual" | "yearly",
    amount: number,
    paymentMethod: "mpesa" | "emola",
    phoneNumber: string,
    userEmail = '',
  ): Promise<{
    success: boolean;
    message?: string;
    error?: string;
    code?: string;
    referenceCode?: string;
  }> {
    try {
      // Invoke the Edge Function which:
      //   1. Sends a USSD PUSH to the user's phone via Sislog
      //   2. Saves a 'pending' payment record in subscription_payments
      //
      // The plan is NOT activated here. Activation happens in the
      // sislog-webhook edge function once Sislog confirms the PIN was entered.
      const { data, error } = await this.supabase.client.functions.invoke(
        "process-subscription-payment",
        {
          body: {
            companyId,
            subscriptionId,
            planName,
            billingCycle,
            amount,
            paymentMethod,
            phoneNumber,
            userEmail,
          },
        },
      );

      if (!error && data && data.success) {
        return {
          success: true,
          message: data.message || t("messages.subscription.paymentRequestSent", { phone: phoneNumber }),
          referenceCode: data.referenceCode,
        };
      }

      // Edge Function failed or returned success:false
      return {
        success: false,
        error: data?.error || error?.message || t("messages.subscription.paymentRequestError"),
        code: data?.code,
      };
    } catch (err: any) {
      console.error("Exception processing mobile payment:", err);
      return {
        success: false,
        error: err.message || t("messages.subscription.paymentUnexpectedError"),
      };
    }
  }
}
