import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { ACCOUNTING_MIGRATION_HINT } from "@/lib/accounting-server"
import { chassisByModel, chassisByModelMonth, chassisChart, chassisFromInvoice, chassisPerChassis, digits, filterChassis, isSaleNature, otherNoteFromInvoice, type ChassisRow, type OtherNote } from "@/lib/chassis"
import { FORT_COMPANY_ID, ND_COMPANY_ID, registrySummary, viewRegistry, kgToTons, type RegistryRow } from "@/lib/chassis-registry"
import { fetchAllPages, memoize } from "@/lib/paged-fetch"
import { withoutRemessas } from "@/lib/remessas"
import { createAdminClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const COLUMNS = "id,number,series,issued_at,access_key,nature,recipient_name,recipient_document,total_invoice,items:data->items"
const CACHE_MS = 60_000

/** Todos os chassis das notas de venda do período, de todas as empresas. Lê em páginas de 1.000, empresas e páginas em paralelo, e guarda por 1 minuto (digitar na busca não volta ao banco). */
function loadChassis(de: string, ate: string) {
  return memoize(`chassis|${de}|${ate}`, CACHE_MS, async () => {
    const companies = await createAdminClient({ bypassCompanyScope: true }).from("system_companies").select("id,name,trade_name,cnpj").order("is_default", { ascending: false }).order("name")
    if (companies.error) throw companies.error
    const groupDocuments = (companies.data || []).map((company) => digits(company.cnpj || ""))
    const perCompany = await Promise.all((companies.data || []).map(async (company) => {
      const admin = createAdminClient({ companyId: company.id })
      const invoices = await fetchAllPages<Record<string, unknown>>((from, to) => {
        let query = withoutRemessas(admin.from("accounting_invoices").select(COLUMNS)).eq("operation", "Saída") // remessas (CFOP 5912/6912) não são venda: ficam na visão "Remessas"
        if (de) query = query.gte("issued_at", `${de}T00:00:00-03:00`)
        if (ate) query = query.lte("issued_at", `${ate}T23:59:59-03:00`)
        return query.order("issued_at", { ascending: false }).order("id").range(from, to) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>
      })
      const rows: ChassisRow[] = []
      const others: OtherNote[] = []
      const excluded = new Map<string, { label: string; notes: number; carretas: number; value: number }>()
      for (const invoice of invoices) {
        // só nota de venda entra na análise; o que não é venda (remessa, demonstração, industrialização...) é só contado à parte
        if (!isSaleNature(String((invoice as { nature?: string }).nature || ""))) {
          const label = String((invoice as { nature?: string }).nature || "Sem natureza").trim()
          const trailers = chassisFromInvoice(invoice as never, { id: company.id, name: company.trade_name || company.name }, groupDocuments)
          const entry = excluded.get(label) || { label, notes: 0, carretas: 0, value: 0 }
          entry.notes += 1; entry.carretas += trailers.reduce((sum, row) => sum + (row.chassis ? 1 : row.quantity), 0); entry.value += Number((invoice as { total_invoice?: number }).total_invoice || 0)
          excluded.set(label, entry)
          continue
        }
        const found = chassisFromInvoice(invoice as never, { id: company.id, name: company.trade_name || company.name }, groupDocuments)
        if (found.length) rows.push(...found)
        else others.push(otherNoteFromInvoice(invoice as never, { id: company.id, name: company.trade_name || company.name }, groupDocuments)) // peças e outros: só nos totais
      }
      return { rows, others, excluded: [...excluded.values()], notes: invoices.length }
    }))
    const excluded = new Map<string, { label: string; notes: number; carretas: number; value: number }>()
    for (const entry of perCompany.flatMap((item) => item.excluded)) { const total = excluded.get(entry.label) || { label: entry.label, notes: 0, carretas: 0, value: 0 }; total.notes += entry.notes; total.carretas += entry.carretas; total.value += entry.value; excluded.set(entry.label, total) }
    return { rows: perCompany.flatMap((entry) => entry.rows), others: perCompany.flatMap((entry) => entry.others), excluded: [...excluded.values()].sort((a, b) => b.value - a.value), notes: perCompany.reduce((sum, entry) => sum + entry.notes, 0) }
  })
}

const REGISTRY_BASE_COLUMNS = "vin,group_name,model,family,axles,description,year_manufacture,year_model,pbt_kg,capacity_kg,tare_kg,axle_capacity_kg,color,client_hint,first_mention,last_mention,mentions,alerts,system_company_id"
const REGISTRY_COLUMNS = `${REGISTRY_BASE_COLUMNS},seller,external_seller,sale_value,external_value,paid_value,sale_date,sale_invoice,consumer,payment_note`
const REGISTRY_HINT = "O cadastro de chassis ainda não está instalado no banco. Rode o script 242 no SQL Editor do Supabase."
const num = (value: unknown) => Number(value || 0) || 0

/** Cadastro de chassis (planilha do WhatsApp), de todas as empresas. Se o script 242 ainda não foi rodado, devolve vazio e avisa (a página segue funcionando só com as notas). */
function loadRegistry() {
  return memoize("chassis|cadastro", CACHE_MS, async (): Promise<{ rows: RegistryRow[]; missing: boolean }> => {
    const admin = createAdminClient({ bypassCompanyScope: true })
    const read = (columns: string) => fetchAllPages<Record<string, unknown>>((from, to) => admin.from("chassis_registry").select(columns).order("vin").range(from, to) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>)
    try {
      let data: Record<string, unknown>[]
      try { data = await read(REGISTRY_COLUMNS) } catch (error) {
        if (/column .*(seller|sale_|paid_value|consumer|payment_note)/i.test((error as { message?: string })?.message || "")) data = await read(REGISTRY_BASE_COLUMNS) // script 243 ainda não rodou: segue sem vendedor/valor
        else throw error
      }
      return { missing: false, rows: data.map((row) => ({
        vin: String(row.vin), groupName: String(row.group_name || ""), model: String(row.model || ""), family: String(row.family || ""), axles: num(row.axles), description: String(row.description || ""),
        yearManufacture: String(row.year_manufacture || ""), yearModel: String(row.year_model || ""), pbtKg: num(row.pbt_kg), capacityKg: num(row.capacity_kg), tareKg: num(row.tare_kg), axleCapacityKg: num(row.axle_capacity_kg),
        color: String(row.color || ""), clientHint: String(row.client_hint || ""), firstMention: (row.first_mention as string) || null, lastMention: (row.last_mention as string) || null, mentions: num(row.mentions), alerts: String(row.alerts || ""), companyId: String(row.system_company_id || ""),
        seller: String(row.seller || ""), externalSeller: String(row.external_seller || ""), saleValue: num(row.sale_value), externalValue: num(row.external_value), paidValue: num(row.paid_value), saleDate: String(row.sale_date || ""), saleInvoice: String(row.sale_invoice || ""), consumer: String(row.consumer || ""), paymentNote: String(row.payment_note || ""),
      })) }
    } catch (error) {
      const message = (error as { message?: string })?.message || ""
      if (/chassis_registry/.test(message) && /does not exist|Could not find|schema cache/i.test(message)) return { missing: true, rows: [] }
      throw error
    }
  })
}

/** VIN -> última nota de venda que o cita. */
function notesByVin(rows: ChassisRow[]) {
  const map = new Map<string, { number: string; clientName: string; issuedAt: string | null }>()
  for (const row of rows) {
    if (!row.chassis) continue
    const current = map.get(row.chassis)
    if (!current || String(row.issuedAt || "") > String(current.issuedAt || "")) map.set(row.chassis, { number: row.number, clientName: row.clientName, issuedAt: row.issuedAt })
  }
  return map
}

/**
 * Chassis das notas de venda (saída) da Contabilidade, de todas as empresas.
 *   ?opcoes=clientes                      clientes do sistema para o seletor
 *   ?q=&clienteId=&de=&ate=&interna=1     consulta (chassi inteiro ou parte, número da nota, cliente) + números do gráfico do período
 *   ?visao=cadastro&q=&modelo=&nota=com|sem&pagina=   chassis cadastrados (planilha) cruzados com as notas: quais já têm nota e quais não
 *   &visao=modelo | chassi                análise: quantidade e valor por modelo (e por mês) ou por chassi, com os mesmos filtros
 */
export async function GET(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const params = new URL(request.url).searchParams
    if (params.get("opcoes") === "clientes") {
      const { data, error } = await memoize("chassis|clientes", CACHE_MS * 5, async () => {
        const result = await context.admin.from("clients").select("id,name,document").order("name").limit(5000)
        return { data: result.data, error: result.error }
      })
      if (error) throw error
      return NextResponse.json({ clients: (data || []).map((row) => ({ id: String(row.id), name: String(row.name || ""), document: String(row.document || "") })) })
    }
    const isDay = (value: string | null) => /^\d{4}-\d{2}-\d{2}$/.test(value || "")
    const de = isDay(params.get("de")) ? String(params.get("de")) : ""
    const ate = isDay(params.get("ate")) ? String(params.get("ate")) : ""
    let loaded
    try { loaded = await loadChassis(de, ate) } catch (error) {
      const message = (error as { message?: string })?.message || ""
      if (/accounting_invoices/.test(message) && /does not exist|Could not find|schema cache/i.test(message)) throw new Error(ACCOUNTING_MIGRATION_HINT)
      throw error
    }

    let clientDocument = "", clientName = ""
    const clientId = params.get("clienteId")
    if (clientId) {
      const client = await context.admin.from("clients").select("name,document").eq("id", clientId).maybeSingle()
      if (client.error) throw client.error
      clientDocument = digits(client.data?.document || ""); clientName = String(client.data?.name || "")
    }
    const rows = filterChassis(loaded.rows, { q: params.get("q") || "", clientDocument, clientName: clientDocument ? "" : clientName, includeIntercompany: params.get("interna") === "1" })
    const client = clientId ? { name: clientName, document: clientDocument } : null
    const view = params.get("visao")
    if (view === "modelo") return NextResponse.json({ found: rows.length, notes: loaded.notes, client, byModel: chassisByModel(rows), byModelMonth: chassisByModelMonth(rows) })
    if (view === "cadastro") {
      const registry = await loadRegistry()
      const all = viewRegistry(registry.rows, notesByVin(loaded.rows), {})
      const filtered = viewRegistry(registry.rows, notesByVin(loaded.rows), { q: params.get("q") || "", model: params.get("modelo") || "", note: params.get("nota") === "com" ? "com" : params.get("nota") === "sem" ? "sem" : "", seller: params.get("vendedor") || "", sort: params.get("ordem") === "chassi-asc" ? "chassi-asc" : params.get("ordem") === "chassi-desc" ? "chassi-desc" : "" })
      const pageSize = 100, page = Math.max(1, Number(params.get("pagina")) || 1)
      const inRegistry = new Set(registry.rows.map((row) => row.vin))
      const noteChassis = new Set(loaded.rows.filter((row) => row.chassis).map((row) => row.chassis))
      return NextResponse.json({ missing: registry.missing, hint: registry.missing ? REGISTRY_HINT : "", summary: registrySummary(all), sellers: [...new Set(registry.rows.flatMap((row) => [row.seller, row.externalSeller]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")), noteChassisNotRegistered: [...noteChassis].filter((vin) => !inRegistry.has(vin)).length, found: filtered.length, page, pageSize, items: filtered.slice((page - 1) * pageSize, page * pageSize) })
    }
    if (view === "todos") {
      // descrição/tamanho do cadastro nos chassis das notas; PBT e capacidade só entram quando a nota não trouxe
      const registryRows = (await loadRegistry()).rows
      const registry = new Map(registryRows.map((row) => [row.vin, row]))
      const withNote = new Set(loaded.rows.map((row) => row.chassis).filter(Boolean))
      const companyNames = new Map(loaded.rows.map((row) => [row.companyId, row.companyName]))
      companyNames.set(FORT_COMPANY_ID, companyNames.get(FORT_COMPANY_ID) || "Fort Com de Ferro e Aço")
      companyNames.set(ND_COMPANY_ID, companyNames.get(ND_COMPANY_ID) || "ND Carretas")
      // chassis do cadastro sem nota de venda também entram (a página é de chassis): datados pela primeira menção na conversa, sem valor
      const withoutNote = registryRows.filter((row) => !withNote.has(row.vin) && (row.firstMention || row.lastMention)).map((row) => ({
        chassis: row.vin, model: row.model, family: row.family, axles: row.axles, pbt: kgToTons(row.pbtKg), capacity: kgToTons(row.capacityKg), color: row.color, year: row.yearModel || row.yearManufacture, productCode: "",
        invoiceId: `cadastro:${row.vin}`, number: row.saleInvoice, series: "", issuedAt: row.saleDate ? `${row.saleDate}T12:00:00-03:00` : row.firstMention || row.lastMention, clientName: "", clientDocument: "", quantity: 1, unitPrice: row.saleValue || row.externalValue, itemTotal: row.saleValue || row.externalValue, invoiceTotal: 0,
        companyId: row.companyId, companyName: companyNames.get(row.companyId) || "ND Carretas", intercompany: false, sizeNote: row.description, semNota: true, seller: row.seller, externalSeller: row.externalSeller, consumer: row.consumer,
      }))
      return NextResponse.json({ notes: loaded.notes, others: loaded.others, excluded: loaded.excluded, rows: [...loaded.rows.map(({ description, accessKey, nature, ...slim }) => {
        const known = slim.chassis ? registry.get(slim.chassis) : undefined
        return known ? { ...slim, seller: known.seller, externalSeller: known.externalSeller, consumer: known.consumer, saleValue: known.saleValue || known.externalValue, sizeNote: known.description, pbt: slim.pbt || kgToTons(known.pbtKg), capacity: slim.capacity || kgToTons(known.capacityKg), color: slim.color || known.color } : slim
      }), ...withoutNote] }) // página Chassis: gráficos e filtros são feitos no navegador
    }
    if (view === "chassi") return NextResponse.json({ found: rows.length, notes: loaded.notes, client, perChassis: chassisPerChassis(rows) })
    rows.sort((a, b) => String(b.issuedAt || "").localeCompare(String(a.issuedAt || "")) || b.number.localeCompare(a.number))
    return NextResponse.json({ rows: rows.slice(0, 500), found: rows.length, notes: loaded.notes, chart: chassisChart(loaded.rows), client })
  } catch (error) {
    const message = error instanceof Error ? error.message : (error as { message?: string })?.message || "Não foi possível consultar os chassis."
    return NextResponse.json({ error: message }, { status: message === ACCOUNTING_MIGRATION_HINT ? 503 : 400 })
  }
}
