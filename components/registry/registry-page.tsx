"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CheckCircle2, Eye, Link2, Loader2, Plus, RefreshCw, Search, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, FormSheet, PageShell, SaveButton, SectionCard, SelectField, StatusBadge, useCrudFeedback } from "@/components/operations/shared"
import { brStates, icmsIndicators } from "@/lib/commercial"
import { IdDocumentCapture } from "@/components/registry/id-capture"
import { idDocumentNotes, type ParsedIdDocument } from "@/lib/id-document"
import { applyCompany, cleanDocument, companyToForm, fieldsFor, formatDocument, formatPhone, formatZip, isLookupReady, sectionTitles, supplyCategories, type Entity, type Field, type Section } from "@/lib/registry"

type Item = Record<string, any>
type Option = { value: string; label: string }
type Options = { salespeople: Option[]; paymentConditions: Option[]; priceTables: Option[] }
type Found = { id: string; code: string; name: string; partyId: string } | null
type Lookup = { state: "idle" | "loading" | "ok" | "error"; message: string }

const none = "nenhum"
const sectionOrder: Section[] = ["ident", "cnpj", "contato", "endereco", "comercial", "bancario", "obs"]
const titleCase = (value: string) => value.toLowerCase().replace(/(^|\s)([a-zà-ÿ])/g, (_, space, letter) => space + letter.toUpperCase()).replace(/\b(Da|De|Do|Das|Dos|E)\b/g, (word) => word.toLowerCase())
const labels: Record<Entity, { singular: string; plural: string; other: string }> = {
  client: { singular: "cliente", plural: "Clientes", other: "fornecedor" },
  supplier: { singular: "fornecedor", plural: "Fornecedores", other: "cliente" },
}
const brl = (value: unknown) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const day = (value?: string) => (value ? String(value).slice(0, 10).split("-").reverse().join("/") : "")
const stamp = (value?: string) => (value ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "")

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
  return payload as T
}

const emptyForm = (entity: Entity): Item => ({
  id: "", partyId: "", personType: "PJ", status: "Ativo", country: "Brasil", icmsIndicator: "1", partners: [], cnpjSource: "", cnpjConsultedAt: "",
  ...Object.fromEntries(fieldsFor(entity).filter((field) => !["personType", "status", "country", "icmsIndicator"].includes(field.key)).map((field) => [field.key, ""])),
})

function optionsFor(entity: Entity, field: Field, options: Options): Option[] {
  if (field.key === "personType") return [{ value: "PJ", label: "Pessoa jurídica" }, { value: "PF", label: "Pessoa física" }]
  if (field.key === "status") return [{ value: "Ativo", label: "Ativo" }, { value: "Inativo", label: "Inativo" }, ...(entity === "client" ? [{ value: "Prospect", label: "Lead (prospect)" }] : [])]
  if (field.key === "icmsIndicator") return icmsIndicators.map((item) => ({ value: item.value, label: item.label }))
  if (field.key === "salespersonId") return options.salespeople
  if (field.key === "priceTableId") return options.priceTables
  if (field.key === "paymentConditionId") return options.paymentConditions
  if (field.key === "supplyCategory") return supplyCategories.map((value) => ({ value, label: value }))
  return (field.options || []).filter(Boolean).map((value) => ({ value, label: value }))
}

function valueLabel(entity: Entity, field: Field, item: Item, options: Options) {
  const value = String(item[field.key] ?? "")
  if (!value) return ""
  if (field.key === "document" || field.key === "holderDocument") return formatDocument(value)
  if (field.type === "date") return day(value)
  if (field.key === "creditLimit" || field.key === "minOrder") return Number(value) ? brl(value) : ""
  if (field.key === "defaultDiscount") return Number(value) ? `${value}%` : ""
  if (field.type === "select") return optionsFor(entity, field, options).find((option) => option.value === value)?.label || value
  return value
}

