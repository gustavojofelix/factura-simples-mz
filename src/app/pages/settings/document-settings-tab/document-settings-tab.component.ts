import { Component, computed, effect, inject, input, signal, viewChildren } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';

import { toSignal } from '@angular/core/rxjs-interop';

import { CompanyService, Company, companyHasBankDetails } from '../../../core/services/company.service';
import {
  DocumentSettingsService,
  DocumentBranding,
  DEFAULT_DOCUMENT_BRANDING,
  DOCUMENT_TEMPLATES,
  DocumentTemplateCode
} from '../../../core/services/document-settings.service';
import { InvoiceDocumentComponent } from '../../../shared/components/documents/invoice-document.component';
import { ReceiptDocumentComponent } from '../../../shared/components/documents/receipt-document.component';
import { ClientStatementDocumentComponent } from '../../../shared/components/documents/client-statement-document.component';
import { RichTextEditorComponent } from '../../../shared/components/rich-text-editor.component';
import {
  SAMPLE_INVOICE,
  SAMPLE_PAYMENT,
  SAMPLE_COMPANY,
  SAMPLE_CLIENT_STATEMENT
} from '../../../shared/components/documents/document-preview.fixtures';

/** Marcadores que o utilizador pode usar nos textos de e-mail. */
const EMAIL_TOKENS = [
  { token: '{{cliente}}', hint: 'Nome do cliente' },
  { token: '{{empresa}}', hint: 'Nome da sua empresa' },
  { token: '{{numero_factura}}', hint: 'Número da factura' },
  { token: '{{numero_recibo}}', hint: 'Número do recibo' },
  { token: '{{total}}', hint: 'Valor total do documento' },
  { token: '{{valor_pago}}', hint: 'Valor já pago' },
  { token: '{{valor_pendente}}', hint: 'Valor por pagar' },
  { token: '{{data}}', hint: 'Data de emissão' },
  { token: '{{data_vencimento}}', hint: 'Data de vencimento' },
  { token: '{{periodo}}', hint: 'Extracto: período (01/08/2026 a 31/08/2026)' },
  { token: '{{saldo_anterior}}', hint: 'Extracto: saldo antes do período' },
  { token: '{{total_facturado}}', hint: 'Extracto: total facturado no período' },
  { token: '{{total_pago}}', hint: 'Extracto: total pago no período' },
  { token: '{{saldo}}', hint: 'Extracto: saldo em dívida na data final' }
];

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/** Tecto do corpo das mensagens, já com as etiquetas de formatação. */
const MAX_EMAIL_BODY_LENGTH = 5000;

