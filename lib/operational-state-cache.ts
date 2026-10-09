import { migrateOperationalState, type OperationalState } from "./operational-storage.ts"

const operationalStateCache = new Map<string, { state: OperationalState; expiresAt: number }>()
const operationalStateRequests = new Map<string, Promise<OperationalState>>()
const cacheDurationMs = 30_000

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

/** Carrega o estado dos cadastros (clientes, fornecedores, técnicos, frota...) com cache curto e requisição única. */
export async function fetchOperationalState(endpoint: string, cacheKey = endpoint): Promise<OperationalState> {
  const cached = operationalStateCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.state
  const pending = operationalStateRequests.get(cacheKey)
  if (pending) return pending

  const request = fetch(endpoint, { cache: "no-store" })
    .then(async (response) => {
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.state) throw new Error(payload?.error || `Erro ao carregar dados (HTTP ${response.status}).`)
      const state = migrateOperationalState(payload.state)
      primeOperationalStateCache(cacheKey, state)
      return state
    })
    .finally(() => {
      operationalStateRequests.delete(cacheKey)
    })

  operationalStateRequests.set(cacheKey, request)
  return request
}
