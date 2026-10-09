import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { decodeOpenLocationCode } from "@/lib/comercial-cno"

export const dynamic = "force-dynamic"

const TABLE = "comercial_cno_records"
const MAX_LIMIT = 1000
const MISSING_COMMERCIAL_COLUMNS_MESSAGE =
  "Faltam as colunas comerciais no Supabase. Rode o SQL scripts/105_comercial_cno_saved_status.sql no SQL Editor."

function isMissingCommercialColumn(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "")
  return (
    message.includes("saved_at") ||
    message.includes("commercial_status") ||
    message.includes("sent_at") ||
    message.includes("column comercial_cno_records")
  )
}

function isMissingCommercialLeads(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "")
  return /commercial_leads|schema cache|relation/i.test(message)
}

async function syncCommercialLead(supabase: ReturnType<typeof createAdminClient>, row: any, stage: "prospeccao" | "contato") {
  const leadData = {
    cno_record_id: row.id,
    name: row.responsible_name || row.company_name || "Lead CNO",
    company: row.company_name || "",
    email: row.email || "",
    phone: row.phone || "",
    location: [row.address, row.city, row.state].filter(Boolean).join(" / "),
    source: "CNO",
    updated_at: new Date().toISOString(),
  }
  const lookup = await supabase.from("commercial_leads").select("id").eq("cno_record_id", row.id).maybeSingle()
  if (lookup.error) {
    if (isMissingCommercialLeads(lookup.error)) return
    throw lookup.error
  }
  const result = lookup.data
    ? await supabase.from("commercial_leads").update(leadData).eq("id", lookup.data.id)
    : await supabase.from("commercial_leads").insert({ ...leadData, bant_stage: stage })
  if (result.error && !isMissingCommercialLeads(result.error)) throw result.error
}

function asNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(String(value).replace(",", ".").replace(/[^\d.-]/g, ""))
  return Number.isFinite(parsed) ? parsed : null
}

function rowToDb(row: any) {
  const locationCode = row.locationCode || null
  const decoded = decodeOpenLocationCode(locationCode)
  const latitude = asNumber(row.lat) ?? decoded?.lat ?? null
  const longitude = asNumber(row.lng) ?? decoded?.lng ?? null
  return {
    cno: String(row.cno || "").trim(),
    responsible_name: row.name || null,
    company_name: row.companyName || null,
    zip_code: row.zipCode || null,
    address: row.address || null,
    district: row.district || null,
    city: row.city || null,
    state: row.state || null,
    total_area: asNumber(row.areaTotal),
    total_area_text: row.areaTotal || null,
    work_status: row.workStatus || null,
    location_code: locationCode,
    phone: row.phone || null,
    email: row.email || null,
    latitude,
    longitude,
    geocode_status: row.status || (latitude != null && longitude != null ? "Código CNO" : "Sem coordenadas"),
  }
}

function rowFromDb(row: any) {
  const decoded = row.latitude == null || row.longitude == null ? decodeOpenLocationCode(row.location_code) : null
  const latitude = row.latitude == null ? decoded?.lat ?? null : Number(row.latitude)
  const longitude = row.longitude == null ? decoded?.lng ?? null : Number(row.longitude)
  return {
    id: row.id,
    cno: row.cno,
    name: row.responsible_name || "",
    companyName: row.company_name || "",
    zipCode: row.zip_code || "",
    address: row.address || "",
    district: row.district || "",
    city: row.city || "",
    state: row.state || "",
    areaTotal: row.total_area_text || (row.total_area == null ? "" : String(row.total_area)),
    workStatus: row.work_status || "",
    locationCode: row.location_code || "",
    phone: row.phone || "",
    email: row.email || "",
    lat: latitude,
    lng: longitude,
    savedAt: row.saved_at || null,
    commercialStatus: row.commercial_status || "Novo",
    sentAt: row.sent_at || null,
    status: row.geocode_status || (latitude != null && longitude != null ? "Código CNO" : "Sem coordenadas"),
  }
}

