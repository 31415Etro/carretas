import { NextResponse } from "next/server"
import { validSyncSecret } from "@/lib/nf-sync-server"
import { claimNext, finishJob, reportProgress } from "@/lib/nfe-emission-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * Canal do robô de emissão (scripts/nfemail/emitir.mjs), autenticado por NF_SYNC_SECRET.
 *   { acao: "proximo" }                                  -> próximo trabalho da fila (ou { job: null })
 *   { acao: "andamento", id, texto }                     -> registra um passo no histórico
 *   { acao: "fim", id, tipo: "emitir"|"cancelar", ok, erro, numero, serie, chave, protocolo, xml }
 */
export async function POST(request: Request) {
  if (!validSyncSecret(request)) return NextResponse.json({ error: "Nao autenticado" }, { status: 401 })
  try {
    const body = await request.json() as Record<string, any>
    if (body.acao === "proximo") return NextResponse.json({ job: await claimNext() })
    if (body.acao === "andamento") { await reportProgress(String(body.id), String(body.texto || "")); return NextResponse.json({ ok: true }) }
    if (body.acao === "fim") {
      await finishJob({ id: String(body.id), action: body.tipo === "cancelar" ? "cancelar" : "emitir", ok: Boolean(body.ok), error: body.erro ? String(body.erro) : undefined, number: body.numero ? String(body.numero) : undefined, series: body.serie ? String(body.serie) : undefined, accessKey: body.chave ? String(body.chave) : undefined, protocol: body.protocolo ? String(body.protocolo) : undefined, xml: body.xml ? String(body.xml) : undefined })
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Erro" }, { status: 500 }) }
}
