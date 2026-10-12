import { NextResponse } from "next/server"
import { currentUserRole } from "@/lib/server-authorization"
import { stockContext } from "@/lib/stock-api"
import { companyBranding, emailConfigured, quoteError } from "@/lib/quotes-server"
import { getSelectedSystemCompany } from "@/lib/system-company-server"
import { readAllPages } from "@/lib/supabase-pagination"

/** Listas do formulário: clientes, vendedores, catálogo (preço, custo e estoque), condições e dados da empresa. */
export async function GET() {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const { role } = await currentUserRole()
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
    return NextResponse.json({
      clients: clients.map((row) => ({ id: row.id, name: row.name, document: row.document || "", status: row.status, phone: row.phone || "", email: row.email || "" })),
      salespeople: (people.data || []).map((row) => ({ id: row.id, name: row.name })),
      paymentConditions: (conditions.data || []).map((row) => ({ id: row.id, name: row.name, installments: Number(row.installments || 1), firstDueDays: Number(row.first_due_days || 0), intervalDays: Number(row.interval_days ?? 30) })),
      products: materials.map((row) => ({ id: row.id, name: row.name, code: row.internal_code || "", unit: row.unit || "UN", price: Number(row.sale_price || 0), cost: Number(row.average_cost || row.cost_price || 0), stock: Number(row.current_stock || 0), reserved: Number(row.reserved_stock || 0), controlsStock: row.controls_stock !== false })),
      services: (services.data || []).map((row) => ({ id: row.id, name: row.name, code: row.code || "", unit: row.billing_unit || "Servico", price: Number(row.default_price || 0), cost: Number(row.estimated_cost || 0), warrantyDays: Number(row.warranty_days || 0) })),
      warehouses: (warehouses.data || []).map((row) => ({ id: row.id, name: row.name, isDefault: Boolean(row.is_default) })),
      opportunities: (opportunities.data || []).map((row) => ({ id: row.id, code: row.code, title: row.title, clientId: row.client_id, salespersonId: row.salesperson_id, interest: row.interest, estimatedValue: Number(row.estimated_value || 0), stage: row.stage })),
      company: { id: branding.id, name: branding.name, legalName: branding.legalName, cnpj: branding.cnpj, email: branding.email, phone: branding.phone, address: branding.address, hasLogo: branding.hasLogo },
      emailConfigured: emailConfigured(),
      canConfigure: role === "admin" || role === "manager",
    })
  } catch (error) {
    const { message, status } = quoteError(error, "Erro ao carregar opções.")
    return NextResponse.json({ error: message }, { status })
  }
}
