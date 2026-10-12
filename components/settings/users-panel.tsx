"use client"

import { useCallback, useEffect, useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, SectionCard, StatusBadge, TextField, useCrudFeedback } from "@/components/operations/shared"
import { pagePermissionLabels, systemPagePermissions } from "@/lib/types"
import { api, Opts, post, stamp, type Row } from "@/components/settings/common"

const roles = [{ value: "admin", label: "Administrador" }, { value: "manager", label: "Supervisor / gerente" }, { value: "sdr", label: "Atendimento" }, { value: "user", label: "Técnico / operacional" }, { value: "client", label: "Cliente (acesso externo)" }]
const emptyUser = (): Row => ({ id: "", name: "", email: "", phone: "", role: "user", permissions: ["dashboard", "ordens_servico"], clientId: "", active: true, password: "", companyIds: [], branchId: "", department: "", jobTitle: "", mfaRequired: false })

export function UsersPanel() {
  const { toast } = useCrudFeedback()
  const [users, setUsers] = useState<Row[]>([])
  const [companies, setCompanies] = useState<Row[]>([])
  const [branches, setBranches] = useState<Row[]>([])
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([])
  const [form, setForm] = useState<Row | null>(null)
  const [saving, setSaving] = useState(false)
  const set = (patch: Row) => setForm((current) => (current ? { ...current, ...patch } : current))

  const load = useCallback(async () => {
    const [u, c, b] = await Promise.all([api<{ items: Row[] }>("/api/configuracoes/usuarios"), api<{ items: Row[] }>("/api/configuracoes/empresas"), api<{ items: Row[] }>("/api/configuracoes/filiais")])
    setUsers(u.items)
    setCompanies(c.items.filter((company) => company.active))
    setBranches(b.items.filter((branch) => branch.active))
    api<{ clients: Array<{ id: string; name: string }> }>("/api/os/options").then((result) => setClients(result.clients)).catch(() => undefined)
  }, [])
  useEffect(() => { void load().catch((reason) => toast({ title: "Erro ao carregar usuários", description: reason instanceof Error ? reason.message : "", variant: "destructive" })) }, [load, toast])

  async function save() {
    if (!form) return
    setSaving(true)
    try {
      const editing = Boolean(form.id)
      if (!form.name.trim() || !form.email.trim()) throw new Error("Informe nome e e-mail de acesso.")
      if (!editing && !form.password) throw new Error("Informe a senha inicial do usuário.")
      if (form.role !== "admin" && !form.permissions.length) throw new Error("Marque ao menos uma página que o usuário pode acessar.")
      const core = await api<{ user?: { id: string } }>(editing ? `/api/users/${form.id}` : "/api/users/create", {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify({ name: form.name, email: form.email, password: form.password || undefined, phone: form.phone, role: form.role, permissions: form.permissions, clientId: form.role === "client" ? form.clientId : null, active: form.active }),
      })
      const userId = editing ? form.id : core.user?.id
      if (!userId) throw new Error("Usuário criado, mas o identificador não voltou; atualize a lista.")
      await post("usuarios", { userId, item: { companyIds: form.companyIds, branchId: form.branchId, department: form.department, jobTitle: form.jobTitle, mfaRequired: form.mfaRequired } })
      toast({ title: editing ? "Usuário atualizado" : "Usuário criado", description: "As permissões e empresas valem no próximo acesso." })
      setForm(null)
      await load()
    } catch (reason) {
      toast({ title: "Não foi possível salvar", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const companyBranches = branches.filter((branch) => form?.companyIds?.includes(branch.companyId))

  return (
    <SectionCard title="Usuários e permissões" description="Cada usuário só enxerga as empresas autorizadas e as páginas marcadas. Usuários antigos sem empresa vinculada continuam com acesso a todas até serem editados.">
      <Button className="mb-3" onClick={() => setForm(emptyUser())}><Plus className="h-4 w-4" />Novo usuário</Button>
      <DataTable headers={["Nome", "E-mail", "Perfil", "Empresas", "Filial", "Departamento / cargo", "MFA", "Último acesso", "Status", "Ações"]} empty={!users.length}>
        {users.map((user) => (
          <TableRow key={user.id}>
            <TableCell>{user.name}</TableCell><TableCell>{user.email}</TableCell><TableCell>{roles.find((role) => role.value === user.role)?.label || user.role}</TableCell>
            <TableCell>{user.role === "admin" ? "Todas" : user.companyIds.length ? user.companyIds.map((id: string) => companies.find((company) => company.id === id)?.tradeName || "?").join(", ") : <span className="text-amber-600">Todas (sem vínculo)</span>}</TableCell>
            <TableCell>{user.branchName || "-"}</TableCell><TableCell>{[user.department, user.jobTitle].filter(Boolean).join(" · ") || "-"}</TableCell>
            <TableCell>{user.mfaEnabled ? "Ativo" : user.mfaRequired ? <span className="text-amber-600">Exigido, não ativado</span> : "Desligado"}</TableCell>
            <TableCell>{stamp(user.lastSignInAt)}</TableCell><TableCell><StatusBadge status={user.active ? "Ativo" : "Inativo"} /></TableCell>
            <TableCell><Button size="sm" variant="outline" onClick={() => setForm({ ...emptyUser(), ...user, password: "" })}>Editar</Button></TableCell>
          </TableRow>
        ))}
      </DataTable>

      <Sheet open={Boolean(form)} onOpenChange={(value) => !value && setForm(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
          <SheetHeader><SheetTitle>{form?.id ? "Editar usuário" : "Novo usuário"}</SheetTitle><SheetDescription>Nome, e-mail, perfil, empresas e páginas permitidas são obrigatórios. A senha nunca é exibida.</SheetDescription></SheetHeader>
          {form && (
            <div className="space-y-5 px-4 pb-6">
              <div className="grid gap-3 md:grid-cols-2">
                <TextField label="Nome *" value={form.name} onChange={(value) => set({ name: value })} />
                <TextField label="E-mail de acesso *" value={form.email} onChange={(value) => set({ email: value })} />
                <TextField label="Telefone" value={form.phone} onChange={(value) => set({ phone: value })} />
                <Opts label="Perfil de acesso *" value={form.role} onChange={(value) => set({ role: value || "user" })} items={roles} />
                {form.role === "client" && <Opts label="Cliente vinculado *" value={form.clientId} onChange={(value) => set({ clientId: value })} items={clients.map((client) => ({ value: client.id, label: client.name }))} />}
                <TextField label={form.id ? "Nova senha (deixe em branco para manter)" : "Senha inicial *"} type="password" value={form.password} onChange={(value) => set({ password: value })} />
                <TextField label="Departamento" value={form.department} onChange={(value) => set({ department: value })} />
                <TextField label="Cargo" value={form.jobTitle} onChange={(value) => set({ jobTitle: value })} />
              </div>

              {form.role !== "client" && (
                <div className="space-y-2">
                  <Label>Empresas em que pode trabalhar *</Label>
                  <div className="flex flex-wrap gap-x-5 gap-y-2">
                    {companies.map((company) => (
                      <label key={company.id} className="flex items-center gap-2 text-sm">
                        <Checkbox checked={form.companyIds.includes(company.id)} onCheckedChange={(value) => set({ companyIds: value === true ? [...form.companyIds, company.id] : form.companyIds.filter((id: string) => id !== company.id), branchId: "" })} />
                        {company.tradeName || company.legalName}
                      </label>
                    ))}
                  </div>
                  {companyBranches.length > 0 && <div className="max-w-sm"><Opts label="Filial ou unidade" value={form.branchId} onChange={(value) => set({ branchId: value })} items={companyBranches.map((branch) => ({ value: branch.id, label: `${branch.name} (${branch.companyName})` }))} placeholder="Nenhuma" /></div>}
                </div>
              )}

              {form.role !== "admin" && (
                <div className="space-y-2">
                  <Label>Páginas permitidas *</Label>
                  <div className="flex flex-wrap gap-x-5 gap-y-2">
                    {systemPagePermissions.filter((permission) => permission !== "clientes").map((permission) => (
                      <label key={permission} className="flex items-center gap-2 text-sm">
                        <Checkbox checked={form.permissions.includes(permission)} onCheckedChange={(value) => set({ permissions: value === true ? [...form.permissions, permission] : form.permissions.filter((item: string) => item !== permission) })} />
                        {pagePermissionLabels[permission]}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-6">
                <div className="flex items-center gap-2"><Checkbox id="user-active" checked={form.active} onCheckedChange={(value) => set({ active: value === true })} /><Label htmlFor="user-active">Usuário ativo</Label></div>
                <div className="flex items-center gap-2"><Checkbox id="mfa" checked={form.mfaRequired} onCheckedChange={(value) => set({ mfaRequired: value === true })} /><Label htmlFor="mfa">Exigir autenticação multifator</Label></div>
              </div>
              <p className="text-xs text-muted-foreground">Autenticação multifator: a exigência fica registrada e o status aparece na lista (lido do Supabase Auth). O cadastro do segundo fator e o desafio no login ainda não estão na tela de acesso.</p>
              <Button onClick={() => void save()} disabled={saving}>Salvar usuário</Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </SectionCard>
  )
}
