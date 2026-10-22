// Sugestão de NCM a partir da tabela oficial (Siscomex/Camex), consultada pela BrasilAPI. Funções puras (testáveis).
// Regras: só sugere códigos de 8 dígitos VIGENTES, no máximo 3, com fonte, ato legal e justificativa; nunca confirma sozinho.
export type NcmRecord = { codigo: string; descricao: string; data_inicio: string; data_fim: string; tipo_ato?: string; numero_ato?: string; ano_ato?: string }
export type NcmCandidate = {
  code: string
  codeFormatted: string
  description: string
  validFrom: string
  source: string
  matchedWords: string[]
  score: number
  confidence: "alta" | "media" | "baixa"
  justification: string
}

export const NCM_SOURCE = "Tabela NCM oficial (Siscomex/Camex) via BrasilAPI"
const STOP = new Set(["de", "da", "do", "das", "dos", "para", "com", "sem", "por", "em", "e", "ou", "a", "o", "as", "os", "um", "uma", "tipo", "outros", "outras", "demais", "mm", "cm", "kg", "un", "pc"])

const strip = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
export const wordsOf = (text: string) => Array.from(new Set(strip(text).replace(/<[^>]+>/g, " ").split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !STOP.has(word))))

/** Radical simples (singular/plural e flexões comuns) para casar "parafusos" com "parafuso". */
const stem = (word: string) => word.replace(/(oes|aes|ais|eis|ois|s)$/, "").replace(/(ao)$/, "a")

export const isLeafCode = (code: string) => /^\d{4}\.\d{2}\.\d{2}$/.test(code)
export const digitsOf = (code: string) => code.replace(/\D/g, "")
export const formatNcm = (digits: string) => (digits.length === 8 ? `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6)}` : digits)
export const isCurrent = (record: Pick<NcmRecord, "data_inicio" | "data_fim">, today = new Date().toISOString().slice(0, 10)) => record.data_inicio <= today && today <= record.data_fim

/**
 * Pontua os registros pelo texto informado (nome, descrição, características) por palavras em comum com a descrição oficial do NCM.
 * Confiança: alta = 3+ palavras em comum e 60%+ das palavras do item; média = 2+ palavras; baixa = 1 palavra. Sem palavra em comum, não sugere.
 */
export function rankNcm(records: NcmRecord[], text: string, today?: string): NcmCandidate[] {
  const wanted = wordsOf(text).map(stem)
  if (!wanted.length) return []
  const seen = new Set<string>()
  const candidates: NcmCandidate[] = []
  for (const record of records) {
    if (!isLeafCode(record.codigo) || !isCurrent(record, today) || seen.has(record.codigo)) continue
    seen.add(record.codigo)
    const description = record.descricao.replace(/<[^>]+>/g, "").replace(/^[\s-]+/, "").replace(/\*$/, "").trim()
    const have = new Set(wordsOf(description).map(stem))
    const matched = wanted.filter((word) => have.has(word))
    if (!matched.length) continue
    const share = matched.length / wanted.length
    const score = Math.round((matched.length * 10 + share * 10) * 10) / 10
    const confidence = matched.length >= 3 && share >= 0.6 ? "alta" : matched.length >= 2 ? "media" : "baixa"
    candidates.push({
      code: digitsOf(record.codigo), codeFormatted: record.codigo, description, validFrom: record.data_inicio,
      source: `${NCM_SOURCE}${record.tipo_ato ? ` · ${record.tipo_ato} ${record.numero_ato}/${record.ano_ato}` : ""}`,
      matchedWords: matched, score, confidence,
      justification: `Coincide em: ${matched.join(", ")} (${matched.length} de ${wanted.length} palavras informadas). Confira a descrição oficial antes de confirmar.`,
    })
  }
  return candidates.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code)).slice(0, 3)
}

/** Termos de busca enviados à fonte: o nome inteiro e cada palavra relevante (a fonte busca por trecho da descrição oficial). */
export function searchTerms(text: string) {
  const words = wordsOf(text)
  return Array.from(new Set([strip(text).trim(), ...words])).filter((term) => term.length > 2).slice(0, 6)
}

/** Resultado para a tela: candidatos e, se nenhum for confiável, o aviso para classificar manualmente. */
export function suggestionOutcome(candidates: NcmCandidate[]) {
  const reliable = candidates.filter((candidate) => candidate.confidence !== "baixa")
  if (!reliable.length) {
    return { candidates, needsManualReview: true, message: "Não há confiança suficiente para sugerir um NCM. Informe a classificação manualmente ou peça revisão ao responsável fiscal." }
  }
  return { candidates, needsManualReview: false, message: "Confira a descrição oficial e confirme o NCM. A sugestão nunca é gravada sem a sua confirmação." }
}
