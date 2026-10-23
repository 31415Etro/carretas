"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { AlertTriangle, Camera, CheckCircle2, Clock, ImagePlus, Loader2, Pencil, Receipt, Trash2, TriangleAlert, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { BrandMark } from "@/components/shell/brand-mark"
import { AppFooter } from "@/components/shell/app-footer"
import { ocrReceiptImage } from "@/lib/ocr-client"
import { compressPhoto } from "@/lib/image-compress"
import { CATEGORY_LABEL } from "@/lib/travel-advance"

type PortalReceipt = { id: string; photoUrl: string; amount: number; establishment: string; category: string; occurredAt: string | null; status: string; reviewNote: string }
type CategorySummary = { category: string; budget: number; spent: number; remaining: number; overspent: boolean }
type PortalState = {
  reason: string; amount: number; startDate: string; endDate: string; status: "Aberto" | "Finalizado" | "Concluido" | "Cancelado"
  employeeName: string; ownPocketJustification: string; settlementAction: string | null; settlementResolved: boolean; canUpload: boolean
  summary: { budget: number; spent: number; remaining: number; overspent: boolean; overspentAmount: number }
  categories: CategorySummary[]
  receipts: PortalReceipt[]
}

const brl = (value: unknown) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const day = (value?: string | null) => (value ? value.split("-").reverse().join("/") : "-")

async function send<T>(url: string, init?: RequestInit, timeoutMs = 60000): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal, ...init })
    const payload = await response.json().catch(() => null)
    if (response.status === 413) throw new Error("A foto ficou grande demais para enviar. Tire outra foto mais de perto ou use o modo de menor resolução da câmera.")
    if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
    return payload as T
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === "AbortError") throw new Error("O envio demorou demais (internet fraca?). Tente de novo.")
    if (reason instanceof TypeError) throw new Error("Sem conexão com a internet. Confira o sinal e tente de novo.")
    throw reason
  } finally {
    clearTimeout(timer)
  }
}

