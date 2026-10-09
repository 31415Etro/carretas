import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { createClient } from "@supabase/supabase-js"

process.loadEnvFile(".env.local")

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3003"
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const stamp = Date.now()
const email = `teste-client-supplier-${stamp}@example.com`
const password = `Teste@${stamp}`
const clientId = randomUUID()
const supplierId = randomUUID()
let userId = ""

function cookies(response) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie") || ""]
  return values.map((value) => value.split(";", 1)[0]).filter(Boolean).join("; ")
}

async function post(path, body, cookie = "") {
  return fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body), redirect: "manual" })
}

async function json(response, status, label) {
  const text = await response.text()
  assert.equal(response.status, status, `${label}: HTTP ${response.status} ${text.slice(0, 300)}`)
  console.log(`PASS: ${label} (${status})`)
  return text ? JSON.parse(text) : null
}

try {
  await json(await post("/api/clients", {}), 401, "cliente anonimo bloqueado")
  await json(await post("/api/suppliers", {}), 401, "fornecedor anonimo bloqueado")

  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: "Teste Cliente Fornecedor", role: "admin" } })
  if (auth.error || !auth.data.user) throw auth.error || new Error("Usuario temporario nao criado.")
  userId = auth.data.user.id
  const profile = await db.from("profiles").upsert({ id: userId, email, full_name: "Teste Cliente Fornecedor", role: "admin", page_permissions: ["clientes_obras"], active: true })
  if (profile.error) throw profile.error
  const login = await post("/api/auth/login", { email, password })
  const loginBody = await json(login, 200, "login administrativo")
  assert(loginBody.success, "Login nao retornou sucesso.")
  const cookie = cookies(login)

  const client = {
    id: clientId, type: "PJ", name: `CLIENTE TESTE ${stamp}`, document: `TESTE-${stamp}`,
    corporateName: "Cliente Teste Ltda", tradeName: "Cliente Teste", stateRegistration: "", responsibleName: "Responsavel",
    phone: "47999990000", mobile: "", email: email, zipCode: "", street: "", number: "", complement: "", district: "",
    city: "Balneario Camboriu", state: "SC", serviceContexts: ["pmoc"], monthlyPmocValue: 150, status: "Ativo", notes: "Cadastro de teste",
  }
  const clientPayloadSize = Buffer.byteLength(JSON.stringify({ client }))
  const createdClient = await json(await post("/api/clients", { client }, cookie), 200, "criar cliente com payload pontual")
  assert.equal(createdClient.client.id, clientId)
  assert(clientPayloadSize < 10_000, `Payload do cliente ficou excessivo: ${clientPayloadSize} bytes.`)
  const editedClient = await json(await post("/api/clients", { client: { ...client, name: `${client.name} EDITADO` } }, cookie), 200, "editar cliente")
  assert.equal(editedClient.client.name, `${client.name} EDITADO`)

  const supplier = {
    id: supplierId, name: `FORNECEDOR TESTE ${stamp}`, document: `FORN-${stamp}`, contactName: "Contato", phone: "47988880000",
    email, category: "Climatizacao", categoryIds: [], city: "Itajai", state: "SC", status: "Ativo", notes: "Cadastro de teste",
  }
  const supplierPayloadSize = Buffer.byteLength(JSON.stringify({ supplier }))
  const createdSupplier = await json(await post("/api/suppliers", { supplier }, cookie), 200, "criar fornecedor com payload pontual")
  assert.equal(createdSupplier.supplier.id, supplierId)
  assert(supplierPayloadSize < 10_000, `Payload do fornecedor ficou excessivo: ${supplierPayloadSize} bytes.`)
  const editedSupplier = await json(await post("/api/suppliers", { supplier: { ...supplier, phone: "47977770000" } }, cookie), 200, "editar fornecedor")
  assert.equal(editedSupplier.supplier.phone, "47977770000")

  const [clientCount, supplierCount] = await Promise.all([
    db.from("clients").select("id", { count: "exact", head: true }).eq("id", clientId),
    db.from("suppliers").select("id", { count: "exact", head: true }).eq("id", supplierId),
  ])
  assert.equal(clientCount.count, 1, "Cliente foi duplicado ao editar.")
  assert.equal(supplierCount.count, 1, "Fornecedor foi duplicado ao editar.")

  const clientRole = await db.from("profiles").update({ role: "client", client_id: clientId }).eq("id", userId)
  if (clientRole.error) throw clientRole.error
  await json(await post("/api/clients", { client }, cookie), 403, "login cliente nao cadastra clientes")
  await json(await post("/api/suppliers", { supplier }, cookie), 403, "login cliente nao cadastra fornecedores")

  console.log(JSON.stringify({ ok: true, clientPayloadBytes: clientPayloadSize, supplierPayloadBytes: supplierPayloadSize, createAndEdit: true, duplicates: false }))
} finally {
  await db.from("suppliers").delete().eq("id", supplierId)
  if (userId) await db.from("profiles").delete().eq("id", userId)
  await db.from("clients").delete().eq("id", clientId)
  if (userId) await db.auth.admin.deleteUser(userId)
}
