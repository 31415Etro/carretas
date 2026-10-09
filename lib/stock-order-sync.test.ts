import assert from "node:assert/strict"
import test from "node:test"
import { backfillStockOrders } from "./stock-order-sync.ts"

test("restores missing labels without changing existing production state", async () => {
  const existing = [{ id: "saved", budget_point_id: "point-0", status: "Usada", has_welding: true }]
  const before = structuredClone(existing[0])
  const points = Array.from({ length: 760 }, (_, index) => ({
    id: `point-${index}`, name: `Point ${index}`, kit_id: "kit", kit_name: "", kit: { name: "Kit name" },
    infrastructure_measure: "5m", environment: { name: "Environment", final: { name: "Final", floor: {
      name: "Floor", tower: { name: "Tower", work: { id: "work", name: "Work" } },
    } } },
  }))
  const batches: number[] = []
  const db = { from(table: string) {
    return {
      select() { return this }, order() { return this },
      async range(from: number, to: number) {
        return { data: (table === "stock_service_orders" ? existing : points).slice(from, to + 1), error: null }
      },
      async upsert(rows: any[], options: any) {
        assert.equal(options.ignoreDuplicates, true)
        assert.equal(options.onConflict, "budget_point_id")
        batches.push(rows.length)
        existing.push(...rows.map((row) => ({ id: row.budget_point_id, status: "Aberto", ...row })))
        return { error: null }
      },
    }
  } }
  assert.equal(await backfillStockOrders(db), 759)
  assert.equal(await backfillStockOrders(db), 0)
  assert.equal(existing.length, 760)
  assert.deepEqual(existing[0], before)
  assert.ok(batches.every((size) => size <= 200))
  assert.equal((existing[1] as any).kit_name, "Kit name")
})
