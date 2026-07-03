import { Component, ElementRef, ViewChild, AfterViewChecked, effect, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ChatbotService } from '../../core/services/chatbot.service';
import { AiActionsService } from '../../core/services/ai-actions.service';
import { CompanyService } from '../../core/services/company.service';

@Component({
  selector: 'app-ai-assistant',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule
  ],
  template: `
    <div class="ai-assistant-container">
      <!-- Left Sidebar: Chat History/Recent Actions -->
      <aside class="ai-sidebar hidden md:flex">
        <div class="ai-sidebar-inner">
          <!-- Header -->
          <div class="ai-sidebar-header">
            <div class="ai-brain-icon">
              <mat-icon>auto_awesome</mat-icon>
            </div>
            <div>
              <h2 class="ai-sidebar-title">Assistente IA</h2>
              <p class="ai-sidebar-subtitle">ISPC Fácil</p>
            </div>
          </div>

          <!-- New Chat -->
          <button class="ai-new-chat-btn" (click)="newChat()">
            <mat-icon>add</mat-icon>
            <span>Nova Conversa</span>
          </button>

          <!-- Quick Actions -->
          <div class="ai-quick-section">
            <p class="ai-section-label">ACÇÕES RÁPIDAS</p>
            <button class="ai-quick-action" *ngFor="let qa of quickActions" (click)="sendQuickAction(qa.prompt)">
              <mat-icon class="ai-quick-icon">{{ qa.icon }}</mat-icon>
              <span>{{ qa.label }}</span>
            </button>
          </div>

          <!-- Sector Catalogue -->
          <div class="ai-quick-section">
            <p class="ai-section-label">CATÁLOGOS POR SECTOR</p>
            <button class="ai-quick-action" *ngFor="let s of sectors" (click)="sendQuickAction(s.prompt)">
              <span class="ai-sector-emoji">{{ s.emoji }}</span>
              <span>{{ s.label }}</span>
            </button>
          </div>

          <!-- Back to Dashboard -->
          <div class="ai-sidebar-footer">
            <a routerLink="/painel" class="ai-back-btn">
              <mat-icon>arrow_back</mat-icon>
              <span>Voltar ao Painel</span>
            </a>
          </div>
        </div>
      </aside>

      <!-- Main Chat Area -->
      <main class="ai-main">
        <!-- Top Bar -->
        <header class="ai-topbar">
          <div class="ai-topbar-left">
            <!-- Mobile back -->
            <a routerLink="/painel" class="ai-mobile-back md:hidden">
              <mat-icon>arrow_back</mat-icon>
            </a>
            <div class="ai-status-dot"></div>
            <div>
              <h1 class="ai-topbar-title">Assistente ISPC Fácil</h1>
              <p class="ai-topbar-sub">
                @if (companyService.activeCompany()) {
                  {{ companyService.activeCompany()?.name }}
                } @else {
                  Pronto para ajudar
                }
              </p>
            </div>
          </div>
          <div class="ai-topbar-right">
            <button mat-icon-button matTooltip="Limpar conversa" (click)="clearChat()" class="ai-icon-btn">
              <mat-icon>delete_outline</mat-icon>
            </button>
            <a routerLink="/designer-de-facturas" mat-stroked-button class="ai-designer-btn hidden md:flex">
              <mat-icon>palette</mat-icon>
              Designer de Facturas
            </a>
            <a routerLink="/insights-ia" mat-stroked-button class="ai-insights-btn hidden md:flex">
              <mat-icon>insights</mat-icon>
              Insights IA
            </a>
          </div>
        </header>

        <!-- Messages Area -->
        <div class="ai-messages-area" #scrollContainer>
          @if (chatbotService.messages().length === 0) {
            <!-- Empty state -->
            <div class="ai-empty-state">
              <div class="ai-empty-icon">
                <mat-icon>auto_awesome</mat-icon>
              </div>
              <h2>Como posso ajudar?</h2>
              <p>Sou a sua IA de faturação. Posso criar produtos, clientes, facturas e muito mais — só precisa de me dizer o que quer.</p>
              <div class="ai-empty-suggestions">
                @for (s of emptySuggestions; track s.label) {
                  <button class="ai-empty-card" (click)="sendQuickAction(s.prompt)">
                    <mat-icon>{{ s.icon }}</mat-icon>
                    <div>
                      <p class="ai-empty-card-title">{{ s.label }}</p>
                      <p class="ai-empty-card-sub">{{ s.sub }}</p>
                    </div>
                  </button>
                }
              </div>
            </div>
          }

          @for (msg of chatbotService.messages(); track msg.id) {
            <!-- User message -->
            @if (msg.role === 'user') {
              <div class="ai-msg ai-msg-user">
                <div class="ai-msg-bubble ai-msg-bubble-user">
                  <p>{{ msg.content }}</p>
                </div>
                <div class="ai-msg-avatar ai-msg-avatar-user">
                  <mat-icon>person</mat-icon>
                </div>
              </div>
            }

            <!-- Assistant message -->
            @if (msg.role === 'assistant') {
              <div class="ai-msg ai-msg-assistant">
                <div class="ai-msg-avatar ai-msg-avatar-ai">
                  <mat-icon>auto_awesome</mat-icon>
                </div>
                <div class="ai-msg-content">
                  <div class="ai-msg-bubble ai-msg-bubble-ai" [innerHTML]="sanitizeAndFormat(msg.content)"></div>

                  <!-- Actions preview (if any) -->
                  @if (msg.actions && msg.actions.length > 0) {
                    <div class="ai-actions-preview">
                      @for (action of msg.actions; track action.type) {
                        <div class="ai-action-chip">
                          <mat-icon class="ai-action-chip-icon">
                            {{ action.type === 'CREATE_PRODUCTS' ? 'inventory_2' :
                               action.type === 'CREATE_CLIENTS' ? 'person_add' :
                               action.type === 'NAVIGATE' ? 'open_in_new' : 'bolt' }}
                          </mat-icon>
                          <span>{{ action.label }}</span>
                          @if (action.status === 'done') {
                            <mat-icon class="ai-action-chip-done">check_circle</mat-icon>
                          }
                          @if (action.status === 'error') {
                            <mat-icon class="ai-action-chip-error">error</mat-icon>
                          }
                        </div>
                      }
                    </div>
                  }

                  <!-- Suggestions -->
                  @if (msg.suggestions && msg.suggestions.length > 0) {
                    <div class="ai-suggestions">
                      @for (s of msg.suggestions; track s) {
                        <button class="ai-suggestion-chip" (click)="sendMessage(s)">
                          {{ s }}
                        </button>
                      }
                    </div>
                  }
                </div>
              </div>
            }
          }

          <!-- Loading indicator -->
          @if (chatbotService.isLoading()) {
            <div class="ai-msg ai-msg-assistant">
              <div class="ai-msg-avatar ai-msg-avatar-ai">
                <mat-icon>auto_awesome</mat-icon>
              </div>
              <div class="ai-thinking">
                <span class="ai-thinking-dot"></span>
                <span class="ai-thinking-dot"></span>
                <span class="ai-thinking-dot"></span>
              </div>
            </div>
          }
        </div>

        <!-- Input Area -->
        <div class="ai-input-area">
          <div class="ai-input-container">
            <!-- File upload hint -->
            <div class="ai-input-wrapper">
              <textarea
                #chatInput
                class="ai-textarea"
                [(ngModel)]="userText"
                placeholder="Diga o que quer fazer... ex: &quot;Cria produtos de electrónica&quot;"
                rows="1"
                (keydown.enter)="onEnterKey($event)"
                (input)="adjustInputHeight()"
              ></textarea>
              <button
                class="ai-send-btn"
                [class.ai-send-btn-active]="userText.trim()"
                [disabled]="!userText.trim() || chatbotService.isLoading()"
                (click)="sendMessage(userText)"
              >
                <mat-icon>send</mat-icon>
              </button>
            </div>
            <p class="ai-input-hint">Enter para enviar · Shift+Enter para nova linha</p>
          </div>
        </div>
      </main>
    </div>
  `,
  styles: [`
    .ai-assistant-container {
      display: flex;
      height: 100vh;
      width: 100%;
      background: linear-gradient(135deg, #0f0f1a 0%, #1a0a2e 50%, #0d1b2a 100%);
      overflow: hidden;
    }

    /* ── Sidebar ── */
    .ai-sidebar {
      width: 280px;
      flex-shrink: 0;
      border-right: 1px solid rgba(255,255,255,0.08);
      overflow-y: auto;
    }
    .ai-sidebar-inner {
      display: flex;
      flex-direction: column;
      height: 100%;
      padding: 20px 16px;
      gap: 8px;
    }
    .ai-sidebar-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 4px 16px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      margin-bottom: 8px;
    }
    .ai-brain-icon {
      width: 42px; height: 42px;
      border-radius: 12px;
      background: linear-gradient(135deg, #f97316, #fb923c);
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 12px rgba(249,115,22,0.4);
    }
    .ai-brain-icon mat-icon { color: white; font-size: 22px; }
    .ai-sidebar-title { color: white; font-size: 16px; font-weight: 700; margin: 0; }
    .ai-sidebar-subtitle { color: rgba(255,255,255,0.4); font-size: 11px; margin: 0; }

    .ai-new-chat-btn {
      display: flex; align-items: center; gap: 10px;
      width: 100%; padding: 11px 16px;
      border: 1px dashed rgba(249,115,22,0.4);
      border-radius: 12px;
      background: rgba(249,115,22,0.06);
      color: #fb923c; font-size: 13px; font-weight: 600;
      cursor: pointer; transition: all 0.2s;
      margin-bottom: 8px;
    }
    .ai-new-chat-btn:hover { background: rgba(249,115,22,0.12); border-color: rgba(249,115,22,0.6); }
    .ai-new-chat-btn mat-icon { font-size: 18px; }

    .ai-quick-section { margin-top: 12px; }
    .ai-section-label {
      color: rgba(255,255,255,0.3); font-size: 10px; font-weight: 700;
      letter-spacing: 0.1em; padding: 0 8px; margin-bottom: 6px;
    }
    .ai-quick-action {
      display: flex; align-items: center; gap: 10px;
      width: 100%; padding: 9px 12px;
      border: none; border-radius: 10px;
      background: transparent;
      color: rgba(255,255,255,0.65); font-size: 12px; text-align: left;
      cursor: pointer; transition: all 0.15s;
    }
    .ai-quick-action:hover { background: rgba(255,255,255,0.07); color: white; }
    .ai-quick-icon { font-size: 16px; color: rgba(249,115,22,0.7); }
    .ai-sector-emoji { font-size: 15px; }

    .ai-sidebar-footer { margin-top: auto; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.08); }
    .ai-back-btn {
      display: flex; align-items: center; gap: 8px;
      color: rgba(255,255,255,0.4); font-size: 12px;
      text-decoration: none; padding: 8px 12px; border-radius: 8px;
      transition: all 0.15s;
    }
    .ai-back-btn:hover { background: rgba(255,255,255,0.07); color: rgba(255,255,255,0.7); }
    .ai-back-btn mat-icon { font-size: 16px; }

    /* ── Main Chat ── */
    .ai-main {
      flex: 1; display: flex; flex-direction: column; overflow: hidden;
    }

    /* Top Bar */
    .ai-topbar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 16px 24px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.02);
      backdrop-filter: blur(10px);
    }
    .ai-topbar-left { display: flex; align-items: center; gap: 12px; }
    .ai-status-dot {
      width: 10px; height: 10px; border-radius: 50%;
      background: #22c55e;
      box-shadow: 0 0 8px #22c55e;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { box-shadow: 0 0 6px #22c55e; }
      50% { box-shadow: 0 0 14px #22c55e; }
    }
    .ai-topbar-title { color: white; font-size: 16px; font-weight: 700; margin: 0; }
    .ai-topbar-sub { color: rgba(255,255,255,0.4); font-size: 12px; margin: 0; }
    .ai-topbar-right { display: flex; align-items: center; gap: 10px; }
    .ai-icon-btn { color: rgba(255,255,255,0.5) !important; }
    .ai-icon-btn:hover { color: white !important; }
    .ai-designer-btn, .ai-insights-btn {
      color: rgba(255,255,255,0.6) !important;
      border-color: rgba(255,255,255,0.15) !important;
      font-size: 12px; gap: 4px;
      display: flex; align-items: center;
    }
    .ai-designer-btn mat-icon, .ai-insights-btn mat-icon { font-size: 16px; }
    .ai-mobile-back { color: rgba(255,255,255,0.6); }

    /* Messages */
    .ai-messages-area {
      flex: 1; overflow-y: auto;
      padding: 24px;
      display: flex; flex-direction: column; gap: 20px;
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.1) transparent;
    }

    /* Empty State */
    .ai-empty-state {
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; text-align: center;
      flex: 1; padding: 40px 20px; gap: 16px;
      margin: auto;
    }
    .ai-empty-icon {
      width: 72px; height: 72px; border-radius: 22px;
      background: linear-gradient(135deg, rgba(249,115,22,0.2), rgba(251,146,60,0.1));
      border: 1px solid rgba(249,115,22,0.3);
      display: flex; align-items: center; justify-content: center;
      margin-bottom: 8px;
    }
    .ai-empty-icon mat-icon { font-size: 36px; color: #f97316; }
    .ai-empty-state h2 { color: white; font-size: 24px; font-weight: 700; margin: 0; }
    .ai-empty-state > p { color: rgba(255,255,255,0.5); max-width: 480px; line-height: 1.6; margin: 0; }
    .ai-empty-suggestions {
      display: grid; grid-template-columns: repeat(2, 1fr);
      gap: 12px; margin-top: 16px; max-width: 600px;
    }
    .ai-empty-card {
      display: flex; align-items: flex-start; gap: 12px;
      text-align: left; padding: 16px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 14px; cursor: pointer;
      transition: all 0.2s; color: white;
    }
    .ai-empty-card:hover { background: rgba(255,255,255,0.08); border-color: rgba(249,115,22,0.3); }
    .ai-empty-card mat-icon { color: #f97316; font-size: 22px; margin-top: 2px; flex-shrink: 0; }
    .ai-empty-card-title { font-size: 13px; font-weight: 600; margin: 0 0 4px; color: white; }
    .ai-empty-card-sub { font-size: 11px; color: rgba(255,255,255,0.4); margin: 0; }

    /* Messages */
    .ai-msg { display: flex; align-items: flex-start; gap: 12px; }
    .ai-msg-user { flex-direction: row-reverse; }
    .ai-msg-assistant { flex-direction: row; }

    .ai-msg-avatar {
      width: 34px; height: 34px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .ai-msg-avatar mat-icon { font-size: 18px; }
    .ai-msg-avatar-ai {
      background: linear-gradient(135deg, #f97316, #fb923c);
      box-shadow: 0 2px 8px rgba(249,115,22,0.4);
    }
    .ai-msg-avatar-ai mat-icon { color: white; }
    .ai-msg-avatar-user { background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.15); }
    .ai-msg-avatar-user mat-icon { color: rgba(255,255,255,0.6); }

    .ai-msg-content { display: flex; flex-direction: column; gap: 8px; max-width: calc(100% - 50px); }
    .ai-msg-bubble {
      padding: 12px 16px; border-radius: 16px; font-size: 14px; line-height: 1.6;
    }
    .ai-msg-bubble-user {
      background: linear-gradient(135deg, #f97316, #ea580c);
      color: white; border-bottom-right-radius: 4px;
      max-width: 70%;
    }
    .ai-msg-bubble-ai {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      color: rgba(255,255,255,0.88);
      border-bottom-left-radius: 4px;
    }
    .ai-msg-bubble-ai ::ng-deep strong { color: white; }
    .ai-msg-bubble-ai ::ng-deep ul { padding-left: 20px; }
    .ai-msg-bubble-ai ::ng-deep li { margin-bottom: 4px; }
    .ai-msg-bubble-ai ::ng-deep code {
      background: rgba(249,115,22,0.15); border-radius: 4px;
      padding: 1px 6px; font-size: 12px; color: #fb923c;
    }
    .ai-msg-bubble-ai ::ng-deep h1, .ai-msg-bubble-ai ::ng-deep h2 {
      color: white; margin: 12px 0 6px;
    }

    /* Actions Preview */
    .ai-actions-preview {
      display: flex; flex-wrap: wrap; gap: 6px;
    }
    .ai-action-chip {
      display: flex; align-items: center; gap: 6px;
      padding: 6px 12px; border-radius: 20px;
      background: rgba(249,115,22,0.12);
      border: 1px solid rgba(249,115,22,0.25);
      color: #fb923c; font-size: 12px; font-weight: 500;
    }
    .ai-action-chip-icon { font-size: 15px; }
    .ai-action-chip-done { font-size: 15px; color: #22c55e; }
    .ai-action-chip-error { font-size: 15px; color: #ef4444; }

    /* Suggestions */
    .ai-suggestions { display: flex; flex-wrap: wrap; gap: 8px; }
    .ai-suggestion-chip {
      padding: 7px 14px; border-radius: 20px;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.12);
      color: rgba(255,255,255,0.65); font-size: 12px;
      cursor: pointer; transition: all 0.15s;
    }
    .ai-suggestion-chip:hover { background: rgba(255,255,255,0.1); color: white; border-color: rgba(249,115,22,0.4); }

    /* Thinking dots */
    .ai-thinking {
      display: flex; align-items: center; gap: 6px;
      padding: 16px 20px;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px; border-bottom-left-radius: 4px;
    }
    .ai-thinking-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #f97316; animation: bounce 1.2s infinite;
    }
    .ai-thinking-dot:nth-child(2) { animation-delay: 0.2s; }
    .ai-thinking-dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes bounce {
      0%, 60%, 100% { transform: translateY(0); opacity: 0.6; }
      30% { transform: translateY(-8px); opacity: 1; }
    }

    /* Input Area */
    .ai-input-area {
      padding: 16px 24px 24px;
      border-top: 1px solid rgba(255,255,255,0.06);
      background: rgba(0,0,0,0.2);
    }
    .ai-input-container { max-width: 900px; margin: 0 auto; }
    .ai-input-wrapper {
      display: flex; align-items: flex-end; gap: 12px;
      background: rgba(255,255,255,0.07);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 18px; padding: 12px 12px 12px 20px;
      transition: border-color 0.2s;
    }
    .ai-input-wrapper:focus-within { border-color: rgba(249,115,22,0.5); }
    .ai-textarea {
      flex: 1; background: transparent; border: none; outline: none;
      color: white; font-size: 14px; line-height: 1.5;
      resize: none; max-height: 150px; min-height: 24px;
      font-family: inherit;
    }
    .ai-textarea::placeholder { color: rgba(255,255,255,0.3); }
    .ai-send-btn {
      width: 40px; height: 40px; border-radius: 12px;
      border: none; background: rgba(255,255,255,0.1);
      color: rgba(255,255,255,0.3); cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: all 0.2s; flex-shrink: 0;
    }
    .ai-send-btn-active {
      background: linear-gradient(135deg, #f97316, #ea580c);
      color: white !important;
      box-shadow: 0 2px 12px rgba(249,115,22,0.5);
    }
    .ai-send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .ai-input-hint { color: rgba(255,255,255,0.2); font-size: 11px; text-align: center; margin-top: 8px; }
  `]
})
export class AiAssistantComponent implements AfterViewChecked, OnInit {
  @ViewChild('scrollContainer') private scrollContainer!: ElementRef;
  @ViewChild('chatInput') private chatInput!: ElementRef;

