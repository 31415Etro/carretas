"use client"

import type React from "react"
import { useEffect, useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TableCell, TableRow } from "@/components/ui/table"
import { makeId, nowIso, type OperationalState, type Provider } from "@/lib/operational-storage"
import {
  DataTable,
  FormSheet,
  SaveButton,
  SectionCard,
  SelectField,
  StatusBadge,
  TextAreaField,
  TextField,
  appendAudit,
  useCrudFeedback,
  useOperationalStore,
} from "./shared"

type SheetKind = "provider" | ""

const emptyProvider = {
  fullName: "",
  cpf: "",
  rg: "",
  birthDate: "",
  phone: "",
  email: "",
  zipCode: "",
  street: "",
  number: "",
  complement: "",
  district: "",
  city: "",
  state: "SP",
  role: "Montador",
  relationshipType: "Funcionario",
  status: "Ativo",
  notes: "",
}

function QuickSheets({
  state,
  commit,
  sheet,
  setSheet,
  preset,
}: {
  state: OperationalState
  commit: (updater: (current: OperationalState) => OperationalState, options?: { persist?: boolean }) => void
  sheet: SheetKind
  setSheet: (sheet: SheetKind) => void
  preset?: Record<string, string>
}) {
  const { requireFields, toast } = useCrudFeedback()
  const [provider, setProvider] = useState<Record<string, any>>(emptyProvider)

  useEffect(() => {
    if (!sheet) return
    if (sheet === "provider") {
      const existingProvider = state.providers.find((item) => item.id === preset?.id)
      setProvider(existingProvider ? { ...emptyProvider, ...existingProvider } : emptyProvider)
    }
  }, [sheet, preset, state])

  function close() {
    setSheet("")
  }

  function saveProvider() {
    if (!requireFields([["Nome", provider.fullName], ["Celular", provider.phone], ["Cargo", provider.role]])) return
    const now = nowIso()
    const existing = state.providers.find((item) => item.id === provider.id)
    const record: Provider = {
      ...(provider as any),
      id: existing?.id || provider.id || makeId("provider"),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    }
    commit((current) => ({
      ...current,
      providers: existing
        ? current.providers.map((item) => item.id === record.id ? record : item)
        : [record, ...current.providers],
      auditLogs: appendAudit(current, "provider", record.id, existing ? "Editado" : "Criado", `Prestador ${record.fullName} ${existing ? "editado" : "criado"}`),
    }))
    setProvider(emptyProvider)
    toast({ title: existing ? "Prestador atualizado" : "Prestador salvo" })
    close()
  }

  return (
    <>
      <FormSheet open={sheet === "provider"} onOpenChange={(open) => !open && close()} title={provider.id ? "Editar Prestador" : "Cadastro de Prestador"}>
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label="Nome completo" value={provider.fullName} onChange={(value) => setProvider({ ...provider, fullName: value })} />
          <TextField label="CPF" value={provider.cpf} onChange={(value) => setProvider({ ...provider, cpf: value })} />
          <TextField label="RG" value={provider.rg} onChange={(value) => setProvider({ ...provider, rg: value })} />
          <TextField label="Data de nascimento" type="date" value={provider.birthDate} onChange={(value) => setProvider({ ...provider, birthDate: value })} />
          <TextField label="Celular" value={provider.phone} onChange={(value) => setProvider({ ...provider, phone: value })} />
          <TextField label="E-mail" value={provider.email} onChange={(value) => setProvider({ ...provider, email: value })} />
          <TextField label="Cidade" value={provider.city} onChange={(value) => setProvider({ ...provider, city: value })} />
          <SelectField label="Cargo" value={provider.role} onChange={(value) => setProvider({ ...provider, role: value })} options={["Soldador", "Montador", "Mecânico", "Eletricista", "Pintor", "Funileiro / lixador", "Auxiliar de produção", "Encarregado de produção", "Gerente de produção", "Administrativo"].map((value) => ({ value, label: value }))} />
          <SelectField label="Vinculo" value={provider.relationshipType} onChange={(value) => setProvider({ ...provider, relationshipType: value })} options={["Funcionario", "Terceirizado", "Parceiro"].map((value) => ({ value, label: value }))} />
          <SelectField label="Status" value={provider.status} onChange={(value) => setProvider({ ...provider, status: value })} options={["Ativo", "Inativo", "Em ferias", "Bloqueado"].map((value) => ({ value, label: value }))} />
        </div>
        <TextAreaField label="Observacoes" value={provider.notes} onChange={(value) => setProvider({ ...provider, notes: value })} />
        <SaveButton onClick={saveProvider}>{provider.id ? "Salvar edições" : "Salvar prestador"}</SaveButton>
      </FormSheet>

      


    </>
  )
}

function useSheetWithPreset() {
  const [sheet, setSheet] = useState<SheetKind>("")
  const [preset, setPreset] = useState<Record<string, string>>({})
  const openSheet = (kind: SheetKind, values: Record<string, string> = {}) => {
    setPreset(values)
    setSheet(kind)
  }
  return { sheet, setSheet, preset, openSheet }
}


export function TeamPanel() {
  const { state, commit } = useOperationalStore()
  const { sheet, setSheet, preset, openSheet } = useSheetWithPreset()
  return (
    <>
      <SectionCard title="Equipe técnica" description="Técnicos e equipe executora disponíveis nas ordens de serviço."><Button className="mb-3" onClick={() => openSheet("provider")}><Plus className="h-4 w-4" />Novo técnico</Button><DataTable headers={["Nome", "Cargo", "Vínculo", "Telefone", "E-mail", "Status", "Ações"]} empty={!state.providers.length}>{state.providers.map((provider) => <TableRow key={provider.id}><TableCell>{provider.fullName}</TableCell><TableCell>{provider.role || "-"}</TableCell><TableCell>{provider.relationshipType || "-"}</TableCell><TableCell>{provider.phone || "-"}</TableCell><TableCell>{provider.email || "-"}</TableCell><TableCell><StatusBadge status={provider.status} /></TableCell><TableCell><Button size="sm" variant="outline" onClick={() => openSheet("provider", { id: provider.id })}>Editar</Button></TableCell></TableRow>)}</DataTable></SectionCard>
      <QuickSheets state={state} commit={commit} sheet={sheet} setSheet={setSheet} preset={preset} />
    </>
  )
}