@Component({
  selector: 'app-document-settings-tab',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatIconModule,
    MatChipsModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    InvoiceDocumentComponent,
    ReceiptDocumentComponent,
    ClientStatementDocumentComponent,
    RichTextEditorComponent
  ],
  styles: [`
    /* A pré-visualização é desenhada à largura de uma folha A4 e depois
       reduzida. O documento verdadeiro nunca é capturado nesta escala. */
    .preview-frame {
      width: 794px;
      transform-origin: top left;
      pointer-events: none;
    }
  `],
  template: `
    @if (!companyId()) {
      <div class="p-8 text-center text-gray-500">
        Seleccione uma empresa para personalizar os seus documentos.
      </div>
    } @else {
      <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_400px] gap-6 items-start">
      <form [formGroup]="form" class="space-y-6 py-2">

        @if (!canEdit()) {
          <div class="flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm">
            <mat-icon class="!text-amber-600">lock</mat-icon>
            <span>Apenas o proprietário ou um administrador da empresa pode alterar estas definições.</span>
          </div>
        }

        <!-- MODELO -->
        <mat-card class="!rounded-2xl !shadow-sm">
          <mat-card-content class="!p-6">
            <h3 class="text-base font-bold text-gray-800 mb-1">Modelo do documento</h3>
            <p class="text-xs text-gray-500 mb-5">Escolha a disposição das suas facturas, recibos e extractos.</p>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
              @for (modelo of templates; track modelo.code) {
                <button type="button"
                  (click)="selectTemplate(modelo.code)"
                  [disabled]="!canEdit()"
                  class="text-left p-4 rounded-xl border-2 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                  [class.border-orange-500]="form.value.template_code === modelo.code"
                  [class.bg-orange-50]="form.value.template_code === modelo.code"
                  [class.border-gray-200]="form.value.template_code !== modelo.code">
                  <div class="flex items-center justify-between mb-2">
                    <span class="font-bold text-sm text-gray-800">{{ modelo.label }}</span>
                    @if (form.value.template_code === modelo.code) {
                      <mat-icon class="!text-orange-500 !text-[18px] !w-[18px] !h-[18px]">check_circle</mat-icon>
                    }
                  </div>
                  <p class="text-[11px] leading-relaxed text-gray-500">{{ modelo.description }}</p>
                </button>
              }
            </div>
          </mat-card-content>
        </mat-card>

        <!-- MARCA -->
        <mat-card class="!rounded-2xl !shadow-sm">
          <mat-card-content class="!p-6">
            <h3 class="text-base font-bold text-gray-800 mb-1">Marca</h3>
            <p class="text-xs text-gray-500 mb-5">O logótipo é partilhado com os dados da empresa.</p>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div class="space-y-4">
                <div>
                  <label class="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Cor principal</label>
                  <div class="flex items-center gap-3">
                    <input type="color" formControlName="primary_color"
                      class="w-12 h-10 rounded border border-gray-200 cursor-pointer disabled:cursor-not-allowed">
                    <mat-form-field appearance="outline" class="flex-1" subscriptSizing="dynamic">
                      <input matInput formControlName="primary_color" placeholder="#f16c39" maxlength="7">
                      @if (form.get('primary_color')?.hasError('pattern')) {
                        <mat-error>Use um valor como #f16c39.</mat-error>
                      }
                    </mat-form-field>
                  </div>
                </div>

                <div>
                  <label class="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Cor secundária</label>
                  <div class="flex items-center gap-3">
                    <input type="color" formControlName="accent_color"
                      class="w-12 h-10 rounded border border-gray-200 cursor-pointer disabled:cursor-not-allowed">
                    <mat-form-field appearance="outline" class="flex-1" subscriptSizing="dynamic">
                      <input matInput formControlName="accent_color" placeholder="#332d2a" maxlength="7">
                      @if (form.get('accent_color')?.hasError('pattern')) {
                        <mat-error>Use um valor como #332d2a.</mat-error>
                      }
                    </mat-form-field>
                  </div>
                </div>

                <mat-slide-toggle formControlName="show_logo" color="primary">
                  <span class="text-sm">Mostrar o logótipo nos documentos</span>
                </mat-slide-toggle>

                <div>
                  <mat-slide-toggle formControlName="show_bank_details" color="primary">
                    <span class="text-sm">Mostrar as coordenadas bancárias</span>
                  </mat-slide-toggle>
                  <p class="text-xs text-gray-500 mt-1">
                    Banco, conta, IBAN, NIB, M-Pesa e e-Mola aparecem no fim das facturas e extractos.
                    Edite-os nos dados da empresa: Configurações → Empresas → editar → Dados Bancários.
                  </p>
                  @if (!companyHasBankDetails()) {
                    <p class="flex items-start gap-1 text-xs text-amber-700 mt-1">
                      <mat-icon class="!text-amber-600 !text-[16px] !w-4 !h-4 shrink-0">warning</mat-icon>
                      Esta empresa ainda não tem dados bancários, por isso nada será mostrado nos documentos.
                    </p>
                  }
                </div>
              </div>

              <div>
                <label class="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Logótipo</label>
                <div class="border-2 border-dashed border-gray-200 rounded-xl p-4 flex flex-col items-center justify-center gap-3 min-h-[180px]">
                  @if (logoUrl()) {
                    <img [src]="logoUrl()!" alt="Logótipo" class="max-h-24 max-w-full object-contain">
                  } @else {
                    <mat-icon class="!text-gray-300 !text-[48px] !w-12 !h-12">image</mat-icon>
                    <p class="text-xs text-gray-400">Sem logótipo</p>
                  }

                  <div class="flex items-center gap-2">
                    <input type="file" #logoInput accept="image/png,image/jpeg" hidden (change)="onLogoSelected($event)">
                    <button type="button" mat-stroked-button [disabled]="!canEdit() || isUploadingLogo()"
                      (click)="logoInput.click()">
                      <mat-icon>upload</mat-icon>
                      {{ logoUrl() ? 'Substituir' : 'Carregar' }}
                    </button>
                    @if (logoUrl()) {
                      <button type="button" mat-button color="warn" [disabled]="!canEdit() || isUploadingLogo()"
                        (click)="removeLogo()">
                        Remover
                      </button>
                    }
                  </div>
                  <p class="text-[11px] text-gray-400">PNG ou JPG, até 2 MB.</p>
                </div>
              </div>
            </div>
          </mat-card-content>
        </mat-card>

        <!-- TEXTOS -->
        <mat-card class="!rounded-2xl !shadow-sm">
          <mat-card-content class="!p-6">
            <h3 class="text-base font-bold text-gray-800 mb-1">Textos dos documentos</h3>
            <p class="text-xs text-gray-500 mb-5">Deixe em branco para não mostrar nada.</p>

            <div class="space-y-4">
              <mat-form-field appearance="outline" class="w-full">
                <mat-label>Mensagem de agradecimento</mat-label>
                <input matInput formControlName="thank_you_message" maxlength="160"
                  placeholder="Ex: Obrigado pela sua preferência.">
                <mat-hint align="end">{{ form.value.thank_you_message?.length || 0 }} / 160</mat-hint>
              </mat-form-field>

              <mat-form-field appearance="outline" class="w-full">
                <mat-label>Observações por omissão</mat-label>
                <textarea matInput formControlName="default_observations" rows="3" maxlength="500"
                  placeholder="Ex: Pagamento no acto da entrega."></textarea>
                <mat-hint>Preenche as notas ao criar uma factura nova. Facturas já emitidas não são alteradas.</mat-hint>
              </mat-form-field>

              <mat-form-field appearance="outline" class="w-full">
                <mat-label>Rodapé</mat-label>
                <textarea matInput formControlName="footer_text" rows="2" maxlength="240"
                  placeholder="Ex: Documento processado por computador."></textarea>
                <mat-hint align="end">{{ form.value.footer_text?.length || 0 }} / 240</mat-hint>
              </mat-form-field>
            </div>
          </mat-card-content>
        </mat-card>

        <!-- IMPRESSÃO -->
        <mat-card class="!rounded-2xl !shadow-sm">
          <mat-card-content class="!p-6">
            <h3 class="text-base font-bold text-gray-800 mb-1">Impressão</h3>
            <p class="text-xs text-gray-500 mb-5">Cada via sai numa página própria, identificada.</p>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <mat-form-field appearance="outline">
                <mat-label>Vias da factura</mat-label>
                <mat-select formControlName="invoice_copies">
                  @for (opcao of copyOptions; track opcao.value) {
                    <mat-option [value]="opcao.value">{{ opcao.label }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>

              <mat-form-field appearance="outline">
                <mat-label>Vias do recibo</mat-label>
                <mat-select formControlName="receipt_copies">
                  @for (opcao of copyOptions; track opcao.value) {
                    <mat-option [value]="opcao.value">{{ opcao.label }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            </div>
          </mat-card-content>
        </mat-card>

        <!-- E-MAIL -->
        <mat-card class="!rounded-2xl !shadow-sm">
          <mat-card-content class="!p-6">
            <h3 class="text-base font-bold text-gray-800 mb-1">Mensagens de e-mail</h3>
            <p class="text-xs text-gray-500 mb-4">Clique num marcador para o inserir no campo onde estava a escrever.</p>

            <div class="flex flex-wrap gap-2 mb-5">
              @for (t of tokens; track t.token) {
                <button type="button" (click)="insertToken(t.token)" [disabled]="!canEdit()"
                  [matTooltip]="t.hint"
                  class="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-200 text-[11px] font-mono text-slate-700 transition-colors disabled:opacity-50">
                  {{ t.token }}
                </button>
              }
            </div>

            <div class="space-y-4">
              <mat-form-field appearance="outline" class="w-full">
                <mat-label>Assunto</mat-label>
                <input matInput formControlName="email_subject" maxlength="200"
                  (focus)="lastFocused.set('email_subject')">
              </mat-form-field>

              <mat-form-field appearance="outline" class="w-full">
                <mat-label>Saudação</mat-label>
                <input matInput formControlName="email_greeting" maxlength="200"
                  (focus)="lastFocused.set('email_greeting')">
              </mat-form-field>

              <div>
                <app-rich-text-editor name="email_body" formControlName="email_body"
                  label="Corpo da mensagem" [minHeight]="110"
                  (focusIn)="lastFocused.set('email_body')">
                </app-rich-text-editor>
                @if (form.get('email_body')?.hasError('maxlength')) {
                  <p class="text-xs text-red-600 mt-1 px-3">Texto demasiado longo.</p>
                }
              </div>

              <mat-form-field appearance="outline" class="w-full">
                <mat-label>Despedida</mat-label>
                <input matInput formControlName="email_signature" maxlength="200"
                  (focus)="lastFocused.set('email_signature')">
              </mat-form-field>

              <div>
                <app-rich-text-editor name="receipt_email_body" formControlName="receipt_email_body"
                  label="Corpo da mensagem do recibo" [minHeight]="80"
                  (focusIn)="lastFocused.set('receipt_email_body')">
                </app-rich-text-editor>
                @if (form.get('receipt_email_body')?.hasError('maxlength')) {
                  <p class="text-xs text-red-600 mt-1 px-3">Texto demasiado longo.</p>
                }
              </div>

              <mat-form-field appearance="outline" class="w-full">
                <mat-label>Assunto do extracto de conta</mat-label>
                <input matInput formControlName="statement_email_subject" maxlength="200"
                  (focus)="lastFocused.set('statement_email_subject')">
              </mat-form-field>

              <div>
                <app-rich-text-editor name="statement_email_body" formControlName="statement_email_body"
                  label="Corpo da mensagem do extracto de conta" [minHeight]="80"
                  (focusIn)="lastFocused.set('statement_email_body')">
                </app-rich-text-editor>
                @if (form.get('statement_email_body')?.hasError('maxlength')) {
                  <p class="text-xs text-red-600 mt-1 px-3">Texto demasiado longo.</p>
                } @else {
                  <p class="text-xs text-gray-500 mt-1 px-3">Use os marcadores de extracto, como período e saldo.</p>
                }
              </div>

              <mat-form-field appearance="outline" class="w-full">
                <mat-label>Responder para (opcional)</mat-label>
                <input matInput formControlName="email_reply_to" type="email"
                  placeholder="geral@suaempresa.co.mz">
                <mat-hint>As respostas dos clientes são encaminhadas para este endereço.</mat-hint>
                @if (form.get('email_reply_to')?.hasError('email')) {
                  <mat-error>Endereço de e-mail inválido.</mat-error>
                }
              </mat-form-field>
            </div>
          </mat-card-content>
        </mat-card>

        <div class="flex items-center justify-end gap-3 pb-4">
          <button type="button" mat-button (click)="reset()" [disabled]="!canEdit() || isSaving()">
            Repor
          </button>
          <button type="button" mat-raised-button class="!bg-ispc-orange !text-white"
            (click)="save()" [disabled]="!canEdit() || form.invalid || isSaving()">
            @if (isSaving()) {
              <mat-spinner diameter="18" class="inline-block mr-2"></mat-spinner>
            }
            Guardar alterações
          </button>
        </div>
      </form>

      <!-- Pré-visualização ao vivo. Usa o mesmo componente que desenha a
           factura verdadeira, por isso o que se vê aqui é o que sai em PDF. -->
      <div class="hidden xl:block sticky top-6">
        <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div class="flex items-center justify-between mb-3">
            <p class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Pré-visualização</p>

            <div class="flex rounded-lg border border-slate-200 bg-white overflow-hidden">
              <button type="button" (click)="previewKind.set('factura')"
                class="px-3 py-1 text-[11px] font-semibold transition-colors"
                [class.bg-orange-500]="previewKind() === 'factura'"
                [class.text-white]="previewKind() === 'factura'"
                [class.text-slate-500]="previewKind() !== 'factura'">
                Factura
              </button>
              <button type="button" (click)="previewKind.set('recibo')"
                class="px-3 py-1 text-[11px] font-semibold transition-colors border-l border-slate-200"
                [class.bg-orange-500]="previewKind() === 'recibo'"
                [class.text-white]="previewKind() === 'recibo'"
                [class.text-slate-500]="previewKind() !== 'recibo'">
                Recibo
              </button>
              <button type="button" (click)="previewKind.set('extracto')"
                class="px-3 py-1 text-[11px] font-semibold transition-colors border-l border-slate-200"
                [class.bg-orange-500]="previewKind() === 'extracto'"
                [class.text-white]="previewKind() === 'extracto'"
                [class.text-slate-500]="previewKind() !== 'extracto'">
                Extracto
              </button>
            </div>
          </div>

          <div class="bg-white rounded-lg shadow-sm overflow-hidden h-[600px]">
            <div class="preview-frame scale-[0.44]">
              @if (previewKind() === 'factura') {
                <app-invoice-document
                  [invoice]="sampleInvoice"
                  [company]="previewCompany()"
                  [branding]="previewBranding()"
                  [preview]="true">
                </app-invoice-document>
              } @else if (previewKind() === 'recibo') {
                <app-receipt-document
                  [payment]="samplePayment"
                  [invoice]="sampleInvoice"
                  [company]="previewCompany()"
                  [branding]="previewBranding()">
                </app-receipt-document>
              } @else {
                <app-client-statement-document
                  [statement]="sampleStatement"
                  start="2026-08-01"
                  end="2026-08-31"
                  issuedAt="2026-09-01"
                  issuerName="Ana Machava"
                  [company]="previewCompany()"
                  [branding]="previewBranding()">
                </app-client-statement-document>
              }
            </div>
          </div>

          <p class="text-[11px] text-slate-400 mt-3">
            Dados de exemplo. Reflecte as alterações enquanto escreve, antes de guardar.
          </p>
        </div>
      </div>
      </div>
    }
  `
})
export class DocumentSettingsTabComponent {
  companyId = input<string | null>(null);

