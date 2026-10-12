import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { contractError } from "@/lib/contracts-server"
import { listParties } from "@/lib/commercial-server"
import { listQuotes } from "@/lib/quotes-server"
import { getSelectedSystemCompany } from "@/lib/system-company-server"
import { readAllPages } from "@/lib/supabase-pagination"
import { paymentMethodOptions } from "@/lib/finance-erp"

/** Listas do formulário: contratantes/fornecedores, responsáveis, serviços, técnicos, carretas dos clientes e orçamentos aprovados. */
export async function GET() {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const company = await getSelectedSystemCompany()
    const [parties, quotes, profiles, services, providers, assets] = await Promise.all([
      listParties(context.admin),
      listQuotes(context.admin),
      context.admin.from("profiles").select("id,full_name,email,active").order("full_name"),
      context.admin.from("service_types").select("id,name,code").eq("status", "Ativo").order("name"),
      context.admin.from("providers").select("id,full_name,status").order("full_name"),
      readAllPages<any>((from, to) => context.admin.from("customer_assets").select("id,client_id,identification,plate,asset_type").eq("status", "Ativo").order("identification").order("id").range(from, to)),
    ])
    return NextResponse.json({
      company: { id: company.id, name: company.tradeName || company.name, cnpj: company.cnpj },
      clients: parties.filter((row) => row.clientId && row.status !== "Inativo").map((row) => ({ id: row.clientId, name: row.name, document: row.document, status: row.status })),
      suppliers: parties.filter((row) => row.supplierId && row.status !== "Inativo").map((row) => ({ id: row.supplierId, name: row.name, document: row.document })),
      users: (profiles.data || []).filter((row) => row.active !== false).map((row) => ({ id: row.id, name: row.full_name || row.email, email: row.email })),
      services: (services.data || []).map((row) => ({ id: row.id, name: row.name, code: row.code || "" })),
      technicians: (providers.data || []).filter((row) => row.status !== "Inativo").map((row) => ({ id: row.id, name: row.full_name })),
      assets: assets.map((row) => ({ id: row.id, clientId: row.client_id, name: [row.identification, row.plate].filter(Boolean).join(" · ") })),
      quotes: quotes.filter((row) => row.effectiveStatus === "Aprovado").map((row) => ({ id: row.id, number: row.number, version: row.version, clientId: row.clientId, clientName: row.clientName, total: row.totalAmount, paymentConditionName: row.paymentConditionName, salespersonName: row.salespersonName })),
      paymentMethods: paymentMethodOptions,
    })
  } catch (error) {
    const { message, status } = contractError(error, "Erro ao carregar opções.")
    return NextResponse.json({ error: message }, { status })
  }
}
