import { NextResponse } from "next/server"
import { currentUserRole } from "@/lib/server-authorization"
import { createAdminClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  const { user, role } = await currentUserRole()
  if (!user) return NextResponse.json({ error: "Nao autenticado." }, { status: 401 })
  if (role === "client") return NextResponse.json({ error: "Sem permissao para cadastrar ambientes." }, { status: 403 })
  try {
    const { environment: input } = await request.json()
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!input || !uuid.test(input.id || "") || !uuid.test(input.clientId || "") || !String(input.name || "").trim()) {
      return NextResponse.json({ error: "Selecione um cliente salvo e informe o nome do ambiente." }, { status: 400 })
    }
    const number = (value: unknown) => {
      const parsed = Number(value || 0)
      if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Informe valores numericos validos para ocupantes e area.")
      return parsed
    }
    const row = {
      id: input.id, client_id: input.clientId, name: String(input.name).trim(),
      location: input.location || "", floor: input.floor || "", activity_type: input.activityType || "",
      equipment_description: input.equipmentDescription || "", thermal_load: input.thermalLoad || "",
      occupants_total: number(input.occupantsTotal), occupants_fixed: number(input.occupantsFixed),
      occupants_floating: number(input.occupantsFloating), air_conditioned_area: number(input.airConditionedArea),
      notes: input.notes || "", status: input.status === "Inativo" ? "Inativo" : "Ativo",
    }
    const { data, error } = await createAdminClient().from("client_environments").upsert(row, { onConflict: "id" }).select("id,created_at,updated_at").single()
    if (error) throw new Error(`client_environments: ${error.message}`)
    return NextResponse.json({ environment: { ...input, name: row.name, createdAt: data.created_at, updatedAt: data.updated_at } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao salvar ambiente." }, { status: 400 })
  }
}
