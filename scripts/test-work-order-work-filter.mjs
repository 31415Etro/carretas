import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import path from "node:path"
import { chromium } from "playwright-core"
import { createClient } from "@supabase/supabase-js"

process.loadEnvFile(".env.local")

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3001"
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH
  || path.join(process.env.LOCALAPPDATA || "", "ms-playwright", "chromium_headless_shell-1234", "chrome-headless-shell-win64", "chrome-headless-shell.exe")
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const email = `teste-filtro-os-obra-${randomUUID()}@example.com`
const password = `Filtro!${randomUUID()}`
let userId = ""
let orderId = ""
let browser

async function selectSearchable(page, label, option) {
  const field = page.locator("label", { hasText: label }).filter({ hasText: new RegExp(`^${label}$`) }).locator("..")
  await field.getByRole("combobox").click()
  await page.getByPlaceholder("Pesquisar...").fill(option)
  await page.getByText(option, { exact: true }).last().click()
}

try {
  const [worksResult, floorsResult, environmentsResult, pointsResult, clientsResult] = await Promise.all([
    db.from("works").select("id,client_id,code,name,type,status,notes"),
    db.from("work_floors").select("id,work_id,name,status"),
    db.from("work_environments").select("id,work_id,floor_id,environment_name,status"),
    db.from("work_points").select("id,work_id,environment_id,point_name,status"),
    db.from("clients").select("id,name,status"),
  ])
  for (const result of [worksResult, floorsResult, environmentsResult, pointsResult, clientsResult]) {
    if (result.error) throw result.error
  }

  const works = worksResult.data || []
  const floors = floorsResult.data || []
  const environments = environmentsResult.data || []
  const points = pointsResult.data || []
  const clients = clientsResult.data || []
  const work = works.find((candidate) => {
    if (candidate.type !== "Orçamento" || (candidate.notes && !candidate.notes.includes("__budget_kind:obra"))) return false
    const workPoints = points.filter((point) => point.work_id === candidate.id && point.status !== "Inativo")
    const pointFloorIds = new Set(workPoints.map((point) => environments.find((environment) => environment.id === point.environment_id)?.floor_id).filter(Boolean))
    return candidate.client_id && pointFloorIds.size >= 2
  })
  assert.ok(work, "Nenhuma obra com pontos em dois pavimentos foi encontrada para o teste.")
  const workClient = clients.find((client) => client.id === work.client_id)
  const otherClient = clients.find((client) => client.id !== work.client_id && client.status !== "Inativo" && client.name !== workClient?.name)
  assert.ok(workClient && otherClient, "Clientes para validar a independencia da obra nao foram encontrados.")

  const workPoints = points.filter((point) => point.work_id === work.id && point.status !== "Inativo")
  const pointWithFloor = workPoints.map((point) => ({
    point,
    environment: environments.find((environment) => environment.id === point.environment_id),
  })).find((item) => item.environment?.floor_id)
  assert.ok(pointWithFloor?.environment, "Ponto da obra sem pavimento vinculado.")
  const selectedFloor = floors.find((floor) => floor.id === pointWithFloor.environment.floor_id)
  assert.ok(selectedFloor, "Nao foi possivel montar o filtro de pavimento.")
  const created = await db.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error || !created.data.user) throw created.error || new Error("Usuario temporario nao criado.")
  userId = created.data.user.id
  const profile = await db.from("profiles").upsert({
    id: userId,
    email,
    full_name: "TESTE FILTRO OS OBRA",
    role: "admin",
    page_permissions: ["ordens_servico"],
    active: true,
  })
  if (profile.error) throw profile.error

  browser = await chromium.launch({ executablePath, headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const login = await context.request.post(`${baseUrl}/api/auth/login`, { data: { email, password } })
  assert.equal(login.status(), 200, `Login retornou HTTP ${login.status()}`)
  const page = await context.newPage()
  await page.goto(`${baseUrl}/ordens-servico`, { waitUntil: "domcontentloaded", timeout: 180_000 })
  await page.getByRole("button", { name: "Nova OS Obra" }).waitFor({ timeout: 90_000 })
  await page.waitForTimeout(5_000)
  await page.getByRole("button", { name: "Nova OS Obra" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.waitFor({ timeout: 60_000 })

  await selectSearchable(page, "Cliente", otherClient.name)
  const workField = page.locator("label", { hasText: "Obra vinculada" }).locator("..").getByRole("combobox")
  await workField.click()
  const availableWorkLabels = await page.getByRole("option").allInnerTexts()
  assert.ok(availableWorkLabels.length > 0, "Nenhum orcamento de obra apareceu no seletor.")
  assert.ok(availableWorkLabels.every((label) => label.startsWith("ORC-") && !/PMOC|Servicos diversos/i.test(label)), "PMOC ou Servicos diversos apareceu como obra.")
  await page.getByPlaceholder("Pesquisar...").fill(work.name)
  const workOption = page.getByText(new RegExp(`${work.name}.*${workClient.name}`)).last()
  await workOption.waitFor()
  await workOption.click()
  assert.match(await page.locator("label", { hasText: "Cliente" }).filter({ hasText: /^Cliente$/ }).locator("..").getByRole("combobox").innerText(), new RegExp(workClient.name), "A obra nao preencheu seu cliente vinculado.")

  await page.getByRole("tab", { name: "6 - Materiais" }).click()
  const budgetKitRowsBeforePoint = await dialog.getByRole("button", { name: "Remover" }).count()
  assert.ok(budgetKitRowsBeforePoint > 0, "Os kits do orcamento nao apareceram ao selecionar a obra.")

  await page.getByRole("tab", { name: "2 - Local" }).click()
  await page.getByText(selectedFloor.name, { exact: true }).waitFor()
  const pointSection = page.locator('[data-checklist-field="Ponto"]')
  const pointsBeforeFloorFilter = await pointSection.locator("div.rounded-md label").count()
  assert.ok(pointsBeforeFloorFilter >= workPoints.length, "A obra nao listou todos os seus pontos antes do filtro.")

  await page.getByText(selectedFloor.name, { exact: true }).click()
  await page.waitForFunction(({ before }) => {
    const section = document.querySelector('[data-checklist-field="Ponto"]')
    const count = section?.querySelectorAll("div.rounded-md label").length || 0
    return count > 0 && count < before
  }, { before: pointsBeforeFloorFilter })
  const pointsAfterFloorFilter = await pointSection.locator("div.rounded-md label").count()
  assert.ok(pointsAfterFloorFilter > 0 && pointsAfterFloorFilter < pointsBeforeFloorFilter, "Os pontos nao foram filtrados pelo pavimento selecionado.")

  await pointSection.locator("div.rounded-md label").first().click()
  assert.equal(await pointSection.getByRole("checkbox", { checked: true }).count(), 1, "O ponto nao ficou selecionado.")

  await page.getByRole("tab", { name: "3 - Tipo" }).click()
  const serviceSection = page.locator('[data-checklist-field="Tipos de servico"]')
  if (await serviceSection.getByRole("checkbox", { checked: true }).count() === 0) {
    await serviceSection.locator("div.rounded-md label").first().click()
  }
  assert.ok(await serviceSection.getByRole("checkbox", { checked: true }).count() > 0, "Nenhum tipo de servico ficou selecionado.")
  await page.getByRole("dialog").locator("textarea:visible").fill("TESTE TEMPORARIO - CRIACAO DE OS DE OBRA PELA INTERFACE")

  await page.getByRole("tab", { name: "6 - Materiais" }).click()
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const remove = dialog.getByRole("button", { name: "Remover" }).first()
    if (await remove.count() === 0) break
    await remove.click()
    await page.waitForTimeout(100)
  }
  assert.equal(await dialog.getByRole("button", { name: "Remover" }).count(), 0, "Nao foi possivel retirar os kits do teste sem afetar o estoque.")

  await page.getByRole("tab", { name: "7 - Revisao" }).click()
  const createResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/ordens-servico") && response.request().method() === "POST", { timeout: 90_000 })
  await page.getByRole("button", { name: "Criar OS", exact: true }).click()
  const createResponse = await createResponsePromise
  assert.equal(createResponse.status(), 200, `Criar OS retornou HTTP ${createResponse.status()}: ${await createResponse.text()}`)
  const createdOrder = (await createResponse.json()).data
  orderId = createdOrder?.id || ""
  assert.ok(orderId, "A API nao retornou o identificador da OS criada.")
  await dialog.waitFor({ state: "hidden", timeout: 60_000 })

  const [savedOrder, savedMaterials] = await Promise.all([
    db.from("service_orders").select("id,order_number,order_type,client_id,work_id,point_id,service_type_id,status,description").eq("id", orderId).single(),
    db.from("service_order_materials").select("id").eq("service_order_id", orderId),
  ])
  if (savedOrder.error) throw savedOrder.error
  if (savedMaterials.error) throw savedMaterials.error
  assert.equal(savedOrder.data.order_type, "obra")
  assert.equal(savedOrder.data.client_id, work.client_id)
  assert.equal(savedOrder.data.work_id, work.id)
  assert.ok(savedOrder.data.point_id, "A OS foi salva sem o ponto selecionado.")
  assert.ok(savedOrder.data.service_type_id, "A OS foi salva sem o tipo de servico.")
  assert.equal(savedOrder.data.status, "Criada")
  assert.equal(savedOrder.data.description, "TESTE TEMPORARIO - CRIACAO DE OS DE OBRA PELA INTERFACE")
  assert.equal(savedMaterials.data.length, 0, "O teste alteraria o estoque por conter materiais.")
  const detailPage = await context.request.get(`${baseUrl}/ordens-servico/${orderId}`)
  assert.equal(detailPage.status(), 200, `Abrir o detalhe da OS retornou HTTP ${detailPage.status()}`)

  console.log(JSON.stringify({
    ok: true,
    allWorksVisibleWithoutMatchingClient: true,
    onlyBudgetWorksVisible: true,
    pmocAndDiverseServicesExcluded: true,
    workClientSelectedAutomatically: true,
    floorsFilteredByWork: true,
    pointsFilteredByWorkAndFloor: true,
    createdThroughForm: true,
    persistedInDatabase: true,
    detailPageOpened: true,
    stockUnaffected: true,
    budgetKitsLoadedFromWork: true,
    budgetKitRowsBeforePoint,
    orderNumber: savedOrder.data.order_number,
    work: work.name,
    floor: selectedFloor.name,
    pointsBeforeFloorFilter,
    pointsAfterFloorFilter,
  }))
} finally {
  if (browser) await browser.close()
  if (orderId) {
    for (const table of ["service_order_events", "service_order_files", "service_order_checklist_items", "service_order_materials", "accounts_receivable", "audit_logs"]) {
      const column = table === "audit_logs" ? "entity_id" : "service_order_id"
      await db.from(table).delete().eq(column, orderId)
    }
    await db.from("service_orders").delete().eq("id", orderId)
  }
  if (userId) {
    await db.from("profiles").delete().eq("id", userId)
    await db.auth.admin.deleteUser(userId)
  }
  if (orderId) {
    const remaining = await db.from("service_orders").select("id", { count: "exact", head: true }).eq("id", orderId)
    assert.equal(remaining.count, 0, "A OS temporaria nao foi removida.")
  }
}
