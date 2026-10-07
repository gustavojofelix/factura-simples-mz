import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

/**
 * Superfície de ferramentas do assistente.
 *
 * Duas invariantes de segurança governam este ficheiro:
 *
 *  1. `p_company_id` NUNCA vem do modelo. É injectado aqui a partir da empresa
 *     que o pedido autenticado indicou. Um modelo induzido em erro por texto
 *     numa nota de factura não consegue pedir dados de outra empresa.
 *
 *  2. As RPC são chamadas com o JWT do utilizador, não com a service role.
 *     As funções em SQL revalidam o acesso e o RLS continua activo, pelo que o
 *     assistente não consegue ler nada que o próprio utilizador não pudesse
 *     abrir na aplicação.
 *
 * Os esquemas NÃO usam `strict: true`: o modo strict limita a 16 os parâmetros
 * anuláveis no conjunto das ferramentas, e estas têm mais do que isso. Os
 * parâmetros opcionais ficam simplesmente fora de `required`; `buildArgs` e o
 * SQL aplicam os valores por omissão e validam o resto. Um argumento inválido
 * volta ao modelo como `tool_result` de erro, não rebenta a conversa.
 */

type Json = Record<string, unknown>;

interface ToolSpec {
  name: string;
  description: string;
  /** Nome da função SQL. */
  rpc: string;
  /** Converte os argumentos do modelo nos parâmetros da RPC. */
  buildArgs: (input: Json) => Json;
  input_schema: Json;
}

const optionalString = (description: string) => ({
  type: "string",
  description,
});

const optionalInteger = (description: string) => ({
  type: "integer",
  description,
});

const optionalEnum = (values: string[], description: string) => ({
  type: "string",
  enum: values,
  description,
});

const periodProps = {
  de: optionalString(
    "Data inicial do período, no formato AAAA-MM-DD. Se omitida, a consulta usa o seu valor por omissão.",
  ),
  ate: optionalString(
    "Data final do período, no formato AAAA-MM-DD. Se omitida, usa hoje.",
  ),
};

