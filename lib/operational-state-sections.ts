import type { OperationalState } from "./operational-storage.ts"

export const operationalSections = ["registry", "pmoc", "execution"] as const
export type OperationalSection = typeof operationalSections[number]

const operationalStateCache = new Map<string, { state: OperationalState; expiresAt: number }>()
const operationalStateRequests = new Map<string, Promise<OperationalState>>()
const cacheDurationMs = 30_000

export function operationalStateSection(state: OperationalState, section: OperationalSection) {
  const execution = new Set(["serviceOrders", "serviceOrderEvents", "checklistItems", "serviceOrderMaterials", "serviceOrderFiles", "serviceOrderSignatures", "auditLogs", "pointPhotos", "environmentPhotos", "providerDocuments", "vehicleUsage", "vehicleChecklists", "vehicleMaintenance"])
  return Object.fromEntries(Object.entries(state).filter(([key]) => {
    const owner = key.startsWith("pmoc") ? "pmoc" : execution.has(key) ? "execution" : "registry"
    return owner === section
  })) as Partial<OperationalState>
}

export function primeOperationalStateCache(cacheKey: string, state: OperationalState) {
  operationalStateCache.set(cacheKey, { state, expiresAt: Date.now() + cacheDurationMs })
}

export function clearOperationalStateCache(cacheKey?: string) {
  if (cacheKey) {
    operationalStateCache.delete(cacheKey)
    operationalStateRequests.delete(cacheKey)
    return
  }
  operationalStateCache.clear()
  operationalStateRequests.clear()
}

export async function fetchOperationalState(endpoint: string, cacheKey = endpoint): Promise<OperationalState> {
  const cached = operationalStateCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.state
  const pending = operationalStateRequests.get(cacheKey)
  if (pending) return pending

  const request = Promise.all(operationalSections.map(async (section) => {
    const response = await fetch(`${endpoint}${endpoint.includes("?") ? "&" : "?"}section=${section}`, { cache: "no-store" })
    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload?.state) throw new Error(payload?.error || `Erro ao carregar dados (HTTP ${response.status}).`)
    return payload.state
  })).then((parts) => {
    const state = Object.assign({}, ...parts) as OperationalState
    primeOperationalStateCache(cacheKey, state)
    return state
  }).finally(() => {
    operationalStateRequests.delete(cacheKey)
  })

  operationalStateRequests.set(cacheKey, request)
  return request
}
