"use client"

import { useEffect, useState } from "react"
import { Info, Loader2, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { FormSheet } from "@/components/operations/shared"
import { UploadField } from "@/components/catalog/upload-field"
import { api, Field, FormSection, SkuField } from "@/components/catalog/catalog-fields"
import { KitCompositionEditor } from "@/components/kits/kit-composition-editor"
import { emptyKitForm, kitCost, validateKit, type KitErrors, type KitForm } from "@/lib/kits"
import { brl } from "@/components/catalog/catalog-fields"

/** O que o popup vai fazer: kit novo, nova versão de um kit existente, editar um rascunho no lugar, ou só os dados do cadastro. */
export type KitSheetTarget =
  | { mode: "new" }
  | { mode: "version"; kitId: string; form: KitForm; baseVersion: number; hasActive: boolean }
  | { mode: "draft"; kitId: string; versionId: string; form: KitForm; version: number }
  | { mode: "header"; kitId: string; form: KitForm; originalSku: string }
  | null

export function KitSheet({ target, onClose, onSaved }: { target: KitSheetTarget; onClose: () => void; onSaved: (result: { kit_id: string; sku: string; version?: number; version_status?: string }, created: boolean) => void }) {
  const [form, setForm] = useState<KitForm>(emptyKitForm())
  const [errors, setErrors] = useState<KitErrors>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const open = target !== null

  useEffect(() => { if (target) { setForm(target.mode === "new" ? emptyKitForm() : target.form); setErrors({}); setMessage("") } }, [target])

  const headerOnly = target?.mode === "header"
  async function save(activate: boolean) {
    const found = validateKit(form, { requireComponents: !headerOnly })
    setErrors(found)
    if (Object.keys(found).length) { setMessage("Corrija os campos destacados."); return }
    setSaving(true); setMessage("")
    try {
      const body = { form, activate, withComponents: !headerOnly, versionId: target?.mode === "draft" ? target.versionId : undefined }
      const created = target?.mode === "new"
      const result = await api<{ kit_id: string; sku: string; version?: number; version_status?: string }>(created ? "/api/kits" : `/api/kits/${(target as { kitId: string }).kitId}`, {
        method: created ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      })
      onSaved(result, Boolean(created))
    } catch (reason) {
      const failure = reason as Error & { fields?: KitErrors }
      if (failure.fields) setErrors(failure.fields)
      setMessage(failure.message)
    } finally {
      setSaving(false)
    }
  }

  const title = !target ? "" : target.mode === "new" ? "Novo kit" : target.mode === "version" ? `Nova versão do kit (base: v${target.baseVersion})` : target.mode === "draft" ? `Editar rascunho v${target.version}` : "Editar dados do kit"
  const description = target?.mode === "version" && target.hasActive
    ? "A versão vigente continua valendo até você ativar a nova. Versões usadas em produção nunca são alteradas."
    : "O kit é uma estrutura lógica de matérias-primas e quantidades: cadastrar ou editar não movimenta estoque."

  return (
    <FormSheet open={open} onOpenChange={(next) => !next && !saving && onClose()} title={title} description={description}
      footer={<div className="flex w-full flex-wrap items-center justify-between gap-3">
        <p className={`min-w-[200px] flex-1 text-sm ${message ? "text-destructive" : "text-muted-foreground"}`}>{message ? <span className="flex items-center gap-1"><TriangleAlert className="h-4 w-4 shrink-0" />{message}</span> : headerOnly ? "Só os dados do cadastro serão alterados." : `Custo estimado: ${brl(kitCost(form.components))}`}</p>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
        {headerOnly ? <Button onClick={() => void save(false)} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Salvar</Button> : <>
          <Button variant="outline" onClick={() => void save(false)} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Salvar como rascunho</Button>
          <Button onClick={() => void save(true)} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Salvar e ativar</Button>
        </>}
      </div>}>
      <div className="space-y-4">
        <FormSection title="Identificação">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Nome do kit" error={errors.name} className="md:col-span-2"><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ex.: Kit Chassi FZ 1E" aria-invalid={Boolean(errors.name)} /></Field>
            {target?.mode === "new" ? (
              <SkuField form={form} set={(patch) => setForm({ ...form, ...patch })} error={errors.sku} prefix="KIT" />
            ) : <Field label="SKU" hint="O SKU não muda aqui."><Input value={form.sku} disabled className="font-mono" /></Field>}
            <Field label="Categoria"><Input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} placeholder="Ex.: Chassi, Elétrica, Rodagem" /></Field>
            <Field label="Status">
              <select value={form.status} className="h-9 w-full rounded-md border bg-background px-3 text-sm" onChange={(event) => setForm({ ...form, status: event.target.value as KitForm["status"] })}><option value="Ativo">Ativo</option><option value="Inativo">Inativo (não entra em produtos novos)</option></select>
            </Field>
            <UploadField label="Imagem (opcional)" value={form.photoUrl} onChange={(url) => setForm({ ...form, photoUrl: url })} accept="image/jpeg,image/png,image/webp" />
          </div>
          <Field label="Descrição"><Textarea rows={2} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Para que serve e em quais modelos é usado." /></Field>
        </FormSection>

        {headerOnly ? (
          <p className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm"><Info className="mt-0.5 h-4 w-4 shrink-0" />Para mudar quantidades ou materiais, use "Nova versão da composição" na página do kit: assim a versão vigente e o histórico ficam preservados.</p>
        ) : (
          <FormSection title="Composição" description="Matérias-primas já cadastradas, com a quantidade de cada uma por kit.">
            <KitCompositionEditor components={form.components} onChange={(components) => setForm({ ...form, components })} errors={errors} />
            <Field label="Observações da versão"><Input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Ex.: troca do perfil por modelo mais leve" /></Field>
          </FormSection>
        )}
      </div>
    </FormSheet>
  )
}
