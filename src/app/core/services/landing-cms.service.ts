import { Injectable, computed, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuditLogService } from './audit-log.service';
import { currentLanguage, t } from '../i18n/i18n';

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

export interface PolicySection {
  title: string;
  content: string;
}

export interface LegalDocumentContent {
  title: string;
  subtitle: string;
  intro: string;
  lastUpdatedText: string;
  sections: PolicySection[];
}

/*
 * Conteúdo por omissão da landing (em português). O CMS (tabela landing_content,
 * editada em português no painel de administração) sobrepõe-se a estes valores.
 * Noutras línguas os textos vêm do dicionário (landing.cms.*) e do CMS só se
 * aproveitam os campos que não são texto (ícones, cores, links, valores, contactos).
 */
const DEFAULT_HERO: HeroContent = {
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
};

const DEFAULT_STATS: StatContent[] = [
  { value: '500+', label: 'Empresas activas' },
  { value: '50K+', label: 'Facturas emitidas' },
  { value: '99.9%', label: 'Disponibilidade' },
  { value: '< 60s', label: 'Para emitir uma factura' }
];

const DEFAULT_FEATURES: FeatureContent[] = [
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
];

const DEFAULT_VALUES: ValueContent[] = [
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
];

const DEFAULT_FAQS: FaqContent[] = [
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
];

const DEFAULT_CONTACT: ContactContent = {
  email: 'suporte@ispcfacil.co.mz',
  phone: '+258 84 000 0000',
  whatsapp: '+258 84 000 0000',
  address: 'Maputo, Moçambique',
  workHours: 'Segunda a Sexta, 08h00 - 17h00'
};

const DEFAULT_TERMS: LegalDocumentContent = {
  title: 'Termos de Uso',
  subtitle: 'As regras para utilizar o ISPC Fácil de forma segura e transparente.',
  intro: 'Ao criar uma conta ou utilizar o ISPC Fácil, confirma que leu e aceita estes termos de uso.',
  lastUpdatedText: 'Última actualização: 2026',
  sections: [
    {
      title: '1. Aceitação dos termos',
      content: 'Estes termos regulam o acesso e a utilização da plataforma ISPC Fácil. Caso não concorde com alguma condição, não deverá utilizar o serviço.'
    },
    {
      title: '2. Descrição do serviço',
      content: 'O ISPC Fácil é uma ferramenta de apoio à facturação, gestão financeira e cálculo do ISPC para empreendedores e empresas em Moçambique.'
    },
    {
      title: '3. Responsabilidades do utilizador',
      content: 'O utilizador compromete-se a fornecer informações verdadeiras e actualizadas, proteger as suas credenciais e utilizar a plataforma em conformidade com a legislação aplicável.'
    },
    {
      title: '4. Limitação de responsabilidade',
      content: 'A plataforma é uma ferramenta de apoio. A responsabilidade final pela exactidão das informações, facturas, declarações fiscais e pagamentos pertence ao utilizador.'
    },
    {
      title: '5. Disponibilidade e alterações',
      content: 'Podemos actualizar, melhorar ou alterar funcionalidades do serviço. Poderemos também actualizar estes termos, comunicando as alterações relevantes através da plataforma.'
    },
    {
      title: '6. Contacto',
      content: 'Para questões sobre estes termos ou sobre a utilização do serviço, utilize os canais de contacto disponibilizados na plataforma.'
    }
  ]
};

const DEFAULT_PRIVACY: LegalDocumentContent = {
  title: 'Política de Privacidade',
  subtitle: 'Como o ISPC Fácil recolhe, utiliza e protege os seus dados.',
  intro: 'A sua privacidade é importante para nós. Esta política explica de forma clara que dados recolhemos e para que finalidades os utilizamos.',
  lastUpdatedText: 'Última actualização: 2026',
  sections: [
    {
      title: '1. Dados que recolhemos',
      content: 'Podemos recolher o seu nome, endereço de email, telefone e informações da sua empresa quando cria uma conta, utiliza a plataforma ou entra em contacto connosco.'
    },
    {
      title: '2. Como utilizamos os seus dados',
      content: 'Utilizamos estas informações para disponibilizar os serviços de facturação, calcular o ISPC, gerir a sua conta, prestar suporte e comunicar informações importantes sobre o serviço.'
    },
    {
      title: '3. Protecção e conservação',
      content: 'Aplicamos medidas técnicas e organizativas para proteger os seus dados contra acesso, alteração ou divulgação não autorizados. Conservamos os dados apenas durante o tempo necessário para cumprir as finalidades descritas e as obrigações legais aplicáveis.'
    },
    {
      title: '4. Partilha de informações',
      content: 'Não vendemos os seus dados pessoais. Apenas os partilhamos com prestadores essenciais ao funcionamento da plataforma ou quando tal for exigido por lei, incluindo pelas autoridades competentes.'
    },
    {
      title: '5. Os seus direitos',
      content: 'Pode solicitar o acesso, a rectificação ou a eliminação dos seus dados, bem como esclarecer dúvidas sobre esta política, através dos canais de contacto disponibilizados na plataforma.'
    }
  ]
};

