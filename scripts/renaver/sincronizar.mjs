// Robô do Renaver (ERP <-> portal da montadora). Roda no servidor (cron diário + botão da tela de Documentação veicular).
//
//   node scripts/renaver/sincronizar.mjs                 1) dá a Entrada de Zero KM dos chassis pedidos no ERP; 2) lê as 4 abas; 3) manda ao ERP (pendente / sucesso / falha)
//   node scripts/renaver/sincronizar.mjs --simular       igual, mas a Entrada de Zero KM só ENSAIA: abre o painel, confere o chassi e fecha em Cancelar (nada é enviado)
//   node scripts/renaver/sincronizar.mjs --so-leitura    só lê e manda ao ERP; não mexe em nenhum pedido de entrada
//   node scripts/renaver/sincronizar.mjs --local         só lê e mostra na tela; não fala com o ERP
//
// Configuração em .env.local (nunca vai para o Git): RENAVER_URL, RENAVER_EMAIL, RENAVER_PASSWORD, RENAVER_CNPJ (montadora), NF_SYNC_SECRET, ERP_URL.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { digits, enterZeroKm, header, loadEnv, login, openMontadora, openPortal, readAll } from "./renaver-client.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
loadEnv(here)
const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const ERP = (process.env.ERP_URL || "http://127.0.0.1:3000").replace(/\/$/, "")
const SECRET = process.env.NF_SYNC_SECRET || ""
const URL_ = process.env.RENAVER_URL || "https://renaver.absolutasolucoes.com.br/renaver/"
const CNPJ = digits(process.env.RENAVER_CNPJ || "31690385000190")
const LOCK = path.join(os.tmpdir(), "nd-renaver.lock")
const LOGDIR = path.join(here, "logs")
const log = (...parts) => console.log(`[${new Date().toLocaleTimeString("pt-BR")}]`, ...parts)
fs.mkdirSync(LOGDIR, { recursive: true })

async function api(body) {
  const response = await fetch(`${ERP}/api/documentacao/renaver/worker`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` }, body: JSON.stringify({ cnpj: CNPJ, ...body }) })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || `ERP respondeu ${response.status}`)
  return payload
}

function acquireLock() {
  try {
    const pid = Number(fs.readFileSync(LOCK, "utf8"))
    if (pid) { process.kill(pid, 0); return false }
  } catch { /* sem trava ativa */ }
  fs.writeFileSync(LOCK, String(process.pid))
  return true
}

/** O login do Renaver abre a empresa que a conta usou por último. Confere o CNPJ da montadora e, se for outra, entra de novo (até 3 vezes). */
async function enter() {
  let last = ""
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const portal = await openPortal({ headless: false })
    try {
      await login(portal.page, URL_, process.env.RENAVER_EMAIL, process.env.RENAVER_PASSWORD)
      const now = await header(portal.page)
      if (now.cnpj === CNPJ) return portal
      last = now.cnpj
      log(`Entrou na empresa ${now.cnpj}, não na montadora ${CNPJ} (tentativa ${attempt}/3).`)
    } catch (error) {
      await portal.browser.close().catch(() => {})
      throw error
    }
    await portal.browser.close().catch(() => {})
  }
  throw new Error(`O Renaver abriu a empresa ${last || "desconhecida"} em vez da montadora ${CNPJ}; a troca de empresa não está disponível para este login.`)
}

async function main() {
  if (!process.env.RENAVER_EMAIL || !process.env.RENAVER_PASSWORD) throw new Error("Falta RENAVER_EMAIL / RENAVER_PASSWORD no .env.local.")
  if (!flag("local") && SECRET.length < 24) throw new Error("Falta NF_SYNC_SECRET no .env.local.")
  if (!acquireLock()) { log("Já existe uma rodada em andamento; saindo."); return }
  const startedAt = new Date().toISOString()
  let portal
  try {
    log("Entrando no Renaver...")
    portal = await enter()
    await openMontadora(portal.page)
    const entries = []
    if (!flag("local") && !flag("so-leitura")) {
      const { vins } = await api({ acao: "pedidos" })
      for (const vin of vins || []) {
        log(`Entrada de Zero KM: ${vin}${flag("simular") ? " (ensaio)" : ""}`)
        const result = await enterZeroKm(portal.page, vin, { dry: flag("simular"), shotDir: LOGDIR }).catch((error) => ({ ok: false, message: error instanceof Error ? error.message : "Falha ao operar o portal." }))
        log(`  ${result.ok ? "ok" : "ERRO"}: ${result.message}`)
        entries.push({ vin, ok: result.ok, message: result.message })
        if (!flag("simular")) await api({ acao: "entrada", vin, ok: result.ok, mensagem: result.message })
        // sessão nova para o próximo chassi: a marcação da linha anterior não pode vazar para o painel seguinte
        await portal.browser.close().catch(() => {})
        portal = await enter()
        await openMontadora(portal.page)
      }
    }
    const rows = await readAll(portal.page, log)
    if (flag("local")) { console.log(JSON.stringify(rows, null, 1)); return }
    const saved = await api({ acao: "leitura", linhas: rows, inicio: startedAt, entradas: entries })
    log(`Enviado ao ERP: ${saved.total} chassi(s) — ${saved.pending} pendente(s), ${saved.success} sucesso, ${saved.failure} falha(s).`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log("FALHA:", message)
    if (portal) await portal.page.screenshot({ path: path.join(LOGDIR, `erro-${Date.now()}.png`) }).catch(() => {})
    if (!flag("local")) await api({ acao: "falha", erro: message, inicio: startedAt }).catch(() => {})
    process.exitCode = 1
  } finally {
    await portal?.browser.close().catch(() => {})
    try { if (Number(fs.readFileSync(LOCK, "utf8")) === process.pid) fs.unlinkSync(LOCK) } catch { /* já removida */ }
  }
}

await main()
