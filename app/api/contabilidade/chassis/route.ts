import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { ACCOUNTING_MIGRATION_HINT } from "@/lib/accounting-server"
import { chassisChart, chassisFromInvoice, digits, filterChassis, type ChassisRow } from "@/lib/chassis"
import { createAdminClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const COLUMNS = "id,number,series,issued_at,access_key,nature,recipient_name,recipient_document,total_invoice,items:data->items"

/**
 * Chassis das notas de venda (saída) da Contabilidade, de todas as empresas.
 *   ?opcoes=clientes           clientes do sistema para o seletor
 *   ?q=&clienteId=&de=&ate=&interna=1   consulta (chassi inteiro ou parte, número da nota, cliente) + números do gráfico do período
 */
export async function GET(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const params = new URL(request.url).searchParams
    if (params.get("opcoes") === "clientes") {
      const { data, error } = await context.admin.from("clients").select("id,name,document").order("name").limit(5000)
      if (error) throw error
      return NextResponse.json({ clients: (data || []).map((row) => ({ id: String(row.id), name: String(row.name || ""), document: String(row.document || "") })) })
    }
    const isDay = (value: string | null) => /^\d{4}-\d{2}-\d{2}$/.test(value || "")
    const companies = await createAdminClient({ bypassCompanyScope: true }).from("system_companies").select("id,name,trade_name,cnpj").order("is_default", { ascending: false }).order("name")
    if (companies.error) throw companies.error
    const groupDocuments = (companies.data || []).map((company) => digits(company.cnpj || ""))

    const all: ChassisRow[] = []
    let notes = 0
    for (const company of companies.data || []) {
      const admin = createAdminClient({ companyId: company.id })
      for (let from = 0; ; from += 200) {
        let query = admin.from("accounting_invoices").select(COLUMNS).eq("operation", "Saída")
        if (isDay(params.get("de"))) query = query.gte("issued_at", `${params.get("de")}T00:00:00-03:00`)
        if (isDay(params.get("ate"))) query = query.lte("issued_at", `${params.get("ate")}T23:59:59-03:00`)
        const page = await query.order("issued_at", { ascending: false }).order("id").range(from, from + 199)
        if (page.error) {
          if (/accounting_invoices/.test(page.error.message) && /does not exist|Could not find|schema cache/i.test(page.error.message)) throw new Error(ACCOUNTING_MIGRATION_HINT)
          throw page.error
        }
        for (const invoice of page.data || []) all.push(...chassisFromInvoice(invoice as never, { id: company.id, name: company.trade_name || company.name }, groupDocuments))
        notes += (page.data || []).length
        if ((page.data || []).length < 200) break
      }
    }

    let clientDocument = "", clientName = ""
    const clientId = params.get("clienteId")
    if (clientId) {
      const client = await context.admin.from("clients").select("name,document").eq("id", clientId).maybeSingle()
      if (client.error) throw client.error
      clientDocument = digits(client.data?.document || ""); clientName = String(client.data?.name || "")
    }
    const rows = filterChassis(all, { q: params.get("q") || "", clientDocument, clientName: clientDocument ? "" : clientName, includeIntercompany: params.get("interna") === "1" })
      .sort((a, b) => String(b.issuedAt || "").localeCompare(String(a.issuedAt || "")) || b.number.localeCompare(a.number))
    return NextResponse.json({ rows: rows.slice(0, 500), found: rows.length, notes, chart: chassisChart(all), client: clientId ? { name: clientName, document: clientDocument } : null })
  } catch (error) {
    const message = error instanceof Error ? error.message : (error as { message?: string })?.message || "Não foi possível consultar os chassis."
    return NextResponse.json({ error: message }, { status: message === ACCOUNTING_MIGRATION_HINT ? 503 : 400 })
  }
}
