import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { analyzeInvoices } from "@/lib/accounting-analysis"
import { ACCOUNTING_MIGRATION_HINT } from "@/lib/accounting-server"
import { fetchAllPages, memoize } from "@/lib/paged-fetch"
import { createAdminClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const COLUMNS = "operation,number,issued_at,issuer_name,issuer_document,issuer_state,total_invoice,total_products,total_icms,total_icms_st,total_ipi,total_pis,total_cofins,total_iss,total_freight,total_discount,total_taxes,items:data->items,issuer:data->issuer,totals:data->totals"

/** Indicadores das notas das empresas somados (uma análise por empresa e a análise do conjunto). Filtros: operacao, de, ate. Empresas e páginas lidas em paralelo; resultado guardado por 45 s. */
export async function GET(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const params = new URL(request.url).searchParams
    const isDay = (value: string | null) => /^\d{4}-\d{2}-\d{2}$/.test(value || "")
    const operation = params.get("operacao")
    const de = isDay(params.get("de")) ? String(params.get("de")) : ""
    const ate = isDay(params.get("ate")) ? String(params.get("ate")) : ""
    const payload = await memoize(`consolidado|${operation || ""}|${de}|${ate}`, 45_000, async () => {
      const companies = await createAdminClient({ bypassCompanyScope: true }).from("system_companies").select("id,name,trade_name,cnpj").order("is_default", { ascending: false }).order("name")
      if (companies.error) throw companies.error
      const perCompany = await Promise.all((companies.data || []).map(async (company) => {
        const admin = createAdminClient({ companyId: company.id })
        const read = await fetchAllPages<any>((from, to) => {
          let query = admin.from("accounting_invoices").select(COLUMNS)
          if (operation === "Entrada" || operation === "Saída") query = query.eq("operation", operation)
          if (de) query = query.gte("issued_at", `${de}T00:00:00-03:00`)
          if (ate) query = query.lte("issued_at", `${ate}T23:59:59-03:00`)
          return query.order("issued_at", { ascending: false }).order("id").range(from, to)
        })
        const rows = read.map(({ items, issuer, totals, ...row }: any) => ({ ...row, data: { items: items || [], issuer: issuer || {}, totals: totals || {} } }))
        return { company, rows, analysis: analyzeInvoices(rows) }
      }))
      return {
        companies: perCompany.map(({ company, analysis }) => ({ id: company.id, name: company.trade_name || company.name, cnpj: company.cnpj, analysis: { ...analysis, materials: [] } })),
        total: analyzeInvoices(perCompany.flatMap((entry) => entry.rows)),
      }
    })
    return NextResponse.json(payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : (error as any)?.message || "Não foi possível consolidar as empresas."
    const missing = /accounting_invoices/.test(message) && /does not exist|Could not find|schema cache/i.test(message)
    return NextResponse.json({ error: missing ? ACCOUNTING_MIGRATION_HINT : message }, { status: missing ? 503 : 400 })
  }
}
