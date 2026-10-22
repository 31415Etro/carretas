"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2, Plus, ShieldAlert, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { FormSheet, SelectField, TextAreaField, TextField, useCrudFeedback } from "@/components/operations/shared"
import { useAuth } from "@/lib/auth-context"
import { cn } from "@/lib/utils"
import { checkStatusChange, isOpenOrder, orderLabel, orderPriorities, orderTypes, selectableStatuses, statusMeta, statusReasons, type MachineStatus } from "@/lib/machines"
import { StatusIcon } from "@/components/machines/machine-art"
import { localInputNow, mApi, uploadMachineFile, type Caps, type Overview, type Row } from "@/components/machines/machine-data"

const errorText = (error: unknown) => (error instanceof Error ? error.message : "Erro inesperado.")
const none = "nenhum"

// ===== Alterar status operacional =====
export function StatusDialog({ machine, orders, open, preset, onClose, onSaved }: { machine: Row | null; orders: Row[]; open: boolean; preset?: MachineStatus; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth()
  const { toast } = useCrudFeedback()
  const [to, setTo] = useState<MachineStatus>("Em operacao")
  const [effectiveAt, setEffectiveAt] = useState(localInputNow())
  const [reasonCode, setReasonCode] = useState("")
  const [notes, setNotes] = useState("")
  const [responsible, setResponsible] = useState("")
  const [orderId, setOrderId] = useState("")
  const [lock, setLock] = useState(false)
  const [release, setRelease] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!open || !machine) return
    const first = preset || (selectableStatuses.find((status) => status !== machine.operationalStatus) as MachineStatus)
    setTo(first); setEffectiveAt(localInputNow()); setReasonCode(""); setNotes(""); setResponsible(user?.name || ""); setOrderId(""); setLock(false); setRelease(false); setError("")
  }, [open, machine?.id, preset, user?.name]) // eslint-disable-line react-hooks/exhaustive-deps

  const openOrders = useMemo(() => orders.filter((order) => machine && order.machineId === machine.id && isOpenOrder(order.status) && order.origin === "Ordem"), [orders, machine])
  if (!machine) return null
  const reasons = statusReasons[to as keyof typeof statusReasons] || []
  const reason = reasons.find((item) => item.code === reasonCode)
  const text = reasonCode === "outro" ? notes.trim() : reason?.label || ""
  const blocking = openOrders.filter((order) => order.blocksOperation).length
  const needsRelease = to === "Em operacao" && machine.safetyLocked
  const preError = reasonCode ? checkStatusChange({ adminStatus: machine.adminStatus, current: machine.operationalStatus, safetyLocked: machine.safetyLocked, to, blockingOpenOrders: blocking, canReleaseSafety: release && notes.trim().length > 4, reason: text || "x" }) : ""

  const submit = async () => {
    setError("")
    if (!reasonCode) return setError("Escolha o motivo da alteração.")
    if (reasonCode === "outro" && !notes.trim()) return setError("Descreva o motivo em Observação.")
    if (needsRelease && !(release && notes.trim().length > 4)) return setError("Para liberar uma máquina bloqueada por segurança, confirme a liberação e justifique em Observação.")
    if (preError) return setError(preError)
    setSaving(true)
    try {
      await mApi("status", { body: { item: { machineId: machine.id, toStatus: to, effectiveAt: new Date(effectiveAt).toISOString(), reasonCode, reason: text, notes, responsible, orderId, expectedVersion: machine.statusVersion, safetyLock: to === "Parada" && lock, safetyRelease: needsRelease && release } } })
      toast({ title: "Status atualizado", description: `${machine.name}: ${statusMeta[to].label}.` })
      onSaved(); onClose()
    } catch (caught) {
      setError(errorText(caught))
      if ((caught as any)?.code === "CONFLITO") onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !value && !saving && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Alterar status de {machine.name}</DialogTitle>
          <DialogDescription>Hoje: <b>{statusMeta[machine.operationalStatus as MachineStatus].label}</b>. O status é informado por você: não há sensor lendo a máquina.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Novo status</legend>
            <div className="grid grid-cols-3 gap-2">
              {selectableStatuses.map((status) => {
                const meta = statusMeta[status]
                const active = to === status
                return (
                  <button key={status} type="button" aria-pressed={active} onClick={() => { setTo(status); setReasonCode("") }} disabled={status === machine.operationalStatus}
                    className={cn("flex flex-col items-center gap-1 rounded-xl border-2 px-2 py-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40")}
                    style={{ borderColor: active ? meta.color : "#e2e8f0", background: active ? meta.soft : "#fff", color: active ? meta.text : "#475569" }}>
                    <StatusIcon status={status} className="h-5 w-5" />{meta.label}
                  </button>
                )
              })}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Motivo" value={reasonCode || none} onChange={(value) => setReasonCode(value === none ? "" : value)} options={[{ value: none, label: "Selecione" }, ...reasons.map((item) => ({ value: item.code, label: item.label }))]} />
            <TextField label="Data e horário" type="datetime-local" value={effectiveAt} onChange={setEffectiveAt} />
            <TextField label="Responsável" value={responsible} onChange={setResponsible} />
            <SelectField label="Ordem de manutenção vinculada" value={orderId || none} onChange={(value) => setOrderId(value === none ? "" : value)} options={[{ value: none, label: "Nenhuma" }, ...openOrders.map((order) => ({ value: order.id, label: `${order.orderNumber} · ${order.description.slice(0, 40)}` }))]} />
          </div>
          <TextAreaField label={reasonCode === "outro" || needsRelease ? "Observação (obrigatória)" : "Observação"} value={notes} onChange={setNotes} rows={2} />
          {to === "Parada" ? (
            <label className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
              <Checkbox checked={lock} onCheckedChange={(value) => setLock(value === true)} className="mt-0.5" />
              <span><b className="flex items-center gap-1 text-red-800"><ShieldAlert className="h-4 w-4" />Bloquear por segurança</b>Só volta a operar com liberação autorizada e justificada.</span>
            </label>
          ) : null}
          {needsRelease ? (
            <label className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
              <Checkbox checked={release} onCheckedChange={(value) => setRelease(value === true)} className="mt-0.5" />
              <span><b className="text-amber-900">Máquina bloqueada por segurança: {machine.safetyLockReason}</b><br />Confirmo a liberação autorizada (descreva a verificação feita em Observação).</span>
            </label>
          ) : null}
          {to === "Em operacao" && blocking > 0 ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Há {blocking} ordem(ns) de manutenção em aberto que impede(m) o uso. Conclua ou cancele antes de liberar.</p> : null}
          {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={submit} disabled={saving} style={{ background: statusMeta[to].color }} className="text-white hover:opacity-90">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Confirmar: {statusMeta[to].label}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ===== Reportar problema (qualquer usuário do módulo) =====
export function ReportDialog({ machine, open, onClose, onSaved }: { machine: Row | null; open: boolean; onClose: () => void; onSaved: () => void }) {
  const { toast } = useCrudFeedback()
  const [description, setDescription] = useState("")
  const [priority, setPriority] = useState("Media")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  useEffect(() => { if (open) { setDescription(""); setPriority("Media"); setError("") } }, [open])
  if (!machine) return null
  const submit = async () => {
    if (!description.trim()) return setError("Descreva o problema.")
    setSaving(true)
    try {
      await mApi("order", { body: { item: { machineId: machine.id, origin: "Ocorrencia", description, priority } } })
      toast({ title: "Problema registrado", description: "O manutentor foi avisado pela lista de ocorrências." })
      onSaved(); onClose()
    } catch (caught) { setError(errorText(caught)) } finally { setSaving(false) }
  }
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Reportar problema</DialogTitle><DialogDescription>{machine.name} · {machine.code}. Isto não altera o status da máquina; quem altera é o manutentor.</DialogDescription></DialogHeader>
        <TextAreaField label="O que está acontecendo?" value={description} onChange={setDescription} rows={4} />
        <SelectField label="Urgência" value={priority} onChange={setPriority} options={orderPriorities.map((value) => ({ value, label: orderLabel(value) }))} />
        {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={submit} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Enviar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ===== Horímetro =====
export function MeterDialog({ machine, open, onClose, onSaved }: { machine: Row | null; open: boolean; onClose: () => void; onSaved: () => void }) {
  const { toast } = useCrudFeedback()
  const [reading, setReading] = useState("")
  const [correction, setCorrection] = useState(false)
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  useEffect(() => { if (open) { setReading(String(machine?.hourMeter ?? "")); setCorrection(false); setNote(""); setError("") } }, [open, machine?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!machine) return null
  const submit = async () => {
    setSaving(true)
    try {
      await mApi("meter", { body: { item: { machineId: machine.id, reading: Number(reading.replace(",", ".")), isCorrection: correction, note } } })
      toast({ title: "Horímetro atualizado" }); onSaved(); onClose()
    } catch (caught) { setError(errorText(caught)) } finally { setSaving(false) }
  }
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Atualizar horímetro</DialogTitle><DialogDescription>{machine.name}: atual {machine.hourMeter} h.</DialogDescription></DialogHeader>
        <TextField label="Leitura atual (horas)" type="number" value={reading} onChange={setReading} />
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={correction} onCheckedChange={(value) => setCorrection(value === true)} />É uma correção (valor menor que o atual)</label>
        {correction ? <TextAreaField label="Justificativa" value={note} onChange={setNote} rows={2} /> : null}
        {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={submit} disabled={saving}>Salvar leitura</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ===== Ordem de manutenção / manutenção anterior =====
type PartForm = { materialId: string; description: string; quantity: string; unitCost: string }
type Material = { id: string; name: string; code: string; unit: string; cost: number; available: number }

export function OrderSheet({ open, kind, machines, machineId, caps, fromOccurrence, onClose, onSaved }: { open: boolean; kind: "Ordem" | "Historico"; machines: Row[]; machineId?: string; caps: Caps; fromOccurrence?: Row | null; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth()
  const { toast } = useCrudFeedback()
  const blank = () => ({ machineId: machineId || "", maintenanceType: kind === "Historico" || fromOccurrence ? "Corretiva" : "Preventiva", priority: fromOccurrence?.priority || "Media", description: fromOccurrence?.description || "", problem: fromOccurrence?.problem || "", solution: "", responsible: user?.name || "", technician: "", externalCompany: "", dueDate: "", performedAt: "", laborHours: "", laborCost: "", otherCost: "", downtimeHours: "", blocksOperation: false, requiresApproval: false, notes: "", checklist: "", postStock: false })
  const [form, setForm] = useState<Row>(blank())
  const [parts, setParts] = useState<PartForm[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [search, setSearch] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const set = (key: string) => (value: any) => setForm((current) => ({ ...current, [key]: value }))
  useEffect(() => { if (open) { setForm(blank()); setParts([]); setFiles([]); setError("") } }, [open, kind, machineId, fromOccurrence?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => { mApi<{ items: Material[] }>("materials", { query: { q: search } }).then((result) => setMaterials(result.items)).catch(() => setMaterials([])) }, 250)
    return () => window.clearTimeout(timer)
  }, [open, search])
  const historic = kind === "Historico"

  const submit = async () => {
    setError("")
    if (!form.machineId) return setError("Escolha a máquina.")
    setSaving(true)
    try {
      const checklist = String(form.checklist).split("\n").map((line) => line.trim()).filter(Boolean).map((text) => ({ text, done: false }))
      const created = await mApi<{ item: Row }>("order", { body: { item: { ...form, origin: kind, fromOccurrenceId: fromOccurrence?.id || "", checklist, parts: parts.map((part) => ({ ...part, quantity: Number(part.quantity.replace(",", ".")), unitCost: Number(String(part.unitCost).replace(",", ".")) || 0 })) } } })
      for (const file of files) {
        const uploaded = await uploadMachineFile(file, form.machineId)
        await mApi("document", { body: { item: { machineId: form.machineId, orderId: created.item.id, docType: "Relatório", description: file.name, filePath: uploaded.path, fileName: uploaded.name, restricted: false } } })
      }
      toast({ title: historic ? "Manutenção anterior registrada" : `Ordem ${created.item.orderNumber} aberta` })
      onSaved(); onClose()
    } catch (caught) { setError(errorText(caught)) } finally { setSaving(false) }
  }

  return (
    <FormSheet open={open} onOpenChange={(value) => !value && onClose()} title={historic ? "Registrar manutenção anterior" : "Nova ordem de manutenção"}
      description={historic ? "Intervenção feita antes de a máquina entrar no sistema. Não gera baixa de estoque nem lançamento financeiro." : "A ordem recebe numeração automática (OM-ANO-000000)."}
      footer={<div className="flex w-full justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={submit} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Salvar</Button></div>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Máquina" value={form.machineId || none} onChange={(value) => set("machineId")(value === none ? "" : value)} options={[{ value: none, label: "Selecione" }, ...machines.map((machine) => ({ value: machine.id, label: `${machine.code} · ${machine.name}` }))]} />
        <SelectField label="Tipo" value={form.maintenanceType} onChange={set("maintenanceType")} options={orderTypes.map((value) => ({ value, label: orderLabel(value) }))} />
        {historic ? <TextField label="Data em que ocorreu" type="date" value={form.performedAt} onChange={set("performedAt")} /> : <TextField label="Prazo" type="date" value={form.dueDate} onChange={set("dueDate")} />}
        {!historic ? <SelectField label="Prioridade" value={form.priority} onChange={set("priority")} options={orderPriorities.map((value) => ({ value, label: orderLabel(value) }))} /> : null}
      </div>
      <TextAreaField label="Descrição do serviço" value={form.description} onChange={set("description")} rows={2} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextAreaField label="Problema identificado" value={form.problem} onChange={set("problem")} rows={2} />
        {historic ? <TextAreaField label="Solução aplicada" value={form.solution} onChange={set("solution")} rows={2} /> : <TextAreaField label="Checklist (um item por linha)" value={form.checklist} onChange={set("checklist")} rows={2} />}
        <TextField label="Responsável / técnico" value={form.technician || form.responsible} onChange={(value) => { set("technician")(value); set("responsible")(value) }} />
        <TextField label="Empresa terceirizada" value={form.externalCompany} onChange={set("externalCompany")} />
        <TextField label="Horas trabalhadas" type="number" value={form.laborHours} onChange={set("laborHours")} />
        <TextField label="Custo de mão de obra (R$)" type="number" value={form.laborCost} onChange={set("laborCost")} />
        <TextField label="Outros custos (R$)" type="number" value={form.otherCost} onChange={set("otherCost")} />
        <TextField label="Tempo de máquina parada (h)" type="number" value={form.downtimeHours} onChange={set("downtimeHours")} />
      </div>
      <section className="space-y-3 rounded-xl border p-3">
        <div className="flex items-center justify-between"><h4 className="text-sm font-semibold">Peças e materiais</h4><Button size="sm" variant="outline" onClick={() => setParts([...parts, { materialId: "", description: "", quantity: "1", unitCost: "" }])}><Plus className="h-4 w-4" />Adicionar</Button></div>
        {parts.length ? <TextField label="Buscar no estoque" value={search} onChange={setSearch} placeholder="Nome ou código do material" /> : null}
        {parts.map((part, index) => (
          <div key={index} className="grid items-end gap-2 sm:grid-cols-[1fr_5rem_6rem_auto]">
            <SelectField label="Material" value={part.materialId || none} onChange={(value) => { const material = materials.find((item) => item.id === value); setParts(parts.map((row, i) => (i === index ? { ...row, materialId: value === none ? "" : value, description: material?.name || row.description, unitCost: material ? String(material.cost) : row.unitCost } : row))) }}
              options={[{ value: none, label: "Peça avulsa (sem estoque)" }, ...materials.map((item) => ({ value: item.id, label: `${item.code ? `${item.code} · ` : ""}${item.name} (${item.available} ${item.unit})` }))]} />
            <TextField label="Qtd." type="number" value={part.quantity} onChange={(value) => setParts(parts.map((row, i) => (i === index ? { ...row, quantity: value } : row)))} />
            <TextField label="Custo un." type="number" value={part.unitCost} onChange={(value) => setParts(parts.map((row, i) => (i === index ? { ...row, unitCost: value } : row)))} />
            <Button size="icon" variant="ghost" onClick={() => setParts(parts.filter((_, i) => i !== index))} aria-label="Remover peça"><Trash2 className="h-4 w-4" /></Button>
            {!part.materialId ? <div className="sm:col-span-4"><TextField label="Descrição da peça avulsa" value={part.description} onChange={(value) => setParts(parts.map((row, i) => (i === index ? { ...row, description: value } : row)))} /></div> : null}
          </div>
        ))}
        {!historic ? <p className="text-xs text-muted-foreground">Peças do estoque só saem do estoque quando a ordem é concluída (uma única vez).</p> : null}
      </section>
      {!historic ? (
        <div className="flex flex-col gap-2 text-sm">
          <label className="flex items-center gap-2"><Checkbox checked={form.blocksOperation} onCheckedChange={(value) => set("blocksOperation")(value === true)} />Impede o uso da máquina enquanto estiver em aberto</label>
          <label className="flex items-center gap-2"><Checkbox checked={form.requiresApproval} onCheckedChange={(value) => set("requiresApproval")(value === true)} />Exige aprovação antes de iniciar</label>
        </div>
      ) : caps.admin && parts.some((part) => part.materialId) ? (
        <label className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm"><Checkbox checked={form.postStock} onCheckedChange={(value) => set("postStock")(value === true)} className="mt-0.5" />Autorizo dar baixa no estoque das peças desta manutenção anterior (por padrão, não baixa).</label>
      ) : null}
      <TextAreaField label="Observações" value={form.notes} onChange={set("notes")} rows={2} />
      <div className="space-y-2">
        <Label>Documentos e comprovantes (JPG, PNG, WEBP ou PDF até 20 MB)</Label>
        <input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setFiles(Array.from(event.target.files || []))} className="block w-full text-sm" />
      </div>
      {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
    </FormSheet>
  )
}

// ===== Concluir ordem =====
export function CompleteDialog({ order, open, onClose, onDone }: { order: Row | null; open: boolean; onClose: () => void; onDone: (releaseSuggested: boolean, machineId: string) => void }) {
  const { toast } = useCrudFeedback()
  const [solution, setSolution] = useState("")
  const [performedAt, setPerformedAt] = useState("")
  const [laborHours, setLaborHours] = useState("")
  const [laborCost, setLaborCost] = useState("")
  const [otherCost, setOtherCost] = useState("")
  const [downtime, setDowntime] = useState("")
  const [checks, setChecks] = useState<Array<{ text: string; done: boolean }>>([])
  const [force, setForce] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  useEffect(() => {
    if (!open || !order) return
    setSolution(order.solution || ""); setPerformedAt(new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10)); setLaborHours(String(order.laborHours || "")); setLaborCost(String(order.laborCost || "")); setOtherCost(String(order.otherCost || "")); setDowntime(String(order.downtimeHours || ""))
    setChecks((order.checklist || []).map((entry: any) => (typeof entry === "string" ? { text: entry, done: false } : entry))); setForce(false); setError("")
  }, [open, order?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!order) return null
  const pending = checks.some((entry) => !entry.done)
  const submit = async () => {
    setSaving(true); setError("")
    try {
      const result = await mApi<{ releaseSuggested: boolean }>("order-action", { body: { item: { id: order.id, toStatus: "Concluida", solution, performedAt, laborHours, laborCost, otherCost, downtimeHours: downtime, checklist: checks, forceChecklist: force } } })
      toast({ title: `Ordem ${order.orderNumber} concluída`, description: "Custos, histórico e próximos vencimentos foram atualizados." })
      onDone(result.releaseSuggested, order.machineId); onClose()
    } catch (caught) { setError(errorText(caught)) } finally { setSaving(false) }
  }
  return (
    <Dialog open={open} onOpenChange={(value) => !value && !saving && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>Concluir {order.orderNumber}</DialogTitle><DialogDescription>Concluir a ordem não coloca a máquina em operação: a liberação é confirmada à parte.</DialogDescription></DialogHeader>
        <TextAreaField label="Solução aplicada" value={solution} onChange={setSolution} rows={2} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Data da execução" type="date" value={performedAt} onChange={setPerformedAt} />
          <TextField label="Tempo parada (h)" type="number" value={downtime} onChange={setDowntime} />
          <TextField label="Horas trabalhadas" type="number" value={laborHours} onChange={setLaborHours} />
          <TextField label="Mão de obra (R$)" type="number" value={laborCost} onChange={setLaborCost} />
          <TextField label="Outros custos (R$)" type="number" value={otherCost} onChange={setOtherCost} />
        </div>
        {checks.length ? (
          <fieldset className="space-y-1.5"><legend className="text-sm font-medium">Checklist</legend>
            {checks.map((entry, index) => <label key={index} className="flex items-center gap-2 text-sm"><Checkbox checked={entry.done} onCheckedChange={(value) => setChecks(checks.map((row, i) => (i === index ? { ...row, done: value === true } : row)))} />{entry.text}</label>)}
            {pending ? <label className="flex items-center gap-2 pt-1 text-xs text-amber-800"><Checkbox checked={force} onCheckedChange={(value) => setForce(value === true)} />Concluir mesmo com itens do checklist pendentes</label> : null}
          </fieldset>
        ) : null}
        {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
        <DialogFooter><Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button><Button onClick={submit} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Concluir ordem</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ===== Plano preventivo =====
export function PlanSheet({ open, plan, machineId, machines, onClose, onSaved }: { open: boolean; plan: Row | null; machineId?: string; machines: Row[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useCrudFeedback()
  const blank = () => ({ machineId: machineId || "", name: "", description: "", maintenanceType: "Preventiva", intervalDays: "", intervalMonths: "", intervalHours: "", fixedDate: "", combineRule: "Primeiro", checklist: "", autoCreateOrder: false, blocksOperation: false, active: true, lastDoneDate: "", lastDoneHours: "" })
  const [form, setForm] = useState<Row>(blank())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const set = (key: string) => (value: any) => setForm((current) => ({ ...current, [key]: value }))
  useEffect(() => { if (open) { setForm(plan ? { ...plan, checklist: (plan.checklist || []).join("\n"), intervalDays: plan.intervalDays ?? "", intervalMonths: plan.intervalMonths ?? "", intervalHours: plan.intervalHours ?? "" } : blank()); setError("") } }, [open, plan?.id, machineId]) // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => {
    setSaving(true); setError("")
    try {
      await mApi("plan", { body: { item: { ...form, checklist: String(form.checklist).split("\n").map((line) => line.trim()).filter(Boolean) } } })
      toast({ title: "Plano salvo", description: "O próximo vencimento foi recalculado." }); onSaved(); onClose()
    } catch (caught) { setError(errorText(caught)) } finally { setSaving(false) }
  }
  return (
    <FormSheet open={open} onOpenChange={(value) => !value && onClose()} title={plan ? "Editar plano de manutenção" : "Novo plano de manutenção"} description="Ex.: inspeção elétrica a cada 90 dias, limpeza a cada 30 dias, revisão geral a cada 500 horas."
      footer={<div className="flex w-full justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={submit} disabled={saving}>Salvar plano</Button></div>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Máquina" value={form.machineId || none} onChange={(value) => set("machineId")(value === none ? "" : value)} options={[{ value: none, label: "Selecione" }, ...machines.map((machine) => ({ value: machine.id, label: `${machine.code} · ${machine.name}` }))]} />
        <TextField label="Nome do plano" value={form.name} onChange={set("name")} />
        <SelectField label="Tipo" value={form.maintenanceType} onChange={set("maintenanceType")} options={[{ value: "Preventiva", label: "Preventiva" }, { value: "Preditiva", label: "Preditiva" }, { value: "Inspecao", label: "Inspeção" }]} />
        <SelectField label="Quando várias regras" value={form.combineRule} onChange={set("combineRule")} options={[{ value: "Primeiro", label: "Vence na primeira que ocorrer" }, { value: "Todos", label: "Vence quando todas ocorrerem" }]} />
        <TextField label="A cada (dias)" type="number" value={form.intervalDays} onChange={set("intervalDays")} />
        <TextField label="A cada (meses)" type="number" value={form.intervalMonths} onChange={set("intervalMonths")} />
        <TextField label="A cada (horas de operação)" type="number" value={form.intervalHours} onChange={set("intervalHours")} />
        <TextField label="Data específica" type="date" value={form.fixedDate} onChange={set("fixedDate")} />
        <TextField label="Última execução (se já feita)" type="date" value={form.lastDoneDate} onChange={set("lastDoneDate")} />
        <TextField label="Horímetro na última execução" type="number" value={form.lastDoneHours ?? ""} onChange={set("lastDoneHours")} />
      </div>
      <TextAreaField label="Descrição" value={form.description} onChange={set("description")} rows={2} />
      <TextAreaField label="Checklist padrão (um item por linha)" value={form.checklist} onChange={set("checklist")} rows={3} />
      <div className="flex flex-col gap-2 text-sm">
        <label className="flex items-center gap-2"><Checkbox checked={form.autoCreateOrder} onCheckedChange={(value) => set("autoCreateOrder")(value === true)} />Abrir a ordem automaticamente perto do vencimento</label>
        <label className="flex items-center gap-2"><Checkbox checked={form.blocksOperation} onCheckedChange={(value) => set("blocksOperation")(value === true)} />A ordem desse plano impede o uso da máquina</label>
        <label className="flex items-center gap-2"><Checkbox checked={form.active} onCheckedChange={(value) => set("active")(value === true)} />Plano ativo</label>
      </div>
      {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
    </FormSheet>
  )
}
