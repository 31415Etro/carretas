import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

function clientRow(input: any) {
  return {
    id: input.id,
    type: input.type || "PJ",
    name: input.name,
    document: input.document || "",
    corporate_name: input.corporateName || input.corporate_name || input.name || "",
    trade_name: input.tradeName || input.trade_name || input.name || "",
    state_registration: input.stateRegistration || input.state_registration || "",
    responsible_name: input.responsibleName || input.responsible_name || "",
    phone: input.phone || "",
    mobile: input.mobile || "",
    email: input.email || "",
    zip_code: input.zipCode || input.zip_code || "",
    street: input.street || "",
    number: input.number || "",
    complement: input.complement || "",
    district: input.district || "",
    city: input.city || "",
    state: input.state || "",
    service_contexts: Array.isArray(input.serviceContexts || input.service_contexts) ? (input.serviceContexts || input.service_contexts) : [],
    status: input.status || "Ativo",
    notes: input.notes || "",
  }
}

function environmentRow(input: any) {
  return {
    id: input.id,
    client_id: input.clientId || input.client_id,
    name: input.name,
    location: input.location || "",
    floor: input.floor || "",
    activity_type: input.activityType || input.activity_type || "",
    equipment_description: input.equipmentDescription || input.equipment_description || "",
    thermal_load: input.thermalLoad || input.thermal_load || "",
    occupants_total: Math.max(0, Number(input.occupantsTotal || input.occupants_total || 0)),
    occupants_fixed: Math.max(0, Number(input.occupantsFixed || input.occupants_fixed || 0)),
    occupants_floating: Math.max(0, Number(input.occupantsFloating || input.occupants_floating || 0)),
    air_conditioned_area: Math.max(0, Number(input.airConditionedArea || input.air_conditioned_area || 0)),
    notes: input.notes || "",
    status: input.status || "Ativo",
  }
}

function equipmentRow(input: any) {
  return {
    id: input.id,
    client_id: input.clientId || input.client_id,
    client_environment_id: input.clientEnvironmentId || input.client_environment_id,
    tag: input.tag || "",
    name: input.name,
    type: input.type || "",
    brand: input.brand || "",
    model: input.model || "",
    serial_number: input.serialNumber || input.serial_number || "",
    capacity: input.capacity || "",
    notes: input.notes || "",
    status: input.status || "Ativo",
  }
}

function toClient(row: any) {
  return {
    id: row.id,
    type: row.type || "PJ",
    name: row.name,
    document: row.document || "",
    corporateName: row.corporate_name || "",
    tradeName: row.trade_name || "",
    stateRegistration: row.state_registration || "",
    responsibleName: row.responsible_name || "",
    phone: row.phone || "",
    mobile: row.mobile || "",
    email: row.email || "",
    zipCode: row.zip_code || "",
    street: row.street || "",
    number: row.number || "",
    complement: row.complement || "",
    district: row.district || "",
    city: row.city || "",
    state: row.state || "",
    serviceContexts: Array.isArray(row.service_contexts) ? row.service_contexts : [],
    status: row.status || "Ativo",
    notes: row.notes || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  }
}

function toEnvironment(row: any) {
  return {
    id: row.id,
    clientId: row.client_id,
    name: row.name,
    location: row.location || "",
    floor: row.floor || "",
    activityType: row.activity_type || "",
    equipmentDescription: row.equipment_description || "",
    thermalLoad: row.thermal_load || "",
    occupantsTotal: Number(row.occupants_total || 0),
    occupantsFixed: Number(row.occupants_fixed || 0),
    occupantsFloating: Number(row.occupants_floating || 0),
    airConditionedArea: Number(row.air_conditioned_area || 0),
    notes: row.notes || "",
    status: row.status || "Ativo",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  }
}

function toEquipment(row: any) {
  return {
    id: row.id,
    clientId: row.client_id,
    clientEnvironmentId: row.client_environment_id,
    tag: row.tag || "",
    name: row.name,
    type: row.type || "",
    brand: row.brand || "",
    model: row.model || "",
    serialNumber: row.serial_number || "",
    capacity: row.capacity || "",
    notes: row.notes || "",
    status: row.status || "Ativo",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  }
}

async function upsertRows(supabase: ReturnType<typeof createAdminClient>, table: string, rows: any[]) {
  const cleanRows = Array.from(new Map(rows.filter((row) => row?.id).map((row) => [row.id, row])).values())
  if (!cleanRows.length) return []
  const { data, error } = await supabase.from(table).upsert(cleanRows, { onConflict: "id" }).select("*")
  if (error) throw new Error(`${table}: ${error.message}`)
  return data || []
}

export async function POST(request: Request) {
  try {
    const { clients = [], environments = [], equipment = [] } = await request.json()
    if (!clients.length && !environments.length && !equipment.length) {
      return NextResponse.json({ error: "Nenhum cliente, ambiente ou equipamento para importar." }, { status: 400 })
    }

    const supabase = createAdminClient()
    const savedClients = await upsertRows(supabase, "clients", clients.map(clientRow))
    const savedEnvironments = await upsertRows(supabase, "client_environments", environments.map(environmentRow))
    const savedEquipment = await upsertRows(supabase, "client_equipment", equipment.map(equipmentRow))

    return NextResponse.json({
      clients: savedClients.map(toClient),
      environments: savedEnvironments.map(toEnvironment),
      equipment: savedEquipment.map(toEquipment),
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao importar ambientes e equipamentos." }, { status: 500 })
  }
}
