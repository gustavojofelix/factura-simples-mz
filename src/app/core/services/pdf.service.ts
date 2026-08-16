import { Injectable } from '@angular/core';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

@Injectable({
  providedIn: 'root'
})
export class PdfService {

  async generatePdf(elementId: string, fileName: string): Promise<Blob> {
    const element = document.getElementById(elementId);
    if (!element) {
      throw new Error(`Element with id ${elementId} not found`);
    }

    try {
      const canvas = await html2canvas(element, {
        scale: 2, // Higher scale for better quality
        useCORS: true, // Important for images (logo)
        logging: false,
        backgroundColor: '#ffffff',
        ignoreElements: (el) => el.classList.contains('no-print') || el.tagName === 'BUTTON',
        onclone: (clonedDoc) => {
          // Deep fix: scan for any 'color(' function in styles and remove it
          // html2canvas 1.4.1 has a bug parsing modern color functions
          const styles = clonedDoc.querySelectorAll('style');
          styles.forEach(style => {
            if (style.innerHTML.includes('color(')) {
              // This is aggressive but effective: remove the style if it contains the problematic function
              // Usually these are just state layers or modern features we don't need for the PDF
              style.innerHTML = style.innerHTML.replace(/--[a-z0-9-]+:\s*color\([^;]+;?/gi, '');
            }
          });
        }
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      const imgProps = pdf.getImageProperties(imgData);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;

      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      
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
   */
  async generateMultiPagePdf(containerId: string): Promise<Blob> {
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`Element with id ${containerId} not found`);
    }

    const pages = Array.from(container.querySelectorAll<HTMLElement>('.page'));
    if (pages.length === 0) {
      throw new Error(`No PDF pages found inside #${containerId}`);
    }

    try {
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }

      await Promise.all(pages.flatMap(page =>
        Array.from(page.querySelectorAll<HTMLImageElement>('img')).map(image => {
          if (image.complete) return Promise.resolve();
          return new Promise<void>(resolve => {
            image.addEventListener('load', () => resolve(), { once: true });
            image.addEventListener('error', () => resolve(), { once: true });
          });
        })
      ));

      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
        compress: true
      });

      for (let index = 0; index < pages.length; index++) {
        const canvas = await html2canvas(pages[index], {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: '#ffffff',
          ignoreElements: (element) =>
            element.classList.contains('no-print') || element.tagName === 'BUTTON',
          onclone: (clonedDoc) => {
            this.removeUnsupportedColorFunctions(clonedDoc);
            this.prepareModel30PdfClone(clonedDoc, containerId);
          }
        });

        // Use JPEG at 0.95 quality for ultra-fast generation and 90% smaller PDF file size
        const imageData = canvas.toDataURL('image/jpeg', 0.95);
        const pageWidth = pdf.internal.pageSize.getWidth();  // 210mm
        const pageHeight = pdf.internal.pageSize.getHeight(); // 297mm

        if (index > 0) {
          pdf.addPage('a4', 'portrait');
        }

        // Exact 1-to-1 fit on A4 page without margins, shadows, or page splitting
        pdf.addImage(imageData, 'JPEG', 0, 0, pageWidth, pageHeight, undefined, 'FAST');
      }

      return pdf.output('blob');
    } catch (error) {
      console.error('Multi-page PdfService Error:', error);
      throw error;
    }
  }

  private removeUnsupportedColorFunctions(clonedDoc: Document) {
    const styles = clonedDoc.querySelectorAll('style');
    styles.forEach(style => {
      if (style.innerHTML.includes('color(')) {
        style.innerHTML = style.innerHTML.replace(
          /--[a-z0-9-]+:\s*color\([^;]+;?/gi,
          ''
        );
      }
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
        height: 297mm !important;
        min-height: 297mm !important;
        box-sizing: border-box !important;
        padding: 8mm !important;
        background: #ffffff !important;
        overflow: hidden !important;
        break-inside: avoid !important;
        page-break-inside: avoid !important;
      }
      .pdf-export-mode .digit-box {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        flex: 0 0 16px !important;
        line-height: 16px !important;
        height: 18px !important;
        width: 16px !important;
        padding: 0 !important;
        margin: 0 !important;
        font-family: Arial, sans-serif !important;
        font-size: 9pt !important;
        letter-spacing: 0 !important;
        font-variant-numeric: tabular-nums !important;
        overflow: hidden !important;
        font-weight: bold !important;
        text-align: center !important;
        box-sizing: border-box !important;
        border: 1px solid #000 !important;
        vertical-align: middle !important;
      }
      .pdf-export-mode .digit-box.small {
        height: 15px !important;
        width: 13px !important;
        line-height: 13px !important;
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
