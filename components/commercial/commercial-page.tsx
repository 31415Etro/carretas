"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertTriangle, BadgeDollarSign, Handshake, Plus, RefreshCw, Target, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TableCell, TableRow } from "@/components/ui/table"
import { OpportunityDocumentationProgress } from "@/components/documentation/documentation-progress"
import { DataTable, FormSheet, MetricCard, PageShell, SaveButton, SearchableSelectField, SectionCard, SelectField, StatusBadge, TextAreaField, TextField, useCrudFeedback } from "@/components/operations/shared"
import { brStates, cleanDocument, contactOverdue, conversionRate, formatDocument, funnelStages, funnelSummary, icmsIndicators, interactionKinds, isValidDocument, leadOrigins, openStages, partyKinds, stageProbability, type Party } from "@/lib/commercial"

type Row = Record<string, any>
type PartyRow = Party & { id: string; partyId: string; clientId: string; supplierId: string; pendencies: string[] }
type Opportunity = Row & { id: string; stage: string; estimatedValue: number; probability: number }
type Options = { paymentConditions: Array<{ id: string; name: string }>; products: Array<{ id: string; name: string; code: string }> }

const brl = (value: number) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const day = (value?: string) => (value ? String(value).slice(0, 10).split("-").reverse().join("/") : "-")
const stamp = (value?: string) => (value ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "-")
const today = () => new Date().toISOString().slice(0, 10)
const none = "nenhum"

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
  return payload as T
}

const emptyParty = (): Row => ({
  id: "", partyId: "", clientId: "", supplierId: "", kind: "cliente", personType: "PJ", name: "", tradeName: "", document: "", stateRegistration: "", municipalRegistration: "", icmsIndicator: "1",
  phone: "", email: "", zipCode: "", street: "", number: "", complement: "", district: "", city: "", state: "", contactName: "", contactRole: "", salespersonId: "", creditLimit: "",
  paymentConditionId: "", commercialNotes: "", status: "Ativo",
})
const emptyOpportunity = (): Row => ({ id: "", title: "", clientId: "", salespersonId: "", origin: "", interest: "", materialId: "", estimatedValue: "", stage: "Novo lead", probability: "10", expectedCloseDate: "", nextContactDate: "", lossReason: "", quoteNumber: "", reopenReason: "" })
const emptySalesperson = (): Row => ({ id: "", name: "", email: "", phone: "", status: "Ativo", notes: "" })

function Opts({ label, value, onChange, items, placeholder = "Selecione" }: { label: string; value: string; onChange: (value: string) => void; items: Array<{ value: string; label: string }>; placeholder?: string }) {
  return <SelectField label={label} value={value || none} onChange={(next) => onChange(next === none ? "" : next)} options={[{ value: none, label: placeholder }, ...items]} />
}

