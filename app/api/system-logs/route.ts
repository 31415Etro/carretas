import { NextResponse } from "next/server"
import { currentUserRole } from "@/lib/server-authorization"
import { createAdminClient } from "@/lib/supabase/server"
import { parseSystemErrorLog, reportSystemError, type SystemErrorSeverity } from "@/lib/system-error-monitor"

export const runtime = "nodejs"

export async function GET() {
  const { user, role } = await currentUserRole()
  if (!user) return NextResponse.json({ error: "Nao autenticado." }, { status: 401 })
  if (role !== "admin") return NextResponse.json({ error: "Acesso exclusivo para administradores." }, { status: 403 })
  const { data, error } = await createAdminClient().from("audit_logs").select("id,action,description,created_at").eq("entity_type", "system_error").order("created_at", { ascending: false }).limit(250)
  if (error) return NextResponse.json({ error: `audit_logs: ${error.message}` }, { status: 500 })
  const logs = (data || []).flatMap((row) => {
    const parsed = parseSystemErrorLog(row.description)
    return parsed ? [{ id: row.id, action: row.action, createdAt: row.created_at, ...parsed }] : []
  })
  return NextResponse.json({
    logs,
    email: {
      providerConfigured: Boolean(process.env.RESEND_API_KEY),
      explicitRecipient: Boolean(process.env.SYSTEM_ALERT_EMAIL),
      senderConfigured: Boolean(process.env.SYSTEM_ALERT_FROM_EMAIL),
    },
  })
}

export async function POST(request: Request) {
  const { user, role } = await currentUserRole()
  if (!user) return NextResponse.json({ error: "Nao autenticado." }, { status: 401 })
  try {
    const payload = await request.json()
    const isTest = payload?.test === true
    if (isTest && role !== "admin") return NextResponse.json({ error: "Acesso exclusivo para administradores." }, { status: 403 })
    const message = isTest ? `Teste de notificacao solicitado em ${new Date().toISOString()}` : String(payload?.message || "").trim()
    if (!message) return NextResponse.json({ error: "Mensagem do erro obrigatoria." }, { status: 400 })
    const allowedSeverities = new Set<SystemErrorSeverity>(["warning", "error", "critical"])
    const severity = role === "admin" && allowedSeverities.has(payload?.severity) ? payload.severity : "error"
    const result = await reportSystemError({
      error: new Error(message.slice(0, 1500)),
      source: isTest ? "Teste manual de alerta" : String(payload?.source || "Navegador").slice(0, 160),
      request,
      user,
      severity,
      statusCode: Number.isInteger(payload?.statusCode) ? payload.statusCode : null,
      path: String(payload?.path || "").slice(0, 500),
      method: String(payload?.method || "CLIENT").slice(0, 20),
      details: typeof payload?.details === "object" && payload.details ? payload.details : {},
    })
    return NextResponse.json({ log: role === "admin" ? result : { id: result.id, fingerprint: result.fingerprint, emailStatus: result.emailStatus } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao registrar erro." }, { status: 500 })
  }
}
