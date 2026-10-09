"use client"

import { useState } from "react"
import { AlertTriangle, Pencil, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, FormSheet, SaveButton, SectionCard, SelectField, StatusBadge, TextAreaField, TextField, useCrudFeedback } from "@/components/operations/shared"
import { bankAccountBalance, bankAccountTypeOptions, dueAlerts, paymentMethodOptions } from "@/lib/finance-erp"
import {
  type BankAccount,
  type CostCenter,
  type FinancialCategory,
  type FinancialState,
  type PaymentCondition,
  financeId,
  financeNow,
  financeToday,
  money,
  parseMoney,
} from "@/lib/financial-storage"

type Commit = (updater: (current: FinancialState) => FinancialState) => void
type Registry = "banco" | "categoria" | "centro" | "condicao" | ""

const statusOptions = ["Ativo", "Inativo"].map((value) => ({ value, label: value }))
const natureLabels: Record<string, string> = { entrada: "Receita", saida: "Despesa", ambos: "Receita e despesa" }

const emptyBank = { name: "", bankName: "", bankCode: "", agency: "", accountNumber: "", accountType: "Corrente", holderName: "", holderDocument: "", pixKey: "", initialBalance: "0", initialBalanceDate: financeToday(), status: "Ativo", notes: "" }
const emptyCategory = { code: "", name: "", type: "saida", group: "", dreAccountId: "dre-sem-classificacao", status: "Ativo" }
const emptyCostCenter = { code: "", name: "", description: "", responsible: "", unit: "", status: "Ativo" }
const emptyCondition = { name: "", installments: "1", firstDueDays: "0", intervalDays: "30", paymentMethod: "Boleto", status: "Ativo" }

function upsert<T extends { id: string }>(rows: T[], record: T) {
  return rows.some((row) => row.id === record.id) ? rows.map((row) => row.id === record.id ? record : row) : [record, ...rows]
}

function duplicatedCode(rows: Array<{ id: string; code?: string }>, code: string, id: string) {
  const normalized = code.trim().toLowerCase()
  return Boolean(normalized) && rows.some((row) => row.id !== id && String(row.code || "").trim().toLowerCase() === normalized)
}

