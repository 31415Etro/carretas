"use client"

import { useCallback, useEffect, useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, FormSheet, SaveButton, StatusBadge, TextAreaField, TextField, useCrudFeedback } from "@/components/operations/shared"
import { api, Opts, type Row } from "@/components/settings/common"

const emptySalesperson = (): Row => ({ id: "", name: "", email: "", phone: "", status: "Ativo", notes: "" })

/** Vendedores (responsáveis por clientes, oportunidades e orçamentos): o cadastro fica aqui, junto dos usuários. */
export function SalespeoplePanel() {
  const { toast } = useCrudFeedback()
  const [rows, setRows] = useState<Row[]>([])
  const [sheet, setSheet] = useState<Row | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const result = await api<{ salespeople: Row[] }>("/api/comercial/salespeople")
    setRows(result.salespeople)
  }, [])
  useEffect(() => { void load().catch((reason) => toast({ title: "Erro ao carregar vendedores", description: reason instanceof Error ? reason.message : "", variant: "destructive" })) }, [load, toast])

  async function save() {
    if (!sheet) return
    setSaving(true)
    try {
      await api("/api/comercial/salespeople", { method: "POST", body: JSON.stringify({ salesperson: sheet }) })
      toast({ title: sheet.id ? "Vendedor atualizado" : "Vendedor cadastrado" })
      setSheet(null)
      await load()
    } catch (reason) {
      toast({ title: "Não foi possível salvar", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <p className="mb-3 text-sm text-muted-foreground">Quem aparece como vendedor responsável nas oportunidades, orçamentos e pedidos. Inative em vez de excluir: o histórico das vendas continua com o nome.</p>
      <Button className="mb-3" onClick={() => setSheet(emptySalesperson())}><Plus className="h-4 w-4" />Novo vendedor</Button>
      <DataTable headers={["Nome", "E-mail", "Telefone", "Status", "Ações"]} empty={!rows.length}>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>{row.name}</TableCell><TableCell>{row.email || "-"}</TableCell><TableCell>{row.phone || "-"}</TableCell>
            <TableCell><StatusBadge status={row.status} /></TableCell>
            <TableCell><Button size="sm" variant="outline" onClick={() => setSheet({ ...row })}>Editar</Button></TableCell>
          </TableRow>
        ))}
      </DataTable>
      <FormSheet open={Boolean(sheet)} onOpenChange={(value) => !value && setSheet(null)} title={sheet?.id ? "Editar vendedor" : "Novo vendedor"} footer={<SaveButton onClick={() => void save()} disabled={saving || !sheet?.name?.trim()}>{saving ? "Salvando..." : "Salvar"}</SaveButton>}>
        {sheet && (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <TextField label="Nome *" value={sheet.name} onChange={(value) => setSheet({ ...sheet, name: value })} />
              <Opts label="Status" value={sheet.status} onChange={(value) => setSheet({ ...sheet, status: value || "Ativo" })} items={["Ativo", "Inativo"].map((value) => ({ value, label: value }))} />
              <TextField label="E-mail" value={sheet.email} onChange={(value) => setSheet({ ...sheet, email: value })} />
              <TextField label="Telefone" value={sheet.phone} onChange={(value) => setSheet({ ...sheet, phone: value })} />
            </div>
            <TextAreaField label="Observações" value={sheet.notes} onChange={(value) => setSheet({ ...sheet, notes: value })} />
          </>
        )}
      </FormSheet>
    </div>
  )
}
