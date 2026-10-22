// Registro de auditoria a partir do middleware (sem next/headers nem supabase-js): usado quando um
// usuário autenticado tenta abrir uma página sem permissão.

export type AuditHeaderValues = { actorId: string; actorEmail: string; ip: string; session: string; request: string; origin: string }

const HEADER_NAMES = ["x-audit-actor-id", "x-audit-actor-email", "x-audit-ip", "x-audit-session", "x-audit-request", "x-audit-origin"] as const

/** Remove cabeçalhos x-audit-* vindos do cliente (nunca confiáveis) e grava os valores verificados pelo servidor. */
export function withAuditHeaders(original: Headers, values: AuditHeaderValues) {
  const next = new Headers(original)
  HEADER_NAMES.forEach((name) => next.delete(name))
  const safe = (value: string) => value.replace(/[^\x20-\x7E]/g, "").slice(0, 200)
  if (values.actorId) next.set("x-audit-actor-id", safe(values.actorId))
  if (values.actorEmail) next.set("x-audit-actor-email", safe(values.actorEmail))
  if (values.ip) next.set("x-audit-ip", safe(values.ip))
  if (values.session) next.set("x-audit-session", safe(values.session))
  next.set("x-audit-request", safe(values.request))
  next.set("x-audit-origin", safe(values.origin))
  return next
}

/** ID da sessão do Supabase (claim session_id do token de acesso), sem validar a assinatura: só para correlação. */
export function sessionIdFromToken(token?: string | null) {
  try {
    if (!token) return ""
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")))
    return String(payload.session_id || "")
  } catch {
    return ""
  }
}

export function clientIp(headers: Headers) {
  return (headers.get("x-forwarded-for") || "").split(",")[0].trim() || headers.get("x-real-ip") || ""
}

export function originFor(pathname: string, hasUser: boolean): string {
  if (hasUser) return "Usuário"
  if (pathname.endsWith("/cron") || pathname.startsWith("/api/financeiro/nf/sync")) return "Agendador"
  if (pathname.startsWith("/api/integrations/") || pathname.startsWith("/api/webhooks")) return "Integração"
  if (pathname.startsWith("/api/adiantamentos/portal") || pathname.startsWith("/portal-adiantamento")) return "Portal do funcionário"
  return "Sistema"
}

export async function logAuditEdge(event: { companyId?: string; actorId?: string; actorEmail?: string; module: string; action: string; description: string; result: "Sucesso" | "Falha" | "Negado"; ip?: string; session?: string; request?: string; origin?: string }) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) return
    await fetch(`${url}/rest/v1/audit_events`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ system_company_id: event.companyId || null, actor_id: event.actorId || null, actor_email: event.actorEmail || null, module: event.module, action: event.action, description: event.description.slice(0, 300), result: event.result, ip_address: event.ip || null, session_id: event.session || null, request_id: event.request || null, origin: event.origin || "Usuário" }),
    })
  } catch {
    // a auditoria não pode impedir a navegação
  }
}
