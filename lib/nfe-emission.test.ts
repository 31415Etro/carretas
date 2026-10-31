import assert from "node:assert/strict"
import test from "node:test"
import { chassisFromInvoice, extractChassis } from "./chassis.ts"
import { describeWithChassis, parseDecimal, payloadTotal, toPortalNumber, validateCancelReason, validateEmission, type EmissionPayload } from "./nfe-emission.ts"

const base = (): EmissionPayload => ({
  header: { cfop: "5102", nature: "Venda de mercadoria", purpose: "1", finalConsumer: "0", presence: "" },
  recipient: { source: "manual", personType: "PJ", document: "81744534000124", name: "3 ACAO LTDA", stateRegistration: "9069126941", ieIndicator: "1", zip: "85601030", street: "R X", number: "10", complement: "", district: "CENTRO", state: "PR", city: "FRANCISCO BELTRAO", email: "", phone: "", operationDestination: "1" },
  items: [{ code: "600043", description: "CARRETA TESTE", ncm: "87164000", quantity: "2", unitPrice: "1.500,50", unit: "UN", gtin: "SEM GTIN", cfop: "5102", origin: "0", icms: { cst: "102", aliquota: "", base: "", valor: "" }, pis: { cst: "49", aliquota: "", base: "", valor: "" }, cofins: { cst: "49", aliquota: "", base: "", valor: "" }, ipi: { cst: "", aliquota: "", base: "", valor: "" } }],
  payment: { indicator: "0", form: "17", value: "3001,00" },
  transport: { mode: "9" },
  additionalInfo: "",
})

test("números em formato brasileiro e para o portal", () => {
  assert.equal(parseDecimal("1.234,56"), 1234.56)
  assert.equal(parseDecimal("1234.56"), 1234.56)
  assert.equal(parseDecimal("R$ 10,5"), 10.5)
  assert.equal(parseDecimal(""), 0)
  assert.equal(toPortalNumber("1.500,5"), "1500,50")
})

test("total da nota soma quantidade x valor unitário de cada item", () => {
  assert.equal(payloadTotal(base()), 3001)
})

test("a descrição com o chassi é reconhecida pela página Chassis", () => {
  const description = describeWithChassis("CARRETA ND CARRETAS FZ 1E ANO 2026/MOD 2026 PBT 0,75 t CAP 0,55 t COR PRATA", "980nd fz1etd000233", "(600043)")
  assert.match(description, /COD \(600043\) 980NDFZ1ETD000233$/)
  assert.equal(extractChassis(description), "980NDFZ1ETD000233")
  const rows = chassisFromInvoice({ id: "1", number: "5645", series: "1", issued_at: "2026-10-31T10:00:00-03:00", access_key: "", nature: "Venda de mercadoria", recipient_name: "X", recipient_document: "81744534000124", total_invoice: 100, items: [{ description, total: 100, quantity: 1, unitPrice: 100, ncm: "87164000" }] }, { id: "c", name: "ND" })
  assert.equal(rows[0].chassis, "980NDFZ1ETD000233")
})

test("não repete o chassi nem o COD que já estão na descrição", () => {
  const once = describeWithChassis("CARRETA COD (600043) 980NDFZ1ETD000233", "980NDFZ1ETD000233", "600043")
  assert.equal(once, "CARRETA COD (600043) 980NDFZ1ETD000233")
  assert.equal(describeWithChassis("CARRETA COD (600043)", "980NDFZ1ETD000234", "1"), "CARRETA COD (600043) 980NDFZ1ETD000234")
  assert.equal(describeWithChassis("CARRETA", "", "1"), "CARRETA")
})

test("nota válida não tem erros e a inválida diz o que falta", () => {
  assert.deepEqual(validateEmission(base()), [])
  const bad = base()
  bad.recipient.document = "123"
  bad.items[0].ncm = "8716"
  bad.items[0].icms.cst = ""
  bad.payment.value = "10,00"
  const errors = validateEmission(bad).join(" | ")
  assert.match(errors, /CNPJ do destinatário/)
  assert.match(errors, /NCM deve ter 8 dígitos/)
  assert.match(errors, /ICMS/)
  assert.match(errors, /valor do pagamento/i)
})

test("destinatário contribuinte exige inscrição estadual", () => {
  const payload = base()
  payload.recipient.stateRegistration = ""
  assert.match(validateEmission(payload).join(" "), /inscrição estadual/)
  payload.recipient.ieIndicator = "9"
  assert.deepEqual(validateEmission(payload), [])
})

test("motivo de cancelamento: 15 a 255 caracteres", () => {
  assert.ok(validateCancelReason("curto"))
  assert.equal(validateCancelReason("Nota emitida com valor incorreto"), null)
  assert.ok(validateCancelReason("x".repeat(256)))
})
