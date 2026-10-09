import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { isCurrentUserAdmin } from "@/lib/server-authorization"

export const dynamic = "force-dynamic"

const BUCKET = "budget-plans"
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isUuid(value: string) {
  return uuidPattern.test(value)
}

function safeName(name: string) {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "planta.pdf"
}

async function ensureBucket(supabase: ReturnType<typeof createAdminClient>) {
  const { data } = await supabase.storage.getBucket(BUCKET)
  if (data) return
  const { error } = await supabase.storage.createBucket(BUCKET, { public: true, fileSizeLimit: 50 * 1024 * 1024, allowedMimeTypes: ["application/pdf"] })
  if (error && !String(error.message || "").toLowerCase().includes("already exists")) throw error
}

async function validatePlanScope(supabase: ReturnType<typeof createAdminClient>, workId: string, towerId: string) {
  if (!isUuid(workId)) return "Orcamento invalido para anexar a planta."
  if (towerId && !isUuid(towerId)) return "Torre invalida."
  const { data: work, error: workError } = await supabase.from("budget_works").select("id").eq("id", workId).maybeSingle()
  if (workError) throw workError
  if (!work) return "O orcamento selecionado nao existe mais."
  if (towerId) {
    const { data: tower, error: towerError } = await supabase.from("budget_towers").select("budget_work_id").eq("id", towerId).maybeSingle()
    if (towerError) throw towerError
    if (!tower || tower.budget_work_id !== workId) return "A torre selecionada nao pertence a este orcamento."
  }
  return ""
}

function planResponse(data: any) {
  return { id: data.id, workId: data.budget_work_id, towerId: data.budget_tower_id || "", name: data.name, fileUrl: data.file_url, fileName: data.file_name, storagePath: data.storage_path, pageCount: Number(data.page_count || 1), createdAt: data.created_at }
}

async function insertPlan(supabase: ReturnType<typeof createAdminClient>, row: Record<string, unknown>) {
  const { data, error } = await supabase.from("budget_plans").insert(row).select("*").single()
  if (error) {
    await supabase.storage.from(BUCKET).remove([String(row.storage_path || "")])
    if (/budget_plans|schema cache|relation/i.test(error.message)) return { error: "Execute o SQL scripts/126_add_budget_plans.sql no Supabase antes de anexar plantas.", status: 409 }
    throw error
  }
  return { plan: planResponse(data) }
}

