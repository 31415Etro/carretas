import assert from "node:assert/strict"
import test from "node:test"
import { cnpjRegistrationNotes, cleanCnpj, formatCpfCnpjDocument, mapBrasilApiCnpj } from "./cnpj-lookup.ts"

test("normaliza e mapeia o cadastro retornado pela BrasilAPI", () => {
  assert.equal(cleanCnpj("19.131.243/0001-97"), "19131243000197")
  assert.equal(formatCpfCnpjDocument("12345678901"), "123.456.789-01")
  const company = mapBrasilApiCnpj({
    cnpj: "19131243000197",
    razao_social: "EMPRESA TESTE LTDA",
    nome_fantasia: "EMPRESA TESTE",
    descricao_tipo_de_logradouro: "AVENIDA",
    logradouro: "PAULISTA",
    numero: "1000",
    complemento: "SALA 1",
    bairro: "BELA VISTA",
    municipio: "SAO PAULO",
    uf: "SP",
    cep: "01310100",
    ddd_telefone_1: "1130000000",
    email: "CONTATO@TESTE.COM.BR",
    descricao_situacao_cadastral: "ATIVA",
    cnae_fiscal_descricao: "Servicos de engenharia",
  })
  assert.equal(company.document, "19.131.243/0001-97")
  assert.equal(company.street, "AVENIDA PAULISTA")
  assert.equal(company.zipCode, "01310-100")
  assert.equal(company.email, "contato@teste.com.br")
  assert.match(cnpjRegistrationNotes(company), /Situacao cadastral: ATIVA/)
})
