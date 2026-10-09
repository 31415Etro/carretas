import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const TABLE = "commercial_leads"
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const stages = new Set(["prospeccao", "contato", "qualificacao", "proposta", "negociacao", "ganho", "perdido"])

function score(value: unknown) {
  return Math.min(5, Math.max(0, Math.round(Number(value || 0))))
}

function amount(value: unknown) {
  const text = String(value ?? "").trim()
  if (!text) return 0
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text
  const parsed = Number(normalized.replace(/[^\d.-]/g, ""))
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

function missingTable(message = "") {
  return /commercial_leads|schema cache|relation/i.test(message)
}

export async function GET() {
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase.from(TABLE).select("*").order("updated_at", { ascending: false })
    if (error) {
      if (missingTable(error.message)) return NextResponse.json({ error: "Execute o SQL scripts/127_add_lead_bant_funnel.sql no Supabase para habilitar o Funil BANT." }, { status: 409 })
      throw error
    }
    return NextResponse.json({ data: data || [] })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao carregar leads comerciais." }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const input = await request.json()
    const name = String(input.name || "").trim()
    if (!name) return NextResponse.json({ error: "Nome do lead e obrigatorio." }, { status: 400 })
    const row = {
      name,
      company: String(input.company || "").trim(),
      email: String(input.email || "").trim(),
      phone: String(input.phone || "").trim(),
      location: String(input.location || "").trim(),
      source: String(input.source || "Manual").trim(),
      estimated_value: amount(input.estimatedValue),
      bant_stage: stages.has(String(input.stage || "")) ? input.stage : "prospeccao",
    }
    const supabase = createAdminClient()
    const { data, error } = await supabase.from(TABLE).insert(row).select("*").single()
    if (error) {
      if (missingTable(error.message)) return NextResponse.json({ error: "Execute o SQL scripts/127_add_lead_bant_funnel.sql no Supabase antes de cadastrar leads." }, { status: 409 })
      throw error
    }
    return NextResponse.json({ lead: data })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao cadastrar lead comercial." }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const input = await request.json()
    const id = String(input.id || "")
    if (!uuidPattern.test(id)) return NextResponse.json({ error: "Lead invalido." }, { status: 400 })

    const update: Record<string, unknown> = { bant_updated_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    if (input.stage !== undefined) {
      const stage = String(input.stage || "")
      if (!stages.has(stage)) return NextResponse.json({ error: "Etapa comercial invalida." }, { status: 400 })
      update.bant_stage = stage
    }
    if (input.budget !== undefined) update.bant_budget = score(input.budget)
    if (input.authority !== undefined) update.bant_authority = score(input.authority)
    if (input.need !== undefined) update.bant_need = score(input.need)
    if (input.timeline !== undefined) update.bant_timeline = score(input.timeline)
    if (input.notes !== undefined) update.bant_notes = String(input.notes || "")

    const supabase = createAdminClient()
    const { data, error } = await supabase.from(TABLE).update(update).eq("id", id).select("*").single()
    if (error) {
      if (missingTable(error.message)) return NextResponse.json({ error: "Execute o SQL scripts/127_add_lead_bant_funnel.sql no Supabase antes de salvar o BANT." }, { status: 409 })
      throw error
    }
    return NextResponse.json({ lead: data })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao salvar qualificacao BANT." }, { status: 500 })
  }
}