function Banner({ tone, children }: { tone: "error" | "warn" | "ok" | "info"; children: React.ReactNode }) {
  const style = { error: "border-destructive/40 bg-destructive/5 text-destructive", warn: "border-amber-500/40 bg-amber-500/10", ok: "border-green-600/40 bg-green-600/10", info: "border-border bg-muted/40" }[tone]
  return <div className={`flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm ${style}`}>{children}</div>
}

function FieldInput({ entity, field, form, options, onChange }: { entity: Entity; field: Field; form: Item; options: Options; onChange: (key: string, value: string) => void }) {
  const value = String(form[field.key] ?? "")
  const label = `${field.label}${field.required ? " *" : ""}${field.auto ? " (automático)" : ""}`
  if (field.key === "code") return <div className="space-y-2"><Label>{field.label}</Label><Input value={value || "Gerado ao salvar"} readOnly disabled /></div>
  if (field.type === "select") {
    const list = optionsFor(entity, field, options)
    const required = field.required && field.key !== "supplyCategory" ? true : false
    return <SelectField label={label} value={value || none} onChange={(next) => onChange(field.key, next === none ? "" : next)} options={required ? list : [{ value: none, label: "Nenhum" }, ...list]} />
  }
  if (field.type === "area") return <div className="space-y-2 md:col-span-2"><Label>{label}</Label><Textarea rows={3} value={value} onChange={(event) => onChange(field.key, event.target.value)} placeholder={field.hint || field.label} /></div>
  if (field.type === "state") return <SelectField label={label} value={value || none} onChange={(next) => onChange(field.key, next === none ? "" : next)} options={[{ value: none, label: "UF" }, ...brStates.map((uf) => ({ value: uf, label: uf }))]} />
  const display = field.key === "document" || field.key === "holderDocument" ? formatDocument(value) : field.type === "phone" ? formatPhone(value) : field.type === "zip" ? formatZip(value) : value
  const handle = (raw: string) => {
    if (field.key === "document" || field.key === "holderDocument") return onChange(field.key, cleanDocument(raw).slice(0, 14))
    if (field.type === "phone") return onChange(field.key, formatPhone(raw))
    if (field.type === "zip") return onChange(field.key, formatZip(raw))
    onChange(field.key, raw)
  }
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input type={field.type === "number" ? "number" : field.type === "date" ? "date" : field.type === "email" ? "email" : "text"} min={field.type === "number" ? 0 : undefined} value={display} onChange={(event) => handle(event.target.value)} placeholder={field.hint || field.label} />
    </div>
  )
}

