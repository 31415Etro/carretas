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

/** Naturezas de operação que também mostram remessa mesmo com CFOP de venda (ex.: "REMESSA DE DEMONSTRAÇÃO" lançada com CFOP 6102). Padrões do ilike do banco. */
export const REMESSA_NATURE_PATTERNS = ["remessa%", "%demonstra%"]

/** A natureza da operação é de remessa (ex.: "Remessa p/ demonstração", "REMESSA DE DEMOSNTRAÇÃO"). */
export const isRemessaNature = (nature: string | null | undefined) => /^\s*remessa|demonstra|demosntra/i.test(String(nature || ""))

/** Filtro de consulta do Supabase: só as notas que NÃO são de remessa (CFOP de remessa em data->items ou natureza de remessa, direto no banco). */
export const withoutRemessas = <Q extends { not: (column: string, operator: string, value: string) => Q }>(query: Q): Q =>
  REMESSA_NATURE_PATTERNS.reduce((next, pattern) => next.not("nature", "ilike", pattern), REMESSA_CFOPS.reduce((next, cfop) => next.not("data->items", "cs", JSON.stringify([{ cfop }])), query))

/** Filtro de consulta do Supabase: só as notas de remessa. */
export const onlyRemessas = <Q extends { or: (filters: string) => Q }>(query: Q): Q =>
  query.or([...REMESSA_CFOPS.map((cfop) => `data->items.cs.${JSON.stringify([{ cfop }])}`), ...REMESSA_NATURE_PATTERNS.map((pattern) => `nature.ilike.${pattern}`)].join(","))

/** CFOP da remessa da nota (o primeiro que for de remessa; sem CFOP de remessa, o primeiro CFOP da nota, quando só a natureza é de remessa). */
export const remessaCfop = (items: Array<{ cfop?: string }> | null | undefined) => onlyDigits((items || []).find((item) => REMESSA_CFOPS.includes(onlyDigits(item.cfop)))?.cfop || (items || [])[0]?.cfop)

/** "6912 · Remessa para demonstração (outro estado)". */
export const cfopLabel = (cfop: string) => {
  const type = REMESSA_TYPES[cfop.slice(1)]
  return type ? `${cfop} · ${type} (${cfop.startsWith("5") ? "dentro do estado" : "outro estado"})` : cfop || "sem CFOP"
}

/** Situação da nota na SEFAZ: 101 = cancelamento homologado. Nota cancelada não é venda nem compra. */
export const CANCELLED_STATUS = "101"

/** Filtro de consulta do Supabase: sem as notas canceladas (nota sem situação registrada entra: só sai a que está marcada como cancelada). */
export const withoutCancelled = <Q extends { or: (filters: string) => Q }>(query: Q): Q => query.or(`data->>protocolStatus.is.null,data->>protocolStatus.neq.${CANCELLED_STATUS}`)
