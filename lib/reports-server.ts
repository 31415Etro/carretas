import { audit } from "@/lib/audit"
import type { createAdminClient } from "@/lib/supabase/server"
import { currentUserRole } from "@/lib/server-authorization"
import { buildReportFile, reportFileName, type ReportMeta } from "@/lib/report-export"
import { reportRunners } from "@/lib/reports-runners"
import { buildResult, canAccessReport, describeFilters, nextRunDate, reportById, reportFormats, resolvePeriod, validateSavedReport, type ReportDef, type ReportFormat, type ReportOptions, type SavedReportInput } from "@/lib/reports"

type Admin = ReturnType<typeof createAdminClient>

export const REPORTS_MIGRATION_HINT = "Relatórios salvos ainda não instalados no banco. Rode scripts/212_relatorios.sql no SQL Editor do Supabase."
const isMissing = (message = "") => /does not exist|Could not find|schema cache/i.test(message)
const fail = (message: string): never => { throw new Error(message) }
const text = (value: unknown) => String(value ?? "").trim()

export const todayInSaoPaulo = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })
const brDate = (value: string) => value.split("-").reverse().join("/")

export function reportError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : (error as any)?.message || fallback
  if (isMissing(message)) return { message: REPORTS_MIGRATION_HINT, status: 503 }
  return { message, status: /Sem permissão/.test(message) ? 403 : 400 }
}

export type ReportUser = { id: string; name: string; email: string; role: string; permissions: string[] }

/** Usuário interno logado com as permissões do perfil (clientes externos não acessam relatórios). */
export async function reportUser(admin: Admin): Promise<ReportUser | null> {
  const { user, role } = await currentUserRole()
  if (!user || role === "client") return null
  const { data } = await admin.from("profiles").select("id,email,full_name,role,page_permissions,active").eq("id", user.id).maybeSingle()
  if (!data || data.active === false) return null
  return { id: data.id, name: data.full_name || data.email, email: data.email, role: data.role, permissions: Array.isArray(data.page_permissions) ? data.page_permissions : [] }
}

// ---------------- Execução

export type RunInput = ReportOptions & { reportId: string; periodKind?: string; startDate?: string; endDate?: string; exportFormat?: string; savedReportId?: string }

function describePeriod(def: ReportDef, start: string, end: string, today: string) {
  return def.periodMode === "snapshot" ? `Posição em ${brDate(today)}` : `${brDate(start)} a ${brDate(end)}`
}

/** Executa o relatório já aplicando permissões, filtros, agrupamento, ordenação e totais. */
export async function executeReport(admin: Admin, user: ReportUser | { id: string; name: string; email: string; role: string; permissions: string[] }, input: RunInput, companyName: string, origin: "Manual" | "Exportação" | "Agendado" = "Manual") {
  const def = reportById(input.reportId)
  if (!def) fail("Relatório não encontrado.")
  if (!canAccessReport(user, def!.module)) fail("Sem permissão para este relatório.")
  const today = todayInSaoPaulo()
  const { start, end } = resolvePeriod(input.periodKind || "Mês atual", today, { start: input.startDate, end: input.endDate })
  if (end < start) fail("O fim do período não pode ser anterior ao início.")
  const filters = Object.fromEntries(Object.entries(input.filters || {}).map(([key, value]) => [key, text(value)]))
  const runner = reportRunners[def!.id]
  const raw = await runner({ admin, start, end, today, params: filters })
  const result = buildResult(def!, raw, { filters, columns: input.columns, groupBy: input.groupBy, sortKey: input.sortKey, sortDir: input.sortDir, showTotals: input.showTotals })
  const meta: ReportMeta = { title: def!.name, periodLabel: describePeriod(def!, start, end, today), filtersText: describeFilters(def!, filters), companyName, generatedAt: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) }
  if (input.exportFormat || origin !== "Manual") {
    await admin.from("report_runs").insert({ saved_report_id: input.savedReportId || null, report_id: def!.id, report_name: def!.name, origin, format: input.exportFormat || null, period_start: start, period_end: end, row_count: result.rowCount, user_id: user.id, user_name: user.name })
    if (input.exportFormat) await audit({ module: "relatorios", action: "Exportação de dados", description: `Exportou "${def!.name}" em ${input.exportFormat}: ${result.rowCount} registro(s), ${meta.periodLabel}${meta.filtersText ? `, ${meta.filtersText}` : ""}.`, recordId: def!.id, actorId: user.id, actorEmail: user.email })
  }
  return { reportId: def!.id, module: def!.module, name: def!.name, period: { start, end }, meta, result }
}

// ---------------- Relatórios salvos