export function FinanceRegistriesTab({ state, commit }: { state: FinancialState; commit: Commit }) {
  const { requireFields, toast } = useCrudFeedback()
  const [open, setOpen] = useState<Registry>("")
  const [editingId, setEditingId] = useState("")
  const [bank, setBank] = useState<Record<string, string>>(emptyBank)
  const [category, setCategory] = useState<Record<string, string>>(emptyCategory)
  const [costCenter, setCostCenter] = useState<Record<string, string>>(emptyCostCenter)
  const [condition, setCondition] = useState<Record<string, string>>(emptyCondition)

  function close() {
    setOpen("")
    setEditingId("")
  }

  function edit(kind: Exclude<Registry, "">, item?: BankAccount | FinancialCategory | CostCenter | PaymentCondition) {
    setEditingId(item?.id || "")
    const asForm = (record: object | undefined, empty: Record<string, string>) =>
      Object.fromEntries(Object.keys(empty).map((key) => [key, record && (record as any)[key] !== undefined && (record as any)[key] !== null ? String((record as any)[key]) : empty[key]]))
    if (kind === "banco") setBank(asForm(item, emptyBank))
    if (kind === "categoria") setCategory(asForm(item, emptyCategory))
    if (kind === "centro") setCostCenter(asForm(item, emptyCostCenter))
    if (kind === "condicao") setCondition(asForm(item, emptyCondition))
    setOpen(kind)
  }

  function saveBank() {
    if (!requireFields([["Nome da conta", bank.name], ["Tipo", bank.accountType]])) return
    if (bank.accountType !== "Caixa" && !requireFields([["Banco", bank.bankName], ["Agência", bank.agency], ["Conta", bank.accountNumber]])) return
    const now = financeNow()
    const existing = state.bankAccounts.find((item) => item.id === editingId)
    const record: BankAccount = { ...(bank as any), id: existing?.id || financeId("bank"), initialBalance: parseMoney(bank.initialBalance), createdAt: existing?.createdAt || now, updatedAt: now }
    commit((current) => ({ ...current, bankAccounts: upsert(current.bankAccounts || [], record) }))
    toast({ title: existing ? "Conta bancária atualizada" : "Conta bancária cadastrada", description: record.name })
    close()
  }

  function saveCategory() {
    if (!requireFields([["Nome", category.name], ["Natureza", category.type]])) return
    if (duplicatedCode(state.categories, category.code, editingId)) {
      toast({ title: "Código já usado", description: `Já existe uma categoria com o código ${category.code}.`, variant: "destructive" })
      return
    }
    const now = financeNow()
    const existing = state.categories.find((item) => item.id === editingId)
    const record: FinancialCategory = { ...(existing || {}), ...(category as any), id: existing?.id || financeId("cat"), createdAt: existing?.createdAt || now, updatedAt: now }
    commit((current) => ({ ...current, categories: upsert(current.categories, record) }))
    toast({ title: existing ? "Categoria atualizada" : "Categoria cadastrada", description: record.name })
    close()
  }

  function saveCostCenter() {
    if (!requireFields([["Nome", costCenter.name]])) return
    if (duplicatedCode(state.costCenters, costCenter.code, editingId)) {
      toast({ title: "Código já usado", description: `Já existe um centro de custo com o código ${costCenter.code}.`, variant: "destructive" })
      return
    }
    const now = financeNow()
    const existing = state.costCenters.find((item) => item.id === editingId)
    const record: CostCenter = { ...(costCenter as any), id: existing?.id || financeId("cc"), createdAt: existing?.createdAt || now, updatedAt: now }
    commit((current) => ({ ...current, costCenters: upsert(current.costCenters, record) }))
    toast({ title: existing ? "Centro de custo atualizado" : "Centro de custo cadastrado", description: record.name })
    close()
  }

  function saveCondition() {
    const installments = Number(condition.installments)
    if (!requireFields([["Nome", condition.name]])) return
    if (!Number.isInteger(installments) || installments < 1 || installments > 120) {
      toast({ title: "Parcelas inválidas", description: "Informe de 1 a 120 parcelas.", variant: "destructive" })
      return
    }
    const now = financeNow()
    const existing = state.paymentConditions.find((item) => item.id === editingId)
    const record: PaymentCondition = {
      id: existing?.id || financeId("cond"),
      name: condition.name,
      installments,
      firstDueDays: Math.max(0, Number(condition.firstDueDays) || 0),
      intervalDays: Math.max(0, Number(condition.intervalDays) || 0),
      paymentMethod: condition.paymentMethod,
      status: condition.status as PaymentCondition["status"],
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    }
    commit((current) => ({ ...current, paymentConditions: upsert(current.paymentConditions || [], record) }))
    toast({ title: existing ? "Condição atualizada" : "Condição cadastrada", description: record.name })
    close()
  }

  const dreOptions = state.dreAccounts.map((item) => ({ value: item.id, label: item.name }))
  const editButton = (kind: Exclude<Registry, "">, item: any) => <Button size="sm" variant="outline" onClick={() => edit(kind, item)}><Pencil className="h-4 w-4" />Editar</Button>

  return (
    <div className="space-y-4">
      <SectionCard title="Contas bancárias e caixa" description="O saldo atual soma o saldo inicial com as entradas e saídas realizadas na conta.">
        <Button className="mb-3" onClick={() => edit("banco")}><Plus className="h-4 w-4" />Nova conta</Button>
        <DataTable headers={["Conta", "Tipo", "Banco", "Agência / Conta", "Titular", "CPF/CNPJ", "Chave Pix", "Saldo inicial", "Saldo atual", "Status", "Ações"]} empty={!state.bankAccounts.length}>
          {state.bankAccounts.map((item) => <TableRow key={item.id}><TableCell>{item.name}</TableCell><TableCell>{bankAccountTypeOptions.find((option) => option.value === item.accountType)?.label || item.accountType}</TableCell><TableCell>{[item.bankCode, item.bankName].filter(Boolean).join(" - ") || "-"}</TableCell><TableCell>{item.agency || item.accountNumber ? `${item.agency || "-"} / ${item.accountNumber || "-"}` : "-"}</TableCell><TableCell>{item.holderName || "-"}</TableCell><TableCell>{item.holderDocument || "-"}</TableCell><TableCell>{item.pixKey || "-"}</TableCell><TableCell>{money(item.initialBalance)}</TableCell><TableCell className="font-semibold">{money(bankAccountBalance(state, item.id))}</TableCell><TableCell><StatusBadge status={item.status} /></TableCell><TableCell>{editButton("banco", item)}</TableCell></TableRow>)}
        </DataTable>
      </SectionCard>

      <SectionCard title="Categorias financeiras">
        <Button className="mb-3" onClick={() => edit("categoria")}><Plus className="h-4 w-4" />Nova categoria</Button>
        <DataTable headers={["Código", "Nome", "Natureza", "Grupo", "Conta DRE", "Status", "Ações"]} empty={!state.categories.length}>
          {[...state.categories].sort((a, b) => String(a.code || "~").localeCompare(String(b.code || "~"), "pt-BR", { numeric: true }) || a.name.localeCompare(b.name, "pt-BR")).map((item) => <TableRow key={item.id}><TableCell className="font-mono">{item.code || "-"}</TableCell><TableCell>{item.name}</TableCell><TableCell>{natureLabels[item.type] || item.type}</TableCell><TableCell>{item.group || "-"}</TableCell><TableCell>{state.dreAccounts.find((dre) => dre.id === item.dreAccountId)?.name || "-"}</TableCell><TableCell><StatusBadge status={item.status} /></TableCell><TableCell>{editButton("categoria", item)}</TableCell></TableRow>)}
        </DataTable>
      </SectionCard>

      <SectionCard title="Centros de custo">
        <Button className="mb-3" onClick={() => edit("centro")}><Plus className="h-4 w-4" />Novo centro de custo</Button>
        <DataTable headers={["Código", "Nome", "Responsável", "Unidade", "Descrição", "Status", "Ações"]} empty={!state.costCenters.length}>
          {state.costCenters.map((item) => <TableRow key={item.id}><TableCell className="font-mono">{item.code || "-"}</TableCell><TableCell>{item.name}</TableCell><TableCell>{item.responsible || "-"}</TableCell><TableCell>{item.unit || "-"}</TableCell><TableCell>{item.description || "-"}</TableCell><TableCell><StatusBadge status={item.status} /></TableCell><TableCell>{editButton("centro", item)}</TableCell></TableRow>)}
        </DataTable>
      </SectionCard>

      <SectionCard title="Condições de pagamento" description="Usadas para gerar as parcelas automaticamente nas contas a pagar e a receber.">
        <Button className="mb-3" onClick={() => edit("condicao")}><Plus className="h-4 w-4" />Nova condição</Button>
        <DataTable headers={["Nome", "Parcelas", "1º vencimento", "Intervalo", "Forma de cobrança", "Status", "Ações"]} empty={!state.paymentConditions.length}>
          {state.paymentConditions.map((item) => <TableRow key={item.id}><TableCell>{item.name}</TableCell><TableCell>{item.installments === 1 ? "À vista / única" : `${item.installments}x`}</TableCell><TableCell>{item.firstDueDays ? `${item.firstDueDays} dias` : "Na emissão"}</TableCell><TableCell>{item.installments > 1 ? `${item.intervalDays} dias` : "-"}</TableCell><TableCell>{item.paymentMethod || "-"}</TableCell><TableCell><StatusBadge status={item.status} /></TableCell><TableCell>{editButton("condicao", item)}</TableCell></TableRow>)}
        </DataTable>
      </SectionCard>

      <FormSheet open={open === "banco"} onOpenChange={(value) => !value && close()} title={editingId ? "Editar conta bancária" : "Nova conta bancária"}>
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label="Nome da conta" value={bank.name} onChange={(value) => setBank({ ...bank, name: value })} placeholder="Ex.: Itaú movimento, Caixa loja" />
          <SelectField label="Tipo" value={bank.accountType} onChange={(value) => setBank({ ...bank, accountType: value })} options={bankAccountTypeOptions} />
          <TextField label="Banco" value={bank.bankName} onChange={(value) => setBank({ ...bank, bankName: value })} />
          <TextField label="Código do banco" value={bank.bankCode} onChange={(value) => setBank({ ...bank, bankCode: value })} placeholder="Ex.: 341" />
          <TextField label="Agência" value={bank.agency} onChange={(value) => setBank({ ...bank, agency: value })} />
          <TextField label="Conta" value={bank.accountNumber} onChange={(value) => setBank({ ...bank, accountNumber: value })} />
          <TextField label="Titular" value={bank.holderName} onChange={(value) => setBank({ ...bank, holderName: value })} />
          <TextField label="CPF/CNPJ do titular" value={bank.holderDocument} onChange={(value) => setBank({ ...bank, holderDocument: value })} />
          <TextField label="Chave Pix" value={bank.pixKey} onChange={(value) => setBank({ ...bank, pixKey: value })} />
          <TextField label="Saldo inicial (R$)" value={bank.initialBalance} onChange={(value) => setBank({ ...bank, initialBalance: value })} />
          <TextField label="Data do saldo inicial" type="date" value={bank.initialBalanceDate} onChange={(value) => setBank({ ...bank, initialBalanceDate: value })} />
          <SelectField label="Status" value={bank.status} onChange={(value) => setBank({ ...bank, status: value })} options={statusOptions} />
        </div>
        <TextAreaField label="Observações" value={bank.notes} onChange={(value) => setBank({ ...bank, notes: value })} />
        <SaveButton onClick={saveBank}>Salvar conta</SaveButton>
      </FormSheet>

      <FormSheet open={open === "categoria"} onOpenChange={(value) => !value && close()} title={editingId ? "Editar categoria" : "Nova categoria financeira"}>
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label="Código" value={category.code} onChange={(value) => setCategory({ ...category, code: value })} placeholder="Ex.: 3.1.01" />
          <TextField label="Nome" value={category.name} onChange={(value) => setCategory({ ...category, name: value })} />
          <SelectField label="Natureza" value={category.type} onChange={(value) => setCategory({ ...category, type: value })} options={Object.entries(natureLabels).map(([value, label]) => ({ value, label }))} />
          <TextField label="Grupo" value={category.group} onChange={(value) => setCategory({ ...category, group: value })} placeholder="Ex.: Receitas operacionais" />
          <SelectField label="Conta DRE" value={category.dreAccountId} onChange={(value) => setCategory({ ...category, dreAccountId: value })} options={dreOptions} />
          <SelectField label="Status" value={category.status} onChange={(value) => setCategory({ ...category, status: value })} options={statusOptions} />
        </div>
        <SaveButton onClick={saveCategory}>Salvar categoria</SaveButton>
      </FormSheet>

      <FormSheet open={open === "centro"} onOpenChange={(value) => !value && close()} title={editingId ? "Editar centro de custo" : "Novo centro de custo"}>
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label="Código" value={costCenter.code} onChange={(value) => setCostCenter({ ...costCenter, code: value })} />
          <TextField label="Nome" value={costCenter.name} onChange={(value) => setCostCenter({ ...costCenter, name: value })} />
          <TextField label="Responsável" value={costCenter.responsible} onChange={(value) => setCostCenter({ ...costCenter, responsible: value })} />
          <TextField label="Unidade" value={costCenter.unit} onChange={(value) => setCostCenter({ ...costCenter, unit: value })} placeholder="Ex.: Matriz, Filial" />
          <SelectField label="Status" value={costCenter.status} onChange={(value) => setCostCenter({ ...costCenter, status: value })} options={statusOptions} />
        </div>
        <TextAreaField label="Descrição" value={costCenter.description} onChange={(value) => setCostCenter({ ...costCenter, description: value })} />
        <SaveButton onClick={saveCostCenter}>Salvar centro de custo</SaveButton>
      </FormSheet>

      <FormSheet open={open === "condicao"} onOpenChange={(value) => !value && close()} title={editingId ? "Editar condição de pagamento" : "Nova condição de pagamento"} description="Ex.: 3 parcelas, 1º vencimento em 30 dias e intervalo de 30 dias = 30/60/90.">
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label="Nome" value={condition.name} onChange={(value) => setCondition({ ...condition, name: value })} placeholder="Ex.: 30/60/90 dias" />
          <TextField label="Número de parcelas" type="number" value={condition.installments} onChange={(value) => setCondition({ ...condition, installments: value })} />
          <TextField label="Dias até o 1º vencimento" type="number" value={condition.firstDueDays} onChange={(value) => setCondition({ ...condition, firstDueDays: value })} />
          <TextField label="Intervalo entre parcelas (dias)" type="number" value={condition.intervalDays} onChange={(value) => setCondition({ ...condition, intervalDays: value })} />
          <SelectField label="Forma de cobrança" value={condition.paymentMethod} onChange={(value) => setCondition({ ...condition, paymentMethod: value })} options={paymentMethodOptions.map((value) => ({ value, label: value }))} />
          <SelectField label="Status" value={condition.status} onChange={(value) => setCondition({ ...condition, status: value })} options={statusOptions} />
        </div>
        <SaveButton onClick={saveCondition}>Salvar condição</SaveButton>
      </FormSheet>
    </div>
  )
}

