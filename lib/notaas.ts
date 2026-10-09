export type NotaAsDocumentKind = "service" | "material"

type JsonRecord = Record<string, any>

const DEFAULT_BASE_URL = "https://platform.notaas.com.br/api/v1"

export class NotaAsApiError extends Error {
  status: number
  details: unknown

  constructor(message: string, status: number, details?: unknown) {
    super(message)
    this.name = "NotaAsApiError"
    this.status = status
    this.details = details
  }
}

export function notaAsConfiguration(kind: NotaAsDocumentKind) {
  const envName = kind === "service" ? "NOTAAS_SERVICES_API_KEY" : "NOTAAS_MATERIALS_API_KEY"
  const apiKey = String(process.env[envName] || "").trim()
  if (!apiKey) throw new Error(`Configure ${envName} no servidor antes de emitir notas fiscais.`)
  return {
    apiKey,
    baseUrl: String(process.env.NOTAAS_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, ""),
  }
}

function apiMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback
  const value = payload as JsonRecord
  const errors = Array.isArray(value.errors)
    ? value.errors.map((item: any) => item?.message || item?.detail || String(item)).filter(Boolean).join("; ")
    : ""
  return String(value.message || value.error || value.detail || errors || fallback)
}

export async function notaAsRequest<T = JsonRecord>(kind: NotaAsDocumentKind, path: string, init: RequestInit = {}) {
  const { apiKey, baseUrl } = notaAsConfiguration(kind)
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      "x-api-key": apiKey,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
    cache: "no-store",
  })
  const contentType = response.headers.get("content-type") || ""
  const payload = contentType.includes("json")
    ? await response.json().catch(() => ({}))
    : await response.text().catch(() => "")
  if (!response.ok) {
    throw new NotaAsApiError(apiMessage(payload, `NotaAS respondeu HTTP ${response.status}.`), response.status, payload)
  }
  return payload as T
}

export function notaAsStatusPath(kind: NotaAsDocumentKind, invoiceId: string) {
  return kind === "service" ? `/invoices/${encodeURIComponent(invoiceId)}/status` : `/nfe/invoices/${encodeURIComponent(invoiceId)}/status`
}

export function notaAsDocumentPath(kind: NotaAsDocumentKind, invoiceId: string, format: "pdf" | "xml") {
  if (kind === "service") return `/invoices/${encodeURIComponent(invoiceId)}/${format}`
  return `/nfe/invoices/${encodeURIComponent(invoiceId)}/${format === "pdf" ? "danfe" : "xml"}`
}

export function digits(value: unknown) {
  return String(value || "").replace(/\D/g, "")
}

export function recipientDocument(document: unknown) {
  const value = digits(document)
  if (value.length === 11) return { cpf: value }
  if (value.length === 14) return { cnpj: value }
  throw new Error("O cliente precisa ter um CPF com 11 digitos ou CNPJ com 14 digitos.")
}

export function notaAsPublicStatus(status: unknown) {
  const normalized = String(status || "queued").toLowerCase()
  const labels: Record<string, string> = {
    queued: "Na fila",
    processing: "Processando",
    issued: "Emitida",
    error: "Erro",
    cancelled: "Cancelada",
  }
  return labels[normalized] || String(status || "Na fila")
}
