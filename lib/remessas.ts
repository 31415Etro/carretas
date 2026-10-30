// Notas de remessa e de retorno de remessa: demonstração, industrialização por encomenda, conserto e brinde. Não são venda nem compra: ficam fora de
// TODAS as análises da Contabilidade (análise, consolidado, notas, chassis) e aparecem só na visão "Remessas". Cada tipo existe com 5 (dentro do estado)
// e com 6 (outro estado). Para incluir outro CFOP de remessa, acrescente em REMESSA_TYPES.
export const REMESSA_TYPES: Record<string, string> = {
  "901": "Remessa para industrialização por encomenda",
  "902": "Retorno de mercadoria utilizada na industrialização",
  "903": "Retorno de mercadoria não aplicada na industrialização",
  "910": "Remessa em bonificação, doação ou brinde",
  "912": "Remessa para demonstração",
  "913": "Retorno de mercadoria recebida para demonstração",
  "915": "Remessa para conserto ou reparo",
  "916": "Retorno de conserto ou reparo",
  "925": "Retorno de mercadoria recebida para industrialização",
}
export const REMESSA_CFOPS = Object.keys(REMESSA_TYPES).flatMap((suffix) => [`5${suffix}`, `6${suffix}`])

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

/** "6912 · Remessa para demonstração (outro estado)". */
export const cfopLabel = (cfop: string) => {
  const type = REMESSA_TYPES[cfop.slice(1)]
  return type ? `${cfop} · ${type} (${cfop.startsWith("5") ? "dentro do estado" : "outro estado"})` : cfop || "sem CFOP"
}
