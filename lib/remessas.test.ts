import assert from "node:assert/strict"
import test from "node:test"
import { cfopLabel, isRemessaInvoice, onlyRemessas, remessaCfop, withoutRemessas } from "./remessas.ts"

test("remessa é a nota com item de CFOP 5912 ou 6912", () => {
  assert.equal(isRemessaInvoice([{ cfop: "6912" }]), true)
  assert.equal(isRemessaInvoice([{ cfop: "5.912" }]), true)
  assert.equal(isRemessaInvoice([{ cfop: "6101" }, { cfop: "5912" }]), true)
  assert.equal(isRemessaInvoice([{ cfop: "6101" }, { cfop: "5102" }]), false)
  assert.equal(isRemessaInvoice([]), false)
  assert.equal(isRemessaInvoice(null), false)
  assert.equal(remessaCfop([{ cfop: "6101" }, { cfop: "5912" }]), "5912")
  assert.equal(cfopLabel("6912"), "6912 · outro estado")
})

test("filtros do banco: sem remessas (não contém) e só remessas (contém um dos CFOP)", () => {
  const calls: string[] = []
  const query = { not(column: string, operator: string, value: string) { calls.push(`${column} ${operator} ${value}`); return query }, or(filters: string) { calls.push(filters); return query } }
  withoutRemessas(query)
  assert.deepEqual(calls, ['data->items cs [{"cfop":"5912"}]', 'data->items cs [{"cfop":"6912"}]'])
  calls.length = 0
  onlyRemessas(query)
  assert.deepEqual(calls, ['data->items.cs.[{"cfop":"5912"}],data->items.cs.[{"cfop":"6912"}]'])
})