/** Chaves (landing.cms.<secção>.<chave>) dos itens por omissão, pela mesma ordem. */
const STAT_KEYS = ['activeCompanies', 'invoicesIssued', 'uptime', 'issueTime'];
const FEATURE_KEYS = ['fastInvoicing', 'ispcCalculation', 'clientManagement', 'productCatalogue', 'autoSending', 'multiCompany'];
const VALUE_KEYS = ['mission', 'vision', 'values'];
const FAQ_KEYS = ['noInstall', 'ispcUpToDate', 'freeTrial', 'dataSecurity', 'cancelAnytime', 'localSupport'];
const TERMS_SECTION_KEYS = ['acceptance', 'service', 'userResponsibilities', 'liability', 'changes', 'contact'];
const PRIVACY_SECTION_KEYS = ['dataCollected', 'dataUse', 'protection', 'sharing', 'rights'];

/**
 * Usa os itens do CMS para os campos que não são texto quando a lista tem o mesmo
 * tamanho que a por omissão (a ordem coincide com as traduções); caso contrário
 * usa a lista por omissão.
 */
function mergeTranslated<T extends object>(cms: T[], defaults: T[], keys: string[], translate: (key: string) => Partial<T>): T[] {
  const base = cms.length === defaults.length ? cms : defaults;
  return keys.map((key, i) => ({ ...defaults[i], ...base[i], ...translate(key) }));
}

@Injectable({
  providedIn: 'root'
})
export class LandingCmsService {
  // Conteúdo tal como está no CMS (em português) — usado pelo painel de administração.
  hero = signal<HeroContent>(DEFAULT_HERO);
  stats = signal<StatContent[]>(DEFAULT_STATS);
  features = signal<FeatureContent[]>(DEFAULT_FEATURES);
  values = signal<ValueContent[]>(DEFAULT_VALUES);
  faqs = signal<FaqContent[]>(DEFAULT_FAQS);
  contact = signal<ContactContent>(DEFAULT_CONTACT);
  terms = signal<LegalDocumentContent>(DEFAULT_TERMS);
  privacy = signal<LegalDocumentContent>(DEFAULT_PRIVACY);

  // Conteúdo a mostrar no site público, na língua da interface.
  // Em pt-MZ é exactamente o conteúdo do CMS.
  readonly localizedHero = computed<HeroContent>(() => {
    const hero = this.hero();
    if (!this.useTranslations()) return hero;
    return {
      ...hero,
      badge: t('landing.cms.hero.badge'),
      title: t('landing.cms.hero.title'),
      highlightWord: t('landing.cms.hero.highlightWord'),
      subtitle: t('landing.cms.hero.subtitle'),
      primaryCtaText: t('landing.cms.hero.primaryCtaText'),
      secondaryCtaText: t('landing.cms.hero.secondaryCtaText'),
      guaranteeText: t('landing.cms.hero.guaranteeText'),
      proofText: t('landing.cms.hero.proofText')
    };
  });

  readonly localizedStats = computed<StatContent[]>(() => {
    const stats = this.stats();
    if (!this.useTranslations()) return stats;
    return mergeTranslated(stats, DEFAULT_STATS, STAT_KEYS, key => ({
      label: t(`landing.cms.stats.${key}`)
    }));
  });

  readonly localizedFeatures = computed<FeatureContent[]>(() => {
    const features = this.features();
    if (!this.useTranslations()) return features;
    return mergeTranslated(features, DEFAULT_FEATURES, FEATURE_KEYS, key => ({
      title: t(`landing.cms.features.${key}.title`),
      description: t(`landing.cms.features.${key}.description`)
    }));
  });

  readonly localizedValues = computed<ValueContent[]>(() => {
    const values = this.values();
    if (!this.useTranslations()) return values;
    return mergeTranslated(values, DEFAULT_VALUES, VALUE_KEYS, key => ({
      title: t(`landing.cms.values.${key}.title`),
      desc: t(`landing.cms.values.${key}.desc`)
    }));
  });

