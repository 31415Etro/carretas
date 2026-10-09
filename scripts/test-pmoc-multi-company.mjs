import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { createClient } from "@supabase/supabase-js"

process.loadEnvFile(".env.local")

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3001"
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const cookies = new Map()
const created = { plans: [], sectors: [], equipment: [], links: [] }
const clientId = randomUUID()
const serviceTypeId = randomUUID()
let userId = ""

function absorbCookies(response) {
  for (const value of response.headers.getSetCookie()) {
    const pair = value.split(";", 1)[0]
    const separator = pair.indexOf("=")
    cookies.set(pair.slice(0, separator), pair.slice(separator + 1))
  }
}

function cookieHeader() {
  return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ")
}

async function api(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), Cookie: cookieHeader() },
  })
  absorbCookies(response)
  const payload = await response.json().catch(() => ({}))
  return { response, payload }
}

async function selectCompany(companyId) {
  const result = await api("/api/auth/companies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companyId }),
  })
  assert.equal(result.response.status, 200, JSON.stringify(result.payload))
}

try {
  const stamp = Date.now()
  const email = `teste-pmoc-empresas-${stamp}@example.com`
  const password = `Pmoc@${stamp}`
  const auth = await supabase.auth.admin.createUser({ email, password, email_confirm: true })
  if (auth.error || !auth.data.user) throw auth.error || new Error("Usuario de teste nao criado")
  userId = auth.data.user.id
  const profile = await supabase.from("profiles").upsert({
    id: userId,
    email,
    full_name: "Teste PMOC Multiempresa",
    role: "admin",
    page_permissions: ["pmoc"],
    active: true,
  })
  if (profile.error) throw profile.error

  const [client, serviceType] = await Promise.all([
    supabase.from("clients").insert({ id: clientId, type: "PJ", name: `TESTE CLIENTE PMOC ${stamp}`, status: "Ativo" }),
    supabase.from("service_types").insert({ id: serviceTypeId, name: `TESTE SERVICO PMOC ${stamp}`, status: "Ativo", enabled_contexts: ["pmoc"] }),
  ])
  if (client.error) throw client.error
  if (serviceType.error) throw serviceType.error

  const login = await api("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
  assert.equal(login.response.status, 200, JSON.stringify(login.payload))

  const companiesResult = await supabase.from("system_companies").select("id,name,trade_name").eq("active", true).order("name")
  if (companiesResult.error) throw companiesResult.error
  assert.ok(companiesResult.data.length, "Nenhuma empresa ativa encontrada")

  for (const company of companiesResult.data) {
    await selectCompany(company.id)
    const planId = randomUUID()
    const sectorId = randomUUID()
    const equipmentId = randomUUID()
    const linkId = randomUUID()
    const now = new Date().toISOString()
    created.plans.push(planId)
    created.sectors.push(sectorId)
    created.equipment.push(equipmentId)
    created.links.push(linkId)

    const save = await api("/api/operational-state", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes: {
        pmocPlans: [{ id: planId, clientId, workId: "", name: `TESTE PLANO ${company.trade_name || company.name}`, frequency: "Mensal", startMonth: 10, startYear: 2026, startDate: "2026-10-01", endDate: "2027-09-30", scheduleDay: 10, status: "Ativo", notes: "", createdAt: now, updatedAt: now }],
        pmocSectors: [{ id: sectorId, planId, name: "Setor teste", floor: "Pavimento teste", status: "Ativo", notes: "", createdAt: now, updatedAt: now }],
        pmocEquipment: [{ id: equipmentId, planId, sectorId, tag: `EQ-${stamp}`, name: "Split teste", brand: "Teste", model: "Teste", serialNumber: String(stamp), capacity: "12000 BTUs", location: "Setor teste", status: "Ativo", notes: "", createdAt: now, updatedAt: now }],
        pmocEquipmentServices: [{ id: linkId, planId, equipmentId, serviceTypeId, createdAt: now }],
      } }),
    })
    assert.equal(save.response.status, 200, `${company.name}: ${JSON.stringify(save.payload)}`)

    const loaded = await api("/api/operational-state?section=pmoc", { cache: "no-store" })
    assert.equal(loaded.response.status, 200, `${company.name}: ${JSON.stringify(loaded.payload)}`)
    const state = loaded.payload.state
    assert.ok(state.pmocPlans.some((row) => row.id === planId), `${company.name}: plano nao apareceu`)
    assert.ok(state.pmocSectors.some((row) => row.id === sectorId), `${company.name}: setor nao apareceu`)
    assert.ok(state.pmocEquipment.some((row) => row.id === equipmentId), `${company.name}: equipamento nao apareceu`)
    assert.ok(state.pmocEquipmentServices.some((row) => row.id === linkId), `${company.name}: servico do equipamento nao apareceu`)
    assert.equal(state.pmocPlans.filter((row) => created.plans.includes(row.id)).length, 1, `${company.name}: plano de outro CNPJ ficou visivel`)
    console.log(`PASS: ${company.trade_name || company.name} cadastrou e carregou plano, setor e equipamento PMOC`)
  }
} finally {
  if (created.links.length) await supabase.from("pmoc_equipment_services").delete().in("id", created.links)
  if (created.equipment.length) await supabase.from("pmoc_equipment").delete().in("id", created.equipment)
  if (created.sectors.length) await supabase.from("pmoc_sectors").delete().in("id", created.sectors)
  if (created.plans.length) await supabase.from("pmoc_plans").delete().in("id", created.plans)
  await supabase.from("service_types").delete().eq("id", serviceTypeId)
  await supabase.from("clients").delete().eq("id", clientId)
  if (userId) {
    await supabase.from("profiles").delete().eq("id", userId)
    await supabase.auth.admin.deleteUser(userId)
  }
  console.log("CLEANUP: registros PMOC temporarios removidos")
}
