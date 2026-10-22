"use client"

// Peças compartilhadas pelos cadastros do catálogo (matéria-prima agora; kit, produto e serviço nas próximas etapas).
import { useCallback, useEffect, useState } from "react"
import { CheckCircle2, Loader2, Lock, Plus, Search, Sparkles, Trash2, TriangleAlert, Wand2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SearchableSelectField } from "@/components/operations/shared"
import { formatNcm, type RawMaterialForm, type SupplierLinkForm } from "@/lib/raw-materials"

export const brl = (value: unknown) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
export const qty = (value: unknown, maximumFractionDigits = 3) => Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits })
// data sem hora ("2022-04-01") não passa por new Date(): vira meia-noite UTC e mostraria o dia anterior no Brasil
export const dateBr = (value?: string | null) => {
  if (!value) return "-"
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.split("-").reverse().join("/")
  return new Date(value).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw Object.assign(new Error(payload?.error || `Erro ${response.status}`), { fields: payload?.fields as Record<string, string> | undefined, status: response.status })
  return payload as T
}

/** Campo de formulário com rótulo, dica e mensagem de erro (a mesma mensagem que a API devolve). */
export function Field({ label, hint, error, children, className = "" }: { label: string; hint?: string; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label className="text-sm">{label}</Label>
      {children}
      {error ? <p className="flex items-start gap-1 text-xs text-destructive"><TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function FormSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div><h3 className="text-sm font-semibold">{title}</h3>{description ? <p className="text-xs text-muted-foreground">{description}</p> : null}</div>
      {children}
    </section>
  )
}

export function Num({ label, value, onChange, error, hint, suffix, placeholder }: { label: string; value: string; onChange: (value: string) => void; error?: string; hint?: string; suffix?: string; placeholder?: string }) {
  return (
    <Field label={label} error={error} hint={hint}>
      <div className="relative">
        <Input inputMode="decimal" value={value} placeholder={placeholder || "0"} onChange={(event) => onChange(event.target.value)} className={suffix ? "pr-12" : ""} aria-invalid={Boolean(error)} />
        {suffix ? <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span> : null}
      </div>
    </Field>
  )
}

/** SKU: automático (MP-000001) ou manual. Em edição fica travado; item com histórico só troca informando o motivo. */
export function SkuField({ form, set, error, reasonError, editing, hasHistory, originalSku, prefix = "MP" }: {
  form: { sku: string; autoSku: boolean; skuChangeReason?: string }; set: (patch: { sku?: string; autoSku?: boolean; skuChangeReason?: string }) => void; error?: string; reasonError?: string
  editing?: boolean; hasHistory?: boolean; originalSku?: string; prefix?: string
}) {
  const [unlocked, setUnlocked] = useState(false)
  if (editing) {
    const changed = form.sku.trim() !== (originalSku || "")
    return (
      <Field label="SKU" error={error} hint={unlocked ? undefined : hasHistory ? "Este item já tem movimentações ou vínculos: a troca exige um motivo." : "O SKU pode ser editado enquanto o item não tem movimentações."}>
        <div className="flex gap-2">
          <Input value={form.sku} disabled={!unlocked} onChange={(event) => set({ sku: event.target.value.toUpperCase() })} className="font-mono" aria-invalid={Boolean(error)} />
          <Button type="button" variant="outline" onClick={() => { setUnlocked(!unlocked); if (unlocked) set({ sku: originalSku || form.sku, skuChangeReason: "" }) }}>
            <Lock className="h-4 w-4" />{unlocked ? "Cancelar" : "Trocar SKU"}
          </Button>
        </div>
        {unlocked && changed && hasHistory ? (
          <div className="mt-2"><Field label="Motivo da troca de SKU" error={reasonError}><Input value={form.skuChangeReason} onChange={(event) => set({ skuChangeReason: event.target.value })} placeholder="Ex.: padronização do código com o fornecedor" /></Field></div>
        ) : null}
      </Field>
    )
  }
  return (
    <Field label="SKU" error={error} hint={form.autoSku ? `Será gerado automaticamente (${prefix}-000001, ${prefix}-000002...).` : "Use letras, números, ponto, hífen ou barra. Deve ser único no catálogo."}>
      <div className="flex gap-2">
        <Input value={form.autoSku ? "" : form.sku} disabled={form.autoSku} placeholder={form.autoSku ? `${prefix}-automático` : `${prefix}-000123`} onChange={(event) => set({ sku: event.target.value.toUpperCase() })} className="font-mono" aria-invalid={Boolean(error)} />
        <Button type="button" variant="outline" onClick={() => set({ autoSku: !form.autoSku, sku: form.autoSku ? form.sku : "" })}>
          <Wand2 className="h-4 w-4" />{form.autoSku ? "Informar manualmente" : "Gerar automático"}
        </Button>
      </div>
    </Field>
  )
}

type Candidate = { code: string; codeFormatted: string; description: string; validFrom: string; source: string; confidence: "alta" | "media" | "baixa"; justification: string; matchedWords: string[] }
type NcmResponse = { candidates: Candidate[]; needsManualReview: boolean; message: string; source?: string; error?: string }
const confidenceTone = { alta: "bg-emerald-100 text-emerald-800", media: "bg-amber-100 text-amber-800", baixa: "bg-slate-100 text-slate-700" }

/** NCM: sugere até 3 candidatos da tabela oficial; só vale depois que uma pessoa confirma. Reutilizável em produtos e outros itens fiscais. */
export function NcmField({ form, set, error, context }: { form: Pick<RawMaterialForm, "ncm" | "ncmDescription" | "ncmSource" | "ncmValidFrom" | "ncmConfirmed">; set: (patch: Partial<RawMaterialForm>) => void; error?: string; context: { name: string; description: string; kind?: string } }) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<NcmResponse | null>(null)
  const [failure, setFailure] = useState("")

  const suggest = useCallback(async () => {
    setLoading(true); setFailure(""); setResult(null)
    try {
      const params = new URLSearchParams({ q: context.name, description: context.description, material: context.kind || "" })
      setResult(await api<NcmResponse>(`/api/catalog/ncm?${params}`))
    } catch (reason) {
      setFailure(reason instanceof Error ? reason.message : "Não foi possível consultar a tabela oficial.")
    } finally {
      setLoading(false)
    }
  }, [context.name, context.description, context.kind])

  const pick = (candidate: Candidate) => { set({ ncm: candidate.codeFormatted, ncmDescription: candidate.description, ncmSource: candidate.source, ncmValidFrom: candidate.validFrom, ncmConfirmed: true }); setResult(null) }
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-[minmax(0,220px)_1fr]">
        <Field label="NCM" error={error} hint="8 dígitos. Sempre confirmado por uma pessoa.">
          <Input value={form.ncm} inputMode="numeric" placeholder="0000.00.00" aria-invalid={Boolean(error)}
            onChange={(event) => set({ ncm: event.target.value, ncmConfirmed: false, ncmDescription: "", ncmSource: "", ncmValidFrom: "" })} className="font-mono" />
        </Field>
        <div className="flex items-end gap-2">
          <Button type="button" variant="outline" onClick={() => void suggest()} disabled={loading || context.name.trim().length < 3}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}Sugerir NCM pelo nome e características
          </Button>
          {context.name.trim().length < 3 ? <span className="pb-2 text-xs text-muted-foreground">Preencha o nome primeiro.</span> : null}
        </div>
      </div>
      {form.ncm && !form.ncmConfirmed ? (
        <label className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm">
          <input type="checkbox" className="mt-1" checked={form.ncmConfirmed} onChange={(event) => set({ ncmConfirmed: event.target.checked, ncmSource: event.target.checked ? "Informado manualmente" : "" })} />
          <span>Conferi este NCM na tabela oficial e confirmo a classificação.</span>
        </label>
      ) : null}
      {form.ncm && form.ncmConfirmed ? (
        <p className="flex items-start gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-2 text-sm text-emerald-900"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span><strong>{formatNcm(form.ncm)}</strong> confirmado{form.ncmDescription ? ` · ${form.ncmDescription}` : ""}{form.ncmSource ? <span className="block text-xs text-emerald-800">Fonte: {form.ncmSource}</span> : null}</span></p>
      ) : null}
      {failure ? <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">{failure} Informe o NCM manualmente.</p> : null}
      {result ? (
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm text-muted-foreground">{result.message}</p>
          {result.candidates.length === 0 ? <p className="text-sm">Nenhum NCM vigente encontrado para esse texto. Tente descrever melhor o material ou informe manualmente.</p> : null}
          {result.candidates.map((candidate) => (
            <div key={candidate.code} className="flex flex-col gap-2 rounded-md border p-3 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0 space-y-1">
                <p className="text-sm"><strong className="font-mono">{candidate.codeFormatted}</strong> <span className={`ml-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${confidenceTone[candidate.confidence]}`}>confiança {candidate.confidence}</span></p>
                <p className="text-sm">{candidate.description}</p>
                <p className="text-xs text-muted-foreground">{candidate.justification}</p>
                <p className="text-xs text-muted-foreground">Fonte: {candidate.source} · vigente desde {dateBr(candidate.validFrom)}</p>
              </div>
              <Button type="button" size="sm" variant={candidate.confidence === "baixa" ? "outline" : "default"} onClick={() => pick(candidate)}>Usar este NCM</Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export type SupplierOption = { id: string; name: string; document: string; status: string }
export function useSuppliers() {
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([])
  useEffect(() => { void api<{ suppliers: SupplierOption[] }>("/api/suppliers").then((payload) => setSuppliers(payload.suppliers)).catch(() => setSuppliers([])) }, [])
  return suppliers
}

const emptyLink = (): SupplierLinkForm => ({ supplierId: "", supplierName: "", supplierCode: "", isPrimary: false, lastCost: "", leadTimeDays: "", minPurchaseQty: "", notes: "" })

/** Fornecedor principal e alternativos, com código do fornecedor, último custo, prazo e compra mínima. */
export function SupplierLinksEditor({ links, onChange, error }: { links: SupplierLinkForm[]; onChange: (links: SupplierLinkForm[]) => void; error?: string }) {
  const suppliers = useSuppliers()
  const options = suppliers.filter((supplier) => supplier.status !== "Inativo").map((supplier) => ({ value: supplier.id, label: `${supplier.name}${supplier.document ? ` · ${supplier.document}` : ""}` }))
  const update = (index: number, patch: Partial<SupplierLinkForm>) => onChange(links.map((link, position) => (position === index ? { ...link, ...patch } : patch.isPrimary ? { ...link, isPrimary: false } : link)))
  return (
    <div className="space-y-3">
      {links.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum fornecedor vinculado. Adicione o fornecedor principal e, se houver, os alternativos.</p> : null}
      {links.map((link, index) => (
        <div key={index} className="space-y-3 rounded-md border p-3">
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm"><input type="radio" name="primary-supplier" checked={link.isPrimary} onChange={() => update(index, { isPrimary: true })} />Fornecedor principal</label>
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(links.filter((_, position) => position !== index))}><Trash2 className="h-4 w-4" />Remover</Button>
          </div>
          <SearchableSelectField label="Fornecedor" value={link.supplierId} onChange={(value) => update(index, { supplierId: value, supplierName: options.find((option) => option.value === value)?.label || "" })} options={options} placeholder={link.supplierName || "Pesquisar fornecedor..."} searchPlaceholder="Nome ou CNPJ" emptyLabel="Nenhum fornecedor encontrado" />
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Código no fornecedor"><Input value={link.supplierCode} onChange={(event) => update(index, { supplierCode: event.target.value })} /></Field>
            <Num label="Último custo" value={link.lastCost} onChange={(value) => update(index, { lastCost: value })} suffix="R$" />
            <Num label="Prazo de entrega" value={link.leadTimeDays} onChange={(value) => update(index, { leadTimeDays: value })} suffix="dias" />
            <Num label="Compra mínima" value={link.minPurchaseQty} onChange={(value) => update(index, { minPurchaseQty: value })} />
          </div>
        </div>
      ))}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...links, { ...emptyLink(), isPrimary: links.length === 0 }])}><Plus className="h-4 w-4" />Adicionar fornecedor</Button>
    </div>
  )
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <div className="relative min-w-[240px] max-w-md flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="pl-9" />
    </div>
  )
}