export function DueAlertsPanel({ state, clientName, kind }: { state: FinancialState; clientName: (id: string) => string; kind?: "pagar" | "receber" }) {
  const alerts = dueAlerts(state, clientName).filter((item) => !kind || item.kind === kind)
  if (!alerts.length) return null
  const overdue = alerts.filter((item) => item.overdue)
  const upcoming = alerts.filter((item) => !item.overdue)
  const total = (items: typeof alerts) => money(items.reduce((sum, item) => sum + item.openAmount, 0))
  return (
    <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <div className="mb-2 flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4 text-amber-600" />Alertas de vencimento</div>
      <p>{overdue.length} conta(s) vencida(s) — {total(overdue)} · {upcoming.length} vencendo nos próximos 7 dias — {total(upcoming)}</p>
      <ul className="mt-2 space-y-1">
        {alerts.slice(0, 6).map((item) => <li key={`${item.kind}-${item.id}`} className={item.overdue ? "text-destructive" : ""}>{item.dueDate.split("-").reverse().join("/")} · {item.kind === "pagar" ? "Pagar" : "Receber"} · {item.party || "-"} · {item.description} · {money(item.openAmount)}</li>)}
      </ul>
      {alerts.length > 6 ? <p className="mt-1 text-xs text-muted-foreground">+ {alerts.length - 6} conta(s)</p> : null}
    </div>
  )
}
