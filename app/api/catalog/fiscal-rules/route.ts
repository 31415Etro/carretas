import { NextResponse } from "next/server"
import { validateFiscalRules, type FiscalRule } from "@/lib/fiscal-rules"
import { stockContext } from "@/lib/stock-api"

const MIGRATION_HINT = "Regras fiscais ainda não instaladas: rode scripts/205_catalogo_produtos_servicos.sql no Supabase."
const missing = (message = "") => /does not exist|Could not find|schema cache/i.test(message)

function toRule(row: any): FiscalRule {
  return { id: row.id, operation: row.operation, taxRegime: row.tax_regime, cfop: row.cfop || "", cstCsosn: row.cst_csosn || "", ibsCbsCst: row.ibs_cbs_cst || "", ibsCbsClass: row.ibs_cbs_class || "", validFrom: row.valid_from || "", validTo: row.valid_to || "", notes: row.notes || "" }
}

export async function GET(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const materialId = new URL(request.url).searchParams.get("materialId")
  if (!materialId) return NextResponse.json({ error: "Informe o produto." }, { status: 400 })
  const { data, error } = await context.admin.from("product_fiscal_rules").select("*").eq("material_id", materialId).order("operation").order("valid_from", { nullsFirst: true })
  if (error) return NextResponse.json({ error: missing(error.message) ? MIGRATION_HINT : error.message }, { status: missing(error.message) ? 503 : 400 })
  return NextResponse.json({ rules: (data || []).map(toRule) })
}

/** Substitui o conjunto de regras fiscais do produto. */
export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const { materialId, rules } = await request.json() as { materialId: string; rules: FiscalRule[] }
    if (!materialId || !Array.isArray(rules)) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 })
    const clean = rules.map((rule) => ({ ...rule, cfop: String(rule.cfop || "").replace(/\D/g, ""), cstCsosn: String(rule.cstCsosn || "").trim(), ibsCbsCst: String(rule.ibsCbsCst || "").replace(/\D/g, ""), ibsCbsClass: String(rule.ibsCbsClass || "").replace(/\D/g, "") }))
    const invalid = validateFiscalRules(clean)
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 })
    const { error: deleteError } = await context.admin.from("product_fiscal_rules").delete().eq("material_id", materialId)
    if (deleteError) throw new Error(deleteError.message)
    if (clean.length) {
      const { error } = await context.admin.from("product_fiscal_rules").insert(clean.map((rule) => ({
        material_id: materialId,
        operation: rule.operation,
        tax_regime: rule.taxRegime,
        cfop: rule.cfop || null,
        cst_csosn: rule.cstCsosn || null,
        ibs_cbs_cst: rule.ibsCbsCst || null,
        ibs_cbs_class: rule.ibsCbsClass || null,
        valid_from: rule.validFrom || null,
        valid_to: rule.validTo || null,
        notes: rule.notes || "",
      })))
      if (error) throw new Error(error.message)
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao salvar regras fiscais."
    return NextResponse.json({ error: missing(message) ? MIGRATION_HINT : message }, { status: missing(message) ? 503 : 400 })
  }
}
