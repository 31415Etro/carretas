import { createHash } from "node:crypto"
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isUuid(value?: string | null) {
  return Boolean(value && uuidPattern.test(value))
}

function uuidFromText(value: string) {
  const hash = createHash("sha1").update(`service-types:${value}`).digest("hex")
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}

function normalizeId(value?: string | null) {
  if (!value) return ""
  return isUuid(value) ? value : uuidFromText(value)
}

function nullableUuid(value?: string | null) {
  return value ? normalizeId(value) : null
}

function periodicityMonths(value: unknown) {
  const months = Number(value || 1)
  return [1, 2, 3, 6].includes(months) ? months : 1
}

function serviceTypeRow(input: any, existingId?: string) {
  return {
    id: existingId || normalizeId(input.id || input.name),
    name: String(input.name || "").trim(),
    description: input.description || "",
    status: input.status || "Ativo",
    kit_id: nullableUuid(input.kitId || input.kit_id),
    execution_percentage: Number(input.executionPercentage || input.execution_percentage || 0),
    periodicity_months: periodicityMonths(input.periodicityMonths || input.periodicity_months),
    enabled_contexts: Array.isArray(input.enabledContexts) && input.enabledContexts.length ? input.enabledContexts : ["obra"],
    required_photos: Array.isArray(input.requiredPhotos) ? input.requiredPhotos : [],
    orientation_video_url: input.orientationVideoUrl || input.video || "",
    orientation_video_description: input.orientationVideoDescription || "",
  }
}

function checklistRow(input: any, serviceTypeId: string, index: number) {
  return {
    id: normalizeId(input.id || `${serviceTypeId}:checklist:${input.taskName || index}`),
    service_type_id: serviceTypeId,
    task_name: String(input.taskName || "").trim(),
    required: input.required ?? true,
    requires_photo: Boolean(input.requiresPhoto),
    order_index: Number(input.order || index + 1),
    notes: input.notes || "",
  }
}

async function upsertOne(supabase: ReturnType<typeof createAdminClient>, table: string, row: any) {
  let currentRow = row
  let error: any = null
  for (let attempt = 0; attempt < 12; attempt++) {
    const result = await supabase.from(table).upsert(currentRow, { onConflict: "id" }).select("*").single()
    error = result.error
    if (!error) return result.data
    const missingColumn = error.message.match(/Could not find the '([^']+)' column/)?.[1]
    if (!missingColumn) break
    const { [missingColumn]: _ignored, ...rest } = currentRow
    currentRow = rest
  }
  throw new Error(`${table}: ${error?.message || "erro ao salvar"}`)
}

async function insertRows(supabase: ReturnType<typeof createAdminClient>, table: string, rows: any[]) {
  const cleanRows = rows.filter((row) => row?.id && row.task_name)
  if (!cleanRows.length) return []
  let currentRows = cleanRows
  let error: any = null
  for (let attempt = 0; attempt < 12; attempt++) {
    const result = await supabase.from(table).insert(currentRows).select("*")
    error = result.error
    if (!error) return result.data || []
    const missingColumn = error.message.match(/Could not find the '([^']+)' column/)?.[1]
    if (!missingColumn) break
    currentRows = currentRows.map((row) => {
      const { [missingColumn]: _ignored, ...rest } = row
      return rest
    })
  }
  throw new Error(`${table}: ${error?.message || "erro ao salvar"}`)
}

export async function POST(request: Request) {
  try {
    const { serviceType, checklist = [] } = await request.json()
    const name = String(serviceType?.name || "").trim()
    if (!name) return NextResponse.json({ error: "Nome do serviço é obrigatório." }, { status: 400 })

    const supabase = createAdminClient()
    const { data: existing, error: lookupError } = await supabase
      .from("service_types")
      .select("id")
      .ilike("name", name)
      .maybeSingle()
    if (lookupError) throw new Error(`service_types: ${lookupError.message}`)

    const savedService = await upsertOne(supabase, "service_types", serviceTypeRow({ ...serviceType, name }, existing?.id))
    if (savedService.periodicity_months == null) {
      throw new Error("Campo periodicity_months ausente. Execute a migracao 131_add_service_type_periodicity.sql no Supabase.")
    }

    const { error: deleteError } = await supabase
      .from("service_type_checklist_items")
      .delete()
      .eq("service_type_id", savedService.id)
    if (deleteError) throw new Error(`service_type_checklist_items: ${deleteError.message}`)

    const savedChecklist = await insertRows(
      supabase,
      "service_type_checklist_items",
      checklist.map((item: any, index: number) => checklistRow(item, savedService.id, index)),
    )

    return NextResponse.json({
      serviceType: {
        id: savedService.id,
        name: savedService.name,
        description: savedService.description || "",
        status: savedService.status || "Ativo",
        kitId: savedService.kit_id || "",
        executionPercentage: Number(savedService.execution_percentage || 0),
        periodicityMonths: periodicityMonths(savedService.periodicity_months),
        enabledContexts: savedService.enabled_contexts || serviceType.enabledContexts || ["obra"],
        requiredPhotos: savedService.required_photos || serviceType.requiredPhotos || [],
        orientationVideoUrl: savedService.orientation_video_url || "",
        orientationVideoDescription: savedService.orientation_video_description || "",
        createdAt: savedService.created_at || new Date().toISOString(),
        updatedAt: savedService.updated_at || new Date().toISOString(),
      },
      checklist: savedChecklist.map((item) => ({
        id: item.id,
        serviceTypeId: item.service_type_id,
        taskName: item.task_name,
        required: Boolean(item.required),
        requiresPhoto: Boolean(item.requires_photo),
        order: Number(item.order_index || 1),
        notes: item.notes || "",
      })),
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao salvar tipo de serviço" }, { status: 500 })
  }
}
