"use client"

import { useEffect, useState } from "react"
import { Loader2, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FormSheet, SaveButton } from "@/components/operations/shared"
import { api } from "@/components/catalog/catalog-fields"
import { RawMaterialFormFields } from "@/components/raw-materials/raw-material-form"
import { emptyRawMaterialForm, validateRawMaterial, type FieldErrors, type RawMaterialForm } from "@/lib/raw-materials"

export type RawMaterialSheetTarget = { id?: string; form?: RawMaterialForm; hasHistory?: boolean; originalSku?: string } | null

/** Popup de cadastro/edição de matéria-prima, usado pela lista e pela página de detalhes. */
export function RawMaterialSheet({ target, onClose, onSaved }: { target: RawMaterialSheetTarget; onClose: () => void; onSaved: (result: { id: string; sku: string }, created: boolean) => void }) {
  const [form, setForm] = useState<RawMaterialForm>(emptyRawMaterialForm())
  const [errors, setErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const open = target !== null
  const editing = Boolean(target?.id)

  useEffect(() => {
    if (target) { setForm(target.form || emptyRawMaterialForm()); setErrors({}); setMessage("") }
  }, [target])

  async function save() {
    const found = validateRawMaterial(form, { editing, hasHistory: target?.hasHistory, originalSku: target?.originalSku })
    setErrors(found)
    if (Object.keys(found).length) { setMessage("Corrija os campos destacados."); return }
    setSaving(true); setMessage("")
    try {
      const result = await api<{ id: string; sku: string }>(editing ? `/api/materias-primas/${target!.id}` : "/api/materias-primas", {
        method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ form }),
      })
      onSaved(result, !editing)
    } catch (reason) {
      const failure = reason as Error & { fields?: FieldErrors }
      if (failure.fields) setErrors(failure.fields)
      setMessage(failure.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormSheet open={open} onOpenChange={(next) => !next && !saving && onClose()} title={editing ? `Editar matéria-prima${target?.originalSku ? ` · ${target.originalSku}` : ""}` : "Nova matéria-prima"}
      description="Cadastro técnico de material de fabricação: especificações, fornecedores, estoque e classificação fiscal."
      footer={<div className="flex w-full items-center justify-between gap-3">
        <p className={`flex-1 text-sm ${message ? "text-destructive" : "text-muted-foreground"}`}>{message ? <span className="flex items-center gap-1"><TriangleAlert className="h-4 w-4 shrink-0" />{message}</span> : "Campos obrigatórios: nome e unidade."}</p>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
        <SaveButton onClick={() => void save()} disabled={saving}>{saving ? <><Loader2 className="h-4 w-4 animate-spin" />Salvando...</> : "Salvar"}</SaveButton>
      </div>}>
      <RawMaterialFormFields form={form} setForm={setForm} errors={errors} editing={editing} hasHistory={target?.hasHistory} originalSku={target?.originalSku} />
    </FormSheet>
  )
}
