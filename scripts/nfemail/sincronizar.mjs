// Importação automática de notas (NFeMail -> ERP). Roda no computador da empresa (Agendador de Tarefas do Windows), 2x ao dia.
//
//   node scripts/nfemail/sincronizar.mjs                       últimos 15 dias, entrada e saída, todas as empresas do login
//   node scripts/nfemail/sincronizar.mjs --desde 2026-01-01    carga inicial / reprocesso (notas já importadas são ignoradas)
//   node scripts/nfemail/sincronizar.mjs --tipo entrada        só entrada (ou: saida)
//   node scripts/nfemail/sincronizar.mjs --contabil --desde 2026-01-01 --ate 2026-10-01   só entradas, só na aba Contabilidade (não cria financeiro)
//   node scripts/nfemail/sincronizar.mjs --contabil --tipo saida --desde 2026-01-01 --ate 2026-09-30   as notas de VENDA (saída) das empresas, só na Contabilidade
//   node scripts/nfemail/sincronizar.mjs --manual --empresa 21161569000109 --contabil --desde 2026-01-01 --ate 2026-09-30   abre o portal para VOCÊ entrar e escolher a empresa; depois baixa e importa
//   node scripts/nfemail/sincronizar.mjs --simular             não grava nada no ERP
//   node scripts/nfemail/sincronizar.mjs --zip pasta           usa ZIPs já baixados (nomes <cnpj>-entrada.zip / <cnpj>-saida.zip)
//
// Configuração em .env.local (nunca vai para o Git): NFEMAIL_EMAIL, NFEMAIL_PASSWORD, NF_SYNC_SECRET, ERP_URL.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { login, listCompanies, onlyDigits, openPortal, selectCompany, downloadXmlZip, waitForSelectedCompany } from "./nfemail-client.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..", "..")

function loadEnv() {
  for (const file of [path.join(root, ".env.local"), path.join(process.cwd(), ".env.local")]) {
    if (!fs.existsSync(file)) continue
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (match && !(match[1] in process.env)) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "")
    }
  }
}
loadEnv()

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const option = (name) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : "" }
const iso = (date) => date.toISOString().slice(0, 10)
const today = new Date()
const from = option("desde") || iso(new Date(today.getTime() - 15 * 86_400_000))
const to = option("ate") || iso(today)
const accountingOnly = flag("contabil")
const tipos = option("tipo") ? [option("tipo")] : accountingOnly ? ["entrada"] : ["entrada", "saida"]
const dryRun = flag("simular")
const zipDir = option("zip")
const limit = Number(option("limite")) || 0 // teste: só os N primeiros XMLs de cada ZIP
const ERP = (process.env.ERP_URL || "http://localhost:3000").replace(/\/$/, "")
const SECRET = process.env.NF_SYNC_SECRET || ""
const BATCH = 10
const PARALLEL = 3

const log = (...parts) => console.log(`[${new Date().toLocaleTimeString("pt-BR")}]`, ...parts)
if (!SECRET) { console.error("NF_SYNC_SECRET não configurado em .env.local."); process.exit(2) }

/** Janelas de um mês (yyyy-mm-dd) entre duas datas. */
function monthWindows(fromIso, toIso) {
  const out = []
  let cursor = new Date(`${fromIso.slice(0, 7)}-01T12:00:00Z`)
  const end = new Date(`${toIso}T12:00:00Z`)
  while (cursor <= end) {
    const year = cursor.getUTCFullYear()
    const month = cursor.getUTCMonth()
    const first = new Date(Date.UTC(year, month, 1, 12))
    const last = new Date(Date.UTC(year, month + 1, 0, 12))
    out.push({ from: (first < new Date(`${fromIso}T12:00:00Z`) ? new Date(`${fromIso}T12:00:00Z`) : first).toISOString().slice(0, 10), to: (last > end ? end : last).toISOString().slice(0, 10) })
    cursor = new Date(Date.UTC(year, month + 1, 1, 12))
  }
  return out
}

