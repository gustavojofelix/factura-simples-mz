import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CompanyService } from '../../core/services/company.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

export interface InvoiceTheme {
  id: string;
  name: string;
  description: string;
  preview: string; // emoji or icon
  primaryColor: string;
  accentColor: string;
  bgColor: string;
  textColor: string;
  style: 'classic' | 'modern' | 'minimal' | 'corporate' | 'creative';
  tags: string[];
}

@Component({
  selector: 'app-invoice-designer',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    MatIconModule,
    MatButtonModule,
    MatSnackBarModule,
    MatTooltipModule
  ],
  template: `
    <div class="designer-page">
      <!-- Header -->
      <div class="designer-header">
        <div class="designer-header-left">
          <a routerLink="/painel" class="back-link">
            <mat-icon>arrow_back</mat-icon>
          </a>
          <div>
            <h1 class="designer-title">
              <span class="designer-title-gradient">Designer de Facturas</span>
            </h1>
            <p class="designer-subtitle">Escolha um tema e personalize com as suas cores e logotipo</p>
          </div>
        </div>
        <div class="designer-header-right">
          @if (activeThemeId()) {
            <button mat-raised-button class="save-btn" (click)="saveTheme()" [disabled]="saving()">
              <mat-icon>{{ saving() ? 'hourglass_empty' : 'save' }}</mat-icon>
              {{ saving() ? 'A guardar...' : 'Guardar Tema Activo' }}
            </button>
          }
        </div>
      </div>

      <div class="designer-body">
        <!-- Left Panel: Theme Selection + Customization -->
        <div class="designer-left">

          <!-- Theme Selector -->
          <div class="panel-section">
            <h2 class="panel-section-title">
              <mat-icon>style</mat-icon>
              Escolha um Tema
            </h2>
            <div class="themes-grid">
              @for (theme of themes; track theme.id) {
                <button
                  class="theme-card"
                  [class.theme-card-active]="activeThemeId() === theme.id"
                  (click)="selectTheme(theme)"
                >
                  <!-- Theme visual preview -->
                  <div class="theme-preview-mini" [style.background]="theme.bgColor">
                    <div class="theme-preview-header" [style.background]="theme.primaryColor">
                      <div class="theme-preview-logo" [style.background]="theme.accentColor"></div>
                      <div class="theme-preview-lines">
                        <div class="theme-preview-line" [style.background]="'rgba(255,255,255,0.7)'"></div>
                        <div class="theme-preview-line short" [style.background]="'rgba(255,255,255,0.4)'"></div>
                      </div>
                    </div>
                    <div class="theme-preview-body">
                      <div class="theme-preview-row" [style.background]="theme.accentColor + '22'"></div>
                      <div class="theme-preview-row" [style.background]="theme.accentColor + '11'"></div>
                      <div class="theme-preview-row" [style.background]="theme.accentColor + '22'"></div>
                      <div class="theme-preview-total" [style.background]="theme.primaryColor" [style.color]="'white'">TOTAL</div>
                    </div>
                  </div>
                  <div class="theme-card-info">
                    <span class="theme-card-name">{{ theme.name }}</span>
                    <span class="theme-card-desc">{{ theme.description }}</span>
                    <div class="theme-tags">
                      @for (tag of theme.tags; track tag) {
                        <span class="theme-tag">{{ tag }}</span>
                      }
                    </div>
                  </div>
                  @if (activeThemeId() === theme.id) {
                    <div class="theme-active-badge">
                      <mat-icon>check_circle</mat-icon>
                      Activo
                    </div>
                  }
                </button>
              }
            </div>
          </div>

          <!-- Customization Panel -->
          @if (selectedTheme()) {
            <div class="panel-section">
              <h2 class="panel-section-title">
                <mat-icon>tune</mat-icon>
                Personalizar Cores
              </h2>
              <div class="color-customizer">
                <div class="color-row">
                  <label class="color-label">
                    <mat-icon>palette</mat-icon>
                    Cor Principal
                  </label>
                  <div class="color-input-group">
                    <input
                      type="color"
                      class="color-picker"
                      [value]="customPrimary()"
                      (input)="updateCustomPrimary($event)"
                    />
                    <input
                      type="text"
                      class="color-text"
                      [value]="customPrimary()"
                      (input)="updateCustomPrimaryText($event)"
                      maxlength="7"
                    />
                  </div>
                </div>
                <div class="color-row">
                  <label class="color-label">
                    <mat-icon>colorize</mat-icon>
                    Cor de Destaque
                  </label>
                  <div class="color-input-group">
                    <input
                      type="color"
                      class="color-picker"
                      [value]="customAccent()"
                      (input)="updateCustomAccent($event)"
                    />
                    <input
                      type="text"
                      class="color-text"
                      [value]="customAccent()"
                      (input)="updateCustomAccentText($event)"
                      maxlength="7"
                    />
                  </div>
                </div>
                <div class="color-row">
                  <label class="color-label">
                    <mat-icon>format_color_fill</mat-icon>
                    Fundo do Cabeçalho
                  </label>
                  <div class="color-input-group">
                    <input
                      type="color"
                      class="color-picker"
                      [value]="customBg()"
                      (input)="updateCustomBg($event)"
                    />
                    <input
                      type="text"
                      class="color-text"
                      [value]="customBg()"
                      (input)="updateCustomBgText($event)"
                      maxlength="7"
                    />
                  </div>
                </div>

                <button class="reset-btn" (click)="resetColors()">
                  <mat-icon>refresh</mat-icon>
                  Repor cores do tema
                </button>
              </div>
            </div>

            <!-- Logo Upload -->
            <div class="panel-section">
              <h2 class="panel-section-title">
                <mat-icon>image</mat-icon>
                Logotipo da Empresa
              </h2>
              <div
                class="logo-dropzone"
                [class.logo-dropzone-has]="logoPreview()"
                (dragover)="onDragOver($event)"
                (dragleave)="onDragLeave($event)"
                (drop)="onDrop($event)"
                (click)="triggerLogoUpload()"
              >
                @if (logoPreview()) {
                  <div class="logo-preview-container">
                    <img [src]="logoPreview()" alt="Logotipo" class="logo-preview-img" />
                    <button class="logo-remove-btn" (click)="removeLogo($event)">
                      <mat-icon>close</mat-icon>
                    </button>
                  </div>
                } @else {
                  <div class="logo-placeholder">
                    <mat-icon>cloud_upload</mat-icon>
                    <p>Arraste o logotipo aqui</p>
                    <p class="logo-hint">ou clique para seleccionar · PNG, JPG, SVG</p>
                  </div>
                }
              </div>
              <input
                #logoInput
                type="file"
                accept="image/*"
                style="display:none"
                (change)="onLogoSelected($event)"
              />
            </div>
          }
        </div>

        <!-- Right Panel: Live Preview -->
        <div class="designer-right">
          <div class="preview-panel">
            <div class="preview-toolbar">
              <span class="preview-label">
                <mat-icon>visibility</mat-icon>
                Pré-visualização ao Vivo
              </span>
              @if (selectedTheme()) {
                <span class="preview-theme-name">{{ selectedTheme()?.name }}</span>
              }
            </div>

            @if (!selectedTheme()) {
              <div class="preview-empty">
                <mat-icon>touch_app</mat-icon>
                <p>Seleccione um tema para ver a pré-visualização</p>
              </div>
            } @else {
              <!-- Invoice Preview -->
              <div class="invoice-preview-wrapper">
                <div class="invoice-preview" [innerHTML]="invoicePreviewHtml()"></div>
              </div>
            }
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .designer-page {
      min-height: 100vh;
      background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
      padding: 24px;
    }

    /* Header */
    .designer-header {
      display: flex; align-items: flex-start; justify-content: space-between;
      margin-bottom: 28px; flex-wrap: wrap; gap: 16px;
    }
    .designer-header-left { display: flex; align-items: center; gap: 16px; }
    .back-link {
      color: #64748b; width: 40px; height: 40px;
      display: flex; align-items: center; justify-content: center;
      border-radius: 10px; transition: all 0.2s;
    }
    .back-link:hover { background: #e2e8f0; color: #1e293b; }
    .designer-title { font-size: 26px; font-weight: 800; margin: 0 0 4px; }
    .designer-title-gradient {
      background: linear-gradient(135deg, #f97316, #ea580c);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    }
    .designer-subtitle { color: #64748b; font-size: 14px; margin: 0; }
    .save-btn { background: linear-gradient(135deg, #f97316, #ea580c) !important; color: white !important; }

    /* Body */
    .designer-body {
      display: grid; grid-template-columns: 380px 1fr; gap: 24px;
      align-items: start;
    }
    @media (max-width: 1024px) {
      .designer-body { grid-template-columns: 1fr; }
    }

    /* Panels */
    .designer-left { display: flex; flex-direction: column; gap: 20px; }
    .panel-section {
      background: white; border-radius: 16px;
      border: 1px solid rgba(0,0,0,0.06); padding: 20px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.04);
    }
    .panel-section-title {
      display: flex; align-items: center; gap: 8px;
      font-size: 14px; font-weight: 700; color: #1e293b;
      margin: 0 0 16px; text-transform: uppercase; letter-spacing: 0.05em;
    }
    .panel-section-title mat-icon { font-size: 18px; color: #f97316; }

    /* Themes Grid */
    .themes-grid { display: flex; flex-direction: column; gap: 10px; }
    .theme-card {
      display: flex; align-items: center; gap: 14px;
      padding: 14px; border-radius: 14px;
      border: 2px solid #e2e8f0; background: #fafafa;
      cursor: pointer; transition: all 0.2s; text-align: left;
      position: relative; width: 100%;
    }
    .theme-card:hover { border-color: #f97316; background: #fff7ed; }
    .theme-card-active { border-color: #f97316 !important; background: #fff7ed !important; }

    /* Theme mini preview */
    .theme-preview-mini {
      width: 72px; height: 52px; border-radius: 8px;
      overflow: hidden; flex-shrink: 0;
      border: 1px solid rgba(0,0,0,0.08);
      box-shadow: 0 2px 6px rgba(0,0,0,0.1);
    }
    .theme-preview-header {
      height: 18px; padding: 3px 5px;
      display: flex; align-items: center; gap: 4px;
    }
    .theme-preview-logo {
      width: 12px; height: 12px; border-radius: 2px;
    }
    .theme-preview-lines { flex: 1; display: flex; flex-direction: column; gap: 2px; }
    .theme-preview-line { height: 2px; border-radius: 1px; width: 100%; }
    .theme-preview-line.short { width: 60%; }
    .theme-preview-body { padding: 4px 5px; display: flex; flex-direction: column; gap: 2px; }
    .theme-preview-row { height: 3px; border-radius: 1px; }
    .theme-preview-total {
      height: 8px; border-radius: 3px; margin-top: 4px;
      font-size: 4px; display: flex; align-items: center;
      justify-content: center; font-weight: 700;
    }

    .theme-card-info { flex: 1; min-width: 0; }
    .theme-card-name { display: block; font-size: 14px; font-weight: 700; color: #1e293b; }
    .theme-card-desc { display: block; font-size: 11px; color: #64748b; margin-top: 2px; }
    .theme-tags { display: flex; gap: 4px; margin-top: 6px; flex-wrap: wrap; }
    .theme-tag {
      padding: 2px 7px; border-radius: 10px;
      background: #f1f5f9; color: #475569;
      font-size: 10px; font-weight: 500;
    }
    .theme-active-badge {
      display: flex; align-items: center; gap: 4px;
      position: absolute; top: 10px; right: 10px;
      background: #f97316; color: white;
      font-size: 10px; font-weight: 700; padding: 3px 8px;
      border-radius: 10px;
    }
    .theme-active-badge mat-icon { font-size: 12px; }

    /* Color Customizer */
    .color-customizer { display: flex; flex-direction: column; gap: 12px; }
    .color-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .color-label {
      display: flex; align-items: center; gap: 6px;
      font-size: 13px; font-weight: 600; color: #374151; flex: 1;
    }
    .color-label mat-icon { font-size: 16px; color: #9ca3af; }
    .color-input-group { display: flex; align-items: center; gap: 8px; }
    .color-picker {
      width: 40px; height: 32px; border: 2px solid #e5e7eb;
      border-radius: 8px; cursor: pointer; padding: 2px;
    }
    .color-text {
      width: 80px; padding: 6px 10px; border: 1px solid #e5e7eb;
      border-radius: 8px; font-size: 12px; font-family: monospace;
      color: #374151;
    }
    .reset-btn {
      display: flex; align-items: center; gap: 6px;
      border: none; background: #f1f5f9; color: #64748b;
      font-size: 12px; padding: 8px 14px; border-radius: 8px;
      cursor: pointer; transition: all 0.15s; width: fit-content;
    }
    .reset-btn:hover { background: #e2e8f0; color: #374151; }
    .reset-btn mat-icon { font-size: 15px; }

    /* Logo Upload */
    .logo-dropzone {
      border: 2px dashed #cbd5e1; border-radius: 14px;
      padding: 32px; text-align: center; cursor: pointer;
      transition: all 0.2s; background: #f8fafc;
    }
    .logo-dropzone:hover { border-color: #f97316; background: #fff7ed; }
    .logo-dropzone-has { padding: 12px; border-style: solid; border-color: #f97316; }
    .logo-placeholder mat-icon { font-size: 40px; color: #cbd5e1; display: block; margin-bottom: 12px; }
    .logo-placeholder p { margin: 0; color: #64748b; font-size: 14px; font-weight: 600; }
    .logo-hint { font-size: 11px !important; color: #94a3b8 !important; margin-top: 4px !important; }
    .logo-preview-container { position: relative; display: inline-block; }
    .logo-preview-img { max-height: 80px; max-width: 200px; object-fit: contain; border-radius: 8px; }
    .logo-remove-btn {
      position: absolute; top: -8px; right: -8px;
      width: 22px; height: 22px; border-radius: 50%;
      background: #ef4444; color: white; border: none;
      cursor: pointer; display: flex; align-items: center; justify-content: center;
    }
    .logo-remove-btn mat-icon { font-size: 14px; }

    /* Preview Panel */
    .designer-right { position: sticky; top: 24px; }
    .preview-panel {
      background: white; border-radius: 16px;
      border: 1px solid rgba(0,0,0,0.06);
      box-shadow: 0 4px 20px rgba(0,0,0,0.06);
      overflow: hidden; min-height: 500px;
    }
    .preview-toolbar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 20px;
      border-bottom: 1px solid #f1f5f9;
      background: #f8fafc;
    }
    .preview-label {
      display: flex; align-items: center; gap: 6px;
      font-size: 13px; font-weight: 700; color: #475569;
    }
    .preview-label mat-icon { font-size: 16px; color: #f97316; }
    .preview-theme-name {
      font-size: 12px; color: #94a3b8; font-style: italic;
    }
    .preview-empty {
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; padding: 80px 40px; color: #cbd5e1;
      text-align: center;
    }
    .preview-empty mat-icon { font-size: 60px; margin-bottom: 16px; }
    .preview-empty p { font-size: 14px; }

    /* Invoice Preview Wrapper */
    .invoice-preview-wrapper {
      padding: 20px; background: #f1f5f9;
      overflow-x: auto;
    }
    .invoice-preview {
      background: white; min-height: 600px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.12);
      border-radius: 4px;
      overflow: hidden;
      transform-origin: top left;
    }

    /* Injected HTML Preview Styles */
    ::ng-deep .inv-header { padding: 32px 40px; }
    ::ng-deep .inv-body { padding: 24px 40px; }
    ::ng-deep .inv-table { width: 100%; border-collapse: collapse; }
    ::ng-deep .inv-table th { padding: 10px 14px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
    ::ng-deep .inv-table td { padding: 10px 14px; font-size: 13px; border-bottom: 1px solid #f1f5f9; }
    ::ng-deep .inv-total-row { font-weight: 700; font-size: 14px; }
    ::ng-deep .inv-footer { padding: 20px 40px; font-size: 11px; }
  `]
})
export class InvoiceDesignerComponent implements OnInit {
  activeThemeId = signal<string>('');
  selectedTheme = signal<InvoiceTheme | null>(null);
  customPrimary = signal<string>('#f97316');
  customAccent = signal<string>('#fed7aa');
  customBg = signal<string>('#fff7ed');
  logoPreview = signal<string>('');
  saving = signal<boolean>(false);
  isDragOver = signal<boolean>(false);

