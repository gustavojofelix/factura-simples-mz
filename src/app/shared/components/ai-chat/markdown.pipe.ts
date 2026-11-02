import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

/**
 * Renderizador de um subconjunto de Markdown — o que o assistente produz:
 * títulos, negrito, itálico, código, listas e tabelas.
 *
 * Não se usa uma biblioteca de Markdown por duas razões. Primeiro, o
 * subconjunto é pequeno e conhecido. Segundo, e mais importante, a saída do
 * modelo pode conter texto que veio de campos preenchidos por utilizadores
 * (nomes de clientes, notas de facturas): tudo é escapado antes de qualquer
 * transformação, pelo que nenhuma marcação vinda desses campos chega ao DOM.
 * Só as etiquetas geradas por este ficheiro são interpretadas como HTML.
 */
@Pipe({ name: 'aiMarkdown', standalone: true })
export class AiMarkdownPipe implements PipeTransform {
  constructor(private sanitizer: DomSanitizer) {}

  transform(texto: string | null | undefined): SafeHtml {
    if (!texto) return '';
    return this.sanitizer.bypassSecurityTrustHtml(renderAiMarkdown(texto));
  }
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, '<code class="ai-code">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
}

/** Markdown → HTML (já escapado). Também usado pelo editor da base fiscal. */
export function renderAiMarkdown(origem: string): string {
  const linhas = escape(origem).split('\n');
  const saida: string[] = [];
  let i = 0;

  while (i < linhas.length) {
    const linha = linhas[i];

    // Tabela: linha de cabeçalho seguida de linha de separadores.
    if (
      linha.trim().startsWith('|') &&
      i + 1 < linhas.length &&
      /^\s*\|[\s:|-]+\|\s*$/.test(linhas[i + 1])
    ) {
      const celulas = (l: string) =>
        l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());

      const cabecalho = celulas(linha);
      i += 2;

      const corpo: string[][] = [];
      while (i < linhas.length && linhas[i].trim().startsWith('|')) {
        corpo.push(celulas(linhas[i]));
        i++;
      }

      saida.push(
        '<div class="ai-table-wrap"><table class="ai-table"><thead><tr>' +
          cabecalho.map(c => `<th>${inline(c)}</th>`).join('') +
          '</tr></thead><tbody>' +
          corpo
            .map(
              r =>
                '<tr>' +
                r.map(c => `<td>${inline(c)}</td>`).join('') +
                '</tr>'
            )
            .join('') +
          '</tbody></table></div>'
      );
      continue;
    }

    // Títulos
    const titulo = linha.match(/^(#{1,4})\s+(.*)$/);
    if (titulo) {
      const nivel = Math.min(titulo[1].length + 2, 6);
      saida.push(`<h${nivel} class="ai-h">${inline(titulo[2])}</h${nivel}>`);
      i++;
      continue;
    }

    // Listas (com ou sem numeração)
    if (/^\s*([-*]|\d+\.)\s+/.test(linha)) {
      const numerada = /^\s*\d+\./.test(linha);
      const itens: string[] = [];
      while (i < linhas.length && /^\s*([-*]|\d+\.)\s+/.test(linhas[i])) {
        itens.push(
          `<li>${inline(linhas[i].replace(/^\s*([-*]|\d+\.)\s+/, ''))}</li>`
        );
        i++;
      }
      const tag = numerada ? 'ol' : 'ul';
      saida.push(`<${tag} class="ai-list">${itens.join('')}</${tag}>`);
      continue;
    }

    if (linha.trim() === '') {
      i++;
      continue;
    }

    // Parágrafo: junta linhas consecutivas até à próxima linha em branco.
    //
    // A primeira linha entra sempre. Uma linha que começa por '|' sem a linha
    // de separadores a seguir (o cabeçalho de uma tabela que ainda está a
    // chegar em streaming, ou um '|' solto) não é tabela, lista nem título;
    // se o ciclo abaixo a pudesse recusar, `i` não avançava e o render
    // entrava num ciclo infinito que bloqueava a página.
    const paragrafo: string[] = [linhas[i]];
    i++;
    while (
      i < linhas.length &&
      linhas[i].trim() !== '' &&
      !/^\s*([-*]|\d+\.)\s+/.test(linhas[i]) &&
      !linhas[i].trim().startsWith('|') &&
      !/^#{1,4}\s/.test(linhas[i])
    ) {
      paragrafo.push(linhas[i]);
      i++;
    }
    saida.push(`<p class="ai-p">${inline(paragrafo.join(' '))}</p>`);
  }

  return saida.join('');
}
