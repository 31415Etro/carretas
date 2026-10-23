import assert from "node:assert/strict"
import test from "node:test"
import { idDocumentNotes, parseIdDocument } from "./id-document.ts"

const CNH = `REPUBLICA FEDERATIVA DO BRASIL
MINISTERIO DOS TRANSPORTES
CARTEIRA NACIONAL DE HABILITACAO
NOME
JOAO CARLOS DA SILVA
DOC. IDENTIDADE / ORG. EMISSOR / UF
1234567 SSP SC
CPF 529.982.247-25 DATA NASCIMENTO
14/03/1985
FILIAÇÃO
JOSE CARLOS DA SILVA
MARIA APARECIDA DA SILVA
Nº REGISTRO 04567891234
VALIDADE 10/05/2031 1ª HABILITAÇÃO 12/06/2005`

const RG = `REPÚBLICA FEDERATIVA DO BRASIL
SECRETARIA DE SEGURANÇA PÚBLICA
CARTEIRA DE IDENTIDADE
REGISTRO GERAL 12.345.678-9 DATA DE EXPEDIÇÃO 02/02/2019
NOME
ANA PAULA SOUZA LIMA
FILIAÇÃO
CARLOS ALBERTO LIMA
SUELI SOUZA LIMA
DATA DE NASCIMENTO 22/11/1990
CPF 111.444.777-35`

test("CNH: nome, CPF, nascimento, filiação e registro", () => {
  const result = parseIdDocument(CNH)
  assert.equal(result.kind, "CNH")
  assert.equal(result.name, "JOAO CARLOS DA SILVA")
  assert.equal(result.cpf, "52998224725")
  assert.equal(result.birthDate, "1985-03-14")
  assert.equal(result.fatherName, "JOSE CARLOS DA SILVA")
  assert.equal(result.motherName, "MARIA APARECIDA DA SILVA")
  assert.equal(result.cnh, "04567891234")
})

test("RG: nome, CPF, nascimento (não confunde com a expedição) e RG", () => {
  const result = parseIdDocument(RG)
  assert.equal(result.kind, "RG")
  assert.equal(result.name, "ANA PAULA SOUZA LIMA")
  assert.equal(result.cpf, "11144477735")
  assert.equal(result.birthDate, "1990-11-22")
  assert.equal(result.rg, "12.345.678-9")
  assert.match(idDocumentNotes(result), /RG: 12\.345\.678-9/)
})

test("texto ruim: avisa o que não leu em vez de inventar", () => {
  const result = parseIdDocument("xx ## 12\nabc")
  assert.equal(result.cpf, "")
  assert.equal(result.name, "")
  assert.ok(result.warnings.length >= 2)
})
