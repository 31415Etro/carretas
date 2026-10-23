"use client"

import { useRef, useState } from "react"
import { Camera, ImagePlus, Loader2, TriangleAlert, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { compressPhoto } from "@/lib/image-compress"
import { ocrReceiptImage } from "@/lib/ocr-client"
import { parseIdDocument, type ParsedIdDocument } from "@/lib/id-document"

/** Foto (câmera ou galeria) do RG/CIN ou da CNH: lê no navegador e devolve nome, CPF, nascimento e demais dados para preencher o cadastro de pessoa física. */
export function IdDocumentCapture({ onRead }: { onRead: (parsed: ParsedIdDocument) => void }) {
  const camera = useRef<HTMLInputElement>(null)
  const gallery = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: "info" | "ok" | "warn"; text: string } | null>(null)

  async function handle(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    setBusy(true); setMessage({ tone: "info", text: "Preparando a foto..." })
    try {
      let photo: File = file
      try { photo = await compressPhoto(file, { maxSide: 2200, quality: 0.85 }) } catch { /* segue com o arquivo original */ }
      const text = await Promise.race([
        ocrReceiptImage(photo, (progress) => setMessage({ tone: "info", text: progress.replace("a notinha", "o documento").replace("a nota", "o documento") })),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 60000)),
      ])
      if (!text || !text.trim()) throw new Error("Não consegui ler texto na foto. Tire de novo, de perto, sem reflexo e com o documento aberto e reto.")
      const parsed = parseIdDocument(text)
      if (!parsed.name && !parsed.cpf) throw new Error("A foto foi lida, mas não achei nome nem CPF. Tente outra foto mais nítida ou preencha à mão.")
      onRead(parsed)
      setMessage({ tone: parsed.warnings.length ? "warn" : "ok", text: `Dados do ${parsed.kind === "CNH" ? "CNH" : "documento"} preenchidos${parsed.warnings.length ? ` — ${parsed.warnings.join(" ")}` : ""} Confira antes de salvar.` })
    } catch (reason) {
      setMessage({ tone: "warn", text: reason instanceof Error ? reason.message : "Não foi possível ler o documento." })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-dashed p-3">
      <div className="text-sm font-medium">Preencher pela foto do RG ou da CNH</div>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={handle} />
      <input ref={gallery} type="file" accept="image/*" hidden onChange={handle} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => camera.current?.click()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}Tirar foto</Button>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => gallery.current?.click()}><ImagePlus className="h-4 w-4" />Escolher da galeria</Button>
      </div>
      {message ? <p className={`flex items-start gap-2 text-xs ${message.tone === "warn" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>{message.tone === "ok" ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : message.tone === "warn" ? <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />}{message.text}</p> : null}
    </div>
  )
}
