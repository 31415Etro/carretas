import { NextResponse } from "next/server"
import { isMissing, OS_MIGRATION_HINT } from "@/lib/os-server"
import { stockContext } from "@/lib/stock-api"

const assetTypes = ["Carreta", "Semirreboque", "Reboque", "Caminhão", "Cavalo mecânico", "Veículo", "Equipamento"]

function toAsset(row: any) {
  return { id: row.id, clientId: row.client_id, assetType: row.asset_type, identification: row.identification, plate: row.plate || "", chassis: row.chassis || "", renavam: row.renavam || "", brand: row.brand || "", model: row.model || "", manufactureYear: row.manufacture_year || "", axles: row.axles || "", notes: row.notes || "", status: row.status }
}

/** Carretas/veículos/equipamentos dos clientes. */
export async function GET(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const clientId = new URL(request.url).searchParams.get("clientId")
  let query = context.admin.from("customer_assets").select("*")
  if (clientId) query = query.eq("client_id", clientId)
  const { data, error } = await query.order("identification")
  if (error) return NextResponse.json({ error: isMissing(error.message) ? OS_MIGRATION_HINT : error.message }, { status: isMissing(error.message) ? 503 : 400 })
  return NextResponse.json({ assets: (data || []).map(toAsset) })
}

export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const { asset } = await request.json()
  if (!asset?.clientId || !String(asset.identification || "").trim()) return NextResponse.json({ error: "Informe o cliente e a identificação." }, { status: 400 })
  if (!assetTypes.includes(asset.assetType)) return NextResponse.json({ error: "Tipo inválido." }, { status: 400 })
  const plate = String(asset.plate || "").toUpperCase().replace(/[^A-Z0-9]/g, "")
  if (plate && !/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(plate)) return NextResponse.json({ error: "Placa inválida (ex.: ABC1D23 ou ABC1234)." }, { status: 400 })
  const chassis = String(asset.chassis || "").toUpperCase().trim()
  if (chassis && !/^[A-HJ-NPR-Z0-9]{17}$/.test(chassis)) return NextResponse.json({ error: "Chassi (VIN) deve ter 17 caracteres, sem I, O ou Q." }, { status: 400 })
  const row = {
    ...(asset.id ? { id: asset.id } : {}), client_id: asset.clientId, asset_type: asset.assetType, identification: String(asset.identification).trim(), plate: plate || null, chassis: chassis || null,
    renavam: asset.renavam || null, brand: asset.brand || null, model: asset.model || null, manufacture_year: asset.manufactureYear ? Number(asset.manufactureYear) : null, axles: asset.axles ? Number(asset.axles) : null, notes: asset.notes || null, status: asset.status === "Inativo" ? "Inativo" : "Ativo",
  }
  const { data, error } = await context.admin.from("customer_assets").upsert(row, { onConflict: "id" }).select("*").single()
  if (error) {
    const duplicate = /duplicate key/.test(error.message)
    return NextResponse.json({ error: duplicate ? "Já existe carreta/veículo com essa placa ou chassi." : isMissing(error.message) ? OS_MIGRATION_HINT : error.message }, { status: 400 })
  }
  return NextResponse.json({ asset: toAsset(data) })
}
