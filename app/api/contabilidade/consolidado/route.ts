import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { analyzeInvoices } from "@/lib/accounting-analysis"
import { ACCOUNTING_MIGRATION_HINT } from "@/lib/accounting-server"
import { createAdminClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const COLUMNS = "operation,number,issued_at,issuer_name,issuer_document,issuer_state,total_invoice,total_products,total_icms,total_icms_st,total_ipi,total_pis,total_cofins,total_iss,total_freight,total_discount,total_taxes,data"

/** Indicadores das notas das empresas somados (uma análise por empresa e a análise do conjunto). Filtros: operacao, de, ate. */
export async function GET(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const params = new URL(request.url).searchParams
    const isDay = (value: string | null) => /^\d{4}-\d{2}-\d{2}$/.test(value || "")
    const operation = params.get("operacao")
    const companies = await createAdminClient({ bypassCompanyScope: true }).from("system_companies").select("id,name,trade_name,cnpj").order("is_default", { ascending: false }).order("name")
    if (companies.error) throw companies.error

    const all: any[] = []
    const perCompany = []
    for (const company of companies.data || []) {
      const admin = createAdminClient({ companyId: company.id })
      const rows: any[] = []
      for (let from = 0; ; from += 200) {
        let query = admin.from("accounting_invoices").select(COLUMNS)
        if (operation === "Entrada" || operation === "Saída") query = query.eq("operation", operation)
        if (isDay(params.get("de"))) query = query.gte("issued_at", `${params.get("de")}T00:00:00-03:00`)
        if (isDay(params.get("ate"))) query = query.lte("issued_at", `${params.get("ate")}T23:59:59-03:00`)
        const page = await query.order("issued_at", { ascending: false }).order("id").range(from, from + 199)
        if (page.error) {
          if (/accounting_invoices/.test(page.error.message) && /does not exist|Could not find|schema cache/i.test(page.error.message)) throw new Error(ACCOUNTING_MIGRATION_HINT)
          throw page.error
        }
        rows.push(...(page.data || []))
        if ((page.data || []).length < 200) break
      }
      all.push(...rows)
      const analysis = analyzeInvoices(rows)
      perCompany.push({ id: company.id, name: company.trade_name || company.name, cnpj: company.cnpj, analysis: { ...analysis, materials: [] } })
    }
    return NextResponse.json({ companies: perCompany, total: analyzeInvoices(all) })
  } catch (error) {
    const message = error instanceof Error ? error.message : (error as any)?.message || "Não foi possível consolidar as empresas."
    return NextResponse.json({ error: message }, { status: message === ACCOUNTING_MIGRATION_HINT ? 503 : 400 })
  }
}
