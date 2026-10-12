import assert from "node:assert/strict"
import test from "node:test"

import { redact } from "./audit-redact.ts"

test("remove segredos e mascara documentos", () => {
  const value = redact({ name: "Silva", password: "x", api_key: "abc", webhook_token: "t", signature_data: "data:image/png;base64,AAAA", document: "11.222.333/0001-81", owner_document: "52998224725", sale_price: 100, updated_at: "2026-10-12" }) as Record<string, unknown>
  assert.deepEqual(Object.keys(value).sort(), ["document", "name", "owner_document", "sale_price"])
  assert.equal(value.document, "••••1-81")
  assert.equal(value.owner_document, "••••4725")
  assert.equal(value.sale_price, 100)
})

test("limita texto longo, arquivos e estruturas profundas", () => {
  const long = "a".repeat(800)
  const value = redact({ notes: long, file: "data:application/pdf;base64,JVBERi0", nested: { a: { b: { c: { d: 1 } } } }, list: [1, 2, 3] }) as any
  assert.equal(value.notes.length, 501)
  assert.equal(value.file, "[arquivo]")
  assert.equal(value.nested.a.b.c, "[dados extensos]")
  assert.deepEqual(value.list, [1, 2, 3])
  assert.equal(redact(null), null)
})
