import { PosTotals } from '../../core/services/pos.service';

/**
 * Ecrã do cliente: o POS publica o estado da venda neste canal e a janela
 * /pos-cliente (aberta no 2º monitor do terminal) mostra-o. Mesmo dispositivo,
 * sem servidor.
 */
export const POS_DISPLAY_CHANNEL = 'ispc-pos-display';

export interface PosDisplayLine {
  name: string;
  quantity: number;
  total: number;
}

export type PosDisplayMessage =
  | { kind: 'hello' }
  | {
      kind: 'state';
      store: string;
      table?: string;
      lines: PosDisplayLine[];
      totals: PosTotals;
      /** Venda acabada de finalizar: agradecimento e troco. */
      paid?: { number: string; total: number; change: number };
    };

export type PosDisplayState = Extract<PosDisplayMessage, { kind: 'state' }>;
