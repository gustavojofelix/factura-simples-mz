import { Injectable } from '@angular/core';
import * as XLSX from 'xlsx';

@Injectable({
  providedIn: 'root'
})
export class ExportService {

  exportToExcel(data: any[], fileName: string, sheetName: string = 'Dados') {
    if (!data || !data.length) {
      console.warn('Sem dados para exportar');
      return;
    }
    const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(data);
    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, `${fileName}.xlsx`);
  }

  exportToCsv(data: any[], fileName: string) {
    if (!data || !data.length) return;

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

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `${fileName}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}
