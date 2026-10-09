import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { createClient } from "@supabase/supabase-js"

process.loadEnvFile(".env.local")
const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3003"
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
const orderId = randomUUID()
const orderNumber = `OS-TEST-CAMPO-${Date.now()}`
let userId = ""
let cookie = ""
const uploadedPaths = []

function cookieHeader(response) {
  return response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ")
}

async function api(path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(180000),
    ...options,
    headers: { ...(options.headers || {}), ...(cookie ? { Cookie: cookie } : {}) },
  })
}

async function json(response, expected, label) {
  const text = await response.text()
  assert.equal(response.status, expected, `${label}: HTTP ${response.status} ${text.slice(0, 400)}`)
  console.log(`PASS: ${label}`)
  return text ? JSON.parse(text) : null
}

async function event(stepName, status, notes = "", finishedAt = "") {
  return json(await api(`/api/ordens-servico/${orderId}/eventos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event: {
        id: randomUUID(), serviceOrderId: orderId, stepName, status,
        providerId: "", eventDatetime: new Date().toISOString(), notes,
      },
      status,
      finishedAt,
    }),
  }), 200, stepName)
}

async function uploadPhoto(category) {
  const fileName = `teste-${category === "Foto Inicial" ? "inicio" : "fim"}-operacao-campo.png`
  const prepared = await json(await api("/api/operational-files/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "prepare", serviceOrderId: orderId, category, equipmentId: "", uploadedBy: "", fileName, fileType: "image/png", fileSize: png.length }),
  }), 200, `autorizar ${category.toLowerCase()}`)
  uploadedPaths.push(prepared.upload.storagePath)
  const upload = await supabase.storage.from("service-order-files").uploadToSignedUrl(prepared.upload.storagePath, prepared.upload.token, png, { contentType: "image/png" })
  if (upload.error) throw upload.error
  const saved = await json(await api("/api/operational-files/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "finalize", id: prepared.upload.id, storagePath: prepared.upload.storagePath, serviceOrderId: orderId, category, equipmentId: "", uploadedBy: "", fileName: prepared.upload.fileName, fileType: prepared.upload.fileType }),
  }), 200, `salvar e confirmar ${category.toLowerCase()}`)
  assert.equal(saved.file.serviceOrderId, orderId)
  assert.equal(saved.file.category, category)
}

try {
  const sourceResult = await supabase.from("service_orders").select("*").not("client_id", "is", null).not("work_id", "is", null).limit(1).single()
  if (sourceResult.error) throw sourceResult.error
  const now = new Date().toISOString()
  const source = sourceResult.data
  const order = {
    ...source,
    id: orderId,
    order_number: orderNumber,
    order_type: "obra",
    point_id: null,
    status: "Agendada",
    description: "TESTE TEMPORARIO - OPERACAO EM CAMPO",
    notes: "Registro temporario criado pelo teste automatizado.",
    total_amount: 123.45,
    finished_at: null,
    cancelled_at: null,
    created_at: now,
    updated_at: now,
  }
  const inserted = await supabase.from("service_orders").insert(order)
  if (inserted.error) throw inserted.error

  const email = `teste-campo-${randomUUID()}@example.com`
  const password = `Campo!${randomUUID()}`
  const auth = await supabase.auth.admin.createUser({ email, password, email_confirm: true })
  if (auth.error || !auth.data.user) throw auth.error || new Error("Usuario temporario nao criado")
  userId = auth.data.user.id
  const profile = await supabase.from("profiles").upsert({
    id: userId, email, full_name: "TESTE TEMPORARIO CAMPO", role: "admin",
    page_permissions: ["operacao_campo", "ordens_servico"], active: true,
  })
  if (profile.error) throw profile.error

  const login = await api("/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }),
  })
  cookie = cookieHeader(login)
  await json(login, 200, "login do tecnico temporario")
  assert.ok(cookie, "Login nao retornou cookie")

  const legacyPage = await api("/operacao-campo")
  assert.equal(legacyPage.status, 307)
  assert.equal(legacyPage.headers.get("location"), "/campo")
  console.log("PASS: rota antiga redireciona para /campo")
  const page = await api("/campo")
  const html = await page.text()
  assert.equal(page.status, 200, `Tela Operacao em Campo: HTTP ${page.status}; destino ${page.headers.get("location") || "-"}; cookies ${cookie ? "presentes" : "ausentes"}`)
  assert.doesNotMatch(html, /"digest":"\d+"/)
  console.log("PASS: abrir Operacao em Campo autenticada")

  const sections = await Promise.all(["registry", "pmoc", "execution"].map(async (section) => json(await api(`/api/operational-state?section=${section}`), 200, `carregar dados ${section}`)))
  const state = Object.assign({}, ...sections.map((part) => part.state))
  const loadedOrder = state.serviceOrders.find((item) => item.id === orderId)
  assert.equal(loadedOrder?.status, "Agendada")
  console.log("PASS: OS temporaria aparece na Operacao em Campo")

  const started = await event("Iniciar servico", "Em execucao")
  assert.equal(started.order.status, "Em execucao")
  const afterStart = await json(await api(`/api/ordens-servico/${orderId}/eventos`), 200, "recarregar OS iniciada")
  assert.equal(afterStart.order.status, "Em execucao")
  assert.equal(afterStart.events.filter((item) => item.stepName === "Iniciar servico").length, 1)

  const duplicate = await api(`/api/ordens-servico/${orderId}/eventos`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: { id: randomUUID(), stepName: "Iniciar servico", status: "Em execucao" }, status: "Em execucao" }),
  })
  assert.equal(duplicate.status, 409)
  console.log("PASS: impedir inicio duplicado")

  await uploadPhoto("Foto Inicial")
  const initialPhoto = await json(await api(`/api/operational-files/upload?${new URLSearchParams({ serviceOrderId: orderId, category: "Foto Inicial" })}`), 200, "recarregar foto inicial confirmada")
  assert.equal(initialPhoto.file?.category, "Foto Inicial")

  const prematureFinish = await api(`/api/ordens-servico/${orderId}/eventos`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: { id: randomUUID(), stepName: "Finalizar servico", status: "Finalizada", notes: "Ainda falta a foto final." }, status: "Finalizada", finishedAt: new Date().toISOString() }),
  })
  assert.equal(prematureFinish.status, 400)
  assert.match((await prematureFinish.json()).error, /Foto Final/)
  console.log("PASS: impedir finalizacao somente com a foto inicial")

  await uploadPhoto("Foto Final")
  const finalPhoto = await json(await api(`/api/operational-files/upload?${new URLSearchParams({ serviceOrderId: orderId, category: "Foto Final" })}`), 200, "recarregar foto final confirmada")
  assert.equal(finalPhoto.file?.category, "Foto Final")
  const bothPhotos = await json(await api(`/api/operational-files/upload?${new URLSearchParams({ serviceOrderId: orderId })}`), 200, "recarregar fotos inicial e final")
  assert.deepEqual(new Set(bothPhotos.files.map((file) => file.category)), new Set(["Foto Inicial", "Foto Final"]))

  const finishedAt = new Date().toISOString()
  const finished = await event("Finalizar servico", "Finalizada", "Teste automatizado finalizado com foto salva.", finishedAt)
  assert.equal(finished.order.status, "Finalizada")
  const afterFinish = await json(await api(`/api/ordens-servico/${orderId}/eventos`), 200, "recarregar OS finalizada")
  assert.equal(afterFinish.order.status, "Finalizada")
  assert.ok(afterFinish.order.finished_at)
  assert.deepEqual(new Set(afterFinish.events.map((item) => item.stepName)), new Set(["Iniciar servico", "Finalizar servico"]))
  assert.equal(afterFinish.events.find((item) => item.stepName === "Finalizar servico")?.notes, "Teste automatizado finalizado com foto salva.")

  const receivable = await supabase.from("accounts_receivable").select("id,expected_amount,status,origin").eq("service_order_id", orderId).maybeSingle()
  if (receivable.error) throw receivable.error
  assert.equal(Number(receivable.data?.expected_amount), 123.45)
  assert.equal(receivable.data?.origin, "OS")
  console.log("PASS: gerar conta a receber ao finalizar")

  const completedState = await json(await api("/api/operational-state?section=execution"), 200, "recarregar Operacao em Campo finalizada")
  assert.equal(completedState.state.serviceOrders.find((item) => item.id === orderId)?.status, "Finalizada")
  console.log(JSON.stringify({ ok: true, orderNumber, started: true, initialPhotoSaved: true, finalPhotoSaved: true, finalized: true, receivableCreated: true }))
} finally {
  if (orderId) {
    const files = await supabase.from("service_order_files").select("file_url").eq("service_order_id", orderId)
    if (!files.error) {
      const marker = "/storage/v1/object/public/service-order-files/"
      const paths = (files.data || []).map((file) => {
        const index = String(file.file_url || "").indexOf(marker)
        return index >= 0 ? decodeURIComponent(file.file_url.slice(index + marker.length)) : ""
      }).filter(Boolean)
      if (paths.length) await supabase.storage.from("service-order-files").remove(paths)
    }
    for (const table of ["service_order_events", "service_order_files", "accounts_receivable"]) {
      await supabase.from(table).delete().eq("service_order_id", orderId)
    }
    await supabase.from("service_orders").delete().eq("id", orderId)
  }
  if (uploadedPaths.length) await supabase.storage.from("service-order-files").remove(uploadedPaths)
  if (userId) {
    await supabase.from("profiles").delete().eq("id", userId)
    await supabase.auth.admin.deleteUser(userId)
  }
  const [remainingOrder, remainingEvents, remainingFiles, remainingReceivable] = await Promise.all([
    supabase.from("service_orders").select("id", { count: "exact", head: true }).eq("id", orderId),
    supabase.from("service_order_events").select("id", { count: "exact", head: true }).eq("service_order_id", orderId),
    supabase.from("service_order_files").select("id", { count: "exact", head: true }).eq("service_order_id", orderId),
    supabase.from("accounts_receivable").select("id", { count: "exact", head: true }).eq("service_order_id", orderId),
  ])
  assert.deepEqual([remainingOrder.count, remainingEvents.count, remainingFiles.count, remainingReceivable.count], [0, 0, 0, 0])
  console.log("CLEANUP: OS, eventos, foto, conta e usuario temporarios removidos")
}
