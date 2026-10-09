import assert from "node:assert/strict"
import test from "node:test"

import { sortServiceOrdersByNewestCreation, sortServiceOrdersByNewestScheduledDate } from "./field-service-order-sort.ts"

test("ordena as OS da criação mais recente para a mais antiga", () => {
  const orders = [
    { id: "os-antiga", createdAt: "2026-08-10T12:00:00.000Z" },
    { id: "os-recente", createdAt: "2026-08-19T15:30:00.000Z" },
    { id: "os-intermediaria", createdAt: "2026-08-15T09:00:00.000Z" },
  ]

  const sorted = sortServiceOrdersByNewestCreation(orders)

  assert.deepEqual(sorted.map((order) => order.id), ["os-recente", "os-intermediaria", "os-antiga"])
  assert.deepEqual(orders.map((order) => order.id), ["os-antiga", "os-recente", "os-intermediaria"])
})

test("mantém OS sem data válida no final da lista", () => {
  const orders = [
    { id: "os-sem-data", createdAt: "" },
    { id: "os-recente", createdAt: "2026-08-19T15:30:00.000Z" },
    { id: "os-antiga", createdAt: "2026-08-10T12:00:00.000Z" },
  ]

  const sorted = sortServiceOrdersByNewestCreation(orders)

  assert.deepEqual(sorted.map((order) => order.id), ["os-recente", "os-antiga", "os-sem-data"])
})

test("ordena a tabela pela data agendada mais recente em formatos ISO e brasileiro", () => {
  const orders = [
    { id: "julho", scheduledDate: "31/07/2026", createdAt: "2026-07-01T10:00:00.000Z" },
    { id: "setembro", scheduledDate: "2026-09-02", createdAt: "2026-08-01T10:00:00.000Z" },
    { id: "agosto", scheduledDate: "15/08/2026", createdAt: "2026-08-01T10:00:00.000Z" },
    { id: "sem-data", scheduledDate: "", createdAt: "2026-09-01T10:00:00.000Z" },
  ]

  const sorted = sortServiceOrdersByNewestScheduledDate(orders)

  assert.deepEqual(sorted.map((order) => order.id), ["setembro", "agosto", "julho", "sem-data"])
  assert.deepEqual(orders.map((order) => order.id), ["julho", "setembro", "agosto", "sem-data"])
})

test("usa a criação mais recente para desempatar OS da mesma data", () => {
  const orders = [
    { id: "primeira", scheduledDate: "2026-08-31", createdAt: "2026-08-01T10:00:00.000Z" },
    { id: "segunda", scheduledDate: "31/08/2026", createdAt: "2026-08-02T10:00:00.000Z" },
  ]

  assert.deepEqual(sortServiceOrdersByNewestScheduledDate(orders).map((order) => order.id), ["segunda", "primeira"])
})
