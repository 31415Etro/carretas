import assert from "node:assert/strict"
import test from "node:test"

import { buildDashboard, type DashboardData } from "./dashboard-erp.ts"

const filters = { start: "2026-10-01", end: "2026-10-31", today: "2026-10-15" }

function data(patch: Partial<DashboardData> = {}): DashboardData {
  return {
    receivables: [], payables: [], transactions: [], materials: [], movements: [], orders: [], orderStarts: {},
    vehicles: [], maintenance: [], leads: [], contracts: [],
    names: { clients: { c1: "Cliente A" }, providers: {}, vehicles: { v1: "ABC1D23 - Carreta" } },
    ...patch,
  }
}

const value = (result: ReturnType<typeof buildDashboard>, section: string, key: string) =>
  (result.sections as any)[section].indicators.find((item: any) => item.key === key).value

test("financeiro: faturamento, vencidas e lucro bruto", () => {
  const result = buildDashboard(data({
    receivables: [
      { id: "r1", client_id: "c1", competence_date: "2026-10-05", due_date: "2026-10-10", expected_amount: 1000, received_amount: 0, status: "Aberta" },
      { id: "r2", client_id: "c1", competence_date: "2026-09-05", due_date: "2026-11-10", expected_amount: 500, received_amount: 500, status: "Recebida" },
      { id: "r3", client_id: "c1", competence_date: "2026-10-06", due_date: "2026-10-30", expected_amount: 300, received_amount: 0, status: "Cancelada" },
    ],
    movements: [{ material_id: "m1", movement_type: "Consumo em OS", quantity: 2, total_cost: 400, occurred_at: "2026-10-07T10:00:00Z" }],
  }), filters)
  assert.equal(value(result, "financeiro", "fin.faturamento"), 1000)
  assert.equal(value(result, "financeiro", "fin.receber"), 1000)
  assert.equal(value(result, "financeiro", "fin.vencidas_receber"), 1000)
  assert.equal(value(result, "financeiro", "fin.lucro"), 600)
  assert.equal(result.details["fin.vencidas_receber"].rows.length, 1)
})

test("filtro por centro de custo", () => {
  const result = buildDashboard(data({
    receivables: [
      { id: "r1", competence_date: "2026-10-05", due_date: "2026-10-20", expected_amount: 1000, received_amount: 0, status: "Aberta", cost_center_id: "cc1" },
      { id: "r2", competence_date: "2026-10-05", due_date: "2026-10-20", expected_amount: 200, received_amount: 0, status: "Aberta", cost_center_id: "cc2" },
    ],
  }), { ...filters, costCenterId: "cc2" })
  assert.equal(value(result, "financeiro", "fin.faturamento"), 200)
})

test("OS: abertas, atrasadas, concluídas, ticket e tempo médio", () => {
  const result = buildDashboard(data({
    orders: [
      { id: "o1", order_number: "OS-1", status: "Agendada", scheduled_date: "2026-10-10", total_amount: 0 },
      { id: "o2", order_number: "OS-2", status: "Em execucao", scheduled_date: "2026-10-20", total_amount: 0 },
      { id: "o3", order_number: "OS-3", status: "Finalizada", scheduled_date: "2026-10-02", created_at: "2026-10-01T08:00:00Z", finished_at: "2026-10-02T12:00:00Z", total_amount: 900 },
      { id: "o4", order_number: "OS-4", status: "Finalizada", scheduled_date: "2026-10-03", created_at: "2026-10-01T08:00:00Z", finished_at: "2026-10-03T10:00:00Z", total_amount: 100 },
    ],
    orderStarts: { o4: "2026-10-03T08:00:00Z" },
  }), filters)
  assert.equal(value(result, "os", "os.abertas"), 1)
  assert.equal(value(result, "os", "os.execucao"), 1)
  assert.equal(value(result, "os", "os.atrasadas"), 1)
  assert.equal(value(result, "os", "os.concluidas"), 2)
  assert.equal(value(result, "os", "os.ticket"), 500)
  assert.equal(value(result, "os", "os.tempo"), 15)
})

test("estoque e frota", () => {
  const result = buildDashboard(data({
    materials: [
      { id: "m1", name: "Eixo", current_stock: 4, reserved_stock: 2, average_cost: 100, minimum_stock: 3, reorder_point: 0, status: "Ativo" },
      { id: "m2", name: "Pneu", current_stock: 10, reserved_stock: 0, average_cost: 50, minimum_stock: 2, reorder_point: 4, status: "Ativo" },
    ],
    vehicles: [
      { id: "v1", plate: "ABC1D23", status: "Disponivel", licensing_due_date: "2026-11-01" },
      { id: "v2", plate: "XYZ9K87", status: "Em manutencao" },
      { id: "v3", plate: "OLD0A00", status: "Inativo" },
    ],
    maintenance: [{ vehicle_id: "v1", type: "Freios", cost: 800, start_date: "2026-10-05", status: "Realizada" }],
  }), filters)
  assert.equal(value(result, "estoque", "est.valor"), 900)
  assert.equal(value(result, "estoque", "est.minimo"), 1)
  assert.equal(value(result, "frota", "frota.ativos"), 2)
  assert.equal(value(result, "frota", "frota.disponibilidade"), 50)
  assert.equal(value(result, "frota", "frota.custos"), 800)
  assert.equal(value(result, "frota", "frota.vencimentos"), 1)
})
