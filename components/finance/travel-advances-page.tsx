"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Ban, Check, Copy, FileText, Loader2, Plus, Receipt, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TableCell, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { DataTable, FormSheet, PageShell, SaveButton, SearchableSelectField, SectionCard, SelectField, StatusBadge, TextAreaField, TextField, useCrudFeedback } from "@/components/operations/shared"
import { accountTypes } from "@/lib/registry"
import { BUDGETABLE_CATEGORIES, CATEGORY_LABEL, canCancelAdvance, canDeleteAdvance, statusLabel, validateCategoryBudgets } from "@/lib/travel-advance"
import { advanceNumber, buildAdvanceTermPdf } from "@/lib/travel-advance-term"
import { useAuth } from "@/lib/auth-context"

type Bank = { bankName: string; bankAgency: string; bankAccount: string; bankAccountType: string; pixKey: string }
type Employee = { id: string; name: string; email: string; cpf?: string; bank: Bank }
type Receipt = { id: string; photo_url: string; amount: number; establishment: string; category: string; occurred_at: string | null; status: string; review_note: string; advance_id?: string; advance?: { id: string; employee_name: string; reason: string; amount: number; end_date: string } }
type CategorySummary = { category: string; budget: number; spent: number; remaining: number; overspent: boolean }
type Advance = {
  id: string; token: string; number?: number | null; cancel_reason?: string | null; cancelled_by?: string | null; cancelled_at?: string | null; settlement_note?: string | null; employee_cpf?: string; company?: { name: string; cnpj: string }; employee_name: string; reason: string; amount: number; start_date: string; end_date: string; status: string
  own_pocket_justification: string; settlement_action: string | null; settlement_resolved: boolean; receipts: Array<{ id: string; status: string; amount: number; category: string; photo_url: string; establishment: string; occurred_at: string | null; review_note: string; created_at: string }>
  summary: { budget: number; spent: number; remaining: number; overspent: boolean }; categories: CategorySummary[]
}

const brl = (value: unknown) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const day = (value?: string | null) => (value ? value.split("-").reverse().join("/") : "-")
const emptyForm = () => ({
  employeeId: "", cpf: "", reason: "", amount: "", startDate: new Date().toISOString().slice(0, 10), endDate: "",
  bank: { bankName: "", bankAgency: "", bankAccount: "", bankAccountType: "", pixKey: "" } as Bank,
  categoryBudgets: Object.fromEntries(BUDGETABLE_CATEGORIES.map((category) => [category, ""])) as Record<string, string>,
})

async function send<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
  return payload as T
}

const STATUS_TONE: Record<string, string> = { Aberto: "default", Finalizado: "warning", Concluido: "success", Cancelado: "muted" }

