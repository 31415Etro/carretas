const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { randomUUID } = require("node:crypto")
const ts = require("typescript")

function loadModule(filename, overrides = {}, cache = new Map()) {
  filename = path.resolve(filename)
  if (cache.has(filename)) return cache.get(filename).exports
  const module = { exports: {} }
  cache.set(filename, module)
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const localRequire = (name) => {
    if (Object.hasOwn(overrides, name)) return overrides[name]
    if (name.startsWith("@/") || name.startsWith(".")) {
      let target = name.startsWith("@/") ? path.resolve(name.slice(2)) : path.resolve(path.dirname(filename), name)
      if (!path.extname(target)) target += ".ts"
      return loadModule(target, overrides, cache)
    }
    return require(name)
  }
  new Function("require", "module", "exports", source)(localRequire, module, module.exports)
  return module.exports
}

async function main() {
  const { readAllPages } = loadModule("lib/supabase-pagination.ts")
  const values = Array.from({ length: 1356 }, (_, id) => ({ id }))
  assert.equal((await readAllPages(async (from, to) => ({ data: values.slice(from, to + 1), error: null }))).length, 1356)
  await assert.rejects(readAllPages(async () => ({ data: null, error: { message: "network failure" } })), /network failure/)
  const { operationalChanges } = loadModule("lib/operational-changes.ts")
  const { defaultOperationalState } = loadModule("lib/operational-storage.ts")
  const state = defaultOperationalState()
  const next = { ...state, clientEquipment: [{ id: randomUUID(), name: "Test" }] }
  assert.deepEqual(Object.keys(operationalChanges(state, next)), ["clientEquipment"])
  assert.deepEqual(operationalChanges(state, { ...state, clients: state.clients.map((row) => ({ ...row })) }), {})
  console.log("PASS: pagination, failures, delta payload, unchanged rows")
  if (!process.argv.includes("--live")) return
  process.loadEnvFile(".env.local")
  const { createClient } = require("@supabase/supabase-js")
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const { data: profile, error } = await db.from("profiles").select("id").eq("role", "admin").limit(1).single()
  if (error) throw error
  const overrides = {
    "next/server": { NextResponse: { json: (body, options) => Response.json(body, options) } },
    "@/lib/supabase/server": { createAdminClient: () => db, createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: profile.id } } }) } }) },
    "@/lib/server-authorization": { currentUserRole: async () => ({ user: { id: profile.id }, role: "admin" }) },
  }
  const route = loadModule("app/api/operational-state/route.ts", overrides)
  const response = await route.GET(new Request("http://localhost/api/operational-state"))
  const text = await response.text()
  assert.equal(response.status, 200, text.slice(0, 500))
  const loaded = JSON.parse(text).state
  console.log("PASS: database read", JSON.stringify({ bytes: Buffer.byteLength(text), equipment: loaded.clientEquipment.length, plans: loaded.pmocPlans.length }))
  const { operationalSections, operationalStateSection } = loadModule("lib/operational-state-sections.ts")
  for (const section of operationalSections) {
    const bytes = Buffer.byteLength(JSON.stringify({ state: operationalStateSection(loaded, section) }))
    assert.ok(bytes < 4_000_000, `${section} response is too large: ${bytes}`)
    console.log(`PASS: ${section} response ${bytes} bytes`)
  }
  const ids = Object.fromEntries(["client", "work", "environment", "equipment", "plan", "sector", "pmocEquipment", "link", "order", "schedule"].map((key) => [key, randomUUID()]))
  const client = loaded.clients.find((item) => loaded.works.some((work) => work.clientId === item.id))
  const work = loaded.works.find((item) => item.clientId === client.id)
  const service = loaded.serviceTypes[0]
  const post = (url, body, method = "POST") => new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  try {
    const clientResult = await route.PATCH(post("/api/operational-state", { changes: { clients: [{ ...client, id: ids.client, name: "VERIFY TEMP CLIENT", document: ids.client }] } }, "PATCH"))
    assert.equal(clientResult.status, 200, await clientResult.text())
    const envRoute = loadModule("app/api/client-environments/route.ts", overrides)
    const env = await envRoute.POST(post("/api/client-environments", { environment: { id: ids.environment, clientId: client.id, name: "VERIFY TEMP ENVIRONMENT" } }))
    assert.equal(env.status, 200, await env.text())
    const equipmentRoute = loadModule("app/api/client-equipment/route.ts", overrides)
    const equipment = { id: ids.equipment, clientId: client.id, clientEnvironmentId: ids.environment, name: "VERIFY TEMP EQUIPMENT", status: "Ativo" }
    for (let i = 0; i < 2; i++) {
      const result = await equipmentRoute.POST(post("/api/client-equipment", { equipment }))
      assert.equal(result.status, 200, await result.text())
    }
    const bad = await equipmentRoute.POST(post("/api/client-equipment", { equipment: { ...equipment, clientId: randomUUID() } }))
    assert.equal(bad.status, 400)
    console.log("PASS: environment, equipment, retry without duplicate, client/environment validation")
    const changes = {
      works: [{ ...work, id: ids.work, name: "VERIFY TEMP PMOC WORK", type: "PMOC" }],
      pmocPlans: [{ id: ids.plan, clientId: client.id, workId: ids.work, name: "VERIFY TEMP PMOC", frequency: "Mensal", startMonth: 9, startYear: 2026, startDate: "2026-09-01", endDate: "2026-12-31", scheduleDay: 10, status: "Ativo", notes: "" }],
      pmocSectors: [{ id: ids.sector, planId: ids.plan, name: "VERIFY TEMP", floor: "", status: "Ativo", notes: "" }],
      pmocEquipment: [{ ...equipment, id: ids.pmocEquipment, planId: ids.plan, sectorId: ids.sector, clientEquipmentId: ids.equipment }],
      pmocEquipmentServices: [{ id: ids.link, planId: ids.plan, equipmentId: ids.pmocEquipment, serviceTypeId: service.id }],
      serviceOrders: [{ ...state.serviceOrders[0], id: ids.order, orderNumber: `VERIFY-${ids.order.slice(0, 8)}`, orderType: "pmoc", clientId: client.id, workId: ids.work, clientEnvironmentId: ids.environment, clientEquipmentId: ids.equipment, floorId: "", environmentId: "", pointId: "", mainProviderId: "", helperProviderId: "", supervisorId: "", vehicleId: "", serviceTypeId: service.id, status: "Agendada", totalAmount: 0 }],
      pmocSchedules: [{ id: ids.schedule, planId: ids.plan, equipmentId: ids.pmocEquipment, serviceTypeId: service.id, month: 9, year: 2026, scheduledDate: "2026-09-10", serviceOrderId: ids.order, status: "OS aberta" }],
    }
    for (let i = 0; i < 2; i++) {
      const result = await route.PATCH(post("/api/operational-state", { changes }, "PATCH"))
      assert.equal(result.status, 200, await result.text())
    }
    const saved = await db.from("pmoc_schedules").select("service_order_id").eq("id", ids.schedule).single()
    assert.equal(saved.data?.service_order_id, ids.order)
    console.log("PASS: PMOC, equipment, services, OS, schedule linkage and idempotent retry")
  } finally {
    for (const [table, id] of [["pmoc_plans", ids.plan], ["service_orders", ids.order], ["client_equipment", ids.equipment], ["client_environments", ids.environment], ["works", ids.work], ["clients", ids.client]]) {
      const result = await db.from(table).delete().eq("id", id)
      if (result.error) throw new Error(`Cleanup ${table}: ${result.error.message}`)
    }
    console.log("Temporary test records removed")
  }
  if (process.argv.includes("--repair-labels")) {
    const { backfillStockOrders } = loadModule("lib/stock-order-sync.ts")
    const count = await backfillStockOrders(db)
    assert.equal(await backfillStockOrders(db), 0)
    console.log(`PASS: ${count} missing labels restored; repeated synchronization inserted none`)
  }
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1 })
module.exports = { loadModule }
