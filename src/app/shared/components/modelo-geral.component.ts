import { Component, Inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TaxDeclaration } from '../../core/services/tax.service';
import { CompanyService, Company } from '../../core/services/company.service';
import { PdfService } from '../../core/services/pdf.service';
import { ModeloGeralExcelService } from '../../core/services/modelo-geral-excel.service';
import {
  computeModeloGeralFields, formatModeloGeralRate, ModeloGeralFields
} from '../../core/utils/modelo-geral-fields';
import { getModel30PaymentMethodLabel } from '../../core/utils/model30-fields';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

/**
 * Declaração Modelo Geral (M/G) preenchida para o ISPC do trimestre.
 * Indicada temporariamente pela AT (Comunicado n.º 9/2026) em vez do Modelo 30.
 * O documento fiscal fica sempre em português.
 */
@Component({
  selector: 'app-modelo-geral',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, TranslatePipe],
  template: `
    <div class="no-print toolbar">
      <div style="display:flex; align-items:center; gap:12px;">
        <mat-icon style="color:#f16c39;">description</mat-icon>
        <h2 style="margin:0; font-size:16px; font-weight:700;">{{ 'taxes.modeloGeral.title' | t }}</h2>
        <span style="font-size:12px; color:#666; margin-left:4px;">{{ 'taxes.model30.periodLine' | t: { period: data.declaration.period, year: data.declaration.year } }}</span>
      </div>
      <div style="display:flex; gap:8px; align-items:center;">
        <button mat-stroked-button (click)="downloadExcel()" [disabled]="isGeneratingExcel()" style="gap:6px;">
          <mat-icon>table_view</mat-icon> {{ (isGeneratingExcel() ? 'taxes.model30.generatingExcel' : 'taxes.model30.downloadExcel') | t }}
        </button>
        <button mat-stroked-button (click)="downloadPdf()" [disabled]="isGeneratingPdf()" style="gap:6px;">
          <mat-icon>picture_as_pdf</mat-icon> {{ (isGeneratingPdf() ? 'taxes.model30.generatingPdf' : 'taxes.model30.downloadPdf') | t }}
        </button>
        <button mat-icon-button (click)="close()" style="color:#666;" [attr.aria-label]="'common.actions.close' | t"><mat-icon>close</mat-icon></button>
      </div>
    </div>

    <div class="no-print notice">
      <mat-icon>info</mat-icon>
      <span>{{ 'taxes.modeloGeral.notice' | t }}</span>
    </div>

    <div id="modelo-geral-document" class="print-scroll-area">
      @if (company() && f) {
        <!-- ============================ PÁGINA 1 ============================ -->
        <div class="page">
          <div class="top-note">SE PREENCHER MANUALMENTE, POR FAVOR UTILIZE LETRA DE IMPRENSA</div>

          <div class="header-grid">
            <div class="header-logo">
              <img src="assets/escudomozambique.png" alt="Escudo de Moçambique" style="width:58px; height:58px;">
              <div class="header-org">
                <p>República de Moçambique</p>
                <p>Ministério da Economia e Finanças</p>
                <p><strong>Autoridade Tributária de Moçambique</strong></p>
                <p>DIRECÇÃO GERAL DE IMPOSTOS</p>
              </div>
            </div>
            <div class="header-title">DECLARAÇÃO MODELO GERAL</div>
            <div class="header-code">M/G</div>
          </div>

          <!-- QUADRO 1 -->
          <div class="section-header">1 – TIPO DE DECLARAÇÃO</div>
          <div class="section-body q1-body">
            <span class="opt"><span class="box">X</span> Declaração Inicial</span>
            <span class="opt"><span class="box"></span> Declaração de Substituição</span>
          </div>

          <!-- QUADROS 2 + 3 -->
          <div class="two-col">
            <div class="col-left">
              <div class="section-header">2 – PERÍODO A QUE RESPEITA</div>
              <div class="section-body">
                <div class="period-row">
                  <div class="field-box center" style="width:42px;">{{ f.month }}</div>
                  <div class="field-box center" style="width:70px;">{{ f.year }}</div>
                </div>
                <div class="period-labels"><span style="width:42px;">(Mês)</span><span style="width:70px;">(Ano)</span></div>
                <div class="opt-line"><span class="box">{{ f.late ? '' : 'X' }}</span> 1. Entrega dentro do Prazo</div>
                <div class="opt-line"><span class="box">{{ f.late ? 'X' : '' }}</span> 2. Entrega fora do Prazo</div>
              </div>
            </div>
            <div class="col-right">
              <div class="section-header">3 – NUIT</div>
              <div class="section-body">
                <div class="nuit-row">
                  @for (d of nuitDigits(); track $index) {
                    <div class="digit-box"><span>{{ d }}</span></div>
                  }
                </div>
                <div class="area-label">Área Fiscal/UGC</div>
                <div class="dotted fill" style="min-height:16px;"></div>
              </div>
            </div>
          </div>

          <!-- QUADRO 5 -->
          <div class="section-header">5 – NOME/DESIGNAÇÃO SOCIAL DO SUJEITO PASSIVO</div>
          <div class="section-body">
            <div class="fill name-fill">{{ company()!.name }}</div>
          </div>

          <!-- QUADRO 6 -->
          <div class="section-header">6 – DOMICÍLIO FISCAL DO SUJEITO PASSIVO</div>
          <div class="section-body q6">
            <div class="q6-line">
              <span>Rua/Avenida:</span><span class="dotted fill grow">{{ company()!.address }}</span>
              <span>N.º:</span><span class="dotted fill w40"></span>
              <span>Andar:</span><span class="dotted fill w30"></span>
              <span>Flat:</span><span class="dotted fill w30"></span>
              <span>Código Postal:</span><span class="dotted fill w50">{{ company()!.postal_code || '' }}</span>
              <span>Caixa Postal:</span><span class="dotted fill w40"></span>
            </div>
            <div class="q6-line">
              <span>Província:</span><span class="dotted fill grow">{{ company()!.documents_metadata?.province || '' }}</span>
              <span>Distrito / Município:</span><span class="dotted fill grow">{{ company()!.documents_metadata?.district || '' }}</span>
            </div>
            <div class="q6-line">
              <span>Posto Administrativo / Distrito Municipal:</span><span class="dotted fill grow">{{ company()!.documents_metadata?.administrativePost || '' }}</span>
              <span>Localidade:</span><span class="dotted fill grow"></span>
            </div>
            <div class="q6-line">
              <span>Bairro:</span><span class="dotted fill grow"></span>
              <span>Povoação:</span><span class="dotted fill w60"></span>
              <span>Célula:</span><span class="dotted fill w40"></span>
              <span>Quarteirão:</span><span class="dotted fill w40"></span>
              <span>N.º da casa:</span><span class="dotted fill w40"></span>
            </div>
            <div class="q6-line">
              <span>Tel. Fixo:</span><span class="dotted fill grow"></span>
              <span>Telemóvel:</span><span class="dotted fill grow">{{ company()!.phone || '' }}</span>
              <span>Fax:</span><span class="dotted fill grow"></span>
            </div>
            <div class="q6-line">
              <span>E-mail:</span><span class="dotted fill grow">{{ company()!.email || '' }}</span>
              <span>E-mail alternativo:</span><span class="dotted fill grow"></span>
            </div>
          </div>

          <!-- QUADRO 8 -->
          <div class="section-header">8 – APURAMENTO DO MATERIAL COLECTÁVEL</div>
          <div class="section-body q8">
            <table class="q8-table">
              <colgroup>
                <col style="width:34%;"><col style="width:5%;"><col style="width:20%;">
                <col style="width:11%;"><col style="width:5%;"><col style="width:25%;">
              </colgroup>
              <thead>
                <tr>
                  <th class="col-head">DESCRIÇÃO DA RECEITA</th>
                  <th colspan="2" class="col-head">BASE TRIBUTÁVEL</th>
                  <th class="col-head">TAXA</th>
                  <th colspan="2" class="col-head">Montante apurado</th>
                </tr>
              </thead>
              <tbody>
                @for (i of [0, 1, 2, 3]; track i) {
                  <tr>
                    <td class="desc fill">{{ f.lines[i]?.description || '' }}</td>
                    <td class="code">0{{ i + 1 }}</td>
                    <td class="amount fill">{{ f.lines[i] ? money(f.lines[i].base) : '' }}</td>
                    <td class="rate fill">{{ f.lines[i] ? rate(f.lines[i].rate) : '' }}</td>
                    <td class="code">0{{ i + 5 }}</td>
                    <td class="amount">{{ f.lines[i] ? money(f.lines[i].amount) : '' }}</td>
                  </tr>
                }
                <tr>
                  <td colspan="4" class="subtotal-label">SUBTOTAL-1</td>
                  <td class="code">09</td>
                  <td class="amount strong">{{ money(f.subtotal1) }}</td>
                </tr>
              </tbody>
            </table>

            <table class="q8-table second">
              <colgroup><col style="width:59%;"><col style="width:5%;"><col style="width:25%;"><col style="width:11%;"></colgroup>
              <thead>
                <tr>
                  <th class="col-head">DESCRIÇÃO DA RECEITA</th>
                  <th colspan="2" class="col-head">Montante apurado</th>
                  <th class="blank"></th>
                </tr>
              </thead>
              <tbody>
                @for (i of [0, 1, 2, 3]; track i) {
                  <tr>
                    <td class="desc fill">{{ f.otherLines[i]?.description || '' }}</td>
                    <td class="code">{{ 10 + i }}</td>
                    <td class="amount fill">{{ f.otherLines[i] ? money(f.otherLines[i].amount) : '' }}</td>
                    <td class="blank"></td>
                  </tr>
                }
                <tr>
                  <td class="subtotal-label">SUBTOTAL-2</td>
                  <td class="code">14</td>
                  <td class="amount strong">{{ f.otherLines.length ? money(f.subtotal2) : '' }}</td>
                  <td class="blank"></td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- QUADRO 10 -->
          <div class="section-header">10 – MONTANTE A ENTREGAR AO ESTADO</div>
          <div class="section-body q10">
            <div class="q10-left">
              <div class="q10-row"><span class="q10-label">Montante apurado</span><span class="code-chip">07</span><span class="value-box">{{ money(f.amountDue) }}</span></div>
              <div class="q10-row"><span class="q10-label">Juros compensatórios</span><span class="code-chip">08</span><span class="value-box fill">{{ money(f.interest) }}</span></div>
            </div>
            <div class="q10-right">
              <div class="pay-title">MEIO DE PAGAMENTO</div>
              <div class="opt-line"><span class="box">{{ f.paymentMethod === 'numerario' ? 'X' : '' }}</span> Numerário</div>
              <div class="opt-line"><span class="box">{{ f.paymentMethod === 'cheque' ? 'X' : '' }}</span> Cheque n.º <span class="dotted fill grow">{{ f.paymentMethod === 'cheque' ? f.paymentReference : '' }}</span> Banco <span class="dotted fill grow"></span></div>
              <div class="opt-line"><span class="box"></span> Agência <span class="dotted fill grow"></span> N.º conta <span class="dotted fill grow"></span></div>
              <div class="opt-line"><span class="box">{{ f.paymentMethod === 'outros' ? 'X' : '' }}</span> Outros <span class="dotted fill grow">{{ f.paymentOther }}{{ f.paymentMethod === 'outros' && f.paymentReference ? ' — Ref. ' + f.paymentReference : '' }}</span></div>
            </div>
            <div class="q10-total">
              <span>IMPORTÂNCIA A PAGAR</span><span class="code-chip">09</span><span class="value-box strong">{{ money(f.total) }}</span>
            </div>
          </div>
        </div>

        <!-- ============================ PÁGINA 2 ============================ -->
        <div class="page page-break">
          <div class="section-header" style="border-top:1px solid #000;">11 – USO EXCLUSIVO DOS SERVIÇOS</div>
          <div class="q11">
            <div class="q11-col">
              <p>A presente declaração corresponde à verdade e não omite qualquer informação pedida.</p>
              <p class="q11-field">Data: <span class="dotted fill grow"></span></p>
              <p class="q11-field">Nome: <span class="dotted fill grow"></span></p>
              <p class="q11-field">Ass.: <span class="sig grow"></span></p>
            </div>
            <div class="q11-col">
              <p><strong>N.º de Receita</strong></p>
              <div class="sig" style="margin:14px 0 10px;"></div>
              <p>Data: ___/___/20____</p>
              <p style="text-align:center; margin-top:26px;">O RECEBEDOR</p>
            </div>
            <div class="q11-col">
              <p><strong>N.º de Entrada</strong> <span class="sig grow"></span></p>
              <p><strong>N.º de Inserção</strong> <span class="sig grow"></span></p>
              <p>Data: ___/___/20____</p>
              <p style="text-align:center;">Nome do funcionário</p>
              <div class="dotted" style="margin-top:14px;"></div>
              <p style="text-align:center;">Assinatura</p>
            </div>
          </div>

          @if (data.declaration.payments && data.declaration.payments.length > 0) {
            <div class="payments">
              <div class="payments-title">COMPROVATIVO DE PAGAMENTOS</div>
              <table class="payments-table">
                <thead>
                  <tr><th>Data</th><th>Método</th><th>Referência</th><th style="text-align:right;">Valor (MZN)</th></tr>
                </thead>
                <tbody>
                  @for (p of data.declaration.payments; track p.id) {
                    <tr>
                      <td>{{ date(p.payment_date) }}</td>
                      <td>{{ paymentMethodLabel(p.payment_method) }}</td>
                      <td>{{ p.reference || '-' }}</td>
                      <td style="text-align:right;">{{ money(p.amount) }}</td>
                    </tr>
                  }
                  <tr class="payments-total">
                    <td colspan="3" style="text-align:right;">TOTAL PAGO:</td>
                    <td style="text-align:right;">{{ money(totalPaid()) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          }

          <div class="instructions">
            <div class="inst-title">COMO PREENCHER O MODELO GERAL (M/G) PARA O ISPC</div>
            <p>A Declaração Modelo Geral (M/G), aprovada pelo Decreto n.º 63/2022, de 25 de Novembro, é indicada pela AT para declarar e pagar o ISPC enquanto não existir mecanismo próprio (Comunicado n.º 9/2026). Preencha em letra de imprensa.</p>
            <p><strong>Quadro 1 – Tipo de declaração.</strong> Assinale «Declaração Inicial». A de Substituição serve apenas para corrigir uma declaração já entregue.</p>
            <p><strong>Quadro 2 – Período a que respeita.</strong> Mês e ano do período declarado (preenchido com o último mês do trimestre) e se a entrega é dentro ou fora do prazo. Confirme junto da AT o mês a indicar para o trimestre.</p>
            <p><strong>Quadro 3 – NUIT e Área Fiscal.</strong> NUIT do contribuinte (9 dígitos) e a Área Fiscal ou UGC onde está registado.</p>
            <p><strong>Quadros 5 e 6 – Identificação.</strong> Nome ou designação social e domicílio fiscal completo, tal como constam do registo na AT.</p>
            <p><strong>Quadro 8 – Apuramento.</strong> Descrição da receita (ISPC e trimestre), base tributável no campo 01, taxa do escalão e montante apurado no campo 05; o total repete-se no Subtotal-1 (09). Se no trimestre houver mais de uma taxa (mudança de escalão ou excesso), usa-se uma linha por taxa. Os campos 10 a 14 (Subtotal-2) são para receitas sem base tributável: não se aplicam ao ISPC e ficam em branco.</p>
            <p><strong>Quadro 10 – Montante a entregar.</strong> Montante apurado (07), juros compensatórios (08, só se fora do prazo), importância a pagar (09) e o meio de pagamento.</p>
            <p><strong>Quadro 11 – Assinatura.</strong> Data, nome e assinatura do declarante. Os restantes campos são de uso exclusivo da AT.</p>
            <p><strong>Antes de entregar.</strong> Entrega fora do prazo: assinale a opção 2 no Quadro 2 e inclua os juros compensatórios no campo 08. Mais de uma actividade: aplica-se a taxa da actividade tributada à taxa mais elevada. Depois de pagar, conserve a declaração e o comprovativo de pagamento.</p>
            <p class="generated">Gerado pelo ISPC Fácil em {{ today }} — {{ data.declaration.period }}.º trimestre de {{ data.declaration.year }}</p>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }

    .toolbar {
      display: flex; justify-content: space-between; align-items: center;
      padding: 10px 20px; border-bottom: 2px solid #e8e8e8; background: #fff;
      flex-shrink: 0; z-index: 10; box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    .notice {
      display: flex; align-items: center; gap: 8px; padding: 8px 20px;
      background: #fff8e1; color: #6d4c00; font-size: 13px; border-bottom: 1px solid #f0e0b0;
    }
    .notice mat-icon { font-size: 18px; width: 18px; height: 18px; }

    .print-scroll-area { padding: 24px; flex: 1; overflow-y: auto; background: #cdd1d6; }

    .page {
      width: 210mm; margin: 0 auto 20px; background: #fff; border: 1px solid #999;
      box-shadow: 0 2px 8px rgba(0,0,0,0.18); font-family: Arial, Helvetica, sans-serif;
      font-size: 7.5pt; color: #000; padding: 8mm; box-sizing: border-box;
    }

    .top-note { text-align: center; font-weight: bold; font-size: 7pt; margin-bottom: 4px; }

    .header-grid { display: grid; grid-template-columns: 2.2fr 2fr 1fr; border: 1.5px solid #000; }
    .header-logo { display: flex; align-items: center; gap: 8px; padding: 6px; border-right: 1.5px solid #000; }
    .header-org { flex: 1; text-align: center; }
    .header-org p { margin: 0; font-size: 7.5pt; line-height: 1.25; }
    .header-title { display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 10pt; border-right: 1.5px solid #000; text-align: center; padding: 4px; }
    .header-code { display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 12pt; background: #e4dfec; }

    .section-header {
      background: #e4dfec; border: 1px solid #000; border-top: none;
      padding: 3px 6px; font-weight: bold; font-size: 8pt;
    }
    .section-body { border: 1px solid #000; border-top: none; padding: 4px 6px; }

    .fill { background: #fff6dc; color: #1f3a93; }
    .dotted { border-bottom: 1px dotted #000; display: inline-block; min-height: 12px; padding: 0 3px; vertical-align: bottom; }
    .grow { flex: 1; min-width: 40px; }
    .w30 { width: 30px; } .w40 { width: 40px; } .w50 { width: 50px; } .w60 { width: 60px; }

    .box {
      display: inline-flex; align-items: center; justify-content: center;
      width: 14px; height: 14px; border: 1px solid #000; background: #fff6dc;
      font-weight: bold; font-size: 8pt; color: #1f3a93; margin-right: 4px; vertical-align: middle;
    }
    .opt { display: inline-flex; align-items: center; }
    .opt-line { display: flex; align-items: center; gap: 4px; margin: 3px 0; }

    .q1-body { display: flex; justify-content: space-between; align-items: center; padding: 4px 6px; }

    .two-col { display: grid; grid-template-columns: 1fr 1fr; }
    .col-left .section-body, .col-left .section-header { border-right: none; }
    .period-row { display: flex; gap: 6px; }
    .period-labels { display: flex; gap: 6px; font-size: 6.5pt; margin: 1px 0 4px; }
    .period-labels span { text-align: center; }
    .field-box { border: 1px solid #000; height: 16px; display: flex; align-items: center; padding: 0 4px; background: #fff6dc; color: #1f3a93; font-weight: bold; }
    .field-box.center { justify-content: center; }

    .nuit-row { display: inline-flex; gap: 2px; margin: 2px 0 6px; }
    .digit-box {
      flex: 0 0 16px; width: 16px; height: 18px; box-sizing: border-box; border: 1px solid #000;
      display: inline-flex; align-items: center; justify-content: center; font-weight: bold;
      font-size: 9pt; background: #fff6dc; color: #1f3a93; font-family: Arial, sans-serif;
    }
    .area-label { font-weight: bold; text-align: center; margin-bottom: 2px; }

    .name-fill { min-height: 16px; padding: 2px 4px; font-weight: bold; }

    .q6 { padding: 3px 6px; }
    .q6-line { display: flex; align-items: flex-end; gap: 4px; margin: 3px 0; white-space: nowrap; }

    .q8 { padding: 6px; }
    .q8-table { width: 100%; border-collapse: separate; border-spacing: 0 4px; table-layout: fixed; }
    .q8-table.second { margin-top: 6px; }
    .col-head { border: 1px solid #000; font-weight: bold; text-align: center; padding: 3px; background: #fff; }
    .q8-table td { padding: 2px 4px; height: 15px; }
    .q8-table .desc { border-bottom: 1px dotted #000; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .code { background: #d9d9d9; border: 1px solid #000; text-align: center; font-weight: bold; }
    .amount { border: 1px solid #000; border-left: none; text-align: right; }
    .rate { border: 1px solid #000; text-align: center; }
    .strong { font-weight: bold; }
    .subtotal-label { text-align: right; font-weight: bold; padding-right: 8px !important; }
    .blank { border: none; background: transparent; }

    .q10 { display: grid; grid-template-columns: 1fr 1.4fr; gap: 6px 14px; padding: 6px; }
    .q10-row { display: flex; align-items: center; gap: 6px; margin: 4px 0; }
    .q10-label { flex: 1; }
    .code-chip { background: #d9d9d9; border: 1px solid #000; font-weight: bold; padding: 1px 4px; }
    .value-box { border: 1px solid #000; min-width: 100px; height: 16px; display: inline-flex; align-items: center; justify-content: flex-end; padding: 0 6px; }
    .pay-title { font-weight: bold; text-align: center; margin-bottom: 2px; }
    .q10-total { grid-column: 1 / -1; display: flex; justify-content: flex-end; align-items: center; gap: 6px; font-weight: bold; margin-top: 4px; }

    .q11 { display: grid; grid-template-columns: 1.2fr 1fr 1fr; border: 1px solid #000; border-top: none; }
    .q11-col { padding: 6px; }
    .q11-col + .q11-col { border-left: 1px solid #000; }
    .q11-col p { margin: 4px 0; }
    .q11-field { display: flex; align-items: flex-end; gap: 4px; margin-top: 10px !important; }
    .sig { display: inline-block; border-bottom: 1px solid #000; min-height: 12px; min-width: 60px; }

    .payments { margin-top: 12px; border: 1px solid #000; padding: 6px; }
    .payments-title { font-weight: bold; font-size: 8pt; margin-bottom: 4px; }
    .payments-table { width: 100%; border-collapse: collapse; }
    .payments-table th, .payments-table td { border: 1px solid #000; padding: 2px 5px; }
    .payments-table th { background: #e4dfec; }
    .payments-total { font-weight: bold; background: #e4dfec; }

    .instructions { margin-top: 14px; border: 1px solid #000; padding: 8px 10px; }
    .inst-title { font-weight: bold; font-size: 9pt; text-align: center; margin-bottom: 6px; }
    .instructions p { margin: 0 0 5px; text-align: justify; line-height: 1.35; }
    .instructions .generated { font-style: italic; color: #666; margin-top: 8px; text-align: left; }

    @media print {
      .no-print { display: none !important; }
      .print-scroll-area { overflow: visible !important; padding: 0 !important; background: transparent !important; }
      @page { size: A4 portrait; margin: 0; }
      .page { margin: 0 !important; border: none !important; box-shadow: none !important; break-after: page; page-break-after: always; }
      .page:last-child { break-after: auto; page-break-after: auto; }
    }
  `]
})
export class ModeloGeralComponent implements OnInit {
  company = signal<Company | null>(null);
  isGeneratingPdf = signal(false);
  isGeneratingExcel = signal(false);
  f: ModeloGeralFields | null = null;
  readonly today = new Date().toLocaleDateString('pt-MZ', { day: '2-digit', month: '2-digit', year: 'numeric' });

