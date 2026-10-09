"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { BarChart3, Flame, Plus, Search, Target, Users } from "lucide-react"
import { MetricCard } from "@/components/operations/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

type BantStage = "prospeccao" | "contato" | "qualificacao" | "proposta" | "negociacao" | "ganho" | "perdido"

type BantLead = {
  id: string
  name: string
  company?: string
  email?: string
  phone?: string
  location?: string
  source?: string
  estimated_value?: number
  bant_budget?: number
  bant_authority?: number
  bant_need?: number
  bant_timeline?: number
  bant_stage?: BantStage
  bant_notes?: string
}

const stages: Array<{ id: BantStage; label: string; accent: string }> = [
  { id: "prospeccao", label: "Prospeccao", accent: "border-t-slate-400" },
  { id: "contato", label: "Contato realizado", accent: "border-t-sky-500" },
  { id: "qualificacao", label: "Qualificacao BANT", accent: "border-t-amber-500" },
  { id: "proposta", label: "Proposta", accent: "border-t-violet-500" },
  { id: "negociacao", label: "Negociacao", accent: "border-t-orange-500" },
  { id: "ganho", label: "Ganho", accent: "border-t-emerald-500" },
  { id: "perdido", label: "Perdido", accent: "border-t-rose-500" },
]

const scoreOptions = {
  budget: ["Nao avaliado", "Nao tem verba", "Tem interesse", "Tem verba, nao aprovada", "Verba em aprovacao", "Verba autorizada"],
  authority: ["Nao avaliado", "Nao sabe quem decide", "Sabe quem autoriza", "Influencia a decisao", "Aprova em conjunto", "Aprova sozinho"],
  need: ["Nao avaliado", "Nao tem necessidade", "Tem interesse", "Necessidade identificada", "Tem necessidade", "Necessidade aprovada"],
  timeline: ["Nao avaliado", "Nao sabe o prazo", "Acima de 3 meses", "Ate 2 meses", "Ate 1 mes", "Imediato"],
}

function leadScore(lead: BantLead) {
  return Number(lead.bant_budget || 0) + Number(lead.bant_authority || 0) + Number(lead.bant_need || 0) + Number(lead.bant_timeline || 0)
}

function classification(score: number) {
  if (score >= 16) return { label: "Alto", className: "border-emerald-200 bg-emerald-50 text-emerald-700" }
  if (score >= 11) return { label: "Medio", className: "border-amber-200 bg-amber-50 text-amber-700" }
  if (score >= 6) return { label: "Baixo", className: "border-sky-200 bg-sky-50 text-sky-700" }
  return { label: "Muito baixo", className: "border-slate-200 bg-slate-50 text-slate-600" }
}

