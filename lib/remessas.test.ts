import assert from "node:assert/strict"
import test from "node:test"
import { REMESSA_CFOPS, cfopLabel, isRemessaInvoice, onlyRemessas, remessaCfop, withoutRemessas } from "./remessas.ts"

test("remessa é a nota com item de CFOP 5912 ou 6912", () => {
  assert.equal(isRemessaInvoice([{ cfop: "6912" }]), true)
  assert.equal(isRemessaInvoice([{ cfop: "5.912" }]), true)
  assert.equal(isRemessaInvoice([{ cfop: "6101" }, { cfop: "5912" }]), true)
  assert.equal(isRemessaInvoice([{ cfop: "6101" }, { cfop: "5102" }]), false)
  assert.equal(isRemessaInvoice([]), false)
  assert.equal(isRemessaInvoice(null), false)
  assert.equal(remessaCfop([{ cfop: "6101" }, { cfop: "5912" }]), "5912")
  assert.equal(cfopLabel("6912"), "6912 · Remessa para demonstração (outro estado)")
  assert.equal(isRemessaInvoice([{ cfop: "6901" }]), true) // remessa para industrialização
  assert.equal(isRemessaInvoice([{ cfop: "6925" }]), true) // retorno
  assert.equal(isRemessaInvoice([{ cfop: "6124" }]), false) // industrialização efetuada para outra empresa é serviço vendido
})

test("filtros do banco: sem remessas (não contém) e só remessas (contém um dos CFOP)", () => {
  const calls: string[] = []
  const query = { not(column: string, operator: string, value: string) { calls.push(`${column} ${operator} ${value}`); return query }, or(filters: string) { calls.push(filters); return query } }
  withoutRemessas(query)
  assert.equal(calls.length, REMESSA_CFOPS.length)
  assert.ok(calls.includes('data->items cs [{"cfop":"5912"}]') && calls.includes('data->items cs [{"cfop":"6901"}]'))
  calls.length = 0
  onlyRemessas(query)
  assert.equal(calls.length, 1)
  assert.ok(calls[0].startsWith('data->items.cs.[{"cfop":"5901"}],') && calls[0].includes('data->items.cs.[{"cfop":"6925"}]'))
})