  themes: InvoiceTheme[] = [
    {
      id: 'classic',
      name: 'Clássico',
      description: 'Elegante e tradicional, ideal para qualquer negócio',
      preview: '📋',
      primaryColor: '#1e3a5f',
      accentColor: '#2563eb',
      bgColor: '#f0f4ff',
      textColor: '#1e293b',
      style: 'classic',
      tags: ['Formal', 'Universal', 'Confiança']
    },
    {
      id: 'modern',
      name: 'Moderno',
      description: 'Design contemporâneo com gradientes vibrantes',
      preview: '✨',
      primaryColor: '#f97316',
      accentColor: '#fb923c',
      bgColor: '#fff7ed',
      textColor: '#1e293b',
      style: 'modern',
      tags: ['Vibrante', 'TI', 'Comércio']
    },
    {
      id: 'minimal',
      name: 'Minimalista',
      description: 'Limpo e directo, o foco é nos números',
      preview: '⬜',
      primaryColor: '#1e293b',
      accentColor: '#64748b',
      bgColor: '#f8fafc',
      textColor: '#0f172a',
      style: 'minimal',
      tags: ['Simples', 'Profissional', 'Serviços']
    },
    {
      id: 'corporate',
      name: 'Corporativo',
      description: 'Sério e imponente para grandes empresas',
      preview: '🏢',
      primaryColor: '#0f172a',
      accentColor: '#10b981',
      bgColor: '#f0fdf4',
      textColor: '#0f172a',
      style: 'corporate',
      tags: ['Empresarial', 'Consultoria', 'Formal']
    },
    {
      id: 'creative',
      name: 'Criativo',
      description: 'Audacioso e memorável para marcas que se destacam',
      preview: '🎨',
      primaryColor: '#7c3aed',
      accentColor: '#a78bfa',
      bgColor: '#f5f3ff',
      textColor: '#1e293b',
      style: 'creative',
      tags: ['Design', 'Marketing', 'Criativo']
    }
  ];

