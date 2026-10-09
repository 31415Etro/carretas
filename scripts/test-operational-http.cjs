const assert = require("node:assert/strict")
const { randomUUID } = require("node:crypto")
const { createClient } = require("@supabase/supabase-js")
const { loadModule } = require("./verify-operational-flows.cjs")

process.loadEnvFile(".env.local")
const base = process.env.TEST_BASE_URL || "http://localhost:3003"
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const ids = Object.fromEntries(["client", "environment", "equipment", "work", "plan", "sector", "pmocEquipment", "link", "order", "schedule", "budgetWork", "tower", "floor", "final", "budgetEnvironment", "point"].map((name) => [name, randomUUID()]))
let actor = ""
let cookie = ""
let checks = 0
async function request(path, method = "GET", body, authenticated = true) {
  return fetch(base + path, {
    method, redirect: "manual", signal: AbortSignal.timeout(180000),
    headers: { "content-type": "application/json", ...(authenticated ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
async function check(response, status, label) {
  const text = await response.text()
  assert.equal(response.status, status, `${label}: ${text.slice(0, 300)}`)
  console.log(`PASS: ${label} (${status})`)
  checks++
  try { return JSON.parse(text) } catch { return text }
}
async function main() {
  try {
    for (const path of ["/pmoc", "/clientes-obras", "/estoque", "/ordens-servico"]) {
      const result = await request(path, "GET", undefined, false)
      assert.ok([307, 308].includes(result.status))
      assert.match(result.headers.get("location"), /login/)
      console.log(`PASS: ${path} requires login`)
      checks++
    }
    for (const path of ["/api/client-equipment", "/api/client-environments"]) {
      await check(await request(path, "POST", {}, false), 401, `${path} anonymous write rejected`)
    }
    await check(await request("/api/operational-state", "PATCH", { changes: {} }, false), 401, "PMOC anonymous write rejected")
    await check(await request("/api/estoque/stock-orders", "GET", undefined, false), 401, "Stock anonymous read rejected")
    const email = `verify-operational-${randomUUID()}@example.com`
    const password = `Test!${randomUUID()}`
    const created = await db.auth.admin.createUser({ email, password, email_confirm: true })
    if (created.error) throw created.error
    actor = created.data.user.id
    const profile = await db.from("profiles").upsert({ id: actor, email, full_name: "VERIFY TEMP OPERATIONAL", role: "admin", active: true })
    if (profile.error) throw profile.error
    const login = await request("/api/auth/login", "POST", { email, password }, false)
    cookie = login.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ")
    await check(login, 200, "Real login")
    assert.ok(cookie)
    for (const path of ["/pmoc", "/clientes-obras", "/estoque", "/ordens-servico"]) {
      const html = await check(await request(path), 200, `${path} authenticated HTML`)
      assert.equal(typeof html, "string")
      assert.doesNotMatch(html, /"digest":"\d+"/)
    }
    const state = {}
    for (const section of ["registry", "pmoc", "execution"]) {
      const payload = await check(await request(`/api/operational-state?section=${section}`), 200, `${section} authenticated data`)
      const bytes = Buffer.byteLength(JSON.stringify(payload))
      assert.ok(bytes < 4_000_000, `${section} too large: ${bytes}`)
      Object.assign(state, payload.state)
    }
    const equipmentCount = await db.from("client_equipment").select("id", { count: "exact", head: true })
    assert.equal(state.clientEquipment.length, equipmentCount.count)
    const stock = await check(await request("/api/estoque/stock-orders"), 200, "All stock labels")
    assert.equal(new Set(stock.orders.map((row) => row.budget_point_id)).size, stock.orders.length)
    console.log(`DATA: ${state.clientEquipment.length} equipment; ${stock.orders.length} unique labels`)
    await check(await request("/api/operational-state", "PATCH", { changes: { systemUsers: [] } }), 400, "Unapproved collection rejected")
    await check(await request("/api/client-equipment", "POST", { equipment: {} }), 400, "Invalid equipment rejected")
    await check(await request("/api/estoque/stock-orders", "PATCH", { id: randomUUID(), hasWelding: "yes" }), 400, "Invalid label checkbox rejected")
    for (const [table, row] of [
      ["budget_works", { id: ids.budgetWork, name: "VERIFY TEMP LABEL WORK", client_name: "VERIFY TEMP CLIENT" }],
      ["budget_towers", { id: ids.tower, budget_work_id: ids.budgetWork, name: "VERIFY TEMP TOWER" }],
      ["budget_floors", { id: ids.floor, budget_tower_id: ids.tower, name: "VERIFY TEMP FLOOR" }],
      ["budget_service_types", { id: ids.final, budget_floor_id: ids.floor, name: "VERIFY TEMP FINAL" }],
      ["budget_environments", { id: ids.budgetEnvironment, budget_service_type_id: ids.final, name: "VERIFY TEMP ENVIRONMENT" }],
      ["budget_points", { id: ids.point, budget_environment_id: ids.budgetEnvironment, name: "VERIFY TEMP POINT", point_number: 1, kit_name: "VERIFY TEMP KIT", infrastructure_measure: "5m" }],
    ]) {
      const result = await db.from(table).insert(row)
      if (result.error) throw new Error(`${table}: ${result.error.message}`)
    }
    const backfilled = await check(await request("/api/estoque/stock-orders"), 200, "New budget point automatically creates a label")
    const label = backfilled.orders.find((row) => row.budget_point_id === ids.point)
    assert.ok(label)
    for (const status of ["Produ\u00e7\u00e3o", "Pronta para uso", "Usada"]) {
      const result = await check(await request("/api/estoque/stock-orders", "PATCH", { id: label.id, status, hasWelding: true, guidePassage: false }), 200, `Label status ${status}`)
      assert.equal(result.order.status, status)
      assert.equal(result.order.has_welding, true)
      assert.equal(result.order.guide_passage, false)
    }
    const reread = await check(await request("/api/estoque/stock-orders"), 200, "Reload preserves manual used status")
    assert.equal(reread.orders.find((row) => row.id === label.id).status, "Usada")
    const reopened = await check(await request("/api/estoque/stock-orders", "PATCH", { id: label.id, status: "Aberto", hasWelding: null, guidePassage: null }), 200, "Reopen label and clear checkboxes")
    assert.equal(reopened.order.used_at, null)
    assert.equal(reopened.order.has_welding, null)
    assert.equal(reopened.order.guide_passage, null)
    const defaults = loadModule("lib/operational-storage.ts").defaultOperationalState()
    const client = { ...defaults.clients[0], id: ids.client, name: "VERIFY TEMP CLIENT", document: ids.client }
    await check(await request("/api/operational-state", "PATCH", { changes: { clients: [client] } }), 200, "Create client")
    const environment = { id: ids.environment, clientId: ids.client, name: "VERIFY TEMP ENVIRONMENT" }
    await check(await request("/api/client-environments", "POST", { environment }), 200, "Create environment")
    const equipment = { id: ids.equipment, clientId: ids.client, clientEnvironmentId: ids.environment, name: "VERIFY TEMP EQUIPMENT", status: "Ativo" }
    await check(await request("/api/client-equipment", "POST", { equipment }), 200, "Create equipment")
    const edited = await check(await request("/api/client-equipment", "POST", { equipment: { ...equipment, name: "VERIFY TEMP EDITED", tag: "TEST-EDIT" } }), 200, "Edit equipment")
    assert.equal(edited.equipment.tag, "TEST-EDIT")
    await check(await request("/api/client-equipment", "POST", { equipment: { ...equipment, clientId: randomUUID() } }), 400, "Cross-client environment rejected")
    const serviceId = state.serviceTypes[0].id
    const changes = {
      works: [{ ...defaults.works[0], id: ids.work, clientId: ids.client, name: "VERIFY TEMP WORK", type: "PMOC" }],
      pmocPlans: [{ id: ids.plan, clientId: ids.client, workId: ids.work, name: "VERIFY TEMP PMOC", frequency: "Mensal", startMonth: 9, startYear: 2026, startDate: "2026-09-01", endDate: "2026-12-31", scheduleDay: 10, status: "Ativo", notes: "" }],
      pmocSectors: [{ id: ids.sector, planId: ids.plan, name: "VERIFY TEMP SECTOR", status: "Ativo" }],
      pmocEquipment: [{ ...equipment, id: ids.pmocEquipment, clientEquipmentId: ids.equipment, planId: ids.plan, sectorId: ids.sector }],
      pmocEquipmentServices: [{ id: ids.link, planId: ids.plan, equipmentId: ids.pmocEquipment, serviceTypeId: serviceId }],
      serviceOrders: [{ ...defaults.serviceOrders[0], id: ids.order, orderNumber: `VERIFY-${ids.order.slice(0, 8)}`, orderType: "pmoc", clientId: ids.client, workId: ids.work, clientEnvironmentId: ids.environment, clientEquipmentId: ids.equipment, floorId: "", environmentId: "", pointId: "", mainProviderId: "", helperProviderId: "", supervisorId: "", vehicleId: "", serviceTypeId: serviceId, status: "Agendada", totalAmount: 0 }],
      pmocSchedules: [{ id: ids.schedule, planId: ids.plan, equipmentId: ids.pmocEquipment, serviceTypeId: serviceId, month: 9, year: 2026, scheduledDate: "2026-09-10", serviceOrderId: ids.order, status: "OS aberta" }],
    }
    await check(await request("/api/operational-state", "PATCH", { changes }), 200, "Create PMOC with OS and schedule")
    await check(await request("/api/operational-state", "PATCH", { changes }), 200, "Repeat identical save")
    const saved = await db.from("pmoc_schedules").select("service_order_id").eq("id", ids.schedule).single()
    assert.equal(saved.data?.service_order_id, ids.order)
    const clientRole = await db.from("profiles").update({ role: "client", client_id: ids.client }).eq("id", actor)
    if (clientRole.error) throw clientRole.error
    for (const [path, method] of [["/api/client-equipment", "POST"], ["/api/operational-state", "PATCH"], ["/api/estoque/stock-orders", "PATCH"]]) {
      await check(await request(path, method, {}), 403, `${path} client-role write blocked`)
    }
    const scoped = await check(await request("/api/operational-state?section=pmoc"), 200, "Client-scoped PMOC read")
    assert.ok(scoped.state.pmocPlans.length > 0)
    assert.ok(scoped.state.pmocPlans.every((plan) => plan.clientId === ids.client))
    console.log(`RESULT: ${checks} HTTP checks passed`)
  } finally {
    const errors = []
    for (const [table, id] of [["budget_works", ids.budgetWork], ["pmoc_plans", ids.plan], ["service_orders", ids.order], ["client_equipment", ids.equipment], ["client_environments", ids.environment], ["works", ids.work], ["profiles", actor], ["clients", ids.client]]) {
      if (!id) continue
      const result = await db.from(table).delete().eq("id", id)
      if (result.error) errors.push(`${table}: ${result.error.message}`)
    }
    if (actor) { const result = await db.auth.admin.deleteUser(actor); if (result.error) errors.push(result.error.message) }
    assert.deepEqual(errors, [], "Temporary test data cleanup")
    console.log("CLEANUP: temporary account and records removed")
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
