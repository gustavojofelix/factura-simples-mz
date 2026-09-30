import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Company } from '../../core/services/company.service';
import { AuthService } from '../../core/services/auth.service';
import { PdfService } from '../../core/services/pdf.service';
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
    ClientStatementDocumentComponent
  ],
  template: `
    <h2 mat-dialog-title class="flex items-center justify-between">
      <span>{{ data.kind === 'client' ? 'Extracto do Cliente' : 'Extracto dos Clientes' }}</span>
      <button mat-icon-button (click)="close()">
        <mat-icon>close</mat-icon>
      </button>
    </h2>

    <mat-dialog-content>
      @if (isLoading()) {
        <div class="text-center py-8">
          <mat-spinner diameter="36" class="mx-auto mb-3"></mat-spinner>
          <p class="text-gray-500">A carregar...</p>
        </div>
      } @else {
        <div id="statement-document" class="bg-white relative">
          @if (isGeneratingPdf()) {
            <div class="absolute inset-0 bg-white/80 z-50 flex flex-col items-center justify-center">
              <mat-spinner diameter="36" class="mb-2"></mat-spinner>
              <p class="text-sm font-medium text-gray-600">A gerar PDF...</p>
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
    </mat-dialog-content>

    <mat-dialog-actions align="end" class="!gap-2 !px-6 !pb-4">
      <button mat-stroked-button (click)="download()" [disabled]="isLoading() || isGeneratingPdf()">
        <mat-icon>picture_as_pdf</mat-icon>
        Descarregar PDF
      </button>
      <button mat-stroked-button (click)="print()" [disabled]="isLoading() || isGeneratingPdf()">
        <mat-icon>print</mat-icon>
        Imprimir
      </button>
    </mat-dialog-actions>
  `
})
export class StatementPreviewDialogComponent implements OnInit {
  data = inject<StatementPreviewData>(MAT_DIALOG_DATA);
  private dialogRef = inject(MatDialogRef<StatementPreviewDialogComponent>);
  private authService = inject(AuthService);
  private documentSettings = inject(DocumentSettingsService);
  private pdfService = inject(PdfService);
  private auditLogService = inject(AuditLogService);
  private snackBar = inject(MatSnackBar);

  branding = signal<DocumentBranding>(DEFAULT_DOCUMENT_BRANDING);
  issuerName = signal('');
  isLoading = signal(true);
  isGeneratingPdf = signal(false);

  readonly issuedAt = toIsoDate(new Date());

  async ngOnInit() {
    try {
      const [branding, profile] = await Promise.all([
        this.documentSettings.resolve(this.data.company.id),
        this.authService.getCurrentProfile()
      ]);
      this.branding.set(branding);

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
      this.pdfService.downloadPdf(blob, this.fileName());
      this.logExport('PDF');
    } catch (error) {
      console.error('Erro ao gerar o extracto em PDF:', error);
      this.snackBar.open('Não foi possível gerar o extracto em PDF.', 'Fechar', { duration: 4000 });
    } finally {
      this.isGeneratingPdf.set(false);
    }
  }

  async print() {
    try {
      this.isGeneratingPdf.set(true);
      const blob = await this.generate();
      const url = window.URL.createObjectURL(blob);
      const printWindow = window.open(url);

      if (printWindow) {
        printWindow.onload = () => printWindow.print();
        this.logExport('Impressão');
      } else {
        this.snackBar.open(
          'Não foi possível abrir a janela de impressão. Verifique se o navegador está a bloquear janelas.',
          'Fechar',
          { duration: 5000 }
        );
      }
    } catch (error) {
      console.error('Erro ao preparar a impressão do extracto:', error);
      this.snackBar.open('Não foi possível preparar a impressão.', 'Fechar', { duration: 4000 });
    } finally {
      this.isGeneratingPdf.set(false);
    }
  }

  close() {
    this.dialogRef.close();
  }
}
