import assert from "node:assert/strict"
import test from "node:test"
import { generatesTitle, planSync, revenueKind, summarize } from "./nf-sync.ts"
import type { ParsedInvoice } from "./nfe-parser.ts"

const ME = "72.295.744/0001-91"
const OTHER = "11.222.333/0001-81"
const party = (document: string) => ({ document, personType: "PJ" as const, name: "X", tradeName: "", stateRegistration: "", icmsIndicator: "9", email: "", phone: "", zipCode: "", street: "", number: "", complement: "", district: "", city: "", state: "", country: "Brasil" })
const nota = (patch: Partial<ParsedInvoice> = {}): ParsedInvoice => ({
  kind: "NF-e", accessKey: "1".repeat(44), number: "10", series: "1", issuedAt: "2026-03-01", nature: "VENDA", total: 100, issuer: party(OTHER), recipient: party(ME),
  items: [{ code: "1", description: "x", ncm: "", cfop: "6102", unit: "UN", quantity: 1, unitPrice: 100, total: 100 }], installments: [], warnings: [], purpose: "1", direction: "1", payment: "15", ...patch,
})

test("recebida vira Contas a Pagar e cadastra fornecedor", () => {
  assert.deepEqual(planSync(nota(), ME), { action: "importar", role: "destinatario", registerAs: "fornecedor", launch: true, note: "" })
})
test("emitida vira Contas a Receber e cadastra cliente", () => {
  const plan = planSync(nota({ issuer: party(ME), recipient: party(OTHER) }), ME)
  assert.equal(plan.action === "importar" && plan.role, "remetente")
  assert.equal(plan.action === "importar" && plan.registerAs, "cliente")
})
test("devolução, entrada própria, nota entre os mesmos CNPJs e NFC-e são ignoradas", () => {
  assert.equal(planSync(nota({ purpose: "4" }), ME).action, "ignorar")
  assert.equal(planSync(nota({ issuer: party(ME), recipient: party(OTHER), direction: "0" }), ME).action, "ignorar")
  assert.equal(planSync(nota({ issuer: party(ME), recipient: party(ME) }), ME).action, "ignorar")
  assert.equal(planSync(nota({ kind: "NFC-e" }), ME).action, "ignorar")
  assert.equal(planSync(nota({ issuer: party(OTHER), recipient: party(OTHER) }), ME).action, "ignorar")
})
test("remessa sem cobrança é registrada sem conta e sem cadastrar a parte", () => {
  const remessa = nota({ items: [{ ...nota().items[0], cfop: "6901" }], payment: "90" })
  assert.deepEqual(planSync(remessa, ME), { action: "importar", role: "destinatario", registerAs: "", launch: false, note: "Operação sem cobrança (remessa, retorno, transferência ou sem pagamento): registrada sem conta." })
})
test("duplicatas sempre geram título; tPag 90 sem duplicata não", () => {
  assert.equal(generatesTitle({ items: nota().items, payment: "90", installments: [{ number: "1", dueDate: "2026-04-01", amount: 100 }] }), true)
  assert.equal(generatesTitle({ items: nota().items, payment: "90", installments: [] }), false)
  assert.equal(generatesTitle({ items: nota().items, payment: "15", installments: [] }), true)
})
test("resumo conta cada situação", () => {
  const r = summarize([{ file: "a", status: "importada", kind: "pagar" }, { file: "b", status: "importada", kind: "receber" }, { file: "c", status: "duplicada" }, { file: "d", status: "erro" }, { file: "e", status: "ignorada" }])
  assert.deepEqual(r, { importadas: 2, duplicadas: 1, ignoradas: 1, erros: 1, pagar: 1, receber: 1 })
})

test("categoria de receita: carretas (NCM 8716), serviços (industrialização) e peças", () => {
  assert.equal(revenueKind([{ cfop: "6101", ncm: "87163100", total: 90 }, { cfop: "6101", ncm: "40111000", total: 10 }]), "Venda de carretas")
  assert.equal(revenueKind([{ cfop: "6124", ncm: "87163100", total: 100 }]), "Receita de servicos")
  assert.equal(revenueKind([{ cfop: "6102", ncm: "40111000", total: 100 }]), "Venda de pecas e acessorios")
  assert.equal(revenueKind([{ cfop: "6102", ncm: "87163100", total: 30 }, { cfop: "6102", ncm: "73181500", total: 70 }]), "Venda de pecas e acessorios")
})