export async function POST(request: Request) {
  try {
    if (request.headers.get("content-type")?.includes("application/json")) {
      const input = await request.json()
      const action = String(input.action || "")
      const workId = String(input.workId || "")
      const towerId = String(input.towerId || "")
      const fileName = safeName(String(input.fileName || "planta.pdf"))
      const fileSize = Number(input.fileSize || 0)
      const supabase = createAdminClient()
      const scopeError = await validatePlanScope(supabase, workId, towerId)
      if (scopeError) return NextResponse.json({ error: scopeError }, { status: 400 })

      if (action === "prepare") {
        if (!fileName.toLowerCase().endsWith(".pdf")) return NextResponse.json({ error: "A planta deve estar em PDF." }, { status: 400 })
        if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > 50 * 1024 * 1024) return NextResponse.json({ error: "O PDF deve ter no maximo 50 MB." }, { status: 400 })
        await ensureBucket(supabase)
        const id = crypto.randomUUID()
        const storagePath = `${workId}/${id}-${fileName}`
        const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(storagePath)
        if (error || !data?.token) throw error || new Error("Nao foi possivel autorizar o envio da planta.")
        return NextResponse.json({ upload: { id, storagePath, fileName, token: data.token } })
      }

      if (action === "finalize") {
        const id = String(input.id || "")
        const storagePath = String(input.storagePath || "")
        const expectedPath = `${workId}/${id}-${fileName}`
        if (!isUuid(id) || storagePath !== expectedPath) return NextResponse.json({ error: "Dados do upload da planta sao invalidos." }, { status: 400 })
        const { data: files, error: listError } = await supabase.storage.from(BUCKET).list(workId, { search: `${id}-${fileName}`, limit: 10 })
        if (listError) throw listError
        if (!(files || []).some((file) => file.name === `${id}-${fileName}`)) return NextResponse.json({ error: "O PDF nao foi encontrado no Storage. Tente anexar novamente." }, { status: 409 })
        const { data: publicUrl } = supabase.storage.from(BUCKET).getPublicUrl(storagePath)
        const saved = await insertPlan(supabase, { id, budget_work_id: workId, budget_tower_id: towerId || null, name: String(input.name || "").trim() || fileName.replace(/\.pdf$/i, ""), file_url: publicUrl.publicUrl, file_name: fileName, storage_path: storagePath, page_count: Math.max(1, Number(input.pageCount || 1)) })
        if ("error" in saved) return NextResponse.json({ error: saved.error }, { status: saved.status })
        return NextResponse.json(saved)
      }

      return NextResponse.json({ error: "Acao de upload invalida." }, { status: 400 })
    }

    const formData = await request.formData()
    const file = formData.get("file")
    const workId = String(formData.get("workId") || "")
    const towerId = String(formData.get("towerId") || "")
    const name = String(formData.get("name") || "")
    const pageCount = Math.max(1, Number(formData.get("pageCount") || 1))
    if (!(file instanceof File)) return NextResponse.json({ error: "Selecione o PDF da planta." }, { status: 400 })
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return NextResponse.json({ error: "A planta deve estar em PDF." }, { status: 400 })
    const supabase = createAdminClient()
    const scopeError = await validatePlanScope(supabase, workId, towerId)
    if (scopeError) return NextResponse.json({ error: scopeError }, { status: 400 })
    await ensureBucket(supabase)
    const id = crypto.randomUUID()
    const fileName = safeName(file.name)
    const storagePath = `${workId}/${id}-${fileName}`
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, Buffer.from(await file.arrayBuffer()), { contentType: "application/pdf", upsert: false })
    if (uploadError) throw uploadError
    const { data: publicUrl } = supabase.storage.from(BUCKET).getPublicUrl(storagePath)
    const row = { id, budget_work_id: workId, budget_tower_id: towerId || null, name: name.trim() || file.name.replace(/\.pdf$/i, ""), file_url: publicUrl.publicUrl, file_name: fileName, storage_path: storagePath, page_count: pageCount }
    const saved = await insertPlan(supabase, row)
    if ("error" in saved) return NextResponse.json({ error: saved.error }, { status: saved.status })
    return NextResponse.json(saved)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao anexar planta." }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const input = await request.json()
    const planId = String(input.planId || "")
    const pointId = String(input.pointId || "")
    if (!isUuid(planId) || !isUuid(pointId)) return NextResponse.json({ error: "Planta ou ponto invalido." }, { status: 400 })
    const supabase = createAdminClient()
    const [{ data: plan, error: planError }, { data: point, error: pointError }] = await Promise.all([
      supabase.from("budget_plans").select("budget_work_id,budget_tower_id,page_count").eq("id", planId).maybeSingle(),
      supabase.from("budget_points").select("budget_environment_id").eq("id", pointId).maybeSingle(),
    ])
    if (planError) throw planError
    if (pointError) throw pointError
    if (!plan || !point) return NextResponse.json({ error: "Planta ou ponto nao encontrado." }, { status: 404 })

    const { data: environment, error: environmentError } = await supabase.from("budget_environments").select("budget_service_type_id").eq("id", point.budget_environment_id).maybeSingle()
    if (environmentError) throw environmentError
    const { data: serviceType, error: typeError } = environment
      ? await supabase.from("budget_service_types").select("budget_floor_id").eq("id", environment.budget_service_type_id).maybeSingle()
      : { data: null, error: null }
    if (typeError) throw typeError
    const { data: floor, error: floorError } = serviceType
      ? await supabase.from("budget_floors").select("budget_tower_id").eq("id", serviceType.budget_floor_id).maybeSingle()
      : { data: null, error: null }
    if (floorError) throw floorError
    const { data: tower, error: towerError } = floor
      ? await supabase.from("budget_towers").select("budget_work_id").eq("id", floor.budget_tower_id).maybeSingle()
      : { data: null, error: null }
    if (towerError) throw towerError
    if (!tower || tower.budget_work_id !== plan.budget_work_id || (plan.budget_tower_id && floor?.budget_tower_id !== plan.budget_tower_id)) {
      return NextResponse.json({ error: "O ponto selecionado nao pertence ao orcamento e a torre desta planta." }, { status: 400 })
    }

    const pageNumber = Math.max(1, Number(input.pageNumber || 1))
    if (pageNumber > Number(plan.page_count || 1)) return NextResponse.json({ error: "A pagina selecionada nao existe nesta planta." }, { status: 400 })
    const row = { id: isUuid(String(input.id || "")) ? input.id : crypto.randomUUID(), budget_plan_id: planId, budget_point_id: pointId, page_number: Math.max(1, Number(input.pageNumber || 1)), x: Math.min(1, Math.max(0, Number(input.x || 0))), y: Math.min(1, Math.max(0, Number(input.y || 0))) }
    const { data, error } = await supabase.from("budget_plan_points").upsert(row, { onConflict: "budget_plan_id,budget_point_id" }).select("*").single()
    if (error) {
      if (/budget_plan_points|schema cache|relation/i.test(error.message)) return NextResponse.json({ error: "Execute o SQL scripts/126_add_budget_plans.sql no Supabase antes de marcar pontos." }, { status: 409 })
      throw error
    }
    return NextResponse.json({ placement: { id: data.id, planId: data.budget_plan_id, pointId: data.budget_point_id, pageNumber: Number(data.page_number), x: Number(data.x), y: Number(data.y) } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao salvar posicao do ponto." }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    if (!(await isCurrentUserAdmin())) return NextResponse.json({ error: "Somente administradores podem excluir registros." }, { status: 403 })
    const url = new URL(request.url)
    const placementId = url.searchParams.get("placementId") || ""
    const planId = url.searchParams.get("planId") || ""
    const supabase = createAdminClient()
    if (isUuid(placementId)) {
      const { error } = await supabase.from("budget_plan_points").delete().eq("id", placementId)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }
    if (isUuid(planId)) {
      const { data: plan, error: lookupError } = await supabase.from("budget_plans").select("storage_path").eq("id", planId).maybeSingle()
      if (lookupError) throw lookupError
      if (!plan) return NextResponse.json({ error: "Planta nao encontrada ou ja excluida." }, { status: 404 })
      const { error } = await supabase.from("budget_plans").delete().eq("id", planId)
      if (error) throw error
      const storageResult = plan.storage_path ? await supabase.storage.from(BUCKET).remove([plan.storage_path]) : { error: null }
      return NextResponse.json({ ok: true, storageRemoved: !storageResult.error })
    }
    return NextResponse.json({ error: "Registro invalido para exclusao." }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao excluir marcacao." }, { status: 500 })
  }
}
