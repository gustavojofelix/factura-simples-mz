import { Component, Inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TaxDeclaration } from '../../core/services/tax.service';
import { CompanyService } from '../../core/services/company.service';
import { Company } from '../../core/services/company.service';

@Component({
  selector: 'app-model30',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule
  ],
  template: `
    <div class="no-print flex justify-between items-center p-4 border-b bg-gray-50">
      <h2 class="text-xl font-bold">Modelo 30 - ISPC</h2>
      <div class="flex gap-2">
        <button mat-raised-button color="primary" (click)="print()">
          <mat-icon>print</mat-icon>
          Imprimir
        </button>
        <button mat-icon-button (click)="close()">
          <mat-icon>close</mat-icon>
        </button>
      </div>
    </div>

    <div class="p-8 max-h-[85vh] overflow-y-auto bg-gray-100">
      @if (company()) {
        <div class="max-w-[210mm] mx-auto bg-white shadow-lg" style="width: 210mm;">

          <div class="border-2 border-black" style="font-family: 'Times New Roman', serif;">

            <div class="text-center py-1 border-b-2 border-black" style="font-size: 8pt; font-weight: bold;">
              SE PREENCHER MANUALMENTE, POR FAVOR UTILIZE LETRA DE IMPRENSA
            </div>

            <div class="grid grid-cols-[100px_1fr_180px] border-b-2 border-black">
              <div class="border-r-2 border-black p-3 flex items-center justify-center" style="background-color: #FFFEF0;">
                <img src="assets/escudomozambique.png" alt="Escudo de Moçambique" class="w-20 h-20">
              </div>
              <div class="border-r-2 border-black flex flex-col">
                <div class="flex-1 flex flex-col items-center justify-center text-center py-2 px-3" style="background-color: #FFFEF0;">
                  <p style="font-size: 10pt; margin: 0;">República de Moçambique</p>
                  <p style="font-size: 10pt; margin: 0;">Ministério das Finanças</p>
                  <p style="font-size: 10pt; font-weight: bold; margin: 0;">Autoridade Tributária de Moçambique</p>
                  <p style="font-size: 10pt; margin: 0;">DIRECÇÃO GERAL DE IMPOSTOS</p>
                </div>
                <div class="text-center py-2 px-3" style="background: linear-gradient(180deg, #E6B82E 0%, #D4A429 100%); border-top: 1px solid black;">
                  <p style="font-size: 10pt; font-weight: bold; margin: 0; color: #000;">DECLARAÇÃO PERIÓDICA</p>
                  <p style="font-size: 20pt; font-weight: bold; margin: 2px 0; color: #000;">MODELO 30</p>
                </div>
              </div>
              <div class="py-3 px-3 flex items-center justify-center" style="background-color: #FFFEF0;">
                <div class="text-center">
                  <p style="font-size: 24pt; font-weight: bold; margin: 0; line-height: 1;">ISPC</p>
                  <div class="mt-2" style="border-top: 1px solid #999; padding-top: 4px;">
                    <p style="font-size: 8pt; font-weight: bold; margin: 0; line-height: 1.2;">IMPOSTO SIMPLIFICADO</p>
                    <p style="font-size: 8pt; font-weight: bold; margin: 0; line-height: 1.2;">PARA PEQUENOS</p>
                    <p style="font-size: 8pt; font-weight: bold; margin: 0; line-height: 1.2;">CONTRIBUINTES</p>
                  </div>
                </div>
              </div>
            </div>

            <div class="border-b border-black" style="background-color: #FFFF99; padding: 4px 6px;">
              <p style="font-size: 9pt; font-weight: bold; margin: 0;">1 – TIPO DE DECLARAÇÃO</p>
            </div>
            <div class="border-b border-black p-2">
              <div class="flex gap-8" style="font-size: 9pt;">
                <label class="flex items-center gap-2">
                  <span class="checkbox-box checked">☐</span>
                  <span>Declaração inicial</span>
                </label>
                <label class="flex items-center gap-2 ml-auto">
                  <span class="checkbox-box">☐</span>
                  <span>Declaração de Substituição</span>
                </label>
              </div>
            </div>

            <div class="grid grid-cols-2 border-b border-black">
              <div class="border-r border-black">
                <div style="background-color: #FFFF99; padding: 4px 6px; border-bottom: 1px solid black;">
                  <p style="font-size: 9pt; font-weight: bold; margin: 0;">2 – PERÍODO A QUE RESPEITA</p>
                </div>
                <div class="p-2" style="font-size: 9pt;">
                  <div class="flex items-center gap-2 mb-2">
                    <span>Ano</span>
                    <div class="flex gap-0.5">
                      @for (digit of getYearDigits(); track $index) {
                        <div class="digit-box">{{ digit }}</div>
                      }
                    </div>
                    <span class="ml-4">Trimestre</span>
                    <div class="digit-box">{{ data.declaration.period }}</div>
                  </div>
                  <div class="flex items-center gap-6">
                    <label class="flex items-center gap-2">
                      <span class="checkbox-box checked">☑</span>
                      <span>Dentro do Prazo</span>
                    </label>
                    <label class="flex items-center gap-2">
                      <span class="checkbox-box">☐</span>
                      <span>Fora do Prazo</span>
                    </label>
                  </div>
                </div>
              </div>
              <div>
                <div style="background-color: #FFFF99; padding: 4px 6px; border-bottom: 1px solid black;">
                  <p style="font-size: 9pt; font-weight: bold; margin: 0;">3 – NÚMERO ÚNICO DE IDENTIFICAÇÃO TRIBUTÁRIA (NUIT)</p>
                </div>
                <div class="p-2" style="font-size: 9pt;">
                  <div class="flex gap-0.5 mb-2">
                    @for (digit of getNuitDigits(); track $index) {
                      <div class="digit-box">{{ digit }}</div>
                    }
                  </div>
                  <div class="text-right" style="border-top: 1px dotted black; padding-top: 2px;">
                    <span style="font-size: 8pt;">Área Fiscal/UGC</span>
                  </div>
                </div>
              </div>
            </div>

            <div class="border-b border-black" style="background-color: #FFFF99; padding: 4px 6px;">
              <p style="font-size: 9pt; font-weight: bold; margin: 0;">4 – NOME/DESIGNAÇÃO SOCIAL</p>
            </div>
            <div class="border-b border-black p-2" style="border-bottom: 1px dotted black;">
              <p style="font-size: 9pt; margin: 0;">{{ company()!.name }}</p>
            </div>

            <div class="border-b border-black" style="background-color: #FFFF99; padding: 4px 6px;">
              <p style="font-size: 9pt; font-weight: bold; margin: 0;">5 – DESIGNAÇÃO DA ACTIVIDADE PRINCIPAL</p>
            </div>
            <div class="border-b border-black p-2">
              <p style="font-size: 9pt; margin: 0; border-bottom: 1px dotted black; padding-bottom: 2px;">{{ company()!.business_type }}</p>
              <div class="flex justify-end items-center gap-2 mt-1" style="font-size: 8pt;">
                <span>Código de Actividade Económica (CAE)</span>
                <div class="flex gap-0.5">
                  @for (i of [0,1,2,3,4,5]; track i) {
                    <div class="digit-box small"></div>
                  }
                </div>
              </div>
            </div>

            <div class="border-b border-black" style="background-color: #FFFF99; padding: 4px 6px;">
              <p style="font-size: 9pt; font-weight: bold; margin: 0;">6 – DOMICÍLIO FISCAL DA ACTIVIDADE</p>
            </div>
            <div class="border-b border-black p-2" style="font-size: 8pt;">
              <div class="mb-1">
                <span>Rua / Avenida:</span>
                <span style="border-bottom: 1px dotted black; display: inline-block; min-width: 300px; padding: 0 4px;">{{ company()!.address }}</span>
                <span class="ml-2">Nº:</span>
                <span style="border-bottom: 1px dotted black; display: inline-block; width: 40px;"></span>
              </div>
              <div class="mb-1">
                <span>Província:</span>
                <span style="border-bottom: 1px dotted black; display: inline-block; width: 180px;"></span>
                <span class="ml-4">Distrito/Município:</span>
                <span style="border-bottom: 1px dotted black; display: inline-block; width: 180px;"></span>
              </div>
              <div class="mb-1">
                <span>Bairro:</span>
                <span style="border-bottom: 1px dotted black; display: inline-block; width: 200px;"></span>
                <span class="ml-4">Tel. Fixo:</span>
                <span style="border-bottom: 1px dotted black; display: inline-block; width: 120px;"></span>
              </div>
              <div>
                <span>E-mail:</span>
                <span style="border-bottom: 1px dotted black; display: inline-block; width: 250px;"></span>
              </div>
            </div>

            <div class="border-b border-black" style="background-color: #FFFF99; padding: 4px 6px;">
              <p style="font-size: 9pt; font-weight: bold; margin: 0;">7 – INEXISTÊNCIA DE OPERAÇÕES</p>
            </div>
            <div class="border-b border-black p-2" style="font-size: 8pt;">
              <p style="margin: 0;">Se no período a que esta declaração respeita não realizou operações activas nem passiva, assinale <span class="checkbox-box small">☐</span> e passa para o quadro 10</p>
            </div>

            <div class="border-b border-black" style="background-color: #FFFF99; padding: 4px 6px;">
              <p style="font-size: 9pt; font-weight: bold; margin: 0;">8 – MODALIDADE DE PAGAMENTO</p>
            </div>
            <div class="border-b border-black p-2">
              <div class="flex justify-between items-start" style="font-size: 8pt;">
                <div>
                  <p style="margin: 0 0 4px 0;">Se optou pela taxa de 75.000,00 MT, indique a modalidade de pagamento:</p>
                  <div class="flex gap-4 ml-4">
                    <label class="flex items-center gap-2">
                      <span class="checkbox-box small">☐</span>
                      <span>Pagamento em única prestação</span>
                    </label>
                    <label class="flex items-center gap-2">
                      <span class="checkbox-box small">☐</span>
                      <span>Pagamento em quatro prestações</span>
                    </label>
                  </div>
                </div>
                <label class="flex items-center gap-2 border-l border-black pl-4">
                  <span class="checkbox-box small checked">☑</span>
                  <span>Se optou pela taxa de 3%</span>
                </label>
              </div>
            </div>

            <div class="border-b border-black" style="background-color: #FFFF99; padding: 4px 6px;">
              <p style="font-size: 9pt; font-weight: bold; margin: 0;">9 – APURAMENTO DO IMPOSTO</p>
            </div>
            <div class="border-b border-black">
              <div class="grid grid-cols-[1fr_200px]" style="font-size: 8pt;">
                <div class="p-3">
                  <p style="margin: 4px 0; border-bottom: 1px dotted black; padding-bottom: 2px;">Total de vendas e / ou serviços prestados</p>
                  <p style="margin: 4px 0; border-bottom: 1px dotted black; padding-bottom: 2px;">Imposto apurado à taxa de 3% (=01 x 3%)</p>
                  <p style="margin: 4px 0; border-bottom: 1px dotted black; padding-bottom: 2px;">Imposto a pagar a taxa fixa</p>
                  <p style="margin: 4px 0; border-bottom: 1px dotted black; padding-bottom: 2px;">Juros compensatórios</p>
                  <p style="margin: 4px 0; border-bottom: 1px dotted black; padding-bottom: 2px;">Importância a pagar</p>
                </div>
                <div class="border-l border-black p-2">
                  <div class="text-center mb-2" style="font-size: 7pt; font-weight: bold; border-bottom: 1px solid black; padding-bottom: 2px;">
                    Valor respeitante ao trimestre
                  </div>
                  <div class="value-box">
                    <span class="font-bold">01</span>
                    <span class="ml-auto">{{ formatAmount(data.declaration.total_sales) }}</span>
                  </div>
                  <div class="value-box">
                    <span class="font-bold">02</span>
                    <span class="ml-auto">{{ formatAmount(data.declaration.ispc_amount) }}</span>
                  </div>
                  <div class="value-box">
                    <span class="font-bold">03</span>
                    <span class="ml-auto">0,00</span>
                  </div>
                  <div class="value-box">
                    <span class="font-bold">04</span>
                    <span class="ml-auto">0,00</span>
                  </div>
                  <div class="value-box highlight">
                    <div style="font-size: 7pt; text-align: center; margin-bottom: 2px;">
                      05 = 02 + 04 (Taxa 3%)<br>05 = 03 + 04 (Taxa Fixa)
                    </div>
                    <div class="flex items-center">
                      <span class="font-bold">05</span>
                      <span class="ml-auto font-bold" style="font-size: 11pt;">{{ formatAmount(data.declaration.ispc_amount) }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="grid grid-cols-2">
              <div class="border-r border-black">
                <div style="background-color: #FFFF99; padding: 4px 6px; border-bottom: 1px solid black;">
                  <p style="font-size: 9pt; font-weight: bold; margin: 0;">10 – AUTENTICAÇÃO DO SUJEITO PASSIVO</p>
                </div>
                <div class="p-3" style="font-size: 8pt;">
                  <p style="margin: 0 0 8px 0;">A presente declaração corresponde à verdade e não omite qualquer informação pedida.</p>
                  <div class="mb-3">
                    <span>Data: ___/___/20___</span>
                  </div>
                  <div class="mb-3">
                    <p style="margin: 0 0 2px 0;">Nome:</p>
                    <div style="border-bottom: 1px dotted black;"></div>
                  </div>
                  <div>
                    <p style="margin: 0 0 2px 0;">Ass:</p>
                    <div style="border-bottom: 1px dotted black; margin-bottom: 2px;"></div>
                    <p style="margin: 0; font-size: 7pt; color: #666;">(Assinatura do Sujeito Passivo e carimbo)</p>
                  </div>
                </div>
              </div>
              <div>
                <div style="background-color: #FFFF99; padding: 4px 6px; border-bottom: 1px solid black;">
                  <p style="font-size: 9pt; font-weight: bold; margin: 0;">11 – USO EXCLUSIVO DOS SERVIÇOS</p>
                </div>
                <div class="p-3" style="font-size: 8pt;">
                  <div class="grid grid-cols-2 gap-2 mb-2">
                    <div>
                      <p style="margin: 0;">Nº de Entrada</p>
                      <div style="border-bottom: 1px solid black;"></div>
                    </div>
                    <div>
                      <p style="margin: 0;">Nº de Receita</p>
                      <div style="border-bottom: 1px solid black;"></div>
                    </div>
                  </div>
                  <div class="mb-2">
                    <p style="margin: 0;">Nº de Inserção</p>
                    <div style="border-bottom: 1px solid black;"></div>
                  </div>
                  <div class="mb-2">
                    <span>Data: ___/___/20___</span>
                  </div>
                  <div class="mb-2">
                    <p style="margin: 0;">Nome de funcionário</p>
                    <div style="border-bottom: 1px dotted black;"></div>
                  </div>
                  <div class="mb-2">
                    <p style="margin: 0;">Assinatura</p>
                    <div style="border-bottom: 1px dotted black;"></div>
                  </div>
                  <div class="text-center mt-3">
                    <p style="margin: 0; font-weight: bold;">O RECEBEDOR</p>
                    <div style="border-bottom: 1px dotted black; margin-top: 4px;"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          @if (data.declaration.payments && data.declaration.payments.length > 0) {
            <div class="mt-6 border-2 border-black p-4" style="font-family: 'Times New Roman', serif;">
              <h3 style="font-size: 10pt; font-weight: bold; margin: 0 0 8px 0;">COMPROVATIVO DE PAGAMENTOS</h3>
              <table class="w-full" style="font-size: 8pt; border-collapse: collapse;">
                <thead>
                  <tr style="border-bottom: 2px solid black;">
                    <th class="p-2 text-left" style="border: 1px solid black;">Data</th>
                    <th class="p-2 text-left" style="border: 1px solid black;">Método</th>
                    <th class="p-2 text-left" style="border: 1px solid black;">Referência</th>
                    <th class="p-2 text-right" style="border: 1px solid black;">Valor (MZN)</th>
                  </tr>
                </thead>
                <tbody>
                  @for (payment of data.declaration.payments; track payment.id) {
                    <tr>
                      <td class="p-2" style="border: 1px solid black;">{{ formatDate(payment.payment_date) }}</td>
                      <td class="p-2" style="border: 1px solid black;">{{ payment.payment_method || '-' }}</td>
                      <td class="p-2" style="border: 1px solid black;">{{ payment.reference || '-' }}</td>
                      <td class="p-2 text-right" style="border: 1px solid black;">{{ formatAmount(payment.amount) }}</td>
                    </tr>
                  }
                  <tr style="font-weight: bold; background-color: #FFFF99;">
                    <td colspan="3" class="p-2 text-right" style="border: 1px solid black;">TOTAL PAGO:</td>
                    <td class="p-2 text-right" style="border: 1px solid black;">{{ formatAmount(getTotalPaid()) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }

    .digit-box {
      width: 18px;
      height: 20px;
      border: 1px solid black;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10pt;
      font-weight: bold;
    }

    .digit-box.small {
      width: 14px;
      height: 16px;
      font-size: 8pt;
    }

    .checkbox-box {
      width: 12px;
      height: 12px;
      border: 1px solid black;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 10pt;
      line-height: 1;
    }

    .checkbox-box.small {
      width: 10px;
      height: 10px;
      font-size: 8pt;
    }

    .checkbox-box.checked {
      font-weight: bold;
    }

    .value-box {
      display: flex;
      align-items: center;
      padding: 4px;
      margin-bottom: 4px;
      border: 1px solid black;
      font-size: 9pt;
      min-height: 24px;
    }

    .value-box.highlight {
      border: 2px solid black;
      background-color: #F5F5F5;
    }

    @media print {
      .no-print {
        display: none !important;
      }

      .overflow-y-auto {
        overflow: visible !important;
        max-height: none !important;
      }

      .p-8 {
        padding: 0 !important;
      }

      .bg-gray-100 {
        background: white !important;
      }

      .shadow-lg {
        box-shadow: none !important;
      }

      @page {
        size: A4;
        margin: 10mm;
      }
    }
  `]
})
export class Model30Component implements OnInit {
  company = signal<Company | null>(null);

  constructor(
    public dialogRef: MatDialogRef<Model30Component>,
    @Inject(MAT_DIALOG_DATA) public data: { declaration: TaxDeclaration },
    private companyService: CompanyService
  ) {}

  ngOnInit() {
    this.company.set(this.companyService.activeCompany());
  }

  getYearDigits(): string[] {
    return this.data.declaration.year.toString().split('');
  }

  getNuitDigits(): string[] {
    const nuit = this.company()?.nuit || '';
    const paddedNuit = nuit.padStart(9, ' ');
    return paddedNuit.split('');
  }

  formatDate(dateString?: string): string {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('pt-MZ', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  }

  formatAmount(value: number): string {
    return new Intl.NumberFormat('pt-MZ', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  }

  getTotalPaid(): number {
    return (this.data.declaration.payments || []).reduce((sum, p) => sum + p.amount, 0);
  }

  print() {
    window.print();
  }

  close() {
    this.dialogRef.close();
  }
}
