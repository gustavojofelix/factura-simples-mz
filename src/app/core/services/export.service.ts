import { Injectable } from '@angular/core';
import * as XLSX from 'xlsx';
import { t } from '../i18n/i18n';
import { saveFile, saveWorkbook } from '../utils/file-save';

@Injectable({
  providedIn: 'root'
})
export class ExportService {

  exportToExcel(data: any[], fileName: string, sheetName?: string): Promise<void> {
    if (!data || !data.length) {
      console.warn('Sem dados para exportar');
      return Promise.resolve();
    }
    const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(data);
    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName || t('reports.export.defaultSheet'));
    return saveWorkbook(XLSX, wb, `${fileName}.xlsx`);
  }

  exportToCsv(data: any[], fileName: string): Promise<void> {
    if (!data || !data.length) return Promise.resolve();

    const replacer = (key: string, value: any) => value === null ? '' : value;
    const header = Object.keys(data[0]);
    const csv = [
      header.join(','), // header line
      ...data.map(row => header.map(fieldName => {
        const val = row[fieldName];
        // Escape quotes and wrap in quotes if contains comma
        const cell = val === null || val === undefined ? '' : String(val).replace(/"/g, '""');
        return `"${cell}"`;
      }).join(','))
    ].join('\r\n');

    return this.downloadFile('\uFEFF' + csv, `${fileName}.csv`, 'text/csv;charset=utf-8;');
  }

  /** Descarrega texto como ficheiro (CSV, XML, ...). Na app nativa abre a partilha. */
  downloadFile(content: string, fileName: string, mime: string): Promise<void> {
    return this.downloadBlob(new Blob([content], { type: mime }), fileName);
  }

  /** Descarrega um Blob (ZIP, PDF, ...) como ficheiro. Na app nativa abre a partilha. */
  downloadBlob(blob: Blob, fileName: string): Promise<void> {
    return saveFile(blob, fileName);
  }
}
