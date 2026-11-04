import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { audit } from "@/lib/audit"
import { canRequestEntry, normalizeRows, normalizeVin, renaverSituation } from "@/lib/renaver"
import { createAdminClient } from "@/lib/supabase/server"
import { listSystemCompanies } from "@/lib/system-company-server"

const TABLE_HINT = "O acompanhamento do Renaver ainda não está instalado no banco: rode o script scripts/245_renaver.sql no Supabase."
const missingTable = (message: string) => /renaver_/.test(message) && /does not exist|Could not find|schema cache/i.test(message)
const fail = (message: string) => new Error(missingTable(message) ? TABLE_HINT : message)
const digits = (value: unknown) => String(value || "").replace(/\D/g, "")
const COLUMNS = "vin,tab,renaver_status,kind,montadora_at,situation,entry_state,entry_message,entry_requested_by,entry_requested_at,entry_finished_at,last_seen_at,last_changed_at"

/** O robô só roda no servidor próprio (VPS): na Vercel não há navegador para abrir o Renaver. */
export const canRunRenaverHere = () => !process.env.VERCEL

/** O Renaver é da montadora: as linhas ficam na empresa do sistema com o CNPJ que o robô informou. */
async function companyByCnpj(cnpj: string) {
  const wanted = digits(cnpj)
  const company = (await listSystemCompanies(false)).find((item) => digits(item.cnpj) === wanted)
  if (!company) throw new Error(`Nenhuma empresa do sistema tem o CNPJ ${cnpj}.`)
  return company
}

export type ChassisRow = { vin: string; tab: string | null; renaver_status: string | null; kind: string | null; montadora_at: string | null; situation: "pendente" | "sucesso" | "falha"; entry_state: string | null; entry_message: string | null; entry_requested_by: string | null; entry_requested_at: string | null; entry_finished_at: string | null; last_seen_at: string; last_changed_at: string }

/** Situação dos chassis pedidos (o chassi é único no mundo; por isso a consulta não filtra empresa). */
export async function statusByVins(vins: string[]) {
  const wanted = Array.from(new Set(vins.map(normalizeVin).filter(Boolean))).slice(0, 200)
  if (!wanted.length) return [] as ChassisRow[]
  const admin = createAdminClient({ bypassCompanyScope: true })
  const { data, error } = await admin.from("renaver_chassis").select(COLUMNS).in("vin", wanted)
  if (error) throw fail(error.message)
  return (data || []) as unknown as ChassisRow[]
}

export async function lastRun() {
  const admin = createAdminClient({ bypassCompanyScope: true })
  const { data, error } = await admin.from("renaver_runs").select("started_at,finished_at,ok,error,total,pending,success,failure,entries").order("finished_at", { ascending: false }).limit(1)
  if (error) throw fail(error.message)
  return ((data || [])[0] || null) as { started_at: string; finished_at: string; ok: boolean; error: string | null; total: number; pending: number; success: number; failure: number; entries: Array<{ vin: string; ok: boolean; message: string }> } | null
}

/** Pedido de Entrada de Zero KM feito na tela: fica "solicitada" e o robô dá a entrada na próxima rodada (disparada agora). */
export async function requestEntry(vinInput: string, by: string) {
  const vin = normalizeVin(vinInput)
  const admin = createAdminClient({ bypassCompanyScope: true })
  const { data, error } = await admin.from("renaver_chassis").select(`id,system_company_id,${COLUMNS}`).eq("vin", vin).maybeSingle()
  if (error) throw fail(error.message)
  const row = data as unknown as (ChassisRow & { id: string; system_company_id: string }) | null
  if (!row) throw new Error("Esse chassi ainda não apareceu no Renaver. Aguarde a próxima verificação.")
  if (!canRequestEntry(row)) throw new Error(row.entry_state === "solicitada" ? "A entrada desse chassi já foi pedida e está na fila do robô." : "Esse chassi não está em \"Pendentes de Entrada\" no Renaver.")
  const update = await admin.from("renaver_chassis").update({ entry_state: "solicitada", entry_message: "Entrada de Zero KM pedida; na fila do robô.", entry_requested_by: by, entry_requested_at: new Date().toISOString(), entry_finished_at: null }).eq("id", row.id)
  if (update.error) throw fail(update.error.message)
  await audit({ module: "documentacao", action: "Entrada de Zero KM no Renaver", description: `Entrada de Zero KM pedida para o chassi ${vin}.`, recordId: row.id, tableName: "renaver_chassis", result: "Sucesso", companyId: row.system_company_id })
  triggerRenaverWorker()
  return vin
}

// ---------------------------------------------------------------- Robô
const LOCK = path.join(os.tmpdir(), "nd-renaver.lock")
function workerRunning() {
  try {
    const pid = Number(fs.readFileSync(LOCK, "utf8"))
    if (!pid) return false
    process.kill(pid, 0)
    return true
  } catch { return false }
}