function applyFilters(query: any, params: URLSearchParams) {
  const search = params.get("query")?.trim()
  const state = params.get("state")?.trim()
  const city = params.get("city")?.trim()
  const district = params.get("district")?.trim()
  const saved = params.get("saved") === "1"
  if (state) query = query.eq("state", state.toUpperCase())
  if (city) query = query.ilike("city", `%${city}%`)
  if (district) query = query.ilike("district", `%${district}%`)
  if (saved) query = query.not("saved_at", "is", null)
  if (search) {
    const like = `%${search}%`
    query = query.or(
      `cno.ilike.${like},responsible_name.ilike.${like},company_name.ilike.${like},address.ilike.${like},city.ilike.${like},state.ilike.${like},district.ilike.${like},work_status.ilike.${like}`,
    )
  }
  return query
}

async function stats(supabase: ReturnType<typeof createAdminClient>) {
  const total = await supabase.from(TABLE).select("id", { count: "exact", head: true })
  const withCoords = await supabase.from(TABLE).select("id", { count: "exact", head: true }).not("latitude", "is", null).not("longitude", "is", null)
  const stateRows = await supabase.from(TABLE).select("state").not("state", "is", null).limit(50000)
  if (total.error) throw new Error(total.error.message)
  if (withCoords.error) throw new Error(withCoords.error.message)
  if (stateRows.error) throw new Error(stateRows.error.message)
  const counts = new Map<string, number>()
  ;(stateRows.data || []).forEach((row) => {
    const value = row.state || "Sem UF"
    counts.set(value, (counts.get(value) || 0) + 1)
  })
  const mostCommonState = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "-"
  return {
    total: total.count || 0,
    withCoords: withCoords.count || 0,
    withoutCoords: Math.max((total.count || 0) - (withCoords.count || 0), 0),
    mostCommonState,
  }
}

