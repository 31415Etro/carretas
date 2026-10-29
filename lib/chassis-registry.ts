// Cadastro de chassis fora das notas (tabela chassis_registry, script 242): vem da planilha de controle do WhatsApp e guarda a descrição/tamanho.
// Funções puras (testáveis): o nome do grupo da planilha vira modelo/linha/eixos e o cadastro é cruzado com os chassis das notas.

export type RegistryRow = {
  vin: string; groupName: string; model: string; family: string; axles: number; description: string
  yearManufacture: string; yearModel: string; pbtKg: number; capacityKg: number; tareKg: number; axleCapacityKg: number
  color: string; clientHint: string; firstMention: string | null; lastMention: string | null; mentions: number; alerts: string; companyId: string
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

export type RegistryFilters = { q?: string; model?: string; note?: "" | "com" | "sem"; company?: string }
export type RegistryView = RegistryRow & { hasNote: boolean; noteNumber: string; noteClient: string; noteIssuedAt: string | null }

const normalize = (value: string) => String(value || "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "")

/** Une o cadastro com os chassis das notas (VIN -> última nota) e aplica os filtros da tela. */
export function viewRegistry(rows: RegistryRow[], notes: Map<string, { number: string; clientName: string; issuedAt: string | null }>, filters: RegistryFilters): RegistryView[] {
  const term = normalize(filters.q || "").trim()
  return rows.map((row) => {
    const note = notes.get(row.vin)
    return { ...row, hasNote: Boolean(note), noteNumber: note?.number || "", noteClient: note?.clientName || "", noteIssuedAt: note?.issuedAt || null }
  }).filter((row) => {
    if (filters.model && row.model !== filters.model) return false
    if (filters.company && row.companyId !== filters.company) return false
    if (filters.note === "com" && !row.hasNote) return false
    if (filters.note === "sem" && row.hasNote) return false
    if (term && !normalize([row.vin, row.model, row.description, row.clientHint, row.noteClient, row.noteNumber].join(" ")).includes(term)) return false
    return true
  }).sort((a, b) => String(b.lastMention || "").localeCompare(String(a.lastMention || "")) || a.vin.localeCompare(b.vin))
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
