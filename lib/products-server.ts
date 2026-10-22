import type { createAdminClient } from "@/lib/supabase/server"
import { isProductStructureMissing, PRODUCT_MIGRATION_HINT, productPayload, validateProduct, type ProductErrors, type ProductForm } from "@/lib/products"

type Admin = ReturnType<typeof createAdminClient>
export class ProductError extends Error {
  constructor(message: string, public status = 400, public fields?: ProductErrors) {
    super(message)
  }
}

/** Erros do banco (as regras dos gatilhos já vêm em português) viram mensagens da tela. */
export function productError(error: unknown, fallback = "Erro ao processar o produto.") {
  if (error instanceof ProductError) return error
  const message = error instanceof Error ? error.message : (error as { message?: string })?.message || fallback
  if (isProductStructureMissing(message)) return new ProductError(PRODUCT_MIGRATION_HINT, 503)
  if (/materials_sku_uidx|já existe no catálogo|já pertence a outro item/i.test(message)) return new ProductError("Este SKU já existe no catálogo.", 409, { sku: "Este SKU já existe no catálogo." })
  if (/não encontrad/i.test(message)) return new ProductError("Produto não encontrado.", 404)
  return new ProductError(message || fallback, 400)
}

async function rpc<T = unknown>(admin: Admin, name: string, args: Record<string, unknown>) {
  const { data, error } = await admin.rpc(name, args)
  if (error) throw error
  return data as T
}

export type ProductListFilters = { q?: string; status?: string; category?: string; order?: string; desc?: boolean; page?: number; pageSize?: number }
const orders = new Set(["name", "sku", "price", "cost", "margin", "stock", "updated"])

export async function listProducts(admin: Admin, filters: ProductListFilters) {
  const pageSize = Math.min(Math.max(Number(filters.pageSize) || 25, 1), 100)
  const page = Math.max(Number(filters.page) || 1, 1)
  const rows = await rpc<Array<Record<string, any>>>(admin, "product_list", {
    p_search: filters.q || null, p_status: filters.status || null, p_category: filters.category || null,
    p_order: orders.has(filters.order || "") ? filters.order : "name", p_desc: Boolean(filters.desc), p_limit: pageSize, p_offset: (page - 1) * pageSize,
  })
  return { items: rows, total: rows.length ? Number(rows[0].total_count) : 0, page, pageSize }
}

export async function productDetail(admin: Admin, id: string, versionId?: string | null) {
  const detail = await rpc<Record<string, any>>(admin, "product_detail", { p_product_id: id, p_bom_version_id: versionId || null })
  // grava a estimativa de custo da versão exibida quando o custo mudou desde a última (histórico de estimativas)
  if (detail.shown_version_id) await rpc(admin, "product_record_cost_snapshot", { p_bom_version_id: detail.shown_version_id }).catch(() => null)
  return detail
}

export const kitOptions = (admin: Admin, q: string) => rpc<Array<Record<string, any>>>(admin, "product_kit_options", { p_search: q || null, p_limit: 20 })
export const compareVersions = (admin: Admin, a: string, b: string) => rpc<Array<Record<string, any>>>(admin, "product_compare_versions", { p_version_a: a, p_version_b: b })
export const explosion = (admin: Admin, versionId: string, quantity: number) => rpc<Record<string, any>>(admin, "product_explosion", { p_bom_version_id: versionId, p_quantity: quantity })
export const capacity = (admin: Admin, productId: string, versionId?: string | null) => rpc<Record<string, any>>(admin, "product_capacity_detail", { p_product_id: productId, p_bom_version_id: versionId || null })
export const activateVersion = (admin: Admin, versionId: string, user?: string) => rpc(admin, "product_activate_version", { p_version_id: versionId, p_user: user || null })

/** Cria/atualiza o produto (cadastro, documentos e estrutura) numa única transação (função product_save). A mesma validação da tela roda antes. */
export async function saveProduct(admin: Admin, input: { productId?: string; form: ProductForm; withStructure?: boolean; user?: string }) {
  const errors = validateProduct(input.form, { requireStructure: Boolean(input.withStructure) })
  if (Object.keys(errors).length) throw new ProductError("Corrija os campos destacados.", 422, errors)
  return rpc<Record<string, any>>(admin, "product_save", { p: productPayload(input.form, { productId: input.productId, withStructure: input.withStructure, user: input.user }) })
}
