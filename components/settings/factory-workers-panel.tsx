"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, FormSheet, SaveButton, StatusBadge, useCrudFeedback } from "@/components/operations/shared"
import { api, type Row } from "@/components/settings/common"

type Overview = { workers: Row[]; steps: Row[] }
const blank = () => ({ worker_id: "", code: "", name: "", sectors: [] as string[], shift: "", pin: "", is_inspector: false, is_supervisor: false, active: true })

/** Colaboradores da fábrica (matrícula e PIN do tablet): o cadastro fica aqui, junto dos usuários. A matrícula é gerada pelo sistema. */
export function FactoryWorkersPanel() {
  const { toast } = useCrudFeedback()
  const [data, setData] = useState<Overview | null>(null)
  const [edit, setEdit] = useState<Row | null>(null)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState("")

  const load = useCallback(async () => {
    setData(await api<Overview>("/api/chao-de-fabrica/gestor"))
  }, [])
  useEffect(() => { void load().catch((reason) => toast({ title: "Erro ao carregar colaboradores", description: reason instanceof Error ? reason.message : "", variant: "destructive" })) }, [load, toast])

  const workers = data?.workers || []
  const sectors = useMemo(() => Array.from(new Set((data?.steps || []).map((step) => step.sector).filter(Boolean) as string[])), [data])

  async function save() {
    if (!edit) return
    setSaving(true); setFailure("")
    try {
      // sugestão de matrícula só para bancos antigos; o banco novo gera a sua (F0001, F0002...)
      const suggested = `F${String(workers.reduce((max, w) => Math.max(max, Number(/^F(\d+)$/.exec(String(w.code))?.[1] || 0)), 0) + 1).padStart(4, "0")}`
      const next = await api<Overview>("/api/chao-de-fabrica/gestor", { method: "POST", body: JSON.stringify({ action: "worker_save", worker: { ...edit, code: edit.worker_id ? edit.code : suggested, pin: edit.pin || undefined } }) })
      setData(next)
      toast({ title: edit.worker_id ? "Colaborador salvo" : "Colaborador cadastrado", description: edit.worker_id ? "" : "A matrícula foi gerada pelo sistema: veja na lista." })
      setEdit(null)
    } catch (reason) {
      setFailure(reason instanceof Error ? reason.message : "Não foi possível salvar.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <p className="mb-3 text-sm text-muted-foreground">Cada colaborador usa a matrícula e o PIN próprios no tablet da fábrica (não precisa de login no ERP). O PIN é guardado só como hash.</p>
      <Button className="mb-3" onClick={() => { setFailure(""); setEdit(blank()) }}><Plus className="h-4 w-4" />Novo colaborador</Button>
      <DataTable headers={["Matrícula", "Nome", "Setores", "Turno", "PIN", "Status", "Ações"]} empty={!workers.length}>
        {workers.map((w) => (
          <TableRow key={w.id} className={w.active ? "" : "opacity-60"}>
            <TableCell className="font-mono">{w.code}</TableCell><TableCell>{w.name}{w.is_inspector ? <span className="ml-2 text-xs text-muted-foreground">inspetor</span> : null}{w.is_supervisor ? <span className="ml-2 text-xs text-muted-foreground">supervisor</span> : null}</TableCell>
            <TableCell>{(w.sectors || []).join(", ") || "-"}</TableCell><TableCell>{w.shift || "-"}</TableCell>
            <TableCell>{w.locked ? "bloqueado" : w.has_pin ? "definido" : "sem PIN"}</TableCell><TableCell><StatusBadge status={w.active ? "Ativo" : "Inativo"} /></TableCell>
            <TableCell><Button size="sm" variant="outline" onClick={() => { setFailure(""); setEdit({ worker_id: w.id, code: w.code, name: w.name, sectors: w.sectors || [], shift: w.shift || "", pin: "", is_inspector: Boolean(w.is_inspector), is_supervisor: Boolean(w.is_supervisor), active: Boolean(w.active) }) }}>Editar</Button></TableCell>
          </TableRow>
        ))}
      </DataTable>

      <FormSheet open={Boolean(edit)} onOpenChange={(open) => !open && setEdit(null)} title={edit?.worker_id ? "Editar colaborador" : "Novo colaborador"} description="Quem trabalha na fábrica e aponta tarefas no tablet."
        footer={<SaveButton onClick={() => void save()} disabled={saving || !edit?.name?.trim() || (!edit?.worker_id && String(edit?.pin || "").length < 4)}>{saving ? "Salvando..." : "Salvar"}</SaveButton>}>
        {edit ? (
          <div className="space-y-3 text-sm">
            <label className="block">Nome *<Input value={edit.name} onChange={(event) => setEdit({ ...edit, name: event.target.value })} /></label>
            <div>
              <p className="mb-1">Setores em que pode apontar</p>
              <div className="flex flex-wrap gap-2">
                {sectors.length ? sectors.map((sector) => (
                  <label key={sector} className="flex items-center gap-1 rounded border px-2 py-1"><input type="checkbox" checked={edit.sectors.includes(sector)} onChange={(event) => setEdit({ ...edit, sectors: event.target.checked ? [...edit.sectors, sector] : edit.sectors.filter((item: string) => item !== sector) })} />{sector}</label>
                )) : <span className="text-xs text-muted-foreground">Os setores vêm das etapas da esteira (Produção &gt; Esteira da fábrica &gt; Etapas e checklists).</span>}
              </div>
            </div>
            <label className="block">Turno<Input value={edit.shift} placeholder="Ex.: Manhã" onChange={(event) => setEdit({ ...edit, shift: event.target.value })} /></label>
            <div className="flex flex-wrap gap-5">
              <label className="flex items-center gap-1"><input type="checkbox" checked={edit.is_inspector} onChange={(event) => setEdit({ ...edit, is_inspector: event.target.checked })} />Inspetor de qualidade</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={edit.is_supervisor} onChange={(event) => setEdit({ ...edit, is_supervisor: event.target.checked })} />Supervisor</label>
              {edit.worker_id ? <label className="flex items-center gap-1"><input type="checkbox" checked={edit.active} onChange={(event) => setEdit({ ...edit, active: event.target.checked })} />Ativo</label> : null}
            </div>
            {!edit.worker_id ? <p className="text-xs text-muted-foreground">A matrícula é gerada pelo sistema ao salvar.</p> : <p className="text-xs text-muted-foreground">Matrícula: <span className="font-mono">{edit.code}</span></p>}
            <label className="block">{edit.worker_id ? "Novo PIN (deixe vazio para manter)" : "PIN (4 a 8 números) *"}<Input inputMode="numeric" value={edit.pin} onChange={(event) => setEdit({ ...edit, pin: event.target.value.replace(/\D/g, "").slice(0, 8) })} /></label>
            {failure ? <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive" role="alert">{failure}</p> : null}
          </div>
        ) : null}
      </FormSheet>
    </div>
  )
}
