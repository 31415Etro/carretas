"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Loader2, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { FormSheet } from "@/components/operations/shared"
import { api, brl, Field, qty } from "@/components/catalog/catalog-fields"
import { TrailerDrawingView } from "@/components/configurator/trailer-drawing-view"
import { canRequestReview, canSaveConfiguration, configStatusLabel, configStatusTone, optionGroupLabels, paramsFromInputs } from "@/lib/configurator"

type Spec = {
  has_engineering: boolean; homologated: boolean; revision?: string; revision_status?: string; base_price?: number; open_issues?: number
  params: Array<{ key: string; label: string; unit: string; min: number | null; max: number | null; step: number | null; default: number | null; in_conflict: boolean }>
  reference: Array<{ key: string; label: string; unit: string; value: number | null }>
  options: Array<{ group: string; code: string; label: string; price_delta: number; is_default: boolean }>
  drawing: { template_key: string; grade: "ilustrativo" | "validado"; geometry: Record<string, number> } | null
}
export type ConfiguratorResult = {
  configuration_id?: string; status: string; homologated: boolean; errors: Array<{ message: string }>; warnings: Array<{ message: string }>; review_reasons: string[]; params: Record<string, number>; summary: string
  options: { acabamento: string | null; acessorios: string[]; selected: Array<{ code: string; label: string; group: string }> }
  materials: Array<Record<string, any>>; cut_list: Array<Record<string, any>>; kits: Array<Record<string, any>>
  costs: { materials: number; labor: number; overhead: number; other: number; finishing: number; total: number }
  price: number; margin: number; margin_percent: number | null; margin_alert: boolean; revision: string | null; bom_version: number
  drawing: { grade: "ilustrativo" | "validado"; geometry: Record<string, number> } | null
}

