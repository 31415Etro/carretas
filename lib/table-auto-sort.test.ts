import assert from "node:assert/strict"
import test from "node:test"
import { isActionHeader, parseDate, parseNumber, sortRows } from "./table-auto-sort.ts"

const rows = (...cells: string[][]) => cells
const col = (data: string[][], index: number, dir: "asc" | "desc") => sortRows(data, (row) => row, index, dir).map((row) => row[index])

test("números em formato brasileiro", () => {
  assert.equal(parseNumber("R$ 1.234,56"), 1234.56)
  assert.equal(parseNumber("12,5%"), 12.5)
  assert.equal(parseNumber("1.234"), 1234)
  assert.equal(parseNumber("-3"), -3)
  assert.equal(parseNumber("PRD-001"), null)
  assert.equal(parseNumber("12/03/2026"), null)
})

test("datas dd/mm/aaaa e aaaa-mm-dd", () => {
  assert.ok((parseDate("02/10/2026") as number) > (parseDate("30/09/2026") as number))
  assert.equal(parseDate("2026-10-02"), parseDate("02/10/2026"))
  assert.equal(parseDate("abc"), null)
})

test("ordena por valor monetário (não por texto), por data e por nome, com vazios no fim", () => {
  const data = rows(["B", "R$ 1.000,00", "02/10/2026"], ["A", "R$ 90,00", "30/09/2026"], ["C", "-", "-"], ["D", "R$ 10.000,00", "01/01/2027"])
  assert.deepEqual(col(data, 1, "asc"), ["R$ 90,00", "R$ 1.000,00", "R$ 10.000,00", "-"])
  assert.deepEqual(col(data, 1, "desc"), ["R$ 10.000,00", "R$ 1.000,00", "R$ 90,00", "-"])
  assert.deepEqual(col(data, 2, "asc"), ["30/09/2026", "02/10/2026", "01/01/2027", "-"])
  assert.deepEqual(col(data, 0, "desc"), ["D", "C", "B", "A"])
})

test("texto com número dentro ordena em ordem natural", () => {
  assert.deepEqual(col(rows(["NF 10"], ["NF 9"], ["NF 100"]), 0, "asc"), ["NF 9", "NF 10", "NF 100"])
})

test("colunas de ação não ordenam", () => {
  for (const header of ["Ações", "Acoes", "", "Detalhes"]) assert.equal(isActionHeader(header), true, header)
  assert.equal(isActionHeader("Valor"), false)
})
