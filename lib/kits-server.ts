import type { createAdminClient } from "@/lib/supabase/server"
import { isKitStructureMissing, KIT_MIGRATION_HINT, validateKit, kitPayload, type KitErrors, type KitForm } from "@/lib/kits"

type Admin = ReturnType<typeof createAdminClient>
export class KitError extends Error {
  constructor(message: string, public status = 400, public fields?: KitErrors) {
    super(message)
  }
}

/** Erros do banco (as regras dos gatilhos já vêm em português) viram mensagens da tela. */
export function kitError(error: unknown, fallback = "Erro ao processar o kit.") {
  if (error instanceof KitError) return error
  const message = error instanceof Error ? error.message : (error as { message?: string })?.message || fallback
  if (isKitStructureMissing(message)) return new KitError(KIT_MIGRATION_HINT, 503)
  if (/materials_sku_uidx|já existe no catálogo|já pertence a outro item/i.test(message)) return new KitError(message.includes("SKU") ? message : "Este SKU já existe no catálogo.", 409, { sku: "Este SKU já existe no catálogo." })
  if (/não encontrado/i.test(message)) return new KitError("Kit não encontrado.", 404)
  return new KitError(message || fallback, 400)
}

async function rpc<T = unknown>(admin: Admin, name: string, args: Record<string, unknown>) {
  const { data, error } = await admin.rpc(name, args)
  if (error) throw error
  return data as T
}

export type KitListFilters = { q?: string; status?: string; category?: string; order?: string; desc?: boolean; page?: number; pageSize?: number }
const orders = new Set(["name", "sku", "cost", "products", "updated"])

export async function listKits(admin: Admin, filters: KitListFilters) {
  const pageSize = Math.min(Math.max(Number(filters.pageSize) || 25, 1), 100)
  const page = Math.max(Number(filters.page) || 1, 1)
  const rows = await rpc<Array<Record<string, any>>>(admin, "kit_list", {
    p_search: filters.q || null, p_status: filters.status || null, p_category: filters.category || null,
    p_order: orders.has(filters.order || "") ? filters.order : "name", p_desc: Boolean(filters.desc), p_limit: pageSize, p_offset: (page - 1) * pageSize,
  })
  return { items: rows, total: rows.length ? Number(rows[0].total_count) : 0, page, pageSize }
}

export async function kitDetail(admin: Admin, id: string, versionId?: string | null) {
  const detail = await rpc<Record<string, any>>(admin, "kit_detail", { p_kit_id: id, p_version_id: versionId || null })
  // grava a estimativa de custo da versão exibida quando o custo mudou desde a última (histórico de estimativas)
  if (detail.shown_version_id) await rpc(admin, "kit_record_cost_snapshot", { p_version_id: detail.shown_version_id }).catch(() => null)
  return detail
}

export const materialOptions = (admin: Admin, q: string) => rpc<Array<Record<string, any>>>(admin, "kit_material_options", { p_search: q || null, p_limit: 20 })
export const compareVersions = (admin: Admin, a: string, b: string) => rpc<Array<Record<string, any>>>(admin, "kit_compare_versions", { p_version_a: a, p_version_b: b })

/** Cria/atualiza o kit e sua composição numa única transação (função kit_save). A mesma validação da tela roda aqui antes. */
export async function saveKit(admin: Admin, input: { kitId?: string; versionId?: string; form: KitForm; activate?: boolean; withComponents?: boolean }) {
  const errors = validateKit(input.form, { requireComponents: input.withComponents ?? true })
  if (Object.keys(errors).length) throw new KitError("Corrija os campos destacados.", 422, errors)
  return rpc<Record<string, any>>(admin, "kit_save", { p: kitPayload(input.form, { kitId: input.kitId, versionId: input.versionId, activate: input.activate, withComponents: input.withComponents }) })
}

export const activateVersion = (admin: Admin, versionId: string) => rpc(admin, "kit_activate_version", { p_version_id: versionId })
