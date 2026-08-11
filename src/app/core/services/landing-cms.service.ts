import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuditLogService } from './audit-log.service';

export interface HeroContent {
  badge: string;
  badgeIcon: string;
  title: string;
  highlightWord: string;
  subtitle: string;
  primaryCtaText: string;
  primaryCtaLink: string;
  secondaryCtaText: string;
  secondaryCtaLink: string;
  guaranteeText: string;
  proofText: string;
}

export interface StatContent {
  value: string;
  label: string;
}

export interface FeatureContent {
  faIcon: string;
  title: string;
  description: string;
  color: string;
  bgColor: string;
}

export interface ValueContent {
  icon: string;
  title: string;
  desc: string;
  color: string;
  bg: string;
}

export interface FaqContent {
  question: string;
  answer: string;
}

export interface ContactContent {
  email: string;
  phone: string;
  whatsapp: string;
  address: string;
  workHours: string;
}

@Injectable({
  providedIn: 'root'
})
export class LandingCmsService {
  hero = signal<HeroContent>({
    badge: 'Plataforma de Facturação em Moçambique',
    badgeIcon: 'fa-tag',
    title: 'Facturação simples, rápida e em conformidade com o ISPC',
    highlightWord: 'ISPC',
    subtitle: 'Emita facturas profissionais em menos de 60 segundos. Ideal para pequenas e médias empresas, freelancers e prestadores de serviços.',
    primaryCtaText: 'Experimentar 14 Dias Grátis',
    primaryCtaLink: '/registar',
    secondaryCtaText: 'Ver Funcionalidades',
    secondaryCtaLink: '#funcionalidades',
    guaranteeText: '14 dias de teste sem compromisso • Sem cartão de crédito',
    proofText: 'Centenas de negócios moçambicanos confiam em nós'
  });

  stats = signal<StatContent[]>([
    { value: '500+', label: 'Empresas activas' },
    { value: '50K+', label: 'Facturas emitidas' },
    { value: '99.9%', label: 'Disponibilidade' },
    { value: '< 60s', label: 'Para emitir uma factura' }
  ]);

  features = signal<FeatureContent[]>([
    {
      faIcon: 'fa-bolt',
      title: 'Facturação rápida',
      description: 'Crie e envie facturas profissionais em menos de 60 segundos com um fluxo simples e claro.',
      color: '#f59e0b',
      bgColor: 'rgba(245, 158, 11, 0.1)'
    },
    {
      faIcon: 'fa-calculator',
      title: 'Cálculo automático de ISPC',
      description: 'O sistema calcula automaticamente o imposto ISPC com base nas categorias e taxas moçambicanas actuais.',
      color: '#0ea5e9',
      bgColor: 'rgba(14, 165, 233, 0.1)'
    },
    {
      faIcon: 'fa-users',
      title: 'Gestão de clientes',
      description: 'Mantenha os seus clientes organizados com pesquisa inteligente e histórico de transacções.',
      color: '#8b5cf6',
      bgColor: 'rgba(139, 92, 246, 0.1)'
    },
    {
      faIcon: 'fa-boxes-stacked',
      title: 'Catálogo de produtos',
      description: 'Adicione produtos e serviços uma única vez e reutilize-os em todas as facturas.',
      color: '#10b981',
      bgColor: 'rgba(16, 185, 129, 0.1)'
    },
    {
      faIcon: 'fa-paper-plane',
      title: 'Envio automático',
      description: 'Emita e envie facturas por email automaticamente para os seus clientes com um único clique.',
      color: '#f16c39',
      bgColor: 'rgba(241, 108, 57, 0.1)'
    },
    {
      faIcon: 'fa-building',
      title: 'Múltiplas empresas',
      description: 'Gerencie várias empresas numa única conta. Ideal para contabilistas e gestores de múltiplos negócios.',
      color: '#ec4899',
      bgColor: 'rgba(236, 72, 153, 0.1)'
    }
  ]);

