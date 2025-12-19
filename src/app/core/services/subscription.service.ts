import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';

export interface Subscription {
  id: string;
  company_id: string;
  plan_name: string;
  status: 'active' | 'past_due' | 'cancelled' | 'trialing';
  billing_cycle: 'monthly' | 'yearly';
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
  providedIn: 'root'
})
export class SubscriptionService {
  private subscriptionSignal = signal<Subscription | null>(null);
  subscription = this.subscriptionSignal.asReadonly();

  availablePlans: SubscriptionPlan[] = [
    {
      name: 'Trial',
      description: 'Período de teste de 30 dias',
      monthly_price: 0,
      yearly_price: 0,
      features: [
        'Até 50 faturas por mês',
        'Até 2 usuários',
        'Suporte básico',
        'Relatórios básicos'
      ]
    },
    {
      name: 'Basic',
      description: 'Plano básico para pequenas empresas',
      monthly_price: 1500,
      yearly_price: 15000,
      features: [
        'Até 200 faturas por mês',
        'Até 5 usuários',
        'Suporte por email',
        'Relatórios avançados',
        'Backup automático'
      ]
    },
    {
      name: 'Pro',
      description: 'Plano profissional para empresas em crescimento',
      monthly_price: 3500,
      yearly_price: 35000,
      features: [
        'Faturas ilimitadas',
        'Usuários ilimitados',
        'Suporte prioritário',
        'Relatórios personalizados',
        'API de integração',
        'Múltiplas empresas'
      ]
    },
    {
      name: 'Enterprise',
      description: 'Solução completa para grandes empresas',
      monthly_price: 7500,
      yearly_price: 75000,
      features: [
        'Tudo do plano Pro',
        'Suporte dedicado 24/7',
        'Treinamento personalizado',
        'Customizações sob medida',
        'SLA garantido',
        'Gerente de conta dedicado'
      ]
    }
  ];

  constructor(private supabase: SupabaseService) {}

  async loadSubscription(companyId: string): Promise<void> {
    const { data, error } = await this.supabase.client
      .from('subscriptions')
      .select('*')
      .eq('company_id', companyId)
      .maybeSingle();

    if (error) {
      console.error('Error loading subscription:', error);
      return;
    }

    this.subscriptionSignal.set(data);
  }

  async updateSubscription(subscriptionId: string, updates: Partial<Subscription>): Promise<boolean> {
    const { error } = await this.supabase.client
      .from('subscriptions')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', subscriptionId);

    if (error) {
      console.error('Error updating subscription:', error);
      return false;
    }

    const currentSub = this.subscriptionSignal();
    if (currentSub && currentSub.id === subscriptionId) {
      this.subscriptionSignal.set({ ...currentSub, ...updates });
    }

    return true;
  }

  async changePlan(subscriptionId: string, planName: string, billingCycle: 'monthly' | 'yearly'): Promise<boolean> {
    const plan = this.availablePlans.find(p => p.name === planName);
    if (!plan) return false;

    const amount = billingCycle === 'monthly' ? plan.monthly_price : plan.yearly_price;
    const nextBillingDate = new Date();
    nextBillingDate.setMonth(nextBillingDate.getMonth() + (billingCycle === 'monthly' ? 1 : 12));

    return await this.updateSubscription(subscriptionId, {
      plan_name: planName,
      billing_cycle: billingCycle,
      amount,
      status: 'active',
      next_billing_date: nextBillingDate.toISOString()
    });
  }

  async updatePaymentMethod(subscriptionId: string, paymentMethod: string): Promise<boolean> {
    return await this.updateSubscription(subscriptionId, { payment_method: paymentMethod });
  }

  async cancelSubscription(subscriptionId: string): Promise<boolean> {
    return await this.updateSubscription(subscriptionId, {
      status: 'cancelled',
      auto_renew: false
    });
  }

  async reactivateSubscription(subscriptionId: string): Promise<boolean> {
    return await this.updateSubscription(subscriptionId, {
      status: 'active',
      auto_renew: true
    });
  }

  isSubscriptionActive(): boolean {
    const sub = this.subscriptionSignal();
    return sub?.status === 'active' || sub?.status === 'trialing';
  }

  isPastDue(): boolean {
    const sub = this.subscriptionSignal();
    return sub?.status === 'past_due';
  }

  getDaysUntilNextBilling(): number {
    const sub = this.subscriptionSignal();
    if (!sub?.next_billing_date) return 0;

    const nextBilling = new Date(sub.next_billing_date);
    const today = new Date();
    const diff = nextBilling.getTime() - today.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }
}
