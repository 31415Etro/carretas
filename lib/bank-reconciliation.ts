// Conciliação bancária: casa linhas do extrato com lançamentos que já existiam (digitados à mão, contas pagas etc.)
// para o mesmo pagamento não entrar duas vezes nos totais. Funções puras (testáveis), usadas na tela e no servidor.

export const STATEMENT_ORIGIN = "Extrato bancario"
/** Origens que nunca são candidatas: já vieram do banco ou de fatura de cartão. */
const NOT_CANDIDATE_ORIGINS = new Set([STATEMENT_ORIGIN, "Cartao de credito"])

export type MatchLevel = "Alta" | "Media" | "Baixa"

/** O mínimo que precisamos de um lançamento (compatível com FinancialTransaction). */
export type TxLike = {
  id: string
  type: "Entrada" | "Saida"
  description: string
  supplierName?: string
  realizedDate?: string
  dueDate?: string
  competenceDate?: string
  realizedAmount: number
  expectedAmount: number
  status?: string
  origin?: string
  notes?: string
}

export type StatementLike = { id?: string; type: "Entrada" | "Saida"; date: string; amount: number; description: string }

export type MatchCandidate = { id: string; score: number; level: MatchLevel; dateDiff: number; similarity: number }

export const statementKeyFromNotes = (notes = "") => notes.match(/Chave do extrato:\s*([^\s]+)/i)?.[1] || ""

/** Lançamento vindo do extrato e ainda não conciliado com nenhum lançamento manual. */
export const isStatementTransaction = (tx: Pick<TxLike, "origin">) => tx.origin === STATEMENT_ORIGIN

/** Lançamento feito por outro caminho (manual, conta paga...) que ainda não foi casado com o extrato. */
export function isReconcilable(tx: TxLike) {
  if (tx.status === "Cancelado") return false
  if (NOT_CANDIDATE_ORIGINS.has(tx.origin || "")) return false
  return !statementKeyFromNotes(tx.notes)
}

export const amountOf = (tx: Pick<TxLike, "realizedAmount" | "expectedAmount">) => Number(tx.realizedAmount || tx.expectedAmount || 0)
export const dateOf = (tx: Pick<TxLike, "realizedDate" | "dueDate" | "competenceDate">) => tx.realizedDate || tx.dueDate || tx.competenceDate || ""

const STOPWORDS = new Set(["PIX", "TED", "DOC", "PAGAMENTO", "PAGTO", "PAG", "COMPRA", "DEBITO", "CREDITO", "CARTAO", "RECEBIMENTO", "TRANSFERENCIA", "TRANSF", "TARIFA", "LTDA", "EIRELI", "EPP", "BANCO", "SICOOB", "AILOS", "CONTA", "BOLETO", "COBRANCA", "TITULO", "LIQUIDACAO", "ENVIADO", "ENVIADA", "RECEBIDO", "RECEBIDA", "DOCUMENTO", "REF", "NFE", "NOTA", "FISCAL", "PARA", "COM", "DOS", "DAS", "NFS"])

export function tokens(value = "") {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z\s]/g, " ").split(/\s+/)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word))
}

/** Semelhança 0..1 entre dois textos: palavras iguais ou com o mesmo começo (ANDRACO ~ ANDRA), pela menor lista. */
export function descriptionSimilarity(a = "", b = "") {
  const left = tokens(a)
  const right = tokens(b)
  if (!left.length || !right.length) return 0
  const same = (x: string, y: string) => x === y || (Math.min(x.length, y.length) >= 4 && (x.startsWith(y.slice(0, 4)) && y.startsWith(x.slice(0, 4))))
  const hits = left.filter((word) => right.some((other) => same(word, other))).length
  return Math.round((hits / Math.min(left.length, right.length)) * 100) / 100
}

export function daysBetween(a: string, b: string) {
  const x = Date.parse(`${String(a).slice(0, 10)}T12:00:00Z`)
  const y = Date.parse(`${String(b).slice(0, 10)}T12:00:00Z`)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 9999
  return Math.round(Math.abs(x - y) / 86_400_000)
}

/** Candidatos para uma linha do extrato: mesmo tipo e MESMO valor (centavos), do mais provável para o menos provável. */
export function findCandidates(statement: StatementLike, pool: TxLike[], usedIds: ReadonlySet<string> = new Set()): MatchCandidate[] {
  const out: MatchCandidate[] = []
  for (const tx of pool) {
    if (usedIds.has(tx.id) || tx.type !== statement.type || !isReconcilable(tx)) continue
    if (Math.abs(amountOf(tx) - statement.amount) > 0.009) continue
    const dateDiff = daysBetween(dateOf(tx), statement.date)
    const similarity = Math.max(descriptionSimilarity(statement.description, tx.description), descriptionSimilarity(statement.description, tx.supplierName || ""))
    const level: MatchLevel = (dateDiff <= 5 && similarity >= 0.25) || dateDiff <= 2 ? "Alta" : dateDiff <= 15 ? "Media" : "Baixa"
    out.push({ id: tx.id, level, dateDiff, similarity, score: 60 + Math.max(0, 25 - dateDiff * 2.5) + similarity * 15 })
  }
  return out.sort((a, b) => b.score - a.score)
}

const rank: Record<MatchLevel, number> = { Alta: 3, Media: 2, Baixa: 1 }

/** Pares sugeridos, um lançamento para cada linha do extrato (não repete lançamento). */
export function suggestPairs(statements: Array<StatementLike & { id: string }>, pool: TxLike[], minLevel: MatchLevel = "Media") {
  const all: Array<{ statementId: string; manualId: string; level: MatchLevel; score: number }> = []
  for (const statement of statements) {
    for (const candidate of findCandidates(statement, pool)) {
      if (rank[candidate.level] >= rank[minLevel]) all.push({ statementId: statement.id, manualId: candidate.id, level: candidate.level, score: candidate.score })
    }
  }
  all.sort((a, b) => b.score - a.score)
  const usedStatement = new Set<string>()
  const usedManual = new Set<string>()
  return all.filter((pair) => {
    if (usedStatement.has(pair.statementId) || usedManual.has(pair.manualId)) return false
    usedStatement.add(pair.statementId)
    usedManual.add(pair.manualId)
    return true
  })
}

/** Observações do lançamento conciliado: mantém as originais e acrescenta a chave/linha do extrato e a marca da conciliação. */
export function reconciledNotes(manualNotes = "", statementNotes = "", on = new Date().toISOString().slice(0, 10)) {
  const base = manualNotes.trim()
  const bank = statementNotes.trim()
  const marker = `Conciliado com o extrato em ${on.split("-").reverse().join("/")}.`
  return [base, bank, marker].filter(Boolean).join("\n")
}

export const levelLabel: Record<MatchLevel, string> = { Alta: "Alta", Media: "Média", Baixa: "Baixa" }
