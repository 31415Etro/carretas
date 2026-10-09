import { NextResponse } from "next/server"
import { currentUserRole } from "@/lib/server-authorization"
import { createAdminClient } from "@/lib/supabase/server"
import { readAllPages } from "@/lib/supabase-pagination"

function kitRow(input: any) {
  return {
    id: input.id,
    name: input.name,
    description: input.description || "",
    unit_value: Number(input.unitValue ?? input.unit_value ?? 0),
    stock_quantity: Math.max(0, Math.floor(Number(input.quantityInStock ?? input.stock_quantity ?? 0))),
    status: input.status || "Ativo",
    notes: input.notes || "",
  }
}

function itemRow(input: any) {
  return {
    id: input.id,
    kit_id: input.kitId || input.kit_id,
    material_id: input.materialId || input.material_id,
    quantity: Number(input.quantity || 0),
    unit: input.unit || "unidade",
  }
}

function materialRow(input: any) {
  return {
    id: input.id,
    name: input.name,
    category: input.category || "",
    unit: input.unit || "unidade",
    internal_code: input.internalCode || "",
    minimum_stock: Number(input.minimumStock || 0),
    current_stock: Number(input.currentStock || 0),
    composes_kit: Boolean(input.composesKit),
    status: input.status || "Ativo",
    notes: input.notes || "",
  }
}

async function upsertRows(supabase: ReturnType<typeof createAdminClient>, table: string, rows: any[]) {
  const cleanRows = rows.filter((row) => row?.id)
  if (!cleanRows.length) return []
  let currentRows = cleanRows
  let error: any = null
  for (let attempt = 0; attempt < 10; attempt++) {
    const result = await supabase.from(table).upsert(currentRows, { onConflict: "id" }).select("*")
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

export async function GET(request: Request) {
  try {
    const { user, role } = await currentUserRole()
    if (!user) return NextResponse.json({ error: "Nao autenticado." }, { status: 401 })
    if (role === "client") return NextResponse.json({ error: "Acesso restrito ao estoque." }, { status: 403 })
    const supabase = createAdminClient()
    const url = new URL(request.url)
    const hasPage = url.searchParams.has("limit")
    const offset = Math.max(0, Number.parseInt(url.searchParams.get("offset") || "0", 10) || 0)
    const limit = Math.min(100, Math.max(10, Number.parseInt(url.searchParams.get("limit") || "40", 10) || 40))
    if (hasPage) {
      const { data: kits, count, error } = await supabase
        .from("stock_kits")
        .select("*", { count: "exact" })
        .order("name")
        .order("id")
        .range(offset, offset + limit - 1)
      if (error) throw new Error(`stock_kits: ${error.message}`)
      const kitIds = (kits || []).map((row) => row.id)
      const { data: items, error: itemsError } = kitIds.length
        ? await supabase.from("stock_kit_items").select("*").in("kit_id", kitIds).order("id")
        : { data: [], error: null }
      if (itemsError) throw new Error(`stock_kit_items: ${itemsError.message}`)
      return NextResponse.json({
        kits: (kits || []).map(toKit),
        items: (items || []).map(toKitItem),
        count: count || 0,
        offset,
        limit,
      })
    }
    const [kits, items] = await Promise.all([
      readAllPages<any>((from, to) => supabase.from("stock_kits").select("*").order("name").order("id").range(from, to)),
      readAllPages<any>((from, to) => supabase.from("stock_kit_items").select("*").order("id").range(from, to)),
    ])
    return NextResponse.json({
      kits: kits.map(toKit),
      items: items.map(toKitItem),
      count: kits.length,
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao carregar kits" }, { status: 500 })
  }
}

function toKit(row: any) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    unitValue: Number(row.unit_value || 0),
    quantityInStock: Number(row.stock_quantity || 0),
    status: row.status || "Ativo",
    notes: row.notes || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  }
}

function toKitItem(row: any) {
  return {
    id: row.id,
    kitId: row.kit_id,
    materialId: row.material_id,
    quantity: Number(row.quantity || 0),
    unit: row.unit || "unidade",
  }
}

export async function POST(request: Request) {
  try {
    const { kit, items = [], materialUpdates = [] } = await request.json()
    if (!kit?.id || !kit?.name) {
      return NextResponse.json({ error: "Nome do kit é obrigatório." }, { status: 400 })
    }
    if (!items.length) {
      return NextResponse.json({ error: "Adicione pelo menos um material ao kit." }, { status: 400 })
    }

    const supabase = createAdminClient()
    const [savedKit] = await upsertRows(supabase, "stock_kits", [kitRow(kit)])
    const { error: deleteError } = await supabase.from("stock_kit_items").delete().eq("kit_id", kit.id)
    if (deleteError) throw new Error(`stock_kit_items: ${deleteError.message}`)
    const savedItems = await upsertRows(supabase, "stock_kit_items", items.map(itemRow))
    const savedMaterials = await upsertRows(supabase, "materials", materialUpdates.map(materialRow))

    return NextResponse.json({ kit: savedKit || kitRow(kit), items: savedItems, materials: savedMaterials })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao salvar kit" }, { status: 500 })
  }
}