export function TravelAdvancesPage() {
  const { toast, requireFields } = useCrudFeedback()
  const { user } = useAuth()
  const mayDelete = canDeleteAdvance(user?.email)
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
  const [cancelTarget, setCancelTarget] = useState<Advance | null>(null)
  const [cancelReason, setCancelReason] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<Advance | null>(null)
  const [acting, setActing] = useState(false)

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
  useEffect(() => { // vindo de um lançamento em Entradas e Saídas (?abrir=<id>): abre a janela da antecipação
    const wanted = new URLSearchParams(window.location.search).get("abrir")
    if (!wanted || !advances.length) return
    const found = advances.find((advance) => advance.id === wanted)
    if (found) { setDetail(found); window.history.replaceState(null, "", window.location.pathname) }
  }, [advances])
  useEffect(() => { setDetail((current) => (current ? advances.find((advance) => advance.id === current.id) || current : current)) }, [advances]) // a janela aberta acompanha a lista recarregada

  function pickEmployee(id: string) {
    const employee = employees.find((item) => item.id === id)
    setForm((current) => ({ ...current, employeeId: id, cpf: employee?.cpf || current.cpf, bank: employee?.bank && (employee.bank.bankName || employee.bank.pixKey) ? employee.bank : current.bank }))
  }

  async function createAdvance() {
    if (!requireFields([["funcionário", form.employeeId], ["valor", form.amount], ["data final", form.endDate]])) return
    const categoryBudgets = Object.fromEntries(Object.entries(form.categoryBudgets).map(([category, value]): [string, number] => [category, Number(value) || 0]).filter(([, value]) => value > 0))
    const check = validateCategoryBudgets(Number(form.amount), categoryBudgets)
    if (!check.ok) { toast({ title: "Sub-orçamentos passam do total", description: check.reason, variant: "destructive" }); return }
    setSaving(true)
    try {
      const result = await send<{ id: string; number: number | null; link: string }>("/api/financeiro/orcamento-viagem", {
        method: "POST",
        body: JSON.stringify({ employeeId: form.employeeId, cpf: form.cpf, reason: form.reason, amount: Number(form.amount), startDate: form.startDate, endDate: form.endDate, bank: form.bank, categoryBudgets }),
      })
      setLink(`${window.location.origin}${result.link}`)
      setForm(emptyForm())
      await load()
      toast({ title: `Antecipação de reembolso para viagem criada${result.number ? ` (${advanceNumber(result.number)})` : ""}`, description: "A saída já foi lançada em Entradas e Saídas. Copie o link e envie para o funcionário." })
    } catch (reason) {
      toast({ title: "Erro ao criar", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  async function downloadTerm(advance: Advance) {
    try {
      const { blob, fileName } = await buildAdvanceTermPdf({ employeeName: advance.employee_name, employeeCpf: advance.employee_cpf || "", companyName: advance.company?.name || "", companyCnpj: advance.company?.cnpj || "", amount: advance.summary.remaining, number: advance.number ?? null })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url; anchor.download = fileName; anchor.click()
      URL.revokeObjectURL(url)
    } catch (reason) { toast({ title: "Não foi possível gerar o termo", description: reason instanceof Error ? reason.message : "", variant: "destructive" }) }
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

  function askCancel(advance: Advance) { setCancelReason(""); setCancelTarget(advance) }

  async function confirmCancel() {
    if (!cancelTarget) return
    if (!cancelReason.trim()) { toast({ title: "Informe o motivo do cancelamento", variant: "destructive" }); return }
    setActing(true)
    try {
      await send(`/api/financeiro/orcamento-viagem/${cancelTarget.id}`, { method: "PATCH", body: JSON.stringify({ action: "cancelar", reason: cancelReason.trim() }) })
      toast({ title: "Antecipação cancelada", description: "O link não aceita mais notinhas e a saída lançada em Entradas e Saídas foi cancelada." })
      setCancelTarget(null); setDetail(null)
      await load()
    } catch (reason) {
      toast({ title: "Não foi possível cancelar", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    } finally { setActing(false) }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setActing(true)
    try {
      await send(`/api/financeiro/orcamento-viagem/${deleteTarget.id}`, { method: "DELETE" })
      toast({ title: "Antecipação excluída", description: "As notinhas e o lançamento da saída também foram apagados." })
      setDeleteTarget(null); setDetail(null)
      await load()
    } catch (reason) {
      toast({ title: "Não foi possível excluir", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    } finally { setActing(false) }
  }

  async function resolveSettlement(id: string) {
    await send(`/api/financeiro/orcamento-viagem/${id}`, { method: "PATCH", body: JSON.stringify({ action: "resolver_devolucao", note: "Confirmado pelo financeiro." }) })
    setDetail(null)
    await load()
  }

  const employeeOptions = employees.map((item) => ({ value: item.id, label: item.name }))

  return (
    <PageShell title="Antecipação de Reembolso para Viagem" description="Valor adiantado ao funcionário para viagem ou visita (a saída já entra em Entradas e Saídas), com prestação de contas por um link público." actions={<>
      <Button variant="outline" asChild><Link href="/financeiro"><ArrowLeft className="h-4 w-4" />Voltar ao Financeiro</Link></Button>
      <Button onClick={() => { setForm(emptyForm()); setLink(""); setSheetOpen(true) }}><Plus className="h-4 w-4" />Nova antecipação de reembolso para viagem</Button>
    </>}>
      {error ? <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}

      <SectionCard title="Pendências de aprovação" description="Notinhas de antecipações de reembolso para viagem já finalizadas pelo funcionário.">
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

      <SectionCard title="Antecipações de reembolso para viagem">
        <DataTable headers={["Nº", "Funcionário", "Motivo", "Período", "Valor", "Gasto", "Saldo", "Status", "Link", ""]} empty={!advances.length && !loading}>
          {advances.map((advance) => (
            <TableRow key={advance.id} className="cursor-pointer" onClick={() => setDetail(advance)}>
              <TableCell className="whitespace-nowrap font-mono text-xs">{advanceNumber(advance.number) || "-"}</TableCell>
              <TableCell>{advance.employee_name}</TableCell>
              <TableCell className="max-w-[200px] truncate">{advance.reason || "-"}</TableCell>
              <TableCell className="whitespace-nowrap">{day(advance.start_date)} - {day(advance.end_date)}</TableCell>
              <TableCell>{brl(advance.amount)}</TableCell>
              <TableCell>{brl(advance.summary.spent)}</TableCell>
              <TableCell className={advance.summary.overspent ? "text-destructive" : ""}>{brl(advance.summary.remaining)}</TableCell>
              <TableCell><StatusBadge status={STATUS_TONE[advance.status] ? advance.status : advance.status} /><span className="ml-1 text-xs text-muted-foreground">{statusLabel(advance.status as never)}</span></TableCell>
              <TableCell onClick={(event) => event.stopPropagation()}><Button size="sm" variant="outline" onClick={() => void copyLink(advance.token)}><Copy className="h-4 w-4" />Copiar link</Button></TableCell>
              <TableCell onClick={(event) => event.stopPropagation()}>
                <div className="flex gap-1">
                  {advance.settlement_action === "desconto_folha" && advance.summary.remaining > 0.004 ? <Button size="sm" variant="outline" title="Baixar o termo de desconto em folha (para o funcionário assinar)" onClick={() => void downloadTerm(advance)}><FileText className="h-4 w-4" />Termo</Button> : null}
                  {canCancelAdvance(advance.status) ? <Button size="sm" variant="ghost" title="Cancelar antecipação" onClick={() => askCancel(advance)}><Ban className="h-4 w-4" /></Button> : null}
                  {mayDelete ? <Button size="sm" variant="ghost" title="Excluir antecipação" className="text-destructive hover:text-destructive" onClick={() => setDeleteTarget(advance)}><Trash2 className="h-4 w-4" /></Button> : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </DataTable>
      </SectionCard>

      <FormSheet open={sheetOpen} onOpenChange={setSheetOpen} title="Nova antecipação de reembolso para viagem" description="Escolha o funcionário, o valor e o prazo: um link é gerado para ele prestar contas." footer={!link ? <SaveButton onClick={() => void createAdvance()} disabled={saving}>{saving ? "Salvando..." : "Criar e gerar link"}</SaveButton> : <Button onClick={() => setSheetOpen(false)}>Concluir</Button>}>
        {link ? (
          <div className="space-y-3">
            <p className="flex items-center gap-2 rounded-md border border-green-600/40 bg-green-600/10 p-3 text-sm"><Receipt className="h-4 w-4 shrink-0" />Antecipação de reembolso para viagem criada. Envie este link para o funcionário.</p>
            <div className="flex gap-2"><Input readOnly value={link} /><Button variant="outline" onClick={() => { void navigator.clipboard.writeText(link); toast({ title: "Link copiado" }) }}><Copy className="h-4 w-4" />Copiar</Button></div>
          </div>
        ) : (
          <div className="space-y-4">
            <SearchableSelectField label="Funcionário" value={form.employeeId} onChange={pickEmployee} options={employeeOptions} placeholder="Escolha o funcionário" />
            <TextField label="CPF do funcionário (vai no termo de desconto em folha)" value={form.cpf} onChange={(value) => setForm((current) => ({ ...current, cpf: value }))} />
            <TextAreaField label="Motivo (viagem, visita...)" value={form.reason} onChange={(value) => setForm((current) => ({ ...current, reason: value }))} />
            <div className="grid gap-4 sm:grid-cols-3">
              <TextField label="Valor do orçamento" type="number" value={form.amount} onChange={(value) => setForm((current) => ({ ...current, amount: value }))} />
              <div className="space-y-2"><Label>Início</Label><Input type="date" value={form.startDate} onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))} /></div>
              <div className="space-y-2"><Label>Prazo final</Label><Input type="date" min={form.startDate} value={form.endDate} onChange={(event) => setForm((current) => ({ ...current, endDate: event.target.value }))} /></div>
            </div>
            <div className="rounded-md border p-3">
              <p className="mb-1 text-sm font-medium">Sub-orçamentos (opcional)</p>
              <p className="mb-3 text-xs text-muted-foreground">Divida o valor total em categorias (ex.: Hospedagem R$ 1.000, Alimentação R$ 900). É só uma referência mostrada para o funcionário: não trava o envio de notinhas.</p>
              <div className="grid gap-3 sm:grid-cols-3">
                {BUDGETABLE_CATEGORIES.map((category) => (
                  <TextField key={category} label={CATEGORY_LABEL[category]} type="number" value={form.categoryBudgets[category]} onChange={(value) => setForm((current) => ({ ...current, categoryBudgets: { ...current.categoryBudgets, [category]: value } }))} />
                ))}
              </div>
              {(() => {
                const allocated = Object.values(form.categoryBudgets).reduce((sum, value) => sum + (Number(value) || 0), 0)
                const total = Number(form.amount) || 0
                const left = Math.round((total - allocated) * 100) / 100
                return allocated > 0 ? <p className={`mt-2 text-xs ${left < 0 ? "text-destructive" : "text-muted-foreground"}`}>{left < 0 ? `Passou do total em ${brl(-left)}.` : `Não dividido: ${brl(left)}.`}</p> : null
              })()}
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

      <Dialog open={Boolean(cancelTarget)} onOpenChange={(open) => { if (!open && !acting) setCancelTarget(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Cancelar antecipação{cancelTarget && advanceNumber(cancelTarget.number) ? ` ${advanceNumber(cancelTarget.number)}` : ""}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{cancelTarget?.employee_name} · {brl(cancelTarget?.amount)}. O link deixa de aceitar notinhas e a saída lançada em Entradas e Saídas fica cancelada. A antecipação continua na lista como "Cancelado".</p>
          <div className="space-y-2"><Label>Motivo do cancelamento (obrigatório)</Label><Textarea rows={3} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Ex.: viagem cancelada, valor lançado errado..." autoFocus /></div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCancelTarget(null)} disabled={acting}>Voltar</Button>
            <Button variant="destructive" onClick={() => void confirmCancel()} disabled={acting || !cancelReason.trim()}>{acting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}Cancelar antecipação</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open && !acting) setDeleteTarget(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Excluir antecipação{deleteTarget && advanceNumber(deleteTarget.number) ? ` ${advanceNumber(deleteTarget.number)}` : ""}</DialogTitle></DialogHeader>
          <p className="text-sm">{deleteTarget?.employee_name} · {brl(deleteTarget?.amount)} · situação {deleteTarget?.status}.</p>
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">A exclusão é definitiva: apaga a antecipação, todas as notinhas (com as fotos) e o lançamento da saída em Entradas e Saídas. Fica só o registro na trilha de auditoria. Para só encerrar, use Cancelar.</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={acting}>Voltar</Button>
            <Button variant="destructive" onClick={() => void confirmDelete()} disabled={acting}>{acting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}Excluir definitivamente</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(detail)} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          {detail ? (
            <>
              <DialogHeader><DialogTitle>{advanceNumber(detail.number) ? `${advanceNumber(detail.number)} · ` : ""}{detail.employee_name} · {detail.reason || "Antecipação de reembolso para viagem"}</DialogTitle></DialogHeader>
              {(canCancelAdvance(detail.status) || mayDelete) ? (
                <div className="flex flex-wrap gap-2">
                  {canCancelAdvance(detail.status) ? <Button size="sm" variant="outline" onClick={() => askCancel(detail)}><Ban className="h-4 w-4" />Cancelar antecipação</Button> : null}
                  {mayDelete ? <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setDeleteTarget(detail)}><Trash2 className="h-4 w-4" />Excluir</Button> : null}
                </div>
              ) : null}
              {detail.status === "Cancelado" ? <p className="rounded-md border border-slate-300 bg-slate-100 p-3 text-sm text-slate-700">Antecipação cancelada{detail.cancelled_by ? ` por ${detail.cancelled_by}` : ""}{detail.cancelled_at ? ` em ${new Date(detail.cancelled_at).toLocaleDateString("pt-BR")}` : ""}.{detail.cancel_reason ? ` Motivo: ${detail.cancel_reason}` : detail.settlement_note ? ` ${detail.settlement_note}` : ""}</p> : null}
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
              {detail.settlement_action === "desconto_folha" ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm">
                  <span>Funcionário optou por descontar {brl(detail.summary.remaining)} do salário.</span>
                  <Button size="sm" variant="outline" onClick={() => void downloadTerm(detail)}><FileText className="h-4 w-4" />Solicitação de adiantamento (termo)</Button>
                </div>
              ) : null}
              {detail.categories.length ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Sub-orçamentos</p>
                  {detail.categories.map((item) => (
                    <div key={item.category} className="text-sm">
                      <div className="flex items-center justify-between"><span>{CATEGORY_LABEL[item.category] || item.category}</span><span className={item.overspent ? "text-destructive" : ""}>{brl(item.spent)} de {brl(item.budget)}</span></div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${item.overspent ? "bg-destructive" : "bg-primary"}`} style={{ width: `${Math.min(100, (item.spent / item.budget) * 100)}%` }} /></div>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="space-y-2">
                <p className="text-sm font-medium">Notinhas enviadas ({detail.receipts.length})</p>
                {detail.receipts.length === 0 ? <p className="text-sm text-muted-foreground">O funcionário ainda não enviou nenhuma notinha.</p> : detail.receipts.map((receipt) => (
                  <div key={receipt.id} className="flex gap-3 rounded-md border p-2 text-sm">
                    <a href={receipt.photo_url} target="_blank" rel="noreferrer" title="Abrir a foto original"><img src={receipt.photo_url} alt="Notinha" className="h-20 w-20 rounded object-cover" /></a>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2"><p className="truncate font-medium">{receipt.establishment || "(estabelecimento não identificado)"}</p><strong className="whitespace-nowrap">{brl(receipt.amount)}</strong></div>
                      <p className="text-xs text-muted-foreground">{CATEGORY_LABEL[receipt.category] || receipt.category} · {receipt.occurred_at ? day(receipt.occurred_at.slice(0, 10)) : "sem data"} · enviada em {receipt.created_at ? new Date(receipt.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "-"}</p>
                      <p className="mt-1 text-xs"><span className={receipt.status === "Aprovado" ? "text-green-700" : receipt.status === "Contestado" ? "text-destructive" : "text-muted-foreground"}>{receipt.status}</span>{receipt.review_note ? ` · ${receipt.review_note}` : ""}</p>
                    </div>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">Para aprovar ou contestar, use a seção "Pendências" acima (aparece quando o funcionário finaliza a prestação de contas).</p>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </PageShell>
  )
}