export async function GET(request: Request) {
  try {
    const supabase = createAdminClient()
    const { searchParams } = new URL(request.url)
    const optionLevel = searchParams.get("optionLevel")
    if (optionLevel) {
      const column = optionLevel === "states" ? "state" : optionLevel === "cities" ? "city" : optionLevel === "districts" ? "district" : ""
      if (!column) return NextResponse.json({ error: "Nivel de filtro invalido." }, { status: 400 })

      const state = searchParams.get("state")?.trim()
      const city = searchParams.get("city")?.trim()
      const uniqueOptions = new Set<string>()
      const pageSize = 1000

      for (let offset = 0; ; offset += pageSize) {
        let optionQuery = supabase.from(TABLE).select(column).not(column, "is", null)
        if (state) optionQuery = optionQuery.eq("state", state.toUpperCase())
        if (city) optionQuery = optionQuery.eq("city", city)
        const { data, error } = await optionQuery.range(offset, offset + pageSize - 1)
        if (error) throw new Error(error.message)

        const rows = (data || []) as unknown as Array<Record<string, unknown>>
        rows.forEach((row) => {
          const value = String(row[column] || "").trim()
          if (value) uniqueOptions.add(value)
        })
        if (rows.length < pageSize) break
      }

      const options = Array.from(uniqueOptions).sort((a, b) => a.localeCompare(b, "pt-BR"))
      return NextResponse.json({ options })
    }

    const limit = Math.min(Number(searchParams.get("limit") || 120), MAX_LIMIT)
    const offset = Math.max(Number(searchParams.get("offset") || 0), 0)
    const includeMap = searchParams.get("map") === "1"

    let query = supabase.from(TABLE).select("*", { count: "exact" })
    query = applyFilters(query, searchParams)
    const { data, error, count } = await query.order("state").order("city").order("cno").range(offset, offset + limit - 1)
    if (error) throw new Error(error.message)

    let mapRows: any[] = []
    if (includeMap) {
      let mapQuery = supabase.from(TABLE).select("*")
      mapQuery = applyFilters(mapQuery, searchParams)
      const { data: mapData, error: mapError } = await mapQuery.order("state").order("city").limit(Math.min(Number(searchParams.get("mapLimit") || 900), MAX_LIMIT))
      if (mapError) throw new Error(mapError.message)
      mapRows = (mapData || []).map(rowFromDb).filter((row) => row.lat != null && row.lng != null)
    }

    return NextResponse.json({
      rows: (data || []).map(rowFromDb),
      total: count || 0,
      mapRows,
      stats: await stats(supabase),
    })
  } catch (error) {
    if (isMissingCommercialColumn(error)) {
      return NextResponse.json({ error: MISSING_COMMERCIAL_COLUMNS_MESSAGE }, { status: 500 })
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao carregar base CNO." }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()
    const inputRows: unknown[] = Array.isArray(body.rows) ? body.rows : []
    const rows = inputRows.map((row) => rowToDb(row)).filter((row) => row.cno)
    if (!rows.length) return NextResponse.json({ saved: 0 })
    const uniqueRows = Array.from(new Map(rows.map((row) => [row.cno, row])).values())
    const { error } = await supabase.from(TABLE).upsert(uniqueRows, { onConflict: "system_company_id,cno" })
    if (error?.message.includes("system_company_id")) {
      const legacy = await supabase.from(TABLE).upsert(uniqueRows, { onConflict: "cno" })
      if (legacy.error) throw new Error(legacy.error.message)
    } else if (error) throw new Error(error.message)
    return NextResponse.json({ saved: uniqueRows.length })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao salvar base CNO." }, { status: 500 })
  }
}

export async function PATCH() {
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from(TABLE)
      .select("id, location_code")
      .not("location_code", "is", null)
      .is("latitude", null)
      .limit(1000)
    if (error) throw new Error(error.message)

    const updates = (data || [])
      .map((row) => {
        const decoded = decodeOpenLocationCode(row.location_code)
        if (!decoded) return null
        return {
          id: row.id,
          latitude: decoded.lat,
          longitude: decoded.lng,
          geocode_status: "Código CNO",
        }
      })
      .filter(Boolean)

    if (updates.length) {
      const { error: updateError } = await supabase.from(TABLE).upsert(updates, { onConflict: "id" })
      if (updateError) throw new Error(updateError.message)
    }

    return NextResponse.json({ updated: updates.length, scanned: data?.length || 0 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao corrigir coordenadas CNO." }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const supabase = createAdminClient()
    const body = await request.json()
    const id = String(body.id || "").trim()
    const action = String(body.action || "").trim()
    if (!id) return NextResponse.json({ error: "Registro CNO não informado." }, { status: 400 })

    const now = new Date().toISOString()
    const update: Record<string, unknown> = {}
    if (action === "save") {
      update.saved_at = now
      update.commercial_status = "Salvo"
    } else if (action === "sent") {
      update.saved_at = now
      update.sent_at = now
      update.commercial_status = "Enviado"
    } else if (action === "unsave") {
      update.saved_at = null
      update.sent_at = null
      update.commercial_status = "Novo"
    } else {
      return NextResponse.json({ error: "Ação comercial inválida." }, { status: 400 })
    }

    const { data, error } = await supabase.from(TABLE).update(update).eq("id", id).select("*").single()
    if (error) throw new Error(error.message)
    if (action === "save" || action === "sent") await syncCommercialLead(supabase, data, action === "sent" ? "contato" : "prospeccao")
    return NextResponse.json({ row: rowFromDb(data) })
  } catch (error) {
    if (isMissingCommercialColumn(error)) {
      return NextResponse.json({ error: MISSING_COMMERCIAL_COLUMNS_MESSAGE }, { status: 500 })
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao atualizar registro CNO." }, { status: 500 })
  }
}
