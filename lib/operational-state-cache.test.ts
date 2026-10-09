import assert from "node:assert/strict"
import test from "node:test"

import { clearOperationalStateCache, fetchOperationalState } from "./operational-state-cache.ts"
import { defaultOperationalState } from "./operational-storage.ts"

test("carrega o estado uma única vez e reaproveita o cache; erro de API é repassado", async () => {
  const originalFetch = globalThis.fetch
  const state = { ...defaultOperationalState(), clients: [{ id: "c1", name: "Cliente" }] as any }
  let calls = 0
  try {
    clearOperationalStateCache()
    globalThis.fetch = (async () => { calls++; return Response.json({ state }) }) as typeof fetch
    const [first, second] = await Promise.all([fetchOperationalState("/api/operational-state"), fetchOperationalState("/api/operational-state")])
    assert.deepEqual(first, state)
    assert.deepEqual(second, state)
    assert.equal(calls, 1)
    await fetchOperationalState("/api/operational-state")
    assert.equal(calls, 1)

    clearOperationalStateCache()
    globalThis.fetch = (async () => Response.json({ error: "falhou" }, { status: 500 })) as typeof fetch
    await assert.rejects(fetchOperationalState("/api/operational-state"), /falhou/)
  } finally {
    globalThis.fetch = originalFetch
    clearOperationalStateCache()
  }
})