/** Dispara o robô do Renaver (um por vez). Só no servidor próprio. */
export function triggerRenaverWorker() {
  if (!canRunRenaverHere() || workerRunning()) return false
  try {
    const dir = process.env.RENAVER_DIR || path.join(process.cwd(), "scripts", "renaver")
    const script = path.join(dir, "sincronizar.mjs")
    if (!fs.existsSync(script)) return false
    const command = process.platform === "linux" ? "xvfb-run" : process.execPath
    const args = process.platform === "linux" ? ["-a", process.execPath, script] : [script]
    const child = spawn(command, args, { cwd: dir, detached: true, stdio: "ignore", env: { ...process.env, ERP_URL: process.env.ERP_INTERNAL_URL || "http://127.0.0.1:3000" } })
    child.unref()
    return true
  } catch { return false }
}

/** Pedidos de entrada na fila (da empresa do CNPJ da montadora). */
export async function pendingEntries(cnpj: string) {
  const company = await companyByCnpj(cnpj)
  const admin = createAdminClient({ bypassCompanyScope: true })
  const { data, error } = await admin.from("renaver_chassis").select("vin").eq("system_company_id", company.id).eq("entry_state", "solicitada").eq("tab", "Pendentes de Entrada").order("entry_requested_at").limit(20)
  if (error) throw fail(error.message)
  return ((data || []) as Array<{ vin: string }>).map((row) => row.vin)
}

/** Guarda o que o robô leu nas quatro abas. Chassi que mudou de aba ou de status atualiza a data da mudança; o pedido de entrada concluído é fechado aqui. */
export async function saveSnapshot(input: { cnpj: string; rows: unknown; startedAt?: string; entries?: Array<{ vin: string; ok: boolean; message: string }> }) {
  const company = await companyByCnpj(input.cnpj)
  const rows = normalizeRows(input.rows)
  const admin = createAdminClient({ bypassCompanyScope: true })
  const existing = await admin.from("renaver_chassis").select("vin,tab,renaver_status,entry_state").eq("system_company_id", company.id)
  if (existing.error) throw fail(existing.error.message)
  const before = new Map(((existing.data || []) as Array<{ vin: string; tab: string | null; renaver_status: string | null; entry_state: string | null }>).map((row) => [row.vin, row]))
  const now = new Date().toISOString()
  const counts = { pending: 0, success: 0, failure: 0 }
  const upserts = rows.map((row) => {
    const old = before.get(row.vin)
    // o pedido de entrada fecha sozinho quando o chassi aparece fora de "Pendentes de Entrada"
    const entryState = old?.entry_state === "solicitada" && row.tab !== "Pendentes de Entrada" ? "concluida" : old?.entry_state ?? null
    const situation = renaverSituation({ tab: row.tab, status: row.status, entryState })
    counts[situation === "pendente" ? "pending" : situation === "sucesso" ? "success" : "failure"] += 1
    const changed = !old || old.tab !== row.tab || old.renaver_status !== row.status
    return {
      system_company_id: company.id, vin: row.vin, tab: row.tab, renaver_status: row.status, kind: row.kind, montadora_at: row.montadoraAt, situation, last_seen_at: now,
      ...(changed ? { last_changed_at: now } : {}), ...(!old ? { first_seen_at: now } : {}),
      ...(old?.entry_state === "solicitada" && entryState === "concluida" ? { entry_state: "concluida", entry_message: "Entrada de Zero KM concluída: o chassi saiu de Pendentes de Entrada.", entry_finished_at: now } : {}),
    }
  })
  for (let start = 0; start < upserts.length; start += 200) {
    const { error } = await admin.from("renaver_chassis").upsert(upserts.slice(start, start + 200), { onConflict: "system_company_id,vin" })
    if (error) throw fail(error.message)
  }
  const run = await admin.from("renaver_runs").insert({ system_company_id: company.id, started_at: input.startedAt || now, finished_at: now, ok: true, total: rows.length, pending: counts.pending, success: counts.success, failure: counts.failure, entries: input.entries || [] })
  if (run.error) throw fail(run.error.message)
  return { total: rows.length, ...counts }
}

/** Resultado de uma tentativa de Entrada de Zero KM (ok = o robô confirmou no portal; a conferência final vem da leitura seguinte). */
export async function saveEntryResult(input: { cnpj: string; vin: string; ok: boolean; message: string }) {
  const company = await companyByCnpj(input.cnpj)
  const admin = createAdminClient({ bypassCompanyScope: true })
  const vin = normalizeVin(input.vin)
  const patch = input.ok
    ? { entry_message: input.message.slice(0, 300), entry_finished_at: new Date().toISOString() }
    : { entry_state: "erro", situation: "falha", entry_message: input.message.slice(0, 300), entry_finished_at: new Date().toISOString() }
  const { error } = await admin.from("renaver_chassis").update(patch).eq("system_company_id", company.id).eq("vin", vin).eq("entry_state", "solicitada")
  if (error) throw fail(error.message)
}

/** Rodada que falhou (login recusado, portal fora do ar...): fica no histórico e aparece na tela. */
export async function saveFailedRun(input: { cnpj: string; error: string; startedAt?: string }) {
  const company = await companyByCnpj(input.cnpj)
  const admin = createAdminClient({ bypassCompanyScope: true })
  const { error } = await admin.from("renaver_runs").insert({ system_company_id: company.id, started_at: input.startedAt || new Date().toISOString(), ok: false, error: input.error.slice(0, 500) })
  if (error) throw fail(error.message)
}
