import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { createClient } from "@supabase/supabase-js"

process.loadEnvFile(".env.local")

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3001"
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const cookies = new Map()
const orderIds = []
const orderIdsByCompany = new Map()
const generatedWorkIds = new Set()
const originalWorkIds = new Set()
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
  return response
}

async function responseJson(response) {
  const payload = await response.json().catch(() => ({}))
  return { response, payload }
}

async function companyOrderFixture(companyId) {
  const { data: works, error } = await supabase
    .from("works")
    .select("id,client_id")
    .eq("system_company_id", companyId)
    .limit(1)
  if (error) throw error
  assert.ok(works?.[0], `Empresa ${companyId} precisa ter ao menos uma obra para o teste.`)

  const { data: services, error: serviceError } = await supabase
    .from("service_types")
    .select("id")
    .eq("system_company_id", companyId)
    .limit(1)
  if (serviceError) throw serviceError
  assert.ok(services?.[0], `Empresa ${companyId} precisa ter ao menos um tipo de servico para o teste.`)
  return { clientId: works[0].client_id, workId: works[0].id, serviceTypeId: services[0].id }
}

async function selectCompany(companyId) {
  const { response, payload } = await responseJson(await api("/api/auth/companies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companyId }),
  }))
  assert.equal(response.status, 200, JSON.stringify(payload))
}

async function createOrder(company, fixture, orderNumber, orderType = "obra") {
  await selectCompany(company.id)
  const id = randomUUID()
  orderIds.push(id)
  orderIdsByCompany.set(company.id, [...(orderIdsByCompany.get(company.id) || []), id])
  const timestamp = new Date().toISOString()
  const { response, payload } = await responseJson(await api("/api/ordens-servico", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order: {
        id,
        orderNumber,
        orderType,
        clientId: fixture.clientId,
        workId: orderType === "obra" ? fixture.workId : "",
        serviceTypeId: fixture.serviceTypeId,
        priority: "Media",
        description: "TESTE TEMPORARIO - OS MULTIEMPRESA",
        status: "Criada",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      includeChildren: true,
      checklistItems: [],
      serviceOrderMaterials: [],
      materialUpdates: [],
    }),
  }))
  assert.equal(response.status, 200, JSON.stringify(payload))
  assert.equal(payload.companyId, company.id)

  const { data, error } = await supabase
    .from("service_orders")
    .select("id,order_number,system_company_id,client_id,work_id")
    .eq("id", id)
    .single()
  if (error) throw error
  assert.equal(data.system_company_id, company.id)
  assert.equal(data.order_number, orderNumber, "A mesma numeracao deve ser permitida em CNPJs diferentes.")
  assert.equal(data.client_id, fixture.clientId)
  if (orderType === "obra") assert.equal(data.work_id, fixture.workId)
  if (!originalWorkIds.has(data.work_id)) generatedWorkIds.add(data.work_id)
  console.log(`PASS: ${company.trade_name || company.name} criou OS de ${orderType} isolada no proprio CNPJ`)
}

try {
  const email = `teste-os-multiempresa-${Date.now()}@example.com`
  const password = `Multi@${Date.now()}`
  const { data: auth, error: authError } = await supabase.auth.admin.createUser({ email, password, email_confirm: true })
  if (authError || !auth.user) throw authError || new Error("Usuario de teste nao criado")
  userId = auth.user.id
  const { error: profileError } = await supabase.from("profiles").upsert({
    id: userId,
    email,
    full_name: "Teste OS Multiempresa",
    role: "admin",
    page_permissions: ["ordens_servico"],
    active: true,
  })
  if (profileError) throw profileError

  const login = await responseJson(await api("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }))
  assert.equal(login.response.status, 200, JSON.stringify(login.payload))

  const { data: companies, error: companiesError } = await supabase
    .from("system_companies")
    .select("id,name,trade_name")
    .eq("active", true)
    .order("name")
  if (companiesError) throw companiesError
  assert.ok(companies.length >= 2, "O teste exige ao menos duas empresas ativas.")

  const fixtures = new Map()
  for (const company of companies) fixtures.set(company.id, await companyOrderFixture(company.id))
  const { data: existingWorks, error: existingWorksError } = await supabase.from("works").select("id")
  if (existingWorksError) throw existingWorksError
  for (const work of existingWorks) originalWorkIds.add(work.id)
  const sharedNumber = `OS-TEST-MULTI-${Date.now()}`
  for (const company of companies) {
    await createOrder(company, fixtures.get(company.id), `${sharedNumber}-OBRA`, "obra")
    await createOrder(company, fixtures.get(company.id), `${sharedNumber}-SERVICOS`, "servicos")
    await createOrder(company, fixtures.get(company.id), `${sharedNumber}-PMOC`, "pmoc")
  }

  for (const company of companies) {
    await selectCompany(company.id)
    const listed = await responseJson(await api("/api/operational-state?section=execution", { cache: "no-store" }))
    assert.equal(listed.response.status, 200, JSON.stringify(listed.payload))
    const testOrders = (listed.payload.state?.serviceOrders || []).filter((order) => String(order.orderNumber).startsWith(sharedNumber))
    assert.equal(testOrders.length, 3, `${company.trade_name || company.name} deve listar somente suas tres OS temporarias.`)
    assert.deepEqual(new Set(testOrders.map((order) => order.id)), new Set(orderIdsByCompany.get(company.id)))
    console.log(`PASS: troca para ${company.trade_name || company.name} listou somente as OS do CNPJ ativo`)
  }

  const firstCompany = companies[0]
  const secondCompany = companies[1]
  await selectCompany(firstCompany.id)
  const foreign = fixtures.get(secondCompany.id)
  const invalidId = randomUUID()
  orderIds.push(invalidId)
  const invalid = await responseJson(await api("/api/ordens-servico", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      order: { id: invalidId, orderNumber: `${sharedNumber}-INVALIDA`, orderType: "obra", ...foreign, status: "Criada" },
      includeChildren: false,
    }),
  }))
  assert.equal(invalid.response.status, 400)
  assert.match(invalid.payload.error, /nao pertence a empresa ativa/)
  const leaked = await supabase.from("service_orders").select("id", { count: "exact", head: true }).eq("id", invalidId)
  assert.equal(leaked.count, 0)
  console.log("PASS: obra de outro CNPJ foi bloqueada mesmo com a base de clientes compartilhada")
} finally {
  if (orderIds.length) {
    await supabase.from("audit_logs").delete().in("entity_id", orderIds)
    await supabase.from("stock_service_orders").delete().in("service_order_id", orderIds)
    await supabase.from("service_orders").delete().in("id", orderIds)
    if (generatedWorkIds.size) await supabase.from("works").delete().in("id", [...generatedWorkIds])
  }
  if (userId) {
    await supabase.from("profiles").delete().eq("id", userId)
    await supabase.auth.admin.deleteUser(userId)
  }
  const remaining = await supabase.from("service_orders").select("id", { count: "exact", head: true }).in("id", orderIds)
  assert.equal(remaining.count, 0)
  if (generatedWorkIds.size) {
    const remainingWorks = await supabase.from("works").select("id", { count: "exact", head: true }).in("id", [...generatedWorkIds])
    assert.equal(remainingWorks.count, 0)
  }
  console.log("CLEANUP: OS e usuario temporarios removidos")
}
