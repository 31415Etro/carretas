import { NextResponse } from "next/server"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/server"
import { isCurrentUserAdmin } from "@/lib/server-authorization"
import { listSystemCompanies } from "@/lib/system-company-server"
import { formatCnpj, mapSystemCompany } from "@/lib/system-company"

const companySchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2),
  legalName: z.string().trim().optional().default(""),
  tradeName: z.string().trim().optional().default(""),
  cnpj: z.string().optional().default(""),
  email: z.string().trim().optional().default(""),
  phone: z.string().trim().optional().default(""),
  address: z.string().trim().optional().default(""),
  active: z.boolean().optional().default(true),
  isDefault: z.boolean().optional().default(false),
})

export async function GET() {
  if (!await isCurrentUserAdmin()) return NextResponse.json({ error: "Acesso negado" }, { status: 403 })
  return NextResponse.json({ companies: await listSystemCompanies(false) })
}

export async function POST(request: Request) {
  if (!await isCurrentUserAdmin()) return NextResponse.json({ error: "Acesso negado" }, { status: 403 })
  const parsed = companySchema.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: "Preencha ao menos o nome da empresa" }, { status: 400 })

  const value = parsed.data
  const cnpj = value.cnpj.replace(/\D/g, "")
  if (cnpj && cnpj.length !== 14) return NextResponse.json({ error: "CNPJ deve ter 14 digitos" }, { status: 400 })

  const admin = createAdminClient({ bypassCompanyScope: true })
  if (value.isDefault) await admin.from("system_companies").update({ is_default: false }).neq("id", value.id || "")
  const row = {
    ...(value.id ? { id: value.id } : {}),
    name: value.name,
    legal_name: value.legalName || value.name,
    trade_name: value.tradeName || value.name,
    cnpj: cnpj ? formatCnpj(cnpj) : null,
    email: value.email || null,
    phone: value.phone || null,
    address: value.address || null,
    active: value.active,
    is_default: value.isDefault,
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await admin.from("system_companies").upsert(row, { onConflict: "id" }).select("*").single()
  if (error) {
    const message = error.message.includes("system_companies")
      ? "A migracao de multiempresa ainda nao foi aplicada no Supabase"
      : error.message
    return NextResponse.json({ error: message }, { status: 500 })
  }
  return NextResponse.json({ company: mapSystemCompany(data) })
}

export async function DELETE(request: Request) {
  if (!await isCurrentUserAdmin()) return NextResponse.json({ error: "Acesso negado" }, { status: 403 })
  const { id } = await request.json()
  const admin = createAdminClient({ bypassCompanyScope: true })
  const { data: company } = await admin.from("system_companies").select("is_default").eq("id", id).maybeSingle()
  if (company?.is_default) return NextResponse.json({ error: "A empresa principal nao pode ser desativada" }, { status: 400 })
  const { error } = await admin.from("system_companies").update({ active: false, updated_at: new Date().toISOString() }).eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