/** Leitura automática com prazo: no celular o OCR pode demorar muito; passado o prazo, a pessoa preenche à mão. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))])
}

const STATUS_STYLE: Record<string, string> = {
  Enviado: "border-slate-200 bg-slate-50 text-slate-600", Aprovado: "border-emerald-200 bg-emerald-50 text-emerald-700", Contestado: "border-red-200 bg-red-50 text-red-700",
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">{children}</div>
}

export function TravelAdvancePortal({ token }: { token: string }) {
  const [state, setState] = useState<PortalState | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [stage, setStage] = useState("")
  const [uploading, setUploading] = useState(false)
  const [reading, setReading] = useState(false)
  const [justification, setJustification] = useState("")
  const [settlement, setSettlement] = useState<"devolver" | "desconto_folha" | "">("")
  const [editingId, setEditingId] = useState("")
  const [editDraft, setEditDraft] = useState({ amount: "", establishment: "", occurredAt: "", category: "" })
  const [finalizing, setFinalizing] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const gallery = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const data = await send<PortalState>(`/api/viagem/portal/${token}`)
      setState(data)
      setJustification(data.ownPocketJustification || "")
      setSettlement((data.settlementAction as "devolver" | "desconto_folha") || "")
      setError("")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao abrir o link.")
    } finally {
      setLoading(false)
    }
  }, [token])
  useEffect(() => { void load() }, [load])

  /** Câmera (foto na hora) ou biblioteca do celular (uma ou várias notas): sobe todas primeiro, lê os valores depois. */
  async function handleFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || [])
    event.target.value = ""
    if (!files.length) return
    setUploading(true)
    const sent: Array<{ id: string; photo: File }> = []
    const problems: string[] = []
    for (const [index, original] of files.entries()) {
      const label = files.length > 1 ? ` (${index + 1} de ${files.length})` : ""
      try {
        if (!original.type.startsWith("image/") && !/\.(jpe?g|png|webp|heic|heif)$/i.test(original.name)) throw new Error("Escolha uma foto (JPG, PNG ou WEBP).")
        // reduz a foto (celular: 5 a 12 MB -> ~0,5 MB) e envia JÁ, sem esperar a leitura
        setStage(`Preparando a foto${label}...`)
        let photo: File = original
        try { photo = await compressPhoto(original) } catch { if (original.size > 4 * 1024 * 1024) throw new Error("Não consegui preparar esta foto. Escolha outra em JPG ou reduza a resolução.") }
        setStage(`Enviando a foto${label}...`)
        const form = new FormData()
        form.set("file", photo)
        const uploaded = await send<{ receipt: { id: string } }>(`/api/viagem/portal/${token}/recibos`, { method: "POST", body: form })
        sent.push({ id: uploaded.receipt.id, photo })
        await load()
      } catch (reason) {
        problems.push(`${original.name || "foto"}: ${reason instanceof Error ? reason.message : "erro ao enviar"}`)
      }
    }
    setUploading(false); setStage("")
    if (problems.length) alert(`${sent.length ? `${sent.length} nota(s) enviada(s). ` : ""}Não foi possível enviar:\n${problems.join("\n")}`)
    if (!sent.length) return
    // leitura automática do valor e do estabelecimento em segundo plano, com prazo por nota; se não der, a pessoa corrige na lista
    setReading(true)
    try {
      for (const item of sent) {
        try {
          const text = await withTimeout(ocrReceiptImage(item.photo, () => undefined), 45000)
          if (text && text.trim()) {
            await send(`/api/viagem/portal/${token}/recibos/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ocrText: text }) }, 30000)
            await load()
          }
        } catch {
          /* a foto já foi enviada: valor e estabelecimento ficam para preencher à mão */
        }
      }
    } finally {
      setReading(false)
    }
  }

  async function removeReceipt(id: string) {
    if (!window.confirm("Remover esta notinha?")) return
    await send(`/api/viagem/portal/${token}/recibos/${id}`, { method: "DELETE" }).catch((reason) => alert(reason.message))
    await load()
  }

  function startEdit(receipt: PortalReceipt) {
    setEditingId(receipt.id)
    setEditDraft({ amount: String(receipt.amount), establishment: receipt.establishment, occurredAt: receipt.occurredAt || "", category: receipt.category })
  }

  async function saveEdit(id: string) {
    await send(`/api/viagem/portal/${token}/recibos/${id}`, { method: "PATCH", body: JSON.stringify({ amount: Number(editDraft.amount), establishment: editDraft.establishment, occurredAt: editDraft.occurredAt, category: editDraft.category }) }).catch((reason) => alert(reason.message))
    setEditingId("")
    await load()
  }

  async function finalize() {
    if (!window.confirm("Finalizar a prestação de contas deste orçamento de viagem? Depois disso você não poderá mais enviar ou remover notinhas, só até o financeiro revisar.")) return
    setFinalizing(true)
    try {
      await send(`/api/viagem/portal/${token}/finalizar`, { method: "POST", body: JSON.stringify({ ownPocketJustification: justification, settlementAction: settlement || null }) })
      await load()
    } catch (reason) {
      alert(reason instanceof Error ? reason.message : "Erro ao finalizar.")
    } finally {
      setFinalizing(false)
    }
  }

  const shell = (content: React.ReactNode) => (
    <div className="min-h-screen bg-[var(--brand-softer)]">
      <div className="mx-auto w-full max-w-2xl px-4 py-8 md:py-12">
        <div className="mb-6 flex justify-center"><BrandMark className="text-3xl" /></div>
        {content}
        <AppFooter className="mt-8" />
      </div>
    </div>
  )

  if (loading) return shell(<Card><p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Abrindo...</p></Card>)
  if (error || !state) return shell(<Card><p className="flex items-center gap-2 text-sm text-destructive"><TriangleAlert className="h-4 w-4 shrink-0" />{error || "Link inválido."}</p></Card>)

  const pct = state.summary.budget > 0 ? Math.min(100, (state.summary.spent / state.summary.budget) * 100) : 0
  const needsJustification = state.summary.overspent && !justification.trim()
  const needsSettlement = state.summary.remaining > 0.004 && !settlement
  const contested = state.receipts.filter((receipt) => receipt.status === "Contestado")

  return shell(
    <div className="space-y-4">
      <Card>
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--brand)]">Orçamento de viagem de {state.employeeName}</p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">{state.reason || "Prestação de contas"}</h1>
        <p className="mt-1 text-sm text-slate-500">Prazo: {day(state.startDate)} até {day(state.endDate)}</p>
        <div className="mt-4 grid grid-cols-3 gap-3 text-center">
          <div><p className="text-xs text-slate-500">Disponível</p><p className="text-lg font-semibold">{brl(state.summary.budget)}</p></div>
          <div><p className="text-xs text-slate-500">Gasto</p><p className="text-lg font-semibold">{brl(state.summary.spent)}</p></div>
          <div><p className="text-xs text-slate-500">Saldo</p><p className={`text-lg font-semibold ${state.summary.overspent ? "text-red-600" : "text-emerald-600"}`}>{brl(state.summary.remaining)}</p></div>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${state.summary.overspent ? "bg-red-500" : "bg-[var(--brand)]"}`} style={{ width: `${pct}%` }} /></div>
        {state.status === "Finalizado" ? <p className="mt-3 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800"><Clock className="h-4 w-4 shrink-0" />Prestação de contas enviada: o financeiro está revisando as notinhas.</p> : null}
        {state.status === "Concluido" ? <p className="mt-3 flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="h-4 w-4 shrink-0" />Prestação de contas concluída. Obrigado!</p> : null}
        {state.status === "Cancelado" ? <p className="mt-3 flex items-center gap-2 rounded-md border border-slate-300 bg-slate-100 p-3 text-sm text-slate-700"><X className="h-4 w-4 shrink-0" />Este orçamento de viagem foi cancelado.</p> : null}
      </Card>

      {state.categories.length > 0 ? (
        <Card>
          <p className="mb-3 text-sm font-semibold text-slate-700">Divisão do orçamento</p>
          <div className="space-y-3">
            {state.categories.map((item) => {
              const itemPct = item.budget > 0 ? Math.min(100, (item.spent / item.budget) * 100) : 0
              return (
                <div key={item.category}>
                  <div className="flex items-center justify-between text-sm"><span>{CATEGORY_LABEL[item.category] || item.category}</span><span className={item.overspent ? "font-medium text-red-600" : "text-slate-600"}>{brl(item.spent)} de {brl(item.budget)}</span></div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${item.overspent ? "bg-red-500" : "bg-[var(--brand)]"}`} style={{ width: `${itemPct}%` }} /></div>
                </div>
              )
            })}
          </div>
        </Card>
      ) : null}

      {contested.length > 0 ? (
        <Card>
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-red-700"><AlertTriangle className="h-4 w-4" />O financeiro pediu ajuste em {contested.length} nota(s)</p>
          <ul className="space-y-1 text-sm text-red-700">{contested.map((receipt) => <li key={receipt.id}>• {receipt.establishment || "Notinha"} ({brl(receipt.amount)}): {receipt.reviewNote}</li>)}</ul>
          <p className="mt-2 text-xs text-muted-foreground">Corrija ou remova e envie de novo a notinha, depois finalize outra vez.</p>
        </Card>
      ) : null}

      {state.canUpload ? (
        <Card>
          <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={handleFiles} />
          <input ref={gallery} type="file" accept="image/*" multiple hidden onChange={handleFiles} />
          <div className="grid gap-2 sm:grid-cols-2">
            <Button className="w-full bg-[var(--brand)] hover:bg-[var(--brand-dark)]" disabled={uploading} onClick={() => input.current?.click()}>
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}{uploading ? stage || "Enviando..." : "Tirar foto da notinha"}
            </Button>
            <Button variant="outline" className="w-full" disabled={uploading} onClick={() => gallery.current?.click()}>
              <ImagePlus className="h-4 w-4" />Escolher da galeria
            </Button>
          </div>
          {reading ? <p className="mt-2 flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-3 w-3 animate-spin" />Foto enviada. Lendo o valor e o estabelecimento em segundo plano; se não aparecerem, corrija na lista.</p> : null}
        </Card>
      ) : null}

      <Card>
        <p className="mb-3 text-sm font-semibold text-slate-700">Notinhas enviadas ({state.receipts.length})</p>
        {state.receipts.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma notinha enviada ainda.</p> : (
          <ul className="space-y-3">
            {state.receipts.map((receipt) => (
              <li key={receipt.id} className="flex gap-3 rounded-lg border border-slate-200 p-3">
                <a href={receipt.photoUrl} target="_blank" rel="noreferrer"><img src={receipt.photoUrl} alt="Notinha" className="h-16 w-16 shrink-0 rounded object-cover" /></a>
                <div className="min-w-0 flex-1">
                  {editingId === receipt.id ? (
                    <div className="space-y-2">
                      <Input value={editDraft.establishment} onChange={(event) => setEditDraft((current) => ({ ...current, establishment: event.target.value }))} placeholder="Estabelecimento" />
                      <div className="grid grid-cols-2 gap-2">
                        <Input type="number" value={editDraft.amount} onChange={(event) => setEditDraft((current) => ({ ...current, amount: event.target.value }))} placeholder="Valor" />
                        <Input type="date" value={editDraft.occurredAt} onChange={(event) => setEditDraft((current) => ({ ...current, occurredAt: event.target.value }))} />
                      </div>
                      <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={editDraft.category} onChange={(event) => setEditDraft((current) => ({ ...current, category: event.target.value }))}>
                        {Object.entries(CATEGORY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                      <div className="flex gap-2"><Button size="sm" onClick={() => void saveEdit(receipt.id)}>Salvar</Button><Button size="sm" variant="ghost" onClick={() => setEditingId("")}>Cancelar</Button></div>
                    </div>
                  ) : (
                    <>
                      <p className="truncate font-medium text-slate-900">{receipt.establishment || "(estabelecimento não identificado)"}</p>
                      <p className="text-sm text-slate-500">{CATEGORY_LABEL[receipt.category] || receipt.category} · {day(receipt.occurredAt)}</p>
                      <div className="mt-1 flex items-center justify-between">
                        <strong>{brl(receipt.amount)}</strong>
                        <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLE[receipt.status] || ""}`}>{receipt.status}</span>
                      </div>
                      {receipt.status === "Contestado" ? <p className="mt-1 text-xs text-red-600">{receipt.reviewNote}</p> : null}
                      {receipt.status !== "Aprovado" && state.canUpload ? (
                        <div className="mt-1 flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => startEdit(receipt)}><Pencil className="h-3.5 w-3.5" /></Button>
                          <Button size="sm" variant="ghost" onClick={() => void removeReceipt(receipt.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {state.status === "Aberto" ? (
        <Card>
          {state.summary.overspent ? (
            <div className="mb-4">
              <Label>Você gastou mais do que o disponibilizado: explique o que pagou do seu bolso</Label>
              <Textarea className="mt-1" rows={2} value={justification} onChange={(event) => setJustification(event.target.value)} placeholder="Ex.: paguei a diferença no cartão pessoal, peço reembolso." />
            </div>
          ) : null}
          {state.summary.remaining > 0.004 ? (
            <div className="mb-4">
              <Label>Sobrou {brl(state.summary.remaining)}: o que você quer fazer?</Label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <button type="button" onClick={() => setSettlement("devolver")} className={`flex-1 rounded-md border p-3 text-left text-sm ${settlement === "devolver" ? "border-[var(--brand)] bg-[var(--brand-softer)]" : "border-slate-200"}`}>Devolver o valor ao financeiro</button>
                <button type="button" onClick={() => setSettlement("desconto_folha")} className={`flex-1 rounded-md border p-3 text-left text-sm ${settlement === "desconto_folha" ? "border-[var(--brand)] bg-[var(--brand-softer)]" : "border-slate-200"}`}>Descontar do meu salário</button>
              </div>
            </div>
          ) : null}
          <Button className="w-full bg-[var(--brand)] hover:bg-[var(--brand-dark)]" disabled={finalizing || needsJustification || needsSettlement || !state.receipts.length} onClick={() => void finalize()}>
            {finalizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Receipt className="h-4 w-4" />}Finalizar prestação de contas
          </Button>
          {!state.receipts.length ? <p className="mt-2 text-center text-xs text-muted-foreground">Envie ao menos uma notinha para finalizar.</p> : null}
        </Card>
      ) : null}
    </div>,
  )
}
