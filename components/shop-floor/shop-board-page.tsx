"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Activity, AlertTriangle, Clock, Hammer, Loader2, Plus, QrCode, RefreshCw, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { MetricCard, PageShell, SectionCard } from "@/components/operations/shared"
import { api, brl, dateBr } from "@/components/catalog/catalog-fields"

type Row = Record<string, any>
type Overview = { board: Row; workers: Row[]; steps: Row[]; productivity: Row; kits: Array<{ id: string; name: string; category: string | null }> }

const statusTone: Record<string, string> = { Pronta: "bg-sky-100 text-sky-800", "Em execucao": "bg-emerald-100 text-emerald-800", Pausada: "bg-amber-100 text-amber-800", Bloqueada: "bg-red-100 text-red-800", "Com pendencia": "bg-orange-100 text-orange-800", Concluida: "bg-slate-100 text-slate-700", Aguardando: "bg-slate-100 text-slate-600" }
const statusLabel: Record<string, string> = { Pronta: "Pronta", "Em execucao": "Em execução", Pausada: "Pausada", Bloqueada: "Bloqueada", "Com pendencia": "Com pendência", Concluida: "Concluída", Aguardando: "Aguardando", Cancelada: "Cancelada" }
const kindLabel: Record<string, string> = { nao_conformidade: "Não conformidade", divergencia_medida: "Divergência de medida", ocorrencia: "Ocorrência", retrabalho: "Retrabalho" }
const fmtH = (hours: number) => `${Number(hours || 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} h`

