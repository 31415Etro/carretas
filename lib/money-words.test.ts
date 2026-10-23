import assert from "node:assert/strict"
import test from "node:test"
import { moneyInWords } from "./money-words.ts"

test("valores por extenso como no pedido comercial", () => {
  assert.equal(moneyInWords(6380), "seis mil trezentos e oitenta reais")
  assert.equal(moneyInWords(2000), "dois mil reais")
  assert.equal(moneyInWords(1), "um real")
  assert.equal(moneyInWords(0), "zero reais")
  assert.equal(moneyInWords(1500), "mil e quinhentos reais")
  assert.equal(moneyInWords(101), "cento e um reais")
  assert.equal(moneyInWords(100), "cem reais")
  assert.equal(moneyInWords(12345.67), "doze mil trezentos e quarenta e cinco reais e sessenta e sete centavos")
  assert.equal(moneyInWords(0.5), "cinquenta centavos")
  assert.equal(moneyInWords(1000000), "um milhão de reais")
  assert.equal(moneyInWords(2001), "dois mil e um reais")
})
