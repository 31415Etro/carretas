// Notas de remessa (demonstração etc.): CFOP 5912 (dentro do estado) e 6912 (outro estado). Não são venda: ficam fora de TODAS as análises de vendas
// da Contabilidade (análise, consolidado, notas, chassis) e aparecem só na visão "Remessas". Para incluir outro CFOP de remessa, acrescente aqui.
export const REMESSA_CFOPS = ["5912", "6912"]

const onlyDigits = (value: unknown) => String(value ?? "").replace(/\D/g, "")

/** A nota é de remessa quando algum item dela tem CFOP de remessa (na prática todos os itens têm: nenhuma nota mistura os dois). */
export const isRemessaInvoice = (items: Array<{ cfop?: string }> | null | undefined) => (items || []).some((item) => REMESSA_CFOPS.includes(onlyDigits(item.cfop)))

/** Filtro de consulta do Supabase: só as notas que NÃO são de remessa (conteúdo do JSON data->items, direto no banco). */
export const withoutRemessas = <Q extends { not: (column: string, operator: string, value: string) => Q }>(query: Q): Q =>
  REMESSA_CFOPS.reduce((next, cfop) => next.not("data->items", "cs", JSON.stringify([{ cfop }])), query)

/** Filtro de consulta do Supabase: só as notas de remessa. */
export const onlyRemessas = <Q extends { or: (filters: string) => Q }>(query: Q): Q =>
  query.or(REMESSA_CFOPS.map((cfop) => `data->items.cs.${JSON.stringify([{ cfop }])}`).join(","))

/** CFOP da remessa da nota (o primeiro que for de remessa). */
export const remessaCfop = (items: Array<{ cfop?: string }> | null | undefined) => onlyDigits((items || []).find((item) => REMESSA_CFOPS.includes(onlyDigits(item.cfop)))?.cfop)

/** 5912 = remessa dentro do estado; 6912 = para outro estado. */
export const cfopLabel = (cfop: string) => (cfop === "5912" ? "5912 · dentro do estado" : cfop === "6912" ? "6912 · outro estado" : cfop || "sem CFOP")