function unzip(zipPath, target) {
  fs.rmSync(target, { recursive: true, force: true })
  fs.mkdirSync(target, { recursive: true })
  const run = process.platform === "win32"
    ? spawnSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${target}' -Force`], { encoding: "utf8" })
    : spawnSync("unzip", ["-o", "-q", zipPath, "-d", target], { encoding: "utf8" })
  if (run.status !== 0) throw new Error(`Falha ao abrir o ZIP: ${run.stderr || run.stdout}`)
  return fs.readdirSync(target).filter((name) => /\.xml$/i.test(name)).map((name) => path.join(target, name))
}

async function send(cnpj, files, tipo = "entrada") {
  const form = new FormData()
  form.set("companyCnpj", cnpj)
  if (dryRun) form.set("dryRun", "1")
  if (accountingOnly) { form.set("destino", "contabilidade"); form.set("operacao", tipo) }
  for (const file of files) form.append("files", new File([fs.readFileSync(file)], path.basename(file), { type: "text/xml" }))
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(`${ERP}/api/financeiro/nf/sync`, { method: "POST", headers: { Authorization: `Bearer ${SECRET}` }, body: form })
      const body = await response.json().catch(() => ({}))
      if (response.ok) return body
      if (response.status === 404 || response.status === 401) throw Object.assign(new Error(body.error || `HTTP ${response.status}`), { fatal: true })
      if (attempt === 3) return { results: files.map((file) => ({ file: path.basename(file), status: "erro", detail: body.error || `HTTP ${response.status}` })) }
    } catch (error) {
      if (error.fatal) throw error
      if (attempt === 3) return { results: files.map((file) => ({ file: path.basename(file), status: "erro", detail: String(error.message || error) })) }
    }
    await new Promise((resolve) => setTimeout(resolve, 2000 * attempt))
  }
}

async function importFiles(cnpj, tipo, xmls) {
  const batches = []
  for (let index = 0; index < xmls.length; index += BATCH) batches.push(xmls.slice(index, index + BATCH))
  const results = []
  let done = 0
  const worker = async () => {
    while (batches.length) {
      const batch = batches.shift()
      const body = await send(cnpj, batch, tipo)
      results.push(...(body.results || []))
      done += batch.length
      if (done % 50 < BATCH || !batches.length) log(`  ${cnpj} ${tipo}: ${done}/${xmls.length}`)
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker))
  return results
}

/** Lança em Entradas e Saídas (Saída) as notas recebidas já importadas, para aparecerem no Resultado do período e na DRE. Não repete. */
async function postSaidas(cnpj) {
  const form = new FormData()
  form.set("companyCnpj", cnpj)
  form.set("acao", "lancar-saidas")
  const response = await fetch(`${ERP}/api/financeiro/nf/sync`, { method: "POST", headers: { Authorization: `Bearer ${SECRET}` }, body: form })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
  log(`${cnpj} entradas e saídas:`, JSON.stringify({ notas: body.notas, novosLancamentos: body.lancamentos, total: body.total }))
}

