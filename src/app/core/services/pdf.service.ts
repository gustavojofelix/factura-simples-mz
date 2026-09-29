import { Injectable } from '@angular/core';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

/** Dimensões de uma página A4 em milímetros. */
const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;

/**
 * Factor de ampliação da captura. Mantido em 2 para preservar a nitidez que os
 * documentos já tinham.
 */
const CAPTURE_SCALE = 2;

/**
 * Qualidade do JPEG de cada página. O mesmo valor que o gerador de várias
 * páginas já usava para o Modelo 30.
 */
const PAGE_IMAGE_QUALITY = 0.95;

/**
 * Nenhuma página pode ficar com menos do que esta fracção da altura útil só
 * para evitar cortar um bloco. Sem este limite, um bloco anormalmente alto
 * empurraria o corte para cima indefinidamente.
 */
const MIN_PAGE_FILL = 0.25;

export interface PdfOptions {
  /**
   * Margem em milímetros aplicada aos quatro lados. O valor por omissão é zero,
   * que é como os documentos sempre foram gerados.
   */
  marginMm?: number;

  /**
   * Quantas vias do mesmo documento produzir. Cada via repete todas as páginas.
   * A captura do ecrã é feita uma única vez, independentemente do número.
   */
  copies?: number;

  /**
   * Etiqueta a escrever em cada via, por ordem. Por exemplo original,
   * duplicado e triplicado. Vias sem etiqueta correspondente saem sem marca.
   */
  copyLabels?: string[];

  /**
   * Selector dos blocos que não devem ser cortados a meio entre páginas.
   * Por omissão protege as linhas de tabela.
   */
  avoidBreakSelector?: string;

  /**
   * Ajustes a aplicar ao documento clonado, antes da captura. Usado por
   * documentos com folha de estilo própria para impressão.
   */
  prepareClone?: (clonedDoc: Document, elementId: string) => void;
}

interface PageImage {
  data: string;
  heightMm: number;
}

@Injectable({
  providedIn: 'root'
})
export class PdfService {

  /**
   * Gera um PDF a partir de um elemento da página.
   *
   * O conteúdo mais alto do que uma página A4 é repartido por várias páginas.
   * Antes desta versão, tudo o que passasse da primeira página era perdido sem
   * aviso nenhum.
   */
  async generatePdf(elementId: string, fileName: string, options?: PdfOptions): Promise<Blob> {
    const element = document.getElementById(elementId);
    if (!element) {
      throw new Error(`Element with id ${elementId} not found`);
    }

    const marginMm = Math.max(0, options?.marginMm ?? 0);
    const copies = Math.max(1, Math.floor(options?.copies ?? 1));
    const avoidBreakSelector = options?.avoidBreakSelector ?? 'tbody tr, .doc-no-break';

    const contentWidthMm = A4_WIDTH_MM - marginMm * 2;
    const contentHeightMm = A4_HEIGHT_MM - marginMm * 2;

    if (contentWidthMm <= 0 || contentHeightMm <= 0) {
      throw new Error('A margem indicada não deixa espaço útil na página.');
    }

    try {
      // Sem esta espera, um logótipo ainda por carregar sai em branco e um tipo
      // de letra ainda por aplicar altera as alturas medidas.
      await this.waitForRenderReady(element);

      const canvas = await html2canvas(element, {
        scale: CAPTURE_SCALE,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        ignoreElements: (el) => el.classList.contains('no-print') || el.tagName === 'BUTTON',
        onclone: (clonedDoc) => {
          this.removeUnsupportedColorFunctions(clonedDoc);
          options?.prepareClone?.(clonedDoc, elementId);
        }
      });

      if (canvas.height === 0 || canvas.width === 0) {
        throw new Error('O documento não produziu conteúdo visível.');
      }

      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
        compress: true
      });

      const pxPerMm = canvas.width / contentWidthMm;
      const pageHeightPx = contentHeightMm * pxPerMm;

