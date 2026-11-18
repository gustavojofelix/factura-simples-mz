import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Company } from '../../core/services/company.service';
import { CompanyBankAccountService, CompanyBankAccount } from '../../core/services/company-bank-account.service';
import { AuthService } from '../../core/services/auth.service';
import { PdfService } from '../../core/services/pdf.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { AuditLogService } from '../../core/services/audit-log.service';
import {
  DocumentSettingsService,
  DocumentBranding,
  DEFAULT_DOCUMENT_BRANDING
} from '../../core/services/document-settings.service';
import {
  ClientStatement,
  ClientStatementSummaryRow,
  MovementKind
} from '../../core/services/statement.service';
import { toIsoDate } from '../../core/utils/date.util';
import { SummaryStatementDocumentComponent } from './documents/summary-statement-document.component';
import { ClientStatementDocumentComponent } from './documents/client-statement-document.component';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { DialogShellComponent } from '../ui/dialog-shell.component';
import { Capacitor } from '@capacitor/core';

export interface SummaryStatementPreviewData {
  kind: 'summary';
  company: Company;
  rows: ClientStatementSummaryRow[];
  start: string;
  end: string;
  notes: string;
}

export interface ClientStatementPreviewData {
  kind: 'client';
  company: Company;
  statement: ClientStatement;
  filter: 'all' | MovementKind;
  start: string;
  end: string;
  notes: string;
}

export type StatementPreviewData = SummaryStatementPreviewData | ClientStatementPreviewData;

/**
 * Pré-visualização de um extracto, com descarga em PDF e impressão.
 * O PDF é gerado a partir do documento mostrado, como na factura e no recibo.
 */
@Component({
  selector: 'app-statement-preview-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    SummaryStatementDocumentComponent,
    ClientStatementDocumentComponent,
    DialogShellComponent,
    TranslatePipe
  ],
  template: `
    <app-dialog-shell
      [title]="(data.kind === 'client' ? 'reports.preview.clientTitle' : 'reports.preview.summaryTitle') | t"
      icon="account_balance_wallet"
      (closed)="close()"
    >
      @if (isLoading()) {
        <div class="text-center py-8">
          <mat-spinner diameter="36" class="mx-auto mb-3"></mat-spinner>
          <p class="text-gray-500">{{ 'common.status.loading' | t }}</p>
        </div>
      } @else {
        <div id="statement-document" class="bg-white relative">
          @if (isGeneratingPdf()) {
            <div class="absolute inset-0 bg-white/80 z-50 flex flex-col items-center justify-center">
              <mat-spinner diameter="36" class="mb-2"></mat-spinner>
              <p class="text-sm font-medium text-gray-600">{{ 'reports.preview.generatingPdf' | t }}</p>
            </div>
          }
          @if (data.kind === 'client') {
            <app-client-statement-document
              [statement]="data.statement"
              [filter]="data.filter"
              [start]="data.start"
              [end]="data.end"
              [issuedAt]="issuedAt"
              [issuerName]="issuerName()"
              [notes]="data.notes"
              [company]="data.company"
              [branding]="branding()"
              [bankAccounts]="bankAccounts()"
            ></app-client-statement-document>
          } @else {
            <app-summary-statement-document
              [rows]="data.rows"
              [start]="data.start"
              [end]="data.end"
              [issuedAt]="issuedAt"
              [issuerName]="issuerName()"
              [notes]="data.notes"
              [company]="data.company"
              [branding]="branding()"
            ></app-summary-statement-document>
          }
        </div>
      }

      <!-- Telemóvel: acções lado a lado, com rótulos curtos (o "fechar" está no cabeçalho). -->
      <div shellFooter class="grid gap-2 sm:flex sm:justify-end" [class.grid-cols-3]="data.kind === 'client'" [class.grid-cols-2]="data.kind !== 'client'">
        <button mat-stroked-button class="preview-action" (click)="download()" [disabled]="isLoading() || isGeneratingPdf()">
          <mat-icon>picture_as_pdf</mat-icon>
          <span class="sm:hidden">PDF</span>
          <span class="hidden sm:inline">{{ 'reports.preview.downloadPdf' | t }}</span>
        </button>
        <button mat-stroked-button class="preview-action" (click)="print()" [disabled]="isLoading() || isGeneratingPdf()">
          <mat-icon>print</mat-icon>
          {{ 'common.actions.print' | t }}
        </button>
        @if (data.kind === 'client') {
          <button mat-stroked-button class="preview-action" (click)="sendEmail()"
            [disabled]="isLoading() || isGeneratingPdf() || !data.statement.client.email"
            [title]="data.statement.client.email ? ('reports.preview.sendTo' | t: { email: data.statement.client.email }) : ('reports.preview.noEmailTooltip' | t)">
            <mat-icon>email</mat-icon>
            <span class="sm:hidden">E-mail</span>
            <span class="hidden sm:inline">{{ 'reports.preview.sendEmail' | t }}</span>
          </button>
        }
      </div>
    </app-dialog-shell>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .preview-action { height: 3rem !important; border-radius: .75rem !important; min-width: 0 !important; padding: 0 .5rem !important; }
    @media (min-width: 600px) { .preview-action { padding: 0 1rem !important; } }

    /* Telemóvel: a tabela do extracto encolhe para caber na largura em vez de ficar cortada. */
    @media (max-width: 599.98px) {
      :host ::ng-deep .statement-table { font-size: 10px; }
      :host ::ng-deep .statement-table th,
      :host ::ng-deep .statement-table td { padding: 4px 3px !important; white-space: normal !important; overflow-wrap: anywhere; }
    }
  `]
})
export class StatementPreviewDialogComponent implements OnInit {
  data = inject<StatementPreviewData>(MAT_DIALOG_DATA);
  private dialogRef = inject(MatDialogRef<StatementPreviewDialogComponent>);
  private authService = inject(AuthService);
  private documentSettings = inject(DocumentSettingsService);
  private pdfService = inject(PdfService);
  private auditLogService = inject(AuditLogService);
  private snackBar = inject(MatSnackBar);
  private supabase = inject(SupabaseService);
  private bankAccountService = inject(CompanyBankAccountService);

