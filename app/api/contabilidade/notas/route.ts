import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { analyzeInvoices } from "@/lib/accounting-analysis"
import { ACCOUNTING_MIGRATION_HINT, importAccountingXml } from "@/lib/accounting-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const fail = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message : (error as any)?.message || fallback
  const missing = message === ACCOUNTING_MIGRATION_HINT || (/accounting_invoices/.test(message) && /does not exist|Could not find|schema cache/i.test(message))
  return NextResponse.json({ error: missing ? ACCOUNTING_MIGRATION_HINT : message }, { status: missing ? 503 : 400 })
}

/** Lista as notas (sem o XML e sem a lista de campos; o detalhe completo vem por ?id=). Filtros: operacao, q, de, ate. */
export async function GET(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const params = new URL(request.url).searchParams
    const id = params.get("id")
    if (id) {
      const detail = await context.admin.from("accounting_invoices").select("*").eq("id", id).maybeSingle()
      if (detail.error) throw detail.error
      return NextResponse.json({ invoice: detail.data })
    }
    const isDay = (value: string | null) => /^\d{4}-\d{2}-\d{2}$/.test(value || "")
    const term = (params.get("q") || "").replace(/[%,()*]/g, " ").trim()
    const operation = params.get("operacao")
    const filtered = (query: any) => {
      let next = query
      if (operation === "Entrada" || operation === "Saída") next = next.eq("operation", operation)
      if (term) next = next.or(["issuer_name", "recipient_name", "issuer_document", "recipient_document", "number", "access_key", "nature"].map((column) => `${column}.ilike.%${term}%`).join(","))
      if (isDay(params.get("de"))) next = next.gte("issued_at", `${params.get("de")}T00:00:00-03:00`)
      if (isDay(params.get("ate"))) next = next.lte("issued_at", `${params.get("ate")}T23:59:59-03:00`)
      return next
    }
    if (params.get("analise")) {
      // indicadores calculados no servidor, em páginas, para não trazer todos os itens ao navegador
      const rows: any[] = []
      for (let from = 0; ; from += 200) {
        const page = await filtered(context.admin.from("accounting_invoices").select("operation,number,issued_at,issuer_name,issuer_document,issuer_state,total_invoice,total_products,total_icms,total_icms_st,total_ipi,total_pis,total_cofins,total_iss,total_freight,total_discount,total_taxes,data").order("issued_at", { ascending: false }).order("id")).range(from, from + 199)
        if (page.error) throw page.error
        rows.push(...(page.data || []))
        if ((page.data || []).length < 200) break
      }
      const analysis = analyzeInvoices(rows)
      if (params.get("itens")) {
        const items = rows.flatMap((row) => (row.data?.items || []).map((item: any) => ({ operation: row.operation, number: row.number, issued_at: row.issued_at, issuer_name: row.issuer_name, issuer_document: row.issuer_document, item })))
        return NextResponse.json({ items })
      }
      return NextResponse.json({ analysis })
    }
    const invoices: any[] = []
    for (let from = 0; from < 5000; from += 1000) {
      const page = await filtered(context.admin.from("accounting_invoices").select("id,operation,kind,access_key,number,series,issued_at,nature,issuer_document,issuer_name,recipient_document,recipient_name,total_products,total_invoice,total_icms_base,total_icms,total_icms_st,total_ipi,total_pis,total_cofins,total_iss,total_freight,total_discount,total_taxes,file_name,created_at").order("issued_at", { ascending: false, nullsFirst: false }).order("id")).range(from, from + 999)
      if (page.error) throw page.error
      invoices.push(...(page.data || []))
      if ((page.data || []).length < 1000) break
    }
    return NextResponse.json({ invoices })
  } catch (error) { return fail(error, "Não foi possível carregar as notas.") }
}

/** Importa um XML por chamada (o navegador manda um de cada vez para mostrar o andamento). */
export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const body = await request.json()
    const xml = String(body.xml || "")
    if (!xml.trim()) throw new Error("Arquivo vazio.")
    const result = await importAccountingXml(context.admin, { xml, fileName: String(body.fileName || "nota.xml").slice(0, 200), operation: body.operation === "Saída" ? "Saída" : "Entrada", responsible: context.responsible })
    return NextResponse.json(result)
  } catch (error) { return fail(error, "Não foi possível importar a nota.") }
}

export async function DELETE(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  if (context.role !== "admin") return NextResponse.json({ error: "Só administrador exclui nota." }, { status: 403 })
  try {
    const id = new URL(request.url).searchParams.get("id") || ""
    const { error } = await context.admin.from("accounting_invoices").delete().eq("id", id)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) { return fail(error, "Não foi possível excluir a nota.") }
}
