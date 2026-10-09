"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { useToast } from "@/hooks/use-toast"
import { type UserRole, type PagePermission, type User, pagePermissionLabels } from "@/lib/types"
import { X, Eye, EyeOff, Loader2 } from "lucide-react"

interface UserFormProps {
  user?: User | null
  onClose: () => void
  onSuccess: () => void
}

const allPermissions: PagePermission[] = [
  "dashboard",
  "dashboard_obras",
  "painel_ambientes",
  "clientes_obras",
  "ordens_servico",
  "equipe_prestadores",
  "operacao_campo",
  "frota",
  "estoque",
  "financeiro",
  "comercial",
  "pmoc",
  "orcamento",
  "contratos",
  "relatorios",
  "configuracoes",
  "users",
]

const roleDefaultPermissions: Record<UserRole, PagePermission[]> = {
  admin: allPermissions,
  sdr: ["dashboard", "clientes_obras", "ordens_servico"],
  closer: ["dashboard", "clientes_obras", "ordens_servico", "relatorios"],
  representative: ["dashboard", "clientes_obras", "ordens_servico"],
  manager: [
    "dashboard",
    "clientes_obras",
    "ordens_servico",
    "equipe_prestadores",
    "operacao_campo",
    "frota",
    "estoque",
    "financeiro",
    "comercial",
    "pmoc",
    "orcamento",
    "contratos",
    "relatorios",
    "configuracoes",
    "users",
  ],
  sd: ["dashboard", "ordens_servico", "operacao_campo"],
  client: [],
  user: ["dashboard"],
}