  branding = signal<DocumentBranding>(DEFAULT_DOCUMENT_BRANDING);
  bankAccounts = signal<CompanyBankAccount[] | null>(null);
  issuerName = signal('');
  isLoading = signal(true);
  isGeneratingPdf = signal(false);

  readonly issuedAt = toIsoDate(new Date());

  async ngOnInit() {
    try {
      const [branding, profile, bankAccounts] = await Promise.all([
        this.documentSettings.resolve(this.data.company.id),
        this.authService.getCurrentProfile(),
        this.bankAccountService.list(this.data.company.id)
      ]);
      this.branding.set(branding);
      this.bankAccounts.set(bankAccounts);

      const user = this.authService.currentUser();
      this.issuerName.set(
        profile?.full_name || user?.user_metadata?.['full_name'] || user?.email || ''
      );
    } catch (error) {
      console.error('Erro ao preparar o extracto:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  private fileName(): string {
    if (this.data.kind === 'client') {
      const client = this.data.statement.client;
      const id = (client.client_code || client.name).replace(/[^\w-]+/g, '_');
      return `Extracto_${id}_${this.data.start}_a_${this.data.end}`;
    }
    return `Extracto_Clientes_${this.data.start}_a_${this.data.end}`;
  }

  private generate(): Promise<Blob> {
    return this.pdfService.generatePdf('statement-document', this.fileName(), { marginMm: 10 });
  }

  private logExport(format: 'PDF' | 'Impressão') {
    const data = this.data;
    const isClient = data.kind === 'client';
    const label = isClient ? 'Extracto do Cliente' : 'Extracto Geral';

    this.auditLogService.log(
      format === 'PDF' ? `Exportou ${label} para PDF` : `Imprimiu ${label}`,
      'reports',
      {
        start_date: data.start,
        end_date: data.end,
        records_count: isClient ? data.statement.movements.length : data.rows.length
      },
      isClient ? data.statement.client.id : undefined,
      isClient ? data.statement.client.name : undefined,
      data.company.id
    );
  }

  async download() {
    try {
      this.isGeneratingPdf.set(true);
      const blob = await this.generate();
      await this.pdfService.downloadPdf(blob, this.fileName());
      this.logExport('PDF');
    } catch (error) {
      console.error('Erro ao gerar o extracto em PDF:', error);
      this.snackBar.open(t('reports.preview.pdfError'), t('common.actions.close'), { duration: 4000 });
    } finally {
      this.isGeneratingPdf.set(false);
    }
  }

  async print() {
    try {
      this.isGeneratingPdf.set(true);
      const blob = await this.generate();
      // A WebView do Android não imprime janelas novas: abre a partilha (inclui imprimir).
      if (Capacitor.isNativePlatform()) {
        await this.pdfService.downloadPdf(blob, this.fileName());
        return;
      }
      const url = window.URL.createObjectURL(blob);
      const printWindow = window.open(url);

      if (printWindow) {
        printWindow.onload = () => printWindow.print();
        this.logExport('Impressão');
      } else {
        this.snackBar.open(
          t('reports.preview.printBlocked'),
          t('common.actions.close'),
          { duration: 5000 }
        );
      }
    } catch (error) {
      console.error('Erro ao preparar a impressão do extracto:', error);
      this.snackBar.open(t('reports.preview.printError'), t('common.actions.close'), { duration: 4000 });
    } finally {
      this.isGeneratingPdf.set(false);
    }
  }

  /**
   * Envia o extracto ao cliente. Os valores da mensagem são recalculados no
   * servidor; do browser só segue o PDF e a identificação do extracto.
   */
  async sendEmail() {
    const data = this.data;
    if (data.kind !== 'client') return;

    const email = data.statement.client.email;
    if (!email) {
      this.snackBar.open(t('reports.preview.noEmail'), t('common.actions.close'), { duration: 4000 });
      return;
    }

    try {
      this.isGeneratingPdf.set(true);
      const blob = await this.generate();
      const pdfBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
      });

      const { data: result, error } = await this.supabase.client.functions.invoke('send-invoice-email', {
        body: {
          document_kind: 'extracto',
          company_id: data.company.id,
          client_id: data.statement.client.id,
          start_date: data.start,
          end_date: data.end,
          pdf_base64: pdfBase64
        }
      });

      if (error) throw new Error(await this.errorMessage(error));
      if (result && result.success === false) throw new Error(result.error || t('reports.preview.sendRejected'));

      this.auditLogService.log(
        'Enviou Extracto do Cliente por E-mail',
        'reports',
        { start_date: data.start, end_date: data.end, email },
        data.statement.client.id,
        data.statement.client.name,
        data.company.id
      );

      this.snackBar.open(t('reports.preview.sent', { email }), t('common.actions.close'), { duration: 5000 });
    } catch (error) {
      console.error('Erro ao enviar o extracto:', error);
      const message = error instanceof Error && error.message ? error.message : t('reports.preview.sendError');
      this.snackBar.open(message, t('common.actions.close'), { duration: 6000 });
    } finally {
      this.isGeneratingPdf.set(false);
    }
  }

  /** A resposta da função vem dentro do erro do supabase-js. */
  private async errorMessage(error: unknown): Promise<string> {
    const context = (error as { context?: unknown })?.context;
    if (context instanceof Response) {
      try {
        const body = await context.clone().json();
        if (body?.error) return body.error;
      } catch {
        // Sem corpo JSON: fica a mensagem genérica.
      }
    }
    return error instanceof Error && error.message ? error.message : t('reports.preview.sendError');
  }

  close() {
    this.dialogRef.close();
  }
}
