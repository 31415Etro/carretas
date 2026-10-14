import assert from "node:assert/strict"
import test from "node:test"
import { cnpjRegistrationNotes, cleanCnpj, formatCpfCnpjDocument, isGarbled, mapBrasilApiCnpj, mapCnpjWs, mergeCnpjCompanies } from "./cnpj-lookup.ts"

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

test("cnpj.ws completa o que a BrasilAPI não traz (inscrição estadual) sem sobrescrever", () => {
  const brasil = mapBrasilApiCnpj({ cnpj: "11222333000181", razao_social: "ACME LTDA", nome_fantasia: "ACME", municipio: "CHAPECO", uf: "SC", cep: "89800000", email: "", qsa: [{ nome_socio: "MARIA", qualificacao_socio: "Sócio-Administrador" }] })
  assert.equal(brasil.stateRegistration, "")
  assert.equal(brasil.administrator?.name, "MARIA")
  const ws = mapCnpjWs({
    razao_social: "ACME OUTRA LTDA", porte: { descricao: "Demais" }, natureza_juridica: { descricao: "Sociedade Empresária Limitada" },
    estabelecimento: { cnpj: "11222333000181", tipo: "Matriz", nome_fantasia: "OUTRO", tipo_logradouro: "RUA", logradouro: "A", numero: "1", bairro: "CENTRO", cep: "89800000", ddd1: "49", telefone1: "30000000", email: "CONTATO@ACME.COM",
      cidade: { nome: "Chapecó" }, estado: { sigla: "SC" }, atividade_principal: { id: "2930103", descricao: "Fabricação de reboques" },
      inscricoes_estaduais: [{ inscricao_estadual: "111", ativo: false, estado: { sigla: "SC" } }, { inscricao_estadual: "258842601", ativo: true, estado: { sigla: "SC" } }] },
    socios: [{ nome: "JOAO", qualificacao_socio: { descricao: "Sócio" } }],
  })
  assert.equal(ws.stateRegistration, "258842601")
  assert.equal(ws.branchType, "Matriz")
  assert.equal(ws.phone, "4930000000")
  const merged = mergeCnpjCompanies(brasil, ws)
  assert.equal(merged.legalName, "ACME LTDA") // a primária manda
  assert.equal(merged.stateRegistration, "258842601")
  assert.equal(merged.email, "contato@acme.com")
  assert.equal(merged.administrator?.name, "MARIA")
  assert.equal(isGarbled("Itaja�"), true)
  assert.equal(isGarbled("Itajaí"), false)
})
