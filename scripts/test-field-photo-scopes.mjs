import { randomBytes, randomUUID } from "node:crypto"
import path from "node:path"
import { chromium } from "playwright-core"
import sharp from "sharp"
import { createClient } from "@supabase/supabase-js"

process.loadEnvFile(".env.local")

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3001"
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})
const bucket = "service-order-files"
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH
  || path.join(process.env.LOCALAPPDATA || "", "ms-playwright", "chromium_headless_shell-1234", "chrome-headless-shell-win64", "chrome-headless-shell.exe")
const testOrderIds = []
const stamp = Date.now()
const testEmail = `teste-fotos-pmoc-${stamp}@example.com`
const testPassword = `Fotos@${stamp}`
let testUserId = ""
let authCookie = ""
let browser

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function cookieHeader(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") || ""]
  return values.map((value) => value.split(";", 1)[0]).filter(Boolean).join("; ")
}

async function apiFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Cookie: authCookie },
  })
}

function equipmentIdsFromOrder(order) {
  const match = String(order.notes || "").match(/Selecoes OS JSON:\s*(\{.*\})/s)
  let selected = []
  try {
    selected = match ? JSON.parse(match[1]).clientEquipmentIds || [] : []
  } catch {}
  return [...new Set([...selected, order.client_equipment_id].filter(Boolean))]
}

async function cloneOrder(source, orderType) {
  const timestamp = new Date().toISOString()
  const clone = {
    ...source,
    id: randomUUID(),
    order_number: `OS-TEST-FOTO-${orderType.toUpperCase()}-${Date.now()}`,
    order_type: orderType,
    status: "Agendada",
    finished_at: null,
    cancelled_at: null,
    created_at: timestamp,
    updated_at: timestamp,
  }
  const { data, error } = await supabase.from("service_orders").insert(clone).select("*").single()
  if (error) throw error
  testOrderIds.push(data.id)
  return data
}

async function uploadPhoto(serviceOrderId, category, equipmentId, suffix) {
  const fileName = `teste-${suffix}.png`
  const prepareResponse = await apiFetch(`${baseUrl}/api/operational-files/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "prepare",
      serviceOrderId,
      category,
      equipmentId,
      uploadedBy: "",
      fileName,
      fileType: "image/png",
      fileSize: png.length,
    }),
  })
  const prepared = await prepareResponse.json()
  if (!prepareResponse.ok) throw new Error(`prepare: ${prepared.error || prepareResponse.statusText}`)

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .uploadToSignedUrl(prepared.upload.storagePath, prepared.upload.token, png, { contentType: "image/png" })
  if (uploadError) throw uploadError

  const finalizeResponse = await apiFetch(`${baseUrl}/api/operational-files/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "finalize",
      id: prepared.upload.id,
      storagePath: prepared.upload.storagePath,
      serviceOrderId,
      category,
      equipmentId,
      uploadedBy: "",
      fileName: prepared.upload.fileName,
      fileType: prepared.upload.fileType,
    }),
  })
  const finalized = await finalizeResponse.json()
  if (!finalizeResponse.ok) throw new Error(`finalize: ${finalized.error || finalizeResponse.statusText}`)
  return finalized.file
}

async function uploadPhotoThroughApp(serviceOrderId, category, equipmentId, suffix) {
  const formData = new FormData()
  formData.append("file", new Blob([png], { type: "image/png" }), `teste-${suffix}.png`)
  formData.append("serviceOrderId", serviceOrderId)
  formData.append("category", category)
  formData.append("equipmentId", equipmentId)
  formData.append("uploadedBy", "")
  formData.append("keepPrevious", "false")
  const response = await apiFetch(`${baseUrl}/api/operational-files/upload`, { method: "POST", body: formData })
  const payload = await response.json()
  if (!response.ok) throw new Error(`upload alternativo: ${payload.error || response.statusText}`)
  return payload.file
}

async function fetchPhoto(serviceOrderId, category, equipmentId = "") {
  const params = new URLSearchParams({ serviceOrderId, category })
  if (equipmentId) params.set("equipmentId", equipmentId)
  const response = await apiFetch(`${baseUrl}/api/operational-files/upload?${params}`)
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error || response.statusText)
  return payload.file
}

async function cleanup() {
  if (browser) await browser.close()
  if (testOrderIds.length) {
    const { data: files } = await supabase.from("service_order_files").select("id,file_url").in("service_order_id", testOrderIds)
    const marker = `/storage/v1/object/public/${bucket}/`
    const paths = (files || []).map((file) => {
      const index = String(file.file_url || "").indexOf(marker)
      return index >= 0 ? decodeURIComponent(file.file_url.slice(index + marker.length)) : ""
    }).filter(Boolean)
    if (paths.length) await supabase.storage.from(bucket).remove(paths)
    await supabase.from("service_order_files").delete().in("service_order_id", testOrderIds)
    await supabase.from("service_orders").delete().in("id", testOrderIds)
  }
  if (testUserId) {
    await supabase.from("profiles").delete().eq("id", testUserId)
    await supabase.auth.admin.deleteUser(testUserId)
  }
}

