"use client"

import type React from "react"
import { useEffect, useRef, useState } from "react"
import {
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  Plus,
  
  Search,
  
  
  
  
  
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TableCell, TableRow } from "@/components/ui/table"
import { useAuth } from "@/lib/auth-context"
import { pagePermissionLabels, type PagePermission } from "@/lib/types"
import { compareAlphaNumeric } from "@/lib/utils"
import { cnpjRegistrationNotes, cleanCpfCnpj, formatCpfCnpjDocument, type CnpjCompany } from "@/lib/cnpj-lookup"
import { SystemCompaniesManager } from "@/components/system-companies-manager"
import {
  
  type Client,
  
  
  
  type OperationalState,
  type Provider,
  
  
  
  
  
  type Supplier,
  type Vehicle,
  
  
  
  
  
  
  formatDate,
  
  makeId,
  
  
  nowIso,
  
  
  today,
} from "@/lib/operational-storage"
import {
  AlertRow,
  ConfirmInline,
  DataTable,
  FormSheet,
  
  PageShell,
  SaveButton,
  SearchableSelectField,
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

type SheetKind = "client" | "supplier" | "provider" | "vehicle" | "user" | "maintenance" | "usage" | ""

const selectablePagePermissions: PagePermission[] = [
  "dashboard",
  "clientes",
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



function normalizeClientImportKey(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

















const emptyClient = {
  type: "PJ",
  name: "",
  document: "",
  corporateName: "",
  tradeName: "",
  stateRegistration: "",
  responsibleName: "",
  phone: "",
  mobile: "",
  email: "",
  zipCode: "",
  street: "",
  number: "",
  complement: "",
  district: "",
  city: "",
  state: "SP",
  status: "Ativo",
  notes: "",
}

const emptySupplier = {
  name: "",
  document: "",
  contactName: "",
  phone: "",
  email: "",
  category: "",
  categoryIds: [] as string[],
  city: "",
  state: "SP",
  status: "Ativo",
  notes: "",
}

function CnpjLookupField({ value, onChange, onLookup, loading, label = "CPF/CNPJ" }: { value: string; onChange: (value: string) => void; onLookup: () => void; loading: boolean; label?: string }) {
  const document = cleanCpfCnpj(value)
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          inputMode="text"
          value={value}
          onChange={(event) => onChange(formatCpfCnpjDocument(event.target.value))}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onLookup() } }}
          placeholder="CPF ou CNPJ"
        />
        {document.length === 14 ? <Button type="button" variant="outline" size="icon" onClick={onLookup} disabled={loading} title="Consultar dados do CNPJ">
          <Search className={`h-4 w-4 ${loading ? "animate-pulse" : ""}`} />
        </Button> : null}
      </div>
      {loading ? <p className="text-xs text-muted-foreground">Consultando dados cadastrais...</p> : null}
    </div>
  )
}

function withCnpjNotes(current: string, company: CnpjCompany) {
  const details = cnpjRegistrationNotes(company)
  const previous = String(current || "").split("\n\nDados do CNPJ:\n")[0].trim()
  return [previous, details ? `Dados do CNPJ:\n${details}` : ""].filter(Boolean).join("\n\n")
}






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

const emptyVehicle = {
  plate: "",
  model: "",
  brand: "",
  year: "",
  color: "",
  currentKm: "0",
  frontRightTire: "Novo",
  frontLeftTire: "Novo",
  rearRightTire: "Novo",
  rearLeftTire: "Novo",
  lastOilChangeDate: "",
  lastOilChangeKm: "0",
  status: "Disponivel",
  renavam: "",
  licensingDueDate: "",
  insuranceInfo: "",
  notes: "",
}











const tireOptions = ["Novo", "3/4 vida", "Meia vida", "1/4 vida", "Solicitar troca"]


