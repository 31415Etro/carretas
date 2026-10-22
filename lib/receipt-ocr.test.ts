import assert from "node:assert/strict"
import test from "node:test"
import { categorizeReceipt, parseReceiptText } from "./receipt-ocr.ts"

test("lê valor total, data e estabelecimento de um cupom de posto", () => {
  const text = "POSTO IPIRANGA LTDA\nCNPJ 12.345.678/0001-90\nRUA DAS FLORES 100\nDATA 05/03/2026\nGASOLINA COMUM 10,000 L\nVALOR TOTAL\n150,00"
  const result = parseReceiptText(text)
  assert.equal(result.amount, 150)
  assert.equal(result.occurredAt, "2026-03-05")
  assert.equal(result.category, "Combustivel")
  assert.match(result.establishment, /POSTO IPIRANGA/i)
})

test("sem rótulo de total: usa o maior valor e avisa", () => {
  const result = parseReceiptText("RESTAURANTE BOM SABOR\n10/01/2026\nAGUA 5,00\nPRATO FEITO 35,00")
  assert.equal(result.amount, 35)
  assert.ok(result.warnings.some((warning) => /total/i.test(warning)))
})

test("categoriza por palavra-chave", () => {
  assert.equal(categorizeReceipt("HOTEL CENTRAL - DIARIA"), "Hospedagem")
  assert.equal(categorizeReceipt("UBER VIAGEM SP"), "Transporte")
  assert.equal(categorizeReceipt("ESTACIONAMENTO ESTAPAR"), "Estacionamento")
  assert.equal(categorizeReceipt("PRACA DE PEDAGIO SEM PARAR"), "Pedagio")
  assert.equal(categorizeReceipt("LOJA DE ROUPAS XYZ"), "Outros")
})

test("sem data legível: usa hoje e avisa", () => {
  const result = parseReceiptText("MERCADO BOM PRECO\nTOTAL\n42,90")
  assert.equal(result.occurredAt, new Date().toISOString().slice(0, 10))
  assert.ok(result.warnings.some((warning) => /data/i.test(warning)))
  assert.equal(result.category, "Alimentacao")
})
