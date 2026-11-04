import assert from "node:assert/strict"
import test from "node:test"
import { canRequestEntry, isVin, normalizeRows, renaverSituation } from "./renaver.ts"

test("situação: pendente na aba de pendentes, sucesso nas demais, falha quando o portal acusa erro", () => {
  assert.equal(renaverSituation({ tab: "Pendentes de Entrada", status: "Pendente de Entrada" }), "pendente")
  assert.equal(renaverSituation({ tab: "Em Estoque", status: "Em Estoque" }), "sucesso")
  assert.equal(renaverSituation({ tab: "Saídas", status: "Saída" }), "sucesso")
  assert.equal(renaverSituation({ tab: "Pendentes de Entrada", status: "Rejeitado pelo SERPRO" }), "falha")
  assert.equal(renaverSituation({ tab: "Pendentes de Entrada", status: "Pendente de Entrada", entryState: "erro" }), "falha")
  assert.equal(renaverSituation({}), "pendente")
})

test("chassi: 17 caracteres sem I, O e Q", () => {
  assert.equal(isVin("980NDJET1SD000199"), true)
  assert.equal(isVin("980ndjet1sd000199"), true)
  assert.equal(isVin("980NDJET1SD00019"), false)
  assert.equal(isVin("980NDJET1SD00019O"), false)
})

test("linhas: descarta chassi inválido e repetido", () => {
  const rows = normalizeRows([
    { tab: "Em Estoque", vin: "980NDJET1SD000199", status: "ok", kind: "ACABADO", montadoraAt: "24/11/2025" },
    { tab: "Saídas", vin: "980NDJET1SD000199", status: "x" },
    { tab: "Em Estoque", vin: "lixo" },
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].tab, "Em Estoque")
})

test("entrada de zero km só para chassi pendente sem pedido em andamento", () => {
  assert.equal(canRequestEntry({ tab: "Pendentes de Entrada", entry_state: null }), true)
  assert.equal(canRequestEntry({ tab: "Pendentes de Entrada", entry_state: "solicitada" }), false)
  assert.equal(canRequestEntry({ tab: "Em Estoque" }), false)
  assert.equal(canRequestEntry(null), false)
})
