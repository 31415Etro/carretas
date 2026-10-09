import { NextResponse } from "next/server"
import { currentUserRole } from "@/lib/server-authorization"
import { createAdminClient } from "@/lib/supabase/server"
import { readAllPages } from "@/lib/supabase-pagination"
import { materialErpColumns, materialErpFields } from "@/lib/material-fields"
import { stockContext, stockError } from "@/lib/stock-api"
import { applyStockMovement } from "@/lib/stock-engine"

function normalizeMaterial(input: any) {
  return {
    id: input.id,
    name: input.name,
    category: input.category || "",
    unit: input.unit || "unidade",
    internal_code: input.internalCode || input.internal_code || "",
    minimum_stock: Number(input.minimumStock ?? input.minimum_stock ?? 0),
    composes_kit: Boolean(input.composesKit ?? input.composes_kit ?? false),
    status: input.status || "Ativo",
    notes: input.notes || "",
    ...materialErpColumns(input),
  }
}

function toMaterial(row: any) {
  return {
    id: row.id,
    name: row.name,
    category: row.category || "",
    unit: row.unit || "unidade",
    internalCode: row.internal_code || "",
    minimumStock: Number(row.minimum_stock || 0),
    currentStock: Number(row.current_stock || 0),
    composesKit: Boolean(row.composes_kit),
    status: row.status || "Ativo",
    notes: row.notes || "",
    ...materialErpFields(row),
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  }
}

async function upsertMaterial(supabase: ReturnType<typeof createAdminClient>, row: any) {
  let current = row
  let error: any = null
  for (let attempt = 0; attempt < 10; attempt++) {
    const result = await supabase.from("materials").upsert(current, { onConflict: "id" }).select("*").single()
    error = result.error
    if (!error) return result.data
    const missingColumn = error.message.match(/Could not find the '([^']+)' column/)?.[1]
    if (!missingColumn) break
    const { [missingColumn]: _ignored, ...rest } = current
    current = rest
  }
  throw new Error(`materials: ${error?.message || "erro ao salvar material"}`)
}

export async function GET(request: Request) {
  try {
    const { user, role } = await currentUserRole()
    if (!user) return NextResponse.json({ error: "Nao autenticado." }, { status: 401 })
    if (role === "client") return NextResponse.json({ error: "Acesso restrito ao estoque." }, { status: 403 })
    const supabase = createAdminClient()
    const url = new URL(request.url)
    const kitOptions = url.searchParams.get("kitOptions") === "1"
    if (kitOptions) {
      const rows = await readAllPages<any>((from, to) => supabase
        .from("materials")
        .select("*")
        .eq("composes_kit", true)
        .order("name")
        .order("id")
        .range(from, to))
      return NextResponse.json({ materials: rows.map(toMaterial), count: rows.length })
    }

    const hasPage = url.searchParams.has("limit")
    if (!hasPage) {
      const rows = await readAllPages<any>((from, to) => supabase.from("materials").select("*").order("name").order("id").range(from, to))
      return NextResponse.json({ materials: rows.map(toMaterial), count: rows.length })
    }
    const offset = Math.max(0, Number.parseInt(url.searchParams.get("offset") || "0", 10) || 0)
    const limit = Math.min(100, Math.max(10, Number.parseInt(url.searchParams.get("limit") || "40", 10) || 40))
    const { data, count, error } = await supabase
      .from("materials")
      .select("*", { count: "exact" })
      .order("name")
      .order("id")
      .range(offset, offset + limit - 1)
    if (error) throw new Error(`materials: ${error.message}`)
    return NextResponse.json({ materials: (data || []).map(toMaterial), count: count || 0, offset, limit })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao carregar materiais" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const { material } = await request.json()
    if (!material?.id || !material?.name || !material?.unit) {
      return NextResponse.json({ error: "Material, id e unidade são obrigatórios." }, { status: 400 })
    }
    const supabase = context.admin
    const { data: existing, error: lookupError } = await supabase.from("materials").select("id").eq("id", material.id).maybeSingle()
    if (lookupError) throw new Error(`materials: ${lookupError.message}`)
    // O saldo nunca é gravado pelo cadastro: só muda por movimentação de estoque.
    let saved = await upsertMaterial(supabase, normalizeMaterial(material))
    const initialStock = Number(material.currentStock || 0)
    if (!existing && initialStock > 0) {
      await applyStockMovement(supabase, {
        materialId: saved.id,
        movementType: "Saldo inicial",
        quantity: initialStock,
        toWarehouseId: material.warehouseId || "",
        unitCost: Number(material.costPrice || 0),
        responsible: context.responsible,
        reason: "Saldo informado no cadastro do item",
      })
      const { data: refreshed } = await supabase.from("materials").select("*").eq("id", saved.id).single()
      if (refreshed) saved = refreshed
    }
    return NextResponse.json({ material: toMaterial(saved) })
  } catch (error) {
    return stockError(error, "Erro ao salvar material")
  }
}