function dateTime(value: string) {
  return value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "-"
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
  const [client, setClient] = useState<Record<string, any>>(emptyClient)
  const [supplier, setSupplier] = useState<Record<string, any>>(emptySupplier)
  const [supplierCategories, setSupplierCategories] = useState<Array<{ id: string; name: string }>>([])
  const [supplierCategoriesLoading, setSupplierCategoriesLoading] = useState(false)
  const [supplierCategoriesError, setSupplierCategoriesError] = useState("")
  const [provider, setProvider] = useState<Record<string, any>>(emptyProvider)
  const [vehicle, setVehicle] = useState<Record<string, any>>(emptyVehicle)
  const [savingClient, setSavingClient] = useState(false)
  const savingClientRef = useRef(false)
  const [savingSupplier, setSavingSupplier] = useState(false)
  const savingSupplierRef = useRef(false)
  const [cnpjLookupTarget, setCnpjLookupTarget] = useState<"client" | "supplier" | "">("")
  const lastAutomaticCnpjRef = useRef("")
  const [user, setUser] = useState<Record<string, any>>({ name: "", email: "", phone: "", profile: "Tecnico", temporaryPassword: "123456", status: "Ativo", permissions: ["dashboard", "ordens_servico"], clientId: "" })

  useEffect(() => {
    if (!sheet) return
    if (sheet === "client") {
      const existingClient = state.clients.find((item) => item.id === preset?.id)
      setClient(existingClient ? { ...emptyClient, ...existingClient } : emptyClient)
    }
    if (sheet === "supplier") {
      const existingSupplier = state.suppliers.find((item) => item.id === preset?.id)
      setSupplier(existingSupplier ? { ...emptySupplier, ...existingSupplier, categoryIds: existingSupplier.categoryIds || [] } : emptySupplier)
    }
    if (sheet === "provider") {
      const existingProvider = state.providers.find((item) => item.id === preset?.id)
      setProvider(existingProvider ? { ...emptyProvider, ...existingProvider } : emptyProvider)
    }
    if (sheet === "vehicle") {
      const existingVehicle = state.vehicles.find((item) => item.id === preset?.id)
      setVehicle(existingVehicle ? { ...emptyVehicle, ...existingVehicle } : emptyVehicle)
    }
    if (sheet === "user") {
      const existingUser = state.systemUsers.find((item) => item.id === preset?.id)
      setUser(existingUser
        ? { ...existingUser, temporaryPassword: "" }
        : { name: "", email: "", phone: "", profile: "Tecnico", temporaryPassword: "123456", status: "Ativo", permissions: ["dashboard", "ordens_servico"], clientId: "" })
    }
  }, [sheet, preset, state])

  useEffect(() => {
    const target = sheet === "client" && !client.id
      ? "client"
      : sheet === "supplier" && !supplier.id ? "supplier" : ""
    if (!target) return
    const document = cleanCpfCnpj(target === "client" ? client.document : supplier.document)
    const key = `${target}:${document}`
    if (document.length !== 14 || lastAutomaticCnpjRef.current === key) return
    const timer = window.setTimeout(() => {
      lastAutomaticCnpjRef.current = key
      void lookupCnpj(target, true)
    }, 500)
    return () => window.clearTimeout(timer)
  }, [sheet, client.type, client.id, client.document, supplier.id, supplier.document])

  useEffect(() => {
    if (sheet !== "supplier") return
    let active = true
    setSupplierCategoriesLoading(true)
    setSupplierCategoriesError("")
    fetch("/api/financial-categories/options", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null)
        if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
        if (active) setSupplierCategories(Array.isArray(payload?.categories) ? payload.categories : [])
      })
      .catch((error) => {
        if (active) setSupplierCategoriesError(error instanceof Error ? error.message : "Erro ao carregar categorias")
      })
      .finally(() => {
        if (active) setSupplierCategoriesLoading(false)
      })
    return () => { active = false }
  }, [sheet])

  useEffect(() => {
    if (sheet !== "supplier" || !supplierCategories.length) return
    setSupplier((current) => {
      if (current.categoryIds?.length || !current.category) return current
      const legacyNames = String(current.category).split(/[,;]/).map((value) => value.trim().toLocaleLowerCase("pt-BR")).filter(Boolean)
      const categoryIds = supplierCategories.filter((item) => legacyNames.includes(item.name.toLocaleLowerCase("pt-BR"))).map((item) => item.id)
      return categoryIds.length ? { ...current, categoryIds } : current
    })
  }, [sheet, supplierCategories])

  async function lookupCnpj(target: "client" | "supplier", automatic = false) {
    const document = cleanCpfCnpj(target === "client" ? client.document : supplier.document)
    if (document.length !== 14) {
      if (!automatic) toast({ title: "CNPJ incompleto", description: "Informe os 14 caracteres do CNPJ.", variant: "destructive" })
      return
    }
    setCnpjLookupTarget(target)
    try {
      const response = await fetch(`/api/cnpj/${encodeURIComponent(document)}`, { cache: "no-store" })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.company) throw new Error(payload?.error || `Falha ao consultar CNPJ (HTTP ${response.status}).`)
      const company = payload.company as CnpjCompany
      if (target === "client") {
        setClient((current) => ({
          ...current,
          type: "PJ",
          document: company.document,
          name: company.legalName || current.name,
          corporateName: company.legalName || current.corporateName,
          tradeName: company.tradeName || current.tradeName,
          phone: company.phone || current.phone,
          mobile: company.phone || current.mobile,
          email: company.email || current.email,
          zipCode: company.zipCode || current.zipCode,
          street: company.street || current.street,
          number: company.number || current.number,
          complement: company.complement || current.complement,
          district: company.district || current.district,
          city: company.city || current.city,
          state: company.state || current.state,
          notes: withCnpjNotes(current.notes, company),
        }))
      } else {
        setSupplier((current) => ({
          ...current,
          document: company.document,
          name: company.tradeName || company.legalName || current.name,
          phone: company.phone || current.phone,
          email: company.email || current.email,
          city: company.city || current.city,
          state: company.state || current.state,
          notes: withCnpjNotes(current.notes, company),
        }))
      }
      toast({ title: "CNPJ encontrado", description: `${company.tradeName || company.legalName} preenchido automaticamente.` })
    } catch (error) {
      toast({ title: "Nao foi possivel consultar o CNPJ", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" })
    } finally {
      setCnpjLookupTarget("")
    }
  }

  function close() {
    setSheet("")
  }

  async function saveClient() {
    if (savingClientRef.current) return
    if (!requireFields([["Nome ou razao social", client.name], ["CPF/CNPJ", client.document]])) return
    const now = nowIso()
    const existing = state.clients.find((item) => item.id === client.id)
    const record: Client = { ...(client as any), id: existing?.id || client.id || makeId("client"), createdAt: existing?.createdAt || now, updatedAt: now }
    savingClientRef.current = true
    setSavingClient(true)
    setClient((current) => ({ ...current, id: record.id }))
    try {
      const response = await fetch("/api/clients", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client: record }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || `Falha ao salvar cliente (HTTP ${response.status}).`)
      const saved: Client = payload.client
      commit((current) => ({
        ...current,
        clients: [saved, ...current.clients.filter((item) => item.id !== saved.id)],
        auditLogs: appendAudit(current, "client", saved.id, existing ? "Editado" : "Criado", `Cliente ${saved.name} ${existing ? "editado" : "criado"}`),
      }), { persist: false })
      setClient(emptyClient)
      toast({ title: existing ? "Cliente atualizado" : "Cliente salvo", description: "Cadastro atualizado no banco de dados." })
      close()
    } catch (error) {
      toast({ title: "Erro ao salvar no banco", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" })
    } finally {
      savingClientRef.current = false
      setSavingClient(false)
    }
  }



  async function saveSupplier() {
    if (savingSupplierRef.current) return
    if (!requireFields([["Fornecedor", supplier.name], ["Telefone", supplier.phone]])) return
    const now = nowIso()
    const existing = (state.suppliers || []).find((item) => item.id === supplier.id)
    const categoryIds = Array.from(new Set((supplier.categoryIds || []).filter(Boolean))) as string[]
    const selectedCategoryNames = categoryIds.map((id) => supplierCategories.find((item) => item.id === id)?.name).filter(Boolean) as string[]
    const record: Supplier = { ...(supplier as any), id: existing?.id || supplier.id || makeId("supplier"), categoryIds, category: selectedCategoryNames.join(", ") || supplier.category || "", createdAt: existing?.createdAt || now, updatedAt: now }
    savingSupplierRef.current = true
    setSavingSupplier(true)
    setSupplier((current) => ({ ...current, id: record.id }))
    try {
      const response = await fetch("/api/suppliers", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ supplier: record }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || `Falha ao salvar fornecedor (HTTP ${response.status}).`)
      const saved: Supplier = payload.supplier
      commit((current) => ({
        ...current,
        suppliers: [saved, ...(current.suppliers || []).filter((item) => item.id !== saved.id)],
        auditLogs: appendAudit(current, "supplier", saved.id, existing ? "Editado" : "Criado", `Fornecedor ${saved.name} ${existing ? "editado" : "criado"}`),
      }), { persist: false })
      setSupplier(emptySupplier)
      toast({ title: existing ? "Fornecedor atualizado" : "Fornecedor salvo", description: "Cadastro atualizado no banco de dados." })
      close()
    } catch (error) {
      toast({ title: "Erro ao salvar no banco", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" })
    } finally {
      savingSupplierRef.current = false
      setSavingSupplier(false)
    }
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

  function saveVehicle() {
    if (!requireFields([["Placa", vehicle.plate], ["Modelo", vehicle.model], ["Marca", vehicle.brand]])) return
    const now = nowIso()
    const existing = state.vehicles.find((item) => item.id === vehicle.id)
    const record: Vehicle = {
      ...(vehicle as any),
      id: existing?.id || vehicle.id || makeId("vehicle"),
      currentKm: Number(vehicle.currentKm || 0),
      lastOilChangeKm: Number(vehicle.lastOilChangeKm || 0),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    }
    commit((current) => ({
      ...current,
      vehicles: existing
        ? current.vehicles.map((item) => item.id === record.id ? record : item)
        : [record, ...current.vehicles],
      auditLogs: appendAudit(current, "vehicle", record.id, existing ? "Editado" : "Criado", `Veiculo ${record.plate} ${existing ? "editado" : "criado"}`),
    }))
    setVehicle(emptyVehicle)
    toast({ title: existing ? "Veiculo atualizado" : "Veiculo salvo" })
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
      <FormSheet open={sheet === "client"} onOpenChange={(open) => !open && close()} title="Cadastro de Cliente" description="Dados principais, endereco e dados comerciais.">
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField label="Tipo de cliente" value={client.type} onChange={(value) => setClient({ ...client, type: value })} options={[{ value: "PF", label: "Pessoa Fisica" }, { value: "PJ", label: "Pessoa Juridica" }]} />
          <SelectField label="Status" value={client.status} onChange={(value) => setClient({ ...client, status: value })} options={["Ativo", "Inativo", "Prospect"].map((value) => ({ value, label: value }))} />
          <TextField label={client.type === "PF" ? "Nome completo" : "Razao social"} value={client.name} onChange={(value) => setClient({ ...client, name: value })} />
          <CnpjLookupField value={client.document} onChange={(value) => {
            const length = cleanCpfCnpj(value).length
            setClient({ ...client, document: value, type: length === 11 ? "PF" : length === 14 ? "PJ" : client.type })
          }} onLookup={() => lookupCnpj("client")} loading={cnpjLookupTarget === "client"} />
          {client.type === "PJ" ? <TextField label="Nome fantasia" value={client.tradeName} onChange={(value) => setClient({ ...client, tradeName: value })} /> : null}
          {client.type === "PJ" ? <TextField label="Inscricao estadual" value={client.stateRegistration} onChange={(value) => setClient({ ...client, stateRegistration: value })} /> : null}
          <TextField label="Responsavel" value={client.responsibleName} onChange={(value) => setClient({ ...client, responsibleName: value })} />
          <TextField label="Telefone/Celular" value={client.mobile || client.phone} onChange={(value) => setClient({ ...client, mobile: value, phone: value })} />
          <TextField label="E-mail" value={client.email} onChange={(value) => setClient({ ...client, email: value })} />
          <TextField label="CEP" value={client.zipCode} onChange={(value) => setClient({ ...client, zipCode: value })} />
          <TextField label="Rua" value={client.street} onChange={(value) => setClient({ ...client, street: value })} />
          <TextField label="Numero" value={client.number} onChange={(value) => setClient({ ...client, number: value })} />
          <TextField label="Complemento" value={client.complement} onChange={(value) => setClient({ ...client, complement: value })} />
          <TextField label="Bairro" value={client.district} onChange={(value) => setClient({ ...client, district: value })} />
          <TextField label="Cidade" value={client.city} onChange={(value) => setClient({ ...client, city: value })} />
          <TextField label="Estado" value={client.state} onChange={(value) => setClient({ ...client, state: value })} />
        </div>
        <TextAreaField label="Observacoes" value={client.notes} onChange={(value) => setClient({ ...client, notes: value })} />
        <div className="flex flex-wrap gap-2">
          <SaveButton onClick={saveClient} disabled={savingClient}>{savingClient ? "Salvando..." : "Salvar cliente"}</SaveButton>
          <Button variant="outline" onClick={close}>Cancelar</Button>
        </div>
      </FormSheet>

      <FormSheet open={sheet === "supplier"} onOpenChange={(open) => !open && close()} title="Cadastro de Fornecedor" description="Dados do fornecedor para compras, contratos e financeiro.">
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label="Fornecedor" value={supplier.name} onChange={(value) => setSupplier({ ...supplier, name: value })} />
          <CnpjLookupField value={supplier.document} onChange={(value) => setSupplier({ ...supplier, document: value })} onLookup={() => lookupCnpj("supplier")} loading={cnpjLookupTarget === "supplier"} />
          <TextField label="Contato" value={supplier.contactName} onChange={(value) => setSupplier({ ...supplier, contactName: value })} />
          <TextField label="Telefone" value={supplier.phone} onChange={(value) => setSupplier({ ...supplier, phone: value })} />
          <TextField label="E-mail" value={supplier.email} onChange={(value) => setSupplier({ ...supplier, email: value })} />
          <div className="space-y-3 md:col-span-2">
            <SearchableSelectField
              label="Categorias do fornecedor"
              value=""
              onChange={(categoryId) => setSupplier({ ...supplier, categoryIds: Array.from(new Set([...(supplier.categoryIds || []), categoryId])) })}
              options={supplierCategories.filter((item) => !(supplier.categoryIds || []).includes(item.id)).map((item) => ({ value: item.id, label: item.name }))}
              placeholder={supplierCategoriesLoading ? "Carregando categorias..." : "Pesquisar e adicionar categoria"}
              searchPlaceholder="Pesquisar categoria..."
              emptyLabel="Nenhuma categoria disponível."
            />
            {supplierCategoriesError ? <AlertRow>{supplierCategoriesError}</AlertRow> : null}
            <div className="flex min-h-10 flex-wrap gap-2 rounded-md border p-2">
              {(supplier.categoryIds || []).map((categoryId: string) => {
                const category = supplierCategories.find((item) => item.id === categoryId)
                return (
                  <Badge key={categoryId} variant="secondary" className="gap-1 py-1 pl-2 pr-1">
                    {category?.name || categoryId}
                    <Button type="button" size="icon" variant="ghost" className="h-5 w-5" title="Remover categoria" onClick={() => setSupplier({ ...supplier, categoryIds: (supplier.categoryIds || []).filter((id: string) => id !== categoryId) })}>
                      <X className="h-3 w-3" />
                    </Button>
                  </Badge>
                )
              })}
              {!(supplier.categoryIds || []).length ? <span className="px-1 text-sm text-muted-foreground">Nenhuma categoria vinculada.</span> : null}
            </div>
          </div>
          <TextField label="Cidade" value={supplier.city} onChange={(value) => setSupplier({ ...supplier, city: value })} />
          <TextField label="Estado" value={supplier.state} onChange={(value) => setSupplier({ ...supplier, state: value })} />
          <SelectField label="Status" value={supplier.status} onChange={(value) => setSupplier({ ...supplier, status: value })} options={["Ativo", "Inativo"].map((value) => ({ value, label: value }))} />
        </div>
        <TextAreaField label="Observações" value={supplier.notes} onChange={(value) => setSupplier({ ...supplier, notes: value })} />
        <div className="flex flex-wrap gap-2">
          <SaveButton onClick={saveSupplier} disabled={savingSupplier}>{savingSupplier ? "Salvando..." : "Salvar fornecedor"}</SaveButton>
          <Button variant="outline" onClick={close}>Cancelar</Button>
        </div>
      </FormSheet>

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

      <FormSheet open={sheet === "vehicle"} onOpenChange={(open) => !open && close()} title="Cadastro de Veiculo">
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label="Placa" value={vehicle.plate} onChange={(value) => setVehicle({ ...vehicle, plate: value })} />
          <TextField label="Modelo" value={vehicle.model} onChange={(value) => setVehicle({ ...vehicle, model: value })} />
          <TextField label="Marca" value={vehicle.brand} onChange={(value) => setVehicle({ ...vehicle, brand: value })} />
          <TextField label="Ano" value={vehicle.year} onChange={(value) => setVehicle({ ...vehicle, year: value })} />
          <TextField label="Cor" value={vehicle.color} onChange={(value) => setVehicle({ ...vehicle, color: value })} />
          <TextField label="KM atual" type="number" value={vehicle.currentKm} onChange={(value) => setVehicle({ ...vehicle, currentKm: value })} />
          <SelectField label="Status" value={vehicle.status} onChange={(value) => setVehicle({ ...vehicle, status: value })} options={["Disponivel", "Em uso", "Em manutencao", "Inativo"].map((value) => ({ value, label: value }))} />
          <SelectField label="Pneu dianteiro direito" value={vehicle.frontRightTire} onChange={(value) => setVehicle({ ...vehicle, frontRightTire: value })} options={tireOptions.map((value) => ({ value, label: value }))} />
          <SelectField label="Pneu dianteiro esquerdo" value={vehicle.frontLeftTire} onChange={(value) => setVehicle({ ...vehicle, frontLeftTire: value })} options={tireOptions.map((value) => ({ value, label: value }))} />
          <SelectField label="Pneu traseiro direito" value={vehicle.rearRightTire} onChange={(value) => setVehicle({ ...vehicle, rearRightTire: value })} options={tireOptions.map((value) => ({ value, label: value }))} />
          <SelectField label="Pneu traseiro esquerdo" value={vehicle.rearLeftTire} onChange={(value) => setVehicle({ ...vehicle, rearLeftTire: value })} options={tireOptions.map((value) => ({ value, label: value }))} />
          <TextField label="Ultima troca de oleo - data" type="date" value={vehicle.lastOilChangeDate} onChange={(value) => setVehicle({ ...vehicle, lastOilChangeDate: value })} />
          <TextField label="Ultima troca de oleo - KM" type="number" value={vehicle.lastOilChangeKm} onChange={(value) => setVehicle({ ...vehicle, lastOilChangeKm: value })} />
          <TextField label="Renavam" value={vehicle.renavam} onChange={(value) => setVehicle({ ...vehicle, renavam: value })} />
          <TextField label="Vencimento licenciamento" type="date" value={vehicle.licensingDueDate} onChange={(value) => setVehicle({ ...vehicle, licensingDueDate: value })} />
        </div>
        <TextAreaField label="Seguro/observacoes" value={vehicle.insuranceInfo || vehicle.notes} onChange={(value) => setVehicle({ ...vehicle, insuranceInfo: value, notes: value })} />
        <SaveButton onClick={saveVehicle}>Salvar veiculo</SaveButton>
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


export function ClientsPage() {
  const { state, commit } = useOperationalStore()
  const { sheet, setSheet, preset, openSheet } = useSheetWithPreset()
  const [tab, setTab] = useState("clientes")
  const [query, setQuery] = useState("")
  const normalizedQuery = normalizeClientImportKey(query)
  const matchesQuery = (values: unknown[]) => normalizeClientImportKey(values.filter(Boolean).join(" ")).includes(normalizedQuery)
  const clients = state.clients
    .filter((item) => matchesQuery([item.name, item.corporateName, item.tradeName, item.document, item.responsibleName, item.phone, item.mobile, item.email, item.city, item.state, item.status]))
    .sort((left, right) => compareAlphaNumeric(left.name, right.name))
  const suppliers = (state.suppliers || [])
    .filter((item) => matchesQuery([item.name, item.document, item.contactName, item.phone, item.email, item.category, item.city, item.state, item.status, item.notes]))
    .sort((left, right) => compareAlphaNumeric(left.name, right.name))

  function inactivate(kind: "client" | "supplier", id: string) {
    commit((current) => ({
      ...current,
      clients: kind === "client" ? current.clients.map((item) => item.id === id ? { ...item, status: "Inativo", updatedAt: nowIso() } : item) : current.clients,
      suppliers: kind === "supplier" ? (current.suppliers || []).map((item) => item.id === id ? { ...item, status: "Inativo", updatedAt: nowIso() } : item) : (current.suppliers || []),
      auditLogs: appendAudit(current, kind, id, "Inativado", `${kind === "client" ? "Cliente" : "Fornecedor"} inativado`),
    }))
  }

  return (
    <PageShell title="Clientes e Fornecedores" description="Cadastre clientes e fornecedores." actions={<><Button onClick={() => openSheet("client")}><Plus className="h-4 w-4" />Novo Cliente</Button><Button variant="secondary" onClick={() => openSheet("supplier")}>Novo Fornecedor</Button></>}>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap"><TabsTrigger value="clientes">Clientes</TabsTrigger><TabsTrigger value="fornecedores">Fornecedores</TabsTrigger><TabsTrigger value="historico">Histórico</TabsTrigger></TabsList>
        {tab !== "historico" ? <div className="relative my-4 w-full max-w-3xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-11 pl-9 pr-10" placeholder={tab === "fornecedores" ? "Pesquisar fornecedor, CPF/CNPJ, contato, categoria ou cidade" : "Pesquisar cliente, CPF/CNPJ, nome fantasia, contato ou cidade"} value={query} onChange={(event) => setQuery(event.target.value)} />
          {query ? <Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2" title="Limpar pesquisa" onClick={() => setQuery("")}><X className="h-4 w-4" /></Button> : null}
        </div> : null}
        <TabsContent value="clientes">
          <SectionCard title="Clientes">
            <DataTable headers={["Cliente", "Tipo", "CPF/CNPJ", "Responsável", "Telefone", "E-mail", "Cidade", "Status", "Ações"]} empty={!clients.length} stickyHeader viewportClassName="max-h-[calc(100vh-19rem)] overflow-auto overscroll-contain" tableClassName="h-auto min-w-[1180px] [&_tbody_tr]:h-auto [&_td]:py-2.5">
              {clients.map((client) => <TableRow key={client.id}><TableCell>{client.name}</TableCell><TableCell>{client.type}</TableCell><TableCell>{client.document || "-"}</TableCell><TableCell>{client.responsibleName || "-"}</TableCell><TableCell>{client.mobile || client.phone || "-"}</TableCell><TableCell>{client.email || "-"}</TableCell><TableCell>{[client.city, client.state].filter(Boolean).join(" / ") || "-"}</TableCell><TableCell><StatusBadge status={client.status} /></TableCell><TableCell className="space-x-1"><Button size="sm" variant="outline" onClick={() => openSheet("client", { id: client.id })}>Editar</Button><ConfirmInline label="Inativar" onConfirm={() => inactivate("client", client.id)} /></TableCell></TableRow>)}
            </DataTable>
          </SectionCard>
        </TabsContent>
        <TabsContent value="fornecedores">
          <SectionCard title="Fornecedores">
            <DataTable headers={["Fornecedor", "CPF/CNPJ", "Categoria", "Contato", "Telefone", "E-mail", "Cidade", "Status", "Ações"]} empty={!suppliers.length} stickyHeader viewportClassName="max-h-[calc(100vh-19rem)] overflow-auto overscroll-contain" tableClassName="h-auto min-w-[1220px] [&_tbody_tr]:h-auto [&_td]:py-2.5">
              {suppliers.map((supplier) => <TableRow key={supplier.id}><TableCell>{supplier.name}</TableCell><TableCell>{supplier.document || "-"}</TableCell><TableCell>{supplier.category || "-"}</TableCell><TableCell>{supplier.contactName || "-"}</TableCell><TableCell>{supplier.phone || "-"}</TableCell><TableCell>{supplier.email || "-"}</TableCell><TableCell>{[supplier.city, supplier.state].filter(Boolean).join(" / ") || "-"}</TableCell><TableCell><StatusBadge status={supplier.status} /></TableCell><TableCell><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => openSheet("supplier", { id: supplier.id })}>Editar</Button><ConfirmInline label="Inativar" onConfirm={() => inactivate("supplier", supplier.id)} /></div></TableCell></TableRow>)}
            </DataTable>
          </SectionCard>
        </TabsContent>
        <TabsContent value="historico">
          <AuditTable state={state} filter={["client", "supplier"]} />
        </TabsContent>
      </Tabs>
      <QuickSheets state={state} commit={commit} sheet={sheet} setSheet={setSheet} preset={preset} />
    </PageShell>
  )
}




































export function FleetPage() {
  const { state, commit } = useOperationalStore()
  const { sheet, setSheet, preset, openSheet } = useSheetWithPreset()
  const n = names(state)
  const [maintenance, setMaintenance] = useState({ vehicleId: "", type: "", date: today(), km: "0", cost: "0", description: "", nextMaintenance: "", attachmentName: "" })
  function saveMaintenance() {
    if (!maintenance.vehicleId) return
    if (maintenance.nextMaintenance && maintenance.nextMaintenance < maintenance.date) {
      window.alert("A data final da manutencao nao pode ser anterior ao inicio.")
      return
    }
    commit((current) => ({
      ...current,
      vehicleMaintenance: [{ id: makeId("maint"), vehicleId: maintenance.vehicleId, type: maintenance.type || "Manutencao", date: maintenance.date, km: Number(maintenance.km), cost: Number(maintenance.cost), description: maintenance.description, nextMaintenance: maintenance.nextMaintenance || maintenance.date, status: "Programada", attachmentName: maintenance.attachmentName }, ...current.vehicleMaintenance],
      auditLogs: appendAudit(current, "vehicle", maintenance.vehicleId, "Manutencao", `Manutencao programada de ${formatDate(maintenance.date)} ate ${formatDate(maintenance.nextMaintenance || maintenance.date)}`),
    }))
    setMaintenance({ vehicleId: "", type: "", date: today(), km: "0", cost: "0", description: "", nextMaintenance: "", attachmentName: "" })
  }
  return (
    <PageShell title="Frota" description="Controle de veiculos, uso da frota e manutencoes." actions={<><Button onClick={() => openSheet("vehicle")}><Plus className="h-4 w-4" />Novo Veiculo</Button><Button variant="outline" onClick={() => window.alert("Exportacao da frota simulada no MVP local.")}>Exportar lista</Button></>}>
      <Tabs defaultValue="veiculos">
        <TabsList><TabsTrigger value="veiculos">Veiculos</TabsTrigger><TabsTrigger value="manutencao">Manutencao</TabsTrigger></TabsList>
        <TabsContent value="veiculos"><SectionCard title="Veiculos"><DataTable headers={["Placa", "Modelo", "KM Atual", "Pneus dianteiros", "Pneus traseiros", "Ultima troca de oleo", "Status", "Acoes"]} empty={!state.vehicles.length}>{state.vehicles.map((vehicle) => <TableRow key={vehicle.id}><TableCell>{vehicle.plate}</TableCell><TableCell>{vehicle.model} / {vehicle.brand}</TableCell><TableCell>{vehicle.currentKm}</TableCell><TableCell>Dir: {(vehicle as any).frontRightTire || "Novo"}<br />Esq: {(vehicle as any).frontLeftTire || "Novo"}</TableCell><TableCell>Dir: {(vehicle as any).rearRightTire || "Novo"}<br />Esq: {(vehicle as any).rearLeftTire || "Novo"}</TableCell><TableCell>{(vehicle as any).lastOilChangeDate ? formatDate((vehicle as any).lastOilChangeDate) : "-"} / {(vehicle as any).lastOilChangeKm || 0} km</TableCell><TableCell><StatusBadge status={vehicle.status} /></TableCell><TableCell><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => openSheet("vehicle", { id: vehicle.id })}>Editar</Button><ConfirmInline label="Inativar" onConfirm={() => commit((current) => ({ ...current, vehicles: current.vehicles.map((item) => item.id === vehicle.id ? { ...item, status: "Inativo", updatedAt: nowIso() } : item) }))} /></div></TableCell></TableRow>)}</DataTable></SectionCard></TabsContent>
        <TabsContent value="manutencao"><SectionCard title="Manutencoes"><div className="mb-4 grid gap-3 md:grid-cols-3"><SelectField label="Veiculo" value={maintenance.vehicleId || "nenhum"} onChange={(value) => setMaintenance({ ...maintenance, vehicleId: value === "nenhum" ? "" : value })} options={[{ value: "nenhum", label: "Selecione" }, ...state.vehicles.map((item) => ({ value: item.id, label: `${item.plate} - ${item.model}` }))]} /><TextField label="Tipo" value={maintenance.type} onChange={(value) => setMaintenance({ ...maintenance, type: value })} /><TextField label="Inicio da manutencao" type="date" value={maintenance.date} onChange={(value) => setMaintenance({ ...maintenance, date: value })} /><TextField label="Fim da manutencao" type="date" value={maintenance.nextMaintenance} onChange={(value) => setMaintenance({ ...maintenance, nextMaintenance: value })} /><TextField label="KM" type="number" value={maintenance.km} onChange={(value) => setMaintenance({ ...maintenance, km: value })} /><TextField label="Custo" type="number" value={maintenance.cost} onChange={(value) => setMaintenance({ ...maintenance, cost: value })} /><TextAreaField label="Descricao" value={maintenance.description} onChange={(value) => setMaintenance({ ...maintenance, description: value })} /><Button onClick={saveMaintenance}>Registrar manutencao</Button></div><DataTable headers={["Veiculo", "Tipo", "Inicio", "Fim", "KM", "Custo", "Status"]} empty={!state.vehicleMaintenance.length}>{state.vehicleMaintenance.map((item) => <TableRow key={item.id}><TableCell>{n.vehicle(item.vehicleId)}</TableCell><TableCell>{item.type}</TableCell><TableCell>{formatDate(item.date)}</TableCell><TableCell>{formatDate(item.nextMaintenance || item.date)}</TableCell><TableCell>{item.km}</TableCell><TableCell>{item.cost.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</TableCell><TableCell><StatusBadge status={item.status} /></TableCell></TableRow>)}</DataTable></SectionCard></TabsContent>
      </Tabs>
      <QuickSheets state={state} commit={commit} sheet={sheet} setSheet={setSheet} preset={preset} />
    </PageShell>
  )
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

function AuditTable({ state, filter, entityId }: { state: OperationalState; filter: string[]; entityId?: string }) {
  const logs = state.auditLogs.filter((log) => (!filter.length || filter.includes(log.entityType)) && (!entityId || log.entityId === entityId))
  return <SectionCard title="Historico"><DataTable headers={["Data/hora", "Usuario", "Tipo de acao", "Entidade", "Descricao"]} empty={!logs.length}>{logs.map((log) => <TableRow key={log.id}><TableCell>{dateTime(log.createdAt)}</TableCell><TableCell>{log.userId}</TableCell><TableCell>{log.action}</TableCell><TableCell>{log.entityType}</TableCell><TableCell>{log.description}</TableCell></TableRow>)}</DataTable></SectionCard>
}


