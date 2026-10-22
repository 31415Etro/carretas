"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Ban, Check, Copy, Loader2, Plus, Receipt, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TableCell, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { DataTable, FormSheet, PageShell, SaveButton, SearchableSelectField, SectionCard, SelectField, StatusBadge, TextAreaField, TextField, useCrudFeedback } from "@/components/operations/shared"
import { accountTypes } from "@/lib/registry"
import { CATEGORY_LABEL, statusLabel } from "@/lib/travel-advance"

type Bank = { bankName: string; bankAgency: string; bankAccount: string; bankAccountType: string; pixKey: string }
type Employee = { id: string; name: string; email: string; bank: Bank }
type Receipt = { id: string; photo_url: string; amount: number; establishment: string; category: string; occurred_at: string | null; status: string; review_note: string; advance_id?: string; advance?: { id: string; employee_name: string; reason: string; amount: number; end_date: string } }
type Advance = {
  id: string; token: string; employee_name: string; reason: string; amount: number; start_date: string; end_date: string; status: string
  own_pocket_justification: string; settlement_action: string | null; settlement_resolved: boolean; receipts: Array<{ status: string }>
  summary: { budget: number; spent: number; remaining: number; overspent: boolean }
}

const brl = (value: unknown) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const day = (value?: string | null) => (value ? value.split("-").reverse().join("/") : "-")
const emptyForm = () => ({ employeeId: "", reason: "", amount: "", startDate: new Date().toISOString().slice(0, 10), endDate: "", bank: { bankName: "", bankAgency: "", bankAccount: "", bankAccountType: "", pixKey: "" } as Bank })

async function send<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
  return payload as T
}

const STATUS_TONE: Record<string, string> = { Aberto: "default", Finalizado: "warning", Concluido: "success", Cancelado: "muted" }