export const TOOLS: ToolSpec[] = [
  {
    name: "estatisticas_facturacao",
    description:
      "Totais de facturação de um período: número de facturas emitidas, total vendido, total recebido, total por receber, ticket médio e a repartição por estado. Use para perguntas como 'quantas facturas emiti este mês?' ou 'quanto vendi ontem?'. Sem período indicado, devolve o mês civil corrente.",
    rpc: "ai_invoice_stats",
    buildArgs: (i) => ({ p_from: i.de ?? null, p_to: i.ate ?? null }),
    input_schema: {
      type: "object",
      properties: { ...periodProps },
      additionalProperties: false,
    },
  },
  {
    name: "evolucao_vendas",
    description:
      "Série temporal de vendas agregada por dia, semana, mês, trimestre ou ano. Use para comparar períodos, identificar tendências e construir gráficos. Por omissão cobre os últimos 12 meses por mês.",
    rpc: "ai_sales_timeseries",
    buildArgs: (i) => ({
      p_from: i.de ?? null,
      p_to: i.ate ?? null,
      p_granularity: i.granularidade ?? "month",
    }),
    input_schema: {
      type: "object",
      properties: {
        ...periodProps,
        granularidade: optionalEnum(
          ["day", "week", "month", "quarter", "year"],
          "Agregação da série. Se omitido, usa 'month'.",
        ),
      },
      additionalProperties: false,
    },
  },
  {
    name: "produtos_mais_vendidos",
    description:
      "Ranking de produtos e serviços por receita ou por quantidade vendida, com o número de facturas em que aparecem. Use para 'qual o produto mais vendido?'. Repare que o produto que gera mais receita pode não ser o mais vendido em quantidade — se a pergunta for ambígua, mostre a ordenação por receita e refira a diferença quando for relevante.",
    rpc: "ai_top_products",
    buildArgs: (i) => ({
      p_from: i.de ?? null,
      p_to: i.ate ?? null,
      p_metric: i.ordenar_por ?? "receita",
      p_limit: i.limite ?? 10,
    }),
    input_schema: {
      type: "object",
      properties: {
        ...periodProps,
        ordenar_por: optionalEnum(
          ["receita", "quantidade"],
          "Critério de ordenação. Se omitido, usa 'receita'.",
        ),
        limite: optionalInteger("Quantos produtos devolver (1 a 50). Se omitido, usa 10."),
      },
      additionalProperties: false,
    },
  },
  {
    name: "melhores_clientes",
    description:
      "Ranking de clientes por total facturado no período, com número de facturas, valor ainda por receber e data da última compra.",
    rpc: "ai_top_clients",
    buildArgs: (i) => ({
      p_from: i.de ?? null,
      p_to: i.ate ?? null,
      p_limit: i.limite ?? 10,
    }),
    input_schema: {
      type: "object",
      properties: {
        ...periodProps,
        limite: optionalInteger("Quantos clientes devolver (1 a 50). Se omitido, usa 10."),
      },
      additionalProperties: false,
    },
  },
  {
    name: "clientes_inactivos",
    description:
      "Clientes que já compraram mas não emitem factura há mais de N dias, ordenados pelo valor histórico que representaram. Use para 'que clientes deixaram de comprar?' ou 'quem parou de usar os nossos serviços?'. Clientes registados que nunca facturaram não entram, porque nunca chegaram a ser activos.",
    rpc: "ai_inactive_clients",
    buildArgs: (i) => ({ p_days: i.dias ?? 90, p_limit: i.limite ?? 25 }),
    input_schema: {
      type: "object",
      properties: {
        dias: optionalInteger(
          "Dias sem comprar a partir dos quais um cliente conta como inactivo. Se omitido, usa 90.",
        ),
        limite: optionalInteger("Quantos clientes listar (1 a 100). Se omitido, usa 25."),
      },
      additionalProperties: false,
    },
  },
  {
    name: "contas_a_receber",
    description:
      "Valor total por receber, número de facturas em aberto, repartição por antiguidade da dívida (a vencer, 1-30, 31-60, 61-90 e mais de 90 dias) e os maiores devedores. Use para 'qual é o total pendente por receber?'.",
    rpc: "ai_receivables",
    buildArgs: (i) => ({ p_limit: i.limite ?? 20 }),
    input_schema: {
      type: "object",
      properties: {
        limite: optionalInteger("Quantos devedores listar (1 a 100). Se omitido, usa 20."),
      },
      additionalProperties: false,
    },
  },
  {
    name: "posicao_fiscal",
    description:
      "Declarações de ISPC (Modelo 30) de um ano: vendas do trimestre, base tributável, taxa, imposto apurado, estado, data limite e datas de submissão e pagamento. Inclui a próxima obrigação por cumprir. Use para 'quanto tenho de ISPC a pagar?' ou 'já entreguei o Modelo 30 deste trimestre?'.",
    rpc: "ai_tax_position",
    buildArgs: (i) => ({ p_year: i.ano ?? null }),
    input_schema: {
      type: "object",
      properties: {
        ano: optionalInteger("Ano civil a consultar. Se omitido, usa o ano corrente."),
      },
      additionalProperties: false,
    },
  },
  {
    name: "listar_facturas",
    description:
      "Lista facturas individuais com filtros de data, estado e nome de cliente. Use quando o utilizador quer ver as facturas concretas por trás de um número, e não apenas o total.",
    rpc: "ai_list_invoices",
    buildArgs: (i) => ({
      p_from: i.de ?? null,
      p_to: i.ate ?? null,
      p_status: i.estado ?? null,
      p_client_name: i.cliente ?? null,
      p_limit: i.limite ?? 50,
    }),
    input_schema: {
      type: "object",
      properties: {
        ...periodProps,
        estado: optionalEnum(
          ["rascunho", "pendente", "paga", "vencida", "anulada"],
          "Filtrar por estado da factura. Se omitido, não filtra.",
        ),
        cliente: optionalString(
          "Filtrar por nome de cliente (correspondência parcial). Se omitido, não filtra.",
        ),
        limite: optionalInteger("Quantas facturas devolver (1 a 200). Se omitido, usa 50."),
      },
      additionalProperties: false,
    },
  },
  {
    name: "pesquisar",
    description:
      "Pesquisa livre e simultânea em clientes, produtos e facturas por nome, NUIT, email, telefone ou número de factura. Use quando o utilizador menciona algo por nome e é preciso descobrir a que registo se refere.",
    rpc: "ai_search",
    buildArgs: (i) => ({ p_query: i.termo, p_limit: i.limite ?? 8 }),
    input_schema: {
      type: "object",
      properties: {
        termo: {
          type: "string",
          description: "Texto a procurar. Mínimo 2 caracteres.",
        },
        limite: optionalInteger("Resultados por tipo (1 a 25). Se omitido, usa 8."),
      },
      required: ["termo"],
      additionalProperties: false,
    },
  },
  {
    name: "consultar_base_fiscal",
    description:
      "Consulta a base de conhecimento fiscal sobre ISPC, Modelo 30, prazos, taxas, escalões, quem está sujeito ao imposto e consequências do incumprimento. É OBRIGATÓRIO usar esta ferramenta antes de responder a qualquer pergunta de natureza fiscal ou legal — nunca responda a essas perguntas de memória. Passe a pergunta do utilizador tal como ele a formulou.",
    rpc: "ai_search_knowledge",
    buildArgs: (i) => ({ p_query: i.pergunta, p_limit: i.limite ?? 4 }),
    input_schema: {
      type: "object",
      properties: {
        pergunta: {
          type: "string",
          description: "A pergunta ou o tema fiscal a consultar.",
        },
        limite: optionalInteger("Quantos artigos devolver (1 a 10). Se omitido, usa 4."),
      },
      required: ["pergunta"],
      additionalProperties: false,
    },
  },
];

