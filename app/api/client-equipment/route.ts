import { NextResponse } from "next/server"
import { currentUserRole } from "@/lib/server-authorization"
import { createAdminClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  const { user, role } = await currentUserRole()
  if (!user) return NextResponse.json({ error: "Nao autenticado." }, { status: 401 })
  if (role === "client") return NextResponse.json({ error: "Sem permissao para cadastrar equipamentos." }, { status: 403 })
  try {
    const { equipment: input } = await request.json()
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!input || ![input.id, input.clientId, input.clientEnvironmentId].every((id) => uuid.test(id || "")) || !String(input.name || "").trim()) {
      return NextResponse.json({ error: "Selecione um cliente e ambiente salvos e informe o equipamento." }, { status: 400 })
    }
    const supabase = createAdminClient()
    const { data: environment, error: environmentError } = await supabase.from("client_environments")
      .select("id").eq("id", input.clientEnvironmentId).eq("client_id", input.clientId).maybeSingle()
    if (environmentError) throw new Error(environmentError.message)
    if (!environment) return NextResponse.json({ error: "O ambiente nao pertence ao cliente selecionado." }, { status: 400 })
    const row = {
      id: input.id, client_id: input.clientId, client_environment_id: input.clientEnvironmentId,
      name: String(input.name).trim(), tag: input.tag || "", type: input.type || "",
      brand: input.brand || "", model: input.model || "", serial_number: input.serialNumber || "",
      capacity: input.capacity || "", notes: input.notes || "", status: input.status === "Inativo" ? "Inativo" : "Ativo",
    }
    const { data, error } = await supabase.from("client_equipment").upsert(row, { onConflict: "id" }).select("*").single()
    if (error) throw new Error(`client_equipment: ${error.message}`)
    return NextResponse.json({ equipment: {
      id: data.id, clientId: data.client_id, clientEnvironmentId: data.client_environment_id,
      name: data.name, tag: data.tag, type: data.type, brand: data.brand, model: data.model,
      serialNumber: data.serial_number, capacity: data.capacity, notes: data.notes, status: data.status,
      createdAt: data.created_at, updatedAt: data.updated_at,
    } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao salvar equipamento." }, { status: 400 })
  }
}
