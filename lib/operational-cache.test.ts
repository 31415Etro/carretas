import assert from "node:assert/strict"
import test from "node:test"
import { defaultOperationalState, OPERATIONAL_STORAGE_KEY, saveOperationalState } from "./operational-storage.ts"

test("operational cache failure cannot interrupt a new environment save", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window")
  const removed: string[] = []
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
      setItem() { throw new DOMException("Storage full", "QuotaExceededError") },
      removeItem(key: string) { removed.push(key) },
    } } })
    const state = defaultOperationalState()
    let reachedDatabase = false
    assert.doesNotThrow(() => {
      assert.equal(saveOperationalState(state), false)
      reachedDatabase = true
    })
    assert.equal(reachedDatabase, true)
    assert.deepEqual(removed, [OPERATIONAL_STORAGE_KEY])
    Object.defineProperty(globalThis, "window", { configurable: true, value: {
      get localStorage() { throw new DOMException("Storage blocked", "SecurityError") },
    } })
    assert.equal(saveOperationalState(state), false)
    const stored = new Map<string, string>()
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
      setItem(key: string, value: string) { stored.set(key, value) },
    } } })
    assert.equal(saveOperationalState(state), true)
    assert.deepEqual(JSON.parse(stored.get(OPERATIONAL_STORAGE_KEY)!), state)
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous)
    else Reflect.deleteProperty(globalThis, "window")
  }
})
