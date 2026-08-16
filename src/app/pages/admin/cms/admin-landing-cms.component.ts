import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ContactContent,
  FaqContent,
  FeatureContent,
  HeroContent,
  LandingCmsService,
  StatContent,
  ValueContent
} from '../../../core/services/landing-cms.service';

@Component({
  selector: 'app-admin-landing-cms',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="space-y-6 max-w-7xl mx-auto pb-12">
      <!-- Header Banner -->
      <div class="bg-gradient-to-r from-slate-900 via-slate-800 to-blue-900 rounded-3xl p-8 text-white shadow-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/20 text-blue-300 text-xs font-semibold uppercase tracking-wider mb-3 backdrop-blur-sm border border-blue-400/20">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
            </svg>
            UX/UI Content Manager
          </div>
          <h2 class="text-3xl font-extrabold tracking-tight">Gestão de Conteúdo da Landing Page</h2>
          <p class="text-slate-300 text-sm mt-1 max-w-2xl">
            Edite textos, funcionalidades, métricas e FAQs. As alterações guardadas aqui são refletidas instantaneamente na página principal do site.
          </p>
        </div>

        <a href="/" target="_blank" class="bg-white/10 hover:bg-white/20 text-white px-4 py-2.5 rounded-xl font-semibold text-sm flex items-center gap-2 border border-white/10 transition-all backdrop-blur-sm">
          <span>Ver Site em Direto</span>
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
          </svg>
        </a>
      </div>

      <!-- Messages Toast -->
      <div *ngIf="message" class="p-4 rounded-2xl bg-green-500/10 border border-green-500/20 text-green-700 flex items-center justify-between shadow-sm animate-fade-in">
        <div class="flex items-center gap-3">
          <svg class="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
          </svg>
          <span class="font-medium text-sm">{{ message }}</span>
        </div>
        <button (click)="message = ''" class="text-green-700 hover:text-green-900 text-xs font-bold uppercase">Fechar</button>
      </div>

      <div *ngIf="error" class="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-700 flex items-center justify-between shadow-sm">
        <div class="flex items-center gap-3">
          <svg class="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <span class="font-medium text-sm">{{ error }}</span>
        </div>
        <button (click)="error = ''" class="text-red-700 hover:text-red-900 text-xs font-bold uppercase">Fechar</button>
      </div>

      <!-- Loading State -->
      <div *ngIf="!loaded" class="flex flex-col items-center justify-center p-12 bg-white rounded-3xl border border-gray-100 shadow-sm">
        <div class="animate-spin rounded-full h-8 w-8 border-4 border-blue-600 border-t-transparent mb-3"></div>
        <p class="text-sm text-gray-500 font-medium">A carregar dados do site...</p>
      </div>

      <ng-container *ngIf="loaded">
        <!-- Navigation Tabs -->
      <div class="flex border-b border-gray-200 overflow-x-auto no-scrollbar gap-2 bg-white p-2 rounded-2xl border border-gray-100 shadow-sm">
        <button (click)="activeTab = 'hero'" [class.bg-blue-600]="activeTab === 'hero'" [class.text-white]="activeTab === 'hero'" [class.text-gray-600]="activeTab !== 'hero'" [class.hover:bg-gray-100]="activeTab !== 'hero'" class="flex items-center gap-2 px-5 py-3 rounded-xl font-semibold text-sm transition-all whitespace-nowrap">
          <span>🚀 Hero & Banner</span>
        </button>

        <button (click)="activeTab = 'stats'" [class.bg-blue-600]="activeTab === 'stats'" [class.text-white]="activeTab === 'stats'" [class.text-gray-600]="activeTab !== 'stats'" [class.hover:bg-gray-100]="activeTab !== 'stats'" class="flex items-center gap-2 px-5 py-3 rounded-xl font-semibold text-sm transition-all whitespace-nowrap">
          <span>📊 Métricas</span>
        </button>

        <button (click)="activeTab = 'features'" [class.bg-blue-600]="activeTab === 'features'" [class.text-white]="activeTab === 'features'" [class.text-gray-600]="activeTab !== 'features'" [class.hover:bg-gray-100]="activeTab !== 'features'" class="flex items-center gap-2 px-5 py-3 rounded-xl font-semibold text-sm transition-all whitespace-nowrap">
          <span>⚡ Funcionalidades</span>
        </button>

        <button (click)="activeTab = 'values'" [class.bg-blue-600]="activeTab === 'values'" [class.text-white]="activeTab === 'values'" [class.text-gray-600]="activeTab !== 'values'" [class.hover:bg-gray-100]="activeTab !== 'values'" class="flex items-center gap-2 px-5 py-3 rounded-xl font-semibold text-sm transition-all whitespace-nowrap">
          <span>🎯 Visão & Valores</span>
        </button>

        <button (click)="activeTab = 'faqs'" [class.bg-blue-600]="activeTab === 'faqs'" [class.text-white]="activeTab === 'faqs'" [class.text-gray-600]="activeTab !== 'faqs'" [class.hover:bg-gray-100]="activeTab !== 'faqs'" class="flex items-center gap-2 px-5 py-3 rounded-xl font-semibold text-sm transition-all whitespace-nowrap">
          <span>❓ FAQs</span>
        </button>

        <button (click)="activeTab = 'contact'" [class.bg-blue-600]="activeTab === 'contact'" [class.text-white]="activeTab === 'contact'" [class.text-gray-600]="activeTab !== 'contact'" [class.hover:bg-gray-100]="activeTab !== 'contact'" class="flex items-center gap-2 px-5 py-3 rounded-xl font-semibold text-sm transition-all whitespace-nowrap">
          <span>📞 Contactos</span>
        </button>
      </div>

      <!-- TAB 1: HERO SECTION -->
      <div *ngIf="activeTab === 'hero'" class="bg-white rounded-3xl border border-gray-100 p-8 shadow-sm space-y-6">
        <div class="flex items-center justify-between border-b border-gray-100 pb-4">
          <div>
            <h3 class="text-xl font-bold text-gray-900">Cabeçalho & Secção Principal (Hero)</h3>
            <p class="text-sm text-gray-500">Configure a primeira impressão visual que os utilizadores têm ao entrar no site.</p>
          </div>
          <button (click)="saveHero()" [disabled]="saving" class="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-2.5 rounded-xl text-sm transition-all shadow-sm disabled:opacity-50 flex items-center gap-2">
            <span>{{ saving ? 'A guardar...' : 'Guardar Alterações' }}</span>
          </button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Badge de Destaque Superior</label>
            <input type="text" [(ngModel)]="heroForm.badge" class="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none">
          </div>

          <div>
            <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Ícone do Badge (FontAwesome)</label>
            <input type="text" [(ngModel)]="heroForm.badgeIcon" placeholder="ex: fa-tag" class="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none">
          </div>

          <div class="md:col-span-2">
            <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Título Principal (H1)</label>
            <input type="text" [(ngModel)]="heroForm.title" class="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-800 focus:ring-2 focus:ring-blue-500 outline-none">
          </div>

          <div>
            <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Palavra a Destacar com Cor Laranja (Highlight)</label>
            <input type="text" [(ngModel)]="heroForm.highlightWord" placeholder="ex: ISPC" class="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none">
          </div>

          <div>
            <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Texto da Garantia (Abaixo dos Botões)</label>
            <input type="text" [(ngModel)]="heroForm.guaranteeText" class="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none">
          </div>

          <div class="md:col-span-2">
            <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Subtítulo / Descrição Completa</label>
            <textarea [(ngModel)]="heroForm.subtitle" rows="3" class="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"></textarea>
          </div>

          <div>
            <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Botão Principal - Texto</label>
            <input type="text" [(ngModel)]="heroForm.primaryCtaText" class="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none">
          </div>

          <div>
            <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Botão Principal - Link</label>
            <input type="text" [(ngModel)]="heroForm.primaryCtaLink" class="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none">
          </div>

          <div>
            <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Botão Secundário - Texto</label>
            <input type="text" [(ngModel)]="heroForm.secondaryCtaText" class="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none">
          </div>

          <div>
            <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Botão Secundário - Link</label>
            <input type="text" [(ngModel)]="heroForm.secondaryCtaLink" class="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none">
          </div>

          <div class="md:col-span-2">
            <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Texto Prova Social (Abaixo do Formulário)</label>
            <input type="text" [(ngModel)]="heroForm.proofText" placeholder="ex: Centenas de negócios moçambicanos confiam em nós" class="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none">
          </div>
        </div>
      </div>

      <!-- TAB 2: STATS SECTION -->
      <div *ngIf="activeTab === 'stats'" class="bg-white rounded-3xl border border-gray-100 p-8 shadow-sm space-y-6">
        <div class="flex items-center justify-between border-b border-gray-100 pb-4">
          <div>
            <h3 class="text-xl font-bold text-gray-900">Métricas & Indicadores de Impacto</h3>
            <p class="text-sm text-gray-500">Configure os contadores numéricos apresentados na barra de estatísticas.</p>
          </div>
          <div class="flex gap-2">
            <button (click)="addStat()" class="bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold px-4 py-2.5 rounded-xl text-sm transition-all">
              + Adicionar Métrica
            </button>
            <button (click)="saveStats()" [disabled]="saving" class="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-2.5 rounded-xl text-sm transition-all shadow-sm disabled:opacity-50">
              {{ saving ? 'A guardar...' : 'Guardar Alterações' }}
            </button>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div *ngFor="let stat of statsForm; let i = index" class="p-5 bg-gray-50 border border-gray-200 rounded-2xl relative space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-gray-400 uppercase">Métrica #{{ i + 1 }}</span>
              <button (click)="removeStat(i)" class="text-red-500 hover:bg-red-50 p-1.5 rounded-lg text-xs font-bold">
                Remover
              </button>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Valor Destaque</label>
                <input type="text" [(ngModel)]="stat.value" placeholder="ex: 500+" class="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-base font-extrabold text-blue-600 outline-none">
              </div>
              <div>
                <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Legenda / Rótulo</label>
                <input type="text" [(ngModel)]="stat.label" placeholder="ex: Empresas activas" class="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm outline-none">
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- TAB 3: FEATURES SECTION -->
      <div *ngIf="activeTab === 'features'" class="bg-white rounded-3xl border border-gray-100 p-8 shadow-sm space-y-6">
        <div class="flex items-center justify-between border-b border-gray-100 pb-4">
          <div>
            <h3 class="text-xl font-bold text-gray-900">Funcionalidades do Produto</h3>
            <p class="text-sm text-gray-500">Adicione, edite ou altere ícones e descrições dos recursos da plataforma.</p>
          </div>
          <div class="flex gap-2">
            <button (click)="addFeature()" class="bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold px-4 py-2.5 rounded-xl text-sm transition-all">
              + Nova Funcionalidade
            </button>
            <button (click)="saveFeatures()" [disabled]="saving" class="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-2.5 rounded-xl text-sm transition-all shadow-sm disabled:opacity-50">
              {{ saving ? 'A guardar...' : 'Guardar Alterações' }}
            </button>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div *ngFor="let feat of featuresForm; let i = index" class="p-6 bg-gray-50 border border-gray-200 rounded-2xl space-y-4">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="w-8 h-8 rounded-xl flex items-center justify-center text-white text-xs font-bold" [style.backgroundColor]="feat.color">
                  <i class="fas" [ngClass]="feat.faIcon"></i>
                </span>
                <span class="text-sm font-bold text-gray-800">{{ feat.title || 'Nova Funcionalidade' }}</span>
              </div>
              <button (click)="removeFeature(i)" class="text-red-500 hover:bg-red-50 p-1.5 rounded-lg text-xs font-bold">
                Eliminar
              </button>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Ícone (FontAwesome)</label>
                <input type="text" [(ngModel)]="feat.faIcon" placeholder="fa-bolt" class="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm font-mono outline-none">
              </div>
              <div>
                <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Cor do Ícone</label>
                <input type="color" [(ngModel)]="feat.color" (change)="updateFeatureBg(feat)" class="w-full h-9 p-1 bg-white border border-gray-200 rounded-xl cursor-pointer">
              </div>
            </div>

            <div>
              <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Título da Funcionalidade</label>
              <input type="text" [(ngModel)]="feat.title" class="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm font-semibold outline-none">
            </div>

            <div>
              <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Descrição</label>
              <textarea [(ngModel)]="feat.description" rows="2" class="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm outline-none"></textarea>
            </div>
          </div>
        </div>
      </div>

      <!-- TAB 4: VALUES SECTION -->
      <div *ngIf="activeTab === 'values'" class="bg-white rounded-3xl border border-gray-100 p-8 shadow-sm space-y-6">
        <div class="flex items-center justify-between border-b border-gray-100 pb-4">
          <div>
            <h3 class="text-xl font-bold text-gray-900">Missão, Visão e Valores</h3>
            <p class="text-sm text-gray-500">Configure os pilares institucionais apresentados na secção Sobre Nós.</p>
          </div>
          <div class="flex gap-2">
            <button (click)="addValue()" class="bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold px-4 py-2.5 rounded-xl text-sm transition-all">
              + Adicionar Pilar
            </button>
            <button (click)="saveValues()" [disabled]="saving" class="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-2.5 rounded-xl text-sm transition-all shadow-sm disabled:opacity-50">
              {{ saving ? 'A guardar...' : 'Guardar Alterações' }}
            </button>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div *ngFor="let val of valuesForm; let i = index" class="p-6 bg-gray-50 border border-gray-200 rounded-2xl space-y-4">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-gray-400 uppercase">Pilar #{{ i + 1 }}</span>
              <button (click)="removeValue(i)" class="text-red-500 hover:bg-red-50 p-1.5 rounded-lg text-xs font-bold">
                Remover
              </button>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Ícone</label>
                <input type="text" [(ngModel)]="val.icon" placeholder="fa-bullseye" class="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm font-mono outline-none">
              </div>
              <div>
                <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Cor</label>
                <input type="color" [(ngModel)]="val.color" (change)="updateValueBg(val)" class="w-full h-9 p-1 bg-white border border-gray-200 rounded-xl cursor-pointer">
              </div>
            </div>

            <div>
              <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Título</label>
              <input type="text" [(ngModel)]="val.title" class="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm font-bold outline-none">
            </div>

            <div>
              <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Descrição</label>
              <textarea [(ngModel)]="val.desc" rows="3" class="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm outline-none"></textarea>
            </div>
          </div>
        </div>
      </div>

      <!-- TAB 5: FAQS SECTION -->
      <div *ngIf="activeTab === 'faqs'" class="bg-white rounded-3xl border border-gray-100 p-8 shadow-sm space-y-6">
        <div class="flex items-center justify-between border-b border-gray-100 pb-4">
          <div>
            <h3 class="text-xl font-bold text-gray-900">Perguntas Frequentes (FAQs)</h3>
            <p class="text-sm text-gray-500">Gerencie as dúvidas mais comuns dos visitantes do site.</p>
          </div>
          <div class="flex gap-2">
            <button (click)="addFaq()" class="bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold px-4 py-2.5 rounded-xl text-sm transition-all">
              + Nova Pergunta
            </button>
            <button (click)="saveFaqs()" [disabled]="saving" class="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-2.5 rounded-xl text-sm transition-all shadow-sm disabled:opacity-50">
              {{ saving ? 'A guardar...' : 'Guardar Alterações' }}
            </button>
          </div>
        </div>

        <div class="space-y-4">
          <div *ngFor="let faq of faqsForm; let i = index" class="p-5 bg-gray-50 border border-gray-200 rounded-2xl space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-gray-400 uppercase">Pergunta #{{ i + 1 }}</span>
              <div class="flex gap-2">
                <button (click)="moveFaqUp(i)" [disabled]="i === 0" class="text-gray-500 hover:bg-gray-200 px-2 py-1 rounded text-xs disabled:opacity-30">▲ Cima</button>
                <button (click)="moveFaqDown(i)" [disabled]="i === faqsForm.length - 1" class="text-gray-500 hover:bg-gray-200 px-2 py-1 rounded text-xs disabled:opacity-30">▼ Baixo</button>
                <button (click)="removeFaq(i)" class="text-red-500 hover:bg-red-50 px-2 py-1 rounded text-xs font-bold">Eliminar</button>
              </div>
            </div>

            <div>
              <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Pergunta</label>
              <input type="text" [(ngModel)]="faq.question" class="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-semibold outline-none">
            </div>

            <div>
              <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Resposta</label>
              <textarea [(ngModel)]="faq.answer" rows="2" class="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm outline-none"></textarea>
            </div>
          </div>
        </div>
      </div>

      <!-- TAB 6: CONTACT SECTION -->
      <div *ngIf="activeTab === 'contact'" class="bg-white rounded-3xl border border-gray-100 p-8 shadow-sm space-y-6">
        <div class="flex items-center justify-between border-b border-gray-100 pb-4">
          <div>
            <h3 class="text-xl font-bold text-gray-900">Contactos & Suporte</h3>
            <p class="text-sm text-gray-500">Altere informações de contacto, emails e dados do rodapé.</p>
          </div>
          <button (click)="saveContact()" [disabled]="saving" class="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-2.5 rounded-xl text-sm transition-all shadow-sm disabled:opacity-50">
            {{ saving ? 'A guardar...' : 'Guardar Alterações' }}
          </button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Email de Suporte</label>
            <input type="email" [(ngModel)]="contactForm.email" class="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none">
          </div>

          <div>
            <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Telefone Principal</label>
            <input type="text" [(ngModel)]="contactForm.phone" class="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none">
          </div>

          <div>
            <label class="block text-xs font-bold text-gray-600 uppercase mb-1">WhatsApp</label>
            <input type="text" [(ngModel)]="contactForm.whatsapp" class="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none">
          </div>

          <div>
            <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Horário de Atendimento</label>
            <input type="text" [(ngModel)]="contactForm.workHours" class="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none">
          </div>

          <div class="md:col-span-2">
            <label class="block text-xs font-bold text-gray-600 uppercase mb-1">Endereço Físico</label>
            <input type="text" [(ngModel)]="contactForm.address" class="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none">
          </div>
        </div>
      </div>
      </ng-container>
    </div>
  `
})
export class AdminLandingCmsComponent implements OnInit {
  activeTab: 'hero' | 'stats' | 'features' | 'values' | 'faqs' | 'contact' = 'hero';
  message = '';
  error = '';
  saving = false;
  loaded = false;

  heroForm!: HeroContent;
  statsForm: StatContent[] = [];
  featuresForm: FeatureContent[] = [];
  valuesForm: ValueContent[] = [];
  faqsForm: FaqContent[] = [];
  contactForm!: ContactContent;

  constructor(public cmsService: LandingCmsService) {}

  async ngOnInit() {
    await this.cmsService.loadAllContent();
    this.populateForms();
    this.loaded = true;
  }

  populateForms() {
    this.heroForm = { ...this.cmsService.hero() };
    this.statsForm = this.cmsService.stats().map(s => ({ ...s }));
    this.featuresForm = this.cmsService.features().map(f => ({ ...f }));
    this.valuesForm = this.cmsService.values().map(v => ({ ...v }));
    this.faqsForm = this.cmsService.faqs().map(f => ({ ...f }));
    this.contactForm = { ...this.cmsService.contact() };
  }

  // --- Hero Section ---
  async saveHero() {
    this.saving = true;
    const ok = await this.cmsService.updateSectionContent('hero', this.heroForm);
    this.saving = false;
    if (ok) this.showSuccess('Secção Hero atualizada com sucesso!');
    else this.showError('Erro ao guardar secção Hero.');
  }

  // --- Stats Section ---
  addStat() {
    this.statsForm.push({ value: '100+', label: 'Novo Indicador' });
  }

  removeStat(index: number) {
    this.statsForm.splice(index, 1);
  }

  async saveStats() {
    this.saving = true;
    const ok = await this.cmsService.updateSectionContent('stats', this.statsForm);
    this.saving = false;
    if (ok) this.showSuccess('Métricas atualizadas com sucesso!');
    else this.showError('Erro ao guardar métricas.');
  }

  // --- Features Section ---
  addFeature() {
    this.featuresForm.push({
      faIcon: 'fa-star',
      title: 'Nova Funcionalidade',
      description: 'Descrição da funcionalidade.',
      color: '#3b82f6',
      bgColor: 'rgba(59, 130, 246, 0.1)'
    });
  }

  removeFeature(index: number) {
    this.featuresForm.splice(index, 1);
  }

  updateFeatureBg(feat: FeatureContent) {
    if (feat.color.startsWith('#')) {
      const hex = feat.color.replace('#', '');
      const r = parseInt(hex.substring(0, 2), 16) || 0;
      const g = parseInt(hex.substring(2, 4), 16) || 0;
      const b = parseInt(hex.substring(4, 6), 16) || 0;
      feat.bgColor = `rgba(${r}, ${g}, ${b}, 0.1)`;
    }
  }

  async saveFeatures() {
    this.saving = true;
    const ok = await this.cmsService.updateSectionContent('features', this.featuresForm);
    this.saving = false;
    if (ok) this.showSuccess('Funcionalidades atualizadas com sucesso!');
    else this.showError('Erro ao guardar funcionalidades.');
  }

  // --- Values Section ---
  addValue() {
    this.valuesForm.push({
      icon: 'fa-star',
      title: 'Novo Pilar',
      desc: 'Descrição do pilar.',
      color: '#10b981',
      bg: 'rgba(16, 185, 129, 0.1)'
    });
  }

  removeValue(index: number) {
    this.valuesForm.splice(index, 1);
  }

  updateValueBg(val: ValueContent) {
    if (val.color.startsWith('#')) {
      const hex = val.color.replace('#', '');
      const r = parseInt(hex.substring(0, 2), 16) || 0;
      const g = parseInt(hex.substring(2, 4), 16) || 0;
      const b = parseInt(hex.substring(4, 6), 16) || 0;
      val.bg = `rgba(${r}, ${g}, ${b}, 0.1)`;
    }
  }

  async saveValues() {
    this.saving = true;
    const ok = await this.cmsService.updateSectionContent('values', this.valuesForm);
    this.saving = false;
    if (ok) this.showSuccess('Visão e Valores atualizados com sucesso!');
    else this.showError('Erro ao guardar Visão e Valores.');
  }

  // --- FAQs Section ---
  addFaq() {
    this.faqsForm.push({
      question: 'Nova pergunta frequente?',
      answer: 'Resposta detalhada aqui.'
    });
  }

  removeFaq(index: number) {
    this.faqsForm.splice(index, 1);
  }

  moveFaqUp(index: number) {
    if (index > 0) {
      const temp = this.faqsForm[index];
      this.faqsForm[index] = this.faqsForm[index - 1];
      this.faqsForm[index - 1] = temp;
    }
  }

  moveFaqDown(index: number) {
    if (index < this.faqsForm.length - 1) {
      const temp = this.faqsForm[index];
      this.faqsForm[index] = this.faqsForm[index + 1];
      this.faqsForm[index + 1] = temp;
    }
  }

  async saveFaqs() {
    this.saving = true;
    const ok = await this.cmsService.updateSectionContent('faqs', this.faqsForm);
    this.saving = false;
    if (ok) this.showSuccess('FAQs atualizadas com sucesso!');
    else this.showError('Erro ao guardar FAQs.');
  }

  // --- Contact Section ---
  async saveContact() {
    this.saving = true;
    const ok = await this.cmsService.updateSectionContent('contact', this.contactForm);
    this.saving = false;
    if (ok) this.showSuccess('Contactos atualizados com sucesso!');
    else this.showError('Erro ao guardar contactos.');
  }

  private showSuccess(msg: string) {
    this.message = msg;
    this.error = '';
    setTimeout(() => { this.message = ''; }, 4000);
  }

  private showError(msg: string) {
    this.error = msg;
    this.message = '';
    setTimeout(() => { this.error = ''; }, 4000);
  }
}
