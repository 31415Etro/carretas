// Robô de emissão de NF-e (ERP -> NFeMail). Roda no servidor, disparado pelo ERP quando alguém emite/cancela, e esvazia a fila.
//
//   node scripts/nfemail/emitir.mjs                    processa a fila do ERP (emissões e cancelamentos pedidos)
//   node scripts/nfemail/emitir.mjs --ensaio arq.json --empresa 72295744000191
//        preenche o formulário do NFeMail com o payload do arquivo até os itens e o pagamento e PARA: não salva, não valida, não transmite.
//
// Configuração em .env.local (nunca vai para o Git): NFEMAIL_EMAIL, NFEMAIL_PASSWORD, NF_SYNC_SECRET, ERP_URL.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { login, listCompanies, onlyDigits, openPortal, selectCompany } from "./nfemail-client.mjs"
import { addItem, cancelNote, downloadXml, fillHeader, fillPayment, fillRecipient, fillTransportAndInfo, openNewNfe, saveAndTransmit } from "./emissao-portal.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..", "..")
for (const file of [path.join(root, ".env.local"), path.join(process.cwd(), ".env.local")]) {
  if (!fs.existsSync(file)) continue
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (match && !(match[1] in process.env)) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "")
  }
}

const args = process.argv.slice(2)
const option = (name) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : "" }
const ERP = (process.env.ERP_URL || "http://127.0.0.1:3000").replace(/\/$/, "")
const SECRET = process.env.NF_SYNC_SECRET || ""
const LOCK = path.join(os.tmpdir(), "nd-emitir-nfe.lock")
const LOGDIR = path.join(here, "logs", "emissao")
const log = (...parts) => console.log(`[${new Date().toLocaleTimeString("pt-BR")}]`, ...parts)

async function api(body) {
  const response = await fetch(`${ERP}/api/financeiro/nf/emissao/worker`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` }, body: JSON.stringify(body) })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || `ERP respondeu ${response.status}`)
  return payload
}

function xmlFrom(file) {
  const buffer = fs.readFileSync(file)
  if (buffer.slice(0, 2).toString() === "PK") {
    const result = spawnSync("unzip", ["-p", file], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 })
    return String(result.stdout || "")
  }
  return buffer.toString("utf8")
}

async function selectPortalCompany(page, state, cnpj) {
  if (state.current === cnpj) return
  const companies = await listCompanies(page)
  const target = companies.find((company) => company.cnpj === cnpj)
  if (!target) throw new Error(`O CNPJ ${cnpj} não está entre as empresas do login do NFeMail (${companies.map((company) => company.cnpj).join(", ")}).`)
  await selectCompany(page, target.index)
  state.current = cnpj
}

async function fillAll(page, payload, say) {
  await openNewNfe(page)
  await fillHeader(page, payload.header)
  await fillRecipient(page, payload.recipient, say)
  for (const item of payload.items) await addItem(page, item, say, LOGDIR)
  const total = payload.items.reduce((sum, item) => sum + Math.round(Number(String(item.quantity).replace(",", ".")) * Number(String(item.unitPrice).replace(",", ".")) * 100) / 100, 0)
  await fillPayment(page, payload.payment, total, say, LOGDIR)
  await fillTransportAndInfo(page, payload.transport, payload.additionalInfo)
}

async function runJob(page, state, job) {
  const say = (text) => { log(text); return api({ acao: "andamento", id: job.id, texto: text }).catch(() => {}) }
  await selectPortalCompany(page, state, job.companyCnpj)
  if (job.action === "cancelar") {
    await say(`Cancelando a NF-e ${job.nfNumber}.`)
    await cancelNote(page, { number: job.nfNumber, accessKey: job.accessKey || "", reason: job.reason || "" }, say, LOGDIR)
    await api({ acao: "fim", id: job.id, tipo: "cancelar", ok: true })
    return
  }
  await say("Preenchendo a NF-e no NFeMail.")
  await fillAll(page, job.payload, say)
  const result = await saveAndTransmit(page, say, LOGDIR)
  await say(`NF-e ${result.number} autorizada pela SEFAZ.`)
  let xml = ""
  try { xml = xmlFrom(await downloadXml(page, result.accessKey, path.join(os.tmpdir(), "nd-nfe"))) } catch (error) { log("XML não baixado:", error.message) }
  await api({ acao: "fim", id: job.id, tipo: "emitir", ok: true, numero: result.number, serie: result.series, chave: result.accessKey, xml })
}

async function main() {
  if (!SECRET) throw new Error("NF_SYNC_SECRET não configurado em .env.local.")
  if (!process.env.NFEMAIL_EMAIL || !process.env.NFEMAIL_PASSWORD) throw new Error("NFEMAIL_EMAIL / NFEMAIL_PASSWORD não configurados em .env.local.")
  fs.writeFileSync(LOCK, String(process.pid))
  const portal = await openPortal({ headless: false })
  const page = portal.page
  const state = { current: "" }
  try {
    log("Entrando no NFeMail...")
    await login(page, process.env.NFEMAIL_EMAIL, process.env.NFEMAIL_PASSWORD)
    if (option("ensaio")) {
      const payload = JSON.parse(fs.readFileSync(option("ensaio"), "utf8"))
      await selectPortalCompany(page, state, onlyDigits(option("empresa")))
      await fillAll(page, payload, (text) => log(text))
      await page.screenshot({ path: path.join(LOGDIR, "ensaio-final.png"), fullPage: true }).catch(() => {})
      log("ENSAIO concluído: formulário preenchido; nada foi salvo nem transmitido.")
      return
    }
    for (let guard = 0; guard < 50; guard++) {
      const { job } = await api({ acao: "proximo" })
      if (!job) break
      log(`Trabalho ${job.id}: ${job.action} (${job.companyName})`)
      try { await runJob(page, state, job) } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log("ERRO:", message)
        await page.screenshot({ path: path.join(LOGDIR, `erro-${job.id}.png`), fullPage: true }).catch(() => {})
        await api({ acao: "fim", id: job.id, tipo: job.action, ok: false, erro: message }).catch((e) => log("não consegui avisar o ERP:", e.message))
      }
    }
  } finally {
    await portal.browser.close().catch(() => {})
    try { fs.unlinkSync(LOCK) } catch { /* já removido */ }
  }
}

fs.mkdirSync(LOGDIR, { recursive: true })
main().catch((error) => { console.error("Falha do robô de emissão:", error.message); try { fs.unlinkSync(LOCK) } catch { /* ok */ } process.exit(1) })