async function post(body: Record<string, unknown>) {
  return api<Overview & { result: unknown }>("/api/chao-de-fabrica/gestor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
}

/** Painel do gestor: esteira (Kanban) por carreta, colaboradores em atividade, paradas, atrasos, ocorrências, etapas, terceirizados e produtividade. */
export function ShopBoardPage() {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState("")
  const [failure, setFailure] = useState("")
  const [unit, setUnit] = useState<Row | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError("")
    try { setData(await api<Overview>("/api/chao-de-fabrica/gestor")) } catch (failure) { setError(failure instanceof Error ? failure.message : "Erro ao carregar a esteira.") } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 30000); return () => clearInterval(timer) }, [load])

  async function act(body: Record<string, unknown>, success = "Feito.") {
    setNotice(""); setFailure("")
    try { const next = await post(body); setData(next); setNotice(success); return next } catch (reason) { const message = reason instanceof Error ? reason.message : "Ação não concluída."; setNotice(message); setFailure(message); return null }
  }

  const board = data?.board
  const columns = useMemo(() => {
    if (!board) return []
    const steps: Row[] = board.steps
    return [...steps.map((step) => ({ code: step.code, name: step.name, units: (board.units as Row[]).filter((u) => !u.finished && u.current_step === step.code) })), { code: "concluido", name: "Concluído", units: (board.units as Row[]).filter((u) => u.finished) }]
  }, [board])

  return (
    <PageShell title="Esteira da fábrica" description="Cada carreta na sua etapa."
      actions={<><Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Atualizar</Button></>}>
      {error ? <p className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{error}</p> : null}
      {notice ? <p className="rounded-md border bg-muted/40 p-3 text-sm" role="status">{notice}</p> : null}
      {board ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <MetricCard title="Trabalhando agora" value={board.active_workers.length} note="colaboradores" icon={Users} />
            <MetricCard title="Paradas" value={board.stopped.length} note="pausadas ou com pendência" icon={Hammer} />
            <MetricCard title="Atrasadas" value={board.late_count} note="acima do prazo" icon={Clock} />
          </div>
          <Tabs defaultValue="esteira">
            <TabsList className="flex flex-wrap">
              <TabsTrigger value="esteira">Esteira</TabsTrigger>
              <TabsTrigger value="colaboradores">Colaboradores</TabsTrigger><TabsTrigger value="etapas">Etapas e checklists</TabsTrigger>
              
            </TabsList>
            <TabsContent value="esteira" className="mt-4">
              {board.steps.length === 0 ? <SetupNotice onSeed={() => void act({ action: "steps_seed" }, "Etapas oficiais criadas. Cadastre os itens de checklist e os colaboradores.")} /> : (
                <div className="flex gap-3 overflow-x-auto pb-3" data-testid="kanban">
                  {columns.map((column) => (
                    <div key={column.code} className="w-64 shrink-0 rounded-lg border bg-muted/30 p-2">
                      <p className="mb-2 flex items-center justify-between text-sm font-semibold">{column.name}<span className="rounded bg-background px-1.5 text-xs">{column.units.length}</span></p>
                      <div className="space-y-2">
                        {column.units.map((u: Row) => (
                          <button key={`${u.order_id}-${u.unit_number}`} type="button" onClick={() => setUnit(u)} className={`w-full rounded-md border bg-background p-2 text-left text-xs hover:border-primary ${u.late ? "border-red-400" : ""}`}>
                            <p className="font-semibold">{u.order_code} · unid. {u.unit_number}</p>
                            <p className="text-muted-foreground">{u.product}{u.model ? ` · ${u.model}` : ""}</p>
                            <p className="font-mono text-[11px]">{u.vin || "chassi a informar"}</p>
                            {!u.finished ? <span className={`mt-1 inline-block rounded px-1.5 py-0.5 ${statusTone[u.current_status] || "bg-slate-100"}`}>{statusLabel[u.current_status] || u.current_status}</span> : null}
                            {u.late ? <span className="ml-1 rounded bg-red-100 px-1.5 py-0.5 text-red-800">atrasada</span> : null}
                            {u.working.length ? <p className="mt-1 text-emerald-700">{u.working.join(", ")}</p> : u.assigned ? <p className="mt-1 text-muted-foreground">Resp.: {u.assigned}</p> : null}
                            {u.blocked_reason ? <p className="mt-1 text-red-700">{u.blocked_reason}</p> : null}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {board.stopped.length + board.open_occurrences.length > 0 ? <Alerts board={board} onAct={act} /> : null}
              {board.external.some((x: Row) => !x.returned_at) ? <External board={board} onAct={act} /> : null}
              <SectionCard title="Trabalhando agora">
                {board.active_workers.length === 0 ? <p className="text-sm text-muted-foreground">Ninguém com tarefa aberta neste momento.</p> : (
                  <ul className="divide-y text-sm">{board.active_workers.map((w: Row, index: number) => <li key={index} className="flex flex-wrap justify-between gap-2 py-2"><span><b>{w.worker}</b> · {w.task}</span><span className="text-muted-foreground">{w.order_code} unid. {w.unit} · desde {new Date(w.since).toLocaleTimeString("pt-BR")}</span></li>)}</ul>
                )}
              </SectionCard>
            </TabsContent>
            
            <TabsContent value="colaboradores" className="mt-4"><Workers workers={data.workers} steps={data.steps} onAct={act} failure={failure} clearFailure={() => setFailure("")} /></TabsContent>
            <TabsContent value="etapas" className="mt-4"><Steps steps={data.steps} kits={data.kits} onAct={act} /></TabsContent>
          </Tabs>
        </>
      ) : loading ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando...</p> : null}
      {unit ? <UnitDialog unit={unit} workers={data?.workers || []} onClose={() => setUnit(null)} onAct={act} /> : null}
    </PageShell>
  )
}

function SetupNotice({ onSeed }: { onSeed: () => void }) {
  return <SectionCard title="Esteira ainda não configurada"><p className="mb-3 text-sm text-muted-foreground">Crie as 8 etapas do fluxograma oficial (soldagem, acabamento terceirizado, montagem, gravação do chassi, checklist, medidas, faixas e despachante). Os itens de cada checklist são cadastrados por você na aba Etapas e checklists.</p><Button onClick={onSeed}><Plus className="h-4 w-4" />Criar etapas oficiais</Button></SectionCard>
}

function Alerts({ board, onAct }: { board: Row; onAct: (body: Record<string, unknown>, success?: string) => Promise<unknown> }) {
  const [decision, setDecision] = useState<{ id: string; kind: string } | null>(null)
  const [choice, setChoice] = useState("retrabalho")
  const [note, setNote] = useState("")
  return (
    <>
      <SectionCard title="Tarefas paradas">
        {board.stopped.length === 0 ? <p className="text-sm text-muted-foreground">Nada parado.</p> : <ul className="divide-y text-sm">{board.stopped.map((s: Row) => <li key={s.task_id} className="flex flex-wrap justify-between gap-2 py-2"><span>{s.order_code} unid. {s.unit} · {s.step}</span><span><span className={`rounded px-1.5 py-0.5 text-xs ${statusTone[s.status]}`}>{statusLabel[s.status] || s.status}</span> <span className="text-muted-foreground">{s.reason}</span></span></li>)}</ul>}
      </SectionCard>
      <SectionCard title="Ocorrências e não conformidades em aberto">
        {board.open_occurrences.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma ocorrência aberta.</p> : (
          <ul className="divide-y text-sm">{board.open_occurrences.map((o: Row) => (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span><b>{kindLabel[o.kind] || o.kind}</b> · {o.order_code} unid. {o.unit} · {o.step}<br /><span className="text-muted-foreground">{o.description}</span></span><Button size="sm" variant="outline" onClick={() => { setDecision({ id: o.id, kind: o.kind }); setNote(""); setChoice("retrabalho") }}>Decidir</Button></li>
          ))}</ul>
        )}
      </SectionCard>
      <Dialog open={Boolean(decision)} onOpenChange={(open) => !open && setDecision(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Decisão sobre a ocorrência</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <select className="h-9 w-full rounded-md border bg-background px-3" value={choice} onChange={(event) => setChoice(event.target.value)}>
              <option value="retrabalho">Mandar refazer (a tarefa volta para a fila)</option><option value="aceito">Aceitar com justificativa (a tarefa é concluída)</option><option value="cancelado">Encerrar sem ação</option>
            </select>
            <Input placeholder="Justificativa (obrigatória)" value={note} onChange={(event) => setNote(event.target.value)} />
            <Button disabled={note.trim().length < 5} onClick={async () => { const id = decision!.id; setDecision(null); await onAct({ action: "resolve", occurrenceId: id, decision: choice, note }, "Decisão registrada.") }}>Registrar decisão</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Workers({ workers, steps, onAct, failure, clearFailure }: { workers: Row[]; steps: Row[]; onAct: (body: Record<string, unknown>, success?: string) => Promise<unknown>; failure: string; clearFailure: () => void }) {
  const [saving, setSaving] = useState(false)
  // sugestão de matrícula (o banco novo gera a sua própria; o antigo usa esta): próximo F#### livre
  const nextCode = () => `F${String(workers.reduce((max, w) => Math.max(max, Number(/^F(\d+)$/.exec(String(w.code))?.[1] || 0)), 0) + 1).padStart(4, "0")}`
  const sectors = useMemo(() => Array.from(new Set(steps.map((s) => s.sector).filter(Boolean) as string[])), [steps])
  const [edit, setEdit] = useState<Row | null>(null)
  const blank = { code: "", name: "", sectors: [] as string[], shift: "", pin: "", is_inspector: false, is_supervisor: false, active: true }
  return (
    <SectionCard title="Colaboradores da fábrica">
      <div className="mb-3 flex justify-between gap-2"><p className="text-sm text-muted-foreground">Cada colaborador usa matrícula e PIN próprios no tablet. O PIN é guardado só como hash.</p><Button onClick={() => { clearFailure(); setEdit({ ...blank }) }}><Plus className="h-4 w-4" />Novo colaborador</Button></div>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">Matrícula</th><th>Nome</th><th>Setores</th><th>PIN</th><th /></tr></thead>
        <tbody>{workers.map((w) => <tr key={w.id} className={`border-b ${w.active ? "" : "opacity-50"}`}><td className="p-2 font-mono">{w.code}</td><td>{w.name}</td><td>{(w.sectors || []).join(", ")}</td><td>{w.locked ? "bloqueado" : w.has_pin ? "definido" : "sem PIN"}</td><td><Button size="sm" variant="outline" onClick={() => { clearFailure(); setEdit({ worker_id: w.id, code: w.code, name: w.name, sectors: w.sectors || [], shift: w.shift || "", pin: "", is_inspector: w.is_inspector, is_supervisor: w.is_supervisor, active: w.active }) }}>Editar</Button></td></tr>)}</tbody></table></div>
      <Dialog open={Boolean(edit)} onOpenChange={(open) => !open && setEdit(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{edit?.worker_id ? "Editar colaborador" : "Novo colaborador"}</DialogTitle></DialogHeader>
          {edit ? (
            <div className="space-y-3 text-sm">
              <label className="block">Nome<Input value={edit.name} onChange={(event) => setEdit({ ...edit, name: event.target.value })} /></label>
              <div><p className="mb-1">Setores em que pode apontar</p><div className="flex flex-wrap gap-2">{sectors.map((sector) => <label key={sector} className="flex items-center gap-1 rounded border px-2 py-1"><input type="checkbox" checked={edit.sectors.includes(sector)} onChange={(event) => setEdit({ ...edit, sectors: event.target.checked ? [...edit.sectors, sector] : edit.sectors.filter((s: string) => s !== sector) })} />{sector}</label>)}</div></div>
              {edit.worker_id ? <label className="flex items-center gap-1"><input type="checkbox" checked={edit.active} onChange={(event) => setEdit({ ...edit, active: event.target.checked })} />Ativo</label> : <p className="text-xs text-muted-foreground">A matrícula é gerada pelo sistema ao salvar.</p>}
              <label className="block">{edit.worker_id ? "Novo PIN (deixe vazio para manter)" : "PIN (4 a 8 números)"}<Input inputMode="numeric" value={edit.pin} onChange={(event) => setEdit({ ...edit, pin: event.target.value.replace(/\D/g, "").slice(0, 8) })} /></label>
              {failure ? <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive" role="alert">{failure}</p> : null}
              <Button disabled={saving || !edit.name.trim() || (!edit.worker_id && edit.pin.length < 4)} onClick={async () => {
                setSaving(true)
                const body = { ...edit, code: edit.worker_id ? edit.code : nextCode(), pin: edit.pin || undefined }
                const saved = await onAct({ action: "worker_save", worker: body }, edit.worker_id ? "Colaborador salvo." : "Colaborador cadastrado: a matrícula foi gerada pelo sistema (veja na lista).")
                setSaving(false)
                if (saved) setEdit(null)
              }}>{saving ? "Salvando..." : "Salvar"}</Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </SectionCard>
  )
}

function Steps({ steps, kits, onAct }: { steps: Row[]; kits: Array<{ id: string; name: string; category: string | null }>; onAct: (body: Record<string, unknown>, success?: string) => Promise<unknown> }) {
  const [item, setItem] = useState<Record<string, string>>({})
  if (steps.length === 0) return <SetupNotice onSeed={() => void onAct({ action: "steps_seed" }, "Etapas oficiais criadas.")} />
  return (
    <div className="space-y-4">
      {steps.map((step) => (
        <SectionCard key={step.id} title={`${step.seq}. ${step.name}`}>
          <div className="max-w-xs text-sm">
            <label>Setor que executa<Input defaultValue={step.sector || ""} onBlur={(event) => event.target.value !== (step.sector || "") && void onAct({ action: "step_save", step: { step_id: step.id, sector: event.target.value } }, "Etapa atualizada.")} /></label>
          </div>
          <div className="mt-2 flex flex-wrap gap-4 text-sm"><label className="flex items-center gap-1"><input type="checkbox" checked={step.requires_checklist} onChange={(event) => void onAct({ action: "step_save", step: { step_id: step.id, requires_checklist: event.target.checked } }, "Etapa atualizada.")} />Exige checklist</label>
            </div>
          <div className="mt-2 text-sm"><p className="mb-1 font-medium">Kits desta etapa</p>
            <div className="flex flex-wrap gap-2">{kits.map((kit) => { const on = (step.kits || []).includes(kit.id); return <label key={kit.id} className={`flex items-center gap-1 rounded border px-2 py-1 ${on ? "border-primary bg-primary/10" : ""}`}><input type="checkbox" checked={on} onChange={(event) => void onAct({ action: "step_kits", stepId: step.id, kits: event.target.checked ? [...(step.kits || []), kit.id] : (step.kits || []).filter((id: string) => id !== kit.id) }, "Kits da etapa atualizados.")} />{kit.name}</label> })}</div></div>
          {step.requires_checklist ? (
            <div className="mt-3 text-sm"><p className="mb-1 font-medium">Itens do checklist</p>
              {step.items.length === 0 ? <p className="rounded bg-amber-50 p-2 text-amber-900">Sem itens: a tarefa não poderá ser finalizada no tablet até você cadastrar o checklist.</p> : <ul className="mb-2 list-disc pl-5">{step.items.map((it: Row) => <li key={it.id}>{it.label} {it.mandatory ? <span className="text-xs text-muted-foreground">(obrigatório)</span> : null}</li>)}</ul>}
              <div className="flex gap-2"><Input placeholder="Novo item de checklist" value={item[step.id] || ""} onChange={(event) => setItem({ ...item, [step.id]: event.target.value })} /><Button disabled={!(item[step.id] || "").trim()} onClick={async () => { const label = item[step.id]; setItem({ ...item, [step.id]: "" }); await onAct({ action: "item_save", item: { step_id: step.id, label, mandatory: true } }, "Item adicionado.") }}>Adicionar</Button></div></div>
          ) : null}
        </SectionCard>
      ))}
    </div>
  )
}

function External({ board, onAct }: { board: Row; onAct: (body: Record<string, unknown>, success?: string) => Promise<unknown> }) {
  const [ret, setRet] = useState<Row | null>(null)
  const [cost, setCost] = useState("")
  return (
    <SectionCard title="Etapas terceirizadas (galvanização, eletrostática, pintura)">
      <p className="mb-3 text-sm text-muted-foreground">O envio e o retorno são feitos pela ficha da carreta na aba Esteira. O tempo externo não conta como hora de colaborador.</p>
      {board.external.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum envio registrado.</p> : (
        <table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">Carreta</th><th>Prestador</th><th>Acabamento</th><th>Saída</th><th>Previsão</th><th>Retorno</th><th>Custo</th><th /></tr></thead>
          <tbody>{board.external.map((x: Row) => <tr key={x.task_id} className="border-b"><td className="p-2">{x.order_code} unid. {x.unit}</td><td>{x.provider}</td><td>{x.finish_type}</td><td>{dateBr(x.sent_at)}</td><td>{dateBr(x.expected_return)}</td><td>{x.returned_at ? dateBr(x.returned_at) : <b className="text-amber-700">com o prestador</b>}</td><td>{x.cost != null ? brl(x.cost) : "-"}</td><td>{!x.returned_at ? <Button size="sm" variant="outline" onClick={() => { setRet(x); setCost("") }}>Registrar retorno</Button> : null}</td></tr>)}</tbody></table>
      )}
      <Dialog open={Boolean(ret)} onOpenChange={(open) => !open && setRet(null)}>
        <DialogContent><DialogHeader><DialogTitle>Retorno do prestador</DialogTitle></DialogHeader>
          <Input inputMode="decimal" placeholder="Custo do serviço (R$)" value={cost} onChange={(event) => setCost(event.target.value.replace(",", "."))} />
          <Button onClick={async () => { const id = ret!.task_id; setRet(null); await onAct({ action: "external_return", taskId: id, cost: cost ? Number(cost) : null }, "Retorno registrado: a próxima etapa foi liberada.") }}>Confirmar retorno</Button></DialogContent>
      </Dialog>
    </SectionCard>
  )
}

function Productivity({ data }: { data: Row }) {
  return (
    <div className="space-y-4">
      <SectionCard title="Por etapa (últimos 30 dias)">
        <table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">Etapa</th><th>Tarefas</th><th>Concluídas</th><th>Horas de mão de obra</th><th>Tempo médio decorrido</th><th>Previsto</th><th>Retrabalho</th></tr></thead>
          <tbody>{data.by_step.map((s: Row) => <tr key={s.step} className="border-b"><td className="p-2">{s.step}</td><td>{s.tasks}</td><td>{s.done}</td><td>{fmtH(s.labor_hours)}</td><td>{s.avg_elapsed_minutes != null ? `${Math.round(s.avg_elapsed_minutes)} min` : "-"}</td><td>{s.planned_minutes != null ? `${s.planned_minutes} min` : "-"}</td><td>{s.rework}</td></tr>)}</tbody></table>
      </SectionCard>
      <SectionCard title="Por colaborador (horas sem dupla contagem)">
        <table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">Colaborador</th><th>Tarefas</th><th>Horas</th></tr></thead>
          <tbody>{data.by_worker.map((w: Row) => <tr key={w.worker_id} className="border-b"><td className="p-2">{w.name}</td><td>{w.tasks}</td><td>{fmtH(w.hours)}</td></tr>)}</tbody></table>
        <p className="mt-2 text-xs text-muted-foreground">Etapas terceirizadas e administrativas ficam fora da mão de obra de fabricação. Estes valores são gerenciais e não lançam nada no financeiro.</p>
      </SectionCard>
    </div>
  )
}

/** Ficha da carreta: ações por tarefa (reatribuir, bloquear, cancelar, enviar ao prestador), entrada do acabado e QR Code. */
function UnitDialog({ unit, workers, onClose, onAct }: { unit: Row; workers: Row[]; onClose: () => void; onAct: (body: Record<string, unknown>, success?: string) => Promise<unknown> }) {
  const [tasks, setTasks] = useState<Row[]>([])
  const [qr, setQr] = useState("")
  const [form, setForm] = useState<{ kind: string; task: Row } | null>(null)
  const [reason, setReason] = useState("")
  const [worker, setWorker] = useState("")
  const [bulk, setBulk] = useState("")
  const [provider, setProvider] = useState("")
  const [finish, setFinish] = useState("galvanizacao_a_fogo")
  const reload = useCallback(async () => {
    if (!unit.token) return
    try { setTasks((await api<{ unit: { tasks: Row[] } }>(`/api/chao-de-fabrica/unidade/${unit.token}`)).unit.tasks) } catch { setTasks([]) }
  }, [unit.token])
  useEffect(() => { void reload() }, [reload])
  useEffect(() => {
    if (!unit.token) return
    import("qrcode").then((QR) => QR.toDataURL(`${window.location.origin}/producao/tablet/unidade/${unit.token}`, { margin: 1, width: 220 })).then(setQr).catch(() => setQr(""))
  }, [unit.token])
  const run = async (body: Record<string, unknown>, success: string) => { setForm(null); setReason(""); await onAct(body, success); await reload() }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>{unit.order_code} · unidade {unit.unit_number} · {unit.product}{unit.model ? ` · ${unit.model}` : ""}</DialogTitle></DialogHeader>
        <div className="flex flex-wrap items-start justify-between gap-4 text-sm">
          <div className="space-y-1"><p>Chassi: <span className="font-mono font-semibold">{unit.vin || "a informar"}</span></p><p>Prazo: {dateBr(unit.planned_end)}{unit.late ? <span className="ml-2 rounded bg-red-100 px-1.5 text-red-800">atrasada</span> : null}</p><p>Progresso: {unit.done_tasks} de {unit.total_tasks} etapas</p>
            {unit.finished ? <Button size="sm" onClick={() => void run({ action: "receive_unit", orderId: unit.order_id, unit: unit.unit_number }, "Acabado recebido no estoque.")}>Dar entrada do acabado no estoque</Button> : null}</div>
          {qr ? <div className="text-center"><img src={qr} alt="QR Code da carreta" className="h-36 w-36" /><p className="flex items-center justify-center gap-1 text-xs text-muted-foreground"><QrCode className="h-3 w-3" />aponte no tablet</p><button type="button" className="text-xs underline" onClick={() => window.print()}>Imprimir</button></div> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2 text-sm">
          <span className="font-medium">Designar a unidade inteira a:</span>
          <select className="h-9 rounded-md border bg-background px-3" value={bulk} onChange={(event) => setBulk(event.target.value)}><option value="">Escolha o colaborador</option>{workers.filter((w) => w.active).map((w) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}</select>
          <Button size="sm" disabled={!bulk} onClick={() => void run({ action: "assign_unit", orderId: unit.order_id, unit: unit.unit_number, workerId: bulk }, "Tarefas da unidade designadas (as que já tinham responsável não mudam).")}>Designar</Button>
        </div>
        <ul className="divide-y text-sm">{tasks.map((task) => (
          <li key={task.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span>{task.step} <span className={`ml-1 rounded px-1.5 py-0.5 text-xs ${statusTone[task.status] || "bg-slate-100"}`}>{statusLabel[task.status] || task.status}</span></span>
            <span className="flex flex-wrap gap-1">
              {!["Concluida", "Cancelada"].includes(task.status) ? <>
                <Button size="sm" variant="outline" onClick={() => { setForm({ kind: "reassign", task }); setWorker(""); setReason("") }}>Designar</Button>
                <Button size="sm" variant="outline" onClick={() => setForm({ kind: task.status === "Bloqueada" ? "unblock" : "block", task })}>{task.status === "Bloqueada" ? "Desbloquear" : "Bloquear"}</Button>
                <Button size="sm" variant="outline" onClick={() => setForm({ kind: "cancel", task })}>Cancelar</Button></> : null}
              {task.status === "Pronta" && /acabamento/i.test(task.step) ? <Button size="sm" onClick={() => { setForm({ kind: "send", task }); setProvider("") }}>Enviar ao prestador</Button> : null}
            </span></li>
        ))}</ul>
        {form ? (
          <div className="space-y-3 rounded-md border p-3 text-sm">
            <p className="font-medium">{form.task.step}</p>
            {form.kind === "reassign" ? <select className="h-9 w-full rounded-md border bg-background px-3" value={worker} onChange={(event) => setWorker(event.target.value)}><option value="" disabled>Escolha o colaborador</option>{workers.filter((w) => w.active).map((w) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}</select> : null}
            {form.kind === "send" ? <><Input placeholder="Prestador" value={provider} onChange={(event) => setProvider(event.target.value)} /><select className="h-9 w-full rounded-md border bg-background px-3" value={finish} onChange={(event) => setFinish(event.target.value)}><option value="galvanizacao_a_fogo">Galvanização a fogo</option><option value="eletrostatica">Eletrostática</option><option value="pintura">Pintura</option><option value="outro">Outro</option></select></> : null}
            {form.kind !== "send" ? <Input placeholder={form.kind === "reassign" ? "Justificativa (só se estiver trocando quem já está com a tarefa)" : "Justificativa (obrigatória)"} value={reason} onChange={(event) => setReason(event.target.value)} /> : null}
            <div className="flex gap-2">
              <Button disabled={form.kind === "send" ? !provider.trim() : form.kind === "reassign" ? !worker : reason.trim().length < 5} onClick={() => {
                const taskId = form.task.id
                if (form.kind === "reassign") void run({ action: "reassign", taskId, workerId: worker || null, reason: reason || undefined }, "Tarefa designada.")
                else if (form.kind === "block" || form.kind === "unblock") void run({ action: "block", taskId, blocked: form.kind === "block", reason }, form.kind === "block" ? "Tarefa bloqueada." : "Tarefa desbloqueada.")
                else if (form.kind === "cancel") void run({ action: "cancel", taskId, reason }, "Tarefa cancelada.")
                else void run({ action: "external_send", taskId, external: { provider_name: provider, finish_type: finish } }, "Enviada ao prestador.")
              }}>Confirmar</Button>
              <Button variant="outline" onClick={() => setForm(null)}>Voltar</Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