const toSaved = (row: any, users: Map<string, string>) => ({
  id: row.id, name: row.name, module: row.module, reportId: row.report_id, periodKind: row.period_kind, startDate: row.start_date || "", endDate: row.end_date || "", filters: row.filters || {}, columns: row.columns || [],
  groupBy: row.group_by || "", sortKey: row.sort_key || "", sortDir: (row.sort_dir || "") as string, showTotals: row.show_totals !== false, format: row.format as ReportFormat, authorizedUserIds: (row.authorized_user_ids || []) as string[],
  authorizedNames: ((row.authorized_user_ids || []) as string[]).map((id) => users.get(id) || "?"), frequency: row.frequency, weekday: row.weekday ?? null, day: row.day_of_month ?? null, nextRunDate: row.next_run_date || "",
  lastRunAt: row.last_run_at || "", active: row.active !== false, createdBy: row.created_by_name || "", createdById: row.created_by || "", createdAt: row.created_at,
})

async function userNames(admin: Admin) {
  const { data } = await admin.from("profiles").select("id,full_name,email")
  return new Map<string, string>((data || []).map((row: any) => [row.id as string, (row.full_name || row.email) as string]))
}

export async function listSaved(admin: Admin, user: ReportUser) {
  const { data, error } = await admin.from("saved_reports").select("*").order("name")
  if (error) throw error
  const users = await userNames(admin)
  return (data || []).filter((row) => user.role === "admin" || row.created_by === user.id || (row.authorized_user_ids || []).includes(user.id)).map((row) => toSaved(row, users))
}

export type SavedSaveInput = SavedReportInput & { id?: string; filters?: Record<string, string>; columns?: string[]; groupBy?: string; sortKey?: string; sortDir?: string; showTotals?: boolean; active?: boolean }

export async function saveReport(admin: Admin, user: ReportUser, input: SavedSaveInput) {
  const data: SavedSaveInput = { ...input, name: text(input.name), authorizedUserIds: [...new Set((input.authorizedUserIds || []).filter(Boolean))] }
  const invalid = validateSavedReport(data)
  if (invalid) fail(invalid)
  if (!canAccessReport(user, data.module)) fail("Sem permissão para este módulo.")
  const { data: profiles } = await admin.from("profiles").select("id,role,page_permissions,active").in("id", data.authorizedUserIds)
  if ((profiles || []).length !== data.authorizedUserIds.length) fail("Há usuário autorizado inexistente.")
  const noAccess = (profiles || []).filter((profile) => profile.active === false || !canAccessReport({ role: profile.role, permissions: profile.page_permissions || [] }, data.module))
  if (noAccess.length) fail("Todo usuário autorizado precisa ter a permissão de Relatórios e a do módulo de origem.")
  if (data.id) {
    const { data: current } = await admin.from("saved_reports").select("id,created_by").eq("id", data.id).maybeSingle()
    if (!current) fail("Relatório não encontrado.")
    if (user.role !== "admin" && current!.created_by !== user.id) fail("Sem permissão para alterar este relatório.")
  }
  const scheduled = data.frequency !== "Sob demanda"
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })
  const row = {
    ...(data.id ? { id: data.id } : { created_by: user.id, created_by_name: user.name }),
    name: data.name, module: data.module, report_id: data.reportId, period_kind: data.periodKind, start_date: data.periodKind === "Personalizado" ? data.startDate || null : null, end_date: data.periodKind === "Personalizado" ? data.endDate || null : null,
    filters: data.filters || {}, columns: data.columns || [], group_by: text(data.groupBy) || null, sort_key: text(data.sortKey) || null, sort_dir: data.sortDir === "asc" || data.sortDir === "desc" ? data.sortDir : null, show_totals: data.showTotals !== false,
    format: data.format, authorized_user_ids: data.authorizedUserIds, frequency: data.frequency, weekday: data.frequency === "Semanal" ? Number(data.weekday) : null, day_of_month: data.frequency === "Mensal" ? Number(data.day) : null,
    next_run_date: scheduled ? nextRunDate({ frequency: data.frequency, weekday: data.weekday, day: data.day }, yesterday) : null, active: data.active !== false,
  }
  const { data: saved, error } = await admin.from("saved_reports").upsert(row, { onConflict: "id" }).select("*").single()
  if (error) throw error
  return toSaved(saved, await userNames(admin))
}

export async function deleteSaved(admin: Admin, user: ReportUser, id: string) {
  const { data: current } = await admin.from("saved_reports").select("id,created_by").eq("id", id).maybeSingle()
  if (!current) fail("Relatório não encontrado.")
  if (user.role !== "admin" && current!.created_by !== user.id) fail("Sem permissão para excluir este relatório.")
  const { error } = await admin.from("saved_reports").delete().eq("id", id)
  if (error) throw error
}

export async function listRuns(admin: Admin, user: ReportUser) {
  let query = admin.from("report_runs").select("*").order("created_at", { ascending: false }).limit(60)
  if (user.role !== "admin") query = query.eq("user_id", user.id)
  const { data, error } = await query
  if (error) throw error
  return (data || []).map((row) => ({ id: row.id, reportName: row.report_name, origin: row.origin, format: row.format || "", periodStart: row.period_start || "", periodEnd: row.period_end || "", rowCount: row.row_count, userName: row.user_name || "", deliveredTo: row.delivered_to || [], status: row.status, error: row.error || "", at: row.created_at }))
}

// ---------------- Entrega por e-mail (envio agora e agendamento)

