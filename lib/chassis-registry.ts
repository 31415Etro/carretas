// Cadastro de chassis fora das notas (tabela chassis_registry, script 242): vem da planilha de controle do WhatsApp e guarda a descrição/tamanho.
import { spDay } from "./sp-day.ts"
// Funções puras (testáveis): o nome do grupo da planilha vira modelo/linha/eixos e o cadastro é cruzado com os chassis das notas.

export type RegistryRow = {
  vin: string; groupName: string; model: string; family: string; axles: number; description: string
  yearManufacture: string; yearModel: string; pbtKg: number; capacityKg: number; tareKg: number; axleCapacityKg: number
  color: string; clientHint: string; firstMention: string | null; lastMention: string | null; mentions: number; alerts: string; companyId: string
  // planilha "Controle de pgtos" (script 243); 0 / vazio = não informado
  seller: string; externalSeller: string; saleValue: number; externalValue: number; paidValue: number; saleDate: string; saleInvoice: string; consumer: string; paymentNote: string
}

/** "CHASSI  BC 1E (1)" -> "BC 1E"; "CHASSI CA 1E ( MOTO . )" -> "CA 1E"; "Fort- chassi 1 eixo" -> "FORT 1E"; "Chassi BC 2E 3 toneladas (1)" -> "BC 2E". */
export function modelFromGroup(group: string): { model: string; family: string; axles: number } {
  const text = String(group || "").replace(/\(.*?\)/g, " ").replace(/\s+/g, " ").trim()
  const fort = text.match(/^fort\W*(?:chassi\s*)?(\d)\s*eixos?/i) || text.match(/^fort\W*chassi\s*(\d)\s*eixos?/i)
  if (fort) return { model: `FORT ${fort[1]}E`, family: "FORT", axles: Number(fort[1]) }
  const code = text.replace(/^chassis?\s*/i, "").toUpperCase().match(/^([A-Z]+)(?:\s+(\d)E)?/)
  if (!code) return { model: "", family: "", axles: 0 }
  const axles = Number(code[2] || 0)
  return { model: axles ? `${code[1]} ${axles}E` : code[1], family: code[1], axles }
}

/** Planilha "28/10/2026 07:34" (horário de Brasília) -> ISO com fuso; vazio ou inválido vira null. */
export function parseMention(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/)
  if (!match) return null
  const [, dd, mm, yyyy, hh = "12", mi = "00"] = match
  const iso = `${yyyy}-${mm}-${dd}T${hh}:${mi}:00-03:00`
  return Number.isNaN(Date.parse(iso)) ? null : iso
}

export const kgToTons = (kg: number) => (kg > 0 ? Math.round(kg) / 1000 : 0)

/** Empresa dona do cadastro: os chassis "Fort" (VIN 980VPR...) são da Fort Com de Ferro e Aço; os demais, da ND Carretas Fort. */
export const FORT_COMPANY_ID = "8a52a1db-00b1-4d4d-bdf4-731dcecc2057"
export const ND_COMPANY_ID = "00000000-0000-4000-8000-000000000001"
export const companyForGroup = (group: string) => (/^\s*fort/i.test(group) ? FORT_COMPANY_ID : ND_COMPANY_ID)

/** O que o cadastro sabe da última nota de venda do chassi (para cruzar e filtrar). */
export type RegistryNote = { number: string; clientName: string; clientDocument?: string; issuedAt: string | null; intercompany?: boolean; color?: string; capacity?: number }

export type RegistryFilters = {
  q?: string; model?: string; note?: "" | "com" | "sem"; company?: string; seller?: string; sort?: "" | "chassi-asc" | "chassi-desc"
  from?: string; to?: string; color?: string; capacity?: string; clients?: string[]; intercompany?: boolean // mesmos filtros da parte de cima da página de Chassis
}
export type RegistryView = RegistryRow & {
  hasNote: boolean; noteNumber: string; noteClient: string; noteIssuedAt: string | null
  date: string; effectiveColor: string; effectiveCapacity: number; clientKey: string; noteIntercompany: boolean // data (aaaa-mm-dd), cor e capacidade (t) valendo, chave do cliente da nota
}

