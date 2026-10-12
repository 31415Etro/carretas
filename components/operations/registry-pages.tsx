"use client"

import type React from "react"
import { useEffect, useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TableCell, TableRow } from "@/components/ui/table"
import { useAuth } from "@/lib/auth-context"
import { pagePermissionLabels, type PagePermission } from "@/lib/types"
import { SystemCompaniesManager } from "@/components/system-companies-manager"
import { makeId, nowIso, type OperationalState, type Provider } from "@/lib/operational-storage"
import {
  DataTable,
  FormSheet,
  PageShell,
  SaveButton,
  SectionCard,
  SelectField,
  StatusBadge,
  TextAreaField,
  TextField,
  appendAudit,
  names,
  useCrudFeedback,
  useOperationalStore,
} from "./shared"

type SheetKind = "provider" | "user" | ""

const selectablePagePermissions: PagePermission[] = [
  "dashboard",
  "ordens_servico",
  "frota",
  "estoque",
  "compras",
  "financeiro",
  "comercial",
  "orcamento",
  "contratos",
  "relatorios",
  "configuracoes",
]

const clientDefaultPermissions: PagePermission[] = []



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
  const [user, setUser] = useState<Record<string, any>>({ name: "", email: "", phone: "", profile: "Tecnico", temporaryPassword: "123456", status: "Ativo", permissions: ["dashboard", "ordens_servico"], clientId: "" })

  useEffect(() => {
    if (!sheet) return
    if (sheet === "provider") {
      const existingProvider = state.providers.find((item) => item.id === preset?.id)
      setProvider(existingProvider ? { ...emptyProvider, ...existingProvider } : emptyProvider)
    }
    if (sheet === "user") {
      const existingUser = state.systemUsers.find((item) => item.id === preset?.id)
      setUser(existingUser
        ? { ...existingUser, temporaryPassword: "" }
        : { name: "", email: "", phone: "", profile: "Tecnico", temporaryPassword: "123456", status: "Ativo", permissions: ["dashboard", "ordens_servico"], clientId: "" })
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







  async function saveUser() {
    const editingUser = Boolean(user.id)
    const requiredFields: Array<[string, unknown]> = [["Nome", user.name], ["E-mail", user.email], ["Perfil", user.profile]]
    if (!editingUser) requiredFields.push(["Senha", user.temporaryPassword])
    if (!requireFields(requiredFields)) return
    if (user.profile === "Cliente" && !user.clientId) {
      toast({ title: "Empresa obrigatoria", description: "Selecione qual empresa este usuario cliente podera visualizar.", variant: "destructive" })
      return
    }
    const permissions = (Array.isArray(user.permissions) ? user.permissions : String(user.permissions || "").split(","))
      .map((item: string) => item.trim())
      .filter((item: string): item is PagePermission => selectablePagePermissions.includes(item as PagePermission))
    const roleMap: Record<string, string> = {
      Administrador: "admin",
      Supervisor: "manager",
      Atendimento: "sdr",
      Tecnico: "user",
      Técnico: "user",
      Cliente: "client",
    }
    if ((roleMap[user.profile] || "user") !== "admin" && !permissions.length) {
      toast({ title: "Selecione as paginas", description: "Marque pelo menos uma pagina que este usuario podera acessar.", variant: "destructive" })
      return
    }
    try {
      const response = await fetch(editingUser ? `/api/users/${user.id}` : "/api/users/create", {
        method: editingUser ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: user.name,
          email: user.email,
          password: user.temporaryPassword,
          phone: user.phone,
          role: roleMap[user.profile] || "user",
          permissions,
          clientId: user.profile === "Cliente" ? user.clientId : null,
          active: user.status !== "Inativo",
        }),
      })
      const payload = await response.json()
      if (!response.ok) {
        toast({ title: editingUser ? "Erro ao editar usuario" : "Erro ao criar usuario", description: payload.error || "Nao foi possivel salvar no Supabase Auth.", variant: "destructive" })
        return
      }
      const record = { id: editingUser ? user.id : payload.user.id, name: user.name, email: user.email, phone: user.phone, profile: user.profile, temporaryPassword: "", status: user.status, permissions, clientId: user.profile === "Cliente" ? user.clientId : "" }
      commit((current) => ({ ...current, systemUsers: [record as any, ...current.systemUsers.filter((row) => row.id !== record.id && row.email !== record.email)], auditLogs: appendAudit(current, "system_user", record.id, editingUser ? "Editado" : "Criado", `Usuario ${record.name} ${editingUser ? "editado" : "criado"} no Supabase Auth`) }), { persist: false } as any)
      toast({ title: editingUser ? "Usuario atualizado" : "Usuario criado", description: editingUser ? "As alteracoes ja valem no proximo acesso." : "Login e senha ja podem ser usados na tela de login." })
      close()
    } catch (error) {
      toast({ title: "Erro ao criar usuario", description: error instanceof Error ? error.message : "Falha ao chamar API.", variant: "destructive" })
    }
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

      

      <FormSheet open={sheet === "user"} onOpenChange={(open) => !open && close()} title="Usuario e Permissoes">
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label="Nome" value={user.name} onChange={(value) => setUser({ ...user, name: value })} />
          <TextField label="E-mail" value={user.email} onChange={(value) => setUser({ ...user, email: value })} />
          <TextField label="Telefone" value={user.phone} onChange={(value) => setUser({ ...user, phone: value })} />
          <SelectField label="Perfil" value={user.profile} onChange={(value) => setUser({
            ...user,
            profile: value,
            clientId: value === "Cliente" ? user.clientId : "",
            permissions: value === "Administrador" ? selectablePagePermissions : value === "Cliente" ? clientDefaultPermissions : (Array.isArray(user.permissions) ? user.permissions : []),
          })} options={["Administrador", "Supervisor", "Atendimento", "Tecnico", "Cliente"].map((value) => ({ value, label: value }))} />
          <TextField label={user.id ? "Nova senha (opcional)" : "Senha temporaria"} value={user.temporaryPassword} onChange={(value) => setUser({ ...user, temporaryPassword: value })} />
          <SelectField label="Status" value={user.status} onChange={(value) => setUser({ ...user, status: value })} options={["Ativo", "Inativo"].map((value) => ({ value, label: value }))} />
          {user.profile === "Cliente" ? <SelectField label="Empresa/Cliente permitido" value={user.clientId || "nenhum"} onChange={(value) => setUser({ ...user, clientId: value === "nenhum" ? "" : value })} options={[{ value: "nenhum", label: state.clients.length ? "Selecione uma empresa/cliente" : "Nenhum cliente cadastrado" }, ...state.clients.filter((item) => item.status !== "Inativo").map((item) => ({ value: item.id, label: item.name }))]} /> : null}
        </div>
        <div className="space-y-3">
          <div>
            <Label>Paginas permitidas</Label>
            <p className="mt-1 text-sm text-muted-foreground">Selecione exatamente as paginas que aparecerao para este login.</p>
          </div>
          <div className="grid gap-2 rounded-md border p-3 md:grid-cols-2">
            {selectablePagePermissions.map((permission) => {
              const selected = (Array.isArray(user.permissions) ? user.permissions : []).includes(permission)
              return (
                <label key={permission} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                  <Checkbox
                    checked={selected}
                    disabled={user.profile === "Administrador"}
                    onCheckedChange={(checked) => setUser({
                      ...user,
                      permissions: checked === true
                        ? Array.from(new Set([...(Array.isArray(user.permissions) ? user.permissions : []), permission]))
                        : (Array.isArray(user.permissions) ? user.permissions : []).filter((item: string) => item !== permission),
                    })}
                  />
                  {pagePermissionLabels[permission]}
                </label>
              )
            })}
          </div>
        </div>
        {user.profile === "Cliente" ? <p className="text-sm text-muted-foreground">Os dados exibidos nessas paginas ficarao limitados a empresa selecionada.</p> : null}
        <SaveButton onClick={saveUser}>{user.id ? "Salvar alteracoes" : "Salvar usuario"}</SaveButton>
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


export function SettingsPage() {
  const { state, commit } = useOperationalStore()
  const { user } = useAuth()
  const { sheet, setSheet, preset, openSheet } = useSheetWithPreset()
  return (
    <PageShell title="Configurações" description="Usuários e permissões, equipe técnica e empresas (CNPJs) do sistema.">
      <Tabs defaultValue={user?.role === "admin" ? "empresas" : "usuarios"}>
        <TabsList className="flex flex-wrap"><TabsTrigger value="usuarios">Usuários e permissões</TabsTrigger><TabsTrigger value="equipe">Equipe técnica</TabsTrigger>{user?.role === "admin" && <TabsTrigger value="empresas">Empresas / CNPJs</TabsTrigger>}</TabsList>
        <TabsContent value="usuarios"><SectionCard title="Usuarios e permissoes"><Button className="mb-3" onClick={() => openSheet("user")}><Plus className="h-4 w-4" />Novo usuario</Button><DataTable headers={["Nome", "E-mail", "Perfil", "Empresa/Cliente", "Status", "Permissoes", "Acoes"]} empty={!state.systemUsers.length}>{state.systemUsers.map((user) => <TableRow key={user.id}><TableCell>{user.name}</TableCell><TableCell>{user.email}</TableCell><TableCell>{user.profile}</TableCell><TableCell>{user.clientId ? names(state).client(user.clientId) : "-"}</TableCell><TableCell><StatusBadge status={user.status} /></TableCell><TableCell>{user.permissions.map((permission) => pagePermissionLabels[permission as PagePermission] || permission).join(", ")}</TableCell><TableCell><Button size="sm" variant="outline" onClick={() => openSheet("user", { id: user.id })}>Editar</Button></TableCell></TableRow>)}</DataTable></SectionCard></TabsContent>
        <TabsContent value="equipe"><SectionCard title="Equipe técnica" description="Técnicos e equipe executora disponíveis nas ordens de serviço."><Button className="mb-3" onClick={() => openSheet("provider")}><Plus className="h-4 w-4" />Novo técnico</Button><DataTable headers={["Nome", "Cargo", "Vínculo", "Telefone", "E-mail", "Status", "Ações"]} empty={!state.providers.length}>{state.providers.map((provider) => <TableRow key={provider.id}><TableCell>{provider.fullName}</TableCell><TableCell>{provider.role || "-"}</TableCell><TableCell>{provider.relationshipType || "-"}</TableCell><TableCell>{provider.phone || "-"}</TableCell><TableCell>{provider.email || "-"}</TableCell><TableCell><StatusBadge status={provider.status} /></TableCell><TableCell><Button size="sm" variant="outline" onClick={() => openSheet("provider", { id: provider.id })}>Editar</Button></TableCell></TableRow>)}</DataTable></SectionCard></TabsContent>
        {user?.role === "admin" && <TabsContent value="empresas"><SystemCompaniesManager /></TabsContent>}
      </Tabs>
      <QuickSheets state={state} commit={commit} sheet={sheet} setSheet={setSheet} preset={preset} />
    </PageShell>
  )
}

