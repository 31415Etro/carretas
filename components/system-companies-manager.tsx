"use client"

import { useCallback, useEffect, useState } from "react"
import { Building2, Pencil, Plus, RefreshCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/lib/auth-context"
import { formatCnpj, type SystemCompany } from "@/lib/system-company"

type CompanyForm = Omit<SystemCompany, "id"> & { id?: string }
const emptyForm: CompanyForm = { name: "", legalName: "", tradeName: "", cnpj: "", email: "", phone: "", address: "", active: true, isDefault: false }

export function SystemCompaniesManager() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [companies, setCompanies] = useState<SystemCompany[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<CompanyForm>(emptyForm)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch("/api/system-companies", { cache: "no-store" })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || "Falha ao carregar empresas")
      setCompanies(payload.companies || [])
    } catch (error) {
      toast({ title: "Erro ao carregar empresas", description: error instanceof Error ? error.message : "Tente novamente", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { if (user?.role === "admin") void load() }, [user?.role, load])

  const edit = (company?: SystemCompany) => {
    setForm(company ? { ...company } : { ...emptyForm })
    setOpen(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      const response = await fetch("/api/system-companies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || "Falha ao salvar empresa")
      toast({ title: form.id ? "Empresa atualizada" : "Empresa cadastrada", description: "O CNPJ esta disponivel no login e no seletor superior." })
      setOpen(false)
      await load()
    } catch (error) {
      toast({ title: "Erro ao salvar empresa", description: error instanceof Error ? error.message : "Tente novamente", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  if (user?.role !== "admin") return <div className="py-12 text-center text-sm text-muted-foreground">Somente administradores podem gerenciar os CNPJs do grupo.</div>

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Empresas do grupo</h2>
          <p className="text-sm text-muted-foreground">Cadastro global compartilhado por todos os usuarios, independentemente da empresa ativa.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" title="Atualizar empresas" onClick={load} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></Button>
          <Button onClick={() => edit()}><Plus className="h-4 w-4" />Nova empresa</Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border bg-background">
        <Table>
          <TableHeader><TableRow><TableHead>Empresa</TableHead><TableHead>CNPJ</TableHead><TableHead>Contato</TableHead><TableHead>Status</TableHead><TableHead className="w-16"><span className="sr-only">Acoes</span></TableHead></TableRow></TableHeader>
          <TableBody>
            {!loading && !companies.length ? <TableRow><TableCell colSpan={5} className="h-28 text-center text-muted-foreground">Nenhuma empresa cadastrada.</TableCell></TableRow> : companies.map((company) => (
              <TableRow key={company.id}>
                <TableCell><div className="flex items-center gap-3"><Building2 className="h-5 w-5 text-primary" /><div><p className="font-medium">{company.tradeName || company.name}</p><p className="text-xs text-muted-foreground">{company.legalName}</p></div></div></TableCell>
                <TableCell>{company.cnpj || "-"}</TableCell>
                <TableCell><p>{company.email || "-"}</p><p className="text-xs text-muted-foreground">{company.phone}</p></TableCell>
                <TableCell><div className="flex gap-2"><Badge variant={company.active ? "default" : "secondary"}>{company.active ? "Ativa" : "Inativa"}</Badge>{company.isDefault && <Badge variant="outline">Principal</Badge>}</div></TableCell>
                <TableCell><Button variant="ghost" size="icon" title="Editar empresa" onClick={() => edit(company)}><Pencil className="h-4 w-4" /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>{form.id ? "Editar empresa" : "Nova empresa"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <CompanyField label="Nome de exibicao" value={form.name} onChange={(name) => setForm({ ...form, name })} />
            <CompanyField label="Nome fantasia" value={form.tradeName} onChange={(tradeName) => setForm({ ...form, tradeName })} />
            <div className="sm:col-span-2"><CompanyField label="Razao social" value={form.legalName} onChange={(legalName) => setForm({ ...form, legalName })} /></div>
            <CompanyField label="CNPJ" value={form.cnpj} onChange={(cnpj) => setForm({ ...form, cnpj: formatCnpj(cnpj) })} />
            <CompanyField label="Telefone" value={form.phone} onChange={(phone) => setForm({ ...form, phone })} />
            <CompanyField label="E-mail" type="email" value={form.email} onChange={(email) => setForm({ ...form, email })} />
            <CompanyField label="Endereco" value={form.address} onChange={(address) => setForm({ ...form, address })} />
          </div>
          <div className="flex flex-wrap gap-6 border-t pt-4">
            <CompanyToggle label="Empresa ativa" checked={form.active} onChange={(active) => setForm({ ...form, active })} />
            <CompanyToggle label="Empresa principal" checked={form.isDefault} onChange={(isDefault) => setForm({ ...form, isDefault })} />
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={save} disabled={saving || form.name.trim().length < 2}>{saving ? "Salvando..." : "Salvar empresa"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CompanyField({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  const id = `company-${label.toLowerCase().replace(/\s/g, "-")}`
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><Input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} /></div>
}

function CompanyToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <div className="flex items-center gap-2"><Switch checked={checked} onCheckedChange={onChange} /><span className="text-sm">{label}</span></div>
}
