import { NextResponse } from "next/server"
import { currentUserRole } from "@/lib/server-authorization"
import { stockContext } from "@/lib/stock-api"
import { companyBranding, emailConfigured, quoteError } from "@/lib/quotes-server"
import { getSelectedSystemCompany } from "@/lib/system-company-server"
import { listPriceTables, listTemplates, loadSection } from "@/lib/config-server"
import { readAllPages } from "@/lib/supabase-pagination"

/** Listas do formulário: clientes, vendedores, catálogo (preço, custo e estoque), condições e dados da empresa. */
export async function GET() {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const { role } = await currentUserRole()
    const [templates, priceTables, commercial] = await Promise.all([listTemplates(context.admin).catch(() => []), listPriceTables(context.admin).catch(() => []), loadSection(context.admin, "commercial")])
    const company = await getSelectedSystemCompany()
    const [clients, people, conditions, materials, services, warehouses, opportunities, branding] = await Promise.all([
      readAllPages<any>((from, to) => context.admin.from("clients").select("id,name,document,status,phone,email").neq("status", "Inativo").order("name").order("id").range(from, to)),
      context.admin.from("salespeople").select("id,name,status").eq("status", "Ativo").order("name"),
      context.admin.from("payment_conditions").select("*").eq("status", "Ativo").order("name"),
      readAllPages<any>((from, to) => context.admin.from("materials").select("*").eq("status", "Ativo").order("name").order("id").range(from, to)),
      context.admin.from("service_types").select("*").eq("status", "Ativo").order("name"),
      context.admin.from("warehouses").select("id,name,is_default").eq("status", "Ativo").order("is_default", { ascending: false }).order("name"),
      context.admin.from("opportunities").select("id,code,title,client_id,salesperson_id,interest,estimated_value,stage").not("stage", "in", "(Ganho,Perdido)").order("created_at", { ascending: false }).limit(300),
      companyBranding(context.admin, company.id),
    ])
    // catálogo de venda: produtos finais e itens liberados para venda; kits e matéria-prima de consumo não entram no orçamento
    const sellable = materials.filter((row) => row.available_for_quote !== false && (row.item_type === "Produto" || (row.item_type !== "Kit" && row.item_type !== "Materia-prima") || (row.item_type === "Materia-prima" && row.allows_sale === true)))
    const snapshots = new Map<string, any>()
    const productIds = sellable.filter((row) => row.item_type === "Produto").map((row) => row.id as string)
    for (let at = 0; at < productIds.length; at += 200) {
      const { data, error } = await context.admin.rpc("product_quote_snapshot", { p_ids: productIds.slice(at, at + 200) })
      if (error) break // script 222 ainda não instalado: segue com os dados do cadastro
      for (const row of (data || []) as any[]) snapshots.set(row.id as string, row)
    }
    const withEngineering = new Set<string>()
    const engineering = await context.admin.from("product_engineering_revisions").select("product_id").neq("status", "Obsoleta")
    if (!engineering.error) for (const row of engineering.data || []) withEngineering.add(row.product_id as string)
    return NextResponse.json({
      clients: clients.map((row) => ({ id: row.id, name: row.name, document: row.document || "", status: row.status, phone: row.phone || "", email: row.email || "" })),
      salespeople: (people.data || []).map((row) => ({ id: row.id, name: row.name })),
      paymentConditions: (conditions.data || []).map((row) => ({ id: row.id, name: row.name, installments: Number(row.installments || 1), firstDueDays: Number(row.first_due_days || 0), intervalDays: Number(row.interval_days ?? 30) })),
      products: sellable.map((row) => { const snap = snapshots.get(row.id); return ({ id: row.id, name: row.name, code: row.internal_code || "", unit: row.unit || "UN", price: Number(row.sale_price || 0), cost: snap?.bom_version_id ? Number(snap.est_cost || 0) : Number(row.average_cost || row.cost_price || 0), bomVersion: snap?.bom_version ?? null, hasEngineering: withEngineering.has(row.id), leadTimeDays: snap?.lead_time_days ?? (row.lead_time_days ? Number(row.lead_time_days) : null), marginPercent: snap?.bom_version_id ? snap.margin_percent : null, stock: Number(row.current_stock || 0), reserved: Number(row.reserved_stock || 0), controlsStock: row.controls_stock !== false }) }),
      services: (services.data || []).map((row) => ({ id: row.id, name: row.name, code: row.code || "", unit: row.billing_unit || "Servico", price: Number(row.default_price || 0), cost: Number(row.estimated_cost || 0), warrantyDays: Number(row.warranty_days || 0) })),
      warehouses: (warehouses.data || []).map((row) => ({ id: row.id, name: row.name, isDefault: Boolean(row.is_default) })),
      opportunities: (opportunities.data || []).map((row) => ({ id: row.id, code: row.code, title: row.title, clientId: row.client_id, salespersonId: row.salesperson_id, interest: row.interest, estimatedValue: Number(row.estimated_value || 0), stage: row.stage })),
      company: { id: branding.id, name: branding.name, legalName: branding.legalName, cnpj: branding.cnpj, email: branding.email, phone: branding.phone, address: branding.address, hasLogo: branding.hasLogo },
      templates: templates.filter((item) => item.active),
      priceTables: priceTables.filter((item) => item.active),
      settings: { defaultValidityDays: Number(commercial.defaultValidityDays || 15), discountApprovalPercent: Number(commercial.discountApprovalPercent || 0) },
      emailConfigured: emailConfigured(),
      canConfigure: role === "admin" || role === "manager",
    })
  } catch (error) {
    const { message, status } = quoteError(error, "Erro ao carregar opções.")
    return NextResponse.json({ error: message }, { status })
  }
}
