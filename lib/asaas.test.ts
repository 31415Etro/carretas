import assert from "node:assert/strict"
import test from "node:test"
import {
  asaasExternalReference,
  paymentStatusToFinancialStatus,
  resourceFromWebhook,
  statementDirection,
} from "./asaas.ts"
import { ASAAS_ALERT_EVENT_TYPES, ASAAS_WEBHOOK_EVENTS, asaasEventResourceLabel } from "./asaas-events.ts"

test("gera referencia estavel por OS e conta", () => {
  assert.equal(asaasExternalReference("e95e00c0-a30c-4b53-ae70-7a22925a3011", "services"), "MC:OS:e95e00c0-a30c-4b53-ae70-7a22925a3011:services")
})

test("normaliza estados financeiros de cobranca", () => {
  assert.equal(paymentStatusToFinancialStatus("RECEIVED"), "Realizado")
  assert.equal(paymentStatusToFinancialStatus("OVERDUE"), "Vencido")
  assert.equal(paymentStatusToFinancialStatus("REFUNDED"), "Estornado")
  assert.equal(paymentStatusToFinancialStatus("PENDING"), "Previsto")
})

test("classifica entradas, saidas e recursos de webhook", () => {
  assert.equal(statementDirection(100), "entrada")
  assert.equal(statementDirection(-0.01), "saida")
  assert.equal(resourceFromWebhook({ payment: { id: "pay_1" } }).type, "payment")
  assert.equal(resourceFromWebhook({ invoice: { id: "inv_1" } }).type, "invoice")
  assert.equal(resourceFromWebhook({ bill: { id: "bill_1" } }).type, "bill")
  assert.equal(resourceFromWebhook({ pixCredit: { id: "pix_1" } }).type, "pix_credit")
})

test("cobre todos os grupos configurados no webhook das duas contas", () => {
  assert.ok(ASAAS_WEBHOOK_EVENTS.length > 100)
  assert.ok(ASAAS_WEBHOOK_EVENTS.includes("PAYMENT_RECEIVED"))
  assert.ok(ASAAS_WEBHOOK_EVENTS.includes("BILL_PAID"))
  assert.ok(ASAAS_WEBHOOK_EVENTS.includes("PIX_CREDIT_RECEIVED"))
  assert.ok(ASAAS_WEBHOOK_EVENTS.includes("ACCESS_TOKEN_EXPIRING_SOON"))
  assert.equal(new Set(ASAAS_WEBHOOK_EVENTS).size, ASAAS_WEBHOOK_EVENTS.length)
  assert.ok(ASAAS_ALERT_EVENT_TYPES.has("INVOICE_ERROR"))
  assert.equal(asaasEventResourceLabel("BALANCE_VALUE_BLOCKED"), "Saldo")
})
