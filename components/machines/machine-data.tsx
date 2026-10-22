"use client"

import { useCallback, useEffect, useState } from "react"

export type Row = Record<string, any>
export type Caps = { view: boolean; maintain: boolean; patrimony: boolean; admin: boolean }
export type Overview = {
  machines: Row[]; sectors: Row[]; categories: Row[]; plans: Row[]; orders: Row[]; units: Row[]
  settings: { codePrefix: string; qrBaseUrl: string; dueSoonDays: number; highCostPercent: number; autoCreateOrders: boolean }
  caps: Caps; serverTime: string; today: string
}

export async function mApi<T = any>(action: string, init?: { method?: string; body?: unknown; query?: Record<string, string> }): Promise<T> {
  const query = init?.query ? `?${new URLSearchParams(init.query)}` : ""
  const response = await fetch(`/api/maquinas/${action}${query}`, {
    method: init?.method || (init?.body ? "POST" : "GET"), cache: "no-store",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined, body: init?.body ? JSON.stringify(init.body) : undefined,
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw Object.assign(new Error(payload?.error || `Erro ${response.status}`), { status: response.status, code: payload?.code })
  return payload as T
}

export async function uploadMachineFile(file: File, machineId: string) {
  const body = new FormData()
  body.set("file", file)
  body.set("machineId", machineId)
  const response = await fetch("/api/maquinas/file", { method: "POST", body })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
  return payload as { path: string; name: string }
}
export const fileUrl = (path?: string) => (path ? `/api/maquinas/file?path=${encodeURIComponent(path)}` : "")

/**
 * Carrega o painel e o mantém sincronizado entre usuários: refaz a leitura a cada 30 s (com a aba visível)
 * e quando a aba volta ao foco. O status vem sempre do servidor.
 */
export function useMachines(pollMs = 30000) {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const reload = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      setData(await mApi<Overview>("data"))
      setError("")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Erro ao carregar.")
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    void reload()
    const tick = () => { if (document.visibilityState === "visible") void reload(true) }
    const timer = window.setInterval(tick, pollMs)
    document.addEventListener("visibilitychange", tick)
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", tick) }
  }, [reload, pollMs])
  return { data, error, loading, reload }
}

/** Relógio para "tempo no status atual" (atualiza a cada 30 s). */
export function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}

export const brl = (value: number | null | undefined) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
export const day = (value?: string | null) => (value ? String(value).slice(0, 10).split("-").reverse().join("/") : "—")
export const dateTime = (value?: string | null) => (value ? new Date(value).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—")
export const hours = (value: number | null | undefined) => `${Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`
/** Valor para <input type="datetime-local"> no horário local. */
export const localInputNow = () => {
  const date = new Date()
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
}