  companyData = computed(() => this.companyService.activeCompany());

  invoicePreviewHtml = computed((): SafeHtml => {
    const theme = this.selectedTheme();
    if (!theme) return '';

    const primary = this.customPrimary();
    const accent = this.customAccent();
    const bg = this.customBg();
    const logo = this.logoPreview();
    const company = this.companyData();

    const logoHtml = logo
      ? `<img src="${logo}" style="max-height:60px;max-width:160px;object-fit:contain;" alt="Logo" />`
      : `<div style="width:60px;height:60px;border-radius:10px;background:${accent};display:flex;align-items:center;justify-content:center;color:white;font-weight:900;font-size:22px;">${company?.name?.charAt(0) || 'E'}</div>`;

    const html = `
      <div style="font-family:'Segoe UI',Arial,sans-serif;color:#1e293b;background:white;min-height:600px;">
        <!-- Header -->
        <div class="inv-header" style="background:${bg};border-bottom:4px solid ${primary};display:flex;align-items:center;justify-content:space-between;">
          <div style="display:flex;align-items:center;gap:16px;">
            ${logoHtml}
            <div>
              <div style="font-size:20px;font-weight:800;color:${primary};">${company?.name || 'Nome da Empresa'}</div>
              <div style="font-size:11px;color:#64748b;">NUIT: ${company?.nuit || '000000000'}</div>
              <div style="font-size:11px;color:#64748b;">${company?.address || 'Maputo, Moçambique'}</div>
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:28px;font-weight:900;color:${primary};letter-spacing:-1px;">FACTURA</div>
            <div style="font-size:13px;font-weight:700;color:#64748b;">#2025-0001</div>
            <div style="font-size:11px;color:#94a3b8;margin-top:4px;">Data: 03/07/2025</div>
            <div style="font-size:11px;color:#94a3b8;">Vencimento: 17/07/2025</div>
          </div>
        </div>

        <!-- Client Info -->
        <div style="padding:20px 40px;display:flex;gap:40px;border-bottom:1px solid #f1f5f9;">
          <div style="flex:1;">
            <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;">FACTURADO A</div>
            <div style="font-size:14px;font-weight:700;color:#1e293b;">João Silva & Filhos, Lda.</div>
            <div style="font-size:12px;color:#64748b;">NUIT: 123456789</div>
            <div style="font-size:12px;color:#64748b;">Av. Eduardo Mondlane, 123</div>
            <div style="font-size:12px;color:#64748b;">Maputo, Moçambique</div>
          </div>
          <div style="width:160px;">
            <div style="background:${primary};color:white;border-radius:10px;padding:14px;text-align:center;">
              <div style="font-size:10px;font-weight:700;letter-spacing:0.1em;opacity:0.7;text-transform:uppercase;">TOTAL A PAGAR</div>
              <div style="font-size:22px;font-weight:900;margin-top:4px;">45.600 MT</div>
              <div style="margin-top:8px;padding:4px 10px;background:rgba(255,255,255,0.15);border-radius:20px;font-size:10px;font-weight:700;">PENDENTE</div>
            </div>
          </div>
        </div>

        <!-- Table -->
        <div class="inv-body">
          <table class="inv-table">
            <thead>
              <tr style="background:${bg};">
                <th style="text-align:left;color:${primary};border-bottom:2px solid ${primary};">DESCRIÇÃO</th>
                <th style="text-align:center;color:${primary};border-bottom:2px solid ${primary};">QTD</th>
                <th style="text-align:center;color:${primary};border-bottom:2px solid ${primary};">UNID.</th>
                <th style="text-align:right;color:${primary};border-bottom:2px solid ${primary};">PREÇO UNIT.</th>
                <th style="text-align:right;color:${primary};border-bottom:2px solid ${primary};">TOTAL</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Instalação de sistema informático</td>
                <td style="text-align:center;">2</td>
                <td style="text-align:center;">un</td>
                <td style="text-align:right;">15.000,00 MT</td>
                <td style="text-align:right;font-weight:600;">30.000,00 MT</td>
              </tr>
              <tr style="background:#f8fafc;">
                <td>Cabo HDMI 2.0 (2m)</td>
                <td style="text-align:center;">5</td>
                <td style="text-align:center;">un</td>
                <td style="text-align:right;">500,00 MT</td>
                <td style="text-align:right;font-weight:600;">2.500,00 MT</td>
              </tr>
              <tr>
                <td>Suporte técnico mensal</td>
                <td style="text-align:center;">1</td>
                <td style="text-align:center;">mês</td>
                <td style="text-align:right;">3.000,00 MT</td>
                <td style="text-align:right;font-weight:600;">3.000,00 MT</td>
              </tr>
            </tbody>
          </table>

          <!-- Totals -->
          <div style="display:flex;justify-content:flex-end;margin-top:20px;">
            <div style="width:260px;">
              <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;">
                <span style="color:#64748b;">Subtotal</span>
                <span style="font-weight:600;">35.500,00 MT</span>
              </div>
              <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;">
                <span style="color:#64748b;">IVA (16%)</span>
                <span style="font-weight:600;">5.680,00 MT</span>
              </div>
              <div style="display:flex;justify-content:space-between;padding:12px 16px;background:${primary};color:white;border-radius:10px;margin-top:8px;font-size:15px;font-weight:800;">
                <span>TOTAL</span>
                <span>41.180,00 MT</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="inv-footer" style="border-top:2px solid ${bg};color:#94a3b8;display:flex;justify-content:space-between;align-items:center;margin-top:20px;">
          <div>
            <div style="font-weight:700;color:#64748b;margin-bottom:2px;">Obrigado pela preferência!</div>
            <div>Factura processada pelo ISPC Fácil · ispcfacil.co.mz</div>
          </div>
          <div style="text-align:right;">
            <div>Pagamento via M-Pesa ou transferência bancária</div>
            <div style="font-weight:600;color:${primary};">Ref: 2025-0001</div>
          </div>
        </div>
      </div>
    `;

    return this.sanitizer.bypassSecurityTrustHtml(html);
  });

