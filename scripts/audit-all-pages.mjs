import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { chromium } from "playwright-core"
import { createClient } from "@supabase/supabase-js"

process.loadEnvFile(".env.local")

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3003"
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH
  || path.join(process.env.LOCALAPPDATA || "", "ms-playwright", "chromium_headless_shell-1234", "chrome-headless-shell-win64", "chrome-headless-shell.exe")
const outputDir = path.resolve("tmp", "page-audit")
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

let userId = ""
let browser

try {
  await mkdir(outputDir, { recursive: true })
  const email = `teste-paginas-${randomUUID()}@example.com`
  const password = `Paginas!${randomUUID()}`
  const created = await supabase.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error || !created.data.user) throw created.error || new Error("Usuario temporario nao criado")
  userId = created.data.user.id
  const profile = await supabase.from("profiles").upsert({
    id: userId,
    email,
    full_name: "TESTE TEMPORARIO TODAS AS PAGINAS",
    role: "admin",
    page_permissions: [],
    active: true,
  })
  if (profile.error) throw profile.error

  const [{ data: order }, { data: equipment }] = await Promise.all([
    supabase.from("service_orders").select("id").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("client_equipment").select("id").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ])

  const defaultRoutes = [
    "/dashboard",
    "/dashboard/obras",
    "/dashboard/ambientes",
    "/clientes-obras",
    "/servicos",
    "/pmoc",
    "/ordens-servico",
    "/equipe",
    "/campo",
    "/frota",
    "/estoque",
    "/financeiro",
    "/comercial",
    "/orcamento",
    "/contratos",
    "/relatorios",
    "/logs-sistema",
    "/configuracoes",
    "/users",
    ...(order?.id ? [`/ordens-servico/${order.id}`, `/campo/atendimento/${order.id}`, `/campo/checklist/${order.id}`] : []),
    ...(equipment?.id ? [`/equipamento/${equipment.id}`] : []),
  ]
  const routes = process.env.AUDIT_ROUTES
    ? process.env.AUDIT_ROUTES.split(",").map((route) => route.trim()).filter(Boolean)
    : defaultRoutes

  browser = await chromium.launch({ executablePath, headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "pt-BR" })
  const page = await context.newPage()
  const consoleErrors = []
  const pageErrors = []
  const failedRequests = []
  const badResponses = []
  const requestTimings = []

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })
  page.on("pageerror", (error) => pageErrors.push(error.message))
  page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()} - ${request.failure()?.errorText || "failed"}`))
  page.on("requestfinished", (request) => {
    const timing = request.timing()
    if (timing.responseEnd >= 0) requestTimings.push({ method: request.method(), url: request.url(), durationMs: Math.round(timing.responseEnd) })
  })
  page.on("response", (response) => {
    if (response.status() >= 400) badResponses.push(`${response.status()} ${response.request().method()} ${response.url()}`)
  })

  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded", timeout: 60_000 })
  await page.locator("#email").fill(email)
  await page.locator("#password").fill(password)
  await page.getByRole("button", { name: "Entrar" }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 60_000 })
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {})

  const results = []
  for (const route of routes) {
    consoleErrors.length = 0
    pageErrors.length = 0
    failedRequests.length = 0
    badResponses.length = 0
    requestTimings.length = 0
    const startedAt = performance.now()
    let navigationError = ""
    try {
      const response = await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded", timeout: 60_000 })
      if (response && response.status() >= 400) navigationError = `HTTP ${response.status()}`
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {})
      await page.waitForTimeout(300)
    } catch (error) {
      navigationError = error instanceof Error ? error.message : String(error)
    }

    const snapshot = await page.evaluate(() => {
      const bodyText = document.body?.innerText || ""
      const visibleError = bodyText.split("\n").find((line) => /erro ao carregar|failed to fetch|application error|nao foi possivel carregar/i.test(line)) || ""
      return {
        url: location.pathname,
        title: document.title,
        heading: document.querySelector("h1")?.textContent?.trim() || "",
        bodyLength: bodyText.length,
        visibleError: visibleError.slice(0, 300),
      }
    }).catch(() => ({ url: "", title: "", heading: "", bodyLength: 0, visibleError: "pagina sem DOM" }))

    const relevantResponses = badResponses.filter((item) => !item.includes("/api/system-logs") && !item.includes("/_vercel/insights/"))
    const relevantFailedRequests = failedRequests.filter((item) => !item.includes("/_vercel/insights/") && !(item.includes("?_rsc=") && item.includes("ERR_ABORTED")))
    const relevantConsoleErrors = consoleErrors.filter((item) => item !== "Failed to load resource: the server responded with a status of 404 (Not Found)" || relevantResponses.length)
    const visibleError = route === "/logs-sistema" ? "" : snapshot.visibleError
    const ok = !navigationError && !visibleError && !pageErrors.length && !relevantFailedRequests.length && !relevantResponses.length && snapshot.bodyLength > 0
    const result = {
      route,
      ok,
      durationMs: Math.round(performance.now() - startedAt),
      ...snapshot,
      visibleError,
      navigationError,
      consoleErrors: [...new Set(relevantConsoleErrors)].slice(0, 10),
      pageErrors: [...new Set(pageErrors)].slice(0, 10),
      failedRequests: [...new Set(relevantFailedRequests)].slice(0, 10),
      badResponses: [...new Set(relevantResponses)].slice(0, 10),
      slowRequests: [...requestTimings].sort((left, right) => right.durationMs - left.durationMs).slice(0, 8),
    }
    results.push(result)
    console.log(`${ok ? "PASS" : "FAIL"} ${route} ${result.durationMs}ms ${snapshot.heading || snapshot.title}`)
    if (!ok) await page.screenshot({ path: path.join(outputDir, `${route.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "root"}.png`), fullPage: true })
  }

  const report = {
    generatedAt: new Date().toISOString(),
    total: results.length,
    passed: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    slowest: [...results].sort((left, right) => right.durationMs - left.durationMs).slice(0, 10).map(({ route, durationMs }) => ({ route, durationMs })),
    results,
  }
  await writeFile(path.join(outputDir, "report.json"), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ total: report.total, passed: report.passed, failed: report.failed, slowest: report.slowest }))
  if (report.failed) process.exitCode = 1
} finally {
  if (browser) await browser.close()
  if (userId) {
    await supabase.from("profiles").delete().eq("id", userId)
    await supabase.auth.admin.deleteUser(userId)
  }
  console.log("CLEANUP: navegador e usuario temporario removidos")
}