export function CommercialPage() {
  const { toast } = useCrudFeedback()
  const router = useRouter()
  const [parties, setParties] = useState<PartyRow[]>([])
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])
  const [salespeople, setSalespeople] = useState<Row[]>([])
  const [options, setOptions] = useState<Options>({ paymentConditions: [], products: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState("")
  const [kindFilter, setKindFilter] = useState("todos")
  const [salesFilter, setSalesFilter] = useState("")
  const [partySheet, setPartySheet] = useState<Row | null>(null)
  const [partyHistory, setPartyHistory] = useState<Row | null>(null)
  const [onPartySaved, setOnPartySaved] = useState<((party: PartyRow) => void) | null>(null)
  const [oppSheet, setOppSheet] = useState<Row | null>(null)
  const [oppOriginalStage, setOppOriginalStage] = useState("")
  const [oppDetail, setOppDetail] = useState<{ interactions: Row[]; orders: Row[] }>({ interactions: [], orders: [] })
  const [interaction, setInteraction] = useState({ kind: "Ligação", description: "", nextContactDate: "" })
  const [peopleSheet, setPeopleSheet] = useState<Row | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [partiesResult, opportunitiesResult, peopleResult, optionsResult] = await Promise.all([
        api<{ parties: PartyRow[] }>("/api/comercial/parties"),
        api<{ opportunities: Opportunity[] }>("/api/comercial/opportunities"),
        api<{ salespeople: Row[] }>("/api/comercial/salespeople"),
        api<Options>("/api/comercial/options"),
      ])
      setParties(partiesResult.parties)
      setOpportunities(opportunitiesResult.opportunities)
      setSalespeople(peopleResult.salespeople)
      setOptions(optionsResult)
      setError("")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao carregar o módulo Comercial.")
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const salesItems = salespeople.filter((row) => row.status === "Ativo").map((row) => ({ value: row.id, label: row.name }))
  const clientItems = parties.filter((row) => row.clientId && row.status !== "Inativo").map((row) => ({ value: row.clientId, label: `${row.name}${row.status === "Prospect" ? " (lead)" : ""}${row.document ? ` · ${row.document}` : ""}` }))
  const salesName = (id?: string) => salespeople.find((row) => row.id === id)?.name || "-"

  // ---------- cadastros
  const text = query.trim().toLowerCase()
  const digits = query.replace(/\D/g, "")
  const shownParties = parties.filter((row) => {
    if (kindFilter !== "todos" && row.kind !== kindFilter && !(row.kind === "ambos" && ["cliente", "fornecedor"].includes(kindFilter))) return false
    if (!text) return true
    return [row.name, row.tradeName, row.city, row.contactName, row.email].some((value) => String(value || "").toLowerCase().includes(text)) || (digits.length >= 3 && cleanDocument(row.document).includes(digits)) || String(row.phone).replace(/\D/g, "").includes(digits || "§")
  })

  async function openParty(party: Row, after?: (saved: PartyRow) => void) {
    setPartySheet(party)
    setOnPartySaved(after ? () => after : null)
    setPartyHistory(null)
    if (party.id) {
      try { setPartyHistory(await api<Row>(`/api/comercial/parties/history?clientId=${party.clientId || ""}&supplierId=${party.supplierId || ""}`)) } catch { setPartyHistory(null) }
    }
  }

  async function saveParty() {
    if (!partySheet) return
    setSaving(true)
    try {
      const { party } = await api<{ party: PartyRow }>("/api/comercial/parties", { method: "POST", body: JSON.stringify({ party: { ...partySheet, creditLimit: Number(partySheet.creditLimit) || 0 } }) })
      toast({ title: "Cadastro salvo" })
      setPartySheet(null)
      await load()
      onPartySaved?.(party)
    } catch (reason) {
      toast({ title: "Não foi possível salvar", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  /** Preenche razão social, endereço e contato a partir do CNPJ (consulta pública). */
  async function lookupCnpj() {
    if (!partySheet) return
    const document = cleanDocument(partySheet.document)
    if (document.length !== 14) return toast({ title: "CNPJ incompleto", description: "Informe os 14 caracteres do CNPJ.", variant: "destructive" })
    try {
      const { company } = await api<{ company: Row }>(`/api/cnpj/${encodeURIComponent(document)}`)
      setPartySheet((current) => current && {
        ...current, personType: "PJ", document: company.document || current.document, name: company.legalName || current.name, tradeName: company.tradeName || current.tradeName,
        phone: company.phone || current.phone, email: company.email || current.email, zipCode: company.zipCode || current.zipCode, street: company.street || current.street,
        number: company.number || current.number, complement: company.complement || current.complement, district: company.district || current.district, city: company.city || current.city, state: company.state || current.state,
      })
      toast({ title: "CNPJ encontrado", description: "Dados preenchidos; confira e complete a Inscrição Estadual." })
    } catch (reason) {
      toast({ title: "Não foi possível consultar o CNPJ", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    }
  }

  async function inactivateParty(row: PartyRow) {
    try {
      await api("/api/comercial/parties", { method: "POST", body: JSON.stringify({ party: { ...row, status: "Inativo" } }) })
      await load()
    } catch (reason) {
      toast({ title: "Não foi possível inativar", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    }
  }

  // ---------- oportunidades
  async function openOpportunity(item: Row) {
    setOppSheet(item)
    setOppOriginalStage(item.id ? item.stage : "")
    setOppDetail({ interactions: [], orders: [] })
    setInteraction({ kind: "Ligação", description: "", nextContactDate: "" })
    if (item.id) {
      try { setOppDetail(await api(`/api/comercial/opportunities/${item.id}`)) } catch { /* histórico é opcional */ }
    }
  }

  async function saveOpportunity(patch: Row = {}, closeAfter = true) {
    const item = { ...oppSheet, ...patch }
    setSaving(true)
    try {
      const { opportunity } = await api<{ opportunity: Opportunity }>("/api/comercial/opportunities", { method: "POST", body: JSON.stringify({ opportunity: { ...item, estimatedValue: Number(item.estimatedValue) || 0 } }) })
      toast({ title: "Oportunidade salva" })
      await load()
      if (closeAfter) setOppSheet(null)
      return opportunity
    } catch (reason) {
      toast({ title: "Não foi possível salvar", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
      return null
    } finally {
      setSaving(false)
    }
  }

  async function moveStage(item: Opportunity, stage: string) {
    if (stage === "Perdido") return openOpportunity({ ...emptyOpportunity(), ...item, estimatedValue: item.estimatedValue, stage, probability: String(stageProbability.Perdido), reopenReason: "" })
    setSaving(true)
    try {
      await api("/api/comercial/opportunities", { method: "POST", body: JSON.stringify({ opportunity: { ...item, stage, probability: stageProbability[stage as keyof typeof stageProbability], reopenReason: "" } }) })
      await load()
    } catch (reason) {
      toast({ title: "Etapa não alterada", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  async function addInteraction() {
    if (!oppSheet?.id) return
    try {
      setOppDetail(await api(`/api/comercial/opportunities/${oppSheet.id}`, { method: "POST", body: JSON.stringify({ interaction }) }))
      if (interaction.nextContactDate) setOppSheet({ ...oppSheet, nextContactDate: interaction.nextContactDate })
      setInteraction({ kind: "Ligação", description: "", nextContactDate: "" })
      await load()
    } catch (reason) {
      toast({ title: "Interação não registrada", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    }
  }

  async function generateQuote() {
    if (!oppSheet?.id) return
    if (oppSheet.stage === "Novo lead" || oppSheet.stage === "Contato realizado" || oppSheet.stage === "Qualificação") {
      const saved = await saveOpportunity({ stage: "Orçamento", probability: String(stageProbability.Orçamento) }, false)
      if (!saved) return
    }
    router.push(`/orcamento?opportunityId=${oppSheet.id}&clientId=${oppSheet.clientId}`)
  }

  async function saveSalesperson() {
    if (!peopleSheet) return
    setSaving(true)
    try {
      await api("/api/comercial/salespeople", { method: "POST", body: JSON.stringify({ salesperson: peopleSheet }) })
      setPeopleSheet(null)
      await load()
    } catch (reason) {
      toast({ title: "Não foi possível salvar", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const filteredOpps = opportunities.filter((row) => !salesFilter || row.salespersonId === salesFilter)
  const open = filteredOpps.filter((row) => (openStages as string[]).includes(row.stage))
  const summary = funnelSummary(filteredOpps)
  const pipelineValue = open.reduce((sum, row) => sum + row.estimatedValue, 0)
  const weighted = summary.filter((item) => (openStages as string[]).includes(item.stage)).reduce((sum, item) => sum + item.weighted, 0)
  const wonValue = filteredOpps.filter((row) => row.stage === "Ganho").reduce((sum, row) => sum + row.estimatedValue, 0)
  const lateContacts = open.filter((row) => contactOverdue(row, today())).length
  const conversion = conversionRate(filteredOpps)
  const editingPartyDocValid = partySheet && cleanDocument(partySheet.document) ? isValidDocument(partySheet.personType, partySheet.document) : null
  const selectedParty = useMemo(() => parties.find((row) => row.clientId === oppSheet?.clientId), [parties, oppSheet?.clientId])
  const oppFinal = oppSheet && ["Ganho", "Perdido"].includes(oppOriginalStage)

  return (
    <PageShell
      title="Comercial"
      description="Cadastro único de clientes e fornecedores, vendedores e funil de oportunidades."
      actions={<><Button onClick={() => void openOpportunity(emptyOpportunity())}><Plus className="h-4 w-4" />Nova oportunidade</Button><Button variant="outline" onClick={() => void openParty(emptyParty())}><Plus className="h-4 w-4" />Novo cadastro</Button><Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="h-4 w-4" />Atualizar</Button></>}
    >
      {error && <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <MetricCard title="Funil em aberto" value={brl(pipelineValue)} note={`${open.length} negociação(ões) · ponderado ${brl(weighted)}`} icon={Target} />
        <MetricCard title="Vendas ganhas" value={brl(wonValue)} note={conversion == null ? "Sem negociações encerradas" : `Conversão de ${conversion.toLocaleString("pt-BR")}%`} icon={BadgeDollarSign} />
        <MetricCard title="Contatos atrasados" value={lateContacts} note="Negociações abertas com próximo contato vencido" icon={AlertTriangle} />
        <MetricCard title="Cadastros ativos" value={parties.filter((row) => row.status !== "Inativo").length} note={`${parties.filter((row) => row.status === "Prospect").length} lead(s)`} icon={Users} />
      </div>

      <Tabs defaultValue="funil">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="funil">Funil</TabsTrigger>
          <TabsTrigger value="oportunidades">Oportunidades</TabsTrigger>
          <TabsTrigger value="cadastros">Clientes e fornecedores</TabsTrigger>
          <TabsTrigger value="vendedores">Vendedores</TabsTrigger>
        </TabsList>

        <TabsContent value="funil">
          <div className="mb-3 max-w-xs"><Opts label="Vendedor" value={salesFilter} onChange={setSalesFilter} items={salespeople.map((row) => ({ value: row.id, label: row.name }))} placeholder="Todos" /></div>
          <div className="grid gap-3 lg:grid-cols-4 xl:grid-cols-7">
            {funnelStages.map((stage) => {
              const info = summary.find((item) => item.stage === stage)!
              return (
                <div key={stage} className="rounded-md border bg-muted/30 p-2">
                  <div className="mb-2"><div className="text-sm font-medium">{stage}</div><div className="text-xs text-muted-foreground">{info.count} · {brl(info.value)}</div></div>
                  <div className="space-y-2">
                    {filteredOpps.filter((row) => row.stage === stage).map((row) => (
                      <div key={row.id} className="rounded-md border bg-card p-2 text-sm">
                        <button className="text-left font-medium hover:underline" onClick={() => void openOpportunity({ ...emptyOpportunity(), ...row, estimatedValue: String(row.estimatedValue), probability: String(row.probability) })}>{row.title}</button>
                        <div className="text-xs text-muted-foreground">{row.clientName}</div>
                        <div className="text-xs">{brl(row.estimatedValue)} · {row.probability}%</div>
                        <div className={`text-xs ${contactOverdue(row, today()) ? "font-medium text-destructive" : "text-muted-foreground"}`}>{row.nextContactDate ? `Contato: ${day(row.nextContactDate)}` : row.salespersonName}</div>
                        {(openStages as string[]).includes(stage) && (
                          <select className="mt-1 w-full rounded border bg-background text-xs" value="" disabled={saving} onChange={(event) => event.target.value && void moveStage(row, event.target.value)}>
                            <option value="">Mover para...</option>
                            {funnelStages.filter((item) => item !== stage).map((item) => <option key={item} value={item}>{item}</option>)}
                          </select>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </TabsContent>

        <TabsContent value="oportunidades">
          <SectionCard title="Oportunidades">
            <DataTable headers={["Código", "Título", "Cliente / lead", "Vendedor", "Interesse", "Valor", "Etapa", "Prob.", "Fechamento", "Próx. contato", "Orçamento", "Ações"]} empty={!filteredOpps.length}>
              {filteredOpps.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.code}</TableCell><TableCell>{row.title}</TableCell><TableCell>{row.clientName}</TableCell><TableCell>{row.salespersonName}</TableCell>
                  <TableCell className="max-w-[14rem] truncate" title={row.interest}>{row.interest}</TableCell><TableCell>{brl(row.estimatedValue)}</TableCell>
                  <TableCell><StatusBadge status={row.stage} /></TableCell><TableCell>{row.probability}%</TableCell><TableCell>{day(row.expectedCloseDate)}</TableCell>
                  <TableCell className={contactOverdue(row, today()) ? "font-medium text-destructive" : ""}>{day(row.nextContactDate)}</TableCell><TableCell>{row.quoteNumber || "-"}</TableCell>
                  <TableCell><Button size="sm" variant="outline" onClick={() => void openOpportunity({ ...emptyOpportunity(), ...row, estimatedValue: String(row.estimatedValue), probability: String(row.probability) })}>Abrir</Button></TableCell>
                </TableRow>
              ))}
            </DataTable>
          </SectionCard>
        </TabsContent>

        <TabsContent value="cadastros">
          <SectionCard title="Clientes e fornecedores" description="Um cadastro só para Comercial, Financeiro, Compras, Orçamentos e OS. O CPF/CNPJ não se repete; lead pode ficar sem documento.">
            <div className="mb-3 grid gap-3 md:grid-cols-3">
              <TextField label="Buscar" placeholder="Nome, CPF/CNPJ, telefone, cidade ou contato" value={query} onChange={setQuery} />
              <Opts label="Tipo" value={kindFilter === "todos" ? "" : kindFilter} onChange={(value) => setKindFilter(value || "todos")} items={partyKinds.map((item) => ({ value: item.value, label: item.label }))} placeholder="Todos" />
            </div>
            <DataTable headers={["Nome / razão social", "Tipo", "CPF/CNPJ", "Telefone", "Cidade/UF", "Vendedor", "Situação", "Fiscal", "Ações"]} empty={!shownParties.length}>
              {shownParties.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.name}{row.tradeName ? <div className="text-xs text-muted-foreground">{row.tradeName}</div> : null}</TableCell>
                  <TableCell>{partyKinds.find((item) => item.value === row.kind)?.label}</TableCell>
                  <TableCell>{row.document ? formatDocument(row.document) : "-"}</TableCell><TableCell>{row.phone}</TableCell>
                  <TableCell>{[row.city, row.state].filter(Boolean).join("/") || "-"}</TableCell><TableCell>{salesName(row.salespersonId)}</TableCell>
                  <TableCell><StatusBadge status={row.status === "Prospect" ? "Lead" : row.status} /></TableCell>
                  <TableCell>{row.pendencies.length ? <span className="text-xs text-amber-600" title={row.pendencies.join(", ")}>Faltam: {row.pendencies.slice(0, 2).join(", ")}{row.pendencies.length > 2 ? "…" : ""}</span> : <span className="text-xs text-green-600">Completo</span>}</TableCell>
                  <TableCell><div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => void openParty({ ...emptyParty(), ...row, creditLimit: row.creditLimit ? String(row.creditLimit) : "" })}>Editar</Button>
                    {row.status !== "Inativo" && <Button size="sm" variant="outline" onClick={() => void inactivateParty(row)}>Inativar</Button>}
                  </div></TableCell>
                </TableRow>
              ))}
            </DataTable>
          </SectionCard>
        </TabsContent>

        <TabsContent value="vendedores">
          <SectionCard title="Vendedores" description="Responsáveis por clientes e oportunidades.">
            <Button className="mb-3" onClick={() => setPeopleSheet(emptySalesperson())}><Plus className="h-4 w-4" />Novo vendedor</Button>
            <DataTable headers={["Nome", "E-mail", "Telefone", "Negociações abertas", "Ganhas", "Status", "Ações"]} empty={!salespeople.length}>
              {salespeople.map((row) => {
                const mine = opportunities.filter((item) => item.salespersonId === row.id)
                return (
                  <TableRow key={row.id}>
                    <TableCell>{row.name}</TableCell><TableCell>{row.email || "-"}</TableCell><TableCell>{row.phone || "-"}</TableCell>
                    <TableCell>{mine.filter((item) => (openStages as string[]).includes(item.stage)).length}</TableCell><TableCell>{brl(mine.filter((item) => item.stage === "Ganho").reduce((sum, item) => sum + item.estimatedValue, 0))}</TableCell>
                    <TableCell><StatusBadge status={row.status} /></TableCell>
                    <TableCell><Button size="sm" variant="outline" onClick={() => setPeopleSheet({ ...row })}>Editar</Button></TableCell>
                  </TableRow>
                )
              })}
            </DataTable>
          </SectionCard>
        </TabsContent>
      </Tabs>

      <FormSheet open={Boolean(partySheet)} onOpenChange={(value) => !value && setPartySheet(null)} title={partySheet?.id ? "Editar cadastro" : "Novo cadastro"} description="Telefone, tipo e nome são obrigatórios. CPF/CNPJ pode ficar em branco apenas para lead." footer={<SaveButton onClick={() => void saveParty()} disabled={saving}>Salvar</SaveButton>}>
        {partySheet && (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <Opts label="Tipo *" value={partySheet.kind} onChange={(value) => setPartySheet({ ...partySheet, kind: value || "cliente", status: value && value !== "cliente" && partySheet.status === "Prospect" ? "Ativo" : partySheet.status })} items={partyKinds.map((item) => ({ value: item.value, label: item.label }))} />
              <Opts label="Pessoa *" value={partySheet.personType} onChange={(value) => setPartySheet({ ...partySheet, personType: value || "PJ", icmsIndicator: value === "PF" ? "9" : partySheet.icmsIndicator })} items={[{ value: "PJ", label: "Jurídica" }, { value: "PF", label: "Física" }]} />
              <TextField label={partySheet.personType === "PF" ? "Nome completo *" : "Razão social *"} value={partySheet.name} onChange={(value) => setPartySheet({ ...partySheet, name: value })} />
              <TextField label="Nome fantasia" value={partySheet.tradeName} onChange={(value) => setPartySheet({ ...partySheet, tradeName: value })} />
              <div>
                <TextField label={partySheet.personType === "PF" ? "CPF" : "CNPJ"} value={partySheet.document} onChange={(value) => setPartySheet({ ...partySheet, document: value })} />
                {editingPartyDocValid === false && <p className="mt-1 text-xs text-destructive">Documento inválido.</p>}
                {partySheet.personType === "PJ" && <button type="button" className="mt-1 text-xs text-primary underline" onClick={() => void lookupCnpj()}>Buscar dados pelo CNPJ</button>}
              </div>
              <Opts label="Status *" value={partySheet.status} onChange={(value) => setPartySheet({ ...partySheet, status: value || "Ativo" })} items={[{ value: "Ativo", label: "Ativo" }, { value: "Inativo", label: "Inativo" }, ...(partySheet.kind === "cliente" ? [{ value: "Prospect", label: "Lead (prospect)" }] : [])]} />
              <TextField label="Telefone / WhatsApp *" value={partySheet.phone} onChange={(value) => setPartySheet({ ...partySheet, phone: value })} />
              <TextField label="E-mail" value={partySheet.email} onChange={(value) => setPartySheet({ ...partySheet, email: value })} />
              <Opts label="Indicador de contribuinte ICMS" value={partySheet.icmsIndicator} onChange={(value) => setPartySheet({ ...partySheet, icmsIndicator: value || "9" })} items={icmsIndicators.map((item) => ({ value: item.value, label: item.label }))} />
              <TextField label="Inscrição Estadual" value={partySheet.stateRegistration} onChange={(value) => setPartySheet({ ...partySheet, stateRegistration: value })} />
              <TextField label="Inscrição Municipal" value={partySheet.municipalRegistration} onChange={(value) => setPartySheet({ ...partySheet, municipalRegistration: value })} />
              <TextField label="CEP" value={partySheet.zipCode} onChange={(value) => setPartySheet({ ...partySheet, zipCode: value })} />
              <TextField label="Logradouro" value={partySheet.street} onChange={(value) => setPartySheet({ ...partySheet, street: value })} />
              <TextField label="Número" value={partySheet.number} onChange={(value) => setPartySheet({ ...partySheet, number: value })} />
              <TextField label="Complemento" value={partySheet.complement} onChange={(value) => setPartySheet({ ...partySheet, complement: value })} />
              <TextField label="Bairro" value={partySheet.district} onChange={(value) => setPartySheet({ ...partySheet, district: value })} />
              <TextField label="Cidade" value={partySheet.city} onChange={(value) => setPartySheet({ ...partySheet, city: value })} />
              <Opts label="UF" value={partySheet.state} onChange={(value) => setPartySheet({ ...partySheet, state: value })} items={brStates.map((value) => ({ value, label: value }))} />
              <TextField label="Contato principal" value={partySheet.contactName} onChange={(value) => setPartySheet({ ...partySheet, contactName: value })} />
              <TextField label="Cargo do contato" value={partySheet.contactRole} onChange={(value) => setPartySheet({ ...partySheet, contactRole: value })} />
              {partySheet.kind !== "fornecedor" && <Opts label="Vendedor responsável" value={partySheet.salespersonId} onChange={(value) => setPartySheet({ ...partySheet, salespersonId: value })} items={salesItems} />}
              {partySheet.kind !== "fornecedor" && <TextField label="Limite de crédito" type="number" value={partySheet.creditLimit} onChange={(value) => setPartySheet({ ...partySheet, creditLimit: value })} />}
              <Opts label="Condição de pagamento padrão" value={partySheet.paymentConditionId} onChange={(value) => setPartySheet({ ...partySheet, paymentConditionId: value })} items={options.paymentConditions.map((item) => ({ value: item.id, label: item.name }))} />
            </div>
            <TextAreaField label="Observações comerciais" value={partySheet.commercialNotes} onChange={(value) => setPartySheet({ ...partySheet, commercialNotes: value })} />
            {partySheet.id && (
              <div className="space-y-3">
                {(() => {
                  const pending = parties.find((row) => row.id === partySheet.id)?.pendencies || []
                  return pending.length ? <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm">Para emitir nota fiscal faltam: {pending.join(", ")}.</p> : null
                })()}
                <h3 className="text-sm font-medium">Histórico</h3>
                {!partyHistory ? <p className="text-sm text-muted-foreground">Carregando...</p> : (
                  <div className="space-y-3 text-sm">
                    {partySheet.clientId && <p>Contas a receber em aberto: <strong>{brl(partyHistory.openReceivables)}</strong>{Number(partySheet.creditLimit) > 0 ? ` de ${brl(Number(partySheet.creditLimit))} de limite` : ""}{Number(partySheet.creditLimit) > 0 && partyHistory.openReceivables > Number(partySheet.creditLimit) ? " — limite excedido" : ""}.</p>}
                    {partyHistory.opportunities.length > 0 && <div><div className="font-medium">Oportunidades</div>{partyHistory.opportunities.map((item: Row) => <div key={item.id}>{item.code} · {item.title} · {item.stage} · {brl(item.value)}</div>)}</div>}
                    {partyHistory.orders.length > 0 && <div><div className="font-medium">Ordens de serviço</div>{partyHistory.orders.map((item: Row) => <div key={item.id}><Link className="text-primary underline" href={`/ordens-servico/${item.id}`}>{item.number}</Link> · {item.kind} · {item.status} · {brl(item.total)}</div>)}</div>}
                    {partyHistory.receivables.length > 0 && <div><div className="font-medium">Contas a receber</div>{partyHistory.receivables.slice(0, 10).map((item: Row) => <div key={item.id}>{day(item.dueDate)} · {item.description} · {brl(item.amount)} · {item.status}</div>)}</div>}
                    {partyHistory.purchases.length > 0 && <div><div className="font-medium">Pedidos de compra</div>{partyHistory.purchases.map((item: Row) => <div key={item.id}>{item.number} · {day(item.date)} · {item.status} · {brl(item.total)}</div>)}</div>}
                    {!partyHistory.opportunities.length && !partyHistory.orders.length && !partyHistory.receivables.length && !partyHistory.purchases.length && <p className="text-muted-foreground">Sem movimentação.</p>}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </FormSheet>

      <FormSheet open={Boolean(oppSheet)} onOpenChange={(value) => !value && setOppSheet(null)} title={oppSheet?.id ? `${oppSheet.code || "Oportunidade"} · ${oppSheet.title}` : "Nova oportunidade"} description={oppFinal ? (oppOriginalStage === "Ganho" ? "Negociação ganha: somente consulta." : "Negociação perdida: para reabrir, mude a etapa e informe o motivo.") : undefined}
        footer={<SaveButton onClick={() => void saveOpportunity()} disabled={saving || oppOriginalStage === "Ganho"}>Salvar</SaveButton>}>
        {oppSheet && (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <TextField label="Título da negociação *" value={oppSheet.title} onChange={(value) => setOppSheet({ ...oppSheet, title: value })} />
              <div>
                <SearchableSelectField label="Cliente / lead *" value={oppSheet.clientId || none} onChange={(value) => setOppSheet({ ...oppSheet, clientId: value === none ? "" : value })} options={[{ value: none, label: "Selecione" }, ...clientItems]} />
                <button type="button" className="mt-1 text-xs text-primary underline" onClick={() => void openParty({ ...emptyParty(), status: "Prospect", icmsIndicator: "9" }, (saved) => setOppSheet((current) => current && { ...current, clientId: saved.clientId })) }>Cadastrar novo lead</button>
              </div>
              <Opts label="Vendedor responsável *" value={oppSheet.salespersonId} onChange={(value) => setOppSheet({ ...oppSheet, salespersonId: value })} items={salesItems} />
              <Opts label="Origem" value={oppSheet.origin} onChange={(value) => setOppSheet({ ...oppSheet, origin: value })} items={leadOrigins.map((value) => ({ value, label: value }))} />
              <SearchableSelectField label="Produto do catálogo (opcional)" value={oppSheet.materialId || none} onChange={(value) => setOppSheet({ ...oppSheet, materialId: value === none ? "" : value, interest: value !== none && !oppSheet.interest ? options.products.find((item) => item.id === value)?.name || "" : oppSheet.interest })} options={[{ value: none, label: "Nenhum" }, ...options.products.map((item) => ({ value: item.id, label: `${item.code ? `${item.code} · ` : ""}${item.name}` }))]} />
              <TextField label="Produto / serviço de interesse *" value={oppSheet.interest} onChange={(value) => setOppSheet({ ...oppSheet, interest: value })} />
              <TextField label="Valor estimado" type="number" value={oppSheet.estimatedValue} onChange={(value) => setOppSheet({ ...oppSheet, estimatedValue: value })} />
              <Opts label="Etapa do funil *" value={oppSheet.stage} onChange={(value) => setOppSheet({ ...oppSheet, stage: value || "Novo lead", probability: String(stageProbability[(value || "Novo lead") as keyof typeof stageProbability]) })} items={funnelStages.map((value) => ({ value, label: value }))} />
              <TextField label="Probabilidade de fechamento (%)" type="number" value={oppSheet.probability} onChange={(value) => setOppSheet({ ...oppSheet, probability: value })} />
              <TextField label="Previsão de fechamento" type="date" value={oppSheet.expectedCloseDate} onChange={(value) => setOppSheet({ ...oppSheet, expectedCloseDate: value })} />
              <TextField label="Próximo contato" type="date" value={oppSheet.nextContactDate} onChange={(value) => setOppSheet({ ...oppSheet, nextContactDate: value })} />
              <TextField label="Orçamento associado (nº)" value={oppSheet.quoteNumber} onChange={(value) => setOppSheet({ ...oppSheet, quoteNumber: value })} />
            </div>
            {oppSheet.stage === "Perdido" && <TextAreaField label="Motivo da perda *" value={oppSheet.lossReason} onChange={(value) => setOppSheet({ ...oppSheet, lossReason: value })} />}
            {oppOriginalStage === "Perdido" && oppSheet.stage !== "Perdido" && <TextAreaField label="Motivo da reabertura *" value={oppSheet.reopenReason} onChange={(value) => setOppSheet({ ...oppSheet, reopenReason: value })} />}
            {selectedParty && selectedParty.status === "Prospect" && oppSheet.stage === "Ganho" && selectedParty.pendencies.length > 0 && <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm">Este lead precisa de cadastro completo para ser ganho: faltam {selectedParty.pendencies.join(", ")}.</p>}
            {oppSheet.id && (
              <div className="flex flex-wrap gap-2">
                {oppOriginalStage !== "Ganho" && oppOriginalStage !== "Perdido" && <Button variant="outline" onClick={() => void generateQuote()} disabled={saving}><Handshake className="h-4 w-4" />Gerar orçamento</Button>}
                {oppOriginalStage === "Ganho" && <Button asChild><Link href={`/ordens-servico/nova?clientId=${oppSheet.clientId}&opportunityId=${oppSheet.id}&description=${encodeURIComponent(oppSheet.interest || "")}`}>Abrir OS</Link></Button>}
              </div>
            )}
            {oppSheet.id && <OpportunityDocumentationProgress opportunityId={oppSheet.id} />}
            {oppSheet.id && (
              <div className="space-y-3">
                <h3 className="text-sm font-medium">Histórico de interações</h3>
                {oppDetail.orders.length > 0 && <p className="text-sm">OS abertas: {oppDetail.orders.map((order) => <Link key={order.id} className="mr-2 text-primary underline" href={`/ordens-servico/${order.id}`}>{order.number} ({order.status})</Link>)}</p>}
                {oppOriginalStage !== "Ganho" && oppOriginalStage !== "Perdido" && (
                  <div className="grid gap-2 md:grid-cols-3">
                    <Opts label="Tipo" value={interaction.kind} onChange={(value) => setInteraction({ ...interaction, kind: value || "Observação" })} items={interactionKinds.map((value) => ({ value, label: value }))} />
                    <TextField label="Próximo contato" type="date" value={interaction.nextContactDate} onChange={(value) => setInteraction({ ...interaction, nextContactDate: value })} />
                    <div className="md:col-span-3"><TextAreaField label="O que foi conversado" rows={2} value={interaction.description} onChange={(value) => setInteraction({ ...interaction, description: value })} /></div>
                    <Button variant="outline" onClick={() => void addInteraction()}>Registrar interação</Button>
                  </div>
                )}
                <div className="space-y-2 text-sm">
                  {oppDetail.interactions.map((item) => (
                    <div key={item.id} className="rounded-md border p-2">
                      <div className="text-xs text-muted-foreground">{stamp(item.at)} · {item.kind}{item.automatic ? " (automático)" : ""} · {item.author}</div>
                      <div>{item.description}</div>
                    </div>
                  ))}
                  {!oppDetail.interactions.length && <p className="text-muted-foreground">Sem interações.</p>}
                </div>
              </div>
            )}
          </>
        )}
      </FormSheet>

      <FormSheet open={Boolean(peopleSheet)} onOpenChange={(value) => !value && setPeopleSheet(null)} title={peopleSheet?.id ? "Editar vendedor" : "Novo vendedor"} footer={<SaveButton onClick={() => void saveSalesperson()} disabled={saving}>Salvar</SaveButton>}>
        {peopleSheet && (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <TextField label="Nome *" value={peopleSheet.name} onChange={(value) => setPeopleSheet({ ...peopleSheet, name: value })} />
              <Opts label="Status" value={peopleSheet.status} onChange={(value) => setPeopleSheet({ ...peopleSheet, status: value || "Ativo" })} items={["Ativo", "Inativo"].map((value) => ({ value, label: value }))} />
              <TextField label="E-mail" value={peopleSheet.email} onChange={(value) => setPeopleSheet({ ...peopleSheet, email: value })} />
              <TextField label="Telefone" value={peopleSheet.phone} onChange={(value) => setPeopleSheet({ ...peopleSheet, phone: value })} />
            </div>
            <TextAreaField label="Observações" value={peopleSheet.notes} onChange={(value) => setPeopleSheet({ ...peopleSheet, notes: value })} />
          </>
        )}
      </FormSheet>
    </PageShell>
  )
}
