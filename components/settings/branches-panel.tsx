"use client"

import { useCallback, useEffect, useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, SectionCard, StatusBadge, TextField, useCrudFeedback } from "@/components/operations/shared"
import { brStates } from "@/lib/commercial"
import { api, Opts, post, type Row } from "@/components/settings/common"

const emptyBranch = (): Row => ({ id: "", companyId: "", code: "", name: "", zipCode: "", street: "", number: "", complement: "", district: "", city: "", state: "", phone: "", managerName: "", active: true })

export function BranchesPanel() {
  const { toast } = useCrudFeedback()
  const [branches, setBranches] = useState<Row[]>([])
  const [companies, setCompanies] = useState<Row[]>([])
  const [form, setForm] = useState<Row | null>(null)
  const set = (patch: Row) => setForm((current) => (current ? { ...current, ...patch } : current))

  const load = useCallback(async () => {
    const [b, c] = await Promise.all([api<{ items: Row[] }>("/api/configuracoes/filiais"), api<{ items: Row[] }>("/api/configuracoes/empresas")])
    setBranches(b.items)
    setCompanies(c.items)
  }, [])
  useEffect(() => { void load().catch((reason) => toast({ title: "Erro ao carregar filiais", description: reason instanceof Error ? reason.message : "", variant: "destructive" })) }, [load, toast])

  async function save() {
    try {
      await post("filiais", { item: form })
      setForm(null)
      toast({ title: "Filial salva" })
      await load()
    } catch (reason) {
      toast({ title: "Não foi possível salvar", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    }
  }

  return (
    <SectionCard title="Filiais e unidades" description="Usadas no cadastro de usuários e depósitos. Inative em vez de excluir: o histórico é preservado.">
      <Button className="mb-3" onClick={() => setForm({ ...emptyBranch(), companyId: companies[0]?.id || "" })}><Plus className="h-4 w-4" />Nova filial</Button>
      <DataTable headers={["Código", "Filial", "Empresa", "Cidade/UF", "Responsável", "Telefone", "Status", "Ações"]} empty={!branches.length}>
        {branches.map((branch) => (
          <TableRow key={branch.id}>
            <TableCell>{branch.code || "-"}</TableCell><TableCell>{branch.name}</TableCell><TableCell>{branch.companyName}</TableCell><TableCell>{[branch.city, branch.state].filter(Boolean).join("/") || "-"}</TableCell>
            <TableCell>{branch.managerName || "-"}</TableCell><TableCell>{branch.phone || "-"}</TableCell><TableCell><StatusBadge status={branch.active ? "Ativo" : "Inativo"} /></TableCell>
            <TableCell><Button size="sm" variant="outline" onClick={() => setForm({ ...branch })}>Editar</Button></TableCell>
          </TableRow>
        ))}
      </DataTable>
      <Sheet open={Boolean(form)} onOpenChange={(value) => !value && setForm(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader><SheetTitle>{form?.id ? "Editar filial" : "Nova filial"}</SheetTitle><SheetDescription>Empresa, nome e identificação são obrigatórios.</SheetDescription></SheetHeader>
          {form && (
            <div className="space-y-4 px-4 pb-6">
              <div className="grid gap-3 md:grid-cols-2">
                <Opts label="Empresa *" value={form.companyId} onChange={(value) => set({ companyId: value })} items={companies.map((company) => ({ value: company.id, label: company.tradeName || company.legalName }))} />
                <TextField label="Código" value={form.code} onChange={(value) => set({ code: value })} />
                <TextField label="Nome *" value={form.name} onChange={(value) => set({ name: value })} />
                <TextField label="Responsável" value={form.managerName} onChange={(value) => set({ managerName: value })} />
                <TextField label="CEP" value={form.zipCode} onChange={(value) => set({ zipCode: value })} />
                <TextField label="Logradouro" value={form.street} onChange={(value) => set({ street: value })} />
                <TextField label="Número" value={form.number} onChange={(value) => set({ number: value })} />
                <TextField label="Complemento" value={form.complement} onChange={(value) => set({ complement: value })} />
                <TextField label="Bairro" value={form.district} onChange={(value) => set({ district: value })} />
                <TextField label="Cidade" value={form.city} onChange={(value) => set({ city: value })} />
                <Opts label="UF" value={form.state} onChange={(value) => set({ state: value })} items={brStates.map((value) => ({ value, label: value }))} />
                <TextField label="Telefone" value={form.phone} onChange={(value) => set({ phone: value })} />
              </div>
              <div className="flex items-center gap-2"><Checkbox id="branch-active" checked={form.active} onCheckedChange={(value) => set({ active: value === true })} /><Label htmlFor="branch-active">Filial ativa</Label></div>
              <Button onClick={() => void save()}>Salvar</Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </SectionCard>
  )
}
