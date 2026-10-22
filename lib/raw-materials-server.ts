import type { createAdminClient } from "@/lib/supabase/server"
import { formFromMaterial, isRawMaterialStructureMissing, materialRowFromPayload, rawMaterialPayload, RAW_MATERIAL_MIGRATION_HINT, validateRawMaterial, type FieldErrors, type RawMaterialForm } from "@/lib/raw-materials"

type Admin = ReturnType<typeof createAdminClient>
export class RawMaterialError extends Error {
  constructor(message: string, public status = 400, public fields?: FieldErrors) {
    super(message)
  }
}

/** Erros do banco (regras dos gatilhos já vêm em português) viram mensagens da tela. */
export function rawMaterialError(error: unknown, fallback = "Erro ao processar a matéria-prima.") {
  if (error instanceof RawMaterialError) return error
  const message = error instanceof Error ? error.message : (error as { message?: string })?.message || fallback
  if (isRawMaterialStructureMissing(message)) return new RawMaterialError(RAW_MATERIAL_MIGRATION_HINT, 503)
  if (/materials_sku_uidx|duplicate key.*internal_code/i.test(message)) return new RawMaterialError("Este SKU já existe no catálogo.", 409, { sku: "Este SKU já existe no catálogo." })
  return new RawMaterialError(message || fallback, 400)
}

async function rpc<T = unknown>(admin: Admin, name: string, args: Record<string, unknown>) {
  const { data, error } = await admin.rpc(name, args)
  if (error) throw error
  return data as T
}

export async function listRawMaterials(admin: Admin, filters: { q?: string; status?: string; belowMinimum?: boolean }) {
  return rpc<Array<Record<string, any>>>(admin, "raw_material_list", { p_search: filters.q || null, p_status: filters.status || null, p_only_below_min: Boolean(filters.belowMinimum) })
}

export async function rawMaterialDetail(admin: Admin, id: string) {
  const detail = await rpc<Record<string, any>>(admin, "raw_material_detail", { p_material_id: id })
  const hasHistory = await rpc<boolean>(admin, "item_has_history", { p_material_id: id })
  return { detail, hasHistory, form: formFromMaterial(detail.material, detail.suppliers) }
}

/** Cria ou atualiza a matéria-prima. A validação é a MESMA da tela; o banco ainda garante as regras (SKU único, venda, NCM). */
export async function saveRawMaterial(admin: Admin, input: { id?: string; form: RawMaterialForm; responsible: string }) {
  const { form, responsible } = input
  const editing = Boolean(input.id)
  let originalSku = ""
  let originalNcm = ""
  let hasHistory = false
  if (editing) {
    const { data, error } = await admin.from("materials").select("id,internal_code,ncm,item_type").eq("id", input.id!).maybeSingle()
    if (error) throw error
    if (!data || data.item_type !== "Materia-prima") throw new RawMaterialError("Matéria-prima não encontrada.", 404)
    originalSku = String(data.internal_code || "")
    originalNcm = String(data.ncm || "")
    hasHistory = await rpc<boolean>(admin, "item_has_history", { p_material_id: input.id })
  }
  const errors = validateRawMaterial(form, { editing, hasHistory, originalSku })
  // em edição, o NCM só precisa de nova confirmação se mudou
  if (editing && errors.ncm && originalNcm.replace(/\D/g, "") === form.ncm.replace(/\D/g, "")) delete errors.ncm
  if (editing && form.ncm.trim() && form.ncm.replace(/\D/g, "") !== originalNcm.replace(/\D/g, "") && !form.ncmConfirmed) errors.ncm = "Confirme o novo NCM antes de salvar."
  if (Object.keys(errors).length) throw new RawMaterialError("Corrija os campos destacados.", 422, errors)

  const body = rawMaterialPayload(form)
  const row: Record<string, unknown> = materialRowFromPayload(body)
  const ncmChanged = body.ncm !== originalNcm.replace(/\D/g, "")
  if (body.ncm && form.ncmConfirmed && (!editing || ncmChanged)) {
    Object.assign(row, { ncm_description: body.ncmDescription || null, ncm_source: body.ncmSource || "Informado manualmente", ncm_valid_from: body.ncmValidFrom || null, ncm_confirmed_by: responsible, ncm_confirmed_at: new Date().toISOString() })
  }
  if (!body.ncm) Object.assign(row, { ncm_description: null, ncm_source: null, ncm_valid_from: null, ncm_confirmed_by: null, ncm_confirmed_at: null })

  if (!editing) {
    row.internal_code = body.autoSku ? await rpc<string>(admin, "next_item_sku", { p_item_type: "Materia-prima" }) : body.sku
    const { data, error } = await admin.from("materials").insert(row).select("id,internal_code").single()
    if (error) throw error
    try {
      await rpc(admin, "raw_material_set_suppliers", { p_material_id: data.id, p_suppliers: body.suppliers })
    } catch (error) {
      await admin.from("materials").delete().eq("id", data.id) // não deixa um cadastro pela metade (acabou de ser criado, sem nenhum vínculo)
      throw error
    }
    return { id: String(data.id), sku: String(data.internal_code) }
  }

  const skuChanged = form.sku.trim() !== originalSku
  if (skuChanged && hasHistory) await rpc(admin, "change_item_sku", { p_material_id: input.id, p_new_sku: form.sku.trim(), p_reason: form.skuChangeReason.trim(), p_user: responsible })
  else if (skuChanged) row.internal_code = form.sku.trim()
  const { error } = await admin.from("materials").update(row).eq("id", input.id!)
  if (error) throw error
  await rpc(admin, "raw_material_set_suppliers", { p_material_id: input.id, p_suppliers: body.suppliers })
  return { id: input.id!, sku: form.sku.trim() || originalSku }
}
