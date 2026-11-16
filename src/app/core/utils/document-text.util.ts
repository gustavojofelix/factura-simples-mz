import { strFromU8, unzipSync } from 'fflate';

/**
 * Extrai o texto de um documento carregado no browser, para a IA o poder ler
 * (anexos da base fiscal). Suporta PDF com texto, Word (.docx) e texto simples.
 * PDFs digitalizados (só imagem) devolvem texto vazio: o admin cola o texto.
 * Nunca lança excepção: devolve '' se não conseguir.
 */
export async function extractDocumentText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  try {
    if (file.type === 'application/pdf' || name.endsWith('.pdf')) return tidy(await pdfText(file));
    if (name.endsWith('.docx')) return tidy(await docxText(file));
    if (file.type.startsWith('text/') || /\.(txt|md|csv)$/.test(name)) return tidy(await file.text());
  } catch (e) {
    console.warn('Não foi possível extrair o texto do documento:', e);
  }
  return '';
}

/** Tipos de ficheiro de que se consegue extrair texto. */
export function canExtractText(file: File): boolean {
  return /\.(pdf|docx|txt|md|csv)$/i.test(file.name) || file.type === 'application/pdf' || file.type.startsWith('text/');
}

async function pdfText(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('assets/pdfjs/pdf.worker.min.mjs', document.baseURI).toString();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await task.promise;
  const pages: string[] = [];
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items as Array<{ str?: string; hasEOL?: boolean }>) {
        if (typeof item.str !== 'string') continue;
        text += item.str + (item.hasEOL ? '\n' : '');
      }
      pages.push(text);
    }
  } finally {
    await task.destroy();
  }
  return pages.join('\n\n');
}

async function docxText(file: File): Promise<string> {
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter: f => f.name === 'word/document.xml'
  });
  const xml = files['word/document.xml'];
  if (!xml) return '';
  return decodeXml(
    strFromU8(xml)
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br[^>]*\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n\n')
      .replace(/<[^>]+>/g, '')
  );
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

/** Espaços repetidos fora, no máximo uma linha em branco seguida. */
function tidy(s: string): string {
  return s
    .replace(/\r/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