  private fb = inject(FormBuilder);
  private settings = inject(DocumentSettingsService);
  private companyService = inject(CompanyService);
  private snackBar = inject(MatSnackBar);

  templates = DOCUMENT_TEMPLATES;
  tokens = EMAIL_TOKENS;

  copyOptions = [
    { value: 1, label: 'Apenas o original' },
    { value: 2, label: 'Original e duplicado' },
    { value: 3, label: 'Original, duplicado e triplicado' }
  ];

  isSaving = this.settings.isSaving;
  isUploadingLogo = signal(false);
  lastFocused = signal<string | null>(null);
  private richEditors = viewChildren(RichTextEditorComponent);
  logoUrl = signal<string | null>(null);

  sampleInvoice = SAMPLE_INVOICE;
  samplePayment = SAMPLE_PAYMENT;
  sampleStatement = SAMPLE_CLIENT_STATEMENT;

  /** Qual dos documentos a pré-visualização está a mostrar. */
  previewKind = signal<'factura' | 'recibo' | 'extracto'>('factura');

  /**
   * O separador só é editável por quem manda na empresa. O papel é lido de
   * forma assíncrona, por isso começa fechado e abre quando se confirmar.
   */
  canEdit = signal(false);

  form: FormGroup = this.fb.group({
    template_code: ['classico'],
    primary_color: ['#f16c39', [Validators.pattern(/^#[0-9a-fA-F]{6}$/)]],
    accent_color: ['#332d2a', [Validators.pattern(/^#[0-9a-fA-F]{6}$/)]],
    show_logo: [true],
    show_bank_details: [true],
    thank_you_message: [''],
    default_observations: [''],
    footer_text: [''],
    invoice_copies: [1],
    receipt_copies: [1],
    email_subject: [''],
    email_greeting: [''],
    email_body: ['', [Validators.maxLength(MAX_EMAIL_BODY_LENGTH)]],
    email_signature: [''],
    receipt_email_body: ['', [Validators.maxLength(MAX_EMAIL_BODY_LENGTH)]],
    statement_email_subject: [''],
    statement_email_body: ['', [Validators.maxLength(MAX_EMAIL_BODY_LENGTH)]],
    email_reply_to: ['', [Validators.email]]
  });

  /**
   * Valores do formulário em sinal, para que a pré-visualização acompanhe o que
   * está a ser escrito. Nada disto é gravado: a gravação continua a depender do
   * botão, por isso escrever no formulário nunca toca na base de dados.
   */
  private formValue = toSignal(this.form.valueChanges, { initialValue: null });

  previewBranding = computed<DocumentBranding>(() => {
    const value = this.formValue() ?? this.form.getRawValue();
    return { ...DEFAULT_DOCUMENT_BRANDING, ...(value as Partial<DocumentBranding>) };
  });

  /** A empresa real, se já estiver carregada, com o logótipo escolhido agora. */
  previewCompany = computed<Company>(() => {
    const id = this.companyId();
    const real = id ? this.companyService.companies().find(c => c.id === id) : null;
    const base = real ?? SAMPLE_COMPANY;
    return { ...base, logo_url: this.logoUrl() ?? undefined } as Company;
  });

  /** Só avisa quando a empresa real já está carregada e não tem dados bancários. */
  companyHasBankDetails = computed(() => {
    const id = this.companyId();
    const real = id ? this.companyService.companies().find(c => c.id === id) : null;
    return !real || companyHasBankDetails(real);
  });

  constructor() {
    effect(() => {
      const id = this.companyId();
      if (id) {
        void this.load(id);
      } else {
        this.logoUrl.set(null);
      }
    });
  }

  private async load(companyId: string) {
    const [branding, role] = await Promise.all([
      this.settings.resolve(companyId),
      this.companyService.getUserRole(companyId)
    ]);

    // A empresa pode ter mudado enquanto estas leituras decorriam.
    if (this.companyId() !== companyId) return;

    const editavel = role === 'owner' || role === 'admin';
    this.canEdit.set(editavel);

    this.form.patchValue(branding, { emitEvent: false });

    if (editavel) {
      this.form.enable({ emitEvent: false });
    } else {
      this.form.disable({ emitEvent: false });
    }

    const company = this.companyService.companies().find(c => c.id === companyId);
    this.logoUrl.set(company?.logo_url || null);
  }

  selectTemplate(code: DocumentTemplateCode) {
    if (!this.canEdit()) return;
    this.form.patchValue({ template_code: code });
  }

  /**
   * Insere o marcador no campo em que o utilizador estava a escrever. Nos
   * corpos com formatação entra onde estava o cursor; nos restantes, no fim.
   * Sem campo escolhido, vai para o corpo da mensagem, que é o caso comum.
   */
  insertToken(token: string) {
    if (!this.canEdit()) return;

    const field = this.lastFocused() ?? 'email_body';

    const editor = this.richEditors().find(e => e.name() === field);
    if (editor) {
      editor.insertText(token);
      return;
    }

    const control = this.form.get(field);
    if (!control) return;

    const current = String(control.value ?? '');
    const separator = current && !current.endsWith(' ') ? ' ' : '';
    control.setValue(`${current}${separator}${token}`);
    control.markAsDirty();
  }

  onLogoSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    if (file.size > MAX_LOGO_BYTES) {
      this.snackBar.open('O ficheiro é demasiado grande. Máximo de 2 MB.', 'Fechar', { duration: 4000 });
      input.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      await this.persistLogo(dataUrl);
      input.value = '';
    };
    reader.onerror = () => {
      this.snackBar.open('Não foi possível ler o ficheiro.', 'Fechar', { duration: 4000 });
      input.value = '';
    };
    reader.readAsDataURL(file);
  }

  async removeLogo() {
    await this.persistLogo(null);
  }

  private async persistLogo(dataUrl: string | null) {
    const companyId = this.companyId();
    if (!companyId) return;

    this.isUploadingLogo.set(true);

    const ok = await this.companyService.updateCompany(companyId, {
      logo_url: dataUrl ?? undefined
    } as any);

    this.isUploadingLogo.set(false);

    if (ok) {
      this.logoUrl.set(dataUrl);
      this.snackBar.open(
        dataUrl ? 'Logótipo actualizado.' : 'Logótipo removido.',
        'Fechar',
        { duration: 3000 }
      );
    } else {
      this.snackBar.open('Não foi possível guardar o logótipo.', 'Fechar', { duration: 4000 });
    }
  }

  async save() {
    const companyId = this.companyId();
    if (!companyId || this.form.invalid) return;

    const value = this.form.getRawValue();
    const patch: Partial<DocumentBranding> = {
      ...value,
      invoice_copies: Number(value.invoice_copies) || 1,
      receipt_copies: Number(value.receipt_copies) || 1,
      primary_color: String(value.primary_color || '#f16c39').toLowerCase(),
      accent_color: String(value.accent_color || '#332d2a').toLowerCase(),
      email_reply_to: value.email_reply_to?.trim() ? value.email_reply_to.trim() : null
    };

    const ok = await this.settings.update(companyId, patch);

    this.snackBar.open(
      ok
        ? 'Personalização de documentos actualizada com sucesso.'
        : 'Não foi possível guardar a personalização.',
      'Fechar',
      { duration: ok ? 3000 : 4000 }
    );

    if (ok) this.form.markAsPristine();
  }

  async reset() {
    const companyId = this.companyId();
    if (!companyId) return;
    await this.settings.reload(companyId);
    await this.load(companyId);
  }
}
