import test from "node:test"
import assert from "node:assert/strict"
import { advanceNumber, advanceTermText } from "./travel-advance-term.ts"

test("número do lançamento com zeros à esquerda", () => {
  assert.equal(advanceNumber(12), "ANT-00012")
  assert.equal(advanceNumber(null), "")
})

test("termo: dados do funcionário e da empresa, valor em reais e por extenso, e o artigo 462 da CLT", () => {
  const text = advanceTermText({ employeeName: "Maria da Silva", employeeCpf: "123.456.789-00", companyName: "ND Carretas Fort", companyCnpj: "31.690.385/0001-90", amount: 350.5, number: 7 })
  assert.equal(text.number, "Lançamento nº ANT-00007")
  assert.match(text.paragraphs[0], /Eu, Maria da Silva, inscrito\(a\) no CPF sob nº 123\.456\.789-00, funcionário\(a\) da empresa ND Carretas Fort, inscrita no CNPJ sob nº 31\.690\.385\/0001-90/)
  assert.match(text.paragraphs[0], /R\$\s?350,50 \(trezentos e cinquenta reais e cinquenta centavos\)/)
  assert.match(text.paragraphs[3], /artigo 462 da Consolidação das Leis do Trabalho \(CLT\)/)
  assert.equal(text.title[0], "TERMO DE AUTORIZAÇÃO DE DESCONTO EM FOLHA DE PAGAMENTO")
})

test("dado que falta vira linha em branco para preencher à mão (CPF, valor)", () => {
  const text = advanceTermText({ employeeName: "João", employeeCpf: "", companyName: "ND", companyCnpj: "", amount: 0, number: null })
  assert.match(text.paragraphs[0], /CPF sob nº _{18}/)
  assert.match(text.paragraphs[0], /valor de R\$ _______ \(________________\)/)
  assert.equal(text.number, "")
})