  userText = '';
  private shouldScroll = false;

  quickActions = [
    { icon: 'inventory_2', label: 'Criar catálogo de produtos', prompt: 'Quero criar o catálogo de produtos para a minha empresa' },
    { icon: 'person_add', label: 'Adicionar clientes de teste', prompt: 'Cria 5 clientes de teste com dados realistas moçambicanos' },
    { icon: 'receipt_long', label: 'Criar factura de exemplo', prompt: 'Explica-me como criar uma factura passo a passo' },
    { icon: 'account_balance', label: 'Calcular ISPC', prompt: 'Calcula o ISPC estimado para este trimestre' },
    { icon: 'insights', label: 'Analisar vendas', prompt: 'Faz uma análise das minhas vendas e fluxo de caixa' },
  ];

  sectors = [
    { emoji: '💻', label: 'Electrónica & TI', prompt: 'Tenho uma empresa de venda de material electrónico e informático em Moçambique. Cria os produtos e serviços mais comuns nessa área com preços reais.' },
    { emoji: '🏗️', label: 'Construção Civil', prompt: 'Tenho uma empresa de construção civil em Moçambique. Cria os materiais e serviços mais vendidos nessa área.' },
    { emoji: '🍽️', label: 'Alimentação', prompt: 'Tenho uma empresa de venda de produtos alimentares em Moçambique. Cria o catálogo de produtos mais comuns.' },
    { emoji: '🚗', label: 'Transportes', prompt: 'Tenho uma empresa de transportes e logística em Moçambique. Cria os serviços típicos desse sector.' },
    { emoji: '💊', label: 'Saúde & Farmácia', prompt: 'Tenho uma clínica/farmácia em Moçambique. Cria os serviços e produtos mais comuns.' },
    { emoji: '📚', label: 'Educação', prompt: 'Tenho uma escola/centro de formação em Moçambique. Cria os serviços educacionais típicos.' },
    { emoji: '✂️', label: 'Beleza & Estética', prompt: 'Tenho um salão de beleza em Moçambique. Cria os serviços mais comuns nessa área.' },
    { emoji: '🏨', label: 'Hotelaria', prompt: 'Tenho um hotel/restaurante em Moçambique. Cria os serviços e produtos típicos.' },
  ];