export const emailConfigured = () => Boolean(String(process.env.RESEND_API_KEY || "").trim())

/** Gera o relatório salvo e envia o arquivo aos usuários autorizados que ainda têm acesso ao módulo. */
export async function deliverSaved(admin: Admin, saved: any, companyName: string, origin: "Manual" | "Agendado", actor: { id: string; name: string } | null) {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim()
  const def = reportById(saved.report_id)
  if (!def) fail("Relatório não encontrado.")
  const { data: profiles } = await admin.from("profiles").select("id,email,full_name,role,page_permissions,active").in("id", saved.authorized_user_ids || [])
  const eligible = (profiles || []).filter((profile) => profile.active !== false && profile.email && canAccessReport({ role: profile.role, permissions: profile.page_permissions || [] }, def!.module))
  const skipped = (profiles || []).length - eligible.length
  const requester = { id: actor?.id || "", name: actor?.name || "Agendamento", email: "", role: "admin", permissions: [] as string[] }
  let status: "OK" | "Falha" = "OK"
  let errorMessage = ""
  let delivered: string[] = []
  let rowCount = 0
  let period = { start: "", end: "" }
  try {
    if (!apiKey) fail("Envio por e-mail não configurado: defina RESEND_API_KEY no servidor.")
    if (!eligible.length) fail("Nenhum usuário autorizado com acesso ao módulo e e-mail cadastrado.")
    const run = await executeReport(admin, requester, { reportId: saved.report_id, periodKind: saved.period_kind, startDate: saved.start_date || undefined, endDate: saved.end_date || undefined, filters: saved.filters || {}, columns: saved.columns || [], groupBy: saved.group_by || undefined, sortKey: saved.sort_key || undefined, sortDir: saved.sort_dir || undefined, showTotals: saved.show_totals !== false }, companyName, "Manual")
    rowCount = run.result.rowCount
    period = run.period
    const format = (reportFormats as readonly string[]).includes(saved.format) ? (saved.format as ReportFormat) : "PDF"
    const file = await buildReportFile(format, run.result, run.meta)
    const from = String(process.env.REPORT_FROM_EMAIL || process.env.SYSTEM_ALERT_FROM_EMAIL || "ND Carretas <onboarding@resend.dev>").trim()
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to: eligible.map((profile) => profile.email), subject: `${saved.name} — ${run.meta.periodLabel}`,
        html: `<div style="font-family:Arial,sans-serif;color:#172033;line-height:1.5"><p>Segue o relatório <strong>${saved.name}</strong> (${run.name}).</p><p>Período: ${run.meta.periodLabel}${run.meta.filtersText ? `<br>Filtros: ${run.meta.filtersText}` : ""}<br>${run.result.rowCount} registro(s) · gerado em ${run.meta.generatedAt}.</p></div>`,
        attachments: [{ filename: reportFileName(saved.name, file.extension), content: Buffer.from(file.bytes).toString("base64") }],
      }),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      fail(`Falha no envio: ${payload?.message || `Resend HTTP ${response.status}`}`)
    }
    delivered = eligible.map((profile) => profile.email as string)
  } catch (reason) {
    status = "Falha"
    errorMessage = reason instanceof Error ? reason.message : "Falha na geração do relatório."
  }
  await admin.from("report_runs").insert({ saved_report_id: saved.id, report_id: saved.report_id, report_name: saved.name, origin, format: saved.format, period_start: period.start || null, period_end: period.end || null, row_count: rowCount, user_id: actor?.id || null, user_name: actor?.name || "Agendamento", delivered_to: delivered, status, error: errorMessage || null })
  const patch: Record<string, any> = { last_run_at: new Date().toISOString() }
  if (saved.frequency !== "Sob demanda" && origin === "Agendado") patch.next_run_date = nextRunDate({ frequency: saved.frequency, weekday: saved.weekday ?? undefined, day: saved.day_of_month ?? undefined }, todayInSaoPaulo())
  await admin.from("saved_reports").update(patch).eq("id", saved.id)
  if (status === "Falha") fail(errorMessage)
  return { delivered, skipped, rowCount }
}

/** Gera e envia os relatórios agendados que venceram (chamado pelo agendador diário). */
export async function runScheduled(admin: Admin, companyName: string) {
  const today = todayInSaoPaulo()
  const { data, error } = await admin.from("saved_reports").select("*").eq("active", true).neq("frequency", "Sob demanda").lte("next_run_date", today)
  if (error) throw error
  const summary = { due: (data || []).length, sent: 0, failed: [] as string[] }
  for (const saved of data || []) {
    try {
      await deliverSaved(admin, saved, companyName, "Agendado", null)
      summary.sent++
    } catch (reason) {
      summary.failed.push(`${saved.name}: ${reason instanceof Error ? reason.message : "falhou"}`)
    }
  }
  return summary
}

export async function getSavedRow(admin: Admin, id: string) {
  const { data } = await admin.from("saved_reports").select("*").eq("id", id).maybeSingle()
  if (!data) fail("Relatório não encontrado.")
  return data!
}
