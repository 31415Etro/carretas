import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import path from "node:path"
import { chromium } from "playwright-core"
import { createClient } from "@supabase/supabase-js"

process.loadEnvFile(".env.local")
const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3001"
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH
  || path.join(process.env.LOCALAPPDATA || "", "ms-playwright", "chromium_headless_shell-1234", "chrome-headless-shell-win64", "chrome-headless-shell.exe")
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const email = `teste-landscape-os-${randomUUID()}@example.com`
const password = `LandscapeOS!${randomUUID()}`
let userId = ""
let orderId = ""
let browser

try {
  const staleProfiles = await db.from("profiles").select("id").ilike("email", "teste-landscape-os-%@example.com")
  if (!staleProfiles.error) {
    for (const stale of staleProfiles.data || []) {
      await db.from("profiles").delete().eq("id", stale.id)
      await db.auth.admin.deleteUser(stale.id)
    }
  }
  const workResult = await db.from("works").select("id,client_id,code,name,type").ilike("name", "%landscape%").single()
  if (workResult.error) throw workResult.error
  const work = workResult.data
  const clientResult = await db.from("clients").select("id,name").eq("id", work.client_id).single()
  if (clientResult.error) throw clientResult.error

  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true })
  if (auth.error || !auth.data.user) throw auth.error || new Error("Usuario temporario nao criado")
  userId = auth.data.user.id
  const profile = await db.from("profiles").upsert({ id: userId, email, full_name: "TESTE OS LANDSCAPE", role: "admin", page_permissions: ["ordens_servico"], active: true })
  if (profile.error) throw profile.error

  browser = await chromium.launch({ executablePath, headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const login = await context.request.post(`${baseUrl}/api/auth/login`, { data: { email, password } })
  assert.equal(login.status(), 200)
  const page = await context.newPage()
  const startedAt = Date.now()
  await page.goto(`${baseUrl}/ordens-servico`, { waitUntil: "domcontentloaded", timeout: 180_000 })
  await page.getByRole("button", { name: "Nova OS Obra" }).waitFor({ timeout: 120_000 })
  await page.waitForTimeout(5_000)
  await page.getByRole("button", { name: "Nova OS Obra" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.waitFor({ timeout: 60_000 })

  const workField = page.locator("label", { hasText: "Obra vinculada" }).locator("..").getByRole("combobox")
  await workField.click()
  await page.getByPlaceholder("Pesquisar...").fill("Landscape")
  await page.getByRole("option").filter({ hasText: work.name }).click()
  assert.match(await page.locator("label", { hasText: "Cliente" }).filter({ hasText: /^Cliente$/ }).locator("..").getByRole("combobox").innerText(), new RegExp(clientResult.data.name))

  await page.getByRole("tab", { name: "6 - Materiais" }).click()
  const workKitRows = await dialog.getByRole("button", { name: "Remover" }).count()
  assert.ok(workKitRows > 0, "LANDSCAPE nao carregou os kits do orcamento")

  await page.getByRole("tab", { name: "2 - Local" }).click()
  const floorSection = page.locator('[data-checklist-field="Pavimento"]')
  const floorCount = await floorSection.locator("div.rounded-md label").count()
  assert.ok(floorCount > 0, "LANDSCAPE nao exibiu pavimentos")
  const pointSection = page.locator('[data-checklist-field="Ponto"]')
  const allPointCount = await pointSection.locator("div.rounded-md label").count()
  assert.equal(allPointCount, 0, "LANDSCAPE renderizou todos os pontos antes do filtro")
  const floorCheckbox = floorSection.getByRole("checkbox").first()
  await floorCheckbox.click()
  await page.waitForTimeout(3_000)
  const selectedFloorState = await floorCheckbox.getAttribute("data-state")
  const filteredPointCount = await pointSection.locator("div.rounded-md label").count()
  assert.equal(selectedFloorState, "checked", "O pavimento LANDSCAPE nao ficou selecionado")
  assert.ok(filteredPointCount > 0 && filteredPointCount < 1456, `Filtro LANDSCAPE retornou ${filteredPointCount} pontos`)
  await pointSection.locator("div.rounded-md label").first().click()

  await page.getByRole("tab", { name: "3 - Tipo" }).click()
  const serviceSection = page.locator('[data-checklist-field="Tipos de servico"]')
  assert.ok(await serviceSection.getByRole("checkbox", { checked: true }).count() > 0, "Servico do ponto LANDSCAPE nao foi selecionado")
  await dialog.locator("textarea:visible").fill("TESTE TEMPORARIO - OS ROGGA LANDSCAPE")

  await page.getByRole("tab", { name: "6 - Materiais" }).click()
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const remove = dialog.getByRole("button", { name: "Remover" }).first()
    if (await remove.count() === 0) break
    await remove.click()
    await page.waitForTimeout(80)
  }
  assert.equal(await dialog.getByRole("button", { name: "Remover" }).count(), 0)

  await page.getByRole("tab", { name: "7 - Revisao" }).click()
  const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/ordens-servico") && response.request().method() === "POST", { timeout: 120_000 })
  await page.getByRole("button", { name: "Criar OS", exact: true }).click()
  const response = await responsePromise
  assert.equal(response.status(), 200, await response.text())
  const saved = (await response.json()).data
  orderId = saved.id
  const row = await db.from("service_orders").select("id,order_number,order_type,work_id,point_id,service_type_id,status").eq("id", orderId).single()
  if (row.error) throw row.error
  assert.equal(row.data.work_id, work.id)
  assert.equal(row.data.order_type, "obra")
  assert.ok(row.data.point_id && row.data.service_type_id)
  const detail = await context.request.get(`${baseUrl}/ordens-servico/${orderId}`)
  assert.equal(detail.status(), 200)
  console.log(JSON.stringify({ ok: true, orderNumber: row.data.order_number, work: work.name, groupedFloors: floorCount, deferredInitialPoints: allPointCount, budgetPoints: 1456, filteredPoints: filteredPointCount, workKitRows, durationMs: Date.now() - startedAt }))
} finally {
  if (browser) await browser.close()
  if (orderId) {
    for (const table of ["service_order_events", "service_order_files", "service_order_checklist_items", "service_order_materials", "accounts_receivable", "audit_logs"]) {
      await db.from(table).delete().eq(table === "audit_logs" ? "entity_id" : "service_order_id", orderId)
    }
    await db.from("service_orders").delete().eq("id", orderId)
  }
  if (userId) {
    try {
      await db.from("profiles").delete().eq("id", userId)
      await db.auth.admin.deleteUser(userId)
    } catch (error) {
      console.error(`Falha ao limpar usuario temporario ${userId}:`, error)
    }
  }
}
