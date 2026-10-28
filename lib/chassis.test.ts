import test from "node:test"
import assert from "node:assert/strict"
import { chassisChart, chassisFromInvoice, describeTrailer, extractChassis, filterChassis } from "./chassis.ts"

const FZ = "MARCA MOD R/ND CARRETAS FZ 1E ANO 2026/MOD 2026 PBT 0,75 t CAP 0,55 t COR PRATA COD (600043) 980NDFZ1ETD000233"
const JET = "MARCA MOD R/ND CARRETAS JET 1E ANO 2026/ MOD 2026 PBT 0,75 t CAP 055 COR PRATA COD ( 600071) 980NDJET1TD000184"

test("chassi vem depois do código do produto; com ou sem espaços e em minúsculas", () => {
  assert.equal(extractChassis(FZ), "980NDFZ1ETD000233")
  assert.equal(extractChassis(JET), "980NDJET1TD000184")
  assert.equal(extractChassis("x cod (1) 980ndca1etd000020 "), "980NDCA1ETD000020")
  assert.equal(extractChassis("CHASSI DE CARRETA FAZENDINHA"), null)
  assert.equal(extractChassis("PARAFUSO 8MM"), null)
  assert.equal(extractChassis("peça 980NDPR2ETD000099 avulsa"), "980NDPR2ETD000099") // padrão 980ND mesmo sem o COD
})

test("modelo, cor, ano e código do produto da descrição", () => {
  assert.deepEqual(describeTrailer(FZ), { model: "FZ 1E", color: "PRATA", year: "2026", productCode: "600043" })
  assert.equal(describeTrailer(JET).model, "JET 1E")
  assert.equal(describeTrailer("MARCA MOD R/ND CARRETAS FC 1E, ANO 2026/MOD 2026 COR PRATA COD (600099) 980NDFC1ETD000001").model, "FC 1E")
})

const invoice = (id: string, number: string, client: string, document: string, issued: string, description = FZ) => ({
  id, number, series: "1", issued_at: issued, access_key: `4226${number}`.padEnd(44, "0"), nature: "Venda", recipient_name: client, recipient_document: document, total_invoice: 9000,
  items: [{ description, total: 9000 }, { description: "FRETE", total: 0 }],
})
const company = { id: "c1", name: "ND Carretas Fort" }
const group = ["31690385000190", "72295744000191"]

test("uma linha por chassi; item sem chassi é ignorado e venda entre empresas do grupo é marcada", () => {
  const rows = [
    ...chassisFromInvoice(invoice("1", "100", "JOÃO DA SILVA", "123.456.789-00", "2026-02-10T10:00:00-03:00"), company, group),
    ...chassisFromInvoice(invoice("2", "101", "ND CARRETAS E REBOQUES FORT LTDA", "72.295.744/0001-91", "2026-02-11T10:00:00-03:00", JET), company, group),
  ]
  assert.equal(rows.length, 2)
  assert.equal(rows[0].clientDocument, "12345678900")
  assert.equal(rows[0].intercompany, false)
  assert.equal(rows[1].intercompany, true)
})

test("consulta por chassi (inteiro ou parte), por número da nota e por cliente (documento ou nome)", () => {
  const rows = [
    ...chassisFromInvoice(invoice("1", "100", "JOÃO DA SILVA", "123.456.789-00", "2026-02-10T10:00:00-03:00"), company, group),
    ...chassisFromInvoice(invoice("2", "101", "MARIA SOUZA", "987.654.321-00", "2026-03-05T10:00:00-03:00", JET), company, group),
    ...chassisFromInvoice(invoice("3", "102", "ND CARRETAS E REBOQUES FORT LTDA", "72.295.744/0001-91", "2026-03-06T10:00:00-03:00", FZ.replace("000233", "000999")), company, group),
  ]
  assert.equal(filterChassis(rows, { q: "980NDFZ1ETD000233" }).length, 1)
  assert.equal(filterChassis(rows, { q: "980ndfz1etd0002" }).length, 1)
  assert.equal(filterChassis(rows, { q: "td000184" })[0].number, "101")
  assert.equal(filterChassis(rows, { q: "101" })[0].chassis, "980NDJET1TD000184")
  assert.equal(filterChassis(rows, { clientDocument: "987.654.321-00" }).length, 1)
  assert.equal(filterChassis(rows, { clientName: "joão" }).length, 1)
  assert.equal(filterChassis(rows, {}).length, 2)                                    // sem filtro: venda entre empresas do grupo não entra
  assert.equal(filterChassis(rows, { includeIntercompany: true }).length, 3)
  assert.equal(filterChassis(rows, { q: "000999" }).length, 1)                       // pesquisando o chassi, aparece mesmo na venda entre empresas
})