  constructor(
    public dialogRef: MatDialogRef<ModeloGeralComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { declaration: TaxDeclaration },
    private companyService: CompanyService,
    private pdfService: PdfService,
    private excel: ModeloGeralExcelService
  ) {}

  ngOnInit() {
    this.company.set(this.companyService.activeCompany());
    this.f = computeModeloGeralFields(this.data.declaration, this.company());
  }

  nuitDigits(): string[] {
    return (this.company()?.nuit || '').padEnd(9, ' ').slice(0, 9).split('');
  }

  money(value: number | null | undefined): string {
    if (value === null || value === undefined) return '';
    return new Intl.NumberFormat('pt-MZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  }

  rate(value: number): string {
    return formatModeloGeralRate(value);
  }

  date(value?: string): string {
    if (!value) return '-';
    return new Date(value).toLocaleDateString('pt-MZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  totalPaid(): number {
    return (this.data.declaration.payments || []).reduce((sum, p) => sum + p.amount, 0);
  }

  paymentMethodLabel(method: string | null | undefined): string {
    return getModel30PaymentMethodLabel(method);
  }

  async downloadPdf() {
    if (this.isGeneratingPdf()) return;
    try {
      this.isGeneratingPdf.set(true);
      const blob = await this.pdfService.generateMultiPagePdf('modelo-geral-document');
      const { period, year } = this.data.declaration;
      await this.pdfService.downloadPdf(blob, `Modelo_Geral_MG_ISPC_${year}_T${period}`);
    } catch (error) {
      console.error('Erro ao gerar o PDF do Modelo Geral:', error);
      window.alert(t('taxes.model30.pdfError'));
    } finally {
      this.isGeneratingPdf.set(false);
    }
  }

  async downloadExcel() {
    if (this.isGeneratingExcel()) return;
    const company = this.company();
    if (!company) return;
    try {
      this.isGeneratingExcel.set(true);
      await this.excel.export(this.data.declaration, company);
    } catch (error) {
      console.error('Erro ao gerar o Excel do Modelo Geral:', error);
      window.alert(t('taxes.declarations.excelError'));
    } finally {
      this.isGeneratingExcel.set(false);
    }
  }

  close() { this.dialogRef.close(); }
}
