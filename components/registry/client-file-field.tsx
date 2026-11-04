"use client"

import { useRef, useState } from "react"
import { Camera, CheckCircle2, FileText, ImagePlus, Loader2, Paperclip, TriangleAlert, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { compressPhoto } from "@/lib/image-compress"
import { isImageFile, isPdfFile, ocrInvoiceFile, ocrReceiptImage } from "@/lib/ocr-client"

type Message = { tone: "info" | "ok" | "warn"; text: string }

/**
 * Documento do cliente (CNH ou comprovante de residência) em foto ou PDF: guarda o arquivo no cadastro (bucket privado) e lê o texto
 * (camada de texto do PDF no servidor; foto e PDF escaneado por OCR no navegador). `onText` recebe o texto lido e devolve a mensagem para a tela.
 */
export function ClientFileField({ kind, label, hint, value, onChange, onText }: {
  kind: "cnh" | "residencia"; label: string; hint?: string; value: string; onChange: (path: string) => void
  onText: (text: string) => Promise<string | void> | string | void
}) {
  const camera = useRef<HTMLInputElement>(null)
  const gallery = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Message | null>(null)

  async function handle(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    setBusy(true); setMessage({ tone: "info", text: "Guardando o documento..." })
    try {
      let stored: File = file
      if (isImageFile(file)) { try { stored = await compressPhoto(file, { maxSide: 2600, quality: 0.88 }) } catch { /* guarda o original */ } }
      const body = new FormData()
      body.append("file", stored); body.append("kind", kind)
      const response = await fetch("/api/cadastros/documentos", { method: "POST", body })
      const saved = await response.json().catch(() => null)
      if (!response.ok) throw new Error(saved?.error || `Erro ${response.status}`)
      onChange(saved.path)

      let text = String(saved.text || "")
      if (!text.trim()) {
        setMessage({ tone: "info", text: "Documento guardado. Lendo o texto..." })
        try {
          const read = await Promise.race([
            isPdfFile(file) ? ocrInvoiceFile(file, (progress) => setMessage({ tone: "info", text: progress })) : ocrReceiptImage(stored, (progress) => setMessage({ tone: "info", text: progress.replace("a notinha", "o documento") })),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 90_000)),
          ])
          text = read || ""
        } catch (reason) {
          setMessage({ tone: "warn", text: `Documento guardado, mas não consegui ler: ${reason instanceof Error ? reason.message : "tente outra foto"}. Preencha à mão.` })
          return
        }
      }
      if (!text.trim()) return setMessage({ tone: "warn", text: "Documento guardado, mas não consegui ler texto nele (foto escura, torta ou com reflexo?). Preencha à mão ou envie outra foto." })
      const result = await onText(text)
      setMessage({ tone: "ok", text: result || "Documento guardado e lido." })
    } catch (reason) {
      setMessage({ tone: "warn", text: reason instanceof Error ? reason.message : "Não foi possível guardar o documento." })
    } finally {
      setBusy(false)
    }
  }

  const accept = "image/jpeg,image/png,image/webp,application/pdf"
  return (
    <div className="space-y-2 rounded-md border border-dashed p-3 md:col-span-2">
      <Label className="flex items-center gap-2"><Paperclip className="h-4 w-4" />{label}</Label>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={handle} />
      <input ref={gallery} type="file" accept={accept} hidden onChange={handle} />
      {value ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2 text-sm">
          <FileText className="h-5 w-5 text-muted-foreground" />
          <a href={`/api/cadastros/documentos?path=${encodeURIComponent(value)}`} target="_blank" rel="noreferrer" className="text-primary underline">Abrir documento salvo</a>
          <Button type="button" size="icon" variant="ghost" className="ml-auto h-7 w-7" title="Remover do cadastro" onClick={() => { onChange(""); setMessage(null) }}><X className="h-4 w-4" /></Button>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => camera.current?.click()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}Tirar foto</Button>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => gallery.current?.click()}><ImagePlus className="h-4 w-4" />{value ? "Trocar (foto ou PDF)" : "Escolher foto ou PDF"}</Button>
      </div>
      {message ? <p className={`flex items-start gap-2 text-xs ${message.tone === "warn" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>{message.tone === "ok" ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : message.tone === "warn" ? <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />}{message.text}</p> : null}
    </div>
  )
}
