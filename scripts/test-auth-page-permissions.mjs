import { createClient } from "@supabase/supabase-js"

process.loadEnvFile(".env.local")

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3001"
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const stamp = Date.now()
const email = `teste-permissoes-${stamp}@example.com`
const password = `Teste@${stamp}`
const adminEmail = `teste-admin-permissoes-${stamp}@example.com`
const adminPassword = `Admin@${stamp}`
let userId = ""
let adminUserId = ""

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function cookieHeader(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") || ""]
  return values.map((value) => value.split(";", 1)[0]).filter(Boolean).join("; ")
}

try {
  const { data: adminAuth, error: adminAuthError } = await admin.auth.admin.createUser({
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
    user_metadata: { full_name: "Teste Admin Permissoes", role: "admin" },
  })
  if (adminAuthError || !adminAuth.user) throw adminAuthError || new Error("Administrador de teste nao criado")
  adminUserId = adminAuth.user.id
  const { error: adminProfileError } = await admin.from("profiles").upsert({
    id: adminUserId,
    email: adminEmail,
    full_name: "Teste Admin Permissoes",
    role: "admin",
    page_permissions: ["dashboard", "configuracoes", "users"],
    active: true,
    updated_at: new Date().toISOString(),
  })
  if (adminProfileError) throw adminProfileError

  const anonymousPage = await fetch(`${baseUrl}/financeiro`, { redirect: "manual" })
  assert([307, 308].includes(anonymousPage.status), `Link sem login retornou ${anonymousPage.status}`)
  assert(String(anonymousPage.headers.get("location") || "").includes("/login"), "Link sem login nao redirecionou ao login")

  const anonymousApi = await fetch(`${baseUrl}/api/financial-state`, { redirect: "manual" })
  assert(anonymousApi.status === 401, `API sem login retornou ${anonymousApi.status}`)

  const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    redirect: "manual",
  })
  const adminLoginBody = await adminLogin.json()
  assert(adminLogin.status === 200 && adminLoginBody.success, `Login admin falhou: ${adminLoginBody.error || adminLogin.status}`)
  const adminCookie = cookieHeader(adminLogin)
  const createUser = await fetch(`${baseUrl}/api/users/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: adminCookie },
    body: JSON.stringify({ name: "Teste Permissoes", email, password, phone: "", role: "user", permissions: ["dashboard"], clientId: null }),
  })
  const createBody = await createUser.json()
  assert(createUser.status === 200 && createBody.success, `Cadastro pelo sistema falhou: ${createBody.error || createUser.status}`)
  userId = createBody.user.id
  assert(JSON.stringify(createBody.user.permissions) === JSON.stringify(["dashboard"]), "API alterou as paginas selecionadas")

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    redirect: "manual",
  })
  const loginBody = await login.json()
  assert(login.status === 200 && loginBody.success, `Login falhou: ${loginBody.error || login.status}`)
  const cookie = cookieHeader(login)
  assert(cookie, "Login nao devolveu cookie de sessao")

  const authUser = await fetch(`${baseUrl}/api/auth/user`, { headers: { Cookie: cookie } })
  const authBody = await authUser.json()
  assert(authBody.user?.id === userId, "Sessao nao retornou o usuario autenticado")
  assert(JSON.stringify(authBody.user.permissions) === JSON.stringify(["dashboard"]), "Permissoes salvas nao foram aplicadas ao login")

  const allowed = await fetch(`${baseUrl}/dashboard`, { headers: { Cookie: cookie }, redirect: "manual" })
  assert(allowed.status === 200, `Dashboard permitido retornou ${allowed.status}`)

  const dashboardYear = new Date().getFullYear()
  const dashboardApi = await fetch(`${baseUrl}/api/operacional/dashboard?year=${dashboardYear}&month=todos&executionStart=${dashboardYear}-01-01&executionEnd=${dashboardYear}-12-31`, { headers: { Cookie: cookie } })
  const dashboardBody = await dashboardApi.json()
  assert(dashboardApi.status === 200, `API do dashboard retornou ${dashboardApi.status}: ${dashboardBody.error || "erro desconhecido"}`)
  assert(Number.isFinite(dashboardBody.metrics?.averageExecutionMinutes), "Dashboard nao retornou a media de execucao")
  assert(Number.isFinite(dashboardBody.metrics?.measuredExecutionOrders), "Dashboard nao retornou a quantidade de OS medidas")
  assert(Array.isArray(dashboardBody.orderCharts?.executionTime), "Dashboard nao retornou o grafico de execucao por OS")
  assert(dashboardBody.executionPeriod?.start === `${dashboardYear}-01-01`, "Dashboard nao aplicou a data inicial da analise")
  assert(dashboardBody.executionPeriod?.end === `${dashboardYear}-12-31`, "Dashboard nao aplicou a data final da analise")

  for (const pathname of ["/financeiro", "/configuracoes", "/ordens-servico"]) {
    const denied = await fetch(`${baseUrl}${pathname}`, { headers: { Cookie: cookie }, redirect: "manual" })
    assert([307, 308].includes(denied.status), `${pathname} nao foi bloqueada: ${denied.status}`)
    assert(new URL(denied.headers.get("location"), baseUrl).pathname === "/dashboard", `${pathname} nao redirecionou para pagina permitida`)
  }

  const deletion = await fetch(`${baseUrl}/api/financial-state/account?kind=pagar&id=00000000-0000-4000-8000-000000000001`, {
    method: "DELETE",
    headers: { Cookie: cookie },
  })
  assert(deletion.status === 403, `Exclusao por nao administrador retornou ${deletion.status}`)

  console.log(JSON.stringify({
    ok: true,
    unauthenticatedLinkRedirected: true,
    unauthenticatedApiBlocked: true,
    loginAuthenticated: true,
    userCreatedBySystemApi: true,
    savedPermissionsApplied: ["dashboard"],
    executionTimeMetricsLoaded: true,
    measuredExecutionOrders: dashboardBody.metrics.measuredExecutionOrders,
    averageExecutionMinutes: dashboardBody.metrics.averageExecutionMinutes,
    forbiddenPagesRedirected: ["financeiro", "configuracoes", "ordens-servico"],
    nonAdminDeletionBlocked: true,
  }))
} finally {
  if (userId) {
    await admin.from("profiles").delete().eq("id", userId)
    await admin.auth.admin.deleteUser(userId)
  }
  if (adminUserId) {
    await admin.from("profiles").delete().eq("id", adminUserId)
    await admin.auth.admin.deleteUser(adminUserId)
  }
}