  values = signal<ValueContent[]>([
    {
      icon: 'fa-bullseye',
      title: 'Missão',
      desc: 'Democratizar o acesso a ferramentas de facturação profissional para todos os negócios moçambicanos.',
      color: '#f59e0b',
      bg: 'rgba(245, 158, 11, 0.1)'
    },
    {
      icon: 'fa-eye',
      title: 'Visão',
      desc: 'Ser a plataforma de referência em gestão de negócios no mercado africano lusófono.',
      color: '#0ea5e9',
      bg: 'rgba(14, 165, 233, 0.1)'
    },
    {
      icon: 'fa-handshake',
      title: 'Valores',
      desc: 'Simplicidade, confiança, inovação e compromisso com o sucesso dos nossos clientes.',
      color: '#10b981',
      bg: 'rgba(16, 185, 129, 0.1)'
    }
  ]);

  faqs = signal<FaqContent[]>([
    {
      question: 'Preciso de instalar algum software?',
      answer: 'Não. O ISPC Fácil é uma plataforma 100% web. Basta ter acesso à internet para emitir facturas em qualquer dispositivo, seja computador, tablet ou smartphone.'
    },
    {
      question: 'O cálculo do ISPC está actualizado?',
      answer: 'Sim. Mantemos as taxas e categorias do ISPC sempre actualizadas de acordo com as regulamentações moçambicanas vigentes.'
    },
    {
      question: 'Posso experimentar antes de pagar?',
      answer: 'Absolutamente. Oferecemos 14 dias de período de avaliação gratuito, sem necessidade de cartão de crédito.'
    },
    {
      question: 'Os meus dados estão seguros?',
      answer: 'Sim. Utilizamos encriptação SSL/TLS de ponta a ponta, backups automáticos e boas práticas de segurança de dados.'
    },
    {
      question: 'Posso cancelar a qualquer momento?',
      answer: 'Sim, sem compromissos. Pode cancelar a sua subscrição a qualquer momento e sem qualquer taxa adicional.'
    },
    {
      question: 'Existe suporte em português de Moçambique?',
      answer: 'Sim. A nossa equipa de suporte é moçambicana e está disponível em português de Moçambique via email, chat e WhatsApp.'
    }
  ]);

  contact = signal<ContactContent>({
    email: 'suporte@ispcfacil.co.mz',
    phone: '+258 84 000 0000',
    whatsapp: '+258 84 000 0000',
    address: 'Maputo, Moçambique',
    workHours: 'Segunda a Sexta, 08h00 - 17h00'
  });

  loading = signal<boolean>(false);

  constructor(
    private supabase: SupabaseService,
    private auditLogService: AuditLogService
  ) {
    this.loadAllContent();
  }

  async loadAllContent(): Promise<void> {
    this.loading.set(true);
    try {
      const { data, error } = await this.supabase.client
        .from('landing_content')
        .select('*');

      if (error) {
        console.error('Error loading landing content:', error);
        return;
      }

      if (data && data.length > 0) {
        data.forEach((row: any) => {
          const content = row.content;
          if (!content) return;

          switch (row.section) {
            case 'hero':
              this.hero.set({ ...this.hero(), ...content });
              break;
            case 'stats':
              if (Array.isArray(content)) this.stats.set(content);
              break;
            case 'features':
              if (Array.isArray(content)) this.features.set(content);
              break;
            case 'values':
              if (Array.isArray(content)) this.values.set(content);
              break;
            case 'faqs':
              if (Array.isArray(content)) this.faqs.set(content);
              break;
            case 'contact':
              this.contact.set({ ...this.contact(), ...content });
              break;
          }
        });
      }
    } catch (err) {
      console.error('Exception loading landing content:', err);
    } finally {
      this.loading.set(false);
    }
  }

  async updateSectionContent(section: string, content: any): Promise<boolean> {
    const { error } = await this.supabase.client
      .from('landing_content')
      .upsert(
        {
          section,
          content,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'section' }
      );

    if (error) {
      console.error(`Error updating section ${section}:`, error);
      return false;
    }

    await this.auditLogService.log(
      `Atualizou Secção do Site (${section})`,
      'landing_content',
      { section, content }
    );

    await this.loadAllContent();
    return true;
  }
}
