import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  QueryList,
  ViewChildren
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { animate, state, style, transition, trigger } from '@angular/animations';
import { LoginFormComponent } from '../../shared/components/login-form/login-form.component';
import { SubscriptionService } from '../../core/services/subscription.service';

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    ReactiveFormsModule,
    LoginFormComponent
  ],
  templateUrl: './landing.component.html',
  styleUrls: ['./landing.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger('faqExpand', [
      state('closed', style({
        height: '0px',
        opacity: 0,
        overflow: 'hidden',
        paddingTop: '0',
        paddingBottom: '0'
      })),
      state('open', style({
        height: '*',
        opacity: 1,
        overflow: 'hidden',
        paddingTop: '1rem',
        paddingBottom: '1.25rem'
      })),
      transition('closed <=> open', [
        animate('320ms cubic-bezier(0.4, 0, 0.2, 1)')
      ])
    ])
  ]
})
export class LandingComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChildren('revealItem', { read: ElementRef })
  revealItems!: QueryList<ElementRef<HTMLElement>>;

  isScrolled = false;
  activeSection = 'hero';
  mobileMenuOpen = false;
  openFaqIndex: number | null = null;
  contactSuccess = false;
  contactLoading = false;
  contactForm!: FormGroup;
  currentYear = new Date().getFullYear();

  private observer?: IntersectionObserver;
  private scrollListener!: () => void;
  private visibleItems = new Set<string>();
  private readonly sectionIds = [
    'hero',
    'funcionalidades',
    'sobre-nos',
    'precos',
    'faq',
    'contacto'
  ];

  stats = [
    { value: '500+', label: 'Empresas activas' },
    { value: '50K+', label: 'Facturas emitidas' },
    { value: '99.9%', label: 'Disponibilidade' },
    { value: '< 60s', label: 'Para emitir uma factura' }
  ];

  features = [
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

  values = [
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

  plans = [
    {
      name: 'Essencial',
      description: 'Ideal para autónomos e microempresas',
      price: '2.500',
      currency: 'MZN',
      period: 'mês',
      features: [
        'Até 100 facturas/mês',
        'Clientes ilimitados',
        'Cálculo automático de ISPC',
        'Envio por email',
        '1 empresa',
        'Suporte por email'
      ],
      highlighted: false
    },
    {
      name: 'Profissional',
      description: 'Para PMEs em crescimento acelerado',
      price: '5.000',
      currency: 'MZN',
      period: 'mês',
      features: [
        'Facturas ilimitadas',
        'Clientes ilimitados',
        'Cálculo automático de ISPC',
        'Envio por email',
        'Até 5 empresas',
        'Relatórios avançados',
        'Suporte prioritário 24/7',
        'Exportação para PDF/Excel'
      ],
      highlighted: true
    }
  ];

  faqs = [
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

  constructor(
    private fb: FormBuilder,
    private cdr: ChangeDetectorRef,
    private subscriptionService: SubscriptionService
  ) {}

  async ngOnInit() {
    this.contactForm = this.fb.group({
      nome: ['', [Validators.required, Validators.minLength(2)]],
      email: ['', [Validators.required, Validators.email]],
      assunto: ['', [Validators.required, Validators.minLength(3)]],
      mensagem: ['', [Validators.required, Validators.minLength(10)]]
    });

    this.scrollListener = () => {
      this.isScrolled = window.scrollY > 20;
      this.updateActiveSection();
      this.cdr.markForCheck();
    };

    window.addEventListener('scroll', this.scrollListener, { passive: true });
    this.scrollListener();

    await this.loadDynamicPlans();
  }

  async loadDynamicPlans() {
    try {
      const dbPlans = await this.subscriptionService.loadPlans();
      if (dbPlans && dbPlans.length > 0) {
        const activePlans = dbPlans.filter(p => p.is_active !== false && p.code !== 'trial');
        if (activePlans.length > 0) {
          this.plans = activePlans.map(p => ({
            name: p.name,
            description: p.description || '',
            price: p.monthly_price ? p.monthly_price.toLocaleString('pt-MZ') : '0',
            currency: p.currency || 'MZN',
            period: 'mês',
            features: p.features || [],
            highlighted: !!p.is_popular
          }));

          // Mark plan reveal items as visible
          this.plans.forEach((_, i) => this.visibleItems.add(`plan-${i}`));
          this.cdr.markForCheck();
          setTimeout(() => this.observeRevealItems(), 100);
        }
      }
    } catch (e) {
      console.error('Error loading dynamic plans in landing:', e);
    }
  }

  ngAfterViewInit() {
    // Also mark initial plans as visible by default
    this.plans.forEach((_, i) => this.visibleItems.add(`plan-${i}`));

    if (typeof IntersectionObserver === 'undefined') {
      return;
    }

    this.observer = new IntersectionObserver(entries => {
      let changed = false;

      entries.forEach(entry => {
        if (!entry.isIntersecting) {
          return;
        }

        const target = entry.target as HTMLElement;
        const key = target.dataset['revealKey'];

        if (key && !this.visibleItems.has(key)) {
          this.visibleItems.add(key);
          changed = true;
        }

        this.observer?.unobserve(target);
      });

      if (changed) {
        this.cdr.markForCheck();
      }
    }, {
      threshold: 0.18,
      rootMargin: '0px 0px -8% 0px'
    });

    this.observeRevealItems();
  }

  ngOnDestroy() {
    if (this.scrollListener) {
      window.removeEventListener('scroll', this.scrollListener);
    }

    this.observer?.disconnect();
  }

  toggleFaq(index: number) {
    this.openFaqIndex = this.openFaqIndex === index ? null : index;
  }

  scrollToSection(sectionId: string, event?: MouseEvent) {
    event?.preventDefault();
    this.mobileMenuOpen = false;
    this.activeSection = sectionId;

    const target = document.getElementById(sectionId);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    this.cdr.markForCheck();
  }

  isVisible(key: string): boolean {
    if (key && key.startsWith('plan-')) {
      return true;
    }
    return this.visibleItems.has(key);
  }

  isFieldInvalid(field: string): boolean {
    const control = this.contactForm.get(field);
    return !!(control && control.invalid && control.touched);
  }

  getContactError(field: string): string {
    const control = this.contactForm.get(field);
    if (!control || !control.touched) return '';
    if (control.hasError('required')) return 'Este campo é obrigatório.';
    if (control.hasError('email')) return 'Introduza um endereço de email válido.';
    if (control.hasError('minlength')) {
      const min = control.errors?.['minlength']?.requiredLength;
      return `Mínimo de ${min} caracteres.`;
    }
    return '';
  }

  async onContactSubmit() {
    if (this.contactForm.invalid) {
      this.contactForm.markAllAsTouched();
      return;
    }

    this.contactLoading = true;
    this.cdr.markForCheck();

    await new Promise(resolve => setTimeout(resolve, 1200));

    this.contactLoading = false;
    this.contactSuccess = true;
    this.cdr.markForCheck();
  }

  resetContact() {
    this.contactSuccess = false;
    this.contactForm.reset();
    this.cdr.markForCheck();
  }

  private observeRevealItems() {
    this.revealItems?.forEach(item => {
      const element = item.nativeElement;
      const key = element.dataset['revealKey'];

      if (!key) {
        return;
      }

      this.observer?.observe(element);
    });
  }

  private updateActiveSection() {
    const offset = window.scrollY + 132;
    let nextSection = this.activeSection;

    for (const sectionId of this.sectionIds) {
      const element = document.getElementById(sectionId);
      if (!element) {
        continue;
      }

      const top = element.offsetTop;
      const bottom = top + element.offsetHeight;

      if (offset >= top && offset < bottom) {
        nextSection = sectionId;
        break;
      }
    }

    this.activeSection = nextSection;
  }
}
