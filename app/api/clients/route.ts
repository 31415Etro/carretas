import { NextResponse } from "next/server"
import { currentUserRole } from "@/lib/server-authorization"
import { createAdminClient } from "@/lib/supabase/server"

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const serviceContexts = new Set(["obra", "pmoc", "servicos"])

export async function POST(request: Request) {
  const { user, role } = await currentUserRole()
  if (!user) return NextResponse.json({ error: "Nao autenticado." }, { status: 401 })
  if (role === "client") return NextResponse.json({ error: "Sem permissao para cadastrar clientes." }, { status: 403 })

  try {
    const { client: input } = await request.json()
    if (!input || !uuid.test(input.id || "") || !String(input.name || "").trim() || !String(input.document || "").trim()) {
      return NextResponse.json({ error: "Informe nome, CPF/CNPJ e um identificador valido." }, { status: 400 })
    }
    const contexts = Array.isArray(input.serviceContexts) ? input.serviceContexts.filter((value: unknown) => serviceContexts.has(String(value))) : []
    const monthlyPmocValue = contexts.includes("pmoc") ? Math.max(0, Number(input.monthlyPmocValue || 0)) : 0
    if (!Number.isFinite(monthlyPmocValue)) return NextResponse.json({ error: "Informe um valor mensal de PMOC valido." }, { status: 400 })

    const row = {
      id: input.id,
      type: input.type === "PF" ? "PF" : "PJ",
      name: String(input.name).trim(),
      document: String(input.document).trim(),
      corporate_name: input.corporateName || "",
      trade_name: input.tradeName || "",
      state_registration: input.stateRegistration || "",
      responsible_name: input.responsibleName || "",
      phone: input.phone || "",
      mobile: input.mobile || "",
      email: input.email || "",
      zip_code: input.zipCode || "",
      street: input.street || "",
      number: input.number || "",
      complement: input.complement || "",
      district: input.district || "",
      city: input.city || "",
      state: input.state || "",
      service_contexts: contexts,
      monthly_pmoc_value: monthlyPmocValue,
      status: ["Ativo", "Inativo", "Prospect"].includes(input.status) ? input.status : "Ativo",
      notes: input.notes || "",
    }
    const { data, error } = await createAdminClient().from("clients").upsert(row, { onConflict: "id" }).select("*").single()
    if (error) throw new Error(`clients: ${error.message}`)
    return NextResponse.json({ client: {
      id: data.id, type: data.type, name: data.name, document: data.document,
      corporateName: data.corporate_name || "", tradeName: data.trade_name || "", stateRegistration: data.state_registration || "",
      responsibleName: data.responsible_name || "", phone: data.phone || "", mobile: data.mobile || "", email: data.email || "",
      zipCode: data.zip_code || "", street: data.street || "", number: data.number || "", complement: data.complement || "",
      district: data.district || "", city: data.city || "", state: data.state || "", serviceContexts: data.service_contexts || [],
      monthlyPmocValue: Number(data.monthly_pmoc_value || 0), status: data.status, notes: data.notes || "",
      createdAt: data.created_at, updatedAt: data.updated_at,
    } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao salvar cliente." }, { status: 400 })
  }
}
