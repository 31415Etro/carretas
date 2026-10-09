"use client"

import { useEffect } from "react"

const recent = new Map<string, number>()

function requestInfo(input: RequestInfo | URL, init?: RequestInit) {
  const raw = input instanceof Request ? input.url : String(input)
  const url = new URL(raw, window.location.origin)
  return { path: `${url.pathname}${url.search}`.slice(0, 500), method: String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase() }
}

export function SystemErrorMonitor() {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window)
    const report = (payload: Record<string, unknown>) => {
      const key = JSON.stringify([payload.source, payload.message, payload.path, payload.statusCode])
      const last = recent.get(key) || 0
      if (Date.now() - last < 60_000) return
      recent.set(key, Date.now())
      void originalFetch("/api/system-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {})
    }
    const monitoredFetch: typeof window.fetch = async (input, init) => {
      const info = requestInfo(input, init)
      if (info.path.startsWith("/api/system-logs")) return originalFetch(input, init)
      try {
        const response = await originalFetch(input, init)
        if (response.status === 413 || response.status >= 500) {
          const payload = await response.clone().json().catch(() => null)
          report({ source: "Requisicao HTTP", message: payload?.error || `Resposta HTTP ${response.status}`, statusCode: response.status, ...info, details: { page: window.location.pathname } })
        }
        return response
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          report({ source: "Falha de rede", message: error instanceof Error ? error.message : "Requisicao interrompida", ...info, details: { page: window.location.pathname } })
        }
        throw error
      }
    }
    const onError = (event: ErrorEvent) => report({ source: "Erro JavaScript", message: event.message || event.error?.message || "Erro no navegador", path: window.location.pathname, method: "CLIENT", details: { file: event.filename, line: event.lineno, column: event.colno } })
    const onUnhandled = (event: PromiseRejectionEvent) => report({ source: "Promise rejeitada", message: event.reason instanceof Error ? event.reason.message : String(event.reason || "Erro assincrono"), path: window.location.pathname, method: "CLIENT" })
    window.fetch = monitoredFetch
    window.addEventListener("error", onError)
    window.addEventListener("unhandledrejection", onUnhandled)
    return () => {
      if (window.fetch === monitoredFetch) window.fetch = originalFetch
      window.removeEventListener("error", onError)
      window.removeEventListener("unhandledrejection", onUnhandled)
    }
  }, [])
  return null
}
