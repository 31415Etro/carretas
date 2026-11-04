import { NextResponse } from "next/server"
import { validSyncSecret } from "@/lib/nf-sync-server"
import { pendingEntries, saveEntryResult, saveFailedRun, saveSnapshot } from "@/lib/renaver-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * Canal do robô do Renaver (scripts/renaver/sincronizar.mjs), autenticado por NF_SYNC_SECRET.
 *   { acao: "pedidos", cnpj }                              -> chassis com Entrada de Zero KM pedida na tela
 *   { acao: "entrada", cnpj, vin, ok, mensagem }           -> resultado de uma Entrada de Zero KM
 *   { acao: "leitura", cnpj, linhas, inicio, entradas }    -> o que o robô leu nas quatro abas (fecha a rodada)
 *   { acao: "falha", cnpj, erro, inicio }                  -> rodada que não conseguiu ler o portal
 */
export async function POST(request: Request) {
  if (!validSyncSecret(request)) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 })
  try {
    const body = await request.json() as Record<string, any>
    const cnpj = String(body.cnpj || "")
    if (body.acao === "pedidos") return NextResponse.json({ vins: await pendingEntries(cnpj) })
    if (body.acao === "entrada") { await saveEntryResult({ cnpj, vin: String(body.vin || ""), ok: Boolean(body.ok), message: String(body.mensagem || "") }); return NextResponse.json({ ok: true }) }
    if (body.acao === "leitura") return NextResponse.json({ ok: true, ...(await saveSnapshot({ cnpj, rows: body.linhas, startedAt: body.inicio ? String(body.inicio) : undefined, entries: Array.isArray(body.entradas) ? body.entradas : [] })) })
    if (body.acao === "falha") { await saveFailedRun({ cnpj, error: String(body.erro || "Falha sem detalhe."), startedAt: body.inicio ? String(body.inicio) : undefined }); return NextResponse.json({ ok: true }) }
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Erro" }, { status: 500 }) }
}
