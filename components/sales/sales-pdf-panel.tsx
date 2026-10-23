"use client"

import { useCallback, useEffect, useState } from "react"
import { Download, ExternalLink, FileText, Loader2, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SectionCard } from "@/components/operations/shared"
import { api, dateBr } from "@/components/catalog/catalog-fields"
import { emitSalesOrderPdf } from "@/lib/sales-pdf-client"

type Doc = { id: string; version: number; trigger_source: string; reason: string | null; file_name: string; size_bytes: number | null; emitted_by: string | null; emitted_at: string; photo_refs: Array<{ item: string; product: string; included: boolean; problem: string }>; configuration_refs: Array<{ item: string; summary: string; revision: string | null; drawing_grade: string | null }> }
type Photo = { id: string; purpose: string; caption: string | null; is_main: boolean; status: string; url: string }
const sourceLabel: Record<string, string> = { conversao: "Emitido na conversão do orçamento", manual: "Emissão manual", revisao: "Revisão comercial" }

/** PDF do pedido: versões já emitidas (imutáveis) e emissão de uma nova versão, com foto principal ou foto específica da configuração. */
export function SalesPdfPanel({ orderId, items, productIds }: { orderId: string; items: Array<{ id: string; description: string; line_type: string }>; productIds?: Record<string, string> }) {
  const [docs, setDocs] = useState<Doc[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [photos, setPhotos] = useState<Record<string, Photo[]>>({})
  const [choice, setChoice] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    try { setDocs((await api<{ documents: Doc[] }>(`/api/vendas/${orderId}/pdf`)).documents) } catch (error) { setMessage(error instanceof Error ? error.message : "Erro ao carregar os PDFs."); setDocs([]) }
  }, [orderId])
  useEffect(() => { void load() }, [load])

  async function openForm() {
    setOpen(true); setReason("")
    const next: Record<string, Photo[]> = {}
    for (const item of items.filter((row) => row.line_type === "Produto")) {
      const product = productIds?.[item.id]
      if (!product) continue
      try { next[item.id] = (await api<{ photos: Photo[] }>(`/api/produtos/${product}/fotos`)).photos.filter((photo) => photo.status === "Disponivel") } catch { next[item.id] = [] }
    }
    setPhotos(next)
  }
  async function emit() {
    setBusy(true); setMessage("")
    try {
      const first = !docs?.length
      const result = await emitSalesOrderPdf(orderId, { source: first ? "manual" : "revisao", reason, photos: choice })
      setMessage(`PDF versão ${result.version} emitido e guardado.${result.warnings.length ? ` Atenção: ${result.warnings.join(" ")}` : ""}`)
      setOpen(false); setChoice({})
      await load()
    } catch (error) { setMessage(error instanceof Error ? error.message : "PDF não emitido.") } finally { setBusy(false) }
  }
  const latest = docs?.[0]

  return (
    <div id="pedido-pdf">
      <SectionCard title="Pedido em PDF">
        <div className="space-y-3 text-sm">
          {message ? <p className="rounded-md border bg-muted/40 p-2" role="status">{message}</p> : null}
          {docs === null ? <p className="text-muted-foreground">Carregando...</p> : docs.length === 0 ? <p className="text-muted-foreground">Nenhum PDF emitido para este pedido ainda.</p> : (
            <ul className="divide-y rounded-md border">
              {docs.map((doc) => (
                <li key={doc.id} className="flex flex-wrap items-center gap-3 p-2" data-version={doc.version}>
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">Versão {doc.version}{doc.version === latest?.version ? " (vigente)" : ""} <span className="text-xs font-normal text-muted-foreground">· {sourceLabel[doc.trigger_source] || doc.trigger_source} · {dateBr(doc.emitted_at)} · {doc.emitted_by || "-"}</span></p>
                    {doc.reason ? <p className="text-xs text-muted-foreground">Motivo: {doc.reason}</p> : null}
                    <p className="text-xs text-muted-foreground">{doc.photo_refs.map((ref) => `${ref.item}: ${ref.included ? "foto incluída" : "sem foto"}`).join(" · ")}{doc.configuration_refs.length ? ` · ${doc.configuration_refs.map((ref) => `${ref.summary}${ref.revision ? ` (rev. ${ref.revision})` : ""}${ref.drawing_grade ? `, desenho ${ref.drawing_grade}` : ""}`).join("; ")}` : ""}</p>
                  </div>
                  <Button asChild size="sm" variant="outline"><a href={`/api/vendas/${orderId}/pdf?version=${doc.version}`} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3" />Visualizar</a></Button>
                  <Button asChild size="sm" variant="outline"><a href={`/api/vendas/${orderId}/pdf?version=${doc.version}&download=1`}><Download className="h-3 w-3" />Baixar</a></Button>
                </li>
              ))}
            </ul>
          )}
          {!open ? <Button onClick={() => void openForm()} disabled={busy || docs === null}><Plus className="h-4 w-4" />{docs?.length ? "Emitir nova versão" : "Emitir pedido em PDF"}</Button> : (
            <div className="space-y-3 rounded-md border p-3">
              {docs?.length ? <label className="block text-xs text-muted-foreground">Motivo da nova versão (a versão anterior continua guardada)<Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ex.: cliente trocou o acabamento" /></label> : null}
              {items.filter((row) => row.line_type === "Produto").map((item) => (
                <label key={item.id} className="block text-xs text-muted-foreground">Fotografia de “{item.description}”
                  <select className="mt-1 block h-9 w-full rounded-md border bg-background px-3 text-sm text-foreground" value={choice[item.id] || ""} onChange={(event) => setChoice((current) => { const next = { ...current }; if (event.target.value) next[item.id] = event.target.value; else delete next[item.id]; return next })}>
                    <option value="">Foto principal do produto</option>
                    {(photos[item.id] || []).map((photo) => <option key={photo.id} value={photo.id}>{photo.is_main ? "★ " : ""}{photo.caption || photo.purpose}</option>)}
                  </select>
                </label>
              ))}
              <div className="flex gap-2">
                <Button onClick={() => void emit()} disabled={busy || Boolean(docs?.length && reason.trim().length < 5)}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Emitir</Button>
                <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancelar</Button>
              </div>
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  )
}
