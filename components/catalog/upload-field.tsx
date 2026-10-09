"use client"

import { useState } from "react"
import { FileText, Upload, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"

/** Envia foto ou PDF para o armazenamento do catálogo e devolve a URL. */
export function UploadField({ label, value, onChange, accept = "image/jpeg,image/png,image/webp,application/pdf" }: { label: string; value: string; onChange: (url: string) => void; accept?: string }) {
  const { toast } = useToast()
  const [uploading, setUploading] = useState(false)
  const isImage = /\.(jpe?g|png|webp)(\?|$)/i.test(value)

  async function upload(file?: File | null) {
    if (!file) return
    setUploading(true)
    try {
      const body = new FormData()
      body.append("file", file)
      const response = await fetch("/api/catalog/upload", { method: "POST", body })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
      onChange(payload.url)
    } catch (error) {
      toast({ title: "Arquivo não enviado", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" })
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {value ? (
        <div className="flex items-center gap-2 rounded-md border p-2">
          {isImage ? <img src={value} alt={label} className="h-12 w-12 rounded object-cover" /> : <FileText className="h-6 w-6 text-muted-foreground" />}
          <a href={value} target="_blank" rel="noreferrer" className="flex-1 truncate text-sm text-primary underline">Abrir arquivo</a>
          <Button type="button" size="icon" variant="ghost" title="Remover" onClick={() => onChange("")}><X className="h-4 w-4" /></Button>
        </div>
      ) : (
        <label className={`flex h-10 cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 text-sm text-muted-foreground ${uploading ? "pointer-events-none opacity-60" : ""}`}>
          <Upload className="h-4 w-4" />{uploading ? "Enviando..." : "Enviar arquivo"}
          <Input className="hidden" type="file" accept={accept} onChange={(event) => void upload(event.target.files?.[0])} />
        </label>
      )}
    </div>
  )
}
