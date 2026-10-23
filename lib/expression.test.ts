import assert from "node:assert/strict"
import test from "node:test"
import { evaluateExpression, formatExpression, parseExpression } from "./expression.ts"

const parse = (text: string) => { const r = parseExpression(text); assert.ok(r.ok, r.ok ? "" : r.error); return r }

test("operações, precedência e funções", () => {
  const vars = { comprimento: 3000, largura: 1500, a: 7 }
  assert.equal(evaluateExpression(parse("(2*comprimento + 3*largura)/1000").ast, vars), 10.5)
  assert.equal(evaluateExpression(parse("ceil(comprimento / 1000) * 2").ast, vars), 6)
  assert.equal(evaluateExpression(parse("max(1, a, 3)").ast, vars), 7)
  assert.equal(evaluateExpression(parse("-comprimento + 1").ast, vars), -2999)
  assert.equal(evaluateExpression(parse("2,5 * 2").ast, vars), 5) // vírgula decimal
  assert.equal(evaluateExpression(parse("round(10 / 3, 2)").ast, vars), 3.33)
  assert.equal(evaluateExpression(parse("se(largura > 1200, 10, 20)").ast, vars), 10)
  assert.equal(evaluateExpression(parse("largura > 1200 e nao comprimento < 2000").ast, vars), true)
  assert.equal(evaluateExpression(parse("acabamento == 'galvanizado' ou a == 0").ast, { ...vars, acabamento: "galvanizado" }), true)
})
test("lista os parâmetros usados", () => {
  assert.deepEqual(parse("2*comprimento + largura * comprimento").params.sort(), ["comprimento", "largura"])
  assert.deepEqual(parse("1 + 2").params, [])
})
test("recusa o que não é permitido (sem execução de código)", () => {
  for (const text of ["process.exit()", "constructor.constructor('x')()", "a; b", "a ? b : c", "1 +", "(1 + 2", "pg_sleep(1)", "eval(1)", "'sem fechar", "a || b", "x = 1; drop", "max(1)", "se(1, 2)", "round(1,2,3)", "`x`", "a.b", "a[0]", "{}", "1 2"]) {
    assert.equal(parseExpression(text).ok, false, text)
  }
  assert.equal(parseExpression("").ok, false)
  assert.equal(parseExpression("a".repeat(2000)).ok, false)
  assert.equal(parseExpression("(".repeat(40) + "1" + ")".repeat(40)).ok, false) // profundidade
})
test("divisão por zero e parâmetro desconhecido não passam", () => {
  assert.throws(() => evaluateExpression(parse("1 / x").ast, { x: 0 }), /Divisão por zero/)
  assert.throws(() => evaluateExpression(parse("y + 1").ast, {}), /Parâmetro desconhecido/)
})
test("formatar e analisar de novo dá a mesma árvore", () => {
  for (const text of ["(2*comprimento + 3*largura)/1000", "se(largura > 1200 e altura < 2000, ceil(comprimento / 500), 0)", "max(a, b) - min(a, b) * 2"]) {
    const first = parse(text)
    assert.deepEqual(parse(formatExpression(first.ast)).ast, first.ast, text)
  }
})