function currency(value: number) {
  return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

function defaultStage(lead: BantLead): BantStage {
  if (lead.bant_stage && stages.some((stage) => stage.id === lead.bant_stage)) return lead.bant_stage
  return "prospeccao"
}

function BantSelect({ label, letter, value, options, onChange }: { label: string; letter: string; value: number; options: string[]; onChange: (value: number) => void }) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <Label>{letter} - {label}</Label>
        <Badge variant="outline">{value}/5</Badge>
      </div>
      <Select value={String(value)} onValueChange={(next) => onChange(Number(next))}>
        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>{options.map((option, index) => <SelectItem key={option} value={String(index)}>{index} - {option}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  )
}

export function BantKanban() {
  const [leads, setLeads] = useState<BantLead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
  const [editing, setEditing] = useState<BantLead | null>(null)
  const [draft, setDraft] = useState<BantLead | null>(null)
  const [saving, setSaving] = useState(false)
  const [showLeadForm, setShowLeadForm] = useState(false)
  const [newLead, setNewLead] = useState({ name: "", company: "", phone: "", email: "", location: "", estimatedValue: "" })

  const loadLeads = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const response = await fetch("/api/leads/bant", { cache: "no-store" })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || "Erro ao carregar leads.")
      setLeads((payload.data || []).map((lead: BantLead) => ({ ...lead, bant_stage: defaultStage(lead) })))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Erro ao carregar leads.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadLeads() }, [loadLeads])

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase()
    if (!text) return leads
    return leads.filter((lead) => [lead.name, lead.company, lead.email, lead.phone].join(" ").toLowerCase().includes(text))
  }, [leads, query])

  const scores = leads.map(leadScore)
  const average = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0
  const qualified = scores.filter((score) => score >= 16).length
  const unassessed = scores.filter((score) => score === 0).length

  async function updateLead(id: string, body: Record<string, unknown>) {
    const response = await fetch("/api/leads/bant", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.error || "Erro ao salvar BANT.")
    const saved = { ...payload.lead, bant_stage: defaultStage(payload.lead) } as BantLead
    setLeads((current) => current.map((lead) => lead.id === id ? saved : lead))
    return saved
  }

  async function moveLead(id: string, stage: BantStage) {
    const previous = leads
    setLeads((current) => current.map((lead) => lead.id === id ? { ...lead, bant_stage: stage } : lead))
    try {
      await updateLead(id, { stage })
    } catch (moveError) {
      setLeads(previous)
      alert(moveError instanceof Error ? moveError.message : "Erro ao mover lead.")
    }
  }

  function openBant(lead: BantLead) {
    setEditing(lead)
    setDraft({ ...lead })
  }

  async function saveBant() {
    if (!editing || !draft) return
    setSaving(true)
    try {
      const saved = await updateLead(editing.id, {
        stage: draft.bant_stage || "qualificacao",
        budget: draft.bant_budget || 0,
        authority: draft.bant_authority || 0,
        need: draft.bant_need || 0,
        timeline: draft.bant_timeline || 0,
        notes: draft.bant_notes || "",
      })
      setEditing(null)
      setDraft(null)
      setLeads((current) => current.map((lead) => lead.id === saved.id ? saved : lead))
    } catch (saveError) {
      alert(saveError instanceof Error ? saveError.message : "Erro ao salvar BANT.")
    } finally {
      setSaving(false)
    }
  }

  async function createLead() {
    if (!newLead.name.trim()) {
      alert("Informe o nome do lead.")
      return
    }
    setSaving(true)
    try {
      const response = await fetch("/api/leads/bant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newLead) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || "Erro ao cadastrar lead.")
      setLeads((current) => [{ ...payload.lead, bant_stage: defaultStage(payload.lead) }, ...current])
      setNewLead({ name: "", company: "", phone: "", email: "", location: "", estimatedValue: "" })
      setShowLeadForm(false)
    } catch (createError) {
      alert(createError instanceof Error ? createError.message : "Erro ao cadastrar lead.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-md"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Buscar lead, empresa, telefone ou e-mail" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        <Button onClick={() => setShowLeadForm(true)}><Plus className="h-4 w-4" />Novo lead</Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Leads no funil" value={leads.length} note="Base cadastrada" icon={Users} />
        <MetricCard title="BANT medio" value={`${average.toFixed(1)} / 20`} note="Media de qualificacao" icon={BarChart3} />
        <MetricCard title="Alta qualificacao" value={qualified} note="Pontuacao entre 16 e 20" icon={Flame} />
        <MetricCard title="Sem avaliacao" value={unassessed} note="BANT ainda nao preenchido" icon={Target} />
      </div>

      {error ? <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div> : null}

      <div className="overflow-x-auto pb-3">
        <div className="grid min-w-[1960px] grid-cols-7 gap-3">
          {stages.map((stage) => {
            const rows = filtered.filter((lead) => defaultStage(lead) === stage.id)
            return (
              <section key={stage.id} className={`min-h-[520px] rounded-md border border-t-4 bg-muted/25 p-3 ${stage.accent}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer.getData("text/lead-id"); if (id) moveLead(id, stage.id) }}>
                <header className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold">{stage.label}</h3><Badge variant="secondary">{rows.length}</Badge></header>
                <div className="space-y-2">
                  {loading ? <p className="py-8 text-center text-sm text-muted-foreground">Carregando...</p> : rows.map((lead) => {
                    const score = leadScore(lead)
                    const level = classification(score)
                    return (
                      <button key={lead.id} type="button" draggable onDragStart={(event) => { event.dataTransfer.setData("text/lead-id", lead.id); event.dataTransfer.effectAllowed = "move" }} onClick={() => openBant(lead)} className="block w-full rounded-md border bg-background p-3 text-left shadow-sm transition hover:border-primary/40 hover:shadow-md">
                        <div className="flex items-start justify-between gap-2"><strong className="text-sm leading-5">{lead.name || "Lead sem nome"}</strong><Badge variant="outline" className={level.className}>{score}/20</Badge></div>
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{lead.company || "Sem empresa"}</p>
                        <div className="mt-3 flex items-center justify-between gap-2 text-xs"><span className="font-medium">{level.label}</span><span className="text-muted-foreground">{currency(Number(lead.estimated_value || 0))}</span></div>
                      </button>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      </div>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open) { setEditing(null); setDraft(null) } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader><DialogTitle>Avaliacao BANT</DialogTitle><DialogDescription>{draft?.name} {draft?.company ? `- ${draft.company}` : ""}</DialogDescription></DialogHeader>
          {draft ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
                <div><p className="text-xs text-muted-foreground">Contato</p><p className="text-sm font-medium">{[draft.phone, draft.email].filter(Boolean).join(" | ") || "Nao informado"}</p></div>
                <Select value={draft.bant_stage || "prospeccao"} onValueChange={(value) => setDraft({ ...draft, bant_stage: value as BantStage })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{stages.map((stage) => <SelectItem key={stage.id} value={stage.id}>{stage.label}</SelectItem>)}</SelectContent></Select>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <BantSelect label="Budget" letter="B" value={Number(draft.bant_budget || 0)} options={scoreOptions.budget} onChange={(value) => setDraft({ ...draft, bant_budget: value })} />
                <BantSelect label="Authority" letter="A" value={Number(draft.bant_authority || 0)} options={scoreOptions.authority} onChange={(value) => setDraft({ ...draft, bant_authority: value })} />
                <BantSelect label="Need" letter="N" value={Number(draft.bant_need || 0)} options={scoreOptions.need} onChange={(value) => setDraft({ ...draft, bant_need: value })} />
                <BantSelect label="Timeline" letter="T" value={Number(draft.bant_timeline || 0)} options={scoreOptions.timeline} onChange={(value) => setDraft({ ...draft, bant_timeline: value })} />
              </div>
              <div className="flex items-center justify-between rounded-md border bg-muted/30 p-4"><div><p className="text-sm font-semibold">Pontuacao total</p><p className="text-xs text-muted-foreground">Muito baixo: 0-5 | Baixo: 6-10 | Medio: 11-15 | Alto: 16-20</p></div><Badge variant="outline" className={`text-base ${classification(leadScore(draft)).className}`}>{leadScore(draft)}/20 - {classification(leadScore(draft)).label}</Badge></div>
              <div className="space-y-2"><Label>Observacoes da qualificacao</Label><Textarea rows={4} value={draft.bant_notes || ""} onChange={(event) => setDraft({ ...draft, bant_notes: event.target.value })} placeholder="Registre contexto sobre verba, decisores, necessidade e prazo." /></div>
            </div>
          ) : null}
          <DialogFooter><Button variant="outline" onClick={() => { setEditing(null); setDraft(null) }}>Cancelar</Button><Button onClick={saveBant} disabled={saving}>{saving ? "Salvando..." : "Salvar avaliacao"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showLeadForm} onOpenChange={setShowLeadForm}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>Novo lead comercial</DialogTitle><DialogDescription>Cadastre o prospect e depois faça a avaliacao BANT no card.</DialogDescription></DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label>Nome do lead</Label><Input value={newLead.name} onChange={(event) => setNewLead({ ...newLead, name: event.target.value })} /></div>
            <div className="space-y-2"><Label>Empresa</Label><Input value={newLead.company} onChange={(event) => setNewLead({ ...newLead, company: event.target.value })} /></div>
            <div className="space-y-2"><Label>Telefone</Label><Input value={newLead.phone} onChange={(event) => setNewLead({ ...newLead, phone: event.target.value })} /></div>
            <div className="space-y-2"><Label>E-mail</Label><Input type="email" value={newLead.email} onChange={(event) => setNewLead({ ...newLead, email: event.target.value })} /></div>
            <div className="space-y-2"><Label>Localizacao</Label><Input value={newLead.location} onChange={(event) => setNewLead({ ...newLead, location: event.target.value })} /></div>
            <div className="space-y-2"><Label>Valor estimado</Label><Input inputMode="decimal" value={newLead.estimatedValue} onChange={(event) => setNewLead({ ...newLead, estimatedValue: event.target.value.replace(/[^\d.,]/g, "") })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowLeadForm(false)}>Cancelar</Button><Button onClick={createLead} disabled={saving}>{saving ? "Salvando..." : "Cadastrar lead"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
