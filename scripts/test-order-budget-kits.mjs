import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { createClient } from "@supabase/supabase-js"

process.loadEnvFile(".env.local")
const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3003"
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
let userId = ""

function selectedPointIds(order) {
  const line = String(order.notes || "").split(/\r?\n/).find((item) => item.startsWith("Selecoes OS JSON:"))
  const selection = line ? JSON.parse(line.replace("Selecoes OS JSON:", "").trim()) : {}
  return [...new Set([...(selection.pointIds || []), order.point_id].filter(Boolean))]
}

try {
  const email = `teste-kit-os-${randomUUID()}@example.com`
  const password = `KitOS!${randomUUID()}`
  const auth = await supabase.auth.admin.createUser({ email, password, email_confirm: true })
  if (auth.error || !auth.data.user) throw auth.error || new Error("Usuario temporario nao criado")
  userId = auth.data.user.id
  const profile = await supabase.from("profiles").upsert({ id: userId, email, full_name: "TESTE KIT DA OS", role: "admin", page_permissions: ["ordens_servico"], active: true })
  if (profile.error) throw profile.error

  const login = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })
  assert.equal(login.status, 200)
  const cookie = login.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ")
  const [registryResponse, executionResponse] = await Promise.all(["registry", "execution"].map((section) => fetch(`${baseUrl}/api/operational-state?section=${section}`, { headers: { Cookie: cookie } })))
  assert.ok(registryResponse.ok)
  assert.ok(executionResponse.ok)
  const registry = (await registryResponse.json()).state
  const execution = (await executionResponse.json()).state

  const sourceResult = await supabase.from("service_orders").select("id,order_number,point_id,notes").eq("order_type", "obra")
  if (sourceResult.error) throw sourceResult.error
  const source = sourceResult.data.find((order) => {
    const line = String(order.notes || "").split(/\r?\n/).find((item) => item.startsWith("Selecoes OS JSON:"))
    return line && !(JSON.parse(line.replace("Selecoes OS JSON:", "").trim()).kitSelections || []).length
  })
  assert.ok(source, "Nenhuma OS de obra sem kits salvos foi encontrada para o teste")
  const pointIds = selectedPointIds(source)
  const points = registry.workPoints.filter((point) => pointIds.includes(point.id))
  assert.equal(points.length, pointIds.length)
  assert.ok(points.every((point) => point.kitId), "Todos os pontos orcados da OS devem carregar kitId")
  assert.ok(execution.serviceOrders.some((order) => order.id === source.id))

  const quantities = new Map()
  for (const point of points) quantities.set(point.kitId, (quantities.get(point.kitId) || 0) + 1)
  const kits = [...quantities].map(([kitId, quantity]) => ({ kitId, name: registry.stockKits.find((kit) => kit.id === kitId)?.name, quantity }))
  assert.ok(kits.every((kit) => kit.name))
  assert.equal(kits.reduce((total, kit) => total + kit.quantity, 0), pointIds.length)
  console.log("PASS: pontos da OS carregam os kits cadastrados no orcamento")
  console.log(JSON.stringify({ ok: true, order: source.order_number, points: pointIds.length, kits }))
} finally {
  if (userId) {
    await supabase.from("profiles").delete().eq("id", userId)
    await supabase.auth.admin.deleteUser(userId)
  }
  console.log("CLEANUP: usuario temporario removido")
}
