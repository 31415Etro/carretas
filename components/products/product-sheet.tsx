"use client"

import { useEffect, useState } from "react"
import { Info, Loader2, Plus, Trash2, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { FormSheet } from "@/components/operations/shared"
import { UploadField } from "@/components/catalog/upload-field"
import { FiscalRulesEditor } from "@/components/catalog/fiscal-rules-editor"
import { api, brl, Field, FormSection, NcmField, Num, SkuField } from "@/components/catalog/catalog-fields"
import { KitLinkEditor } from "@/components/products/kit-link-editor"
import { emptyProductForm, margin, specProfileFor, structureCost, validateProduct, type ProductErrors, type ProductForm } from "@/lib/products"
import { parseNumber } from "@/lib/raw-materials"

/** O que o popup vai fazer: produto novo, só os dados do cadastro, ou uma nova versão da estrutura (a vigente nunca é alterada). */
export type ProductSheetTarget =
  | { mode: "new" }
  | { mode: "header"; productId: string; form: ProductForm; originalSku: string }
  | { mode: "structure"; productId: string; form: ProductForm; baseVersion: number; draftVersionId?: string; locked: boolean }
  | null

const documentKinds = ["Ficha técnica", "Desenho", "Manual", "Certificado", "Outro"]

export function ProductSheet({ target, onClose, onSaved }: { target: ProductSheetTarget; onClose: () => void; onSaved: (result: { product_id: string; sku: string; version?: number; version_status?: string }, created: boolean) => void }) {
  const [form, setForm] = useState<ProductForm>(emptyProductForm())
  const [errors, setErrors] = useState<ProductErrors>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const [withStructure, setWithStructure] = useState(false)
  const open = target !== null

  useEffect(() => {
    if (!target) return
    setForm(target.mode === "new" ? emptyProductForm() : target.form); setErrors({}); setMessage("")
    setWithStructure(target.mode === "structure")
  }, [target])

  const set = (patch: Partial<ProductForm>) => setForm((current) => ({ ...current, ...patch }))
  const profile = specProfileFor(form.category)
  const structureOnly = target?.mode === "structure"
  const cost = structureCost(form.structure)
  const gross = margin(parseNumber(form.salePrice) ?? 0, cost.total)

  async function save(activate: boolean) {
    const send = withStructure || structureOnly
    const next = { ...form, structure: { ...form.structure, activate: send && activate, versionId: target?.mode === "structure" ? target.draftVersionId || "" : "" } }
    const found = validateProduct(next, { requireStructure: send })
    setErrors(found)
    if (Object.keys(found).length) { setMessage("Corrija os campos destacados."); return }
    setSaving(true); setMessage("")
    try {
      const created = target?.mode === "new"
      const result = await api<{ product_id: string; sku: string; version?: number; version_status?: string }>(created ? "/api/produtos" : `/api/produtos/${(target as { productId: string }).productId}`, {
        method: created ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ form: next, withStructure: send }),
      })
      onSaved(result, Boolean(created))
    } catch (reason) {
      const failure = reason as Error & { fields?: ProductErrors }
      if (failure.fields) setErrors(failure.fields)
      setMessage(failure.message)
    } finally {
      setSaving(false)
    }
  }

  const title = !target ? "" : target.mode === "new" ? "Novo produto final" : target.mode === "structure" ? `Nova versão da estrutura (base: v${target.baseVersion})` : "Editar produto"
  const ncmContext = { name: form.name, description: form.description, kind: form.category }

  return (
    <FormSheet open={open} onOpenChange={(next) => !next && !saving && onClose()} title={title}
      description="Produto final vendido ao cliente. Cadastrar ou editar não movimenta estoque nem cria saldo: o estoque nasce da produção concluída."
      footer={<div className="flex w-full flex-wrap items-center justify-between gap-3">
        <p className={`min-w-[200px] flex-1 text-sm ${message ? "text-destructive" : "text-muted-foreground"}`}>{message ? <span className="flex items-center gap-1"><TriangleAlert className="h-4 w-4 shrink-0" />{message}</span> : `Custo estimado ${brl(cost.total)} · margem ${gross.percent === null ? "-" : `${gross.percent.toLocaleString("pt-BR")}%`}`}</p>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
        {structureOnly ? <>
          <Button variant="outline" onClick={() => void save(false)} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Salvar como rascunho</Button>
          <Button onClick={() => void save(true)} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Salvar e ativar</Button>
        </> : <Button onClick={() => void save(true)} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Salvar</Button>}
      </div>}>
      <div className="space-y-4">
        {structureOnly ? null : (
          <>
            <FormSection title="Identificação">
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Nome comercial" error={errors.name} className="md:col-span-2"><Input value={form.name} onChange={(event) => set({ name: event.target.value })} placeholder="Ex.: Carreta Náutica FZ 1E" aria-invalid={Boolean(errors.name)} /></Field>
                {target?.mode === "new"
                  ? <SkuField form={form} set={(patch) => set(patch)} error={errors.sku} prefix="PRD" />
                  : <Field label="SKU" hint="O SKU não muda aqui."><Input value={form.sku} disabled className="font-mono" /></Field>}
                <Field label="Código interno / referência"><Input value={form.internalRef} onChange={(event) => set({ internalRef: event.target.value })} placeholder="Opcional" /></Field>
                <Field label="Modelo"><Input value={form.model} onChange={(event) => set({ model: event.target.value })} placeholder="Ex.: FZ 1E" /></Field>
                <Field label="Categoria" hint="Define quais especificações técnicas aparecem."><Input value={form.category} onChange={(event) => set({ category: event.target.value })} placeholder="Ex.: Carreta, Acessório" /></Field>
                <Field label="Linha de produto"><Input value={form.productLine} onChange={(event) => set({ productLine: event.target.value })} placeholder="Ex.: Linha Náutica" /></Field>
                <Field label="Status"><select value={form.status} className="h-9 w-full rounded-md border bg-background px-3 text-sm" onChange={(event) => set({ status: event.target.value as ProductForm["status"] })}><option value="Ativo">Ativo</option><option value="Inativo">Inativo</option></select></Field>
              </div>
              <Field label="Descrição"><Textarea rows={2} value={form.description} onChange={(event) => set({ description: event.target.value })} /></Field>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2"><p className="text-sm font-medium">Fotografias</p><p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">As fotografias (principal e galeria) são gerenciadas na aba <strong>Fotografias</strong> do produto, depois de salvar o cadastro. {form.photoUrl ? "O produto já tem foto principal." : ""}</p></div>
                <UploadField label="Ficha técnica (PDF)" value={form.technicalSheetUrl} onChange={(url) => set({ technicalSheetUrl: url })} accept="application/pdf" />
              </div>
            </FormSection>

            <FormSection title={`Especificações técnicas — ${profile.label}`} description="Os campos mudam conforme a categoria: só aparece o que faz sentido para o produto.">
              <div className="grid gap-3 md:grid-cols-3">
                {profile.fields.map((specField) => specField.kind === "text"
                  ? <Field key={specField.key} label={specField.label}><Input value={form.specs[specField.key] ?? ""} onChange={(event) => set({ specs: { ...form.specs, [specField.key]: event.target.value } })} /></Field>
                  : <Num key={specField.key} label={specField.label} suffix={specField.unit} value={form.specs[specField.key] ?? ""} error={errors[`spec:${specField.key}`]} onChange={(value) => set({ specs: { ...form.specs, [specField.key]: value } })} />)}
              </div>
              <Field label="Observações de engenharia"><Textarea rows={2} value={form.engineeringNotes} onChange={(event) => set({ engineeringNotes: event.target.value })} /></Field>
            </FormSection>

            <FormSection title="Comercial" description="O preço de venda é definido por você: ele não é forçado pelo custo.">
              <div className="grid gap-3 md:grid-cols-3">
                <Num label="Preço de venda" suffix="R$" value={form.salePrice} error={errors.salePrice} onChange={(value) => set({ salePrice: value })} />
                <Field label="Unidade"><Input value={form.unit} onChange={(event) => set({ unit: event.target.value.toUpperCase() })} /></Field>
                <Num label="Prazo de entrega" suffix="dias" value={form.leadTimeDays} error={errors.leadTimeDays} onChange={(value) => set({ leadTimeDays: value })} />
                <Num label="Garantia" suffix="meses" value={form.warrantyMonths} error={errors.warrantyMonths} onChange={(value) => set({ warrantyMonths: value })} />
                <div className="md:col-span-2 rounded-md bg-muted/40 p-3 text-sm">Custo estimado {brl(cost.total)} · margem bruta {brl(gross.value)}{gross.percent === null ? "" : ` (${gross.percent.toLocaleString("pt-BR")}%)`}{form.structure.kits.length === 0 && target?.mode !== "new" ? " (custo da estrutura vigente aparece na página do produto)" : ""}</div>
              </div>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" checked={form.availableForQuote} onChange={(event) => set({ availableForQuote: event.target.checked })} />Disponível para orçamento</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={form.allowsSale} onChange={(event) => set({ allowsSale: event.target.checked })} />Disponível para venda</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={form.makeToOrder} onChange={(event) => set({ makeToOrder: event.target.checked })} />Fabricado sob encomenda</label>
              </div>
            </FormSection>

            <FormSection title="Fiscal" description="O NCM do produto é próprio (não vem das matérias-primas) e precisa da sua confirmação.">
              <NcmField form={{ ...form, ncmValidFrom: "" }} set={(patch) => set(patch as Partial<ProductForm>)} error={errors.ncm} context={ncmContext} />
              {target?.mode === "header" ? <FiscalRulesEditor materialId={target.productId} /> : <p className="flex items-start gap-2 text-xs text-muted-foreground"><Info className="mt-0.5 h-4 w-4 shrink-0" />As regras fiscais por operação ficam disponíveis depois do primeiro salvamento.</p>}
            </FormSection>

            <FormSection title="Documentos anexos">
              {form.documents.map((document, index) => (
                <div key={index} className="grid items-end gap-2 md:grid-cols-[1fr_160px_auto]">
                  <UploadField label={`Arquivo ${index + 1}`} value={document.url} onChange={(url) => set({ documents: form.documents.map((item, at) => (at === index ? { ...item, url, name: item.name || url.split("/").pop() || "Documento" } : item)) })} accept="application/pdf,image/jpeg,image/png" />
                  <select aria-label="Tipo do documento" value={document.kind} className="h-9 rounded-md border bg-background px-2 text-sm" onChange={(event) => set({ documents: form.documents.map((item, at) => (at === index ? { ...item, kind: event.target.value } : item)) })}>{documentKinds.map((kind) => <option key={kind}>{kind}</option>)}</select>
                  <Button type="button" variant="ghost" size="icon" aria-label="Remover documento" onClick={() => set({ documents: form.documents.filter((_, at) => at !== index) })}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => set({ documents: [...form.documents, { name: "", url: "", kind: "Ficha técnica" }] })}><Plus className="h-4 w-4" />Adicionar documento</Button>
            </FormSection>
          </>
        )}

        {target?.mode === "header" && !withStructure ? (
          <p className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm"><Info className="mt-0.5 h-4 w-4 shrink-0" />Para mudar kits ou quantidades, use "Nova versão da estrutura" na página do produto: a versão vigente e o histórico ficam preservados.</p>
        ) : (
          <FormSection title="Estrutura de fabricação — kits do produto" description="Kits (com a versão ativa) e a quantidade de cada um por unidade do produto. As matérias-primas vêm dos kits.">
            {target?.mode === "new" && !withStructure ? (
              <Button type="button" variant="outline" onClick={() => setWithStructure(true)}><Plus className="h-4 w-4" />Vincular kits agora</Button>
            ) : <KitLinkEditor structure={form.structure} onChange={(structure) => set({ structure })} errors={errors} readOnlyReason={target?.mode === "structure" && target.locked ? "A versão vigente está protegida: ao salvar, será criada uma nova versão em rascunho." : undefined} />}
          </FormSection>
        )}
      </div>
    </FormSheet>
  )
}
