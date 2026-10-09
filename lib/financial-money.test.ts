import assert from "node:assert/strict"
import test from "node:test"

import { parseMoney } from "./financial-storage.ts"

test("interpreta valores monetários nos formatos brasileiro e internacional", () => {
  assert.equal(parseMoney("1.234,56"), 1234.56)
  assert.equal(parseMoney("1,234.56"), 1234.56)
  assert.equal(parseMoney("R$ 1.234,56"), 1234.56)
})

test("preserva centavos informados com ponto ou vírgula", () => {
  assert.equal(parseMoney("541.95"), 541.95)
  assert.equal(parseMoney("541,95"), 541.95)
  assert.equal(parseMoney("20.5"), 20.5)
})

test("diferencia agrupamento de milhar e valor negativo", () => {
  assert.equal(parseMoney("1.234.567"), 1234567)
  assert.equal(parseMoney("-2.500,75"), -2500.75)
  assert.equal(parseMoney(""), 0)
})