const saoPauloDay = (value?: string | null) => spDay(value)
/** Chave do cliente como na parte de cima da página: documento, ou "nome:NOME" sem documento. */
export const clientKeyOf = (document: string | undefined, name: string) => document || `nome:${name}`

const normalize = (value: string) => String(value || "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "")

/** Une o cadastro com os chassis das notas (VIN -> última nota) e aplica os filtros da tela. */
export function viewRegistry(rows: RegistryRow[], notes: Map<string, RegistryNote>, filters: RegistryFilters): RegistryView[] {
  const term = normalize(filters.q || "").trim()
  return rows.map((row) => {
    const note = notes.get(row.vin)
    const date = note ? saoPauloDay(note.issuedAt) : row.saleDate || saoPauloDay(row.firstMention || row.lastMention) // a mesma data que o gráfico usa
    return {
      ...row, hasNote: Boolean(note), noteNumber: note?.number || "", noteClient: note?.clientName || "", noteIssuedAt: note?.issuedAt || null,
      date, effectiveColor: row.color || note?.color || "", effectiveCapacity: row.capacityKg ? Math.round(row.capacityKg) / 1000 : note?.capacity || 0,
      clientKey: note ? clientKeyOf(note.clientDocument, note.clientName) : "", noteIntercompany: Boolean(note?.intercompany),
    }
  }).filter((row) => {
    if (row.noteIntercompany && !filters.intercompany) return false // venda entre as empresas ND só com o filtro ligado
    if (filters.from && (!row.date || row.date < filters.from)) return false
    if (filters.to && (!row.date || row.date > filters.to)) return false
    if (filters.color && (row.effectiveColor || "Sem cor") !== filters.color) return false
    if (filters.capacity && String(row.effectiveCapacity || 0) !== filters.capacity) return false
    if (filters.clients?.length && !filters.clients.includes(row.clientKey)) return false
    if (filters.model && row.model !== filters.model) return false
    if (filters.company && row.companyId !== filters.company) return false
    if (filters.seller && row.seller !== filters.seller && row.externalSeller !== filters.seller) return false
    if (filters.note === "com" && !row.hasNote) return false
    if (filters.note === "sem" && row.hasNote) return false
    if (term && !normalize([row.vin, row.model, row.description, row.clientHint, row.noteClient, row.noteNumber, row.seller, row.externalSeller, row.consumer].join(" ")).includes(term)) return false
    return true
  }).sort((a, b) => {
    if (filters.sort) { // só os 4 últimos caracteres do chassi contam
      const byTail = a.vin.slice(-4).localeCompare(b.vin.slice(-4), "pt-BR", { numeric: true })
      if (byTail) return filters.sort === "chassi-asc" ? byTail : -byTail
    }
    return String(b.lastMention || "").localeCompare(String(a.lastMention || "")) || a.vin.localeCompare(b.vin)
  })
}

/** Resumo do cadastro: quantos já têm nota no sistema, quantos não, e por modelo. */
export function registrySummary(rows: RegistryView[]) {
  const byModel = new Map<string, { model: string; total: number; withNote: number }>()
  for (const row of rows) {
    const entry = byModel.get(row.model || "Sem modelo") || { model: row.model || "Sem modelo", total: 0, withNote: 0 }
    entry.total += 1; if (row.hasNote) entry.withNote += 1
    byModel.set(entry.model, entry)
  }
  const withNote = rows.filter((row) => row.hasNote).length
  return { total: rows.length, withNote, withoutNote: rows.length - withNote, withDescription: rows.filter((row) => row.description).length, byModel: [...byModel.values()].sort((a, b) => b.total - a.total) }
}