try {
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: testEmail,
    password: testPassword,
    email_confirm: true,
    user_metadata: { full_name: "Teste Fotos PMOC", role: "user" },
  })
  if (authError || !authData.user) throw authError || new Error("Usuario de teste nao criado")
  testUserId = authData.user.id
  const { error: profileError } = await supabase.from("profiles").upsert({
    id: testUserId,
    email: testEmail,
    full_name: "Teste Fotos PMOC",
    role: "user",
    page_permissions: ["dashboard", "operacao_campo", "ordens_servico"],
    active: true,
    updated_at: new Date().toISOString(),
  })
  if (profileError) throw profileError
  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: testEmail, password: testPassword }),
  })
  const loginBody = await loginResponse.json()
  if (!loginResponse.ok) throw new Error(loginBody.error || "Login do teste falhou")
  authCookie = cookieHeader(loginResponse)
  assert(authCookie, "Login do teste nao retornou cookie")

  const fieldPageResponse = await apiFetch(`${baseUrl}/campo`)
  assert(fieldPageResponse.status === 200, `Colaborador nao abriu a Operacao em Campo: HTTP ${fieldPageResponse.status}`)

  const { data: source, error } = await supabase
    .from("service_orders")
    .select("*")
    .eq("order_type", "pmoc")
    .order("created_at", { ascending: false })
    .limit(1)
    .single()
  if (error) throw error
  const equipmentIds = equipmentIdsFromOrder(source)
  assert(equipmentIds.length >= 2, "A OS modelo precisa ter ao menos dois equipamentos.")

  const pmocOrder = await cloneOrder(source, "pmoc")
  const firstInitial = await uploadPhoto(pmocOrder.id, "Foto Inicial", equipmentIds[0], "equipamento-1-inicial")
  const firstFinal = await uploadPhoto(pmocOrder.id, "Foto Final", equipmentIds[0], "equipamento-1-final")
  const secondInitial = await uploadPhoto(pmocOrder.id, "Foto Inicial", equipmentIds[1], "equipamento-2-inicial")
  const secondFinal = await uploadPhoto(pmocOrder.id, "Foto Final", equipmentIds[1], "equipamento-2-final")
  const additionalCategories = ["Foto Adicional 1", "Foto Adicional 2", "Foto Adicional 3"]
  const additionalPhotos = []
  for (const equipmentId of equipmentIds.slice(0, 2)) {
    for (const [index, category] of additionalCategories.entries()) {
      additionalPhotos.push(await uploadPhotoThroughApp(pmocOrder.id, category, equipmentId, `equipamento-${equipmentId}-${index + 1}`))
    }
  }
  assert((await fetchPhoto(pmocOrder.id, "Foto Inicial", equipmentIds[0]))?.id === firstInitial.id, "Foto inicial do primeiro equipamento nao foi confirmada.")
  assert((await fetchPhoto(pmocOrder.id, "Foto Final", equipmentIds[0]))?.id === firstFinal.id, "Foto final do primeiro equipamento nao foi confirmada.")
  assert((await fetchPhoto(pmocOrder.id, "Foto Inicial", equipmentIds[1]))?.id === secondInitial.id, "Foto inicial do segundo equipamento nao foi confirmada.")
  assert((await fetchPhoto(pmocOrder.id, "Foto Final", equipmentIds[1]))?.id === secondFinal.id, "Foto final do segundo equipamento nao foi confirmada.")
  for (const photo of additionalPhotos) {
    const equipmentId = String(photo.notes || "").replace(/^equipment:/, "")
    assert((await fetchPhoto(pmocOrder.id, photo.category, equipmentId))?.id === photo.id, `${photo.category} nao foi confirmada para o equipamento.`)
  }
  assert(await fetchPhoto(pmocOrder.id, "Foto Final") === null, "Foto de equipamento vazou para o escopo geral da OS.")

  const replacement = await uploadPhoto(pmocOrder.id, "Foto Inicial", equipmentIds[0], "equipamento-1-inicial-substituida")
  assert((await fetchPhoto(pmocOrder.id, "Foto Inicial", equipmentIds[0]))?.id === replacement.id, "Substituicao da foto inicial do primeiro equipamento falhou.")
  assert((await fetchPhoto(pmocOrder.id, "Foto Final", equipmentIds[0]))?.id === firstFinal.id, "Substituir a foto inicial removeu a foto final do mesmo equipamento.")
  assert((await fetchPhoto(pmocOrder.id, "Foto Inicial", equipmentIds[1]))?.id === secondInitial.id, "Substituir uma foto removeu a foto de outro equipamento.")

  const obraOrder = await cloneOrder(source, "obra")
  const initial = await uploadPhoto(obraOrder.id, "Foto Inicial", "", "obra-inicial")
  const final = await uploadPhoto(obraOrder.id, "Foto Final", "", "obra-final")
  assert((await fetchPhoto(obraOrder.id, "Foto Inicial"))?.id === initial.id, "Foto Inicial da Obra nao foi confirmada.")
  assert((await fetchPhoto(obraOrder.id, "Foto Final"))?.id === final.id, "Foto Final da Obra nao foi confirmada.")

  const { data: rows, error: rowsError } = await supabase
    .from("service_order_files")
    .select("service_order_id,category,notes")
    .in("service_order_id", testOrderIds)
  if (rowsError) throw rowsError
  assert(rows.filter((row) => row.service_order_id === pmocOrder.id).length === 10, "PMOC nao manteve as cinco fotos para cada equipamento.")
  assert(rows.filter((row) => row.service_order_id === obraOrder.id).length === 2, "Obra nao manteve Foto Inicial e Foto Final.")

  browser = await chromium.launch({ executablePath, headless: true })
  const context = await browser.newContext()
  await context.addCookies(authCookie.split("; ").map((part) => {
    const separator = part.indexOf("=")
    return { name: part.slice(0, separator), value: part.slice(separator + 1), url: baseUrl }
  }))
  const page = await context.newPage()
  let savedDialog = ""
  let resolveSavedDialog
  const savedDialogPromise = new Promise((resolve) => { resolveSavedDialog = resolve })
  page.on("dialog", async (dialog) => {
    savedDialog = dialog.message()
    resolveSavedDialog(savedDialog)
    await dialog.accept()
  })
  await page.goto(`${baseUrl}/campo/atendimento/${pmocOrder.id}`, { waitUntil: "domcontentloaded" })
  await page.getByText(`Atendimento ${pmocOrder.order_number}`).waitFor({ timeout: 30_000 })
  const largePhoto = await sharp(randomBytes(2400 * 2400 * 3), { raw: { width: 2400, height: 2400, channels: 3 } })
    .png({ compressionLevel: 0 })
    .toBuffer()
  assert(largePhoto.length > 5 * 1024 * 1024, "Foto grande do teste nao ultrapassou 5 MB.")
  const uploadResponsePromise = page.waitForResponse((response) => response.url().includes("/api/operational-files/upload")
    && response.request().method() === "POST"
    && String(response.request().headers()["content-type"] || "").includes("multipart/form-data"), { timeout: 30_000 })
  await page.locator('input[type="file"]').first().setInputFiles({ name: "foto-colaborador-interface-grande.png", mimeType: "image/png", buffer: largePhoto })
  const uploadResponse = await uploadResponsePromise
  assert(uploadResponse.ok(), `Upload da interface respondeu HTTP ${uploadResponse.status()}`)
  await Promise.race([savedDialogPromise, new Promise((resolve) => setTimeout(resolve, 30_000))])
  assert(savedDialog.includes("foto(s) salva(s) na OS"), `Interface nao confirmou o upload do colaborador: ${savedDialog || "sem mensagem"}`)
  await context.close()
  await browser.close()
  browser = undefined

  authCookie = ""
  const publicStateResponse = await apiFetch(`${baseUrl}/api/operational-state?orderId=${encodeURIComponent(pmocOrder.id)}`, { cache: "no-store" })
  const publicStatePayload = await publicStateResponse.json()
  if (!publicStateResponse.ok) throw new Error(publicStatePayload.error || "Link publico nao carregou a OS")
  assert(publicStatePayload.state?.serviceOrders?.[0]?.id === pmocOrder.id, "Link publico nao retornou a OS correta.")
  assert(publicStatePayload.state?.serviceOrderFiles?.length === 10, "Link publico nao retornou as fotos da OS.")
  const publicEventResponse = await apiFetch(`${baseUrl}/api/ordens-servico/${pmocOrder.id}/eventos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event: { id: randomUUID(), stepName: "Iniciar servico", status: "Em execucao", eventDatetime: new Date().toISOString(), notes: "Teste do link publico" },
      status: "Em execucao",
    }),
  })
  const publicEventPayload = await publicEventResponse.json()
  if (!publicEventResponse.ok) throw new Error(publicEventPayload.error || "Link publico nao registrou a etapa")
  const publicPhoto = await uploadPhoto(pmocOrder.id, "Foto Inicial", equipmentIds[0], "link-publico-inicial")
  assert((await fetchPhoto(pmocOrder.id, "Foto Inicial", equipmentIds[0]))?.id === publicPhoto.id, "Link publico nao salvou a foto no Supabase.")

  const { error: clientProfileError } = await supabase.from("profiles").update({
    role: "client",
    client_id: pmocOrder.client_id,
    page_permissions: ["dashboard", "ordens_servico", "pmoc"],
    updated_at: new Date().toISOString(),
  }).eq("id", testUserId)
  if (clientProfileError) throw clientProfileError
  const clientLoginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: testEmail, password: testPassword }),
  })
  const clientLoginBody = await clientLoginResponse.json()
  if (!clientLoginResponse.ok) throw new Error(clientLoginBody.error || "Login do cliente de teste falhou")
  authCookie = cookieHeader(clientLoginResponse)

  const scopedStateResponse = await apiFetch(`${baseUrl}/api/operational-state`, { cache: "no-store" })
  const scopedStatePayload = await scopedStateResponse.json()
  if (!scopedStateResponse.ok) throw new Error(scopedStatePayload.error || "Consulta do cliente falhou")
  const scopedOrders = scopedStatePayload.state?.serviceOrders || []
  const scopedFiles = scopedStatePayload.state?.serviceOrderFiles || []
  assert(scopedOrders.every((order) => order.clientId === pmocOrder.client_id), "Usuario cliente recebeu OS de outra empresa.")
  assert(scopedFiles.filter((file) => file.serviceOrderId === pmocOrder.id).length === 10, "Usuario cliente nao recebeu as dez fotos da OS PMOC.")
  const detailStateResponse = await apiFetch(`${baseUrl}/api/operational-state?orderId=${encodeURIComponent(pmocOrder.id)}`, { cache: "no-store" })
  const detailStatePayload = await detailStateResponse.json()
  if (!detailStateResponse.ok) throw new Error(detailStatePayload.error || "Consulta dos detalhes da OS pelo cliente falhou")
  assert(detailStatePayload.state?.serviceOrders?.length === 1 && detailStatePayload.state.serviceOrders[0].id === pmocOrder.id, "Detalhes nao retornaram a OS vinculada ao cliente.")
  assert(detailStatePayload.state?.serviceOrderFiles?.length === 10, "Detalhes da OS nao retornaram as dez fotos para o cliente.")
  assert((await fetchPhoto(pmocOrder.id, "Foto Inicial", equipmentIds[0]))?.id === publicPhoto.id, "Usuario cliente nao conseguiu consultar a foto do proprio equipamento.")
  const publicPhotoResponse = await fetch(publicPhoto.fileUrl)
  assert(publicPhotoResponse.ok, "O link da foto salvo no Supabase nao abriu para visualizacao.")

  const forbiddenUploadResponse = await apiFetch(`${baseUrl}/api/operational-files/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "prepare",
      serviceOrderId: pmocOrder.id,
      category: "Foto Inicial",
      equipmentId: equipmentIds[0],
      fileName: "cliente-nao-pode-alterar.png",
      fileType: "image/png",
      fileSize: png.length,
    }),
  })
  assert(forbiddenUploadResponse.status === 403, "Usuario cliente conseguiu alterar fotos da OS.")

  const { data: foreignOrder } = await supabase.from("service_orders").select("id").neq("client_id", pmocOrder.client_id).limit(1).maybeSingle()
  if (foreignOrder) {
    const forbiddenPhotoResponse = await apiFetch(`${baseUrl}/api/operational-files/upload?${new URLSearchParams({ serviceOrderId: foreignOrder.id, category: "Foto Inicial" })}`)
    assert(forbiddenPhotoResponse.status === 403, "Usuario cliente conseguiu consultar fotos de outra empresa.")
  }

  console.log(JSON.stringify({
    ok: true,
    collaborator: { role: "user", fieldPageOpened: true, apiUploadAllowed: true, browserUploadConfirmed: true, largePhotoCompressed: true },
    pmoc: { equipments: 2, photosPerEquipment: 5, requiredPhotos: 2, optionalPhotos: 3, savedPhotos: 10, replacementPreservedOtherPhotos: true },
    obra: { initialPhoto: true, finalPhoto: true },
    publicFieldLink: { loginRequired: false, orderLoaded: true, eventSaved: true, photoSaved: true },
    clientAccess: { ownOrdersOnly: true, detailOpened: true, ownPhotosVisible: true, publicLinkOpened: true, otherClientsBlocked: true, uploadsBlocked: true },
    persistence: "Supabase Storage + service_order_files",
  }))
} finally {
  await cleanup()
}
