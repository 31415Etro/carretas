import assert from "node:assert/strict"
import test from "node:test"
import { digits, notaAsDocumentPath, notaAsPublicStatus, notaAsStatusPath, recipientDocument } from "./notaas.ts"

test("normaliza CPF e CNPJ do tomador", () => {
  assert.deepEqual(recipientDocument("123.456.789-01"), { cpf: "12345678901" })
  assert.deepEqual(recipientDocument("12.345.678/0001-90"), { cnpj: "12345678000190" })
  assert.throws(() => recipientDocument("123"), /CPF.*CNPJ/)
})

test("monta rotas distintas de NFS-e e NF-e sem expor credencial", () => {
  assert.equal(notaAsStatusPath("service", "abc"), "/invoices/abc/status")
  assert.equal(notaAsStatusPath("material", "abc"), "/nfe/invoices/abc/status")
  assert.equal(notaAsDocumentPath("service", "abc", "pdf"), "/invoices/abc/pdf")
  assert.equal(notaAsDocumentPath("material", "abc", "pdf"), "/nfe/invoices/abc/danfe")
  assert.equal(notaAsDocumentPath("material", "abc", "xml"), "/nfe/invoices/abc/xml")
  assert.equal(digits("12.345-6"), "123456")
})

test("traduz status assincrono do NotaAS", () => {
  assert.equal(notaAsPublicStatus("processing"), "Processando")
  assert.equal(notaAsPublicStatus("issued"), "Emitida")
  assert.equal(notaAsPublicStatus("error"), "Erro")
})
