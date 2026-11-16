/**
 * Formulário usado para declarar e pagar o ISPC.
 *
 * - 'modelo_geral': Declaração Modelo Geral (M/G), Decreto n.º 63/2022.
 *   Indicada TEMPORARIAMENTE pela AT para o ISPC, enquanto não existir
 *   mecanismo próprio (Comunicado n.º 9/2026).
 * - 'modelo_30': Declaração Periódica Modelo 30 (formulário próprio do ISPC).
 *   O código continua no sistema (Model30Component, Model30ExcelService);
 *   apenas fica escondido do utilizador.
 *
 * Para voltar ao Modelo 30 quando a AT der novas instruções, basta mudar
 * este valor para 'modelo_30' e publicar.
 */
export type IspcDeclarationForm = 'modelo_geral' | 'modelo_30';

export const ACTIVE_ISPC_DECLARATION_FORM: IspcDeclarationForm = 'modelo_geral';