  constructor(
    public companyService: CompanyService,
    private supabase: SupabaseService,
    private snackBar: MatSnackBar,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit() {
    this.loadSavedTheme();
  }

  private async loadSavedTheme() {
    const company = this.companyService.activeCompany();
    if (!company) return;

    try {
      const { data } = await this.supabase.client
        .from('companies')
        .select('invoice_theme_id, invoice_primary_color, invoice_accent_color, invoice_bg_color, invoice_logo_url')
        .eq('id', company.id)
        .single();

      if (data?.invoice_theme_id) {
        const theme = this.themes.find(t => t.id === data.invoice_theme_id);
        if (theme) {
          this.activeThemeId.set(theme.id);
          this.selectedTheme.set(theme);
          this.customPrimary.set(data.invoice_primary_color || theme.primaryColor);
          this.customAccent.set(data.invoice_accent_color || theme.accentColor);
          this.customBg.set(data.invoice_bg_color || theme.bgColor);
          if (data.invoice_logo_url) this.logoPreview.set(data.invoice_logo_url);
        }
      }
    } catch (e) {
      // Theme columns might not exist yet — silently ignore
    }
  }

  selectTheme(theme: InvoiceTheme) {
    this.selectedTheme.set(theme);
    this.activeThemeId.set(theme.id);
    this.customPrimary.set(theme.primaryColor);
    this.customAccent.set(theme.accentColor);
    this.customBg.set(theme.bgColor);
  }

  resetColors() {
    const t = this.selectedTheme();
    if (!t) return;
    this.customPrimary.set(t.primaryColor);
    this.customAccent.set(t.accentColor);
    this.customBg.set(t.bgColor);
  }

  updateCustomPrimary(e: Event) { this.customPrimary.set((e.target as HTMLInputElement).value); }
  updateCustomAccent(e: Event) { this.customAccent.set((e.target as HTMLInputElement).value); }
  updateCustomBg(e: Event) { this.customBg.set((e.target as HTMLInputElement).value); }
  updateCustomPrimaryText(e: Event) {
    const v = (e.target as HTMLInputElement).value;
    if (/^#[0-9A-Fa-f]{6}$/.test(v)) this.customPrimary.set(v);
  }
  updateCustomAccentText(e: Event) {
    const v = (e.target as HTMLInputElement).value;
    if (/^#[0-9A-Fa-f]{6}$/.test(v)) this.customAccent.set(v);
  }
  updateCustomBgText(e: Event) {
    const v = (e.target as HTMLInputElement).value;
    if (/^#[0-9A-Fa-f]{6}$/.test(v)) this.customBg.set(v);
  }

  onDragOver(e: DragEvent) { e.preventDefault(); this.isDragOver.set(true); }
  onDragLeave(e: DragEvent) { this.isDragOver.set(false); }
  onDrop(e: DragEvent) {
    e.preventDefault();
    this.isDragOver.set(false);
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type.startsWith('image/')) this.processLogoFile(file);
  }

  triggerLogoUpload() {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    input?.click();
  }

  onLogoSelected(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) this.processLogoFile(file);
  }

  private processLogoFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => this.logoPreview.set(e.target?.result as string);
    reader.readAsDataURL(file);
  }

  removeLogo(e: Event) {
    e.stopPropagation();
    this.logoPreview.set('');
  }

  async saveTheme() {
    const company = this.companyService.activeCompany();
    const theme = this.selectedTheme();
    if (!company || !theme) return;

    this.saving.set(true);
    try {
      // Upload logo if it's a data URL (new)
      let logoUrl = this.logoPreview();
      if (logoUrl && logoUrl.startsWith('data:')) {
        const blob = await fetch(logoUrl).then(r => r.blob());
        const ext = blob.type.split('/')[1] || 'png';
        const path = `logos/${company.id}/invoice-logo.${ext}`;
        const { error: uploadError } = await this.supabase.client.storage
          .from('company-documents')
          .upload(path, blob, { upsert: true });

        if (!uploadError) {
          const { data: urlData } = this.supabase.client.storage
            .from('company-documents')
            .getPublicUrl(path);
          logoUrl = urlData.publicUrl;
          this.logoPreview.set(logoUrl);
        }
      }

      // Save theme settings to company record
      await this.supabase.client
        .from('companies')
        .update({
          invoice_theme_id: theme.id,
          invoice_primary_color: this.customPrimary(),
          invoice_accent_color: this.customAccent(),
          invoice_bg_color: this.customBg(),
          invoice_logo_url: logoUrl || null
        } as any)
        .eq('id', company.id);

      this.snackBar.open('✅ Tema guardado com sucesso! As suas facturas usarão este design.', 'Fechar', {
        duration: 4000,
        panelClass: ['success-snack']
      });
    } catch (err) {
      console.error('Error saving theme:', err);
      this.snackBar.open('Erro ao guardar o tema. Verifique a ligação.', 'Fechar', { duration: 3000 });
    } finally {
      this.saving.set(false);
    }
  }
}
