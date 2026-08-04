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
        format: 'a4'
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

        const imageData = canvas.toDataURL('image/png');
        const imageProperties = pdf.getImageProperties(imageData);
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const imageHeight = (imageProperties.height * pageWidth) / imageProperties.width;

        if (index > 0) {
          pdf.addPage('a4', 'portrait');
        }

        // Keep the complete page visible while preserving its aspect ratio.
        const height = Math.min(imageHeight, pageHeight);
        pdf.addImage(imageData, 'PNG', 0, 0, pageWidth, height);
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

    // These rules are applied only to the cloned document used for PDF
    // generation. The on-screen Modelo 30 remains unchanged.
    container.classList.add('pdf-export-mode');
    const style = clonedDoc.createElement('style');
    style.textContent = `
      .pdf-export-mode .dotted-field-inline {
        vertical-align: baseline !important;
        line-height: 1.15 !important;
      }
      .pdf-export-mode .dotted-field {
        line-height: 1.15 !important;
      }
      .pdf-export-mode .digit-box {
        line-height: 1 !important;
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