export function UserForm({ user, onClose, onSuccess }: UserFormProps) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [managers, setManagers] = useState<Array<{ id: string; name: string; email: string }>>([])
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([])
  const [clientsLoading, setClientsLoading] = useState(true)
  const [clientsError, setClientsError] = useState("")

  const [formData, setFormData] = useState(() => {
    if (user) {
      const loadedPermissions = Array.isArray(user.permissions)
        ? user.permissions
        : roleDefaultPermissions[user.role] || roleDefaultPermissions.sdr

      return {
        name: user.name,
        email: user.email,
        phone: (user as any).phone || "",
        password: "",
        role: user.role,
        permissions: loadedPermissions,
        managerId: user.managerId || "",
        clientId: user.clientId || "",
      }
    }
    return {
      name: "",
      email: "",
      phone: "",
      password: "",
      role: "sdr" as UserRole,
      permissions: roleDefaultPermissions.sdr,
      managerId: "",
      clientId: "",
    }
  })

  useEffect(() => {
    const fetchManagers = async () => {
      try {
        const response = await fetch("/api/users?role=manager")
        if (response.ok) {
          const data = await response.json()
          setManagers(data.map((m: any) => ({ id: m.id, name: m.name, email: m.email })))
        }
      } catch (error) {
        console.error("Error fetching managers:", error)
      }
    }
    fetchManagers()

    fetch("/api/clients/options", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || "Nao foi possivel carregar os clientes")
        return data
      })
      .then((data) => {
        setClients(data.clients || [])
        setClientsError("")
      })
      .catch((error) => {
        console.error("Error fetching clients:", error)
        setClientsError(error instanceof Error ? error.message : "Nao foi possivel carregar os clientes")
      })
      .finally(() => setClientsLoading(false))
  }, [])

  useEffect(() => {
    if (user) {
      const loadedPermissions = Array.isArray(user.permissions)
        ? user.permissions
        : roleDefaultPermissions[user.role] || roleDefaultPermissions.sdr

      setFormData({
        name: user.name,
        email: user.email,
        phone: (user as any).phone || "",
        password: "",
        role: user.role,
        permissions: loadedPermissions,
        managerId: user.managerId || "",
        clientId: user.clientId || "",
      })
    } else {
      setFormData({
        name: "",
        email: "",
        phone: "",
        password: "",
        role: "sdr" as UserRole,
        permissions: roleDefaultPermissions.sdr,
        managerId: "",
        clientId: "",
      })
    }
  }, [user])

  const handleRoleChange = (role: UserRole) => {
    setFormData({
      ...formData,
      role,
      permissions: roleDefaultPermissions[role],
      managerId: role === "representative" ? formData.managerId : "",
      clientId: role === "client" ? formData.clientId : "",
    })
  }

  const handlePermissionToggle = (permission: PagePermission) => {
    setFormData((prev) => ({
      ...prev,
      permissions: (prev.permissions || []).includes(permission)
        ? (prev.permissions || []).filter((p) => p !== permission)
        : [...(prev.permissions || []), permission],
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.name || !formData.email) {
      toast({
        title: "Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      })
      return
    }

    if (!user && !formData.password) {
      toast({
        title: "Error",
        description: "Password is required for new users",
        variant: "destructive",
      })
      return
    }

    if (formData.role === "client" && !formData.clientId) {
      toast({
        title: "Cliente obrigatorio",
        description: "Selecione qual cliente este usuario podera visualizar.",
        variant: "destructive",
      })
      return
    }
    if (formData.role !== "admin" && !formData.permissions.length) {
      toast({
        title: "Selecione as paginas",
        description: "Marque pelo menos uma pagina que este usuario podera acessar.",
        variant: "destructive",
      })
      return
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(formData.email)) {
      toast({
        title: "Error",
        description: "Please enter a valid email address",
        variant: "destructive",
      })
      return
    }

    if (formData.password && formData.password.length < 6) {
      toast({
        title: "Error",
        description: "Password must be at least 6 characters",
        variant: "destructive",
      })
      return
    }

    setLoading(true)

    try {
      const endpoint = user ? `/api/users/${user.id}` : "/api/users/create"
      const method = user ? "PUT" : "POST"

      const response = await fetch(endpoint, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || `Failed to ${user ? "update" : "create"} user`)
      }

      toast({
        title: "Success!",
        description: `User ${formData.name} ${user ? "updated" : "created"} successfully.`,
      })

      onSuccess()
      onClose()
    } catch (error) {
      console.error(`Error ${user ? "updating" : "creating"} user:`, error)
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : `Failed to ${user ? "update" : "create"} user`,
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <CardHeader className="relative">
          <Button variant="ghost" size="icon" className="absolute right-4 top-4" onClick={onClose} disabled={loading}>
            <X className="h-4 w-4" />
          </Button>
          <CardTitle>{user ? "Edit User" : "Create New User"}</CardTitle>
          <CardDescription>
            {user ? "Update user information and permissions" : "Add a new user and configure their access permissions"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="name">Full Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="John Doe"
                required
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="john@example.com"
                required
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Telefone</Label>
              <Input
                id="phone"
                type="tel"
                value={formData.phone || ""}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="(00) 00000-0000"
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">{user ? "New Password (optional)" : "Password *"}</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder={user ? "Leave blank to keep current password" : "Minimum 6 characters"}
                  required={!user}
                  disabled={loading}
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={loading}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {user
                  ? "Leave blank to keep the current password"
                  : "User will be able to login with this email and password"}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="role">Role *</Label>
              <Select value={formData.role} onValueChange={handleRoleChange} disabled={loading}>
                <SelectTrigger id="role">
                  <SelectValue />
                </SelectTrigger>
              <SelectContent sortItems>
                  <SelectItem value="sdr">SDR (Sales Development Representative)</SelectItem>
                  <SelectItem value="closer">Closer</SelectItem>
                  <SelectItem value="representative">Representante</SelectItem>
                  <SelectItem value="manager">Gerente</SelectItem>
                  <SelectItem value="sd">SD (Systems Design)</SelectItem>
                  <SelectItem value="client">Cliente</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {formData.role === "representative" && managers.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="manager">Manager (Optional)</Label>
                <Select
                  value={formData.managerId}
                  onValueChange={(value) => setFormData({ ...formData, managerId: value })}
                  disabled={loading}
                >
                  <SelectTrigger id="manager">
                    <SelectValue placeholder="Select a manager" />
                  </SelectTrigger>
              <SelectContent sortItems>
                    <SelectItem value="none">No Manager</SelectItem>
                    {managers.map((manager) => (
                      <SelectItem key={manager.id} value={manager.id}>
                        {manager.name} ({manager.email})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Assign this representative to a manager who can view their leads
                </p>
              </div>
            )}

            <div className={`space-y-2 rounded-md border p-4 ${formData.role === "client" ? "border-primary/40 bg-primary/5" : "bg-muted/20"}`}>
                <Label htmlFor="clientId">Empresa/Cliente que este usuario pode visualizar {formData.role === "client" ? "*" : ""}</Label>
                <Select
                  value={formData.clientId}
                  onValueChange={(value) => setFormData({ ...formData, clientId: value })}
                  disabled={loading || clientsLoading || formData.role !== "client"}
                >
                  <SelectTrigger id="clientId">
                    <SelectValue placeholder={clientsLoading ? "Carregando clientes..." : "Selecione a empresa/cliente"} />
                  </SelectTrigger>
                  <SelectContent sortItems>
                    {!clients.length && !clientsLoading ? (
                      <SelectItem value="sem-clientes" disabled>Nenhuma empresa/cliente encontrada</SelectItem>
                    ) : null}
                    {clients.map((client) => (
                      <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {clientsError ? (
                  <p className="text-sm text-destructive">{clientsError}. Atualize a pagina e tente novamente.</p>
                ) : formData.role === "client" ? (
                  <p className="text-xs text-muted-foreground">O usuario vera somente as paginas marcadas e os dados vinculados a esta empresa.</p>
                ) : (
                  <p className="text-xs text-muted-foreground">Selecione o perfil Cliente acima para habilitar o vinculo com uma empresa.</p>
                )}
            </div>

            <div className="space-y-3">
              <Label>Page Permissions</Label>
              <p className="text-sm text-muted-foreground">Select which pages this user can access</p>
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface p-4">
                {allPermissions.map((permission) => (
                  <div key={permission} className="flex items-center space-x-2">
                    <Checkbox
                      id={permission}
                      checked={(formData.permissions || []).includes(permission)}
                      onCheckedChange={() => handlePermissionToggle(permission)}
                      disabled={loading || formData.role === "admin"}
                    />
                    <Label htmlFor={permission} className="text-sm font-normal cursor-pointer">
                      {pagePermissionLabels[permission]}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <Button type="submit" className="flex-1 gap-2" disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {loading ? (user ? "Updating..." : "Creating...") : user ? "Update User" : "Create User"}
              </Button>
              <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
