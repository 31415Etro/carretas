import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { lastRun, requestEntry, statusByVins, triggerRenaverWorker } from "@/lib/renaver-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Situação no Renaver dos chassis informados (?vins=a,b,c) e da última verificação do robô. */
export async function GET(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const vins = (new URL(request.url).searchParams.get("vins") || "").split(",").map((item) => item.trim()).filter(Boolean)
    const [items, run] = await Promise.all([statusByVins(vins), lastRun()])
    return NextResponse.json({ items, run })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao consultar o Renaver." }, { status: 500 })
  }
}

/**
 * { action: "entrada", vin }  pede a Entrada de Zero KM no Renaver (só administrador ou gerente: a entrada é uma operação oficial);
 * { action: "verificar" }     roda a verificação agora, sem esperar o horário do dia.
 */
export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  if (context.role !== "admin" && context.role !== "manager") return NextResponse.json({ error: "Só administrador ou gerente opera o Renaver." }, { status: 403 })
  try {
    const body = await request.json() as Record<string, unknown>
    if (body.action === "verificar") return NextResponse.json({ started: triggerRenaverWorker() })
    if (body.action === "entrada") {
      const vin = await requestEntry(String(body.vin || ""), context.responsible)
      return NextResponse.json({ ok: true, vin })
    }
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao operar o Renaver." }, { status: 400 })
  }
}
