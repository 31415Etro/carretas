import assert from "node:assert/strict"
import test from "node:test"
import { findZipCandidates, mergeResidence, parseResidenceProof } from "./residence-proof.ts"

test("conta de luz com endereço em várias linhas", () => {
  const parsed = parseResidenceProof(["CELESC DISTRIBUIÇÃO S.A.", "CNPJ 08.336.783/0001-90", "NOME: JANDSON DOS SANTOS ALVES", "RUA CLARINDO SEBASTIAO DA CUNHA, 36 - ESPINHEIROS", "ITAJAI - SC", "CEP: 88317-193", "VENCIMENTO 10/11/2026"].join("\n"))
  assert.equal(parsed.zipCandidates[0], "88317193")
  assert.equal(parsed.street, "RUA CLARINDO SEBASTIAO DA CUNHA")
  assert.equal(parsed.number, "36")
  assert.equal(parsed.holder, "JANDSON DOS SANTOS ALVES")
})

test("tudo numa linha só, com complemento", () => {
  const parsed = parseResidenceProof("Endereço: AV. BEIRA RIO 1250 APTO 302 - CENTRO - CHAPECO - SC - CEP 89801-000")
  assert.equal(parsed.zipCandidates[0], "89801000")
  assert.equal(parsed.street, "AV. BEIRA RIO")
  assert.equal(parsed.number, "1250")
  assert.match(parsed.complement, /APTO 302/)
})

test("boleto com código de barras: o CEP vem do rótulo, não dos dígitos do código", () => {
  const text = ["34191.79001 01043.510047 91020.150008 5 91210000012345", "34191790010104351004791020150008591210000012345", "Endereço: Rua Sete de Setembro, S/N", "Bairro: Centro   CEP: 88.300-000   Cidade: Itajaí  UF: SC"].join("\n")
  const parsed = parseResidenceProof(text)
  assert.equal(parsed.zipCandidates[0], "88300000")
  assert.match(parsed.street, /^Rua Sete de Setembro$/i)
  assert.equal(parsed.number, "S/N")
  assert.equal(parsed.district, "Centro")
  assert.equal(parsed.city, "Itajaí")
  assert.equal(parsed.state, "SC")
})

test("nome de rua com número (7 de Setembro) não vira número do imóvel", () => {
  const parsed = parseResidenceProof("RUA 7 DE SETEMBRO 100\nCEP 88300-000")
  assert.equal(parsed.number, "100")
  assert.match(parsed.street, /7 DE SETEMBRO$/)
})

test("sem CEP nem endereço: avisa e não inventa", () => {
  const parsed = parseResidenceProof("FATURA\nTotal a pagar R$ 120,00")
  assert.equal(parsed.zipCandidates.length, 0)
  assert.equal(parsed.street, "")
  assert.ok(parsed.warnings.length >= 1)
})

test("CPF e CNPJ não são confundidos com CEP", () => {
  assert.deepEqual(findZipCandidates("CPF 081.822.885-76 CNPJ 31.690.385/0001-90"), [])
})

test("junção: a base de CEP manda em rua/bairro/cidade; número e complemento vêm do comprovante", () => {
  const parsed = parseResidenceProof("RUA X, 36 APTO 2\nCEP 88317-193")
  const merged = mergeResidence(parsed, "88317193", { street: "RUA CLARINDO SEBASTIAO DA CUNHA", district: "ESPINHEIROS", city: "ITAJAI", state: "sc" })
  assert.equal(merged.zipCode, "88317-193")
  assert.equal(merged.street, "Rua Clarindo Sebastiao da Cunha")
  assert.equal(merged.number, "36")
  assert.equal(merged.district, "Espinheiros")
  assert.equal(merged.city, "Itajai")
  assert.equal(merged.state, "SC")
})
