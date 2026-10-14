import assert from "node:assert/strict"
import test from "node:test"
import { descriptionSimilarity, findCandidates, isReconcilable, reconciledNotes, statementKeyFromNotes, suggestPairs, type TxLike } from "./bank-reconciliation.ts"

const manual = (over: Partial<TxLike>): TxLike => ({ id: "m1", type: "Saida", description: "Pagamento Papelaria Papeis e Papeis", supplierName: "PAPEIS E PAPEIS", realizedDate: "2026-10-12", realizedAmount: 36.9, expectedAmount: 0, status: "Realizado", origin: "Manual", notes: "", ...over })

test("mesmo valor, data próxima e nome parecido: confiança alta", () => {
  const found = findCandidates({ type: "Saida", date: "2026-10-13", amount: 36.9, description: "COMPRA PAPEIS E PAPEIS LTDA" }, [manual({})])
  assert.equal(found.length, 1)
  assert.equal(found[0].level, "Alta")
})

test("valor diferente nunca é candidato; tipo diferente também não", () => {
  assert.equal(findCandidates({ type: "Saida", date: "2026-10-12", amount: 36.91, description: "PAPEIS" }, [manual({})]).length, 0)
  assert.equal(findCandidates({ type: "Entrada", date: "2026-10-12", amount: 36.9, description: "PAPEIS" }, [manual({})]).length, 0)
})

test("data distante vira confiança média/baixa e não é pré-selecionada", () => {
  assert.equal(findCandidates({ type: "Saida", date: "2026-10-25", amount: 36.9, description: "OUTRA COISA" }, [manual({})])[0].level, "Media")
  assert.equal(findCandidates({ type: "Saida", date: "2026-12-25", amount: 36.9, description: "OUTRA COISA" }, [manual({})])[0].level, "Baixa")
})

test("o que veio do extrato, de cartão ou já conciliado não é candidato", () => {
  assert.equal(isReconcilable(manual({ origin: "Extrato bancario" })), false)
  assert.equal(isReconcilable(manual({ origin: "Cartao de credito" })), false)
  assert.equal(isReconcilable(manual({ notes: "Chave do extrato: abc123" })), false)
  assert.equal(isReconcilable(manual({ status: "Cancelado" })), false)
  assert.equal(isReconcilable(manual({})), true)
})

test("sugestões não repetem lançamento: dois extratos de 36,90 e um só manual", () => {
  const pairs = suggestPairs([
    { id: "s1", type: "Saida", date: "2026-10-12", amount: 36.9, description: "PAPEIS E PAPEIS" },
    { id: "s2", type: "Saida", date: "2026-10-20", amount: 36.9, description: "PAPEIS E PAPEIS" },
  ], [manual({})], "Media")
  assert.equal(pairs.length, 1)
  assert.equal(pairs[0].statementId, "s1")
})

test("semelhança de nomes e observações da conciliação", () => {
  assert.ok(descriptionSimilarity("PIX ANDRACO LTDA", "Andraço pagamento") >= 0.5)
  assert.equal(descriptionSimilarity("", "x"), 0)
  assert.equal(statementKeyFromNotes("a\nChave do extrato: k-1\nb"), "k-1")
  const notes = reconciledNotes("Compra de papel", "Chave do extrato: k-1\nBanco: Sicoob", "2026-10-14")
  assert.match(notes, /Compra de papel/)
  assert.match(notes, /Chave do extrato: k-1/)
  assert.match(notes, /Conciliado com o extrato em 14\/10\/2026/)
})
