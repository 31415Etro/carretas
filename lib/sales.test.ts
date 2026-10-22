import assert from "node:assert/strict"
import test from "node:test"
import { fulfilment, mrpSituation, positiveNumber, productionActions, productionStatusLabel, salesActions, salesStatusLabel } from "./sales.ts"

test("rótulos e situação derivada da produção", () => {
  assert.equal(salesStatusLabel("Aguardando producao"), "Aguardando produção")
  assert.equal(salesStatusLabel("Pronto para entrega"), "Pronto para entrega")
  assert.equal(productionStatusLabel("Em producao", 2, 5), "Parcialmente concluída")
  assert.equal(productionStatusLabel("Em producao", 0, 5), "Em produção")
  assert.equal(productionStatusLabel("Concluida", 5, 5), "Concluída")
})
test("atendimento: pronto, entregue e em fabricação nunca contam a mesma unidade duas vezes", () => {
  const f = fulfilment({ quantity: 5, reserved: 2, delivered: 1, in_production: 2 })
  assert.deepEqual([f.pending, f.unplanned, f.percent], [2, 0, 60])
  assert.deepEqual([fulfilment({ quantity: 5, reserved: 0, delivered: 0, in_production: 0 }).unplanned, fulfilment({ quantity: 0, reserved: 0, delivered: 0, in_production: 0 }).percent], [5, 0])
  assert.equal(fulfilment({ quantity: 3, reserved: 5, delivered: 0, in_production: 0 }).pending, 0)
})
test("ações do pedido por situação", () => {
  const item = (reserved: number, delivered = 0) => [{ id: "i", line_type: "Produto", quantity: 5, reserved, delivered, produced: 0, in_production: 0 }]
  assert.equal(salesActions({ status: "Aguardando confirmacao" }, false, item(0)).confirm, true)
  assert.equal(salesActions({ status: "Confirmado" }, false, item(0)).confirm, false)
  assert.equal(salesActions({ status: "Aguardando producao", payment_confirmed_at: null }, true, item(0)).payment, true)
  assert.equal(salesActions({ status: "Aguardando producao", payment_confirmed_at: "2026-10-01" }, true, item(0)).payment, false)
  assert.equal(salesActions({ status: "Aguardando producao" }, false, item(0)).payment, false)
  assert.equal(salesActions({ status: "Parcialmente disponivel" }, false, item(2)).deliver, true)
  assert.equal(salesActions({ status: "Em producao" }, false, item(0)).deliver, false)
  assert.equal(salesActions({ status: "Parcialmente disponivel" }, false, item(2, 1)).cancel, false) // já houve entrega
  assert.equal(salesActions({ status: "Entregue" }, false, item(0, 5)).cancel, false)
})
test("ações da ordem de produção", () => {
  const a = (status: string, produced = 0) => productionActions({ status, quantity: 5, produced_quantity: produced })
  assert.deepEqual([a("Pronta para producao").start, a("Em producao").start], [true, false])
  assert.deepEqual([a("Pausada").resume, a("Pausada").consume, a("Pausada").complete, a("Pausada").pause], [true, false, false, false])
  assert.equal(a("Em producao", 2).cancel, false) // já produziu
  assert.equal(a("Em producao", 2).remaining, 3)
  assert.deepEqual([a("Concluida", 5).complete, a("Cancelada").reserve], [false, false])
  assert.equal(a("Aguardando inspecao").backToProduction, true)
})
test("situação do MRP e leitura de quantidades", () => {
  assert.equal(mrpSituation({ shortage_now: 5, shortage_projected: 5, to_request: 5 }).key, "comprar")
  assert.equal(mrpSituation({ shortage_now: 5, shortage_projected: 5, to_request: 0 }).key, "solicitado")
  assert.equal(mrpSituation({ shortage_now: 5, shortage_projected: 0, to_request: 0 }).key, "aguardar")
  assert.equal(mrpSituation({ shortage_now: 0, shortage_projected: 0, to_request: 0 }).key, "ok")
  assert.equal(positiveNumber("1.250,5"), 1250.5)
  assert.ok(Number.isNaN(positiveNumber("0")) && Number.isNaN(positiveNumber("abc")) && Number.isNaN(positiveNumber("")))
})
