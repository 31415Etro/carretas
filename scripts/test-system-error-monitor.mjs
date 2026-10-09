import assert from "node:assert/strict"
import { createClient } from "@supabase/supabase-js"

process.loadEnvFile(".env.local")

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3003"
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const stamp = Date.now()
const email = `teste-monitor-${stamp}@example.com`
const password = `Teste@${stamp}`
let userId = ""
const logIds = []

function cookies(response) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie") || ""]
  return values.map((value) => value.split(";", 1)[0]).filter(Boolean).join("; ")
}

async function request(path, { method = "GET", body, cookie = "" } = {}) {
  return fetch(`${baseUrl}${path}`, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" })
}

async function json(response, status, label) {
  const raw = await response.text()
  assert.equal(response.status, status, `${label}: HTTP ${response.status} ${raw.slice(0, 400)}`)
  console.log(`PASS: ${label} (${status})`)
  return raw ? JSON.parse(raw) : null
}

try {
  await json(await request("/api/system-logs"), 401, "historico anonimo bloqueado")
  await json(await request("/api/system-logs", { method: "POST", body: { message: "anonimo" } }), 401, "registro anonimo bloqueado")

  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: "Teste Monitor", role: "admin" } })
  if (auth.error || !auth.data.user) throw auth.error || new Error("Usuario temporario nao criado.")
  userId = auth.data.user.id
  const profile = await db.from("profiles").upsert({ id: userId, email, full_name: "Teste Monitor", role: "admin", page_permissions: ["configuracoes"], active: true })
  if (profile.error) throw profile.error
  const login = await request("/api/auth/login", { method: "POST", body: { email, password } })
  await json(login, 200, "login administrativo")
  const cookie = cookies(login)

  const test = await json(await request("/api/system-logs", { method: "POST", cookie, body: { test: true } }), 200, "alerta manual registrado")
  assert(test.log.id, "Alerta de teste nao recebeu ID.")
  logIds.push(test.log.id)
  assert(["sent", "failed", "not_configured"].includes(test.log.emailStatus), "Status de e-mail invalido.")
  if (process.env.EXPECT_EMAIL_SENT === "1") assert.equal(test.log.emailStatus, "sent", `Provedor nao aceitou o e-mail: ${test.log.emailError || test.log.emailStatus}`)

  const captured = await json(await request("/api/system-logs", { method: "POST", cookie, body: { source: "Teste automatizado", message: "Falha controlada", statusCode: 500, path: "/teste-monitor", method: "POST", details: { password: "nao-pode-vazar", nested: { token: "nem-este" } } } }), 200, "falha tecnica registrada")
  logIds.push(captured.log.id)
  const history = await json(await request("/api/system-logs", { cookie }), 200, "administrador consulta historico")
  const saved = history.logs.find((item) => item.id === captured.log.id)
  assert(saved, "Falha registrada nao apareceu no historico.")
  assert.equal(saved.details.password, "[removido]")
  assert.equal(saved.details.nested.token, "[removido]")

  const regular = await db.from("profiles").update({ role: "user" }).eq("id", userId)
  if (regular.error) throw regular.error
  await json(await request("/api/system-logs", { cookie }), 403, "historico restrito ao administrador")
  const userReport = await json(await request("/api/system-logs", { method: "POST", cookie, body: { source: "Usuario", message: "Falha do usuario", severity: "critical" } }), 200, "usuario autenticado registra falha")
  logIds.push(userReport.log.id)
  assert.equal(userReport.log.emailRecipients, undefined, "Destinatarios foram expostos ao usuario comum.")

  console.log(JSON.stringify({ ok: true, logsCreated: logIds.length, emailStatus: test.log.emailStatus, sensitiveDataRedacted: true }))
} finally {
  if (logIds.length) await db.from("audit_logs").delete().in("id", logIds)
  if (userId) await db.from("profiles").delete().eq("id", userId)
  if (userId) await db.auth.admin.deleteUser(userId)
}
