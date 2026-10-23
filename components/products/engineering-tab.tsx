"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Check, FileUp, Loader2, Plus, ShieldCheck, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, SectionCard } from "@/components/operations/shared"
import { api, brl, dateBr, Field } from "@/components/catalog/catalog-fields"
import { TrailerDrawingView } from "@/components/configurator/trailer-drawing-view"
import { documentKindLabels, documentKinds, optionGroupLabels, revisionStatusLabels, scopeLabels } from "@/lib/configurator"
import { parseExpression } from "@/lib/expression"
import { useAuth } from "@/lib/auth-context"

type Overview = {
  current_revision_id: string | null
  revisions: Array<Record<string, any>>; documents: Array<Record<string, any>>; parameters: Array<Record<string, any>>; issues: Array<Record<string, any>>
  options: Array<Record<string, any>>; rules: Array<Record<string, any>>; formulas: Array<Record<string, any>>; templates: Array<Record<string, any>>
  bom_kits: Array<{ kit_id: string; name: string; components: Array<{ material_id: string; name: string; unit: string; quantity: number; comp_unit: string }> }>
}
const num = (value: string) => { const parsed = Number(String(value).trim().replace(",", ".")); return String(value).trim() === "" || !Number.isFinite(parsed) ? null : parsed }
const open = (path: string) => `/api/engenharia/arquivo?path=${encodeURIComponent(path)}`

