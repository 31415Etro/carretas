// Emissão do PDF do pedido a partir do navegador: busca os dados congelados no servidor, monta o PDF e o grava como uma versão nova e imutável.
import { buildSalesOrderPdf, type SalesPdfData } from "./sales-order-pdf.ts"

export type EmittedPdf = { version: number; duplicate: boolean; warnings: string[]; fileName: string }

async function json<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
  return payload as T
}

export async function emitSalesOrderPdf(orderId: string, options: { source: "conversao" | "manual" | "revisao"; reason?: string; photos?: Record<string, string> }): Promise<EmittedPdf> {
  const choices = Object.entries(options.photos || {}).map(([item, photo]) => `${item}:${photo}`).join(",")
  const { data } = await json<{ data: SalesPdfData }>(await fetch(`/api/vendas/${orderId}/pdf?data=1${choices ? `&photos=${encodeURIComponent(choices)}` : ""}`, { cache: "no-store" }))
  const built = await buildSalesOrderPdf(data)
  const blob = built.doc.output("blob")
  const form = new FormData()
  form.append("file", new File([blob], built.fileName, { type: "application/pdf" }))
  form.append("source", options.source)
  form.append("reason", options.reason || "")
  form.append("photoRefs", JSON.stringify(built.photoRefs))
  form.append("configurationRefs", JSON.stringify(built.configurationRefs))
  form.append("summary", JSON.stringify({ total: data.order.totalAmount, items: data.items.length, installments: data.installments.length, warnings: built.warnings, version: data.order.version }))
  const saved = await json<{ saved: { version: number; duplicate: boolean } }>(await fetch(`/api/vendas/${orderId}/pdf`, { method: "POST", body: form }))
  return { version: saved.saved.version, duplicate: saved.saved.duplicate, warnings: built.warnings, fileName: built.fileName }
}
