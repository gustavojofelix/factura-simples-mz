import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

/**
 * Guarda um ficheiro gerado na app (PDF, Excel, CSV, ZIP, XML).
 * Web: download normal do browser.
 * App nativa: a WebView do Android não faz downloads, por isso o ficheiro é
 * gravado na cache da app e abre-se a folha de partilha (WhatsApp, email,
 * Drive, imprimir, abrir num leitor de PDF...).
 */
export async function saveFile(blob: Blob, fileName: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }

  const safeName = fileName.replace(/[\\/:*?"<>|]+/g, '_');
  const { uri } = await Filesystem.writeFile({
    path: safeName,
    data: await blobToBase64(blob),
    directory: Directory.Cache
  });
  try {
    await Share.share({ title: safeName, files: [uri] });
  } catch (error) {
    // Fechar a folha de partilha sem escolher nada não é um erro.
    if (!/cancel/i.test(String((error as Error)?.message ?? error))) throw error;
  }
}

/** Biblioteca xlsx / xlsx-js-style (mesma API de escrita). */
interface XlsxWriter {
  writeFile(wb: unknown, fileName: string, opts?: object): unknown;
  write(wb: unknown, opts: object): ArrayBuffer;
}

/** Equivalente a XLSX.writeFile que também funciona na app nativa. */
export async function saveWorkbook(xlsx: XlsxWriter, wb: unknown, fileName: string, opts?: { bookType?: string; compression?: boolean }): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    xlsx.writeFile(wb, fileName, opts);
    return;
  }
  const ext = fileName.split('.').pop()?.toLowerCase();
  const bookType = opts?.bookType ?? (ext === 'csv' ? 'csv' : ext === 'xls' ? 'biff8' : 'xlsx');
  const data = xlsx.write(wb, { ...opts, bookType, type: 'array' });
  await saveFile(new Blob([data], { type: 'application/octet-stream' }), fileName);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
