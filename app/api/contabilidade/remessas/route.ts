import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { ACCOUNTING_MIGRATION_HINT } from "@/lib/accounting-server"
import { chassisFromInvoice, digits } from "@/lib/chassis"
import { fetchAllPages, memoize } from "@/lib/paged-fetch"
import { onlyRemessas, remessaCfop, withoutCancelled } from "@/lib/remessas"
import { createAdminClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const COLUMNS = "id,operation,number,series,issued_at,access_key,nature,issuer_name,issuer_document,recipient_name,recipient_document,total_invoice,items:data->items"

type Item = { description?: string; total?: number | string; quantity?: number | string; unitPrice?: number | string; ncm?: string; cfop?: string }

/**
 * Notas de remessa (CFOP 5912 / 6912) de todas as empresas, entradas e saídas, com as carretas de cada uma (modelo e quantidade).
 * Filtros: de, ate (data de emissão). O resto (empresa, sentido, CFOP, busca) é filtrado no navegador. Guardado por 1 minuto.
 */
export async function GET(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const params = new URL(request.url).searchParams
    const isDay = (value: string | null) => /^\d{4}-\d{2}-\d{2}$/.test(value || "")
    const de = isDay(params.get("de")) ? String(params.get("de")) : ""
    const ate = isDay(params.get("ate")) ? String(params.get("ate")) : ""
    const payload = await memoize(`remessas|${de}|${ate}`, 60_000, async () => {
      const companies = await createAdminClient({ bypassCompanyScope: true }).from("system_companies").select("id,name,trade_name,cnpj").order("is_default", { ascending: false }).order("name")
      if (companies.error) throw companies.error
      const groupDocuments = (companies.data || []).map((company) => digits(company.cnpj || ""))
      const perCompany = await Promise.all((companies.data || []).map(async (company) => {
        const admin = createAdminClient({ companyId: company.id })
        const invoices = await fetchAllPages<Record<string, unknown>>((from, to) => {
          let query = withoutCancelled(onlyRemessas(admin.from("accounting_invoices").select(COLUMNS) as never) as any) as any // remessa cancelada não conta
          if (de) query = query.gte("issued_at", `${de}T00:00:00-03:00`)
          if (ate) query = query.lte("issued_at", `${ate}T23:59:59-03:00`)
          return query.order("issued_at", { ascending: false }).order("id").range(from, to) as PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>
        })
        const name = company.trade_name || company.name
        return invoices.map((invoice) => {
          const items = ((invoice.items as Item[] | null) || [])
          const trailers = chassisFromInvoice(invoice as never, { id: company.id, name }, groupDocuments)
          const models = new Map<string, number>()
          for (const row of trailers) models.set(row.model || "Sem modelo", (models.get(row.model || "Sem modelo") || 0) + (row.chassis ? 1 : row.quantity))
          const document = digits(String(invoice.recipient_document || ""))
          return {
            id: String(invoice.id), companyId: company.id, companyName: name, operation: String(invoice.operation || ""), number: String(invoice.number || ""), series: String(invoice.series || ""),
            issuedAt: (invoice.issued_at as string) || null, nature: String(invoice.nature || ""), cfop: remessaCfop(items),
            issuerName: String(invoice.issuer_name || ""), recipientName: String(invoice.recipient_name || ""), recipientDocument: document, intercompany: groupDocuments.includes(document),
            total: Number(invoice.total_invoice || 0), itemCount: items.length, quantity: items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0),
            carretas: trailers.reduce((sum, row) => sum + (row.chassis ? 1 : row.quantity), 0), models: [...models.entries()].map(([model, quantity]) => ({ model, quantity })),
          }
        })
      }))
      return { notes: perCompany.flat().sort((a, b) => String(b.issuedAt || "").localeCompare(String(a.issuedAt || ""))) }
    })
    return NextResponse.json(payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : (error as { message?: string })?.message || "Não foi possível carregar as remessas."
    const missing = /accounting_invoices/.test(message) && /does not exist|Could not find|schema cache/i.test(message)
    return NextResponse.json({ error: missing ? ACCOUNTING_MIGRATION_HINT : message }, { status: missing ? 503 : 400 })
  }
}