      const boundaries = this.computePageBoundaries(
        element,
        canvas.height,
        pageHeightPx,
        avoidBreakSelector
      );

      // A captura é cara e o desenho de texto é barato: as páginas são
      // produzidas uma só vez e depois repetidas por cada via.
      const pages = this.buildPageImages(canvas, boundaries, pxPerMm);

      let isFirstPage = true;
      for (let copy = 0; copy < copies; copy++) {
        const label = options?.copyLabels?.[copy];

        for (const page of pages) {
          if (!isFirstPage) pdf.addPage('a4', 'portrait');
          isFirstPage = false;

          pdf.addImage(
            page.data,
            'JPEG',
            marginMm,
            marginMm,
            contentWidthMm,
            page.heightMm,
            undefined,
            'FAST'
          );

          if (label) this.drawCopyLabel(pdf, label);
        }
      }

      return pdf.output('blob');
    } catch (error) {
      console.error('PdfService Error:', error);
      throw error;
    }
  }

  /**
   * Generates one A4 PDF page for every `.page` element inside the container.
   * This is useful for documents such as Modelo 30 that are deliberately
   * laid out as several fixed A4 pages.
   *
   * Sem indicação em contrário, continua a aplicar os ajustes do Modelo 30, que
   * era o comportamento anterior. Passar `null` em `prepareClone` desliga-os.
   */
  async generateMultiPagePdf(
    containerId: string,
    options?: { prepareClone?: ((clonedDoc: Document, containerId: string) => void) | null }
  ): Promise<Blob> {
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`Element with id ${containerId} not found`);
    }

    const pages = Array.from(container.querySelectorAll<HTMLElement>('.page'));
    if (pages.length === 0) {
      throw new Error(`No PDF pages found inside #${containerId}`);
    }

    const prepareClone = options && 'prepareClone' in options
      ? options.prepareClone
      : (doc: Document, id: string) => this.prepareModel30PdfClone(doc, id);

    try {
      await this.waitForRenderReady(container);

      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
        compress: true
      });

      const pageWidth = pdf.internal.pageSize.getWidth();

      for (let index = 0; index < pages.length; index++) {
        const canvas = await html2canvas(pages[index], {
          scale: CAPTURE_SCALE,
          useCORS: true,
          logging: false,
          backgroundColor: '#ffffff',
          ignoreElements: (element) =>
            element.classList.contains('no-print') || element.tagName === 'BUTTON',
          onclone: (clonedDoc) => {
            this.removeUnsupportedColorFunctions(clonedDoc);
            prepareClone?.(clonedDoc, containerId);
          }
        });

        if (index > 0) pdf.addPage('a4', 'portrait');
        const imageData = canvas.toDataURL('image/jpeg', PAGE_IMAGE_QUALITY);
        const imageProps = pdf.getImageProperties(imageData);
        const imageHeight = imageProps.height * pageWidth / imageProps.width;
        pdf.addImage(imageData, 'JPEG', 0, 0, pageWidth, imageHeight, undefined, 'FAST');
      }

      return pdf.output('blob');
    } catch (error) {
      console.error('Multi-page PdfService Error:', error);
      throw error;
    }
  }

  /**
   * Espera que os tipos de letra estejam aplicados e que todas as imagens do
   * elemento tenham terminado de carregar.
   */
  private async waitForRenderReady(element: HTMLElement): Promise<void> {
    if (document.fonts?.ready) {
      try {
        await document.fonts.ready;
      } catch {
        // Um tipo de letra que não carrega não deve impedir a geração.
      }
    }

    const images = Array.from(element.querySelectorAll<HTMLImageElement>('img'));
    await Promise.all(images.map(image => {
      if (image.complete) return Promise.resolve();
      return new Promise<void>(resolve => {
        image.addEventListener('load', () => resolve(), { once: true });
        image.addEventListener('error', () => resolve(), { once: true });
      });
    }));
  }

  /**
   * Decide onde termina cada página, em pixéis da captura.
   *
   * O corte só cai onde calha se não houver nada a proteger. Quando um bloco
   * indivisível, tipicamente uma linha de tabela, ficaria partido ao meio, a
   * página fecha imediatamente antes desse bloco.
   */
  private computePageBoundaries(
    element: HTMLElement,
    canvasHeight: number,
    pageHeightPx: number,
    avoidBreakSelector: string
  ): number[] {
    const blocks = this.collectUnbreakableBlocks(element, avoidBreakSelector);
    const minSlice = pageHeightPx * MIN_PAGE_FILL;
    const boundaries: number[] = [];

    let start = 0;
    let guard = 0;
    const maxIterations = Math.ceil(canvasHeight / Math.max(1, minSlice)) + 10;

    while (start < canvasHeight && guard++ < maxIterations) {
      let end = Math.min(start + pageHeightPx, canvasHeight);

      if (end < canvasHeight) {
        const straddling = blocks.find(b => b.top > start && b.top < end && b.bottom > end);
        if (straddling && straddling.top - start >= minSlice) {
          end = straddling.top;
        }
      }

      boundaries.push(end);
      start = end;
    }

    // Rede de segurança: se alguma coisa correr mal no ciclo, é preferível uma
    // única página longa a um PDF vazio.
    if (boundaries.length === 0) boundaries.push(canvasHeight);

    return boundaries;
  }

  private collectUnbreakableBlocks(
    element: HTMLElement,
    selector: string
  ): Array<{ top: number; bottom: number }> {
    if (!selector) return [];

    let nodes: HTMLElement[];
    try {
      nodes = Array.from(element.querySelectorAll<HTMLElement>(selector));
    } catch {
      return [];
    }

    const rootTop = element.getBoundingClientRect().top;

    return nodes
      .map(node => {
        const rect = node.getBoundingClientRect();
        return {
          top: (rect.top - rootTop) * CAPTURE_SCALE,
          bottom: (rect.bottom - rootTop) * CAPTURE_SCALE
        };
      })
      .filter(block => block.bottom > block.top)
      .sort((a, b) => a.top - b.top);
  }

  private buildPageImages(
    canvas: HTMLCanvasElement,
    boundaries: number[],
    pxPerMm: number
  ): PageImage[] {
    const pages: PageImage[] = [];
    let start = 0;

    for (const end of boundaries) {
      const height = Math.round(end - start);
      if (height <= 0) continue;

      pages.push({
        data: this.sliceCanvas(canvas, Math.round(start), height),
        heightMm: height / pxPerMm
      });

      start = end;
    }

    return pages;
  }

  private sliceCanvas(source: HTMLCanvasElement, top: number, height: number): string {
    const slice = document.createElement('canvas');
    slice.width = source.width;
    slice.height = height;

    const context = slice.getContext('2d');
    if (!context) {
      throw new Error('Não foi possível preparar as páginas do PDF.');
    }

    // O fundo branco importa na última página, que costuma ser mais curta do
    // que a fatia pedida.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, slice.width, slice.height);
    context.drawImage(source, 0, top, source.width, height, 0, 0, source.width, height);

    return slice.toDataURL('image/jpeg', PAGE_IMAGE_QUALITY);
  }

  /**
   * Escreve a etiqueta da via no canto superior direito. É desenhada como texto
   * e não como imagem, por isso repetir vias não pesa no tamanho do ficheiro.
   */
  private drawCopyLabel(pdf: jsPDF, label: string) {
    const pageWidth = pdf.internal.pageSize.getWidth();

    pdf.setFontSize(8);
    pdf.setTextColor(130);
    pdf.text(label.toUpperCase(), pageWidth - 6, 7, { align: 'right' });
    pdf.setTextColor(0);
  }

  /**
   * O html2canvas 1.4.1 rebenta a analisar funções de cor modernas, que o
   * Angular Material emite nas suas folhas de estilo. As declarações afectadas
   * são removidas apenas do documento clonado usado para gerar o PDF.
   */
  private removeUnsupportedColorFunctions(clonedDoc: Document) {
    const unsupported = /(color|color-mix|oklch|oklab|lch|lab)\(/i;

    clonedDoc.querySelectorAll('style').forEach(style => {
      const css = style.innerHTML;
      if (!unsupported.test(css)) return;

      style.innerHTML = css.replace(
        /--[a-z0-9-]+:\s*(color|color-mix|oklch|oklab|lch|lab)\([^;]+;?/gi,
        ''
      );
    });
  }

  private prepareModel30PdfClone(clonedDoc: Document, containerId: string) {
    const container = clonedDoc.getElementById(containerId);
    if (!container) return;

    // These rules are applied only to the cloned document used for PDF generation.
    container.classList.add('pdf-export-mode');
    const style = clonedDoc.createElement('style');
    style.textContent = `
      .pdf-export-mode .page {
        margin: 0 !important;
        border: none !important;
        box-shadow: none !important;
        width: 210mm !important;
        height: auto !important;
        min-height: 0 !important;
        box-sizing: border-box !important;
        padding: 8mm !important;
        background: #ffffff !important;
        overflow: visible !important;
        break-inside: avoid !important;
        page-break-inside: avoid !important;
      }
      .pdf-continuous-mode .page {
        height: auto !important;
        min-height: 0 !important;
        margin-bottom: 0 !important;
        break-after: auto !important;
        page-break-after: auto !important;
      }
      .pdf-export-mode .digit-box {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        flex: 0 0 16px !important;
        line-height: 1 !important;
        height: 18px !important;
        width: 16px !important;
        padding: 0 !important;
        margin: 0 !important;
        font-family: Arial, sans-serif !important;
        font-size: 9pt !important;
        letter-spacing: 0 !important;
        font-variant-numeric: tabular-nums !important;
        overflow: visible !important;
        font-weight: bold !important;
        text-align: center !important;
        box-sizing: border-box !important;
        border: 1px solid #000 !important;
        vertical-align: middle !important;
      }
      .pdf-export-mode .digit-box.small {
        height: 15px !important;
        width: 13px !important;
        line-height: 1 !important;
        font-size: 7.5pt !important;
      }
      .pdf-export-mode .digit-group {
        display: inline-flex !important;
        align-items: center !important;
      }
      .pdf-export-mode .nuit-row {
        display: inline-flex !important;
        align-items: center !important;
      }
      .pdf-export-mode .q2-period-row .digit-box,
      .pdf-export-mode .nuit-row .digit-box {
        transform: translateY(0) !important;
      }
      .pdf-export-mode .q2-period-row .digit-value,
      .pdf-export-mode .nuit-row .digit-value {
        display: inline-block !important;
        transform: translateY(-5px) !important;
      }
      .pdf-export-mode .dotted-field-inline {
        vertical-align: baseline !important;
        line-height: 1.15 !important;
      }
      .pdf-export-mode .dotted-field {
        line-height: 1.15 !important;
      }
      .pdf-export-mode .section-header,
      .pdf-export-mode .instruction-bar,
      .pdf-export-mode .check-label,
      .pdf-export-mode .q6-line,
      .pdf-export-mode .q7-body,
      .pdf-export-mode .q8-check-line,
      .pdf-export-mode .q9-value-cell,
      .pdf-export-mode .q10-table,
      .pdf-export-mode .q11-value-box,
      .pdf-export-mode .q12-body,
      .pdf-export-mode .q13-col,
      .pdf-export-mode .payments-table {
        line-height: 1.15 !important;
      }
    `;
    clonedDoc.head.appendChild(style);
  }

  downloadPdf(blob: Blob, fileName: string) {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${fileName}.pdf`;
    link.click();
    window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
  }
}
