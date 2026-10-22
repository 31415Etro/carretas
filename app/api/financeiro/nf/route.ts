import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { getSelectedSystemCompanyId } from "@/lib/supabase/server"
import { importInvoice, NF_MIGRATION_HINT, previewInvoice } from "@/lib/nf-import-server"
import { registryError } from "@/lib/registry-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const bad = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message : (error as any)?.message || fallback
  if (message === NF_MIGRATION_HINT || /imported_invoices/.test(message) && /does not exist|Could not find|schema cache/i.test(message)) return NextResponse.json({ error: NF_MIGRATION_HINT }, { status: 503 })
  return NextResponse.json({ error: registryError(error, fallback).message }, { status: 400 })
}

/**
 * Notas já importadas, da emissão mais recente para a mais antiga.
 * Filtros: papel (Destinatário = recebidas/entrada, Remetente = emitidas/saída), q (nome, CNPJ ou número), de/ate (emissão, yyyy-mm-dd), page, size.
 */
export async function GET(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const params = new URL(request.url).searchParams
    const size = Math.min(200, Math.max(1, Number(params.get("size")) || 200))
    const page = Math.max(1, Number(params.get("page")) || 1)
    const role = params.get("papel") || ""
    const term = (params.get("q") || "").replace(/[%,()*]/g, " ").trim()
    const isDay = (value: string | null) => /^\d{4}-\d{2}-\d{2}$/.test(value || "")
    const from = isDay(params.get("de")) ? params.get("de") : ""
    const until = isDay(params.get("ate")) ? params.get("ate") : ""
    const filtered = (query: any) => {
      let next = query
      if (role === "Remetente" || role === "Destinatário") next = next.eq("my_role", role)
      if (term) next = next.or(["issuer_name", "recipient_name", "issuer_document", "recipient_document", "number"].map((column) => `${column}.ilike.%${term}%`).join(","))
      if (from) next = next.gte("issued_at", `${from}T00:00:00-03:00`)
      if (until) next = next.lte("issued_at", `${until}T23:59:59-03:00`)
      return next
    }
    const columns = "id,kind,number,series,issued_at,total_amount,my_role,issuer_name,issuer_document,recipient_name,recipient_document,counterpart_name,counterpart_document,counterpart_kind,created_at,created_by"
    const { data, error, count } = await filtered(context.admin.from("imported_invoices").select(columns, { count: "exact" })).order("issued_at", { ascending: false, nullsFirst: false }).range((page - 1) * size, page * size - 1)
    if (error) throw error
    let sum = 0
    for (let offset = 0; offset < (count || 0); offset += 1000) {
      const part = await filtered(context.admin.from("imported_invoices").select("total_amount")).order("issued_at", { ascending: false, nullsFirst: false }).range(offset, offset + 999)
      if (part.error) throw part.error
      for (const row of part.data || []) sum += Number((row as { total_amount: number }).total_amount || 0)
    }
    return NextResponse.json({ items: data || [], total: count || 0, sum: Math.round(sum * 100) / 100, page, size })
  } catch (error) {
    return bad(error, "Erro ao carregar as notas importadas.")
  }
}

/** multipart: file, role (remetente|destinatario), action (ler|importar), registerAs ("" | cliente | fornecedor). */
export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const form = await request.formData()
    const fileEntry = form.get("file")
    const ocrText = String(form.get("ocrText") || "")
    const file = fileEntry instanceof File ? fileEntry : undefined
    const fileName = String(form.get("fileName") || file?.name || "nota")
    const role = String(form.get("role") || "")
    const action = String(form.get("action") || "ler")
    const registerAs = String(form.get("registerAs") || "")
    const launch = String(form.get("launch") ?? "1") !== "0"
    if (!file && !ocrText.trim()) return NextResponse.json({ error: "Envie o arquivo da nota (XML, PDF ou foto)." }, { status: 400 })
    if (role !== "remetente" && role !== "destinatario") return NextResponse.json({ error: "Escolha se você é o remetente ou o destinatário da nota." }, { status: 400 })
    if (!["", "cliente", "fornecedor"].includes(registerAs)) return NextResponse.json({ error: "Opção de cadastro inválida." }, { status: 400 })
    const companyId = await getSelectedSystemCompanyId()
    if (action === "importar") return NextResponse.json({ result: await importInvoice(context.admin, { file, ocrText, fileName }, role, companyId, registerAs as "" | "cliente" | "fornecedor", context.responsible, launch) })
    return NextResponse.json(await previewInvoice(context.admin, { file, ocrText, fileName }, role, companyId))
  } catch (error) {
    return bad(error, "Erro ao ler a nota.")
  }
}
