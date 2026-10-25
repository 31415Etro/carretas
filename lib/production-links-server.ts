import type { createAdminClient } from "@/lib/supabase/server"
import { structureProblems, type StructureFacts } from "@/lib/production-links"

type Admin = ReturnType<typeof createAdminClient>

/** Lê, no banco, a estrutura ativa, os kits e as versões de kit dos produtos informados. */
export async function structureFacts(admin: Admin, productIds: string[]): Promise<StructureFacts> {
  const facts: StructureFacts = { activeBom: {}, kitsOfBom: {}, kitReady: {} }
  const ids = [...new Set(productIds.filter(Boolean))]
  for (const id of ids) facts.activeBom[id] = null
  if (!ids.length) return facts
  const boms = await admin.from("product_bom_versions").select("id,product_id").in("product_id", ids).eq("status", "Ativa")
  if (boms.error) throw boms.error
  for (const row of boms.data || []) facts.activeBom[row.product_id as string] = row.id as string
  const bomIds = (boms.data || []).map((row) => row.id as string)
  if (!bomIds.length) return facts
  const links = await admin.from("product_kits").select("bom_version_id,kit_id,kit_version_id").in("bom_version_id", bomIds)
  if (links.error) throw links.error
  const kitIds = [...new Set((links.data || []).map((row) => row.kit_id as string))]
  const names = new Map<string, string>()
  if (kitIds.length) for (const row of (await admin.from("materials").select("id,name").in("id", kitIds)).data || []) names.set(row.id as string, row.name as string)
  for (const row of links.data || []) facts.kitsOfBom[row.bom_version_id as string] = [...(facts.kitsOfBom[row.bom_version_id as string] || []), { kitId: row.kit_id as string, kitName: names.get(row.kit_id as string) || "?" }]
  if (kitIds.length) {
    const versions = await admin.from("kit_versions").select("id,kit_id").in("kit_id", kitIds).eq("status", "Ativa")
    const versionIds = (versions.data || []).map((row) => row.id as string)
    const comps = versionIds.length ? await admin.from("kit_components").select("kit_version_id").in("kit_version_id", versionIds) : { data: [] as Array<{ kit_version_id: string }> }
    const withComponents = new Set((comps.data || []).map((row) => row.kit_version_id as string))
    // kit amarrado a uma versão específica (kit_version_id) usa essa; senão a ativa
    const pinned = new Map<string, string>()
    for (const row of links.data || []) if (row.kit_version_id) pinned.set(row.kit_id as string, row.kit_version_id as string)
    const activeOf = new Map((versions.data || []).map((row) => [row.kit_id as string, row.id as string]))
    for (const kitId of kitIds) {
      const version = pinned.get(kitId) || activeOf.get(kitId)
      facts.kitReady[kitId] = Boolean(version && (withComponents.has(version) || (pinned.has(kitId) && (await admin.from("kit_components").select("id", { count: "exact", head: true }).eq("kit_version_id", version)).count)))
    }
  }
  return facts
}

/** Produtos de um orçamento que não podem virar produção (sem estrutura ativa, sem kits ou com kit sem versão/matérias-primas). */
export async function quoteStructureProblems(admin: Admin, quoteId: string) {
  const items = await admin.from("quote_items").select("material_id,description,line_type").eq("quote_id", quoteId).eq("line_type", "Produto")
  if (items.error) throw items.error
  const products = (items.data || []).filter((row) => row.material_id).map((row) => ({ productId: row.material_id as string, name: String(row.description || "Produto") }))
  const names = new Map<string, string>()
  const ids = [...new Set(products.map((item) => item.productId))]
  if (ids.length) for (const row of (await admin.from("materials").select("id,name").in("id", ids)).data || []) names.set(row.id as string, row.name as string)
  return structureProblems(products.map((item) => ({ productId: item.productId, name: names.get(item.productId) || item.name })), await structureFacts(admin, ids))
}
