import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { salesError } from "@/lib/sales-server"
import { readSalesOrderPdf, salesOrderDocuments, salesOrderPdfData, storeSalesOrderPdf } from "@/lib/sales-pdf-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * ?data=1[&photos=<item>:<foto>,...]  dados para montar o PDF (configuração congelada, fotografia, parcelas)
 * ?version=N[&download=1]               PDF já emitido (a versão mais recente se omitir)
 * (sem parâmetros)                      lista das versões emitidas
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const { id } = await params
  if (!uuid.test(id)) return NextResponse.json({ error: "Pedido inválido." }, { status: 400 })
  const query = new URL(request.url).searchParams
  try {
    if (query.get("data")) {
      const choices: Record<string, string> = {}
      for (const pair of (query.get("photos") || "").split(",").filter(Boolean)) { const [item, photo] = pair.split(":"); if (uuid.test(item || "") && uuid.test(photo || "")) choices[item] = photo }
      return NextResponse.json({ data: await salesOrderPdfData(context.admin, id, choices) })
    }
    if (query.get("version") !== null) {
      const version = Number(query.get("version"))
      const { bytes, document } = await readSalesOrderPdf(context.admin, id, Number.isInteger(version) && version > 0 ? version : undefined)
      return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `${query.get("download") ? "attachment" : "inline"}; filename="${String(document.file_name).replace(/"/g, "")}"`, "Cache-Control": "private, max-age=60" } })
    }
    return NextResponse.json({ documents: await salesOrderDocuments(context.admin, id) })
  } catch (error) {
    const mapped = salesError(error)
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}

/** Grava o PDF emitido (multipart: file, source, reason, photoRefs, configurationRefs, summary). Cada emissão é uma versão nova e imutável. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const { id } = await params
  if (!uuid.test(id)) return NextResponse.json({ error: "Pedido inválido." }, { status: 400 })
  try {
    const form = await request.formData()
    const file = form.get("file")
    if (!(file instanceof File)) return NextResponse.json({ error: "Envie o PDF." }, { status: 400 })
    const json = (key: string, fallback: unknown) => { try { return JSON.parse(String(form.get(key) || "")) } catch { return fallback } }
    const source = ["conversao", "manual", "revisao"].includes(String(form.get("source"))) ? String(form.get("source")) : "manual"
    const saved = await storeSalesOrderPdf(context.admin, id, file, { source, reason: String(form.get("reason") || ""), photoRefs: json("photoRefs", []), configurationRefs: json("configurationRefs", []), summary: json("summary", {}) }, context.responsible)
    return NextResponse.json({ saved, documents: await salesOrderDocuments(context.admin, id) })
  } catch (error) {
    const mapped = salesError(error)
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}
