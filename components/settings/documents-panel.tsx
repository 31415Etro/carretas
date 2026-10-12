"use client"

import { useCallback, useEffect, useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, SectionCard, TextAreaField, TextField, useCrudFeedback } from "@/components/operations/shared"
import { documentTypes, documentVisibilities } from "@/lib/config"
import { api, day, Opts, stamp, type Row } from "@/components/settings/common"

const emptyDoc = (): Row => ({ docType: "Outro", title: "", entityType: "", entityRef: "", visibility: "Todos", docDate: new Date().toISOString().slice(0, 10), notes: "" })

/** Documentos centrais: tipo, vínculo, versão, responsável, data e visibilidade. Cada envio vira uma nova versão. */
export function DocumentsPanel() {
  const { toast } = useCrudFeedback()
  const [docs, setDocs] = useState<Row[]>([])
  const [form, setForm] = useState<Row | null>(null)
  const [file, setFile] = useState<File | undefined>()
  const [query, setQuery] = useState("")
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => setDocs((await api<{ items: Row[] }>("/api/configuracoes/documentos")).items), [])
  useEffect(() => { void load().catch((reason) => toast({ title: "Erro ao carregar documentos", description: reason instanceof Error ? reason.message : "", variant: "destructive" })) }, [load, toast])

  async function save() {
    if (!form) return
    if (!file) return toast({ title: "Selecione o arquivo", variant: "destructive" })
    setSaving(true)
    try {
      const body = new FormData()
      body.set("kind", "documento")
      body.set("file", file)
      Object.entries(form).forEach(([key, value]) => body.set(key, String(value ?? "")))
      const result = await api<{ version: number }>("/api/configuracoes/upload", { method: "POST", body })
      toast({ title: "Documento guardado", description: `Versão ${result.version}.` })
      setForm(null)
      setFile(undefined)
      await load()
    } catch (reason) {
      toast({ title: "Não foi possível guardar", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const needle = query.trim().toLowerCase()
  const shown = docs.filter((doc) => !needle || [doc.title, doc.docType, doc.entityRef, doc.responsibleName].some((value) => String(value || "").toLowerCase().includes(needle)))

  return (
    <SectionCard title="Documentos" description="Contratos sociais, certidões, alvarás, políticas e outros documentos da empresa. Enviar o mesmo título e vínculo cria uma nova versão; as anteriores continuam acessíveis.">
      <div className="mb-3 grid gap-3 md:grid-cols-3"><TextField label="Buscar" value={query} onChange={setQuery} /></div>
      <Button className="mb-3" onClick={() => { setForm(emptyDoc()); setFile(undefined) }}><Plus className="h-4 w-4" />Novo documento</Button>
      <DataTable headers={["Título", "Tipo", "Vínculo", "Versão", "Data", "Responsável", "Visibilidade", "Enviado em", "Arquivo"]} empty={!shown.length}>
        {shown.map((doc) => (
          <TableRow key={doc.id}>
            <TableCell>{doc.title}</TableCell><TableCell>{doc.docType}</TableCell><TableCell>{[doc.entityType, doc.entityRef].filter(Boolean).join(" · ") || "-"}</TableCell><TableCell>v{doc.version}</TableCell><TableCell>{day(doc.docDate)}</TableCell>
            <TableCell>{doc.responsibleName || "-"}</TableCell><TableCell>{doc.visibility}</TableCell><TableCell>{stamp(doc.createdAt)}</TableCell>
            <TableCell><a className="text-primary underline" href={`/api/configuracoes/documento?id=${doc.id}`} target="_blank" rel="noreferrer">{doc.fileName}</a></TableCell>
          </TableRow>
        ))}
      </DataTable>
      <Sheet open={Boolean(form)} onOpenChange={(value) => !value && setForm(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader><SheetTitle>Novo documento</SheetTitle><SheetDescription>Título, tipo e arquivo são obrigatórios. O responsável é quem envia.</SheetDescription></SheetHeader>
          {form && (
            <div className="space-y-4 px-4 pb-6">
              <TextField label="Título *" value={form.title} onChange={(value) => setForm({ ...form, title: value })} />
              <div className="grid gap-3 md:grid-cols-2">
                <Opts label="Tipo *" value={form.docType} onChange={(value) => setForm({ ...form, docType: value || "Outro" })} items={documentTypes.map((value) => ({ value, label: value }))} />
                <TextField label="Data do documento" type="date" value={form.docDate} onChange={(value) => setForm({ ...form, docDate: value })} />
                <TextField label="Vincula a (tipo)" value={form.entityType} onChange={(value) => setForm({ ...form, entityType: value })} />
                <TextField label="Vincula a (identificação)" value={form.entityRef} onChange={(value) => setForm({ ...form, entityRef: value })} />
                <Opts label="Visibilidade" value={form.visibility} onChange={(value) => setForm({ ...form, visibility: value || "Todos" })} items={documentVisibilities.map((value) => ({ value, label: value }))} />
              </div>
              <TextAreaField label="Observações" rows={2} value={form.notes} onChange={(value) => setForm({ ...form, notes: value })} />
              <div className="space-y-1"><Label>Arquivo *</Label><input type="file" onChange={(event) => setFile(event.target.files?.[0])} /></div>
              <Button onClick={() => void save()} disabled={saving}>Guardar</Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </SectionCard>
  )
}