  emptySuggestions = [
    { icon: 'inventory_2', label: 'Criar catálogo por sector', sub: 'Ex: electrónica, construção, alimentação', prompt: 'Tenho uma empresa de venda de material electrónico. Cria o meu catálogo.' },
    { icon: 'person_add', label: 'Adicionar clientes', sub: 'Cria clientes de teste ou reais', prompt: 'Cria 5 clientes de teste com nomes e contactos moçambicanos realistas' },
    { icon: 'account_balance', label: 'Calcular obrigações fiscais', sub: 'ISPC, IVA, prazos e simulações', prompt: 'Como funciona o ISPC progressivo e quanto devo pagar?' },
    { icon: 'insights', label: 'Analisar o meu negócio', sub: 'Insights, tendências e alertas', prompt: 'Faz uma análise financeira do meu negócio e dá-me sugestões' },
  ];

  constructor(
    public chatbotService: ChatbotService,
    public companyService: CompanyService,
    private aiActionsService: AiActionsService,
    private sanitizer: DomSanitizer
  ) {
    effect(() => {
      const msgs = this.chatbotService.messages();
      if (msgs.length > 0) this.shouldScroll = true;
    });

    effect(() => {
      const actions = this.chatbotService.pendingActions();
      if (actions.length > 0) {
        this.aiActionsService.setPendingActions(actions as any);
      }
    });
  }