  readonly localizedFaqs = computed<FaqContent[]>(() => {
    const faqs = this.faqs();
    if (!this.useTranslations()) return faqs;
    return FAQ_KEYS.map(key => ({
      question: t(`landing.cms.faqs.${key}.question`),
      answer: t(`landing.cms.faqs.${key}.answer`)
    }));
  });

  readonly localizedContact = computed<ContactContent>(() => {
    const contact = this.contact();
    if (!this.useTranslations()) return contact;
    return {
      ...contact,
      address: t('landing.cms.contact.address'),
      workHours: t('landing.cms.contact.workHours')
    };
  });

  readonly localizedTerms = computed<LegalDocumentContent>(() => {
    const terms = this.terms();
    if (!this.useTranslations()) return terms;
    return this.translatedLegal('terms', TERMS_SECTION_KEYS);
  });

  readonly localizedPrivacy = computed<LegalDocumentContent>(() => {
    const privacy = this.privacy();
    if (!this.useTranslations()) return privacy;
    return this.translatedLegal('privacy', PRIVACY_SECTION_KEYS);
  });

  loading = signal<boolean>(false);
  private contentLoadPromise: Promise<void> | null = null;

  constructor(
    private supabase: SupabaseService,
    private auditLogService: AuditLogService
  ) {}

  async loadAllContent(): Promise<void> {
    // Several pages use this service. Reuse the same request when they are
    // initialised at the same time instead of issuing concurrent queries.
    if (this.contentLoadPromise) return this.contentLoadPromise;

    this.contentLoadPromise = this.loadContentWithTimeout();
    try {
      await this.contentLoadPromise;
    } finally {
      this.contentLoadPromise = null;
    }
  }

  private async loadContentWithTimeout(): Promise<void> {
    this.loading.set(true);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const request = this.supabase.client
        .from('landing_content')
        .select('*');

      const result = await Promise.race([
        request,
        new Promise<{ data: null; error: Error }>((resolve) => {
          timeoutId = setTimeout(() => resolve({
            data: null,
            error: new Error('A consulta do conteúdo demorou demasiado tempo.')
          }), 15000);
        })
      ]);

      const { data, error } = result;

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
            case 'terms':
              if (content && typeof content === 'object') {
                this.terms.set({ ...this.terms(), ...content });
              }
              break;
            case 'privacy':
              if (content && typeof content === 'object') {
                this.privacy.set({ ...this.privacy(), ...content });
              }
              break;
          }
        });
      }
    } catch (err) {
      console.error('Exception loading landing content:', err);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
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

  getTermsHtml(): string {
    const doc = this.localizedTerms();
    let html = `<h1>${doc.title}</h1>`;
    if (doc.subtitle) html += `<p class="font-semibold text-gray-700">${doc.subtitle}</p>`;
    if (doc.intro) html += `<p>${doc.intro}</p>`;
    (doc.sections || []).forEach(sec => {
      html += `<h2>${sec.title}</h2><p>${sec.content}</p>`;
    });
    if (doc.lastUpdatedText) {
      html += `<p style="font-size: 0.85em; color: #888; margin-top: 1.5rem;">${doc.lastUpdatedText}</p>`;
    }
    return html;
  }

  getPrivacyHtml(): string {
    const p = this.localizedPrivacy();
    let html = `<h1>${p.title}</h1>`;
    if (p.subtitle) html += `<p class="font-semibold text-gray-700">${p.subtitle}</p>`;
    if (p.intro) html += `<p>${p.intro}</p>`;
    (p.sections || []).forEach(sec => {
      html += `<h2>${sec.title}</h2><p>${sec.content}</p>`;
    });
    if (p.lastUpdatedText) {
      html += `<p style="font-size: 0.85em; color: #888; margin-top: 1.5rem;">${p.lastUpdatedText}</p>`;
    }
    return html;
  }

  /** Fora do português os textos vêm do dicionário (o CMS só é editado em português). */
  private useTranslations(): boolean {
    return currentLanguage() !== 'pt-MZ';
  }

  private translatedLegal(doc: 'terms' | 'privacy', sectionKeys: string[]): LegalDocumentContent {
    return {
      title: t(`landing.cms.${doc}.title`),
      subtitle: t(`landing.cms.${doc}.subtitle`),
      intro: t(`landing.cms.${doc}.intro`),
      lastUpdatedText: t(`landing.cms.${doc}.lastUpdatedText`),
      sections: sectionKeys.map(key => ({
        title: t(`landing.cms.${doc}.sections.${key}.title`),
        content: t(`landing.cms.${doc}.sections.${key}.content`)
      }))
    };
  }
}
