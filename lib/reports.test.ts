import assert from "node:assert/strict"
import test from "node:test"

import { buildResult, canAccessReport, nextRunDate, reportById, reportCatalog, resolvePeriod, toCsv, validateSavedReport, type SavedReportInput } from "./reports.ts"

test("catálogo: ids únicos, ordenação e agrupamentos referem colunas existentes", () => {
  assert.equal(new Set(reportCatalog.map((item) => item.id)).size, reportCatalog.length)
  for (const def of reportCatalog) {
    const keys = new Set(def.columns.map((column) => column.key))
    assert.ok(keys.has(def.sort.key), `${def.id}: ordenação ${def.sort.key}`)
    def.groupBy.forEach((key) => assert.ok(keys.has(key), `${def.id}: agrupamento ${key}`))
    def.filters.forEach((filter) => !filter.column || assert.ok(keys.has(filter.column), `${def.id}: filtro ${filter.key}`))
    assert.ok(def.columns.some((column) => !column.hidden), `${def.id}: sem colunas visíveis`)
  }
  // as 8 áreas pedidas
  assert.deepEqual([...new Set(reportCatalog.map((item) => item.module))].sort(), ["comercial", "contratos", "estoque", "financeiro", "frota", "orcamentos", "os", "produtos"])
})

test("permissões: administrador vê tudo; demais precisam de relatórios e do módulo", () => {
  assert.equal(canAccessReport({ role: "admin", permissions: [] }, "financeiro"), true)
  assert.equal(canAccessReport({ role: "user", permissions: ["relatorios", "financeiro"] }, "financeiro"), true)
  assert.equal(canAccessReport({ role: "user", permissions: ["relatorios", "financeiro"] }, "estoque"), false)
  assert.equal(canAccessReport({ role: "user", permissions: ["financeiro"] }, "financeiro"), false)
  assert.equal(canAccessReport({ role: "user", permissions: ["relatorios", "produtos_servicos"] }, "produtos"), true)
})

test("períodos relativos", () => {
  assert.deepEqual(resolvePeriod("Mês atual", "2026-10-12"), { start: "2026-10-01", end: "2026-10-31" })
  assert.deepEqual(resolvePeriod("Mês anterior", "2026-01-15"), { start: "2025-12-01", end: "2025-12-31" })
  assert.deepEqual(resolvePeriod("Trimestre atual", "2026-11-02"), { start: "2026-10-01", end: "2026-12-31" })
  assert.deepEqual(resolvePeriod("Últimos 30 dias", "2026-10-30"), { start: "2026-10-01", end: "2026-10-30" })
  assert.deepEqual(resolvePeriod("Personalizado", "2026-10-12", { start: "2026-03-01", end: "2026-03-15" }), { start: "2026-03-01", end: "2026-03-15" })
})

const rows = [
  { dueDate: "2026-10-05", supplier: "Aço Forte", category: "Material", amount: 1000, paid: 1000, open: 0, status: "Paga", month: "10/2026" },
  { dueDate: "2026-10-20", supplier: "Aço Forte", category: "Material", amount: 500, paid: 0, open: 500, status: "Aberta", month: "10/2026" },
  { dueDate: "2026-10-10", supplier: "Pneus & Cia", category: "Peças", amount: 300, paid: 0, open: 300, status: "Vencida", month: "10/2026" },
]

test("filtros, ordenação, agrupamento e totais", () => {
  const def = reportById("fin_pagar")!
  const all = buildResult(def, rows)
  assert.equal(all.rowCount, 3)
  assert.deepEqual(all.groups[0].rows.map((row) => row.dueDate), ["2026-10-05", "2026-10-10", "2026-10-20"])
  assert.deepEqual([all.totals.amount, all.totals.paid, all.totals.open], [1800, 1000, 800])
  assert.equal(all.columns.some((column) => column.key === "month"), false)

  assert.equal(buildResult(def, rows, { filters: { status: "Vencida" } }).rowCount, 1)
  assert.equal(buildResult(def, rows, { filters: { party: "aco" } }).rowCount, 2) // sem acento e sem caixa

  const grouped = buildResult(def, rows, { groupBy: "supplier", sortKey: "amount", sortDir: "desc" })
  assert.deepEqual(grouped.groups.map((group) => [group.label, group.subtotals.amount]), [["Aço Forte", 1500], ["Pneus & Cia", 300]])
  assert.deepEqual(grouped.groups[0].rows.map((row) => row.amount), [1000, 500])
  // agrupamento inválido é ignorado
  assert.equal(buildResult(def, rows, { groupBy: "nao_existe" }).grouped, false)

  const columns = buildResult(def, rows, { columns: ["supplier", "amount"] })
  assert.deepEqual(columns.columns.map((column) => column.key), ["supplier", "amount"])
  assert.deepEqual(buildResult(def, rows, { showTotals: false }).totals, {})
})

