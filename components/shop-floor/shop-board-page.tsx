"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Activity, AlertTriangle, Clock, Hammer, Loader2, Plus, QrCode, RefreshCw, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DataTable, MetricCard, PageShell, SectionCard } from "@/components/operations/shared"
import { TableCell, TableRow } from "@/components/ui/table"
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
    <PageShell title="Esteira da fábrica" description="Cada carreta na sua etapa. Defina o responsável e conclua a etapa para a carreta avançar."
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
          <div className="space-y-4">
              {board.steps.length === 0 ? <SetupNotice onSeed={() => void act({ action: "steps_seed" }, "Etapas oficiais criadas. Cadastre os itens de checklist e os colaboradores.")} /> : (
                <div className="flex gap-3 overflow-x-auto pb-3" data-testid="kanban">
                  {columns.map((column) => (
                    <div key={column.code} className="w-64 shrink-0 rounded-lg border bg-muted/30 p-2">
                      <p className="mb-2 flex items-center justify-between text-sm font-semibold">{column.name}<span className="rounded bg-background px-1.5 text-xs">{column.units.length}</span></p>
                      <div className="space-y-2">
                        {column.units.map((u: Row) => (
                          <div key={`${u.order_id}-${u.unit_number}`} className={`rounded-md border bg-background p-2 text-xs hover:border-primary ${u.late ? "border-red-400" : ""}`}>
                          <button type="button" onClick={() => setUnit(u)} className="w-full text-left" title="Abrir a ficha da carreta">
                            <p className="font-semibold">{u.order_code} · unid. {u.unit_number}</p>
                            <p className="text-muted-foreground">{u.product}{u.model ? ` · ${u.model}` : ""}</p>
                            <p className="font-mono text-[11px]">{u.vin || "chassi a informar"}</p>
                            {!u.finished ? <span className={`mt-1 inline-block rounded px-1.5 py-0.5 ${statusTone[u.current_status] || "bg-slate-100"}`}>{statusLabel[u.current_status] || u.current_status}</span> : null}
                            {u.late ? <span className="ml-1 rounded bg-red-100 px-1.5 py-0.5 text-red-800">atrasada</span> : null}
                            {u.blocked_reason ? <p className="mt-1 text-red-700">{u.blocked_reason}</p> : null}
                          </button>
                            {!u.finished ? (
                              <div className="mt-2 space-y-1">
                                <select aria-label="Responsável pela carreta" className="h-7 w-full rounded-md border bg-background px-1 text-[11px]" value="" onChange={(event) => event.target.value && void act({ action: "assign_unit", orderId: u.order_id, unit: u.unit_number, workerId: event.target.value }, "Responsável definido.")}>
                                  <option value="">{u.working.length ? u.working.join(", ") : u.assigned ? `Resp.: ${u.assigned}` : "Definir responsável"}</option>
                                  {(data?.workers || []).filter((w: Row) => w.active).map((w: Row) => <option key={w.id} value={w.id}>{w.name}</option>)}
                                </select>
                                <Button size="sm" className="h-8 w-full text-xs" onClick={() => void act({ action: "advance", orderId: u.order_id, unit: u.unit_number }, `Etapa "${u.current_name || column.name}" concluída.`)}>Concluir etapa e avançar</Button>
                              </div>
                            ) : <p className="mt-1 text-[11px] font-medium text-emerald-700">Pronta: entrou no estoque de acabados</p>}
                          </div>
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
            <details className="rounded-lg border bg-card p-3 text-sm">
              <summary className="cursor-pointer font-medium">Configurar etapas da esteira (avançado)</summary>
              <div className="mt-3"><Steps steps={data.steps} kits={data.kits} onAct={act} /></div>
            </details>
          </div>
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
  return (
    <SectionCard title="Etapas terceirizadas (galvanização, eletrostática, pintura)">
      <p className="mb-3 text-sm text-muted-foreground">O envio e o retorno são feitos pela ficha da carreta na aba Esteira. O tempo externo não conta como hora de colaborador.</p>
      {board.external.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum envio registrado.</p> : (
        <DataTable headers={["Carreta", "Prestador", "Acabamento", "Saída", "Previsão", "Retorno", ""]}>{board.external.map((x: Row) => <TableRow key={x.task_id}><TableCell>{x.order_code} unid. {x.unit}</TableCell><TableCell>{x.provider}</TableCell><TableCell>{x.finish_type}</TableCell><TableCell>{dateBr(x.sent_at)}</TableCell><TableCell>{dateBr(x.expected_return)}</TableCell><TableCell>{x.returned_at ? dateBr(x.returned_at) : <b className="text-amber-700">com o prestador</b>}</TableCell><TableCell>{!x.returned_at ? <Button size="sm" variant="outline" onClick={() => { setRet(x) }}>Registrar retorno</Button> : null}</TableCell></TableRow>)}</DataTable>
      )}
      <Dialog open={Boolean(ret)} onOpenChange={(open) => !open && setRet(null)}>
        <DialogContent><DialogHeader><DialogTitle>Retorno do prestador</DialogTitle></DialogHeader><p className="text-sm text-muted-foreground">Confirma que a peça voltou do prestador? A próxima etapa será liberada.</p>
          <Button onClick={async () => { const id = ret!.task_id; setRet(null); await onAct({ action: "external_return", taskId: id }, "Retorno registrado: a próxima etapa foi liberada.") }}>Confirmar retorno</Button></DialogContent>
      </Dialog>
    </SectionCard>
  )
}

function Productivity({ data }: { data: Row }) {
  return (
    <div className="space-y-4">
      <SectionCard title="Por etapa (últimos 30 dias)">
        <DataTable headers={["Etapa", "Tarefas", "Concluídas", "Horas de mão de obra", "Tempo médio decorrido", "Previsto", "Retrabalho"]}>{data.by_step.map((s: Row) => <TableRow key={s.step}><TableCell>{s.step}</TableCell><TableCell>{s.tasks}</TableCell><TableCell>{s.done}</TableCell><TableCell>{fmtH(s.labor_hours)}</TableCell><TableCell>{s.avg_elapsed_minutes != null ? `${Math.round(s.avg_elapsed_minutes)} min` : "-"}</TableCell><TableCell>{s.planned_minutes != null ? `${s.planned_minutes} min` : "-"}</TableCell><TableCell>{s.rework}</TableCell></TableRow>)}</DataTable>
      </SectionCard>
      <SectionCard title="Por colaborador (horas sem dupla contagem)">
        <DataTable headers={["Colaborador", "Tarefas", "Horas"]}>{data.by_worker.map((w: Row) => <TableRow key={w.worker_id}><TableCell>{w.name}</TableCell><TableCell>{w.tasks}</TableCell><TableCell>{fmtH(w.hours)}</TableCell></TableRow>)}</DataTable>
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
