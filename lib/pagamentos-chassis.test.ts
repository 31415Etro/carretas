import assert from "node:assert/strict"
import test from "node:test"
import { describeAfterVin, mergeSales, modelFromVin, money, parseSheet, sellerName } from "./pagamentos-chassis.ts"

test("valor, tamanho e vendedor", () => {
  assert.equal(money(7000), 7000)
  assert.equal(money(" R$ 1.234,56 "), 1234.56)
  assert.equal(money("abc"), null)
  assert.equal(describeAfterVin("980NDFZ1ETD000133 (1400X2,20 COM BAÚ DE FERRO E PLACA", "980NDFZ1ETD000133"), "1400X2,20 COM BAÚ DE FERRO E PLACA")
  assert.equal(describeAfterVin("980NDJET1TD000038 ", "980NDJET1TD000038"), "")
  assert.equal(sellerName("ANDERSON "), "Anderson")
  assert.equal(sellerName("TIAGO"), "Tiago") // não é o Thiago
  assert.equal(sellerName("THIAGO "), "Thiago")
})

test("aba da fábrica: vendedor, consumidor, valor; linha de total não entra", () => {
  const rows = [[null], ["DATA", "NF", "VENDEDOR ", "DESCRIÇÃO DO PRODUTO", "CONSUMIDOR F. ", " VALOR ", "BAIXA DE PAGAMENTO"],
    [new Date("2026-01-02T03:00:00Z"), 13945, "ANDERSON ", "980NDBC1ETD000014 (6m VG)", "JULIANO ", 7000, "PG"],
    [null, null, null, "Total: ", null, 7000, null]]
  const { sales } = parseSheet("Fábrica", rows, "fabrica")
  assert.equal(sales.length, 1)
  assert.deepEqual([sales[0].vin, sales[0].seller, sales[0].consumer, sales[0].value, sales[0].invoice, sales[0].date, sales[0].description], ["980NDBC1ETD000014", "Anderson", "Juliano", 7000, "13945", "2026-01-02", "6m VG"])
})

test("aba de vendedor externo: o vendedor é o nome da aba; total, frete e peças ficam de fora; mesmo chassi é unido", () => {
  const rows = [["DATA", "NF", "DESCRIÇÃO DO PRODUTO", "VALOR", "BAIXA DE PAGAMENTO"], [null, "14292", "980NDJET1TD000040", 4100, "pg cheque"], [null, null, "Total: ", 4100, null], [null, null, "FRETE", 300, null], [null, null, "1 par de cubos", 50, null]]
  const { sales, skipped } = parseSheet("Ademir Náutica Theod.", rows, "externo")
  assert.equal(sales.length, 1); assert.equal(skipped, 2)
  const fabrica = parseSheet("Fábrica", [["DATA", "NF", "VENDEDOR", "DESCRIÇÃO DO PRODUTO", "CONSUMIDOR F.", "VALOR"], [null, 14292, "THIAGO", "980NDJET1TD000040", "ADEMIR", 4700]], "fabrica").sales
  const [merged] = mergeSales([...fabrica, ...sales])
  assert.deepEqual([merged.seller, merged.externalSeller, merged.saleValue, merged.externalValue, merged.payment, merged.lines], ["Thiago", "Ademir Náutica Theod.", 4700, 4100, "pg cheque", 2])
})

test("modelo e ano pelo chassi", () => {
  assert.deepEqual(modelFromVin("980NDFZ1ETD000133"), { model: "FZ 1E", family: "FZ", axles: 1, year: "2026" })
  assert.deepEqual(modelFromVin("980NDJET1TD000038"), { model: "JET", family: "JET", axles: 0, year: "2026" })
})