/** Definições enviadas à API. A ordem é fixa: a cache é sensível a byte. */
export const TOOL_DEFINITIONS = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.input_schema,
}));

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export interface ToolCallRecord {
  nome: string;
  argumentos: Json;
  erro?: string;
  duracao_ms: number;
}

/**
 * Executa uma chamada de ferramenta. Nunca lança: um erro de ferramenta volta
 * ao modelo como um `tool_result` de erro, para que ele possa corrigir o tiro
 * ou explicar a limitação ao utilizador, em vez de rebentar a conversa.
 */
export async function executeTool(
  supabase: SupabaseClient,
  companyId: string,
  name: string,
  input: Json,
): Promise<{ content: string; record: ToolCallRecord }> {
  const started = Date.now();
  const spec = BY_NAME.get(name);

  if (!spec) {
    return {
      content: JSON.stringify({ erro: `Ferramenta desconhecida: ${name}` }),
      record: { nome: name, argumentos: input, erro: "desconhecida", duracao_ms: 0 },
    };
  }

  try {
    const args = { p_company_id: companyId, ...spec.buildArgs(input) };
    const { data, error } = await supabase.rpc(spec.rpc, args);

    if (error) {
      return {
        content: JSON.stringify({
          erro: "A consulta aos dados falhou.",
          detalhe: error.message,
        }),
        record: {
          nome: name,
          argumentos: input,
          erro: error.message,
          duracao_ms: Date.now() - started,
        },
      };
    }

    return {
      content: JSON.stringify(data ?? {}),
      record: { nome: name, argumentos: input, duracao_ms: Date.now() - started },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: JSON.stringify({ erro: "Erro inesperado na consulta.", detalhe: message }),
      record: {
        nome: name,
        argumentos: input,
        erro: message,
        duracao_ms: Date.now() - started,
      },
    };
  }
}
