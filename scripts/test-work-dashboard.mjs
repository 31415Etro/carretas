import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { createClient } from "@supabase/supabase-js"

process.loadEnvFile(".env.local")
const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3003"
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const temporaryOrderId = randomUUID()
const temporaryPmocOrderId = randomUUID()
const temporaryPhotoId = randomUUID()
let userId = ""
let cookie = ""

async function api(path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    signal: AbortSignal.timeout(180000),
    ...options,
    headers: { ...(options.headers || {}), ...(cookie ? { Cookie: cookie } : {}) },
  })
}

async function payload(response, label) {
  const text = await response.text()
  assert.equal(response.status, 200, `${label}: HTTP ${response.status} ${text.slice(0, 500)}`)
  console.log(`PASS: ${label}`)
  return JSON.parse(text)
}

try {
  const [{ data: budgetWorks, error: budgetError }, { data: source, error: sourceError }] = await Promise.all([
    supabase.from("budget_works").select("id,name"),
    supabase.from("service_orders").select("*").eq("order_type", "obra").not("point_id", "is", null).limit(1).single(),
  ])
  if (budgetError) throw budgetError
  if (sourceError) throw sourceError

  const now = new Date().toISOString()
  const temporaryNumber = `OS-TEST-DASH-${Date.now()}`
  const inserted = await supabase.from("service_orders").insert([
    {
      ...source,
      id: temporaryOrderId,
      order_number: temporaryNumber,
      order_type: "obra",
      status: "Criada",
      description: "TESTE TEMPORARIO - DASHBOARD POR PONTO",
      notes: `Selecoes OS JSON: ${JSON.stringify({ pointIds: [source.point_id] })}`,
      scheduled_date: "2099-12-30",
      finished_at: null,
      cancelled_at: null,
      created_at: now,
      updated_at: now,
    },
    {
      ...source,
      id: temporaryPmocOrderId,
      order_number: `PMOC-TEST-DASH-${Date.now()}`,
      order_type: "pmoc",
      status: "Criada",
      description: "TESTE TEMPORARIO - PMOC NAO PODE APARECER",
      scheduled_date: "2099-12-31",
      finished_at: null,
      cancelled_at: null,
      created_at: now,
      updated_at: now,
    },
  ])
  if (inserted.error) throw inserted.error

  const photoUrl = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="
  const insertedPhoto = await supabase.from("service_order_files").insert({
    id: temporaryPhotoId,
    service_order_id: temporaryOrderId,
    category: "Foto Inicial",
    file_url: photoUrl,
    file_name: "dashboard-ambiente.gif",
    file_type: "image/gif",
    notes: `equipment:${source.point_id}`,
    created_at: now,
  })
  if (insertedPhoto.error) throw insertedPhoto.error

  const email = `teste-dashboard-${randomUUID()}@example.com`
  const password = `Dashboard!${randomUUID()}`
  const auth = await supabase.auth.admin.createUser({ email, password, email_confirm: true })
  if (auth.error || !auth.data.user) throw auth.error || new Error("Usuario temporario nao criado")
  userId = auth.data.user.id
  const profile = await supabase.from("profiles").upsert({ id: userId, email, full_name: "TESTE TEMPORARIO DASHBOARD", role: "admin", page_permissions: ["dashboard"], active: true })
  if (profile.error) throw profile.error

  const login = await api("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })
  const loginBody = await payload(login, "login do usuario temporario")
  assert.ok(loginBody)
  cookie = login.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ")
  assert.ok(cookie)

  const initial = await payload(await api("/api/operacional/work-dashboard"), "listar obras do orcamento sem selecionar cliente")
  assert.deepEqual(new Set(budgetWorks.map((work) => work.id)), new Set(initial.works.filter((work) => budgetWorks.some((budget) => budget.id === work.id)).map((work) => work.id)))

  const dashboard = await payload(await api(`/api/operacional/work-dashboard?workId=${source.work_id}`), "carregar arvore e pontos da obra orcada")
  assert.equal(dashboard.selectedWork?.id, source.work_id)
  assert.ok(dashboard.summary.total > 0, "A obra deveria possuir pontos")
  assert.ok(dashboard.towers.length > 0, "A obra deveria possuir torres")
  const point = dashboard.orderPoints.find((item) => item.id === source.point_id)
  assert.ok(point, "O ponto vinculado a OS nao apareceu no painel")
  assert.ok(point.orders.some((order) => order.id === source.id), "A OS existente nao apareceu no ponto")
  assert.ok(point.orders.some((order) => order.id === temporaryOrderId), "A segunda OS nao apareceu no mesmo ponto")
  const environment = dashboard.towers.flatMap((tower) => tower.floors).flatMap((floor) => floor.finals).flatMap((final) => final.environments).find((item) => item.points.some((candidate) => candidate.id === source.point_id))
  assert.equal(environment?.photo?.url, photoUrl, "A foto da OS deveria aparecer junto do ambiente")
  assert.equal(point.orders.filter((order) => [source.id, temporaryOrderId].includes(order.id)).length, 2)
  assert.equal(dashboard.serviceOrders[0]?.id, temporaryOrderId, "A OS de obra mais recente deveria ser a primeira opcao")
  assert.ok(dashboard.serviceOrders.every((order) => order.id !== temporaryPmocOrderId), "OS de PMOC apareceu no filtro")

  const filtered = await payload(await api(`/api/operacional/work-dashboard?workId=${source.work_id}&orderIds=${temporaryOrderId}`), "filtrar o dashboard por uma OS de obra")
  assert.deepEqual(filtered.selectedOrderIds, [temporaryOrderId])
  assert.equal(filtered.orderSummary.total, 1, "O resumo deveria considerar somente a OS selecionada")
  assert.ok(filtered.orderPoints.flatMap((item) => item.orders).every((order) => order.id === temporaryOrderId), "Outra OS vazou para os pontos filtrados")

  const multiple = await payload(await api(`/api/operacional/work-dashboard?workId=${source.work_id}&orderIds=${source.id},${temporaryOrderId},${temporaryPmocOrderId}`), "filtrar o dashboard por varias OS")
  assert.deepEqual(new Set(multiple.selectedOrderIds), new Set([source.id, temporaryOrderId]), "A API deveria aceitar varias OS de obra e rejeitar PMOC")
  assert.equal(multiple.orderSummary.total, 2, "O resumo deveria considerar as duas OS de obra selecionadas")
  console.log(JSON.stringify({ ok: true, budgetWorks: budgetWorks.length, selectedWork: dashboard.selectedWork.name, points: dashboard.summary.total, testedPoint: point.name, ordersAtPoint: point.orders.length }))
} finally {
  await supabase.from("service_order_files").delete().eq("id", temporaryPhotoId)
  await supabase.from("service_orders").delete().in("id", [temporaryOrderId, temporaryPmocOrderId])
  if (userId) {
    await supabase.from("profiles").delete().eq("id", userId)
    await supabase.auth.admin.deleteUser(userId)
  }
  const remaining = await supabase.from("service_orders").select("id", { count: "exact", head: true }).in("id", [temporaryOrderId, temporaryPmocOrderId])
  assert.equal(remaining.count, 0)
  console.log("CLEANUP: OS e usuario temporarios removidos")
}