/** Aba "Engenharia e Homologação": documentos, limites com fonte, pendências, opções, regras, fórmulas aprovadas e desenho, por revisão. */
export function EngineeringTab({ productId, productName }: { productId: string; productName: string }) {
  const { user } = useAuth()
  const manager = user?.role === "admin" || user?.role === "manager"
  const [data, setData] = useState<Overview | null>(null)
  const [selected, setSelected] = useState("")
  const [busy, setBusy] = useState("")
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    try {
      const response = await api<{ overview: Overview }>(`/api/engenharia/${productId}`)
      setData(response.overview); setError("")
      setSelected((current) => (current && response.overview.revisions.some((revision) => revision.id === current) ? current : response.overview.current_revision_id || response.overview.revisions[0]?.id || ""))
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Erro ao carregar a engenharia.") }
  }, [productId])
  useEffect(() => { void load() }, [load])

  async function act(action: string, payload: Record<string, unknown> = {}, success = "Salvo.") {
    setBusy(action); setNotice("")
    try {
      const response = await api<{ result: Record<string, any>; overview: Overview }>(`/api/engenharia/${productId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...payload }) })
      setData(response.overview)
      if (response.result?.revision_id && action !== "revision_copy") setSelected(response.result.revision_id)
      if (action === "revision_copy") setSelected(response.result.revision_id)
      if (action === "revision_save" && response.result?.id) setSelected(response.result.id)
      setNotice(success + (response.result?.issues_opened !== undefined ? ` ${response.result.issues_opened} pendência(s) de engenharia aberta(s) por divergência entre documentos.` : ""))
      return true
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Ação não concluída."); return false } finally { setBusy("") }
  }

  const revision = data?.revisions.find((item) => item.id === selected)
  const editable = revision && ["Rascunho", "Em validacao"].includes(revision.status)
  const docs = useMemo(() => (data?.documents || []).filter((item) => item.revision_id === selected), [data, selected])
  const params = useMemo(() => (data?.parameters || []).filter((item) => item.revision_id === selected), [data, selected])
  const issues = useMemo(() => (data?.issues || []).filter((item) => item.revision_id === selected), [data, selected])
  const options = useMemo(() => (data?.options || []).filter((item) => item.revision_id === selected), [data, selected])
  const rules = useMemo(() => (data?.rules || []).filter((item) => item.revision_id === selected), [data, selected])
  const formulas = useMemo(() => (data?.formulas || []).filter((item) => item.revision_id === selected), [data, selected])
  const template = (data?.templates || []).find((item) => item.revision_id === selected)

  const [revisionForm, setRevisionForm] = useState({ revision: "", brand: "", cat: "", cct: "", cctValid: "", responsible: "", revisedAt: "", notes: "" })
  useEffect(() => {
    setRevisionForm({ revision: revision?.revision || "", brand: revision?.brand_model_version_code || "", cat: revision?.cat_number || "", cct: revision?.cct_number || "", cctValid: revision?.cct_valid_until || "", responsible: revision?.technical_responsible || "", revisedAt: revision?.revised_at || "", notes: revision?.notes || "" })
  }, [revision?.id, revision?.updated_at, revision?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  const [doc, setDoc] = useState({ kind: "Desenho tecnico", name: "", number: "", issuer: "", issuedAt: "", validUntil: "", path: "" })
  const [param, setParam] = useState({ key: "", label: "", unit: "mm", scope: "nao_declarada", configurable: false, integerOnly: false, step: "", def: "", sources: [{ document_id: "", min: "", max: "", fixed: "" }] })
  const [option, setOption] = useState({ group: "acabamento", code: "", label: "", price: "", cost: "", kit: "", kitQty: "1", isDefault: false })
  const [rule, setRule] = useState({ code: "", kind: "bloqueia", text: "", message: "" })
  const [formula, setFormula] = useState({ kit: "", material: "", text: "", unit: "", loss: "", rounding: "nenhum", step: "", cutBar: "", cutPieces: "" })
  const [resolve, setResolve] = useState<Record<string, { min: string; max: string; fixed: string; text: string }>>({})

  async function upload(file: File) {
    const form = new FormData(); form.append("file", file)
    const response = await fetch("/api/engenharia/upload", { method: "POST", body: form })
    const payload = await response.json().catch(() => null)
    if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
    return payload as { path: string; name: string }
  }
  async function pickFile(file: File | undefined, then: (info: { path: string; name: string }) => void) {
    if (!file) return
    setNotice("Enviando arquivo...")
    try { then(await upload(file)); setNotice("") } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Arquivo não enviado.") }
  }
  const formulaCheck = formula.text.trim() ? parseExpression(formula.text) : null
  const ruleCheck = rule.text.trim() ? parseExpression(rule.text) : null
  const kitComponents = data?.bom_kits.find((kit) => kit.kit_id === formula.kit)?.components || []
  const previewDims = useMemo(() => { const mid = (key: string) => { const p = params.find((item) => item.key === key); const lo = p?.adopted_min ?? p?.sources?.find((s: any) => s.min != null)?.min; const hi = p?.adopted_max ?? p?.sources?.find((s: any) => s.max != null)?.max; return lo != null && hi != null ? (Number(lo) + Number(hi)) / 2 : null }; const c = mid("comprimento"), l = mid("largura"), a = mid("altura"); return c && l && a ? { comprimento: c, largura: l, altura: a } : null }, [params])

  if (error) return <p className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{error}</p>
  if (!data) return <p className="text-sm text-muted-foreground">Carregando engenharia...</p>

  return (
    <div className="space-y-4">
      {notice ? <p className="rounded-md border bg-muted/40 p-3 text-sm">{notice}</p> : null}
      <SectionCard title="Revisão do projeto" description="Cada revisão guarda seus documentos, limites e regras. Revisão validada não se altera: mudança vira revisão nova. Nenhuma medida é homologada sem a validação da engenharia.">
        {data.revisions.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Este produto ainda não tem engenharia cadastrada.</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void act("revision_save", { data: { revision: "R1" } }, "Revisão R1 criada.")} disabled={Boolean(busy)}><Plus className="h-4 w-4" />Criar revisão R1</Button>
              {manager && /fz\s*1e/i.test(productName) ? <Button variant="outline" onClick={() => void act("preset_fz1e", {}, "Modelo piloto FZ 1E carregado em rascunho (dados do CCT A0.051.856 e do desenho 8102.12.170-1).")} disabled={Boolean(busy)}>{busy === "preset_fz1e" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}Carregar modelo piloto FZ 1E (CCT e desenho)</Button> : null}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label="Revisão" className="h-9 rounded-md border bg-background px-2 text-sm" value={selected} onChange={(event) => setSelected(event.target.value)}>
                {data.revisions.map((item) => <option key={item.id} value={item.id}>{item.revision} · {revisionStatusLabels[item.status] || item.status}</option>)}
              </select>
              {revision ? <span className={`rounded px-2 py-0.5 text-xs font-medium ${revision.status === "Validada" ? "bg-emerald-100 text-emerald-800" : revision.status === "Obsoleta" ? "bg-slate-100 text-slate-600" : "bg-amber-100 text-amber-800"}`}>{revisionStatusLabels[revision.status]}</span> : null}
              {revision && Number(revision.open_issues) > 0 ? <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-800">{revision.open_issues} pendência(s) de engenharia</span> : null}
              {revision?.validated_by ? <span className="text-xs text-muted-foreground">validada por {revision.validated_by} em {dateBr(revision.validated_at)}</span> : null}
              {revision ? <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void act("revision_copy", { revisionId: revision.id }, "Revisão nova criada em rascunho a partir desta.")}>Nova revisão a partir desta</Button> : null}
              {revision?.status === "Rascunho" ? <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void act("submit", { revisionId: revision.id }, "Enviada para validação.")}>Enviar para validação</Button> : null}
              {revision?.status === "Em validacao" ? <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void act("back_to_draft", { revisionId: revision.id }, "Voltou para rascunho.")}>Voltar para rascunho</Button> : null}
              {editable && manager ? <Button size="sm" disabled={Boolean(busy)} onClick={() => void act("validate", { revisionId: revision!.id }, "Revisão validada: os limites passam a ser homologados.")}>{busy === "validate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Validar revisão</Button> : null}
            </div>
            {revision ? (
              <div className="grid gap-3 md:grid-cols-4">
                <Field label="Código marca/modelo/versão"><Input value={revisionForm.brand} disabled={!editable} onChange={(e) => setRevisionForm({ ...revisionForm, brand: e.target.value })} /></Field>
                <Field label="CAT nº"><Input value={revisionForm.cat} disabled={!editable} onChange={(e) => setRevisionForm({ ...revisionForm, cat: e.target.value })} /></Field>
                <Field label="CCT nº"><Input value={revisionForm.cct} disabled={!editable} onChange={(e) => setRevisionForm({ ...revisionForm, cct: e.target.value })} /></Field>
                <Field label="Validade do CCT"><Input type="date" value={revisionForm.cctValid} disabled={!editable} onChange={(e) => setRevisionForm({ ...revisionForm, cctValid: e.target.value })} /></Field>
                <Field label="Responsável técnico" className="md:col-span-2"><Input value={revisionForm.responsible} disabled={!editable} onChange={(e) => setRevisionForm({ ...revisionForm, responsible: e.target.value })} /></Field>
                <Field label="Data da revisão"><Input type="date" value={revisionForm.revisedAt} disabled={!editable} onChange={(e) => setRevisionForm({ ...revisionForm, revisedAt: e.target.value })} /></Field>
                <Field label="Estrutura de fabricação"><Input disabled value={revision.bom_version ? `v${revision.bom_version}` : "vigente na venda"} /></Field>
                <Field label="Observações" className="md:col-span-4"><Textarea rows={2} value={revisionForm.notes} disabled={!editable} onChange={(e) => setRevisionForm({ ...revisionForm, notes: e.target.value })} /></Field>
                {editable ? <div className="md:col-span-4"><Button variant="outline" disabled={Boolean(busy)} onClick={() => void act("revision_save", { data: { revision_id: revision.id, brand_model_version_code: revisionForm.brand, cat_number: revisionForm.cat, cct_number: revisionForm.cct, cct_valid_until: revisionForm.cctValid, technical_responsible: revisionForm.responsible, revised_at: revisionForm.revisedAt, notes: revisionForm.notes } }, "Dados da revisão salvos.")}>Salvar dados da revisão</Button></div> : null}
              </div>
            ) : null}
          </div>
        )}
      </SectionCard>

      {revision ? (<>
        <SectionCard title={`Documentos da revisão ${revision.revision}`} description="Desenho técnico, CCT, CAT, memorial, fotografias e CAD. Ficam guardados em área privada, com o histórico das revisões anteriores.">
          <DataTable headers={["Tipo", "Documento", "Número", "Emissor", "Emissão", "Validade", "Arquivo"]} empty={!docs.length}>
            {docs.map((item) => (
              <TableRow key={item.id}>
                <TableCell>{documentKindLabels[item.kind] || item.kind}</TableCell><TableCell>{item.name}</TableCell><TableCell className="font-mono text-xs">{item.document_number || "-"}</TableCell>
                <TableCell className="text-xs">{item.issuer || "-"}</TableCell><TableCell>{dateBr(item.issued_at)}</TableCell><TableCell>{dateBr(item.valid_until)}</TableCell>
                <TableCell>{item.file_path ? <a className="text-primary underline" href={open(item.file_path)} target="_blank" rel="noreferrer">Abrir</a> : editable ? (
                  <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-amber-700"><FileUp className="h-3 w-3" />anexar original<input type="file" className="hidden" onChange={(e) => void pickFile(e.target.files?.[0], (info) => void act("document_attach", { documentId: item.id, path: info.path }, "Arquivo anexado."))} /></label>
                ) : <span className="text-xs text-muted-foreground">sem arquivo</span>}</TableCell>
              </TableRow>
            ))}
          </DataTable>
          {editable ? (
            <div className="mt-3 grid gap-2 md:grid-cols-6">
              <select aria-label="Tipo" className="h-9 rounded-md border bg-background px-2 text-sm" value={doc.kind} onChange={(e) => setDoc({ ...doc, kind: e.target.value })}>{documentKinds.map((kind) => <option key={kind} value={kind}>{documentKindLabels[kind]}</option>)}</select>
              <Input placeholder="Nome do documento *" value={doc.name} onChange={(e) => setDoc({ ...doc, name: e.target.value })} className="md:col-span-2" />
              <Input placeholder="Número" value={doc.number} onChange={(e) => setDoc({ ...doc, number: e.target.value })} />
              <Input placeholder="Emissor" value={doc.issuer} onChange={(e) => setDoc({ ...doc, issuer: e.target.value })} />
              <Input type="date" title="Validade" value={doc.validUntil} onChange={(e) => setDoc({ ...doc, validUntil: e.target.value })} />
              <label className="flex cursor-pointer items-center gap-1 text-xs"><FileUp className="h-4 w-4" />{doc.path ? "arquivo enviado" : "anexar arquivo"}<input type="file" className="hidden" onChange={(e) => void pickFile(e.target.files?.[0], (info) => setDoc((current) => ({ ...current, path: info.path, name: current.name || info.name })))} /></label>
              <Button disabled={Boolean(busy) || !doc.name.trim()} onClick={async () => { if (await act("document_add", { data: { revision_id: revision.id, kind: doc.kind, name: doc.name, document_number: doc.number, issuer: doc.issuer, issued_at: doc.issuedAt, valid_until: doc.validUntil, file_path: doc.path } }, "Documento cadastrado.")) setDoc({ kind: "Desenho tecnico", name: "", number: "", issuer: "", issuedAt: "", validUntil: "", path: "" }) }}>Adicionar documento</Button>
            </div>
          ) : null}
        </SectionCard>

        {issues.length ? (
          <SectionCard title="Pendências de engenharia" description="Divergências entre os documentos. O sistema não escolhe sozinho: a engenharia decide os limites e registra a justificativa.">
            <ul className="space-y-3">
              {issues.map((issue) => {
                const form = resolve[issue.id] || { min: "", max: "", fixed: "", text: "" }
                const set = (patch: Partial<typeof form>) => setResolve({ ...resolve, [issue.id]: { ...form, ...patch } })
                return (
                  <li key={issue.id} className={`rounded-md border p-3 text-sm ${issue.status === "Aberta" ? "border-red-200 bg-red-50" : "bg-muted/30"}`}>
                    <p className="flex items-start gap-2"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />{issue.description}</p>
                    {issue.status === "Resolvida" ? <p className="mt-1 text-xs text-muted-foreground">Resolvida por {issue.resolved_by} em {dateBr(issue.resolved_at)}: {issue.resolution}</p> : editable && manager ? (
                      <div className="mt-2 grid gap-2 md:grid-cols-5">
                        <Input placeholder="Mínimo adotado" value={form.min} onChange={(e) => set({ min: e.target.value })} /><Input placeholder="Máximo adotado" value={form.max} onChange={(e) => set({ max: e.target.value })} /><Input placeholder="Valor fixo adotado" value={form.fixed} onChange={(e) => set({ fixed: e.target.value })} />
                        <Input placeholder="Decisão e justificativa *" className="md:col-span-2" value={form.text} onChange={(e) => set({ text: e.target.value })} />
                        <Button className="md:col-span-5 md:w-fit" disabled={Boolean(busy) || !form.text.trim()} onClick={() => void act("issue_resolve", { data: { issue_id: issue.id, resolution: form.text, adopted_min: num(form.min), adopted_max: num(form.max), adopted_fixed: num(form.fixed) } }, "Decisão registrada.")}>Registrar decisão da engenharia</Button>
                      </div>
                    ) : <p className="mt-1 text-xs text-muted-foreground">Aguardando decisão da engenharia (administrador ou gerente).</p>}
                  </li>
                )
              })}
            </ul>
          </SectionCard>
        ) : null}

        <SectionCard title="Parâmetros dimensionais e de referência" description="Cada limite aponta para o documento de origem. Dimensão configurável = o vendedor escolhe dentro dos limites. Escopo: externa, útil ou interna.">
          <DataTable headers={["Parâmetro", "Escopo", "Tipo", "Limites por fonte", "Adotado pela engenharia", "Situação"]} empty={!params.length}>
            {params.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">{item.label} <span className="font-mono text-xs text-muted-foreground">{item.key}</span></TableCell>
                <TableCell className="text-xs">{scopeLabels[item.scope] || item.scope}</TableCell>
                <TableCell className="text-xs">{item.configurable ? "configurável" : "referência"}{item.step ? ` · passo ${item.step}` : ""}{item.default_value != null ? ` · padrão ${item.default_value}` : ""}</TableCell>
                <TableCell className="text-xs">{(item.sources as Array<Record<string, any>>).map((source) => <div key={source.id}>{source.document}: {[source.min != null ? `mín ${source.min}` : "", source.max != null ? `máx ${source.max}` : "", source.fixed != null ? `fixo ${source.fixed}` : ""].filter(Boolean).join(" · ")} {item.unit}</div>)}</TableCell>
                <TableCell className="text-xs">{[item.adopted_min != null ? `mín ${item.adopted_min}` : "", item.adopted_max != null ? `máx ${item.adopted_max}` : "", item.adopted_fixed != null ? `fixo ${item.adopted_fixed}` : ""].filter(Boolean).join(" · ") || "—"}{item.adoption_note ? <div className="text-muted-foreground">{item.adoption_note}</div> : null}</TableCell>
                <TableCell>{item.in_conflict && item.adopted_min == null && item.adopted_max == null && item.adopted_fixed == null ? <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-800">Conflito</span> : revision.status === "Validada" ? <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">Homologado</span> : <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Não validado</span>}</TableCell>
              </TableRow>
            ))}
          </DataTable>
          {editable ? (
            <div className="mt-3 space-y-2 rounded-md border p-3">
              <div className="grid gap-2 md:grid-cols-6">
                <Input placeholder="chave (ex.: comprimento)" value={param.key} onChange={(e) => setParam({ ...param, key: e.target.value.toLowerCase() })} />
                <Input placeholder="Nome *" value={param.label} onChange={(e) => setParam({ ...param, label: e.target.value })} />
                <Input placeholder="Unidade" value={param.unit} onChange={(e) => setParam({ ...param, unit: e.target.value })} />
                <select className="h-9 rounded-md border bg-background px-2 text-sm" value={param.scope} onChange={(e) => setParam({ ...param, scope: e.target.value })}>{Object.entries(scopeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                <Input placeholder="Passo (opcional)" value={param.step} onChange={(e) => setParam({ ...param, step: e.target.value })} />
                <Input placeholder="Padrão (opcional)" value={param.def} onChange={(e) => setParam({ ...param, def: e.target.value })} />
              </div>
              <div className="flex flex-wrap gap-4 text-sm"><label className="flex items-center gap-1"><input type="checkbox" checked={param.configurable} onChange={(e) => setParam({ ...param, configurable: e.target.checked })} />O vendedor escolhe o valor</label><label className="flex items-center gap-1"><input type="checkbox" checked={param.integerOnly} onChange={(e) => setParam({ ...param, integerOnly: e.target.checked })} />Só inteiro</label></div>
              {param.sources.map((source, index) => (
                <div key={index} className="grid gap-2 md:grid-cols-5">
                  <select aria-label="Documento de origem" className="h-9 rounded-md border bg-background px-2 text-sm md:col-span-2" value={source.document_id} onChange={(e) => setParam({ ...param, sources: param.sources.map((s, i) => (i === index ? { ...s, document_id: e.target.value } : s)) })}><option value="">Documento de origem *</option>{docs.map((item) => <option key={item.id} value={item.id}>{documentKindLabels[item.kind]} {item.document_number || item.name}</option>)}</select>
                  {(["min", "max", "fixed"] as const).map((field) => <Input key={field} placeholder={field === "min" ? "Mínimo" : field === "max" ? "Máximo" : "Valor fixo"} value={source[field]} onChange={(e) => setParam({ ...param, sources: param.sources.map((s, i) => (i === index ? { ...s, [field]: e.target.value } : s)) })} />)}
                </div>
              ))}
              <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setParam({ ...param, sources: [...param.sources, { document_id: "", min: "", max: "", fixed: "" }] })}>Outra fonte</Button>
                <Button size="sm" disabled={Boolean(busy) || !param.key || !param.label.trim() || param.sources.some((s) => !s.document_id)} onClick={async () => { if (await act("parameter_save", { data: { revision_id: revision.id, key: param.key, label: param.label, unit: param.unit, scope: param.scope, configurable: param.configurable, integer_only: param.integerOnly, step: num(param.step), default_value: num(param.def), position: params.length, sources: param.sources.map((s) => ({ document_id: s.document_id, min: num(s.min), max: num(s.max), fixed: num(s.fixed) })) } }, "Parâmetro salvo.")) setParam({ ...param, key: "", label: "", step: "", def: "", sources: [{ document_id: "", min: "", max: "", fixed: "" }] }) }}>Salvar parâmetro</Button>
                <Button variant="outline" size="sm" disabled={Boolean(busy)} onClick={() => void act("detect", { revisionId: revision.id }, "Divergências conferidas.")}>Conferir divergências entre documentos</Button></div>
            </div>
          ) : null}
        </SectionCard>

        <SectionCard title="Acabamentos e acessórios" description="Opções comerciais permitidas. Podem acrescentar preço, custo (serviço terceirizado) e um kit de fabricação.">
          <DataTable headers={["Grupo", "Código", "Opção", "Preço +", "Custo +", "Kit", "Padrão"]} empty={!options.length}>
            {options.map((item) => <TableRow key={item.id}><TableCell>{optionGroupLabels[item.group]}</TableCell><TableCell className="font-mono text-xs">{item.code}</TableCell><TableCell>{item.label}{item.active ? "" : " (inativa)"}</TableCell><TableCell>{brl(item.price_delta)}</TableCell><TableCell>{brl(item.cost_delta)}</TableCell><TableCell className="text-xs">{item.kit ? `${item.kit} × ${item.kit_quantity}` : "-"}</TableCell><TableCell>{item.is_default ? "sim" : ""}</TableCell></TableRow>)}
          </DataTable>
          {editable ? (
            <div className="mt-3 grid gap-2 md:grid-cols-7">
              <select className="h-9 rounded-md border bg-background px-2 text-sm" value={option.group} onChange={(e) => setOption({ ...option, group: e.target.value })}><option value="acabamento">Acabamento</option><option value="acessorio">Acessório</option></select>
              <Input placeholder="código" value={option.code} onChange={(e) => setOption({ ...option, code: e.target.value.toLowerCase() })} /><Input placeholder="Nome *" value={option.label} onChange={(e) => setOption({ ...option, label: e.target.value })} />
              <Input placeholder="Preço +" value={option.price} onChange={(e) => setOption({ ...option, price: e.target.value })} /><Input placeholder="Custo +" value={option.cost} onChange={(e) => setOption({ ...option, cost: e.target.value })} />
              <select aria-label="Kit" className="h-9 rounded-md border bg-background px-2 text-sm" value={option.kit} onChange={(e) => setOption({ ...option, kit: e.target.value })}><option value="">Sem kit</option>{data.bom_kits.map((kit) => <option key={kit.kit_id} value={kit.kit_id}>{kit.name}</option>)}</select>
              <Button disabled={Boolean(busy) || !option.code || !option.label.trim()} onClick={async () => { if (await act("option_save", { data: { revision_id: revision.id, option_group: option.group, code: option.code, label: option.label, price_delta: num(option.price), cost_delta: num(option.cost), kit_id: option.kit || null, is_default: option.isDefault } }, "Opção salva.")) setOption({ ...option, code: "", label: "", price: "", cost: "" }) }}>Salvar</Button>
            </div>
          ) : null}
          <p className="mt-2 text-xs text-muted-foreground">Kits aqui são os já cadastrados e ativos (Kits e composições); a opção só adiciona o kit à fabricação.</p>
        </SectionCard>

        <SectionCard title="Regras de compatibilidade" description="Combinações que a engenharia proíbe ou exige. Escritas com parâmetros (comprimento, largura, altura, acc_codigo, acabamento) e operadores permitidos.">
          <DataTable headers={["Código", "Tipo", "Condição", "Mensagem ao vendedor"]} empty={!rules.length}>
            {rules.map((item) => <TableRow key={item.id}><TableCell className="font-mono text-xs">{item.code}</TableCell><TableCell>{item.kind === "bloqueia" ? "bloqueia se verdadeira" : "exige verdadeira"}</TableCell><TableCell className="font-mono text-xs">{item.expr_text}</TableCell><TableCell>{item.message}</TableCell></TableRow>)}
          </DataTable>
          {editable ? (
            <div className="mt-3 space-y-2"><div className="grid gap-2 md:grid-cols-5">
              <Input placeholder="código" value={rule.code} onChange={(e) => setRule({ ...rule, code: e.target.value })} />
              <select className="h-9 rounded-md border bg-background px-2 text-sm" value={rule.kind} onChange={(e) => setRule({ ...rule, kind: e.target.value })}><option value="bloqueia">Bloqueia se for verdadeira</option><option value="exige">Exige que seja verdadeira</option></select>
              <Input className="md:col-span-3" placeholder="Condição (ex.: altura > 2000 e largura < 1200)" value={rule.text} onChange={(e) => setRule({ ...rule, text: e.target.value })} />
              <Input className="md:col-span-4" placeholder="Mensagem *" value={rule.message} onChange={(e) => setRule({ ...rule, message: e.target.value })} />
              <Button disabled={Boolean(busy) || !rule.code || !rule.message.trim() || !ruleCheck?.ok} onClick={async () => { if (await act("rule_save", { data: { revision_id: revision.id, code: rule.code, kind: rule.kind, expr_text: rule.text, message: rule.message } }, "Regra salva.")) setRule({ code: "", kind: "bloqueia", text: "", message: "" }) }}>Salvar regra</Button>
            </div>{ruleCheck && !ruleCheck.ok ? <p className="text-xs text-destructive">{ruleCheck.error}</p> : null}</div>
          ) : null}
        </SectionCard>

        <SectionCard title="Fórmulas de quantidade (kits paramétricos)" description="Substituem a quantidade fixa de UM componente de um kit. Nascem em rascunho e só valem depois da aprovação da engenharia. Operações permitidas: + − × ÷, comparações, e/ou/nao, ceil, floor, round, max, min, abs, se(…).">
          <DataTable headers={["Kit / material", "Fórmula", "Unid.", "Perda", "Arredondamento", "Situação", ""]} empty={!formulas.length}>
            {formulas.map((item) => (
              <TableRow key={item.id}>
                <TableCell>{item.kit} → {item.material}</TableCell><TableCell className="font-mono text-xs">{item.expr_text}</TableCell><TableCell>{item.unit}</TableCell><TableCell>{Number(item.loss_percent) ? `${item.loss_percent}%` : "-"}</TableCell>
                <TableCell className="text-xs">{item.rounding}{item.rounding_step ? ` (${item.rounding_step})` : ""}{item.cut_rule ? " · com plano de corte" : ""}</TableCell>
                <TableCell>{item.status === "Aprovada" ? <span className="text-xs text-emerald-700">Aprovada por {item.approved_by} v{item.version}</span> : <span className="text-xs text-amber-700">{item.status}</span>}</TableCell>
                <TableCell>{item.status === "Rascunho" && editable && manager ? <Button size="sm" disabled={Boolean(busy)} onClick={() => void act("formula_approve", { formulaId: item.id }, "Fórmula aprovada.")}>Aprovar</Button> : null}</TableCell>
              </TableRow>
            ))}
          </DataTable>
          {editable ? (
            <div className="mt-3 space-y-2"><div className="grid gap-2 md:grid-cols-6">
              <select aria-label="Kit" className="h-9 rounded-md border bg-background px-2 text-sm" value={formula.kit} onChange={(e) => setFormula({ ...formula, kit: e.target.value, material: "" })}><option value="">Kit...</option>{data.bom_kits.map((kit) => <option key={kit.kit_id} value={kit.kit_id}>{kit.name}</option>)}</select>
              <select aria-label="Material" className="h-9 rounded-md border bg-background px-2 text-sm md:col-span-2" value={formula.material} onChange={(e) => { const component = kitComponents.find((c) => c.material_id === e.target.value); setFormula({ ...formula, material: e.target.value, unit: component?.unit || formula.unit }) }}><option value="">Componente do kit...</option>{kitComponents.map((c) => <option key={c.material_id} value={c.material_id}>{c.name} (fixo: {c.quantity} {c.comp_unit})</option>)}</select>
              <Input placeholder="Unidade" value={formula.unit} onChange={(e) => setFormula({ ...formula, unit: e.target.value })} /><Input placeholder="Perda %" value={formula.loss} onChange={(e) => setFormula({ ...formula, loss: e.target.value })} />
              <select className="h-9 rounded-md border bg-background px-2 text-sm" value={formula.rounding} onChange={(e) => setFormula({ ...formula, rounding: e.target.value })}><option value="nenhum">Sem arredondar</option><option value="cima">Para cima</option><option value="baixo">Para baixo</option><option value="multiplo">Múltiplo (para cima)</option></select>
              <Input className="md:col-span-5" placeholder="Fórmula (ex.: (2*comprimento + 3*largura)/1000)" value={formula.text} onChange={(e) => setFormula({ ...formula, text: e.target.value })} />
              <Input placeholder="Passo do arredondamento" value={formula.step} onChange={(e) => setFormula({ ...formula, step: e.target.value })} />
              <Input placeholder="Barra para corte (mm, opcional)" value={formula.cutBar} onChange={(e) => setFormula({ ...formula, cutBar: e.target.value })} />
              <Textarea className="md:col-span-5" rows={2} placeholder="Peças do corte, uma por linha: nome ; medida em mm (expressão) ; quantidade (expressão)" value={formula.cutPieces} onChange={(e) => setFormula({ ...formula, cutPieces: e.target.value })} />
            </div>
              {formulaCheck && !formulaCheck.ok ? <p className="text-xs text-destructive">{formulaCheck.error}</p> : formulaCheck?.ok ? <p className="text-xs text-muted-foreground">Parâmetros usados: {formulaCheck.params.join(", ") || "nenhum"}</p> : null}
              <Button disabled={Boolean(busy) || !formula.kit || !formula.material || !formulaCheck?.ok || !formula.unit.trim()} onClick={async () => {
                const pieces = formula.cutPieces.split("\n").map((line) => line.split(";").map((part) => part.trim())).filter((parts) => parts[0] && parts[1]).map(([label, length, count]) => ({ label, length_text: length, count_text: count || "1" }))
                if (await act("formula_save", { data: { revision_id: revision.id, kit_id: formula.kit, material_id: formula.material, expr_text: formula.text, unit: formula.unit, loss_percent: num(formula.loss) ?? 0, rounding: formula.rounding, rounding_step: num(formula.step), cut_rule: formula.cutBar && pieces.length ? { bar_length: num(formula.cutBar), pieces } : null } }, "Fórmula salva em rascunho: aguarda a aprovação da engenharia.")) setFormula({ kit: "", material: "", text: "", unit: "", loss: "", rounding: "nenhum", step: "", cutBar: "", cutPieces: "" })
              }}>Salvar fórmula (rascunho)</Button></div>
          ) : null}
        </SectionCard>

        <SectionCard title="Desenho paramétrico" description="Esquema 2D das três vistas gerado pelas medidas. Fica identificado como ILUSTRATIVO até a engenharia validar a geometria do modelo.">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{template ? `Modelo ${template.template_key} v${template.template_version} · ${template.grade}` : "Sem modelo de desenho"}</span>
            {editable && !template ? <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void act("template_save", { data: { revision_id: revision.id, template_key: "reboque_aberto_1_eixo", grade: "ilustrativo" } }, "Modelo de desenho vinculado (ilustrativo).")}>Usar o desenho de reboque aberto de 1 eixo</Button> : null}
          </div>
          {previewDims ? <TrailerDrawingView product={productName} params={previewDims} grade={template?.grade === "validado" && revision.status === "Validada" ? "validado" : "ilustrativo"} revision={revision.revision} geometry={template?.geometry} /> : <p className="text-sm text-muted-foreground">Cadastre limites mínimo e máximo de comprimento, largura e altura para pré-visualizar (medidas médias).</p>}
        </SectionCard>
      </>) : null}
    </div>
  )
}
