import assert from "node:assert/strict"
import test from "node:test"
import { defaultOperationalState } from "./operational-storage.ts"
import { operationalChanges, persistOperationalChanges } from "./operational-changes.ts"
import { clearOperationalStateCache, fetchOperationalState, operationalSections, operationalStateSection } from "./operational-state-sections.ts"
import { readAllPages } from "./supabase-pagination.ts"

test("all equipment pages load, including records after 1000", async () => {
  const rows = Array.from({ length: 1356 }, (_, id) => ({ id }))
  assert.deepEqual(await readAllPages(async (from, to) => ({ data: rows.slice(from, to + 1), error: null })), rows)
  await assert.rejects(readAllPages(async () => ({ data: null, error: { message: "offline" } })), /offline/)
})

test("equipment save excludes unrelated files and unchanged rows", async () => {
  const before = defaultOperationalState()
  const after = { ...before, clientEquipment: [{ id: "new", name: "Equipment" } as any] }
  assert.deepEqual(Object.keys(operationalChanges(before, after)), ["clientEquipment"])
  assert.deepEqual(operationalChanges(before, { ...before, clients: before.clients.map((row) => ({ ...row })) }), {})
  const previousFetch = globalThis.fetch
  try {
    globalThis.fetch = async (_url, init) => {
      assert.equal(init?.method, "PATCH")
      assert.deepEqual(Object.keys(JSON.parse(String(init?.body)).changes), ["clientEquipment"])
      return new Response("Payload too large", { status: 413 })
    }
    await assert.rejects(persistOperationalChanges(before, after), /413/)
  } finally { globalThis.fetch = previousFetch }
})

test("response sections reconstruct the complete state without losing arrays", async () => {
  clearOperationalStateCache()
  const state = defaultOperationalState()
  const parts = operationalSections.map((section) => operationalStateSection(state, section))
  assert.deepEqual(Object.assign({}, ...parts), state)
  assert.equal(parts.reduce((count, part) => count + Object.keys(part).length, 0), Object.keys(state).length)
  const previousFetch = globalThis.fetch
  try {
    let requestCount = 0
    globalThis.fetch = async (url) => {
      requestCount += 1
      const section = new URL(String(url), "http://localhost").searchParams.get("section") as typeof operationalSections[number]
      return Response.json({ state: operationalStateSection(state, section) })
    }
    assert.deepEqual(await fetchOperationalState("/api/operational-state?orderId=test"), state)
    assert.deepEqual(await fetchOperationalState("/api/operational-state?orderId=test"), state)
    assert.equal(requestCount, 3)
    clearOperationalStateCache()
    globalThis.fetch = async () => new Response("offline", { status: 500 })
    await assert.rejects(fetchOperationalState("/api/operational-state"), /500/)
  } finally { globalThis.fetch = previousFetch }
})
