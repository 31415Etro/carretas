import type { OperationalState } from "./operational-storage.ts"

export function operationalChanges(previous: OperationalState, next: OperationalState) {
  const changes: Record<string, unknown> = {}
  for (const key of Object.keys(next) as (keyof OperationalState)[]) {
    const value = next[key]
    if (!Array.isArray(value) || value === previous[key]) continue
    const before = new Map((previous[key] as { id: string }[]).map((row) => [row.id, row]))
    const changed = (value as { id: string }[]).filter((row) => JSON.stringify(before.get(row.id)) !== JSON.stringify(row))
    if (changed.length) changes[key] = changed
  }
  return changes
}

export async function persistOperationalChanges(previous: OperationalState, next: OperationalState) {
  const changes = operationalChanges(previous, next)
  if (!Object.keys(changes).length) return
  const response = await fetch("/api/operational-state", {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ changes }),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || `Falha ao salvar (HTTP ${response.status}).`)
}
