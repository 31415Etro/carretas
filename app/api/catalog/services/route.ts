import { NextResponse } from "next/server"
import { validateService, type CatalogService } from "@/lib/service-catalog"
import { stockContext } from "@/lib/stock-api"

const missing = (message = "") => /does not exist|Could not find|schema cache/i.test(message)
const MIGRATION_HINT = "Campos de serviço ainda não instalados: rode scripts/205_catalogo_produtos_servicos.sql no Supabase."

function toService(row: any, materials: any[], tasks: any[]): CatalogService & { checklistCount: number } {
  const retentions = row.retentions || {}
  return {
    id: row.id, code: row.code || "", name: row.name, description: row.description || "", category: row.category || "",
    billingUnit: row.billing_unit || "Servico", defaultPrice: Number(row.default_price || 0), estimatedCost: Number(row.estimated_cost || 0),
    estimatedMinutes: Number(row.estimated_minutes || 0), nfseNationalCode: row.nfse_national_code || "", lc116Item: row.lc116_item || "",
    municipalTaxCode: row.municipal_tax_code || "", nbsCode: row.nbs_code || "", issRate: Number(row.iss_rate || 0), issRetained: Boolean(row.iss_retained),
    retentions: { ir: Number(retentions.ir || 0), pis: Number(retentions.pis || 0), cofins: Number(retentions.cofins || 0), csll: Number(retentions.csll || 0), inss: Number(retentions.inss || 0) },
    responsibleProviderId: row.responsible_provider_id || "", warrantyDays: Number(row.warranty_days || 0), status: row.status || "Ativo",
    materials: materials.filter((item) => item.service_type_id === row.id && item.material_id).map((item) => ({ materialId: item.material_id, quantity: Number(item.quantity || 0), unit: item.unit || "UN" })),
    tasks: tasks.filter((item) => item.service_type_id === row.id).sort((a, b) => Number(a.order_index || 0) - Number(b.order_index || 0)).map((item) => item.task_name),
    checklistCount: tasks.filter((item) => item.service_type_id === row.id).length,
  }
}

export async function GET() {
  const context = await stockContext()
  if ("error" in context) return context.error
  const [services, materials, tasks, providers] = await Promise.all([
    context.admin.from("service_types").select("*").order("name"),
    context.admin.from("service_type_materials").select("*"),
    context.admin.from("service_type_checklist_items").select("id,service_type_id,task_name,order_index"),
    context.admin.from("providers").select("id,full_name").order("full_name"),
  ])
  if (services.error) return NextResponse.json({ error: services.error.message }, { status: 400 })
  return NextResponse.json({
    services: (services.data || []).map((row) => toService(row, materials.data || [], tasks.data || [])),
    providers: (providers.data || []).map((row) => ({ id: row.id, name: row.full_name })),
  })
}

/** Cria/atualiza o serviço, os materiais necessários e as tarefas do checklist padrão. */
export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const { service } = await request.json() as { service: CatalogService }
    const admin = context.admin
    const { data: others } = await admin.from("service_types").select("id,code")
    const invalid = validateService(service, (others || []).filter((row) => row.id !== service.id && row.code).map((row) => row.code))
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 })
    const row = {
      ...(service.id ? { id: service.id } : {}),
      code: service.code.trim(), name: service.name.trim(), description: service.description.trim(), category: service.category.trim(),
      billing_unit: service.billingUnit, default_price: Number(service.defaultPrice), estimated_cost: Number(service.estimatedCost || 0),
      estimated_minutes: Math.round(Number(service.estimatedMinutes || 0)), nfse_national_code: service.nfseNationalCode.replace(/\D/g, ""),
      lc116_item: service.lc116Item.trim(), municipal_tax_code: service.municipalTaxCode.trim(), nbs_code: service.nbsCode.replace(/\D/g, ""),
      iss_rate: Number(service.issRate || 0), iss_retained: Boolean(service.issRetained), retentions: service.retentions,
      responsible_provider_id: service.responsibleProviderId || null, warranty_days: Math.round(Number(service.warrantyDays || 0)), status: service.status,
    }
    const { data: saved, error } = await admin.from("service_types").upsert(row, { onConflict: "id" }).select("id").single()
    if (error) throw new Error(/duplicate key.*name/i.test(error.message) ? "Já existe um serviço com esse nome." : error.message)

    // Materiais: reaproveita a linha do mesmo material e remove as que saíram.
    const { data: currentMaterials } = await admin.from("service_type_materials").select("id,material_id").eq("service_type_id", saved.id)
    const keepMaterials = service.materials.map((item) => ({
      ...(currentMaterials?.find((current) => current.material_id === item.materialId) ? { id: currentMaterials!.find((current) => current.material_id === item.materialId)!.id } : {}),
      service_type_id: saved.id, material_id: item.materialId, quantity: Number(item.quantity), unit: item.unit || "UN", required: true,
    }))
    const removedMaterials = (currentMaterials || []).filter((current) => !service.materials.some((item) => item.materialId === current.material_id)).map((current) => current.id)
    if (removedMaterials.length) await admin.from("service_type_materials").delete().in("id", removedMaterials)
    if (keepMaterials.length) {
      const { error: materialsError } = await admin.from("service_type_materials").upsert(keepMaterials, { defaultToNull: false })
      if (materialsError) throw new Error(materialsError.message)
    }

    // Checklist padrão: atualiza por posição para manter os ids já usados pelas OS.
    const { data: currentTasks } = await admin.from("service_type_checklist_items").select("id,order_index").eq("service_type_id", saved.id).order("order_index")
    const tasks = service.tasks.map((task) => task.trim()).filter(Boolean)
    const taskRows = tasks.map((task, index) => ({ ...(currentTasks?.[index] ? { id: currentTasks[index].id } : {}), service_type_id: saved.id, task_name: task, order_index: index + 1, required: true, requires_photo: false }))
    const extraTasks = (currentTasks || []).slice(tasks.length).map((task) => task.id)
    if (extraTasks.length) await admin.from("service_type_checklist_items").delete().in("id", extraTasks)
    if (taskRows.length) {
      const { error: tasksError } = await admin.from("service_type_checklist_items").upsert(taskRows, { defaultToNull: false })
      if (tasksError) throw new Error(tasksError.message)
    }
    return NextResponse.json({ id: saved.id })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao salvar serviço."
    return NextResponse.json({ error: missing(message) ? MIGRATION_HINT : message }, { status: missing(message) ? 503 : 400 })
  }
}
