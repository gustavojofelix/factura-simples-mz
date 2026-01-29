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

  downloadPdf(blob: Blob, fileName: string) {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${fileName}.pdf`;
    link.click();
    window.URL.revokeObjectURL(url);
  }
}
