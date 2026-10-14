import assert from "node:assert/strict"
import test from "node:test"
import { applyCompany, companyToForm, isLookupReady, validateRegistry } from "./registry.ts"
import { mapBrasilApiCnpj } from "./cnpj-lookup.ts"

const client = { personType: "PJ", status: "Ativo", document: "11.222.333/0001-81", name: "ACME LTDA", phone: "(49) 3000-0000", zipCode: "89800-000", street: "Rua A", number: "1", district: "Centro", city: "Chapecó", state: "SC", country: "Brasil", icmsIndicator: "9" }
const supplier = { ...client, supplyCategory: "Peças e componentes" }

test("pronto para consultar: só CNPJ completo e válido (inclusive alfanumérico)", () => {
  assert.equal(isLookupReady("PJ", "11222333000181"), true)
  assert.equal(isLookupReady("PJ", "11222333000182"), false)
  assert.equal(isLookupReady("PJ", "1122233300018"), false)
  assert.equal(isLookupReady("PF", "11222333000181"), false)
})

test("cliente completo valida; lead só exige nome e telefone", () => {
  assert.equal(validateRegistry("client", client), "")
  assert.match(validateRegistry("client", { ...client, document: "11.222.333/0001-80" }), /CNPJ inválido/)
  assert.match(validateRegistry("client", { ...client, city: "" }), /Cidade/)
  assert.equal(validateRegistry("client", { personType: "PJ", status: "Prospect", name: "Lead", phone: "49999990000" }), "")
  assert.match(validateRegistry("supplier", { ...client, status: "Prospect" }), /status/i)
})

test("fornecedor exige categoria e dados bancários completos quando informados", () => {
  assert.match(validateRegistry("supplier", client), /Categoria de fornecimento/)
  assert.equal(validateRegistry("supplier", supplier), "")
  assert.match(validateRegistry("supplier", { ...supplier, bankName: "Sicoob" }), /bancários incompletos/)
  assert.match(validateRegistry("supplier", { ...supplier, bankName: "Sicoob", bankAgency: "1", bankAccount: "2" }), /titular/)
  assert.equal(validateRegistry("supplier", { ...supplier, bankName: "Sicoob", bankAgency: "1", bankAccount: "2", holderName: "ACME" }), "")
})

test("consulta não sobrescreve o que o usuário editou sem confirmação", () => {
  const company = companyToForm(mapBrasilApiCnpj({ cnpj: "11222333000181", razao_social: "ACME LTDA", nome_fantasia: "", municipio: "CHAPECO", uf: "SC", ddd_telefone_1: "4930000000", cnaes_secundarios: [{ codigo: 1, descricao: "x" }], cnae_fiscal: 2930101, cnae_fiscal_descricao: "Carrocerias" }))
  assert.equal(company.phone, "(49) 3000-0000")
  assert.equal(company.cnaeMain, "2930101 - Carrocerias")
  const current = { name: "Meu nome", city: "", phone: "" }
  const touched = new Set(["name"])
  const soft = applyCompany(current, company, touched)
  assert.deepEqual(soft.conflicts, ["name"])
  assert.equal(soft.next.name, "Meu nome")
  assert.equal(soft.next.city, "CHAPECO")
  assert.equal(applyCompany(current, company, touched, true).next.name, "ACME LTDA")
  assert.equal(applyCompany({ tradeName: "Meu" }, { tradeName: "" }, new Set()).next.tradeName, "Meu") // ausente na API: não escreve
})