function RegistryTab({ entity, items, otherItems, options, loading, onReload, mode }: { entity: Entity; items: Item[]; otherItems: Item[]; options: Options; loading: boolean; onReload: () => Promise<void>; mode?: "lead" }) {
  const { toast } = useCrudFeedback()
  const lead = mode === "lead"
  const text = lead ? { singular: "lead", plural: "Leads", other: "fornecedor" } : labels[entity]
  const endpoint = entity === "client" ? "/api/cadastros/clientes" : "/api/cadastros/fornecedores"
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("todos")
  const [form, setForm] = useState<Item | null>(null)
  const [viewing, setViewing] = useState<Item | null>(null)
  const [saving, setSaving] = useState(false)
  const [lookup, setLookup] = useState<Lookup>({ state: "idle", message: "" })
  const [existing, setExisting] = useState<{ client: Found; supplier: Found }>({ client: null, supplier: null })
  const [linkFromId, setLinkFromId] = useState("")
  const [pending, setPending] = useState<{ company: Record<string, string>; conflicts: string[] } | null>(null)
  const touched = useRef(new Set<string>())
  const lastDocument = useRef("")
  const formRef = useRef<Item | null>(null)
  formRef.current = form
  const fields = useMemo(() => fieldsFor(entity).filter((field) => !(lead && field.key === "status")), [entity, lead])

  const shown = items.filter((row) => {
    const haystack = [row.name, row.tradeName, row.document, row.phone, row.city, row.code, row.contactName].join(" ").toLowerCase()
    const digits = query.replace(/\D/g, "")
    const matches = !query.trim() || haystack.includes(query.toLowerCase()) || (digits.length > 2 && cleanDocument(row.document).includes(digits))
    return matches && (statusFilter === "todos" || row.status === statusFilter)
  })

  function openForm(row?: Item) {
    touched.current = new Set()
    lastDocument.current = row ? cleanDocument(row.document) : ""
    setLookup({ state: "idle", message: "" })
    setExisting({ client: null, supplier: null })
    setLinkFromId("")
    setPending(null)
    setForm(row ? { ...emptyForm(entity), ...row } : { ...emptyForm(entity), ...(lead ? { status: "Prospect", icmsIndicator: "9" } : {}) })
  }

  function change(key: string, value: string) {
    touched.current.add(key)
    setForm((current) => current && { ...current, [key]: value, ...(key === "personType" && value === "PF" ? { cnpjStatus: "", cnpjStatusDate: "", openedAt: "", branchType: "", cnaeMain: "", cnaeSecondary: "", legalNature: "", companySize: "" } : {}) })
  }

  const runLookup = useCallback(async (document: string, force = false) => {
    setLookup({ state: "loading", message: "Consultando o CNPJ..." })
    const clean = cleanDocument(document)
    const [check, result] = await Promise.allSettled([
      api<{ client: Found; supplier: Found }>(`/api/cadastros/verificar?document=${clean}`),
      api<{ company: Record<string, any>; partners: Array<{ name: string; role: string }>; source: string; consultedAt: string }>(`/api/cadastros/cnpj/${clean}`),
    ])
    if (check.status === "fulfilled") setExisting(check.value)
    if (result.status === "rejected") return setLookup({ state: "error", message: result.reason instanceof Error ? result.reason.message : "Não foi possível consultar o CNPJ." })
    const { company, partners, source, consultedAt } = result.value
    const mapped = companyToForm(company as any)
    const current = formRef.current || emptyForm(entity)
    const applied = applyCompany(current, mapped, touched.current, force)
    setForm({ ...applied.next, document: formatDocument(company.document || clean), cnpjSource: source, cnpjConsultedAt: consultedAt, partners })
    if (applied.conflicts.length) setPending({ company: mapped, conflicts: applied.conflicts })
    const missing = ["tradeName", "phone", "email"].filter((key) => !mapped[key]).length
    setLookup({ state: "ok", message: `Dados preenchidos pela Receita Federal${missing ? " — o que a API não trouxe continua editável" : ""}.` })
  }, [entity])

  // Consulta sozinha quando o CNPJ fica completo e válido.
  useEffect(() => {
    if (!form || !isLookupReady(form.personType, form.document)) return
    const clean = cleanDocument(form.document)
    if (clean === lastDocument.current) return
    lastDocument.current = clean
    void runLookup(clean)
  }, [form, runLookup])

  // CPF/CNPJ já cadastrado (mesmo sem consulta): checa duplicidade quando completo.
  useEffect(() => {
    if (!form || form.personType !== "PF" || cleanDocument(form.document).length !== 11) return
    void api<{ client: Found; supplier: Found }>(`/api/cadastros/verificar?document=${cleanDocument(form.document)}`).then(setExisting).catch(() => undefined)
  }, [form?.document, form?.personType]) // eslint-disable-line react-hooks/exhaustive-deps

  function fillFromId(parsed: ParsedIdDocument) {
    setForm((current) => {
      if (!current) return current
      const note = idDocumentNotes(parsed)
      for (const key of ["name", "document", "notes"]) touched.current.add(key)
      return {
        ...current, personType: "PF",
        name: parsed.name ? titleCase(parsed.name) : current.name,
        document: parsed.cpf || current.document,
        notes: String(current.notes || "").includes("Dados lidos do") ? current.notes : [String(current.notes || "").trim(), note].filter(Boolean).join("\n"),
      }
    })
  }

  const own = entity === "client" ? existing.client : existing.supplier
  const other = entity === "client" ? existing.supplier : existing.client
  const duplicate = Boolean(form && own && own.id !== form.id)
  const linkable = Boolean(form && other && !(form.partyId && other.partyId === form.partyId) && other.id !== linkFromId)

  function linkOther() {
    if (!form || !other) return
    const source = otherItems.find((row) => row.id === other.id)
    setLinkFromId(other.id)
    setForm((current) => {
      if (!current) return current
      const next: Item = { ...current, partyId: other.partyId || current.partyId }
      if (source) for (const field of fields.filter((item) => !item.only && !["code", "status"].includes(item.key))) if (!String(next[field.key] ?? "").trim() && source[field.key]) next[field.key] = source[field.key]
      return next
    })
    toast({ title: `Vinculado ao ${text.other}`, description: "Os dados em comum foram reaproveitados; complete os campos de " + text.singular + " e salve." })
  }

  async function save() {
    if (!form) return
    setSaving(true)
    try {
      await api(endpoint, { method: "POST", body: JSON.stringify({ item: form, linkFromId }) })
      toast({ title: `${text.singular[0].toUpperCase()}${text.singular.slice(1)} salvo` })
      setForm(null)
      await onReload()
    } catch (reason) {
      toast({ title: "Não foi possível salvar", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  async function promote(row: Item) {
    try {
      await api(endpoint, { method: "POST", body: JSON.stringify({ statusOnly: { id: row.id, status: "Ativo" } }) })
      toast({ title: "Lead virou cliente" })
      await onReload()
    } catch (reason) {
      toast({ title: "Não foi possível converter", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    }
  }

  async function toggle(row: Item) {
    try {
      await api(endpoint, { method: "POST", body: JSON.stringify({ statusOnly: { id: row.id, status: row.status === "Inativo" ? "Ativo" : "Inativo" } }) })
      await onReload()
    } catch (reason) {
      toast({ title: "Não foi possível alterar o status", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    }
  }

  const labelOf = (key: string) => fields.find((field) => field.key === key)?.label || key
  const lastQuery = form?.cnpjConsultedAt ? `${stamp(form.cnpjConsultedAt)} · ${form.cnpjSource || "consulta"}` : ""

  return (
    <SectionCard title={`Cadastro de ${text.plural.toLowerCase()}`} description={lead ? "Contatos que ainda não compraram. Quando uma venda é feita, o lead vira cliente sozinho." : "Busque, cadastre e acompanhe registros."}>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="relative max-w-sm flex-1"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Nome, CPF/CNPJ, telefone, cidade ou código" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        {lead ? null : <div className="min-w-[180px]"><SelectField label="Status" value={statusFilter} onChange={setStatusFilter} options={[{ value: "todos", label: "Todos" }, { value: "Ativo", label: "Ativos" }, { value: "Inativo", label: "Inativos" }, ...(entity === "client" ? [{ value: "Prospect", label: "Leads" }] : [])]} /></div>}
        <Button onClick={() => openForm()}><Plus className="h-4 w-4" />{lead ? "Novo lead" : "Novo"}</Button>
        <Button variant="outline" onClick={() => void onReload()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Atualizar</Button>
      </div>
      <DataTable headers={["Código", "Nome / Razão social", "CPF/CNPJ", "Telefone", "Cidade/UF", "Status", "Ações"]} empty={!shown.length}>
        {shown.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="font-mono text-xs">{row.code || "-"}</TableCell>
            <TableCell>{row.name}{row.tradeName ? <div className="text-xs text-muted-foreground">{row.tradeName}</div> : null}</TableCell>
            <TableCell>{row.document ? formatDocument(row.document) : "-"}</TableCell>
            <TableCell>{row.phone || "-"}</TableCell>
            <TableCell>{[row.city, row.state].filter(Boolean).join("/") || "-"}</TableCell>
            <TableCell><StatusBadge status={row.status === "Prospect" ? "Lead" : row.status} /></TableCell>
            <TableCell><div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setViewing(row)}><Eye className="h-4 w-4" />Ver</Button>
              <Button size="sm" variant="outline" onClick={() => openForm(row)}>Editar</Button>
              {lead ? <Button size="sm" variant="outline" onClick={() => void promote(row)}>Virar cliente</Button> : null}
              <Button size="sm" variant="outline" onClick={() => void toggle(row)}>{row.status === "Inativo" ? "Reativar" : "Inativar"}</Button>
            </div></TableCell>
          </TableRow>
        ))}
      </DataTable>

      <FormSheet open={Boolean(form)} onOpenChange={(open) => !open && setForm(null)} title={form?.id ? `Editar ${text.singular}` : `Novo ${text.singular}`} description="Ao informar um CNPJ válido, os dados da empresa são preenchidos automaticamente. Campos com * são obrigatórios no cadastro completo."
        footer={<SaveButton onClick={() => void save()} disabled={saving || duplicate}>{saving ? "Salvando..." : "Salvar"}</SaveButton>}>
        {form ? <>
          {lookup.state === "loading" ? <Banner tone="info"><Loader2 className="h-4 w-4 animate-spin" />{lookup.message}</Banner> : null}
          {lookup.state === "ok" ? <Banner tone="ok"><CheckCircle2 className="h-4 w-4" />{lookup.message}</Banner> : null}
          {lookup.state === "error" ? <Banner tone="error"><TriangleAlert className="h-4 w-4" />{lookup.message} Preencha manualmente ou tente novamente.</Banner> : null}
          {duplicate && own ? <Banner tone="error"><TriangleAlert className="h-4 w-4" />Este documento já está cadastrado como {text.singular}: {own.code} · {own.name}.
            <Button size="sm" variant="outline" onClick={() => { const row = items.find((item) => item.id === own.id); if (row) openForm(row) }}>Abrir cadastro</Button></Banner> : null}
          {linkable && other ? <Banner tone="warn"><Link2 className="h-4 w-4" />Este documento já é {text.other}: {other.code} · {other.name}. Para não duplicar a empresa, vincule-o como {text.singular}.
            <Button size="sm" onClick={linkOther}>Vincular como {text.singular}</Button></Banner> : null}
          {linkFromId && other ? <Banner tone="ok"><Link2 className="h-4 w-4" />Vinculado ao {text.other} {other.code} · {other.name}.</Banner> : null}
          {sectionOrder.map((section) => {
            const list = fields.filter((field) => field.section === section && !(section === "cnpj" && form.personType === "PF" && field.auto))
            if (!list.length) return null
            return (
              <div key={section} className="space-y-3">
                <h3 className="text-sm font-semibold">{sectionTitles[section]}</h3>
                {section === "ident" && form.personType === "PF" ? <IdDocumentCapture onRead={fillFromId} /> : null}
                {section === "ident" ? <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" disabled={!isLookupReady(form.personType, form.document) || lookup.state === "loading"} onClick={() => { lastDocument.current = cleanDocument(form.document); void runLookup(form.document) }}><RefreshCw className="h-4 w-4" />Consultar CNPJ novamente</Button>
                  {lastQuery ? <span className="text-xs text-muted-foreground">Última consulta: {lastQuery}</span> : null}
                </div> : null}
                <div className="grid gap-3 md:grid-cols-2">
                  {list.map((field) => <FieldInput key={field.key} entity={entity} field={field} form={form} options={options} onChange={change} />)}
                </div>
                {section === "cnpj" && Array.isArray(form.partners) && form.partners.length ? <div className="rounded-md border p-3 text-sm"><div className="mb-1 font-medium">Quadro societário</div>{form.partners.map((partner: any, index: number) => <div key={index} className="text-muted-foreground">{partner.name}{partner.role ? ` — ${partner.role}` : ""}</div>)}</div> : null}
              </div>
            )
          })}
        </> : null}
      </FormSheet>

      <Dialog open={Boolean(pending)} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Substituir dados alterados manualmente?</DialogTitle><DialogDescription>A consulta retornou valores diferentes dos que você digitou nestes campos:</DialogDescription></DialogHeader>
          <ul className="list-disc space-y-1 pl-5 text-sm">{pending?.conflicts.map((key) => <li key={key}><b>{labelOf(key)}</b>: você tem “{String(form?.[key] ?? "")}”, a Receita informa “{pending.company[key]}”</li>)}</ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>Manter os meus</Button>
            <Button onClick={() => { if (pending && form) { setForm(applyCompany(form, pending.company, touched.current, true).next) } setPending(null) }}>Substituir pelos da Receita</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FormSheet open={Boolean(viewing)} onOpenChange={(open) => !open && setViewing(null)} title={viewing ? `${viewing.code || ""} · ${viewing.name}` : ""} description={viewing ? `Cadastrado em ${stamp(viewing.createdAt) || "-"}${viewing.createdBy ? ` por ${viewing.createdBy}` : ""}${viewing.cnpjConsultedAt ? ` · última consulta de CNPJ: ${stamp(viewing.cnpjConsultedAt)} (${viewing.cnpjSource || "-"})` : ""}` : ""}
        footer={viewing ? <Button onClick={() => { const row = viewing; setViewing(null); openForm(row) }}>Editar</Button> : null}>
        {viewing ? sectionOrder.map((section) => {
          const rows = fields.filter((field) => field.section === section && field.key !== "code").map((field) => ({ field, value: valueLabel(entity, field, viewing, options) })).filter((row) => row.value)
          if (!rows.length) return null
          return <div key={section} className="space-y-2"><h3 className="text-sm font-semibold">{sectionTitles[section]}</h3>
            <dl className="grid gap-x-4 gap-y-2 text-sm md:grid-cols-2">{rows.map(({ field, value }) => <div key={field.key} className={field.type === "area" ? "md:col-span-2" : ""}><dt className="text-xs text-muted-foreground">{field.label}</dt><dd className="whitespace-pre-line">{value}</dd></div>)}</dl></div>
        }) : null}
      </FormSheet>
    </SectionCard>
  )
}

export function RegistryPage() {
  const { toast } = useCrudFeedback()
  const [clients, setClients] = useState<Item[]>([])
  const [suppliers, setSuppliers] = useState<Item[]>([])
  const [options, setOptions] = useState<Options>({ salespeople: [], paymentConditions: [], priceTables: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [c, s, o] = await Promise.all([api<{ items: Item[] }>("/api/cadastros/clientes"), api<{ items: Item[] }>("/api/cadastros/fornecedores"), api<Options>("/api/cadastros/opcoes").catch(() => null)])
      setClients(c.items)
      setSuppliers(s.items)
      if (o) setOptions(o)
      setError("")
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Erro ao carregar os cadastros."
      setError(message)
      toast({ title: "Cadastros indisponíveis", description: message, variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [load])
  // lead (Prospect) ainda não comprou: não é cliente. Vira cliente sozinho na primeira venda.
  const leads = useMemo(() => clients.filter((row) => row.status === "Prospect"), [clients])
  const realClients = useMemo(() => clients.filter((row) => row.status !== "Prospect"), [clients])

  return (
    <PageShell title="Clientes & Fornecedores" description="Leads (quem ainda não comprou), clientes e fornecedores, com preenchimento automático pelo CNPJ e, para pessoa física, pela foto do RG ou da CNH. O mesmo CNPJ pode ser cliente e fornecedor sem duplicar o cadastro.">
      {error ? <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
      <Tabs defaultValue="clientes">
        <TabsList><TabsTrigger value="leads">Leads ({leads.length})</TabsTrigger><TabsTrigger value="clientes">Clientes ({realClients.length})</TabsTrigger><TabsTrigger value="fornecedores">Fornecedores ({suppliers.length})</TabsTrigger></TabsList>
        <TabsContent value="leads"><RegistryTab entity="client" mode="lead" items={leads} otherItems={suppliers} options={options} loading={loading} onReload={load} /></TabsContent>
        <TabsContent value="clientes"><RegistryTab entity="client" items={realClients} otherItems={suppliers} options={options} loading={loading} onReload={load} /></TabsContent>
        <TabsContent value="fornecedores"><RegistryTab entity="supplier" items={suppliers} otherItems={clients} options={options} loading={loading} onReload={load} /></TabsContent>
      </Tabs>
    </PageShell>
  )
}