if (flag("lancar-saidas")) {
  for (const cnpj of option("empresa") ? [onlyDigits(option("empresa"))] : ["72295744000191", "31690385000190"]) await postSaidas(cnpj)
  process.exit(0)
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nfemail-"))
const report = { startedAt: new Date().toISOString(), from, to, dryRun, empresas: [] }
let browser
try {
  let companies
  let page
  if (zipDir) {
    companies = [...new Set(fs.readdirSync(zipDir).filter((name) => /^[0-9]{14}-.*[.]zip$/.test(name)).map((name) => name.split("-")[0]))].map((cnpj, index) => ({ index, cnpj, name: cnpj }))
  } else if (flag("manual")) {
    const cnpj = onlyDigits(option("empresa"))
    if (cnpj.length !== 14) throw new Error("Com --manual informe --empresa <CNPJ>.")
    const portal = await openPortal({ headless: false })
    browser = portal.browser
    await portal.page.goto("https://app.nfemail.com.br/", { waitUntil: "domcontentloaded" })
    log("Portal aberto: entre com o seu login e escolha a empresa na lista (o reCAPTCHA é com você).")
    const current = await waitForSelectedCompany(portal.context, cnpj, { log })
    log(`Empresa escolhida: ${current.name} (${current.cnpj}).`)
    page = await portal.context.newPage()
    page.setDefaultTimeout(45_000)
    companies = [{ ...current, manual: true }]
  } else {
    if (!process.env.NFEMAIL_EMAIL || !process.env.NFEMAIL_PASSWORD) throw new Error("NFEMAIL_EMAIL / NFEMAIL_PASSWORD não configurados em .env.local.")
    const portal = await openPortal({ headless: flag("oculto") })
    browser = portal.browser
    page = portal.page
    log("Entrando no NFeMail...")
    await login(page, process.env.NFEMAIL_EMAIL, process.env.NFEMAIL_PASSWORD)
    companies = await listCompanies(page)
  }
  for (const company of companies) {
    if (option("empresa") && onlyDigits(option("empresa")) !== company.cnpj) continue
    if (page && !company.manual) await selectCompany(page, company.index)
    const entry = { cnpj: company.cnpj, name: company.name, tipos: {} }
    for (const tipo of tipos) {
      let xmls = []
      if (zipDir) {
        const zipPath = path.join(zipDir, `${company.cnpj}-${tipo}.zip`)
        if (fs.existsSync(zipPath)) xmls = unzip(zipPath, path.join(tmp, `${company.cnpj}-${tipo}`))
      } else {
        // o portal falha em ZIPs muito grandes (ex.: 2.300 notas de saída num ano): baixa mês a mês
        for (const window of monthWindows(from, to)) {
          const zipPath = path.join(tmp, `${company.cnpj}-${tipo}-${window.from.slice(0, 7)}.zip`)
          let target = null
          for (let attempt = 1; attempt <= 2 && !target; attempt++) target = await downloadXmlZip(page, { tipo, from: window.from, to: window.to, target: zipPath })
          if (!target) { log(`${company.cnpj} ${tipo} ${window.from.slice(0, 7)}: nenhuma nota (ou o portal não gerou o ZIP).`); continue }
          xmls.push(...unzip(zipPath, path.join(tmp, `${company.cnpj}-${tipo}-${window.from.slice(0, 7)}`)))
        }
      }
      xmls = xmls.slice(0, limit || undefined)
      if (!xmls.length) { log(`${company.cnpj} ${tipo}: nenhuma nota no período.`); entry.tipos[tipo] = { baixadas: 0 }; continue }
      log(`${company.cnpj} ${tipo}: ${xmls.length} XML(s) baixado(s); enviando ao ERP${dryRun ? " (simulação)" : ""}...`)
      let results
      try {
        results = await importFiles(company.cnpj, tipo, xmls)
      } catch (error) {
        log(`${company.cnpj}: ${error.message}`)
        entry.tipos[tipo] = { baixadas: xmls.length, erroFatal: String(error.message) }
        continue
      }
      const count = (status) => results.filter((result) => result.status === status).length
      entry.tipos[tipo] = {
        baixadas: xmls.length, importadas: count("importada"), duplicadas: count("duplicada"), ignoradas: count("ignorada"), erros: count("erro"),
        pagar: results.filter((r) => r.status === "importada" && r.kind === "pagar").length, receber: results.filter((r) => r.status === "importada" && r.kind === "receber").length,
        problemas: results.filter((r) => r.status === "erro").slice(0, 30), motivosIgnoradas: Object.entries(results.filter((r) => r.status === "ignorada").reduce((acc, r) => ({ ...acc, [r.detail]: (acc[r.detail] || 0) + 1 }), {})),
      }
      log(`${company.cnpj} ${tipo}:`, JSON.stringify({ ...entry.tipos[tipo], problemas: undefined, motivosIgnoradas: undefined }))
    }
    if (!dryRun && !accountingOnly) await postSaidas(company.cnpj).catch((error) => log(`${company.cnpj}: falha ao lançar saídas: ${error.message}`))
    report.empresas.push(entry)
  }
} finally {
  if (browser) await browser.close().catch(() => {})
  fs.rmSync(tmp, { recursive: true, force: true })
  report.finishedAt = new Date().toISOString()
  const logs = path.join(here, "logs")
  fs.mkdirSync(logs, { recursive: true })
  const file = path.join(logs, `sync-${report.startedAt.replace(/[:.]/g, "-")}.json`)
  fs.writeFileSync(file, JSON.stringify(report, null, 1))
  log("Relatório:", file)
}
