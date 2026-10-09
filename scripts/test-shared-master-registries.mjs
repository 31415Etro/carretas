import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { createClient } from "@supabase/supabase-js"

process.loadEnvFile(".env.local")

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3001"
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const cookies = new Map()
const ids = {
  client: randomUUID(),
  clientEnvironment: randomUUID(),
  clientEquipment: randomUUID(),
  supplier: randomUUID(),
  material: randomUUID(),
  serviceType: randomUUID(),
  checklist: randomUUID(),
  stockKit: randomUUID(),
  stockKitItem: randomUUID(),
  provider: randomUUID(),
  vehicle: randomUUID(),
}
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
  const email = `teste-cadastros-globais-${Date.now()}@example.com`
  const password = `Global@${Date.now()}`
  const auth = await supabase.auth.admin.createUser({ email, password, email_confirm: true })
  if (auth.error || !auth.data.user) throw auth.error || new Error("Usuario de teste nao criado")
  userId = auth.data.user.id
  const profile = await supabase.from("profiles").upsert({
    id: userId,
    email,
    full_name: "Teste Cadastros Globais",
    role: "admin",
    page_permissions: ["clientes_obras", "estoque", "equipe_prestadores"],
    active: true,
  })
  if (profile.error) throw profile.error

  const login = await api("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
  assert.equal(login.response.status, 200, JSON.stringify(login.payload))

  const companiesResult = await supabase.from("system_companies").select("id,name,trade_name").eq("active", true).order("name")
  if (companiesResult.error) throw companiesResult.error
  const companies = companiesResult.data
  assert.ok(companies.length >= 2)
  await selectCompany(companies[0].id)

  const stamp = Date.now()
  const client = await api("/api/clients", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client: {
      id: ids.client,
      type: "PJ",
      name: `TESTE CLIENTE GLOBAL ${stamp}`,
      document: String(stamp).padStart(14, "0").slice(-14),
      status: "Ativo",
    } }),
  })
  assert.equal(client.response.status, 200, JSON.stringify(client.payload))

  const supplier = await api("/api/suppliers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ supplier: {
      id: ids.supplier,
      name: `TESTE FORNECEDOR GLOBAL ${stamp}`,
      phone: "47999999999",
      status: "Ativo",
    } }),
  })
  assert.equal(supplier.response.status, 200, JSON.stringify(supplier.payload))

  const material = await api("/api/estoque/materials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ material: {
      id: ids.material,
      name: `TESTE PRODUTO GLOBAL ${stamp}`,
      internalCode: "84151011",
      unit: "unidade",
      status: "Ativo",
    } }),
  })
  assert.equal(material.response.status, 200, JSON.stringify(material.payload))
  assert.equal(material.payload.material?.internalCode, "84151011")

  const serviceType = await api("/api/service-types", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      serviceType: {
        id: ids.serviceType,
        name: `TESTE SERVICO GLOBAL ${stamp}`,
        status: "Ativo",
        enabledContexts: ["obra", "pmoc", "servicos"],
      },
      checklist: [{ id: ids.checklist, taskName: "Validar cadastro compartilhado", required: true }],
    }),
  })
  assert.equal(serviceType.response.status, 200, JSON.stringify(serviceType.payload))

  const stockKit = await api("/api/estoque/kits", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kit: { id: ids.stockKit, name: `TESTE KIT GLOBAL ${stamp}`, status: "Ativo", quantityInStock: 1 },
      items: [{ id: ids.stockKitItem, kitId: ids.stockKit, materialId: ids.material, quantity: 1, unit: "unidade" }],
    }),
  })
  assert.equal(stockKit.response.status, 200, JSON.stringify(stockKit.payload))

  const sharedRows = await Promise.all([
    supabase.from("client_environments").insert({ id: ids.clientEnvironment, client_id: ids.client, name: `TESTE AMBIENTE GLOBAL ${stamp}`, system_company_id: companies[0].id }),
    supabase.from("providers").insert({ id: ids.provider, full_name: `TESTE EQUIPE GLOBAL ${stamp}`, role: "Tecnico", status: "Ativo" }),
    supabase.from("vehicles").insert({ id: ids.vehicle, plate: `T${String(stamp).slice(-6)}`, model: "Teste Global", brand: "Teste", status: "Disponivel", system_company_id: companies[0].id }),
  ])
  for (const result of sharedRows) if (result.error) throw result.error
  const equipmentResult = await supabase.from("client_equipment").insert({
    id: ids.clientEquipment,
    client_id: ids.client,
    client_environment_id: ids.clientEnvironment,
    name: `TESTE EQUIPAMENTO GLOBAL ${stamp}`,
    system_company_id: companies[0].id,
  })
  if (equipmentResult.error) throw equipmentResult.error

  const firstCompanyWork = await supabase.from("works").select("id").eq("system_company_id", companies[0].id).limit(1).single()
  if (firstCompanyWork.error) throw firstCompanyWork.error

  for (const company of companies) {
    await selectCompany(company.id)
    const registry = await api("/api/operational-state?section=registry", { cache: "no-store" })
    assert.equal(registry.response.status, 200, JSON.stringify(registry.payload))
    const state = registry.payload.state
    const visibility = {
      client: state.clients.some((row) => row.id === ids.client),
      clientEnvironment: state.clientEnvironments.some((row) => row.id === ids.clientEnvironment),
      clientEquipment: state.clientEquipment.some((row) => row.id === ids.clientEquipment),
      supplier: state.suppliers.some((row) => row.id === ids.supplier),
      material: state.materials.some((row) => row.id === ids.material),
      provider: state.providers.some((row) => row.id === ids.provider),
      serviceType: state.serviceTypes.some((row) => row.id === ids.serviceType),
      checklist: state.serviceTypeChecklistItems.some((row) => row.id === ids.checklist),
      stockKit: state.stockKits.some((row) => row.id === ids.stockKit),
      stockKitItem: state.stockKitItems.some((row) => row.id === ids.stockKitItem),
      vehicle: state.vehicles.some((row) => row.id === ids.vehicle),
    }
    console.log(`VISIBILIDADE ${company.trade_name || company.name}:`, visibility)
    assert.ok(visibility.client, "Cliente global nao apareceu")
    assert.ok(visibility.clientEnvironment, "Ambiente do cliente global nao apareceu")
    assert.ok(visibility.clientEquipment, "Equipamento do cliente global nao apareceu")
    assert.ok(visibility.supplier, "Fornecedor global nao apareceu")
    assert.ok(visibility.material, "Produto global nao apareceu")
    assert.equal(state.materials.find((row) => row.id === ids.material)?.internalCode, "84151011", "NCM do produto nao foi preservado")
    assert.ok(visibility.provider, "Funcionario global nao apareceu")
    assert.ok(visibility.serviceType, "Servico global nao apareceu")
    assert.ok(visibility.checklist, "Checklist do servico global nao apareceu")
    assert.ok(visibility.stockKit, "Kit global nao apareceu")
    assert.ok(visibility.stockKitItem, "Composicao do kit global nao apareceu")
    assert.ok(visibility.vehicle, "Veiculo global nao apareceu")
    const shouldSeeFirstWork = company.id === companies[0].id
    assert.equal(state.works.some((row) => row.id === firstCompanyWork.data.id), shouldSeeFirstWork, "Obra deixou de respeitar a empresa ativa")
    console.log(`PASS: ${company.trade_name || company.name} recebeu todos os cadastros comuns e manteve obras isoladas`)
  }
} finally {
  await supabase.from("client_equipment").delete().eq("id", ids.clientEquipment)
  await supabase.from("client_environments").delete().eq("id", ids.clientEnvironment)
  await supabase.from("stock_kit_items").delete().eq("id", ids.stockKitItem)
  await supabase.from("stock_kits").delete().eq("id", ids.stockKit)
  await supabase.from("service_type_checklist_items").delete().eq("id", ids.checklist)
  await supabase.from("service_types").delete().eq("id", ids.serviceType)
  await supabase.from("vehicles").delete().eq("id", ids.vehicle)
  await supabase.from("providers").delete().eq("id", ids.provider)
  await supabase.from("clients").delete().eq("id", ids.client)
  await supabase.from("suppliers").delete().eq("id", ids.supplier)
  await supabase.from("materials").delete().eq("id", ids.material)
  if (userId) {
    await supabase.from("profiles").delete().eq("id", userId)
    await supabase.auth.admin.deleteUser(userId)
  }
  const [client, supplier, material, serviceType, stockKit, provider, vehicle] = await Promise.all([
    supabase.from("clients").select("id", { count: "exact", head: true }).eq("id", ids.client),
    supabase.from("suppliers").select("id", { count: "exact", head: true }).eq("id", ids.supplier),
    supabase.from("materials").select("id", { count: "exact", head: true }).eq("id", ids.material),
    supabase.from("service_types").select("id", { count: "exact", head: true }).eq("id", ids.serviceType),
    supabase.from("stock_kits").select("id", { count: "exact", head: true }).eq("id", ids.stockKit),
    supabase.from("providers").select("id", { count: "exact", head: true }).eq("id", ids.provider),
    supabase.from("vehicles").select("id", { count: "exact", head: true }).eq("id", ids.vehicle),
  ])
  assert.deepEqual([client.count, supplier.count, material.count, serviceType.count, stockKit.count, provider.count, vehicle.count], [0, 0, 0, 0, 0, 0, 0])
  console.log("CLEANUP: cadastros e usuario temporarios removidos")
}
