import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { audit } from "@/lib/audit"
import { cachedLookup } from "@/lib/auth-cache"
import { staleCache } from "@/lib/paged-fetch"
import { syncXmlBoth } from "@/lib/nf-sync-server"
import { digits, normalizePayload, payloadTotal, validateCancelReason, validateEmission, type EmissionPayload, type EmissionStatus } from "@/lib/nfe-emission"
import { CANCELLED_STATUS } from "@/lib/remessas"
import { stockContext } from "@/lib/stock-api"
import { createAdminClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

type Admin = ReturnType<typeof createAdminClient>
const TABLE_HINT = "O histórico de emissões ainda não está instalado no banco: rode o script scripts/244_emissao_nfe.sql no Supabase."
const missingTable = (message: string) => /nf_emissions/.test(message) && /does not exist|Could not find|schema cache/i.test(message)
const fail = (message: string) => new Error(missingTable(message) ? TABLE_HINT : message)
const stamp = () => new Date().toISOString()

export type EmissionRow = {
  id: string; status: EmissionStatus; payload: EmissionPayload; recipient_name: string | null; recipient_document: string | null; total_amount: number | null
  nf_number: string | null; nf_series: string | null; access_key: string | null; protocol: string | null; error: string | null; error_seen: boolean; attempts: number
  events: Array<{ at: string; text: string }>; cancel_reason: string | null; cancelled_at: string | null; created_by: string | null; created_at: string; finished_at: string | null; system_company_id: string
}

const COLUMNS = "id,status,payload,recipient_name,recipient_document,total_amount,nf_number,nf_series,access_key,protocol,error,error_seen,attempts,events,cancel_reason,cancelled_at,created_by,created_at,finished_at,system_company_id"

/** Só administrador ou quem tem a permissão Financeiro emite/cancela nota fiscal. */
export async function issuerContext() {
  const context = await stockContext()
  if ("error" in context) return context
  if (context.role !== "admin") {
    const permissions = await cachedLookup(`perm|${context.userId}`, async () => (await context.admin.from("profiles").select("page_permissions").eq("id", context.userId).maybeSingle()).data?.page_permissions)
    if (!Array.isArray(permissions) || !permissions.includes("financeiro")) return { error: NextResponse.json({ error: "Sem permissão para emitir notas fiscais." }, { status: 403 }) } as const
  }
  return context
}

/** O robô só roda no servidor próprio (VPS): na Vercel não há navegador para abrir o NFeMail. */
export const canEmitHere = () => !process.env.VERCEL

const pushEvent = (events: EmissionRow["events"] | null | undefined, text: string) => [...(events || []), { at: stamp(), text: text.slice(0, 300) }].slice(-60)

export async function createEmission(admin: Admin, companyId: string, input: EmissionPayload, by: string) {
  const payload = normalizePayload(input)
  const errors = validateEmission(payload)
  if (errors.length) throw new Error(errors.join(" "))
  const { data, error } = await admin.from("nf_emissions").insert({
    system_company_id: companyId, status: "pendente", payload, recipient_name: payload.recipient.name, recipient_document: digits(payload.recipient.document), total_amount: payloadTotal(payload),
    quote_id: payload.quoteId || null, client_id: payload.recipient.clientId || null, created_by: by, events: [{ at: stamp(), text: "Pedido de emissão recebido; na fila do robô." }],
  }).select(COLUMNS).single()
  if (error) throw fail(error.message)
  await audit({ module: "financeiro", action: "Emissão de NF-e", description: `Pedido de emissão de NF-e para ${payload.recipient.name} (R$ ${payloadTotal(payload).toFixed(2)}).`, recordId: String((data as { id: string }).id), tableName: "nf_emissions", result: "Sucesso", companyId })
  triggerWorker()
  return data as unknown as EmissionRow
}

export async function listEmissions(admin: Admin, companyId: string, limit = 100) {
  const { data, error } = await admin.from("nf_emissions").select(COLUMNS).eq("system_company_id", companyId).order("created_at", { ascending: false }).limit(limit)
  if (error) throw fail(error.message)
  return (data || []) as unknown as EmissionRow[]
}

/** Marca os erros como vistos (o aviso vermelho some depois que o usuário abre o histórico). */
export async function markErrorsSeen(admin: Admin, companyId: string) {
  await admin.from("nf_emissions").update({ error_seen: true }).eq("system_company_id", companyId).eq("error_seen", false).not("error", "is", null)
}

export async function retryEmission(admin: Admin, companyId: string, id: string) {
  const { data, error } = await admin.from("nf_emissions").select(COLUMNS).eq("system_company_id", companyId).eq("id", id).maybeSingle()
  if (error) throw fail(error.message)
  const row = data as unknown as EmissionRow | null
  if (!row) throw new Error("Emissão não encontrada.")
  if (row.status !== "erro") throw new Error("Só dá para tentar de novo uma emissão com erro.")
  if (row.access_key) throw new Error("Esta nota já foi transmitida; confira no histórico.")
  const { error: updateError } = await admin.from("nf_emissions").update({ status: "pendente", error: null, error_seen: true, events: pushEvent(row.events, "Nova tentativa pedida.") }).eq("id", id)
  if (updateError) throw fail(updateError.message)
  triggerWorker()
}

export async function requestCancel(admin: Admin, companyId: string, id: string, reason: string, by: string) {
  const invalid = validateCancelReason(reason)
  if (invalid) throw new Error(invalid)
  const { data, error } = await admin.from("nf_emissions").select(COLUMNS).eq("system_company_id", companyId).eq("id", id).maybeSingle()
  if (error) throw fail(error.message)
  const row = data as unknown as EmissionRow | null
  if (!row) throw new Error("Emissão não encontrada.")
  if (row.status !== "emitida" || !row.access_key) throw new Error("Só dá para cancelar uma nota já emitida (autorizada).")
  // nota já recebida: o dinheiro entrou; estorne o recebimento antes de cancelar
  const received = await admin.from("accounts_receivable").select("id").eq("source_reference", row.access_key).in("status", ["Recebida", "Parcialmente recebida"]).limit(1)
  if (received.data?.length) throw new Error("Esta nota já tem recebimento lançado em Contas a receber. Estorne o recebimento antes de cancelar.")
  const { error: updateError } = await admin.from("nf_emissions").update({ status: "cancelando", cancel_reason: reason.trim(), cancel_requested_by: by, error: null, events: pushEvent(row.events, "Cancelamento pedido; na fila do robô.") }).eq("id", id)
  if (updateError) throw fail(updateError.message)
  await audit({ module: "financeiro", action: "Cancelamento de NF-e", description: `Pedido de cancelamento da NF-e ${row.nf_number || ""} (${row.recipient_name || ""}): ${reason.trim().slice(0, 120)}`, recordId: id, tableName: "nf_emissions", result: "Sucesso", companyId })
  triggerWorker()
}

// ---------------------------------------------------------------- robô (servidor)

const LOCK = path.join(os.tmpdir(), "nd-emitir-nfe.lock")

function workerRunning() {
  try {
    const pid = Number(fs.readFileSync(LOCK, "utf8"))
    if (!pid) return false
    process.kill(pid, 0)
    return true
  } catch { return false }
}

/** Dispara o robô de emissão (um por vez; ele esvazia a fila e encerra). Só no servidor próprio. */
export function triggerWorker() {
  if (!canEmitHere() || workerRunning()) return false
  try {
    const dir = process.env.NFEMAIL_DIR || path.join(process.cwd(), "scripts", "nfemail")
    const script = path.join(dir, "emitir.mjs")
    if (!fs.existsSync(script)) return false
    const command = process.platform === "linux" ? "xvfb-run" : process.execPath
    const args = process.platform === "linux" ? ["-a", process.execPath, script] : [script]
    const child = spawn(command, args, { cwd: dir, detached: true, stdio: "ignore", env: { ...process.env, ERP_URL: process.env.ERP_INTERNAL_URL || "http://127.0.0.1:3000" } })
    child.unref()
    return true
  } catch { return false }
}

export type WorkerJob = { id: string; action: "emitir" | "cancelar"; companyCnpj: string; companyName: string; payload: EmissionPayload; accessKey: string | null; nfNumber: string | null; reason: string | null; attempts: number }

/** Próximo trabalho da fila (de qualquer empresa). Marca como "emitindo" para ninguém pegar duas vezes. */
export async function claimNext(): Promise<WorkerJob | null> {
  const admin = createAdminClient({ bypassCompanyScope: true })
  const { data, error } = await admin.from("nf_emissions").select(`${COLUMNS},system_companies(name,cnpj)`).in("status", ["pendente", "cancelando"]).order("created_at").limit(1)
  if (error) throw fail(error.message)
  const row = (data || [])[0] as unknown as (EmissionRow & { system_companies: { name: string; cnpj: string } | { name: string; cnpj: string }[] | null }) | undefined
  if (!row) return null
  const company = Array.isArray(row.system_companies) ? row.system_companies[0] : row.system_companies
  const cancelling = row.status === "cancelando"
  const claim = await admin.from("nf_emissions").update(cancelling ? { attempts: row.attempts + 1 } : { status: "emitindo", attempts: row.attempts + 1, started_at: stamp(), events: pushEvent(row.events, "Robô iniciou a emissão.") }).eq("id", row.id).eq("status", row.status).select("id").maybeSingle()
  if (claim.error || !claim.data) return null
  return { id: row.id, action: cancelling ? "cancelar" : "emitir", companyCnpj: digits(company?.cnpj || ""), companyName: company?.name || "", payload: row.payload, accessKey: row.access_key, nfNumber: row.nf_number, reason: row.cancel_reason, attempts: row.attempts + 1 }
}

export async function reportProgress(id: string, text: string) {
  const admin = createAdminClient({ bypassCompanyScope: true })
  const { data } = await admin.from("nf_emissions").select("events").eq("id", id).maybeSingle()
  await admin.from("nf_emissions").update({ events: pushEvent((data as { events?: EmissionRow["events"] } | null)?.events, text) }).eq("id", id)
}

type FinishInput = { id: string; ok: boolean; action: "emitir" | "cancelar"; error?: string; number?: string; series?: string; accessKey?: string; protocol?: string; xml?: string }

/** Resultado do robô: grava no histórico e, se emitiu, lança a nota no Contas a receber e na Contabilidade (Saída). */
export async function finishJob(input: FinishInput) {
  const admin = createAdminClient({ bypassCompanyScope: true })
  const { data } = await admin.from("nf_emissions").select(COLUMNS).eq("id", input.id).maybeSingle()
  const row = data as unknown as EmissionRow | null
  if (!row) throw new Error("Emissão não encontrada.")
  const scoped = createAdminClient({ companyId: row.system_company_id })
  const note: string[] = []

  if (input.action === "emitir") {
    if (!input.ok) {
      await admin.from("nf_emissions").update({ status: "erro", error: String(input.error || "Erro desconhecido na emissão.").slice(0, 1500), error_seen: false, finished_at: stamp(), events: pushEvent(row.events, `Erro: ${String(input.error || "").slice(0, 200)}`) }).eq("id", row.id)
      await audit({ module: "financeiro", action: "Emissão de NF-e", description: `Falha ao emitir NF-e para ${row.recipient_name || ""}: ${String(input.error || "").slice(0, 200)}`, recordId: row.id, tableName: "nf_emissions", result: "Falha", companyId: row.system_company_id, origin: "Integração" })
      return
    }
    let importError = ""
    if (input.xml) {
      try {
        const company = await admin.from("system_companies").select("id,cnpj").eq("id", row.system_company_id).single()
        const result = await syncXmlBoth(scoped, row.system_company_id, String((company.data as { cnpj?: string })?.cnpj || ""), `nfe-${input.accessKey || input.number}.xml`, input.xml)
        note.push(result.status === "erro" ? `Lançamento no ERP falhou: ${result.detail}` : `Lançada no Contas a receber e na Contabilidade (${result.status}).`)
        if (result.status === "erro") importError = `A nota foi emitida, mas não foi lançada no ERP: ${result.detail || "erro"}. A rotina automática das notas tentará de novo.`
      } catch (error) { importError = `A nota foi emitida, mas não foi lançada no ERP: ${error instanceof Error ? error.message : "erro"}. A rotina automática das notas tentará de novo.`; note.push(importError) }
    } else { importError = "A nota foi emitida, mas o XML não veio do portal; a rotina automática das notas fará o lançamento."; note.push(importError) }
    await admin.from("nf_emissions").update({ status: "emitida", nf_number: input.number || null, nf_series: input.series || null, access_key: input.accessKey || null, protocol: input.protocol || null, error: importError || null, error_seen: !importError, finished_at: stamp(), events: pushEvent(pushEvent(row.events, `NF-e ${input.number || ""} autorizada.`), note.join(" ") || "Concluído.") }).eq("id", row.id)
    staleCache("notas|"); staleCache("chassis|"); staleCache("consolidado|"); staleCache("remessas|")
    await audit({ module: "financeiro", action: "Emissão de NF-e", description: `NF-e ${input.number || ""} emitida para ${row.recipient_name || ""} (R$ ${Number(row.total_amount || 0).toFixed(2)}).`, recordId: row.id, tableName: "nf_emissions", result: "Sucesso", companyId: row.system_company_id, origin: "Integração" })
    return
  }

  // cancelamento
  if (!input.ok) {
    await admin.from("nf_emissions").update({ status: "emitida", error: `Cancelamento não concluído: ${String(input.error || "erro").slice(0, 1200)}`, error_seen: false, events: pushEvent(row.events, `Cancelamento falhou: ${String(input.error || "").slice(0, 200)}`) }).eq("id", row.id)
    await audit({ module: "financeiro", action: "Cancelamento de NF-e", description: `Falha ao cancelar NF-e ${row.nf_number || ""}: ${String(input.error || "").slice(0, 200)}`, recordId: row.id, tableName: "nf_emissions", result: "Falha", companyId: row.system_company_id, origin: "Integração" })
    return
  }
  if (row.access_key) {
    const invoice = await scoped.from("accounting_invoices").select("id,data").eq("access_key", row.access_key).maybeSingle()
    if (invoice.data) await scoped.from("accounting_invoices").update({ data: { ...((invoice.data as { data?: object }).data || {}), protocolStatus: CANCELLED_STATUS } }).eq("id", (invoice.data as { id: string }).id)
    await scoped.from("accounts_receivable").update({ status: "Cancelada" }).eq("source_reference", row.access_key).neq("status", "Recebida")
  }
  await admin.from("nf_emissions").update({ status: "cancelada", cancelled_at: stamp(), error: null, error_seen: true, finished_at: stamp(), events: pushEvent(row.events, "NF-e cancelada; Contas a receber e Contabilidade atualizadas.") }).eq("id", row.id)
  staleCache("notas|"); staleCache("chassis|"); staleCache("consolidado|"); staleCache("remessas|")
  await audit({ module: "financeiro", action: "Cancelamento de NF-e", description: `NF-e ${row.nf_number || ""} cancelada (${row.recipient_name || ""}).`, recordId: row.id, tableName: "nf_emissions", result: "Sucesso", companyId: row.system_company_id, origin: "Integração" })
}
