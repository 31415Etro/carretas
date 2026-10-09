import assert from "node:assert/strict"
import { createClient } from "@supabase/supabase-js"

process.loadEnvFile(".env.local")

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3003"
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const stamp = Date.now()
const email = `teste-paineis-cliente-${stamp}@example.com`
const password = `Teste@${stamp}`
let userId = ""

function cookieHeader(response) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie") || ""]
  return values.map((value) => value.split(";", 1)[0]).filter(Boolean).join("; ")
}

async function updatePermissions(permissions) {
  const result = await admin.from("profiles").update({ page_permissions: permissions, updated_at: new Date().toISOString() }).eq("id", userId)
  if (result.error) throw result.error
}

async function request(pathname, cookie) {
  return fetch(`${baseUrl}${pathname}`, { headers: { Cookie: cookie }, redirect: "manual", cache: "no-store" })
}

try {
  const clientsResult = await admin.from("clients").select("id,name").eq("status", "Ativo").limit(2)
  if (clientsResult.error) throw clientsResult.error
  assert((clientsResult.data || []).length >= 2, "O teste precisa de dois clientes ativos.")
  const [ownClient, foreignClient] = clientsResult.data

  const authResult = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: "Teste Paineis Cliente", role: "client", client_id: ownClient.id, page_permissions: ["painel_ambientes"] } })
  if (authResult.error || !authResult.data.user) throw authResult.error || new Error("Usuario temporario nao criado.")
  userId = authResult.data.user.id
  const profileResult = await admin.from("profiles").upsert({ id: userId, email, full_name: "Teste Paineis Cliente", role: "client", client_id: ownClient.id, page_permissions: ["painel_ambientes"], active: true, updated_at: new Date().toISOString() })
  if (profileResult.error) throw profileResult.error

  const login = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }), redirect: "manual" })
  const loginBody = await login.json()
  assert.equal(login.status, 200, loginBody.error || "Login do cliente falhou.")
  const cookie = cookieHeader(login)
  assert(cookie, "Login nao retornou cookie.")

  const environmentPage = await request("/dashboard/ambientes", cookie)
  const deniedWorkPage = await request("/dashboard/obras", cookie)
  assert.equal(environmentPage.status, 200, "Painel de ambientes permitido nao abriu.")
  assert([307, 308].includes(deniedWorkPage.status), "Dashboard de obra abriu sem permissao.")
  assert(new URL(deniedWorkPage.headers.get("location"), baseUrl).pathname === "/dashboard/ambientes", "Dashboard de obra nao redirecionou para o painel permitido.")
  const environmentApi = await request(`/api/operacional/environment-panel?clientId=${foreignClient.id}`, cookie)
  const environmentBody = await environmentApi.json()
  const deniedWorkApi = await request(`/api/operacional/work-dashboard?clientId=${foreignClient.id}`, cookie)
  assert.equal(environmentApi.status, 200, environmentBody.error || "API de ambientes falhou.")
  assert.equal(deniedWorkApi.status, 403, "API de obras abriu sem permissao.")
  assert.equal(environmentBody.viewer.clientId, ownClient.id, "Painel de ambientes aceitou cliente de outra empresa.")
  assert((environmentBody.availableClients || []).every((client) => client.id === ownClient.id), "Painel de ambientes vazou outro cliente.")

  await updatePermissions(["dashboard_obras"])
  const workPage = await request("/dashboard/obras", cookie)
  const deniedEnvironmentPage = await request("/dashboard/ambientes", cookie)
  const workApi = await request(`/api/operacional/work-dashboard?clientId=${foreignClient.id}`, cookie)
  const workBody = await workApi.json()
  const deniedEnvironmentApi = await request(`/api/operacional/environment-panel?clientId=${foreignClient.id}`, cookie)
  assert.equal(workPage.status, 200, "Dashboard de obra permitido nao abriu.")
  assert([307, 308].includes(deniedEnvironmentPage.status), "Painel de ambientes abriu sem permissao.")
  assert.equal(workApi.status, 200, workBody.error || "API de obras falhou.")
  assert.equal(deniedEnvironmentApi.status, 403, "API de ambientes abriu sem permissao.")
  assert.equal(workBody.viewer.clientId, ownClient.id, "Dashboard de obra aceitou cliente de outra empresa.")
  assert((workBody.works || []).every((work) => work.clientId === ownClient.id), "Dashboard de obra vazou obra de outro cliente.")

  await updatePermissions(["dashboard_obras", "painel_ambientes"])
  const [bothWork, bothEnvironment] = await Promise.all([request("/dashboard/obras", cookie), request("/dashboard/ambientes", cookie)])
  assert.equal(bothWork.status, 200, "Dashboard de obra nao abriu com ambas as permissoes.")
  assert.equal(bothEnvironment.status, 200, "Painel de ambientes nao abriu com ambas as permissoes.")

  console.log(JSON.stringify({ ok: true, client: ownClient.name, environmentsOnly: true, worksOnly: true, both: true, crossClientBlocked: true }))
} finally {
  if (userId) {
    await admin.from("profiles").delete().eq("id", userId)
    await admin.auth.admin.deleteUser(userId)
  }
}
