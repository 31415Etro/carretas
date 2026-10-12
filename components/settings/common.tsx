"use client"

import { SelectField } from "@/components/operations/shared"

export type Row = Record<string, any>
export const none = "nenhum"
export const day = (value?: string) => (value ? String(value).slice(0, 10).split("-").reverse().join("/") : "-")
export const stamp = (value?: string) => (value ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "-")
export const brl = (value: number) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: init?.body instanceof FormData ? init?.headers : { "Content-Type": "application/json", ...(init?.headers || {}) } })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
  return payload as T
}

export const post = <T,>(entity: string, body: Row) => api<T>(`/api/configuracoes/${entity}`, { method: "POST", body: JSON.stringify(body) })

export function Opts({ label, value, onChange, items, placeholder = "Selecione", disabled }: { label: string; value: string; onChange: (value: string) => void; items: Array<{ value: string; label: string }>; placeholder?: string; disabled?: boolean }) {
  return <div className={disabled ? "pointer-events-none opacity-70" : ""}><SelectField label={label} value={value || none} onChange={(next) => onChange(next === none ? "" : next)} options={[{ value: none, label: placeholder }, ...items]} /></div>
}