/** Personalizar produto: o vendedor escolhe medidas e opções DENTRO dos limites da engenharia; o sistema valida, recalcula kits, materiais, custo e margem e desenha as três vistas. */
export function ConfiguratorDialog({ productId, productName, initial, quoteItemId, open, onClose, onApply }: {
  productId: string; productName: string; initial?: { configurationId?: string; params?: Record<string, number>; options?: { acabamento?: string | null; acessorios?: string[] } }
  quoteItemId?: string; open: boolean; onClose: () => void; onApply: (result: ConfiguratorResult & { configuration_id: string }) => void
}) {
  const [spec, setSpec] = useState<Spec | null>(null)
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [finish, setFinish] = useState("")
  const [accessories, setAccessories] = useState<string[]>([])
  const [load, setLoad] = useState("")
  const [result, setResult] = useState<ConfiguratorResult | null>(null)
  const [error, setError] = useState("")
  const [calculating, setCalculating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [reason, setReason] = useState("")
  const [reviewOpen, setReviewOpen] = useState(false)
  const [notice, setNotice] = useState("")
  const seq = useRef(0)

  useEffect(() => {
    if (!open) return
    setSpec(null); setResult(null); setError(""); setNotice(""); setReviewOpen(false)
    api<{ spec: Spec }>(`/api/configurador?produto=${productId}`).then((data) => {
      setSpec(data.spec)
      const start: Record<string, string> = {}
      for (const param of data.spec.params) start[param.key] = String(initial?.params?.[param.key] ?? param.default ?? "")
      setInputs(start)
      setFinish(initial?.options?.acabamento || data.spec.options.find((option) => option.group === "acabamento" && option.is_default)?.code || "")
      setAccessories(initial?.options?.acessorios || [])
      if (initial?.configurationId) {
        api<{ configuration: { params: Record<string, number>; options: { acabamento?: string | null; acessorios?: string[] } } | null }>(`/api/configurador?configuracao=${initial.configurationId}`).then((saved) => {
          if (!saved.configuration) return
          setInputs((current) => { const next = { ...current }; for (const param of data.spec.params) if (saved.configuration!.params?.[param.key] !== undefined) next[param.key] = String(saved.configuration!.params[param.key]); return next })
          setFinish(saved.configuration.options?.acabamento || "")
          setAccessories(saved.configuration.options?.acessorios || [])
        }).catch(() => undefined)
      }
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Erro ao carregar o configurador."))
  }, [open, productId]) // eslint-disable-line react-hooks/exhaustive-deps

  const body = useMemo(() => ({ productId, params: paramsFromInputs(inputs), options: { acabamento: finish || null, acessorios: accessories }, plannedLoad: load.trim() ? Number(load.replace(",", ".")) : null, configurationId: initial?.configurationId, quoteItemId }), [productId, inputs, finish, accessories, load, initial?.configurationId, quoteItemId])
  useEffect(() => {
    if (!open || !spec?.has_engineering) return
    const mine = ++seq.current
    setCalculating(true)
    const timer = setTimeout(async () => {
      try {
        const data = await api<{ result: ConfiguratorResult }>("/api/configurador", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "calculate", ...body }) })
        if (mine === seq.current) { setResult(data.result); setError("") }
      } catch (reason) {
        if (mine === seq.current) { setResult(null); setError(reason instanceof Error ? reason.message : "Erro ao calcular.") }
      } finally {
        if (mine === seq.current) setCalculating(false)
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [body, open, spec])

  async function apply(withReview: boolean) {
    setSaving(true); setNotice("")
    try {
      const saved = await api<{ result: ConfiguratorResult & { configuration_id: string } }>("/api/configurador", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save", ...body }) })
      if (withReview) {
        await api("/api/configurador", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "request_review", configurationId: saved.result.configuration_id, reason }) })
        setNotice("Análise técnica solicitada. A configuração fica no orçamento, mas só pode virar pedido depois da aprovação da engenharia.")
      }
      onApply(saved.result)
      if (!withReview) onClose()
    } catch (failure) { setNotice(failure instanceof Error ? failure.message : "Não foi possível gravar.") } finally { setSaving(false) }
  }

  const status = result?.status || ""
  const grade = result?.drawing?.grade || spec?.drawing?.grade || "ilustrativo"
  return (
    <FormSheet open={open} onOpenChange={(next) => !next && !saving && onClose()} title={`Personalizar: ${productName}`}
      description="Escolha as medidas e opções permitidas. O sistema valida com os limites da engenharia e recalcula materiais, custo e margem. Não altera o cadastro do produto."
      footer={<div className="flex w-full flex-wrap items-center justify-between gap-3">
        <p className="min-w-[200px] flex-1 text-sm text-muted-foreground">{result ? `${configStatusLabel(status)} · preço ${brl(result.price)} · custo ${brl(result.costs.total)}` : "Preencha as medidas."}</p>
        <Button variant="outline" onClick={onClose} disabled={saving}>Fechar</Button>
        {result && canRequestReview(status) ? <Button variant="outline" disabled={saving} onClick={() => setReviewOpen(true)}>Pedir análise técnica</Button> : null}
        <Button disabled={saving || !result || !canSaveConfiguration(status)} onClick={() => void apply(false)}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Aplicar ao orçamento</Button>
      </div>}>
      {error ? <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
      {notice ? <p className="mb-3 rounded-md border bg-muted/40 p-3 text-sm">{notice}</p> : null}
      {!spec ? <p className="text-sm text-muted-foreground">Carregando...</p> : !spec.has_engineering ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">Este produto ainda não tem engenharia cadastrada (limites e documentos). Cadastre em Produtos finais → Engenharia e Homologação. Sem isso não há como validar medidas.</p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {result ? <span className={`rounded px-2 py-0.5 text-xs font-medium ${configStatusTone(status)}`}>{configStatusLabel(status)}</span> : null}
            <span className={`rounded px-2 py-0.5 text-xs ${spec.homologated ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{spec.homologated ? `Engenharia ${spec.revision} validada` : `Engenharia ${spec.revision} NÃO validada${spec.open_issues ? ` · ${spec.open_issues} pendência(s)` : ""}`}</span>
            {calculating ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {spec.params.map((param) => (
              <Field key={param.key} label={`${param.label} (${param.unit})`} hint={param.min !== null || param.max !== null ? `de ${param.min ?? "?"} a ${param.max ?? "?"}${param.step ? `, de ${param.step} em ${param.step}` : ""}${param.in_conflict ? " · documentos divergem: usado o limite mais restritivo" : ""}` : "sem limites documentados"}
                error={result?.errors.find((item) => (item as { param?: string }).param === param.key)?.message}>
                <Input inputMode="decimal" value={inputs[param.key] ?? ""} onChange={(event) => setInputs({ ...inputs, [param.key]: event.target.value })} />
              </Field>
            ))}
          </div>
          {spec.reference.length ? <p className="text-xs text-muted-foreground">Referências do projeto: {spec.reference.map((item) => `${item.label} ${item.value ?? "-"} ${item.unit}`).join(" · ")}</p> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            {spec.options.some((option) => option.group === "acabamento") ? (
              <Field label="Acabamento"><select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={finish} onChange={(event) => setFinish(event.target.value)}>
                <option value="">Escolha...</option>{spec.options.filter((option) => option.group === "acabamento").map((option) => <option key={option.code} value={option.code}>{option.label}{option.price_delta ? ` (+ ${brl(option.price_delta)})` : ""}</option>)}
              </select></Field>
            ) : null}
            <Field label="Carga prevista (kg, opcional)" hint="Conferida com a lotação do projeto."><Input inputMode="decimal" value={load} onChange={(event) => setLoad(event.target.value)} /></Field>
          </div>
          {spec.options.some((option) => option.group === "acessorio") ? (
            <div className="space-y-1 text-sm"><span className="text-xs font-medium text-muted-foreground">{optionGroupLabels.acessorio}s</span>
              {spec.options.filter((option) => option.group === "acessorio").map((option) => (
                <label key={option.code} className="flex items-center gap-2"><input type="checkbox" checked={accessories.includes(option.code)} onChange={(event) => setAccessories(event.target.checked ? [...accessories, option.code] : accessories.filter((code) => code !== option.code))} />{option.label}{option.price_delta ? ` (+ ${brl(option.price_delta)})` : ""}</label>
              ))}
            </div>
          ) : null}

          {result ? (
            <>
              {result.errors.length ? <ul className="list-disc space-y-1 rounded-md border border-red-200 bg-red-50 p-3 pl-7 text-sm text-red-900">{result.errors.map((item, index) => <li key={index}>{item.message}</li>)}</ul> : null}
              {result.warnings.length || result.review_reasons.length ? (
                <ul className="list-disc space-y-1 rounded-md border border-amber-200 bg-amber-50 p-3 pl-7 text-sm text-amber-900">
                  {result.warnings.map((item, index) => <li key={`w${index}`}>{item.message}</li>)}
                  {result.review_reasons.map((item, index) => <li key={`r${index}`}>{item}</li>)}
                </ul>
              ) : null}
              <dl className="grid gap-3 rounded-md bg-muted/40 p-3 text-sm sm:grid-cols-4">
                <div><dt className="text-xs text-muted-foreground">Preço</dt><dd className="font-semibold">{brl(result.price)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Custo estimado</dt><dd className="font-semibold">{brl(result.costs.total)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Margem</dt><dd className={`font-semibold ${result.margin_alert ? "text-destructive" : ""}`}>{brl(result.margin)}{result.margin_percent !== null ? ` (${Number(result.margin_percent).toLocaleString("pt-BR")}%)` : ""}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Estrutura</dt><dd>v{result.bom_version}{result.revision ? ` · eng. ${result.revision}` : ""}</dd></div>
                <div className="sm:col-span-4 text-xs text-muted-foreground">Materiais {brl(result.costs.materials)} · mão de obra {brl(result.costs.labor)} (valor fixo da estrutura) · indiretos {brl(result.costs.overhead + result.costs.other)} · acabamento/serviços {brl(result.costs.finishing)}. O preço não muda sozinho com a medida.</div>
              </dl>
              <TrailerDrawingView product={productName} params={result.params} grade={grade} revision={result.revision} geometry={spec.drawing?.geometry} finish={result.options.selected.find((item) => item.group === "acabamento")?.label} accessories={result.options.selected.filter((item) => item.group === "acessorio").map((item) => item.label)} />
              <details className="rounded-md border"><summary className="cursor-pointer px-3 py-2 text-sm font-medium">Kits e matérias-primas calculados ({result.materials.length})</summary>
                <table className="w-full text-sm"><thead className="bg-muted/50 text-left text-[11px] uppercase text-muted-foreground"><tr><th className="px-3 py-1.5">Material</th><th>Kit</th><th className="text-right">Qtd.</th><th>Origem</th><th className="px-3 text-right">Custo</th></tr></thead>
                  <tbody>{result.materials.map((line, index) => <tr key={index} className="border-t"><td className="px-3 py-1.5">{line.name}</td><td className="text-xs">{line.kit_name}</td><td className="text-right">{qty(line.quantity, 4)} {line.unit}</td><td className="text-xs">{line.source === "formula" ? `fórmula: ${line.formula_text || ""}` : "quantidade fixa do kit"}</td><td className="px-3 text-right">{brl(line.cost)}</td></tr>)}</tbody></table>
                {result.cut_list.length ? <div className="border-t p-3 text-xs">{result.cut_list.map((cut, index) => <p key={index}>Corte de {cut.name}: {cut.plan.bars} barra(s) de {cut.plan.bar_length_mm} mm, sobra {qty(cut.plan.waste_mm)} mm ({cut.plan.pieces.map((piece: Record<string, any>) => `${piece.count}× ${piece.label} ${piece.length_mm} mm`).join(", ")}).</p>)}</div> : null}
              </details>
            </>
          ) : null}
          {reviewOpen ? (
            <div className="space-y-2 rounded-md border p-3">
              <Field label="Por que esta configuração precisa de análise técnica? (mínimo 10 caracteres)"><Textarea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
              <div className="flex gap-2"><Button disabled={saving || reason.trim().length < 10} onClick={() => void apply(true)}>Gravar e pedir análise</Button><Button variant="outline" onClick={() => setReviewOpen(false)}>Voltar</Button></div>
              <p className="flex items-center gap-1 text-xs text-muted-foreground"><TriangleAlert className="h-3 w-3" />Enquanto a engenharia não aprovar, esta configuração não vira pedido de venda.</p>
            </div>
          ) : null}
        </div>
      )}
    </FormSheet>
  )
}
