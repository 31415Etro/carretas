// Renaver (portal da montadora): regras puras de situação do chassi e normalização das linhas lidas pelo robô. Sem rede nem banco (testável).
export const RENAVER_TABS = ["Pendentes de Entrada", "Em Estoque", "Em Transferência", "Saídas"] as const
export type RenaverSituation = "pendente" | "sucesso" | "falha"
export type RenaverRow = { tab: string; vin: string; status: string; kind: string; montadoraAt: string }

export const situationLabel: Record<RenaverSituation, string> = { pendente: "Pendente", sucesso: "Sucesso", falha: "Falha" }
export const situationTone: Record<RenaverSituation, string> = { pendente: "bg-amber-100 text-amber-800", sucesso: "bg-emerald-100 text-emerald-800", falha: "bg-red-100 text-red-800" }

const FAILURE = /rejeit|erro|falha|negad|cancel|inv[aá]lid/i
const VIN = /^[A-HJ-NPR-Z0-9]{17}$/

export const normalizeVin = (value: unknown) => String(value || "").toUpperCase().replace(/\s+/g, "").trim()
export const isVin = (value: unknown) => VIN.test(normalizeVin(value))

/** Pendente = ainda na aba "Pendentes de Entrada"; falha = o portal ou o pedido de entrada acusou erro; qualquer outra aba = a entrada aconteceu (sucesso). */
export function renaverSituation(input: { tab?: string | null; status?: string | null; entryState?: string | null }): RenaverSituation {
  if (input.entryState === "erro") return "falha"
  if (FAILURE.test(String(input.status || ""))) return "falha"
  const tab = String(input.tab || "").trim()
  if (!tab || tab === "Pendentes de Entrada") return "pendente"
  return "sucesso"
}

/** Só aceita linhas com chassi válido; descarta repetidas (a primeira aba em que o chassi aparece manda). */
export function normalizeRows(rows: unknown): RenaverRow[] {
  const seen = new Set<string>()
  const out: RenaverRow[] = []
  for (const raw of Array.isArray(rows) ? rows : []) {
    const item = raw as Record<string, unknown>
    const vin = normalizeVin(item?.vin)
    if (!isVin(vin) || seen.has(vin)) continue
    seen.add(vin)
    out.push({ vin, tab: String(item.tab || "").slice(0, 60), status: String(item.status || "").slice(0, 120), kind: String(item.kind || "").slice(0, 60), montadoraAt: String(item.montadoraAt || "").slice(0, 40) })
  }
  return out
}

/** Pode pedir a Entrada de Zero KM: o chassi está pendente de entrada no portal e não há pedido em andamento. */
export const canRequestEntry = (row: { tab?: string | null; entry_state?: string | null } | null | undefined) =>
  Boolean(row) && String(row?.tab || "") === "Pendentes de Entrada" && row?.entry_state !== "solicitada"