test("totais derivados (margem %)", () => {
  const def = reportById("prod_vendas")!
  const result = buildResult(def, [
    { item: "Eixo", type: "Produto", quantity: 2, revenue: 2000, cost: 1200, margin: 800, marginPct: 40, quotes: 1 },
    { item: "Montagem", type: "Serviço", quantity: 1, revenue: 450, cost: 200, margin: 250, marginPct: 55.56, quotes: 1 },
  ])
  assert.equal(result.totals.revenue, 2450)
  assert.equal(result.totals.marginPct, 42.86)
  assert.equal(buildResult(def, [{ item: "Eixo", type: "Produto", quantity: 1, revenue: 100, cost: 50, margin: 50, marginPct: 50, quotes: 1 }], { filters: { type: "Serviço" } }).rowCount, 0)
})

test("CSV: separador, decimal, datas e totais", () => {
  const def = reportById("fin_pagar")!
  const csv = toCsv(buildResult(def, rows.slice(0, 1)), { title: "Contas a pagar", periodLabel: "01/10/2026 a 31/10/2026", filtersText: "" })
  const lines = csv.replace("﻿", "").split("\r\n")
  assert.equal(lines[0], "Contas a pagar")
  assert.ok(lines.includes("Vencimento;Fornecedor;Descrição;Categoria;Documento;Parcela;Valor;Pago;Em aberto;Situação;Origem"))
  assert.ok(lines.some((line) => line.startsWith("05/10/2026;Aço Forte;") && line.includes(";1000;1000;0;Paga")))
  assert.ok(lines.some((line) => line.startsWith("TOTAL;")))
})

test("agendamento: próxima geração", () => {
  assert.equal(nextRunDate({ frequency: "Diária" }, "2026-10-12"), "2026-10-13")
  assert.equal(nextRunDate({ frequency: "Semanal", weekday: 1 }, "2026-10-12"), "2026-10-19") // 12/10/2026 é segunda
  assert.equal(nextRunDate({ frequency: "Semanal", weekday: 3 }, "2026-10-12"), "2026-10-14")
  assert.equal(nextRunDate({ frequency: "Mensal", day: 5 }, "2026-10-12"), "2026-11-05")
  assert.equal(nextRunDate({ frequency: "Mensal", day: 20 }, "2026-10-12"), "2026-10-20")
  assert.equal(nextRunDate({ frequency: "Mensal", day: 31 }, "2026-02-01"), "2026-02-28")
  assert.equal(nextRunDate({ frequency: "Sob demanda" }, "2026-10-12"), "")
})

const saved: SavedReportInput = { name: "Pagar do mês", module: "financeiro", reportId: "fin_pagar", periodKind: "Mês anterior", format: "Excel", authorizedUserIds: ["u1"], frequency: "Mensal", day: 5 }

test("relatório salvo: validações", () => {
  assert.equal(validateSavedReport(saved), "")
  assert.match(validateSavedReport({ ...saved, name: "" }), /nome/)
  assert.match(validateSavedReport({ ...saved, module: "estoque" }), /não pertence/)
  assert.match(validateSavedReport({ ...saved, authorizedUserIds: [] }), /usuário autorizado/)
  assert.match(validateSavedReport({ ...saved, format: "Word" }), /formato/)
  assert.match(validateSavedReport({ ...saved, periodKind: "Personalizado", startDate: "2026-01-01", endDate: "2026-01-31" }), /período relativo/)
  assert.match(validateSavedReport({ ...saved, periodKind: "Personalizado", frequency: "Sob demanda" }), /datas/)
  assert.match(validateSavedReport({ ...saved, day: 0 }), /dia do mês/)
})
