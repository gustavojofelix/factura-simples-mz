import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

/** 1 px = 9525 EMU (unidade de posição/tamanho do DrawingML). */
const EMU_PER_PX = 9525;

export interface XlsxImageAnchor {
  /** Célula de referência (base 0). */
  col: number;
  row: number;
  /** Deslocamento dentro da célula, em píxeis. */
  offsetX?: number;
  offsetY?: number;
  /** Tamanho da imagem, em píxeis. */
  width: number;
  height: number;
}

const DRAWING_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing';
const IMAGE_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

/**
 * Insere uma imagem PNG numa folha de um .xlsx já gerado.
 *
 * O SheetJS (xlsx-js-style) não escreve imagens; esta função acrescenta ao
 * pacote o desenho (xl/drawings), a imagem (xl/media), as relações e os
 * content types necessários. Só suporta uma imagem por folha que ainda não
 * tenha desenhos — é o caso das folhas geradas pelo SheetJS.
 */
export function addPngToXlsx(xlsx: Uint8Array, sheetNumber: number, png: Uint8Array, anchor: XlsxImageAnchor): Uint8Array {
  const files = unzipSync(xlsx);
  const sheetPath = `xl/worksheets/sheet${sheetNumber}.xml`;
  const sheetRelsPath = `xl/worksheets/_rels/sheet${sheetNumber}.xml.rels`;
  if (!files[sheetPath]) throw new Error(`Folha ${sheetNumber} não encontrada no ficheiro Excel.`);

  // Nomes livres para o desenho e a imagem
  let n = 1;
  while (files[`xl/drawings/drawing${n}.xml`] || files[`xl/media/image${n}.png`]) n++;
  const drawingName = `drawing${n}.xml`;
  const imageName = `image${n}.png`;

  files[`xl/media/${imageName}`] = new Uint8Array(png);

  const emu = (px: number) => Math.round(px * EMU_PER_PX);
  files[`xl/drawings/${drawingName}`] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    '<xdr:oneCellAnchor>' +
    `<xdr:from><xdr:col>${anchor.col}</xdr:col><xdr:colOff>${emu(anchor.offsetX ?? 0)}</xdr:colOff>` +
    `<xdr:row>${anchor.row}</xdr:row><xdr:rowOff>${emu(anchor.offsetY ?? 0)}</xdr:rowOff></xdr:from>` +
    `<xdr:ext cx="${emu(anchor.width)}" cy="${emu(anchor.height)}"/>` +
    '<xdr:pic>' +
    `<xdr:nvPicPr><xdr:cNvPr id="${n + 1}" name="Imagem ${n}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
    '<xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId1"/>' +
    '<a:stretch><a:fillRect/></a:stretch></xdr:blipFill>' +
    '<xdr:spPr><a:xfrm><a:off x="0" y="0"/>' +
    `<a:ext cx="${emu(anchor.width)}" cy="${emu(anchor.height)}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>' +
    '</xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>'
  );
  files[`xl/drawings/_rels/${drawingName}.rels`] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `<Relationship Id="rId1" Type="${IMAGE_REL_TYPE}" Target="../media/${imageName}"/>` +
    '</Relationships>'
  );

  // Relação folha → desenho
  let sheetRels = files[sheetRelsPath]
    ? strFromU8(files[sheetRelsPath])
    : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  let relN = 1;
  while (sheetRels.includes(`Id="rId${relN}"`)) relN++;
  const relId = `rId${relN}`;
  sheetRels = sheetRels.replace('</Relationships>',
    `<Relationship Id="${relId}" Type="${DRAWING_REL_TYPE}" Target="../drawings/${drawingName}"/></Relationships>`);
  files[sheetRelsPath] = strToU8(sheetRels);

  // <drawing> tem de vir antes destes elementos (ordem do schema CT_Worksheet)
  let sheetXml = strFromU8(files[sheetPath]);
  if (!/xmlns:r=/.test(sheetXml.substring(0, sheetXml.indexOf('>', sheetXml.indexOf('<worksheet'))))) {
    sheetXml = sheetXml.replace('<worksheet',
      '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"');
  }
  const drawingTag = `<drawing r:id="${relId}"/>`;
  const after = /<(legacyDrawing|legacyDrawingHF|drawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)[\s>/]/.exec(sheetXml);
  sheetXml = after
    ? sheetXml.substring(0, after.index) + drawingTag + sheetXml.substring(after.index)
    : sheetXml.replace('</worksheet>', `${drawingTag}</worksheet>`);
  files[sheetPath] = strToU8(sheetXml);

  // Content types
  let types = strFromU8(files['[Content_Types].xml']);
  if (!/Extension="png"/i.test(types)) {
    types = types.replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>');
  }
  types = types.replace('</Types>',
    `<Override PartName="/xl/drawings/${drawingName}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
  files['[Content_Types].xml'] = strToU8(types);

  return zipSync(files, { level: 6 });
}

export interface XlsxPrintLayout {
  /** Código de papel do Excel (9 = A4). */
  paperSize?: number;
  orientation?: 'portrait' | 'landscape';
  /** Ajusta a folha à largura de uma página (altura livre). */
  fitToWidth?: boolean;
  /** Quebras de página manuais: a nova página começa nesta linha (base 0). */
  rowBreaks?: number[];
}

/**
 * Configura a impressão de uma folha de um .xlsx já gerado (o SheetJS CE não
 * escreve pageSetup nem quebras de página).
 */
export function setXlsxPrintLayout(xlsx: Uint8Array, sheetNumber: number, layout: XlsxPrintLayout): Uint8Array {
  const files = unzipSync(xlsx);
  const sheetPath = `xl/worksheets/sheet${sheetNumber}.xml`;
  if (!files[sheetPath]) throw new Error(`Folha ${sheetNumber} não encontrada no ficheiro Excel.`);
  let xml = strFromU8(files[sheetPath]);

  if (layout.fitToWidth) {
    if (/<sheetPr\s*\/>/.test(xml)) {
      xml = xml.replace(/<sheetPr\s*\/>/, '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
    } else if (/<sheetPr[\s>]/.test(xml)) {
      xml = xml.replace(/<pageSetUpPr[^>]*\/>/, '');
      xml = xml.replace(/(<sheetPr[^>]*?)\s*\/>/, '$1></sheetPr>');
      xml = xml.replace(/<\/sheetPr>/, '<pageSetUpPr fitToPage="1"/></sheetPr>');
    } else {
      const open = xml.indexOf('>', xml.indexOf('<worksheet')) + 1;
      xml = xml.substring(0, open) + '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' + xml.substring(open);
    }
  }

  // <pageSetup> logo a seguir a <pageMargins> (ordem do schema CT_Worksheet)
  const attrs = [
    `paperSize="${layout.paperSize ?? 9}"`,
    ...(layout.fitToWidth ? ['fitToWidth="1"', 'fitToHeight="0"'] : []),
    `orientation="${layout.orientation ?? 'portrait'}"`
  ].join(' ');
  xml = xml.replace(/<pageSetup[^>]*\/>/, '');
  if (/<pageMargins[^>]*\/>/.test(xml)) {
    xml = xml.replace(/(<pageMargins[^>]*\/>)/, `$1<pageSetup ${attrs}/>`);
  }

  const breaks = [...new Set(layout.rowBreaks || [])].filter(r => r > 0).sort((a, b) => a - b);
  if (breaks.length) {
    const tag = `<rowBreaks count="${breaks.length}" manualBreakCount="${breaks.length}">` +
      breaks.map(r => `<brk id="${r}" max="16383" man="1"/>`).join('') + '</rowBreaks>';
    xml = xml.replace(/<rowBreaks[\s\S]*?<\/rowBreaks>/, '');
    const after = /<(colBreaks|customProperties|cellWatches|ignoredErrors|smartTags|drawing|legacyDrawing|legacyDrawingHF|drawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)[\s>/]/.exec(xml);
    xml = after
      ? xml.substring(0, after.index) + tag + xml.substring(after.index)
      : xml.replace('</worksheet>', `${tag}</worksheet>`);
  }

  files[sheetPath] = strToU8(xml);
  return zipSync(files, { level: 6 });
}