test("gráfico: chassis por mês, modelo, cliente e empresa; sem contar a venda entre empresas", () => {
  const rows = [
    ...chassisFromInvoice(invoice("1", "100", "JOÃO", "12345678900", "2026-02-10T10:00:00-03:00"), company, group),
    ...chassisFromInvoice(invoice("2", "101", "JOÃO", "12345678900", "2026-02-20T10:00:00-03:00", FZ.replace("000233", "000234")), company, group),
    ...chassisFromInvoice(invoice("3", "102", "MARIA", "98765432100", "2026-03-05T10:00:00-03:00", JET), company, group),
    ...chassisFromInvoice(invoice("4", "103", "ND CARRETAS FORT LTDA", "31690385000190", "2026-03-06T10:00:00-03:00", FZ.replace("000233", "000555")), company, group),
  ]
  const chart = chassisChart(rows)
  assert.equal(chart.totalChassis, 3)
  assert.equal(chart.intercompany, 1)
  assert.deepEqual(chart.months.map((m) => [m.label, m.chassis]), [["2026-02", 2], ["2026-03", 1]])
  assert.deepEqual(chart.models.map((m) => [m.label, m.chassis]), [["FZ 1E", 2], ["JET 1E", 1]])
  assert.equal(chart.clients[0].label, "JOÃO")
  assert.equal(chart.clients[0].total, 18000)
})

test("análise: quantidade e valor por modelo, por modelo e mês, e por chassi", async () => {
  const { chassisByModel, chassisByModelMonth, chassisPerChassis } = await import("./chassis.ts")
  const rows = [
    ...chassisFromInvoice(invoice("1", "100", "JOÃO", "12345678900", "2026-02-10T10:00:00-03:00"), company, group),
    ...chassisFromInvoice(invoice("2", "101", "JOÃO", "12345678900", "2026-02-20T10:00:00-03:00", FZ.replace("000233", "000234")), company, group),
    ...chassisFromInvoice(invoice("3", "102", "MARIA", "98765432100", "2026-03-05T10:00:00-03:00", JET), company, group),
    ...chassisFromInvoice(invoice("4", "103", "PEDRO", "11122233344", "2026-03-09T10:00:00-03:00", FZ), company, group),   // o mesmo chassi 000233 vendido de novo
  ]
  const byModel = chassisByModel(rows)
  assert.deepEqual(byModel.map((m) => [m.model, m.chassis, m.notes, m.items, m.total, m.average]), [["FZ 1E", 2, 3, 3, 27000, 9000], ["JET 1E", 1, 1, 1, 9000, 9000]])
  assert.equal(byModel[0].first, "2026-02-10"); assert.equal(byModel[0].last, "2026-03-09")
  const matrix = chassisByModelMonth(rows)
  assert.deepEqual(matrix.months, ["2026-02", "2026-03"])
  assert.deepEqual(matrix.rows[0].byMonth.map((c) => c.chassis), [2, 1])
  const per = chassisPerChassis(rows)
  const repeated = per.find((p) => p.chassis === "980NDFZ1ETD000233")!
  assert.equal(repeated.notes, 2); assert.equal(repeated.total, 18000); assert.equal(repeated.lastClient, "PEDRO"); assert.equal(repeated.numbers, "100, 103")
  assert.equal(per.length, 3)
})
