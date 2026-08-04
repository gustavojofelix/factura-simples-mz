import { Injectable, signal } from "@angular/core";
import { SupabaseService } from "./supabase.service";
import { AuditLogService } from "./audit-log.service";

export interface Subscription {
  id: string;
  company_id: string;
  plan_name: string;
  status: "active" | "past_due" | "cancelled" | "trialing";
  billing_cycle: "monthly" | "yearly";
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
  name: string;
  description: string;
  monthly_price: number;
  yearly_price: number;
  features: string[];
}

@Injectable({
  providedIn: "root",
})
export class SubscriptionService {
  private subscriptionSignal = signal<Subscription | null>(null);
  subscription = this.subscriptionSignal.asReadonly();

  availablePlans: SubscriptionPlan[] = [
    {
      name: "Trial",
      description: "Período de teste de 14 dias",
      monthly_price: 0,
      yearly_price: 0,
      features: [
        "Acesso completo durante 14 dias",
        "Faturação ilimitada no período",
        "Gestão de clientes e produtos",
        "Cálculo automático de ISPC",
      ],
    },
    {
      name: "Standard",
      description: "Plano completo e ilimitado para a sua empresa",
      monthly_price: 25,
      yearly_price: 8400000,
      features: [
        "Faturação e recibos ilimitados",
        "Utilizadores e acessos ilimitados",
        "Suporte prioritário 24/7",
        "Modelos fiscais e relatórios completos",
        "Backup automático na nuvem",
        "Conformidade legal e fiscal total (AT / MZN)",
      ],
    },
  ];

  constructor(
    private supabase: SupabaseService,
    private auditLogService: AuditLogService,
  ) {}

  async loadSubscription(companyId: string): Promise<void> {
    const { data, error } = await this.supabase.client
      .from("subscriptions")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("Error loading subscription:", error);
      return;
    }

    this.subscriptionSignal.set(data);
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

  async changePlan(
    subscriptionId: string,
    planName: string,
    billingCycle: "monthly" | "yearly",
  ): Promise<boolean> {
    const plan = this.availablePlans.find((p) => p.name === planName);
    if (!plan) return false;

    const amount =
      billingCycle === "monthly" ? plan.monthly_price : plan.yearly_price;
    const nextBillingDate = new Date();
    nextBillingDate.setMonth(
      nextBillingDate.getMonth() + (billingCycle === "monthly" ? 1 : 12),
    );

    return await this.updateSubscription(subscriptionId, {
      plan_name: planName,
      billing_cycle: billingCycle,
      amount,
      status: "active",
      next_billing_date: nextBillingDate.toISOString(),
    });
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

  isTrialExpired(): boolean {
    const sub = this.subscriptionSignal();
    if (!sub || sub.status !== "trialing" || !sub.end_date) return false;

    const endDate = new Date(sub.end_date);
    const today = new Date();
    return today > endDate;
  }

  getDaysRemainingInTrial(): number {
    const sub = this.subscriptionSignal();
    if (!sub || sub.status !== "trialing" || !sub.end_date) return 0;

    const endDate = new Date(sub.end_date);
    const today = new Date();
    const diff = endDate.getTime() - today.getTime();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    return days > 0 ? days : 0;
  }

  canAccessFeatures(): boolean {
    const sub = this.subscriptionSignal();
    if (!sub) return false;

    if (sub.status === "trialing") {
      return !this.isTrialExpired();
    }

    return sub.status === "active";
  }

  async processMobilePayment(
    companyId: string,
    subscriptionId: string | undefined,
    planName: string,
    billingCycle: "monthly" | "yearly",
    amount: number,
    paymentMethod: "mpesa" | "emola",
    phoneNumber: string,
  ): Promise<{
    success: boolean;
    message?: string;
    error?: string;
    referenceCode?: string;
  }> {
    try {
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
          },
        },
      );

      if (error) {
        console.error("Error invoking process-subscription-payment:", error);
        return {
          success: false,
          error:
            error.message || "Erro ao comunicar com o servidor de pagamentos",
        };
      }

      if (data && data.success) {
        await this.loadSubscription(companyId);
        await this.auditLogService.log(
          `Pagamento Subscrição (${paymentMethod.toUpperCase()})`,
          "subscriptions",
          {
            planName,
            billingCycle,
            amount,
            paymentMethod,
            phoneNumber,
            referenceCode: data.referenceCode,
          },
          subscriptionId,
          planName,
          companyId,
        );
        return {
          success: true,
          message: data.message,
          referenceCode: data.referenceCode,
        };
      }

      return {
        success: false,
        error: data?.error || "Erro ao processar pagamento de subscrição",
      };
    } catch (err: any) {
      console.error("Exception processing mobile payment:", err);
      return {
        success: false,
        error: err.message || "Erro inesperado durante o pagamento",
      };
    }
  }
}
