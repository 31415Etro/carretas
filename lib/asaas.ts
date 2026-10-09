import { timingSafeEqual } from "node:crypto"
import { asaasResourceFromPayload } from "@/lib/asaas-events"
import { resolveAsaasConfig } from "@/lib/asaas-config"

export type AsaasAccountCode = "services" | "materials"
export type AsaasEnvironment = "sandbox" | "production"

export interface AsaasAccountConfig {
  code: AsaasAccountCode
  label: string
  environment: AsaasEnvironment
  baseUrl: string
  apiKey: string
  webhookToken: string
  configurationError: string
}

export class AsaasApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details: unknown,
  ) {
    super(message)
    this.name = "AsaasApiError"
  }
}

export function isAsaasAccountCode(value: unknown): value is AsaasAccountCode {
  return value === "services" || value === "materials"
}

export function getAsaasAccountConfig(code: AsaasAccountCode): AsaasAccountConfig {
  return resolveAsaasConfig(code, process.env)
}

export function asaasConfigurationStatus(code: AsaasAccountCode) {
  const config = getAsaasAccountConfig(code)
  return {
    code,
    label: config.label,
    environment: config.environment,
    apiConfigured: Boolean(config.apiKey),
    configurationError: config.configurationError || null,
    webhookConfigured: config.webhookToken.length >= 32,
  }
}

export async function asaasRequest<T>(code: AsaasAccountCode, path: string, init: RequestInit = {}): Promise<T> {
  const config = getAsaasAccountConfig(code)
  if (!config.apiKey) throw new AsaasApiError(`Chave da conta Asaas de ${config.label.toLowerCase()} nao configurada.`, 503, null)
  if (config.configurationError) throw new AsaasApiError(config.configurationError, 503, null)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(`${config.baseUrl}/${path.replace(/^\//, "")}`, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": "erp-carretas/1.0",
        access_token: config.apiKey,
        ...(init.headers || {}),
      },
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      const errors = Array.isArray(payload?.errors) ? payload.errors.map((item: { description?: string }) => item.description).filter(Boolean).join("; ") : ""
      const message = errors || payload?.message || `Asaas respondeu HTTP ${response.status}.`
      throw new AsaasApiError(`Conta de ${config.label.toLowerCase()} (${config.environment}): ${message}`, response.status, payload)
    }
    return payload as T
  } finally {
    clearTimeout(timeout)
  }
}

export function verifyAsaasWebhookToken(code: AsaasAccountCode, received: string | null) {
  const expected = getAsaasAccountConfig(code).webhookToken
  if (!expected || expected.length < 32 || !received) return false
  const left = Buffer.from(expected)
  const right = Buffer.from(received)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function asaasExternalReference(serviceOrderId: string, account: AsaasAccountCode) {
  return `MC:OS:${serviceOrderId}:${account}`
}

export function paymentStatusToFinancialStatus(status = "") {
  if (["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(status)) return "Realizado"
  if (["REFUNDED", "REFUND_REQUESTED", "CHARGEBACK_REQUESTED", "CHARGEBACK_DISPUTE", "AWAITING_CHARGEBACK_REVERSAL"].includes(status)) return "Estornado"
  if (["DELETED", "CANCELED"].includes(status)) return "Cancelado"
  if (status === "OVERDUE") return "Vencido"
  return "Previsto"
}

export function statementDirection(value: number) {
  return value < 0 ? "saida" : "entrada"
}

export function resourceFromWebhook(payload: Record<string, unknown>) {
  return asaasResourceFromPayload(payload)
}
