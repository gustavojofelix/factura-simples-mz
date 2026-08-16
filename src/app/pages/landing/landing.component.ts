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
import { LandingCmsService } from '../../core/services/landing-cms.service';

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

  get hero() {
    return this.cmsService.hero();
  }

  getHeroTitleParts() {
    const title = this.hero.title || '';
    const highlight = this.hero.highlightWord || '';
    if (!highlight || !title.toLowerCase().includes(highlight.toLowerCase())) {
      return { hasHighlight: false, prefix: title, highlight: '', suffix: '' };
    }
    const index = title.toLowerCase().indexOf(highlight.toLowerCase());
    const prefix = title.substring(0, index);
    const actualHighlight = title.substring(index, index + highlight.length);
    const suffix = title.substring(index + highlight.length);
    return { hasHighlight: true, prefix, highlight: actualHighlight, suffix };
  }

  get stats() {
    return this.cmsService.stats();
  }

  get features() {
    return this.cmsService.features();
  }

  get values() {
    return this.cmsService.values();
  }

  get faqs() {
    return this.cmsService.faqs();
  }

  get contact() {
    return this.cmsService.contact();
  }

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

  selectedCycle: 'monthly' | 'quarterly' | 'semiannual' | 'yearly' = 'monthly';
  rawPlans: any[] = [];

  constructor(
    private fb: FormBuilder,
    private cdr: ChangeDetectorRef,
    private subscriptionService: SubscriptionService,
    public cmsService: LandingCmsService
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

    try {
      await this.cmsService.loadAllContent();
      this.cdr.markForCheck();
    } catch (e) {
      console.error('Error loading CMS content:', e);
    }

    await this.loadDynamicPlans();
  }

  setBillingCycle(cycle: 'monthly' | 'quarterly' | 'semiannual' | 'yearly') {
    this.selectedCycle = cycle;
    this.updateDisplayedPlans();
    this.cdr.markForCheck();
  }

  updateDisplayedPlans() {
    if (!this.rawPlans || this.rawPlans.length === 0) return;

    const periodMap = {
      monthly: 'mês',
      quarterly: '3 meses',
      semiannual: '6 meses',
      yearly: 'ano'
    };

    this.plans = this.rawPlans.map(p => {
      let priceVal = p.monthly_price;
      if (this.selectedCycle === 'quarterly') {
        priceVal = p.three_months_price || (p.monthly_price * 3);
      } else if (this.selectedCycle === 'semiannual') {
        priceVal = p.six_months_price || (p.monthly_price * 6);
      } else if (this.selectedCycle === 'yearly') {
        priceVal = p.yearly_price;
      }

      const isPopular = p.is_popular === true || String(p.is_popular).toLowerCase() === 'true' || p.is_popular === 1;

      return {
        name: p.name,
        description: p.description || '',
        price: priceVal ? priceVal.toLocaleString('pt-MZ') : '0',
        currency: p.currency || 'MZN',
        period: periodMap[this.selectedCycle],
        features: p.features || [],
        highlighted: isPopular
      };
    });
  }

  async loadDynamicPlans() {
    try {
      const dbPlans = await this.subscriptionService.loadPlans();
      if (dbPlans && dbPlans.length > 0) {
        const activePlans = dbPlans
          .filter(p => p.is_active !== false && p.code !== 'trial')
          .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));

        if (activePlans.length > 0) {
          this.rawPlans = activePlans;
          this.updateDisplayedPlans();

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
