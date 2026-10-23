import { randomUUID } from "node:crypto"
import type { createAdminClient } from "@/lib/supabase/server"

type Admin = ReturnType<typeof createAdminClient>
export const SHOP_PHOTO_BUCKET = "shop-photos"
export const SHOP_MIGRATION_HINT = "O chão de fábrica digital ainda não está instalado no banco. Rode o script 227 no SQL Editor do Supabase (primeiro no staging)."

export class ShopError extends Error {
  constructor(message: string, public status = 400) {
    super(message)
  }
}

/** Erros do banco já vêm em português; só os de estrutura ausente e de sessão ganham tratamento próprio. */
export function shopError(error: unknown, fallback = "Erro ao processar a solicitação.") {
  if (error instanceof ShopError) return error
  const message = error instanceof Error ? error.message : (error as { message?: string })?.message || fallback
  if (/Could not find the function|schema cache|shop_/i.test(message) && /function|schema cache|relation/i.test(message)) return new ShopError(SHOP_MIGRATION_HINT, 503)
  if (/Sessão expirada/i.test(message)) return new ShopError(message, 401)
  if (/não encontrad/i.test(message)) return new ShopError(message, 404)
  if (/não está autorizado|outra empresa/i.test(message)) return new ShopError(message, 403)
  return new ShopError(message || fallback, 400)
}

export async function rpc<T = unknown>(admin: Admin, name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await admin.rpc(name, args)
  if (error) throw error
  return data as T
}

/** Ações do colaborador no tablet. Cada uma exige o token da sessão individual (matrícula + PIN) e uma chave de idempotência gerada pelo tablet. */
export async function workerAction(admin: Admin, token: string, action: string, body: Record<string, any>, device: string) {
  const task = String(body.taskId || "")
  const key = String(body.requestKey || "") || null
  const clientAt = body.clientAt ? String(body.clientAt) : null
  switch (action) {
    case "start": return rpc(admin, "shop_task_start", { p_token: token, p_task: task, p_key: key, p_device: device, p_client_at: clientAt })
    case "pause": return rpc(admin, "shop_task_pause", { p_token: token, p_task: task, p_reason: body.reason, p_note: body.note || null, p_key: key, p_device: device, p_client_at: clientAt })
    case "finish": return rpc(admin, "shop_task_finish", { p_token: token, p_task: task, p: { request_key: key, quantity_done: body.quantityDone, notes: body.notes, photos: body.photos || [], occurrence: body.occurrence || null, device, client_at: clientAt } })
    case "consume": return rpc(admin, "shop_task_consume", { p_token: token, p_task: task, p_material: body.materialId, p_quantity: body.quantity, p_key: key, p_kind: body.kind || "Consumo", p_notes: body.notes || null })
    case "check": return rpc(admin, "shop_task_check", { p_token: token, p_task: task, p_item: body.itemId, p_result: body.result, p_note: body.note || null, p_photos: body.photos || [], p_key: key })
    case "measure": return rpc(admin, "shop_task_measure", { p_token: token, p_task: task, p_measures: body.measures || [], p_key: key })
    case "occurrence": return rpc(admin, "shop_occurrence_open", { p_token: token, p_task: task, p_kind: body.kind || "ocorrencia", p_description: body.description, p_photos: body.photos || [] })
    default: throw new ShopError("Ação desconhecida.")
  }
}

/** Ações do gestor (admin/gerente): cadastro, esteira, reatribuição, decisão de pendências, terceirizados e entrada do acabado. */
export async function managerAction(admin: Admin, action: string, body: Record<string, any>, actor: string) {
  switch (action) {
    case "worker_save": return rpc(admin, "shop_worker_save", { p: body.worker, p_user: actor })
    case "settings": return rpc(admin, "shop_settings_update", { p: body.settings, p_user: actor })
    case "steps_seed": return rpc(admin, "shop_steps_seed", { p_user: actor })
    case "step_save": return rpc(admin, "shop_step_save", { p: body.step })
    case "item_save": return rpc(admin, "shop_checklist_item_save", { p: body.item })
    case "step_kits": return rpc(admin, "shop_step_kits_set", { p_step: body.stepId, p_kits: body.kits || [] })
    case "generate": return rpc(admin, "shop_tasks_generate", { p_order: body.orderId, p_user: actor })
    case "reassign": return rpc(admin, "shop_task_reassign", { p_task: body.taskId, p_worker: body.workerId || null, p_reason: body.reason || null, p_actor: actor })
    case "assign_unit": return rpc(admin, "shop_order_assign", { p_order: body.orderId, p_unit: body.unit ?? null, p_worker: body.workerId, p_actor: actor })
    case "block": return rpc(admin, "shop_task_set_block", { p_task: body.taskId, p_blocked: Boolean(body.blocked), p_reason: body.reason, p_actor: actor })
    case "cancel": return rpc(admin, "shop_task_cancel", { p_task: body.taskId, p_reason: body.reason, p_actor: actor })
    case "resolve": return rpc(admin, "shop_occurrence_resolve", { p_occurrence: body.occurrenceId, p_decision: body.decision, p_note: body.note, p_actor: actor })
    case "external_send": return rpc(admin, "shop_external_send", { p_task: body.taskId, p: body.external, p_actor: actor })
    case "external_return": return rpc(admin, "shop_external_return", { p_task: body.taskId, p_cost: body.cost ?? null, p_notes: body.notes || null, p_actor: actor })
    case "receive_unit": return rpc(admin, "shop_unit_receive", { p_order: body.orderId, p_unit: body.unit, p_actor: actor })
    default: throw new ShopError("Ação desconhecida.")
  }
}

export async function managerOverview(admin: Admin) {
  const [board, workers, steps, productivity] = await Promise.all([
    rpc(admin, "shop_board"), rpc(admin, "shop_workers_list"), rpc(admin, "shop_steps_list"), rpc(admin, "shop_productivity"),
  ])
  const { data: kits } = await admin.from("materials").select("id,name,category").eq("item_type", "Kit").order("name")
  return { board, workers, steps, productivity, kits: kits || [] }
}

/** Foto do colaborador (ocorrência/não conformidade): área privada; devolve só o caminho. */
export async function uploadShopPhoto(admin: Admin, file: File) {
  if (file.size === 0 || file.size > 12 * 1024 * 1024) throw new ShopError("A fotografia está vazia ou passa de 12 MB.")
  const bytes = new Uint8Array(await file.arrayBuffer())
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8, png = bytes[0] === 0x89 && bytes[1] === 0x50, webp = String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
  if (!jpeg && !png && !webp) throw new ShopError("O arquivo não é uma imagem JPG, PNG ou WEBP.")
  const { data: bucket } = await admin.storage.getBucket(SHOP_PHOTO_BUCKET)
  if (!bucket) {
    const { error } = await admin.storage.createBucket(SHOP_PHOTO_BUCKET, { public: false, fileSizeLimit: 12 * 1024 * 1024, allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"] })
    if (error && !/already exists/i.test(error.message)) throw new ShopError(error.message)
  }
  const path = `${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${png ? "png" : webp ? "webp" : "jpg"}`
  const { error } = await admin.storage.from(SHOP_PHOTO_BUCKET).upload(path, bytes, { contentType: png ? "image/png" : webp ? "image/webp" : "image/jpeg", upsert: false })
  if (error) throw new ShopError(`A fotografia não foi enviada: ${error.message}`)
  return path
}
