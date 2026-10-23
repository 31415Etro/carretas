"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowLeft, ArrowRight, ImageOff, Loader2, Star, Trash2, Upload, ZoomIn } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { SectionCard } from "@/components/operations/shared"
import { api } from "@/components/catalog/catalog-fields"
import { useAuth } from "@/lib/auth-context"

export type Photo = { id: string; url: string; purpose: string; caption: string | null; is_main: boolean; position: number; status: string; original_name: string | null; verify_note: string | null; legacy: boolean; created_by: string | null }
const purposeLabel: Record<string, string> = { comercial: "Comercial", detalhe: "Detalhe", configuracao: "Configuração específica" }
const MAX = 15 * 1024 * 1024

/**
 * Fotografias COMERCIAIS do produto (não são desenhos técnicos nem documentos de homologação: esses ficam em Engenharia e Homologação).
 * Cada imagem é guardada no armazenamento com caminho definitivo; a tela só usa a URL estável do registro.
 */
export function PhotoGallery({ productId, onChange }: { productId: string; onChange?: () => void }) {
  const { user } = useAuth()
  const manager = user?.role === "admin" || user?.role === "manager"
  const [photos, setPhotos] = useState<Photo[] | null>(null)
  const [busy, setBusy] = useState("")
  const [message, setMessage] = useState("")
  const [purpose, setPurpose] = useState("comercial")
  const [broken, setBroken] = useState<Record<string, boolean>>({})
  const [zoom, setZoom] = useState<Photo | null>(null)
  const [removing, setRemoving] = useState<Photo | null>(null)
  const [reason, setReason] = useState("")
  const input = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try { setPhotos((await api<{ photos: Photo[] }>(`/api/produtos/${productId}/fotos`)).photos) } catch (error) { setMessage(error instanceof Error ? error.message : "Erro ao carregar as fotografias."); setPhotos([]) }
  }, [productId])
  useEffect(() => { void load() }, [load])

  const apply = (next: Photo[]) => { setPhotos(next); setBroken({}); onChange?.() }
  async function act(key: string, body: Record<string, unknown>, success = "") {
    setBusy(key); setMessage("")
    try { apply((await api<{ photos: Photo[] }>(`/api/produtos/${productId}/fotos`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).photos); if (success) setMessage(success) } catch (error) { setMessage(error instanceof Error ? error.message : "Ação não concluída.") } finally { setBusy("") }
  }
  async function upload(files: FileList | null) {
    if (!files?.length) return
    setBusy("upload"); setMessage("")
    const done: string[] = []
    try {
      for (const file of Array.from(files)) {
        if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error(`"${file.name}" não é JPG, PNG ou WEBP.`)
        if (file.size > MAX) throw new Error(`"${file.name}" passa de 15 MB.`)
        const body = new FormData()
        body.append("file", file); body.append("purpose", purpose)
        const response = await api<{ photos: Photo[] }>(`/api/produtos/${productId}/fotos`, { method: "POST", body })
        apply(response.photos); done.push(file.name)
      }
      setMessage(`${done.length} fotografia(s) enviada(s) e confirmada(s) no armazenamento.`)
    } catch (error) {
      setMessage(`${done.length ? `${done.length} enviada(s). ` : ""}${error instanceof Error ? error.message : "Envio não concluído."}`)
    } finally { setBusy(""); if (input.current) input.current.value = "" }
  }
  const move = (index: number, delta: number) => {
    if (!photos) return
    const ids = photos.map((photo) => photo.id)
    const target = index + delta
    if (target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    void act("reorder", { action: "reorder", ids })
  }
  const unavailable = (photo: Photo) => photo.status === "Indisponivel" || broken[photo.id]

  return (
    <SectionCard title="Fotografias do produto">
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-muted-foreground">Finalidade
            <select value={purpose} onChange={(event) => setPurpose(event.target.value)} className="mt-1 block h-9 rounded-md border bg-background px-3 text-sm text-foreground">
              {Object.entries(purposeLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <Button type="button" onClick={() => input.current?.click()} disabled={busy === "upload"}>{busy === "upload" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}Enviar fotografias</Button>
          <Input ref={input} className="hidden" type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(event) => void upload(event.target.files)} />
          <p className="text-xs text-muted-foreground">JPG, PNG ou WEBP até 15 MB. A primeira vira a foto principal (usada nas listas e no pedido em PDF).</p>
        </div>
        {message ? <p className="rounded-md border bg-muted/40 p-2 text-sm" role="status">{message}</p> : null}
        {photos === null ? <p className="text-sm text-muted-foreground">Carregando...</p> : photos.length === 0 ? <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhuma fotografia cadastrada. Envie a primeira acima.</p> : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {photos.map((photo, index) => (
              <li key={photo.id} className="overflow-hidden rounded-md border" data-photo-id={photo.id}>
                <div className="relative aspect-[4/3] bg-muted">
                  {unavailable(photo) ? (
                    <div className="flex h-full flex-col items-center justify-center gap-1 p-3 text-center text-xs text-amber-800"><ImageOff className="h-6 w-6" />Arquivo indisponível: envie uma fotografia para substituir.<span className="text-[10px] text-muted-foreground">{photo.verify_note}</span></div>
                  ) : (
                    <button type="button" className="group block h-full w-full" onClick={() => setZoom(photo)} title="Ampliar">
                      <img src={photo.url} alt={photo.caption || photo.original_name || "Fotografia do produto"} className="h-full w-full object-cover" loading="lazy" onError={() => setBroken((current) => ({ ...current, [photo.id]: true }))} />
                      <span className="absolute right-1 top-1 rounded bg-black/50 p-1 text-white opacity-0 group-hover:opacity-100"><ZoomIn className="h-3 w-3" /></span>
                    </button>
                  )}
                  {photo.is_main ? <span className="absolute left-1 top-1 flex items-center gap-1 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-medium text-white"><Star className="h-3 w-3" />Principal</span> : null}
                  {photo.status === "Pendente de verificacao" ? <span className="absolute bottom-1 left-1 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-medium text-white">Antiga, a conferir</span> : null}
                </div>
                <div className="space-y-2 p-2 text-xs">
                  <p className="font-medium">{purposeLabel[photo.purpose] || photo.purpose}</p>
                  {photo.caption ? <p className="text-muted-foreground">{photo.caption}</p> : null}
                  <div className="flex flex-wrap gap-1">
                    {!photo.is_main && photo.status === "Disponivel" ? <Button type="button" size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void act(`main${photo.id}`, { action: "set_main", photoId: photo.id }, "Foto principal alterada.")}><Star className="h-3 w-3" />Principal</Button> : null}
                    <Button type="button" size="icon" variant="ghost" className="h-7 w-7" title="Mover para trás" disabled={Boolean(busy) || index === 0} onClick={() => move(index, -1)}><ArrowLeft className="h-3 w-3" /></Button>
                    <Button type="button" size="icon" variant="ghost" className="h-7 w-7" title="Mover para frente" disabled={Boolean(busy) || index === photos.length - 1} onClick={() => move(index, 1)}><ArrowRight className="h-3 w-3" /></Button>
                    {manager ? <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive" title="Remover" disabled={Boolean(busy)} onClick={() => { setRemoving(photo); setReason("") }}><Trash2 className="h-3 w-3" /></Button> : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Dialog open={Boolean(zoom)} onOpenChange={(open) => !open && setZoom(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>{zoom?.caption || zoom?.original_name || "Fotografia"}</DialogTitle></DialogHeader>
          {zoom ? <img src={zoom.url} alt={zoom.caption || "Fotografia ampliada"} className="max-h-[75vh] w-full rounded object-contain" /> : null}
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(removing)} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Remover fotografia</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">A fotografia deixa de aparecer, mas o registro e o arquivo continuam guardados (pedidos já emitidos não mudam). Informe o motivo.</p>
          <Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Motivo da remoção" />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRemoving(null)}>Cancelar</Button>
            <Button variant="destructive" disabled={reason.trim().length < 5 || Boolean(busy)} onClick={() => { const target = removing; setRemoving(null); if (target) void act("remove", { action: "remove", photoId: target.id, reason }, "Fotografia removida.") }}>Remover</Button>
          </div>
        </DialogContent>
      </Dialog>
    </SectionCard>
  )
}