  ngOnInit() {
    this.chatbotService.currentPageContext.set('assistente');
    if (this.chatbotService.messages().length === 0) {
      this.chatbotService.sendWelcomeMessage();
    }
  }

  ngAfterViewChecked() {
    if (this.shouldScroll) {
      this.scrollToBottom();
      this.shouldScroll = false;
    }
  }

  sendMessage(text: string) {
    if (!text.trim()) return;
    this.chatbotService.sendMessage(text);
    this.userText = '';
    setTimeout(() => this.adjustInputHeight(), 0);
  }

  sendQuickAction(prompt: string) {
    this.sendMessage(prompt);
  }

  newChat() {
    this.chatbotService.clearChat();
  }

  clearChat() {
    if (confirm('Tem a certeza que deseja limpar o histórico?')) {
      this.chatbotService.clearChat();
    }
  }

  onEnterKey(event: Event) {
    const ke = event as KeyboardEvent;
    if (!ke.shiftKey) {
      ke.preventDefault();
      this.sendMessage(this.userText);
    }
  }

  adjustInputHeight() {
    if (this.chatInput?.nativeElement) {
      const el = this.chatInput.nativeElement;
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 150) + 'px';
    }
  }

  private scrollToBottom() {
    try {
      if (this.scrollContainer?.nativeElement) {
        const el = this.scrollContainer.nativeElement;
        el.scrollTop = el.scrollHeight;
      }
    } catch {}
  }

  sanitizeAndFormat(content: string): SafeHtml {
    if (!content) return '';
    let html = content
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

    // Headers
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Bold & italic
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Lists
    const lines = html.split('\n');
    let inList = false;
    let result = '';
    for (const line of lines) {
      const t = line.trim();
      if (t.startsWith('* ') || t.startsWith('- ')) {
        if (!inList) { result += '<ul>'; inList = true; }
        result += `<li>${t.substring(2)}</li>`;
      } else {
        if (inList) { result += '</ul>'; inList = false; }
        result += (result && t ? '<br>' : '') + t;
      }
    }
    if (inList) result += '</ul>';

    return this.sanitizer.bypassSecurityTrustHtml(result);
  }
}
