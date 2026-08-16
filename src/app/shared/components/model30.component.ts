import { Component, Inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TaxDeclaration } from '../../core/services/tax.service';
import { CompanyService, Company } from '../../core/services/company.service';
import { PdfService } from '../../core/services/pdf.service';

@Component({
  selector: 'app-model30',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <!-- Toolbar (no-print) -->
    <div class="no-print toolbar">
      <div style="display:flex; align-items:center; gap:12px;">
        <mat-icon style="color:#f16c39;">description</mat-icon>
        <h2 style="margin:0; font-size:16px; font-weight:700;">Modelo 30 — Declaração Periódica ISPC</h2>
        <span style="font-size:12px; color:#666; margin-left:4px;">{{ data.declaration.period }}º Trimestre {{ data.declaration.year }}</span>
      </div>
      <div style="display:flex; gap:8px; align-items:center;">
        <button mat-stroked-button (click)="downloadPdf()" [disabled]="isGeneratingPdf()" style="gap:6px;">
          <mat-icon>picture_as_pdf</mat-icon> {{ isGeneratingPdf() ? 'A gerar PDF...' : 'Descarregar PDF' }}
        </button>
        <button mat-icon-button (click)="close()" style="color:#666;"><mat-icon>close</mat-icon></button>
      </div>
    </div>

    <div id="model30-document" class="print-scroll-area">
      @if (company()) {
        <!-- ============================================================ -->
        <!-- PAGE 1                                                        -->
        <!-- ============================================================ -->
        <div class="page">

          <!-- HEADER -->
          <div class="header-grid">
            <div class="header-logo">
              <img src="assets/escudomozambique.png" alt="Escudo de Moçambique" style="width:70px; height:70px;">
            </div>
            <div class="header-center">
              <div class="header-center-top">
                <p>República de Moçambique</p>
                <p>Ministério das Finanças</p>
                <p><strong>Autoridade Tributária de Moçambique</strong></p>
                <p>DIRECÇÃO GERAL DE IMPOSTOS</p>
              </div>
              <div class="header-center-bottom">
                <p class="decl-periodica">DECLARAÇÃO PERIÓDICA</p>
                <p class="modelo-30">MODELO 30</p>
              </div>
            </div>
            <div class="header-ispc">
              <p class="ispc-title">ISPC</p>
              <div class="ispc-subtitle">
                <p>IMPOSTO SIMPLIFICADO</p>
                <p>PARA PEQUENOS</p>
                <p>CONTRIBUINTES</p>
              </div>
            </div>
          </div>

          <div class="instruction-bar">SE PREENCHER MANUALMENTE, POR FAVOR UTILIZE LETRA DE IMPRENSA</div>

          <!-- QUADRO 1 -->
          <div class="section-header">1 – TIPO DE DECLARAÇÃO</div>
          <div class="section-body q1-body">
            <label class="check-label"><span class="chk">☐</span> Declaração inicial</label>
            <label class="check-label" style="margin-left:auto;"><span class="chk">☐</span> Declaração de Substituição</label>
          </div>

          <!-- QUADROS 2 + 3 -->
          <div class="two-col-row">
            <div class="two-col-left">
              <div class="section-header">2 – PERÍODO A QUE RESPEITA</div>
              <div class="section-body q2-body">
                <div class="q2-period-row">
                  <div class="digit-group">
                    @for (d of getMonthDigits(); track $index) {
                      <div class="digit-box">{{ d }}</div>
                    }
                    <span class="digit-label">(Mês)</span>
                  </div>
                  <div class="digit-group" style="margin-left:6px;">
                    @for (d of getYearDigits(); track $index) {
                      <div class="digit-box">{{ d }}</div>
                    }
                    <span class="digit-label">(Ano)</span>
                  </div>
                  <div class="trimestre-group">
                    <div class="trimestre-line">{{ data.declaration.period }}</div>
                    <span class="digit-label">Trimestre</span>
                  </div>
                </div>
                <div class="q2-check-row">
                  <label class="check-label"><span class="chk">☑</span> Dentro do Prazo</label>
                  <label class="check-label" style="margin-top:3px;"><span class="chk">☐</span> Fora do Prazo</label>
                </div>
              </div>
            </div>
            <div class="two-col-right">
              <div class="section-header">3 – NÚMERO ÚNICO DE IDENTIFICAÇÃO TRIBUTÁRIA (NUIT)</div>
              <div class="section-body q3-body">
                <div class="nuit-row">
                  @for (d of getNuitDigits(); track $index) {
                    <div class="digit-box">{{ d }}</div>
                  }
                </div>
                <div class="q3-footer">
                  <span>Unidade de Cobrança <span class="dotted-line" style="width:80px; display:inline-block;"></span></span>
                  <span style="margin-left:10px;">Código
                    <span style="display:inline-flex; gap:2px; margin-left:4px;">
                      @for (i of [0,1,2,3]; track i) { <div class="digit-box small"></div> }
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- QUADRO 4 -->
          <div class="section-header">4 – NOME/DESIGNAÇÃO SOCIAL</div>
          <div class="section-body q4-body">
            <div class="dotted-field">{{ company()!.name }}</div>
          </div>

          <!-- QUADRO 5 -->
          <div class="section-header">5– DESIGNAÇÃO DA ACTIVIDADE PRINCIPAL</div>
          <div class="section-body q5-body">
            <div class="q5-row">
              <div class="dotted-field" style="flex:1;">{{ company()!.category1 || '' }}</div>
              <div class="cae-group">
                <span class="cae-label">Código de Actividade<br>Económica (CAE)</span>
                <span style="display:inline-flex; gap:2px; margin-left:6px;">
                  @for (i of [0,1,2,3,4,5]; track i) { <div class="digit-box small"></div> }
                </span>
              </div>
            </div>
          </div>

          <!-- QUADRO 6 -->
          <div class="section-header">6 – DOMICÍLIO FISCAL DA ACTIVIDADE</div>
          <div class="section-body q6-body">
            <div class="q6-line">
              <span>Rua / Avenida/<span class="dotted-field-inline" style="min-width:160px;">{{ company()!.address }}</span> :</span>
              <span class="dotted-field-inline" style="min-width:80px;"></span>
              <span>Nº: <span class="dotted-field-inline" style="width:28px;"></span></span>
              <span>Andar: <span class="dotted-field-inline" style="width:24px;"></span></span>
              <span>Flat: <span class="dotted-field-inline" style="width:28px;"></span></span>
              <span>Código Postal: <span class="dotted-field-inline" style="width:40px;"></span></span>
              <span>Caixa Postal: <span class="dotted-field-inline" style="width:40px;"></span></span>
            </div>
            <div class="q6-line">
              <span>Província: <span class="dotted-field-inline" style="min-width:180px;">{{ company()!.documents_metadata?.province || '' }}</span></span>
              <label class="check-label" style="margin-left:10px;"><span class="chk">☐</span> Distrito /</label>
              <label class="check-label" style="margin-left:4px;"><span class="chk">☐</span> Município: <span class="dotted-field-inline" style="min-width:160px;">{{ company()!.documents_metadata?.district || '' }}</span></label>
            </div>
            <div class="q6-line">
              <label class="check-label"><span class="chk">☐</span> Posto Administrativo /</label>
              <label class="check-label" style="margin-left:4px;"><span class="chk">☐</span> Distrito Municipal: <span class="dotted-field-inline" style="min-width:120px;">{{ company()!.documents_metadata?.administrativePost || '' }}</span></label>
              <span style="margin-left:10px;">Localidade: <span class="dotted-field-inline" style="min-width:120px;"></span></span>
            </div>
            <div class="q6-line">
              <span>Bairro: <span class="dotted-field-inline" style="min-width:140px;"></span></span>
              <span style="margin-left:10px;">Povoação: <span class="dotted-field-inline" style="min-width:80px;"></span></span>
              <span style="margin-left:10px;">Célula: <span class="dotted-field-inline" style="width:40px;"></span></span>
              <span style="margin-left:10px;">Quarteirão: <span class="dotted-field-inline" style="width:40px;"></span></span>
              <span style="margin-left:10px;">Nº da casa: <span class="dotted-field-inline" style="width:40px;"></span></span>
            </div>
            <div class="q6-line">
              <span>Tel. Fixo: <span class="dotted-field-inline" style="min-width:130px;"></span></span>
              <span style="margin-left:10px;">Telemóvel: <span class="dotted-field-inline" style="min-width:130px;">{{ company()!.phone || '' }}</span></span>
              <span style="margin-left:10px;">Fax: <span class="dotted-field-inline" style="min-width:80px;"></span></span>
            </div>
            <div class="q6-line">
              <span>E-mail: <span class="dotted-field-inline" style="min-width:180px;">{{ company()!.email || '' }}</span></span>
              <span style="margin-left:10px;">E-mail alternativo: <span class="dotted-field-inline" style="min-width:140px;"></span></span>
            </div>
          </div>

          <!-- QUADRO 7 -->
          <div class="section-header">7 – INEXISTÊNCIA DE OPERAÇÕES</div>
          <div class="section-body q7-body">
            Se no período a que esta declaração respeita não realizou operações activas nem passiva, assinale
            <span class="chk" style="display:inline-block; margin: 0 4px;">{{ data.declaration.total_sales === 0 ? '☑' : '☐' }}</span>
            e passa para o quadro 11
          </div>
        </div>

        <!-- ============================================================ -->
        <!-- PAGE 2                                                        -->
        <!-- ============================================================ -->
        <div class="page page-break">

          <!-- QUADRO 8 -->
          <div class="section-header">8 – TAXAS DO ISPC</div>
          <div class="section-body">
            <div class="q8-sub-header">8.1 - TAXAS SOBRE TRANSMISSÃO DE BENS</div>
            <div class="q8-check-line">
              <label class="check-label"><span class="chk">{{ isBensRate(3) ? '☑' : '☐' }}</span> 3% para o volume de negócios anual ≤ 1.000.000,00MT</label>
            </div>
            <div class="q8-check-line">
              <label class="check-label"><span class="chk">{{ isBensRate(4) ? '☑' : '☐' }}</span> 4% para o volume de negócios anual &lt; 1.000.000,00MT ≥ 2.500.000,00MT</label>
            </div>
            <div class="q8-check-line">
              <label class="check-label"><span class="chk">{{ isBensRate(5) ? '☑' : '☐' }}</span> 5% para o volume de negócios anual &lt; 2.500.000,00MT ≤ 4.000.000,00MT.</label>
            </div>
            <div class="q8-sub-header" style="margin-top:4px;">8.2 -TAXAS SOBRE PRESTAÇÃO DE SERVIÇOS</div>
            <div class="q8-check-line">
              <label class="check-label"><span class="chk">{{ isServicosRate(12) ? '☑' : '☐' }}</span> 12% para prestação de serviços tais como, canalização, carpintaria, pedreiro, electricista, barbearia, jardinagem, mecânica</label>
            </div>
            <div class="q8-check-line">
              <label class="check-label"><span class="chk">{{ isServicosRate(15) ? '☑' : '☐' }}</span> 15% para prestação de serviços de profissões liberais, tais como, advogados, economistas, geólogos, engenheiros, contabilistas.</label>
            </div>
          </div>

          <!-- QUADRO 9 -->
          <div class="section-header">9 – APURAMENTO DO IMPOSTO</div>
          <div class="section-body" style="padding:0;">
            <table class="q9-table">
              <colgroup>
                <col style="width: 45%;">
                <col style="width: 6%;">
                <col style="width: 24%;">
                <col style="width: 6%;">
                <col style="width: 19%;">
              </colgroup>
              <thead>
                <tr>
                  <th></th>
                  <th colspan="2" class="q9-col-header">Valor Respeitante ao trimestre</th>
                  <th colspan="2" class="q9-col-header">Valor acumulado no ano</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td class="q9-label">Volume das vendas e/ou serviços prestados<span class="dots"></span></td>
                  <td class="q9-num-cell">01</td>
                  <td class="q9-value-cell">{{ formatAmount(field01) }}</td>
                  <td class="q9-num-cell">06</td>
                  <td class="q9-value-cell">{{ formatAmount(field06) }}</td>
                </tr>
                <tr>
                  <td class="q9-label">Imposto liquidado<span class="dots"></span></td>
                  <td class="q9-num-cell">02</td>
                  <td class="q9-value-cell">{{ formatAmount(field02) }}</td>
                  <td class="q9-num-cell">07</td>
                  <td class="q9-value-cell">{{ formatAmount(field07) }}</td>
                </tr>
                <tr>
                  <td class="q9-label">Excesso do volume de vendas (20%)<span class="dots"></span></td>
                  <td class="q9-num-cell">03</td>
                  <td class="q9-value-cell">{{ field03 > 0 ? formatAmount(field03) : '' }}</td>
                  <td class="q9-num-cell">08</td>
                  <td class="q9-value-cell">{{ field08 > 0 ? formatAmount(field08) : '' }}</td>
                </tr>
                <tr>
                  <td class="q9-label">Tributação sobre o excesso de volume de vendas<br>(alínea d) do nº1 do artigo 8, Código do ISPC)<span class="dots"></span></td>
                  <td class="q9-num-cell">04</td>
                  <td class="q9-value-cell">{{ field04 > 0 ? formatAmount(field04) : '' }}</td>
                  <td class="q9-num-cell">09</td>
                  <td class="q9-value-cell">{{ field09 > 0 ? formatAmount(field09) : '' }}</td>
                </tr>
                <tr class="q9-total-row">
                  <td class="q9-label"><strong>Total do imposto liquidado</strong> (05 = 02 + 04)</td>
                  <td class="q9-num-cell">05</td>
                  <td class="q9-value-cell"><strong>{{ formatAmount(field05) }}</strong></td>
                  <td></td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- QUADRO 10 -->
          <div class="section-header">10 - LIQUIDAÇÃO ADICIONAL (A EFECTUAR NO IV TRIMESTRE)</div>
          <div class="section-body" style="padding:0;">
            <table class="q10-table">
              <thead>
                <tr>
                  <th></th>
                  <th class="q9-col-header">Volume de negócios anual</th>
                  <th></th>
                  <th class="q9-col-header">Taxa de imposto</th>
                  <th></th>
                  <th class="q9-col-header">Imposto</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td class="q9-num-cell">10</td>
                    <td class="q9-value-cell">{{ data.declaration.period === 4 ? formatAmount(field10) : '' }}</td>
                  <td class="q9-num-cell">11</td>
                    <td class="q9-value-cell">{{ data.declaration.period === 4 ? (field11 + '%') : '' }}</td>
                  <td class="q9-num-cell">12</td>
                    <td class="q9-value-cell">{{ data.declaration.period === 4 ? formatAmount(field12) : '' }}</td>
                </tr>
                <tr>
                  <td colspan="4" class="q9-label" style="text-align:right; padding-right:8px;">
                    Imposto corrigido (13 = 12 - 7)<span class="dots"></span>
                  </td>
                  <td class="q9-num-cell">13</td>
                    <td class="q9-value-cell">{{ formatAmount(field13) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- ============================================================ -->
        <!-- PAGE 3                                                        -->
        <!-- ============================================================ -->
        <div class="page page-break">

          <!-- QUADRO 11 -->
          <div class="section-header">11 - IMPOSTO A ENTRGAR AO ESTADO</div>
          <div class="section-body" style="padding:0;">
            <div class="q11-grid">
              <div class="q11-left">
                <div class="q11-row">
                  <span class="q11-label">ISPC (14=5+13)</span>
                  <span class="q11-num">14</span>
                  <div class="q11-value-box">{{ formatAmount(field14) }}</div>
                  <span class="q11-dash">-</span>
                </div>
                <div class="q11-row">
                  <span class="q11-label">Juros compensatórios</span>
                  <span class="q11-num">15</span>
                  <div class="q11-value-box">{{ formatAmount(field15) }}</div>
                  <span class="q11-dash">-</span>
                </div>
                <div class="q11-row q11-total">
                  <span class="q11-label">Importância a pagar (16=14+15)</span>
                  <span class="q11-num">16</span>
                  <div class="q11-value-box highlight">{{ formatAmount(field16) }}</div>
                </div>
              </div>
              <div class="q11-right">
                <div class="q11-payment-header"><strong>MEIO DE PAGAMENTO</strong></div>
                <label class="check-label q11-pay-line"><span class="chk">☐</span> Numerário</label>
                <label class="check-label q11-pay-line"><span class="chk">☐</span> Transferência: Referência <span class="dotted-field-inline" style="min-width:80px;"></span></label>
                <label class="check-label q11-pay-line"><span class="chk">☐</span> Cheque nº <span class="dotted-field-inline" style="min-width:70px;"></span> Banco <span class="dotted-field-inline" style="min-width:70px;"></span></label>
                <div class="q11-pay-line" style="padding-left:18px;">Agência <span class="dotted-field-inline" style="min-width:80px;"></span> Nº de Conta <span class="dotted-field-inline" style="min-width:80px;"></span></div>
                <label class="check-label q11-pay-line"><span class="chk">☐</span> Outros <span class="dotted-field-inline" style="min-width:120px;"></span></label>
              </div>
            </div>
          </div>

          <!-- QUADROS 12 + 13 -->
          <div class="two-col-row q12-13-outer">
            <div class="q12-box">
              <div class="section-header">12 - AUTENTICAÇÃO DO SUJEITO PASSIVO</div>
              <div class="section-body q12-body">
                <p>A presente declaração corresponde à verdade<br>e não omite qualquer informação solicitada.</p>
                <p class="q12-field">Data: <span class="dotted-field-inline" style="width:16px;"></span>/<span class="dotted-field-inline" style="width:16px;"></span>/ 20<span class="dotted-field-inline" style="width:30px;"></span></p>
                <p class="q12-field">Nome:<span class="dotted-field-inline" style="min-width:160px;"></span></p>
                <div class="q12-sig-line"></div>
                <p class="q12-caption">(Assinatura do Sujeito Passivo e carimbo)</p>
              </div>
            </div>
            <div class="q13-box">
              <div class="section-header">13 - USO EXCLUSIVO DOS SERVIÇOS</div>
              <div class="q13-inner-grid">
                <div class="q13-col">
                  <p class="q13-field">Nº de entrada <span class="dotted-field-inline" style="min-width:70px;"></span></p>
                  <p class="q13-field">Nº de inserção <span class="dotted-field-inline" style="min-width:70px;"></span></p>
                  <p class="q13-field">Data: <span class="dotted-field-inline" style="width:14px;"></span>/<span class="dotted-field-inline" style="width:14px;"></span>/ 20<span class="dotted-field-inline" style="width:26px;"></span></p>
                  <p class="q13-field">Nome:<span class="dotted-field-inline" style="min-width:80px;"></span></p>
                  <div class="q12-sig-line"></div>
                  <p class="q12-caption">(Assinatura do funcionário e carimbo)</p>
                </div>
                <div class="q13-col" style="border-left:1px solid #000; padding-left:8px;">
                  <p class="q13-field">Nº de Receita <span class="dotted-field-inline" style="min-width:70px;"></span></p>
                  <p class="q13-field">Data: <span class="dotted-field-inline" style="width:14px;"></span>/<span class="dotted-field-inline" style="width:14px;"></span> 20<span class="dotted-field-inline" style="width:26px;"></span></p>
                  <p class="q13-field">Nome:<span class="dotted-field-inline" style="min-width:80px;"></span></p>
                  <div class="q12-sig-line"></div>
                  <p class="q12-caption">(Assinatura do recebedor e carimbo)</p>
                </div>
              </div>
            </div>
          </div>

          <!-- PAYMENTS TABLE (if any) -->
          @if (data.declaration.payments && data.declaration.payments.length > 0) {
            <div class="payments-section">
              <h3 class="payments-title">COMPROVATIVO DE PAGAMENTOS</h3>
              <table class="payments-table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Método</th>
                    <th>Referência</th>
                    <th style="text-align:right;">Valor (MZN)</th>
                  </tr>
                </thead>
                <tbody>
                  @for (payment of data.declaration.payments; track payment.id) {
                    <tr>
                      <td>{{ formatDate(payment.payment_date) }}</td>
                      <td>{{ payment.payment_method || '-' }}</td>
                      <td>{{ payment.reference || '-' }}</td>
                      <td style="text-align:right;">{{ formatAmount(payment.amount) }}</td>
                    </tr>
                  }
                  <tr class="payments-total">
                    <td colspan="3" style="text-align:right;">TOTAL PAGO:</td>
                    <td style="text-align:right;">{{ formatAmount(getTotalPaid()) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          }
        </div>

        <!-- ============================================================ -->
        <!-- PAGE 4 – INSTRUÇÕES DE PREENCHIMENTO                         -->
        <!-- ============================================================ -->
        <div class="page page-break instructions-page">
          <div class="inst-title">INSTRUÇÕES DE PREENCHIMENTO</div>
          <div class="inst-subtitle">Declaração Periódica - ISPC<br>MODELO 30</div>
          <div class="inst-columns">
            <div class="inst-col">
              <p>Esta declaração deve ser preenchida com a utilização de uma máquina de escrever ou de qualquer outro processo mecânico descrita ou ainda através de impressora de computador, se para isso se instalarem os programas de impressão adequados.</p>
              <p>Se tal não for todo possível deve utilizar-se esferográfica a escrever-se de forma legível.</p>
              <p>Em cada quadrícula só deve ser inscrito um algarismo, devendo o valor, representado por conjunto de algarismos, ser totalmente encostado à direita.</p>
              <p><strong>Quadro 1</strong><br>Este quadro destina-se à indicação do tipo de declaração, inicial ou de substituição, consoante o caso.</p>
              <p><strong>Quadro 2</strong><br>1. Indicar o mês e o ano referente a submissão a declaração 2. Indicar o trimestre a que respeita a declaração. 3. Assinalar com x a quadrícula correspondente ao estado da declaração, considerando o prazo da entrega legalmente estabelecido.</p>
              <p><strong>Quadro 3</strong><br>1. Indicar o número único de identificação tributária do sujeito passivo declarante. 2. Indicar o código da unidade de cobrança que se encontra adstrito o sujeito passivo declarante.</p>
              <p><strong>Quadro 4</strong><br>Indicar o nome e/ou denominação social da firma do sujeito passivo declarante, legalmente autorizado.</p>
              <p><strong>Quadro 5</strong><br>1. Indicar a designação da actividade principal do sujeito passivo 2. Indicar o Código de Actividade Económica (CAE).</p>
              <p><strong>Quadro 06</strong><br>Identificar de forma detalhada o endereço do exercício da actividade do sujeito passivo, indicando todos os elementos de localização solicitados no quadro.</p>
              <p><strong>Quadro 7</strong><br>Assinalar com "x" na quadrícula se no período a que se refere a declaração não tiver realizado qualquer operação activa bem como passiva.</p>
              <p><strong>Quadro 8</strong><br>Indicação da taxa aplicável do ISPC em função do volume de negócio ou a natureza da actividade (prestação de serviços).</p>
              <p><strong>Quadro 9</strong><br>Este quadro destina-se ao apuramento do imposto do período a que respeita a declaração e deverá ser preenchido com base nos elementos que o sujeito passivo disponha nos registos contabilístico.</p>
            </div>
            <div class="inst-col">
              <p><strong>Campo 01:</strong> indicar o montante do volume de vendas e/ou das prestações de serviços realizados pelo sujeito passivo durante o período a que se refere a declaração, incluindo as vendas de investimento que tenham sido utilizados na actividade da empresa. <strong>Campo 02:</strong> indicar o valor do imposto liquidado consoante a taxa aplicável, considerando o volume de venda inscrito no campo 1. <strong>Campo 03:</strong> quando no decurso do exercício da sua actividade o sujeito passivo exceder o volume de negócio de 4.000.000,00MT previstos para o ISPC, deverá indicar o montante do excesso neste campo. <strong>Campo 04:</strong> liquidação do imposto à taxa de 20% sobre o excesso inscrito no campo 03. <strong>Campo 05:</strong> indicação do imposto liquidado no trimestre, com base na soma dos campos 02 e 04, caso sujeito passivo tenha excedido o volume de negócio.</p>
              <p><strong>Campo 06:</strong> correspondente ao cumulativo do volume de vendas ao longo do exercício fiscal, referente a soma dos campos 01 ao longo dos trimestres. <strong>Campo 07:</strong> corresponde ao cumulativo do montante do imposto pago ao longo dos trimestres. <strong>Campo 08:</strong> indica o cumulativo dos montantes referentes ao excesso do volume de negócio ao longo dos trimestres, caso sujeito passivo tenha excedido o volume de negócio. <strong>Campo 09:</strong> corresponde o valor acumulado do imposto pago em virtude do sujeito passivo ter excedido o volume do negócio em sede do ISPC.</p>
              <p><strong>Quadro 10</strong><br>A preencher no quarto trimestre. O preenchimento deste quadro resultará na liquidação adicional do imposto na última declaração a ser submetida no final do exercício em conformidade com o volume de negócios acumulado efectivamente registado.</p>
              <p><strong>Campo 10:</strong> corresponde o volume anual de negócios acumulados ao longo do exercício fiscal. <strong>Campo 11:</strong> indica a taxa do imposto correspondente ao volume de negócios acumulado ao longo do ano. <strong>Campo 12:</strong> corresponde ao imposto liquidado com base no volume de negócios acumulado ao longo do ano. <strong>Campo 13:</strong> corresponde o ajuste do imposto que resulta da diferença entre os campos 12 e 07.</p>
              <p><strong>Quadro 11</strong><br>Este quadro destina-se à indicação do imposto a entregar ao Estado.</p>
              <p><strong>Campo 14:</strong> indica o imposto a pagar no trimestre. <strong>Campo 15:</strong> corresponde aos juros compensatórios, pelo pagamento fora do prazo legalmente previsto. <strong>Campo 16:</strong> indica a importância a pagar.</p>
              <p><strong>Quadro 12</strong> indicação da data e assinatura do sujeito passivo, autenticação da declaração pelo sujeito passivo.</p>
              <p><strong>Quadro 13</strong><br>espaço a ser preenchido pela administração fiscal.</p>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }

    /* ——— Toolbar ——— */
    .toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 20px;
      border-bottom: 2px solid #e8e8e8;
      background: #fff;
      flex-shrink: 0;
      z-index: 10;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }

    /* ——— Scroll area ——— */
    .print-scroll-area {
      padding: 24px;
      flex: 1;
      overflow-y: auto;
      background: #cdd1d6;
    }

    /* ——— Page ——— */
    .page {
      width: 210mm;
      height: 297mm;
      min-height: 0;
      margin: 0 auto 20px;
      background: #fff;
      border: 1px solid #999;
      box-shadow: 0 2px 8px rgba(0,0,0,0.18);
      font-family: 'Times New Roman', serif;
      font-size: 8pt;
      padding: 8mm;
      box-sizing: border-box;
    }

    /* ——— Header ——— */
    .header-grid {
      display: grid;
      grid-template-columns: 90px 1fr 110px;
      border: 2px solid #000;
      margin-bottom: 0;
    }
    .header-logo {
      border-right: 2px solid #000;
      padding: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #FFFEF0;
    }
    .header-center {
      border-right: 2px solid #000;
      display: flex;
      flex-direction: column;
    }
    .header-center-top {
      flex: 1;
      padding: 6px;
      text-align: center;
      background: #FFFEF0;
    }
    .header-center-top p { margin: 1px 0; font-size: 9pt; }
    .header-center-bottom {
      padding: 4px;
      text-align: center;
      background: #FFFF00;
      border-top: 1px solid #000;
    }
    .decl-periodica { font-size: 9pt; font-weight: bold; margin: 0; }
    .modelo-30 { font-size: 18pt; font-weight: bold; margin: 2px 0 0; }
    .header-ispc {
      padding: 6px;
      text-align: center;
      background: #FFFEF0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .ispc-title { font-size: 22pt; font-weight: bold; margin: 0; line-height: 1; }
    .ispc-subtitle { margin-top: 4px; border-top: 1px solid #999; padding-top: 3px; }
    .ispc-subtitle p { font-size: 7pt; font-weight: bold; margin: 0; line-height: 1.3; }

    .instruction-bar {
      background: #fff;
      border: 2px solid #000;
      border-top: none;
      text-align: center;
      font-size: 7.5pt;
      font-weight: bold;
      padding: 2px 4px;
    }

    /* ——— Section headers (yellow) ——— */
    .section-header {
      background: #FFFF99;
      border: 1px solid #000;
      border-top: none;
      padding: 3px 6px;
      font-size: 8.5pt;
      font-weight: bold;
    }

    /* ——— Generic section body ——— */
    .section-body {
      border: 1px solid #000;
      border-top: none;
      padding: 4px 6px;
      font-size: 8pt;
    }

    /* ——— Quadro 1 ——— */
    .q1-body { display: flex; align-items: center; min-height: 22px; }

    /* ——— Two-col row ——— */
    .two-col-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
    }
    .two-col-left { border-right: 1px solid #000; }
    .two-col-right {}

    /* ——— Quadro 2 ——— */
    .q2-body { padding: 4px 6px; }
    .q2-period-row { display: flex; align-items: flex-end; gap: 4px; margin-bottom: 6px; }
    .digit-group { display: flex; align-items: flex-end; }
    .digit-label { font-size: 6.5pt; margin-left: 2px; margin-bottom: 2px; }
    .trimestre-group { margin-left: 10px; display: flex; flex-direction: column; align-items: center; }
    .trimestre-line {
      border-bottom: 1px solid #000;
      min-width: 40px;
      text-align: center;
      font-size: 9pt;
      font-weight: bold;
      padding-bottom: 1px;
    }
    .q2-check-row { display: flex; flex-direction: column; gap: 2px; }

    /* ——— Quadro 3 ——— */
    .q3-body { padding: 4px 6px; }
    .nuit-row { display: flex; gap: 2px; margin-bottom: 4px; }
    .q3-footer { font-size: 7.5pt; display: flex; align-items: center; border-top: 1px dotted #000; padding-top: 2px; }

    /* ——— Digit boxes ——— */
    .digit-box {
      flex: 0 0 16px;
      width: 16px;
      height: 18px;
      box-sizing: border-box;
      border: 1px solid #000;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 9pt;
      line-height: 16px;
      padding: 0;
      font-weight: bold;
      text-align: center;
      vertical-align: middle;
      overflow: hidden;
      letter-spacing: 0;
      font-variant-numeric: tabular-nums;
    }
    .digit-box.small {
      flex-basis: 13px;
      width: 13px;
      height: 15px;
      font-size: 7.5pt;
      line-height: 13px;
    }

    /* ——— Checkboxes ——— */
    .chk {
      font-size: 9pt;
      line-height: 1;
    }
    .check-label {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 8pt;
    }

    /* ——— Dotted fields ——— */
    .dotted-field {
      border-bottom: 1px dotted #000;
      min-height: 14px;
      padding: 1px 2px;
      font-size: 8pt;
    }
    .dotted-field-inline {
      border-bottom: 1px dotted #000;
      display: inline-block;
      padding: 0 2px;
      vertical-align: bottom;
      font-size: 8pt;
    }
    .dotted-line {
      border-bottom: 1px dotted #000;
    }

    /* ——— Quadro 4 ——— */
    .q4-body { padding: 4px 6px; }

    /* ——— Quadro 5 ——— */
    .q5-body { padding: 4px 6px; }
    .q5-row { display: flex; align-items: center; gap: 8px; }
    .cae-group { display: flex; align-items: center; white-space: nowrap; font-size: 7.5pt; }
    .cae-label { font-size: 7pt; text-align: right; }

    /* ——— Quadro 6 ——— */
    .q6-body { padding: 3px 6px; }
    .q6-line { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px; margin-bottom: 3px; font-size: 7.5pt; }

    /* ——— Quadro 7 ——— */
    .q7-body { padding: 4px 6px; font-size: 8pt; }

    /* ——— Quadro 8 ——— */
    .q8-sub-header {
      font-size: 8pt;
      font-weight: bold;
      background: #e8e8e8;
      padding: 2px 8px;
      margin-bottom: 2px;
    }
    .q8-check-line { padding: 2px 8px; }

    /* ——— Quadro 9 table ——— */
    .q9-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 7.5pt;
    }
    .q9-table thead th { padding: 3px 4px; border: 1px solid #000; background: #e8e8e8; text-align: center; font-size: 7.5pt; }
    .q9-col-header { border: 1px solid #000; padding: 3px; background: #f5f5f5; text-align: center; }
    .q9-label { padding: 3px 6px; border: 1px solid #000; }
    .q9-num-cell {
      border: 1px solid #000;
      background: #d0d0d0;
      text-align: center;
      font-weight: bold;
      width: 22px;
      padding: 2px;
    }
    .q9-value-cell { border: 1px solid #000; padding: 2px 6px; text-align: right; }
    .q9-total-row td { border-top: 2px solid #000; background: #f0f0f0; }
    .dots::after { content: '...................................................'; font-size: 6pt; letter-spacing: -1px; }

    /* ——— Quadro 10 table ——— */
    .q10-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 7.5pt;
    }
    .q10-table thead th { padding: 3px 4px; border: 1px solid #000; background: #e8e8e8; text-align: center; }
    .q10-table td { border: 1px solid #000; padding: 3px 6px; }

    /* ——— Quadro 11 ——— */
    .q11-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
    }
    .q11-left { border-right: 1px solid #000; padding: 6px; }
    .q11-right { padding: 6px; }
    .q11-row { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
    .q11-label { flex: 1; font-size: 7.5pt; }
    .q11-num {
      background: #d0d0d0;
      border: 1px solid #000;
      font-weight: bold;
      width: 20px;
      height: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 8pt;
    }
    .q11-value-box {
      border: 1px solid #000;
      min-width: 80px;
      height: 18px;
      padding: 0 6px;
      text-align: right;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      font-size: 8pt;
    }
    .q11-value-box.highlight { background: #e8e8e8; font-weight: bold; min-width: 90px; }
    .q11-dash { font-size: 9pt; }
    .q11-total .q11-value-box { border: 2px solid #000; }
    .q11-payment-header { font-size: 8pt; text-align: center; margin-bottom: 4px; }
    .q11-pay-line { font-size: 7.5pt; margin-bottom: 4px; }

    /* ——— Quadro 12 + 13 ——— */
    .q12-13-outer { border: 1px solid #000; border-top: none; }
    .q12-box { border-right: 1px solid #000; }
    .q13-box {}
    .q12-body { padding: 6px; font-size: 7.5pt; }
    .q12-body p { margin: 3px 0; }
    .q12-field { margin: 6px 0; }
    .q12-sig-line { border-bottom: 1px dotted #000; margin: 6px 0 2px; height: 18px; }
    .q12-caption { font-size: 7pt; color: #444; margin: 0; }
    .q13-inner-grid { display: grid; grid-template-columns: 1fr 1fr; padding: 6px; gap: 6px; }
    .q13-col { font-size: 7.5pt; }
    .q13-field { margin: 3px 0; }

    /* ——— Payments table ——— */
    .payments-section { margin-top: 12px; border: 2px solid #000; padding: 8px; }
    .payments-title { font-size: 9pt; font-weight: bold; margin: 0 0 6px; }
    .payments-table { width: 100%; border-collapse: collapse; font-size: 8pt; }
    .payments-table th, .payments-table td { border: 1px solid #000; padding: 3px 6px; }
    .payments-table th { background: #e8e8e8; font-weight: bold; }
    .payments-total { font-weight: bold; background: #FFFF99; }

    /* ——— Instructions page ——— */
    .instructions-page { padding: 10mm; }
    .inst-title { text-align: center; font-size: 10pt; font-weight: bold; margin-bottom: 2px; }
    .inst-subtitle { text-align: center; font-size: 9pt; margin-bottom: 12px; }
    .inst-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .inst-col p { font-size: 7.5pt; margin: 0 0 6px; text-align: justify; }

    /* ——— Print styles ——— */
    @media print {
      .no-print { display: none !important; }
      .print-scroll-area {
        max-height: none !important;
        overflow: visible !important;
        padding: 0 !important;
        background: transparent !important;
      }
      .page {
        margin: 0 auto !important;
        border: none !important;
        box-shadow: none !important;
        padding: 10mm !important;
      }
      .page-break { page-break-before: auto; }
      @page { size: A4 portrait; margin: 0; }
      html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
      .page { width: 210mm !important; height: 297mm !important; min-height: 297mm !important; margin: 0 !important; padding: 8mm !important; overflow: hidden !important; break-after: page; page-break-after: always; }
      .page:last-child { break-after: auto; page-break-after: auto; }
    }
  `]
})
export class Model30Component implements OnInit {
  company = signal<Company | null>(null);
  isGeneratingPdf = signal(false);

  field01 = 0;
  field02 = 0;
  field03 = 0;
  field04 = 0;
  field05 = 0;
  field06 = 0;
  field07 = 0;
  field08 = 0;
  field09 = 0;
  field10 = 0;
  field11 = 0;
  field12 = 0;
  field13 = 0;
  field14 = 0;
  field15 = 0;
  field16 = 0;

  constructor(
    public dialogRef: MatDialogRef<Model30Component>,
    @Inject(MAT_DIALOG_DATA) public data: { declaration: TaxDeclaration },
    private companyService: CompanyService,
    private pdfService: PdfService
  ) {}

  ngOnInit() {
    this.company.set(this.companyService.activeCompany());
    this.calculateFields();
  }

  calculateFields() {
    const decl = this.data.declaration;
    this.field01 = decl.total_sales || 0;

    const model = decl.model_30_data || {};
    this.field06 = model.annual_sales || 0;
    this.field07 = model.annual_normal_tax || 0;
    this.field08 = model.annual_excess_base || 0;
    this.field09 = model.annual_excess_tax || 0;
    this.field10 = model.annual_sales || 0;
    this.field11 = model.effective_rate || decl.ispc_rate || 0;
    this.field12 = model.annual_tax || 0;

    const splits = decl.ispc_splits || [];
    const normalSplits = splits.filter((s: any) => s.rate !== 20);
    const excessSplits = splits.filter((s: any) => s.rate === 20);

    this.field02 = model.normal_tax_period ?? normalSplits.reduce((sum: number, s: any) => sum + (s.amount || 0), 0);
    this.field03 = model.excess_base_period ?? excessSplits.reduce((sum: number, s: any) => sum + (s.base || 0), 0);
    this.field04 = model.excess_tax_period ?? excessSplits.reduce((sum: number, s: any) => sum + (s.amount || 0), 0);
    this.field05 = this.field02 + this.field04;

    // If no splits available, fall back to stored ispc_amount
    if (splits.length === 0) {
      this.field02 = decl.ispc_amount || 0;
      this.field05 = this.field02;
    }

    this.field13 = this.field12 > 0 ? this.field12 - this.field07 : 0;
    this.field14 = this.field05 + this.field13;
    this.field15 = 0;
    this.field16 = this.field14 + this.field15;
  }

  getMonthDigits(): string[] {
    const quarterStartMonths: { [key: number]: string } = { 1: '01', 2: '04', 3: '07', 4: '10' };
    const month = quarterStartMonths[this.data.declaration.period] || '01';
    return month.split('');
  }

  getYearDigits(): string[] {
    return this.data.declaration.year.toString().split('');
  }

  getNuitDigits(): string[] {
    const nuit = this.company()?.nuit || '';
    return nuit.padStart(9, ' ').split('');
  }

  isBensRate(rate: number): boolean {
    const c = this.company();
    if (!c) return false;
    const cat2 = c.category2;
    if (cat2 === 'servicos_nao_liberais' || cat2 === 'servicos_liberais') return false;
    return this.data.declaration.ispc_rate === rate;
  }

  isServicosRate(rate: number): boolean {
    const c = this.company();
    if (!c) return false;
    if (rate === 12 && c.category2 === 'servicos_nao_liberais') return true;
    if (rate === 15 && c.category2 === 'servicos_liberais') return true;
    return false;
  }

  formatDate(dateString?: string): string {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('pt-MZ', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    });
  }

  formatAmount(value: number): string {
    if (!value && value !== 0) return '';
    return new Intl.NumberFormat('pt-MZ', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  }

  getTotalPaid(): number {
    return (this.data.declaration.payments || []).reduce((sum, p) => sum + p.amount, 0);
  }

  async downloadPdf() {
    if (this.isGeneratingPdf()) return;

    try {
      this.isGeneratingPdf.set(true);
      const blob = await this.pdfService.generateMultiPagePdf('model30-document');
      const period = this.data.declaration.period;
      const year = this.data.declaration.year;
      this.pdfService.downloadPdf(blob, `Modelo_30_${year}_T${period}`);
    } catch (error) {
      console.error('Erro ao gerar o PDF do Modelo 30:', error);
      window.alert('Não foi possível gerar o PDF. Por favor, tente novamente.');
    } finally {
      this.isGeneratingPdf.set(false);
    }
  }

  print() { window.print(); }
  close() { this.dialogRef.close(); }
}
