import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { ACCOUNTING_MIGRATION_HINT } from "@/lib/accounting-server"
import { chassisByModel, chassisByModelMonth, chassisChart, chassisFromInvoice, chassisPerChassis, digits, filterChassis, otherNoteFromInvoice, type ChassisRow, type OtherNote } from "@/lib/chassis"
import { fetchAllPages, memoize } from "@/lib/paged-fetch"
import { createAdminClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const COLUMNS = "id,number,series,issued_at,access_key,nature,recipient_name,recipient_document,total_invoice,items:data->items"
const CACHE_MS = 60_000

/** Todos os chassis das notas de venda do período, de todas as empresas. Lê em páginas de 1.000, empresas e páginas em paralelo, e guarda por 1 minuto (digitar na busca não volta ao banco). */
function loadChassis(de: string, ate: string) {
  return memoize(`chassis|${de}|${ate}`, CACHE_MS, async () => {
    const companies = await createAdminClient({ bypassCompanyScope: true }).from("system_companies").select("id,name,trade_name,cnpj").order("is_default", { ascending: false }).order("name")
    if (companies.error) throw companies.error
    const groupDocuments = (companies.data || []).map((company) => digits(company.cnpj || ""))
    const perCompany = await Promise.all((companies.data || []).map(async (company) => {
      const admin = createAdminClient({ companyId: company.id })
      const invoices = await fetchAllPages<Record<string, unknown>>((from, to) => {
        let query = admin.from("accounting_invoices").select(COLUMNS).eq("operation", "Saída")
        if (de) query = query.gte("issued_at", `${de}T00:00:00-03:00`)
        if (ate) query = query.lte("issued_at", `${ate}T23:59:59-03:00`)
        return query.order("issued_at", { ascending: false }).order("id").range(from, to) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>
      })
      const rows: ChassisRow[] = []
      const others: OtherNote[] = []
      for (const invoice of invoices) {
        const found = chassisFromInvoice(invoice as never, { id: company.id, name: company.trade_name || company.name }, groupDocuments)
        if (found.length) rows.push(...found)
        else others.push(otherNoteFromInvoice(invoice as never, { id: company.id, name: company.trade_name || company.name }, groupDocuments)) // peças e outros: só nos totais
      }
      return { rows, others, notes: invoices.length }
    }))
    return { rows: perCompany.flatMap((entry) => entry.rows), others: perCompany.flatMap((entry) => entry.others), notes: perCompany.reduce((sum, entry) => sum + entry.notes, 0) }
  })
}

/**
 * Chassis das notas de venda (saída) da Contabilidade, de todas as empresas.
 *   ?opcoes=clientes                      clientes do sistema para o seletor
 *   ?q=&clienteId=&de=&ate=&interna=1     consulta (chassi inteiro ou parte, número da nota, cliente) + números do gráfico do período
 *   &visao=modelo | chassi                análise: quantidade e valor por modelo (e por mês) ou por chassi, com os mesmos filtros
 */
export async function GET(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const params = new URL(request.url).searchParams
    if (params.get("opcoes") === "clientes") {
      const { data, error } = await memoize("chassis|clientes", CACHE_MS * 5, async () => {
        const result = await context.admin.from("clients").select("id,name,document").order("name").limit(5000)
        return { data: result.data, error: result.error }
      })
      if (error) throw error
      return NextResponse.json({ clients: (data || []).map((row) => ({ id: String(row.id), name: String(row.name || ""), document: String(row.document || "") })) })
    }
    const isDay = (value: string | null) => /^\d{4}-\d{2}-\d{2}$/.test(value || "")
    const de = isDay(params.get("de")) ? String(params.get("de")) : ""
    const ate = isDay(params.get("ate")) ? String(params.get("ate")) : ""
    let loaded
    try { loaded = await loadChassis(de, ate) } catch (error) {
      const message = (error as { message?: string })?.message || ""
      if (/accounting_invoices/.test(message) && /does not exist|Could not find|schema cache/i.test(message)) throw new Error(ACCOUNTING_MIGRATION_HINT)
      throw error
    }

    let clientDocument = "", clientName = ""
    const clientId = params.get("clienteId")
    if (clientId) {
      const client = await context.admin.from("clients").select("name,document").eq("id", clientId).maybeSingle()
      if (client.error) throw client.error
      clientDocument = digits(client.data?.document || ""); clientName = String(client.data?.name || "")
    }
    const rows = filterChassis(loaded.rows, { q: params.get("q") || "", clientDocument, clientName: clientDocument ? "" : clientName, includeIntercompany: params.get("interna") === "1" })
    const client = clientId ? { name: clientName, document: clientDocument } : null
    const view = params.get("visao")
    if (view === "modelo") return NextResponse.json({ found: rows.length, notes: loaded.notes, client, byModel: chassisByModel(rows), byModelMonth: chassisByModelMonth(rows) })
    if (view === "todos") return NextResponse.json({ notes: loaded.notes, others: loaded.others, rows: loaded.rows.map(({ description, accessKey, nature, ...slim }) => slim) }) // página Chassis: gráficos e filtros são feitos no navegador
    if (view === "chassi") return NextResponse.json({ found: rows.length, notes: loaded.notes, client, perChassis: chassisPerChassis(rows) })
    rows.sort((a, b) => String(b.issuedAt || "").localeCompare(String(a.issuedAt || "")) || b.number.localeCompare(a.number))
    return NextResponse.json({ rows: rows.slice(0, 500), found: rows.length, notes: loaded.notes, chart: chassisChart(loaded.rows), client })
  } catch (error) {
    const message = error instanceof Error ? error.message : (error as { message?: string })?.message || "Não foi possível consultar os chassis."
    return NextResponse.json({ error: message }, { status: message === ACCOUNTING_MIGRATION_HINT ? 503 : 400 })
  }
}
