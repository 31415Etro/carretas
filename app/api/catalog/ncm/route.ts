import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { NCM_SOURCE, rankNcm, searchTerms, suggestionOutcome, type NcmRecord } from "@/lib/ncm"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

const SEARCH_URL = "https://brasilapi.com.br/api/ncm/v1"
const cache = new Map<string, { at: number; records: NcmRecord[] }>()
const CACHE_MS = 6 * 3_600_000

async function search(term: string): Promise<NcmRecord[]> {
  const cached = cache.get(term)
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.records
  const response = await fetch(`${SEARCH_URL}?search=${encodeURIComponent(term)}`, { signal: AbortSignal.timeout(8_000), cache: "no-store" })
  if (!response.ok) throw new Error(`Fonte de NCM respondeu ${response.status}`)
  const records = (await response.json()) as NcmRecord[]
  cache.set(term, { at: Date.now(), records: Array.isArray(records) ? records : [] })
  return Array.isArray(records) ? records : []
}

/**
 * Sugere até 3 NCMs vigentes a partir do nome e das características do item. Nunca grava nada: o usuário confirma na tela.
 * GET /api/catalog/ncm?q=<nome>&description=<descrição técnica>
 */
export async function GET(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const params = new URL(request.url).searchParams
  const text = [params.get("q"), params.get("description"), params.get("material")].filter(Boolean).join(" ").slice(0, 400)
  if (text.trim().length < 3) return NextResponse.json({ error: "Informe o nome do item (mínimo 3 letras)." }, { status: 400 })
  try {
    const found = await Promise.allSettled(searchTerms(text).map((term) => search(term)))
    const records = found.flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    if (!records.length && found.every((result) => result.status === "rejected")) throw new Error("A fonte oficial de NCM está indisponível no momento.")
    return NextResponse.json({ source: NCM_SOURCE, checkedAt: new Date().toISOString(), ...suggestionOutcome(rankNcm(records, text)) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao consultar a fonte de NCM.", needsManualReview: true, candidates: [] }, { status: 502 })
  }
}