export function TravelAdvancesPage() {
  const { toast, requireFields } = useCrudFeedback()
  const [advances, setAdvances] = useState<Advance[]>([])
  const [pending, setPending] = useState<Receipt[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [sheetOpen, setSheetOpen] = useState(false)
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)
  const [link, setLink] = useState("")
  const [detail, setDetail] = useState<Advance | null>(null)
  const [contesting, setContesting] = useState<string>("")
  const [note, setNote] = useState("")
  const [busyId, setBusyId] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const [advancesData, pendingData, employeesData] = await Promise.all([
        send<{ items: Advance[] }>("/api/financeiro/orcamento-viagem"),
        send<{ items: Receipt[] }>("/api/financeiro/orcamento-viagem/pendencias"),
        send<{ employees: Employee[] }>("/api/financeiro/orcamento-viagem/opcoes"),
      ])
      setAdvances(advancesData.items)
      setPending(pendingData.items)
      setEmployees(employeesData.employees)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Erro ao carregar.")
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  function pickEmployee(id: string) {
    const employee = employees.find((item) => item.id === id)
    setForm((current) => ({ ...current, employeeId: id, bank: employee?.bank && (employee.bank.bankName || employee.bank.pixKey) ? employee.bank : current.bank }))
  }

  async function createAdvance() {
    if (!requireFields([["funcionário", form.employeeId], ["valor", form.amount], ["data final", form.endDate]])) return
    setSaving(true)
    try {
      const result = await send<{ id: string; link: string }>("/api/financeiro/orcamento-viagem", {
        method: "POST",
        body: JSON.stringify({ employeeId: form.employeeId, reason: form.reason, amount: Number(form.amount), startDate: form.startDate, endDate: form.endDate, bank: form.bank }),
      })
      setLink(`${window.location.origin}${result.link}`)
      setForm(emptyForm())
      await load()
      toast({ title: "Orçamento de viagem criado", description: "Copie o link e envie para o funcionário." })
    } catch (reason) {
      toast({ title: "Erro ao criar", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  async function copyLink(token: string) {
    const url = `${window.location.origin}/portal-viagem/${token}`
    await navigator.clipboard.writeText(url)
    toast({ title: "Link copiado", description: url })
  }

  async function review(receiptId: string, action: "aprovar" | "contestar", noteText = "") {
    setBusyId(receiptId)
    try {
      await send(`/api/financeiro/orcamento-viagem/recibos/${receiptId}`, { method: "PATCH", body: JSON.stringify({ action, note: noteText }) })
      setContesting("")
      setNote("")
      await load()
    } catch (reason) {
      toast({ title: "Erro", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    } finally {
      setBusyId("")
    }
  }

  async function cancelAdvance(id: string) {
    if (!window.confirm("Cancelar este orçamento de viagem? O link deixa de aceitar novas notinhas.")) return
    await send(`/api/financeiro/orcamento-viagem/${id}`, { method: "PATCH", body: JSON.stringify({ action: "cancelar" }) })
    setDetail(null)
    await load()
  }

  async function resolveSettlement(id: string) {
    await send(`/api/financeiro/orcamento-viagem/${id}`, { method: "PATCH", body: JSON.stringify({ action: "resolver_devolucao", note: "Confirmado pelo financeiro." }) })
    setDetail(null)
    await load()
  }

  const employeeOptions = employees.map((item) => ({ value: item.id, label: item.name }))

  return (
    <PageShell title="Orçamento de Viagem" description="Orçamento de gasto para viagem ou visita do funcionário, com prestação de contas por um link público." actions={<>
      <Button variant="outline" asChild><Link href="/financeiro"><ArrowLeft className="h-4 w-4" />Voltar ao Financeiro</Link></Button>
      <Button onClick={() => { setForm(emptyForm()); setLink(""); setSheetOpen(true) }}><Plus className="h-4 w-4" />Novo orçamento de viagem</Button>
    </>}>
      {error ? <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}

      <SectionCard title="Pendências de aprovação" description="Notinhas de orçamentos de viagem já finalizados pelo funcionário.">
        {pending.length === 0 ? <p className="text-sm text-muted-foreground">{loading ? "Carregando..." : "Nada pendente no momento."}</p> : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {pending.map((receipt) => (
              <div key={receipt.id} className="rounded-md border p-3 text-sm">
                <a href={receipt.photo_url} target="_blank" rel="noreferrer"><img src={receipt.photo_url} alt="Notinha" className="mb-2 h-32 w-full rounded object-cover" /></a>
                <p className="font-medium">{receipt.establishment || "(estabelecimento não identificado)"}</p>
                <p className="text-muted-foreground">{receipt.advance?.employee_name} · {receipt.advance?.reason}</p>
                <p className="mt-1 flex items-center justify-between"><span>{CATEGORY_LABEL[receipt.category] || receipt.category}</span><strong>{brl(receipt.amount)}</strong></p>
                <p className="text-xs text-muted-foreground">{day(receipt.occurred_at)}</p>
                {contesting === receipt.id ? (
                  <div className="mt-2 space-y-2">
                    <Textarea rows={2} placeholder="O que está estranho neste registro?" value={note} onChange={(event) => setNote(event.target.value)} />
                    <div className="flex gap-2">
                      <Button size="sm" variant="destructive" disabled={busyId === receipt.id} onClick={() => void review(receipt.id, "contestar", note)}>Confirmar contestação</Button>
                      <Button size="sm" variant="ghost" onClick={() => { setContesting(""); setNote("") }}>Cancelar</Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" disabled={busyId === receipt.id} onClick={() => void review(receipt.id, "aprovar")}>{busyId === receipt.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Aprovar</Button>
                    <Button size="sm" variant="outline" onClick={() => { setContesting(receipt.id); setNote("") }}><X className="h-4 w-4" />Contestar</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Orçamentos de viagem">
        <DataTable headers={["Funcionário", "Motivo", "Período", "Valor", "Gasto", "Saldo", "Status", "Link", ""]} empty={!advances.length && !loading}>
          {advances.map((advance) => (
            <TableRow key={advance.id} className="cursor-pointer" onClick={() => setDetail(advance)}>
              <TableCell>{advance.employee_name}</TableCell>
              <TableCell className="max-w-[200px] truncate">{advance.reason || "-"}</TableCell>
              <TableCell className="whitespace-nowrap">{day(advance.start_date)} - {day(advance.end_date)}</TableCell>
              <TableCell>{brl(advance.amount)}</TableCell>
              <TableCell>{brl(advance.summary.spent)}</TableCell>
              <TableCell className={advance.summary.overspent ? "text-destructive" : ""}>{brl(advance.summary.remaining)}</TableCell>
              <TableCell><StatusBadge status={STATUS_TONE[advance.status] ? advance.status : advance.status} /><span className="ml-1 text-xs text-muted-foreground">{statusLabel(advance.status as never)}</span></TableCell>
              <TableCell onClick={(event) => event.stopPropagation()}><Button size="sm" variant="outline" onClick={() => void copyLink(advance.token)}><Copy className="h-4 w-4" />Copiar link</Button></TableCell>
              <TableCell onClick={(event) => event.stopPropagation()}>{advance.status === "Aberto" ? <Button size="sm" variant="ghost" onClick={() => void cancelAdvance(advance.id)}><Ban className="h-4 w-4" /></Button> : null}</TableCell>
            </TableRow>
          ))}
        </DataTable>
      </SectionCard>

      <FormSheet open={sheetOpen} onOpenChange={setSheetOpen} title="Novo orçamento de viagem" description="Escolha o funcionário, o valor e o prazo: um link é gerado para ele prestar contas." footer={!link ? <SaveButton onClick={() => void createAdvance()} disabled={saving}>{saving ? "Salvando..." : "Criar e gerar link"}</SaveButton> : <Button onClick={() => setSheetOpen(false)}>Concluir</Button>}>
        {link ? (
          <div className="space-y-3">
            <p className="flex items-center gap-2 rounded-md border border-green-600/40 bg-green-600/10 p-3 text-sm"><Receipt className="h-4 w-4 shrink-0" />Orçamento de viagem criado. Envie este link para o funcionário.</p>
            <div className="flex gap-2"><Input readOnly value={link} /><Button variant="outline" onClick={() => { void navigator.clipboard.writeText(link); toast({ title: "Link copiado" }) }}><Copy className="h-4 w-4" />Copiar</Button></div>
          </div>
        ) : (
          <div className="space-y-4">
            <SearchableSelectField label="Funcionário" value={form.employeeId} onChange={pickEmployee} options={employeeOptions} placeholder="Escolha o funcionário" />
            <TextAreaField label="Motivo (viagem, visita...)" value={form.reason} onChange={(value) => setForm((current) => ({ ...current, reason: value }))} />
            <div className="grid gap-4 sm:grid-cols-3">
              <TextField label="Valor do orçamento" type="number" value={form.amount} onChange={(value) => setForm((current) => ({ ...current, amount: value }))} />
              <div className="space-y-2"><Label>Início</Label><Input type="date" value={form.startDate} onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))} /></div>
              <div className="space-y-2"><Label>Prazo final</Label><Input type="date" min={form.startDate} value={form.endDate} onChange={(event) => setForm((current) => ({ ...current, endDate: event.target.value }))} /></div>
            </div>
            <div className="rounded-md border p-3">
              <p className="mb-3 text-sm font-medium">Dados da conta do funcionário</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField label="Banco" value={form.bank.bankName} onChange={(value) => setForm((current) => ({ ...current, bank: { ...current.bank, bankName: value } }))} />
                <TextField label="Agência" value={form.bank.bankAgency} onChange={(value) => setForm((current) => ({ ...current, bank: { ...current.bank, bankAgency: value } }))} />
                <TextField label="Conta" value={form.bank.bankAccount} onChange={(value) => setForm((current) => ({ ...current, bank: { ...current.bank, bankAccount: value } }))} />
                <SelectField label="Tipo de conta" value={form.bank.bankAccountType} onChange={(value) => setForm((current) => ({ ...current, bank: { ...current.bank, bankAccountType: value } }))} options={accountTypes.map((item) => ({ value: item, label: item }))} />
                <TextField label="Chave PIX" value={form.bank.pixKey} onChange={(value) => setForm((current) => ({ ...current, bank: { ...current.bank, pixKey: value } }))} />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Preenchido do cadastro do funcionário, se já existir. Fica salvo para a próxima vez.</p>
            </div>
          </div>
        )}
      </FormSheet>

      <Dialog open={Boolean(detail)} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          {detail ? (
            <>
              <DialogHeader><DialogTitle>{detail.employee_name} · {detail.reason || "Orçamento de viagem"}</DialogTitle></DialogHeader>
              <div className="grid gap-3 text-sm sm:grid-cols-3">
                <p>Orçamento<br /><strong>{brl(detail.amount)}</strong></p>
                <p>Gasto<br /><strong>{brl(detail.summary.spent)}</strong></p>
                <p>Saldo<br /><strong className={detail.summary.overspent ? "text-destructive" : ""}>{brl(detail.summary.remaining)}</strong></p>
              </div>
              {detail.own_pocket_justification ? <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">Gastou do próprio bolso: {detail.own_pocket_justification}</p> : null}
              {detail.settlement_action === "devolver" ? (
                <p className="flex items-center justify-between rounded-md border border-blue-200 bg-blue-50 p-3 text-sm">
                  Funcionário pediu para devolver {brl(detail.summary.remaining)}.
                  {detail.settlement_resolved ? <StatusBadge status="Concluida" /> : <Button size="sm" onClick={() => void resolveSettlement(detail.id)}>Marcar como resolvido</Button>}
                </p>
              ) : null}
              {detail.settlement_action === "desconto_folha" ? <p className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm">Funcionário optou por descontar {brl(detail.summary.remaining)} do salário.</p> : null}
              <p className="text-xs text-muted-foreground">{detail.receipts.length} notinha(s) enviada(s). Use a seção "Pendências" acima para aprovar/contestar uma a uma.</p>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </PageShell>
  )
}
