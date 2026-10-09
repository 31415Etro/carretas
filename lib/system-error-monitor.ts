import "server-only"

import { createHash, randomUUID } from "node:crypto"
import type { User } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/server"

export type SystemErrorSeverity = "warning" | "error" | "critical"
export type SystemEmailStatus = "sent" | "failed" | "suppressed" | "not_configured"

type SystemErrorInput = {
  error: unknown
  source: string
  request?: Request
  user?: User | null
  severity?: SystemErrorSeverity
  statusCode?: number | null
  path?: string
  method?: string
  details?: Record<string, unknown>
}

export type StoredSystemError = {
  fingerprint: string
  source: string
  message: string
  severity: SystemErrorSeverity
  statusCode: number | null
  path: string
  method: string
  actorEmail: string
  details: Record<string, unknown>
  emailStatus: SystemEmailStatus
  emailRecipients: string[]
  emailError: string
  occurredAt: string
}

const sensitiveKey = /authorization|cookie|password|passwd|secret|token|api.?key|service.?role/i

function text(value: unknown, max = 1000) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max)
}

function safeDetails(value: unknown, depth = 0): unknown {
  if (depth > 3) return "[limite de profundidade]"
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return text(value, 500)
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => safeDetails(item, depth + 1))
  if (typeof value !== "object") return text(value, 500)
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 30).map(([key, item]) => [
    text(key, 80), sensitiveKey.test(key) ? "[removido]" : safeDetails(item, depth + 1),
  ]))
}

function parseStored(description: unknown): StoredSystemError | null {
  try {
    const value = JSON.parse(String(description || ""))
    return value?.fingerprint && value?.source ? value as StoredSystemError : null
  } catch {
    return null
  }
}

function html(value: unknown) {
  return text(value, 4000).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character)
}

async function alertRecipients() {
  const configured = String(process.env.SYSTEM_ALERT_EMAIL || "").split(/[;,]/).map((email) => email.trim().toLowerCase()).filter(Boolean)
  if (configured.length) return Array.from(new Set(configured)).slice(0, 10)
  const { data } = await createAdminClient().from("profiles").select("email").eq("role", "admin").eq("active", true)
  return Array.from(new Set((data || []).map((profile) => String(profile.email || "").trim().toLowerCase()).filter(Boolean))).slice(0, 10)
}

async function sendAlert(record: StoredSystemError) {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim()
  if (!apiKey || !record.emailRecipients.length) return { status: "not_configured" as const, error: "Configure RESEND_API_KEY e um destinatario administrativo." }
  const from = String(process.env.SYSTEM_ALERT_FROM_EMAIL || "M&C Monitor <onboarding@resend.dev>").trim()
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: record.emailRecipients,
      subject: `[M&C] ${record.severity === "critical" ? "Falha critica" : "Erro no sistema"}: ${record.source}`,
      html: `<div style="font-family:Arial,sans-serif;color:#172033;line-height:1.5"><h2>Falha detectada no sistema</h2><table style="border-collapse:collapse"><tr><td style="padding:6px 14px 6px 0"><strong>Origem</strong></td><td>${html(record.source)}</td></tr><tr><td style="padding:6px 14px 6px 0"><strong>Erro</strong></td><td>${html(record.message)}</td></tr><tr><td style="padding:6px 14px 6px 0"><strong>Rota</strong></td><td>${html(`${record.method} ${record.path}`)}</td></tr><tr><td style="padding:6px 14px 6px 0"><strong>HTTP</strong></td><td>${html(record.statusCode || "-")}</td></tr><tr><td style="padding:6px 14px 6px 0"><strong>Usuario</strong></td><td>${html(record.actorEmail || "Nao identificado")}</td></tr><tr><td style="padding:6px 14px 6px 0"><strong>Data</strong></td><td>${html(new Date(record.occurredAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }))}</td></tr></table><p style="margin-top:20px;color:#526079">Identificador: ${html(record.fingerprint)}</p></div>`,
    }),
  })
  if (response.ok) return { status: "sent" as const, error: "" }
  const payload = await response.json().catch(() => null)
  return { status: "failed" as const, error: text(payload?.message || `Resend HTTP ${response.status}`, 500) }
}

export async function reportSystemError(input: SystemErrorInput) {
  const admin = createAdminClient()
  const occurredAt = new Date().toISOString()
  const error = input.error instanceof Error ? input.error : new Error(text(input.error) || "Falha nao identificada")
  const source = text(input.source, 160) || "sistema"
  const path = text(input.path || (input.request ? new URL(input.request.url).pathname : ""), 500)
  const method = text(input.method || input.request?.method || "CLIENT", 20).toUpperCase()
  const message = text(error.message || error.name, 1500) || "Falha nao identificada"
  const statusCode = Number.isInteger(input.statusCode) ? Number(input.statusCode) : null
  const fingerprint = createHash("sha256").update([source, message, path, statusCode || ""].join("|")).digest("hex").slice(0, 16)
  const actorEmail = text(input.user?.email, 320)
  const recipients = await alertRecipients()
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString()
  const { data: recentRows } = await admin.from("audit_logs").select("description").eq("entity_type", "system_error").gte("created_at", since).order("created_at", { ascending: false }).limit(100)
  const duplicateNotified = (recentRows || []).some((row) => {
    const previous = parseStored(row.description)
    return previous?.fingerprint === fingerprint && previous.emailStatus === "sent"
  })
  const record: StoredSystemError = {
    fingerprint, source, message, severity: input.severity || "error", statusCode, path, method, actorEmail,
    details: safeDetails(input.details || {}) as Record<string, unknown>,
    emailStatus: duplicateNotified ? "suppressed" : "not_configured",
    emailRecipients: recipients,
    emailError: "",
    occurredAt,
  }
  const id = randomUUID()
  const { error: insertError } = await admin.from("audit_logs").insert({
    id, user_id: null, entity_type: "system_error", entity_id: null, action: input.severity === "critical" ? "Falha critica" : "Falha", description: JSON.stringify(record),
  })
  if (insertError) {
    console.error("[system-monitor] Falha ao gravar log:", insertError.message)
    return { id: "", ...record, loggingError: insertError.message }
  }
  if (!duplicateNotified) {
    const delivery = await sendAlert(record).catch((deliveryError) => ({ status: "failed" as const, error: text(deliveryError instanceof Error ? deliveryError.message : deliveryError, 500) }))
    record.emailStatus = delivery.status
    record.emailError = delivery.error
    const { error: updateError } = await admin.from("audit_logs").update({ description: JSON.stringify(record) }).eq("id", id)
    if (updateError) console.error("[system-monitor] Falha ao atualizar envio:", updateError.message)
  }
  return { id, ...record }
}

export function parseSystemErrorLog(description: unknown) {
  return parseStored(description)
}
