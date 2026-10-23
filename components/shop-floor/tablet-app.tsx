"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, ArrowLeft, Camera, CheckCircle2, ClipboardCheck, Delete, FileImage, Loader2, LogOut, Package, Pause, Play, Ruler, WifiOff, ZoomIn, ZoomOut } from "lucide-react"
import { TrailerDrawingView } from "@/components/configurator/trailer-drawing-view"

type Worker = { id: string; code: string; name: string; sectors: string[]; shift: string | null; is_inspector: boolean; is_supervisor: boolean }
type Session = { token: string; worker: Worker; idle_minutes: number }
type Card = {
  id: string; step_code: string; step: string; status: string; kind: string; unit_number: number; planned_end: string | null; blocked_reason: string | null; pending_reason: string | null; started_at: string | null; finished_at: string | null
  order_code: string; priority: number; quantity: number; product: string; model: string | null; vin: string | null; assigned: string | null; working: Array<{ name: string; since: string }>; mine_open: boolean; worked_by_me: boolean; rework_count: number
}
type Detail = {
  task: Card; step: { code: string; name: string; requires_checklist: boolean; requires_measures: boolean; allow_multiple: boolean }
  materials: Array<{ material_id: string; sku: string; name: string; description: string | null; unit: string; kit: string; kit_version: number | null; planned: number; planned_order: number; reserved: number; consumed: number; consumed_by_task: number; available: number }>
  drawing: { product: { name: string; model: string | null; sku: string }; configuration: null | { params: Record<string, number>; options: { selected?: Array<{ group: string; label: string }> }; homologated: boolean; revision: string | null; summary: string; drawing_spec: { grade?: string; geometry?: Record<string, number> } | null }; bom_notes: string | null }
  checklist: Array<{ item_id: string; label: string; mandatory: boolean; allow_na: boolean; result: string | null; note: string | null }>
  measures: Array<{ param: string; expected: number; measured: number; divergent: boolean }>
  occurrences: Array<{ id: string; kind: string; description: string; status: string; decision: string | null }>
  metrics: { elapsed_productive_minutes: number; labor_minutes: number; pause_minutes: number; workers: Array<{ name: string; minutes: number }>; planned_minutes: number | null }
  server_time: string
}

const STORAGE = "shop-session"
const PAUSE_REASONS = ["Intervalo", "Falta de material", "Aguardando equipamento", "Aguardando orientação", "Problema técnico", "Outro motivo"]
const statusLabel: Record<string, string> = { Pronta: "Pronta", "Em execucao": "Em execução", Pausada: "Pausada", Bloqueada: "Bloqueada", "Com pendencia": "Com pendência", Concluida: "Concluída", Aguardando: "Aguardando" }
const statusTone: Record<string, string> = { Pronta: "bg-sky-600", "Em execucao": "bg-emerald-600", Pausada: "bg-amber-600", Bloqueada: "bg-red-700", "Com pendencia": "bg-orange-700", Concluida: "bg-slate-600", Aguardando: "bg-slate-500" }
const newKey = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
const fmtMin = (minutes: number) => { const m = Math.max(0, Math.round(minutes)); return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` }
const clock = (seconds: number) => { const s = Math.max(0, Math.floor(seconds)); return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` }
const dateBr = (value: string | null) => (value ? value.slice(0, 10).split("-").reverse().join("/") : "-")
const qty = (value: number) => Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 3 })

class OfflineError extends Error {}
async function call<T>(url: string, token: string | null, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, { cache: "no-store", ...init, headers: { ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...(token ? { "x-worker-token": token } : {}), "x-device": "tablet", ...(init?.headers || {}) } })
  } catch {
    throw new OfflineError("Sem conexão com o servidor.")
  }
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw Object.assign(new Error(payload?.error || payload?.message || `Erro ${response.status}`), { status: response.status })
  return payload as T
}

/** Botão grande de toque (mínimo 64 px). */
function Big({ children, tone = "bg-slate-800", disabled, onClick, className = "" }: { children: React.ReactNode; tone?: string; disabled?: boolean; onClick?: () => void; className?: string }) {
  return <button type="button" disabled={disabled} onClick={onClick} className={`flex min-h-16 items-center justify-center gap-3 rounded-2xl px-6 text-xl font-bold text-white shadow active:scale-[0.98] disabled:opacity-40 ${tone} ${className}`}>{children}</button>
}

export function TabletApp() {
  const [session, setSession] = useState<Session | null>(null)
  const [cards, setCards] = useState<Card[] | null>(null)
  const [offset, setOffset] = useState(0)               // diferença entre o relógio do servidor e o do tablet (só para exibir cronômetros)
  const [open, setOpen] = useState<string | null>(null)
  const [online, setOnline] = useState(true)
  const [message, setMessage] = useState("")
  const [now, setNow] = useState(Date.now())
  const last = useRef(Date.now())

  const logout = useCallback(async (notice = "") => {
    const token = session?.token
    setSession(null); setCards(null); setOpen(null)
    try { sessionStorage.removeItem(STORAGE) } catch { /* sem armazenamento */ }
    if (token) await fetch("/api/chao-de-fabrica/sessao", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "logout", token }) }).catch(() => undefined)
    setMessage(notice)
  }, [session])

  useEffect(() => { try { const stored = sessionStorage.getItem(STORAGE); if (stored) setSession(JSON.parse(stored)) } catch { /* sem armazenamento */ } }, [])
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    update(); window.addEventListener("online", update); window.addEventListener("offline", update)
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update) }
  }, [])
  // toque em qualquer lugar renova a inatividade; passado o limite o tablet volta para a identificação (o servidor também confere)
  useEffect(() => {
    if (!session) return
    const touch = () => { last.current = Date.now() }
    window.addEventListener("pointerdown", touch)
    const timer = setInterval(() => { if (Date.now() - last.current > session.idle_minutes * 60000) void logout("Sessão encerrada por inatividade.") }, 15000)
    return () => { window.removeEventListener("pointerdown", touch); clearInterval(timer) }
  }, [session, logout])

  const load = useCallback(async () => {
    if (!session) return
    try {
      const data = await call<{ tasks: Card[]; server_time: string }>("/api/chao-de-fabrica/tarefas", session.token)
      setCards(data.tasks); setOffset(new Date(data.server_time).getTime() - Date.now()); setOnline(true)
    } catch (error) {
      if (error instanceof OfflineError) { setOnline(false); return }
      if ((error as { status?: number }).status === 401) { void logout("Sessão expirada: identifique-se novamente."); return }
      setMessage(error instanceof Error ? error.message : "Erro ao carregar as tarefas.")
    }
  }, [session, logout])
  useEffect(() => { void load(); const timer = setInterval(() => { if (!open) void load() }, 20000); return () => clearInterval(timer) }, [load, open])

  if (!session) return <Login onSession={(next) => { setSession(next); setMessage(""); last.current = Date.now(); try { sessionStorage.setItem(STORAGE, JSON.stringify(next)) } catch { /* sem armazenamento */ } }} notice={message} online={online} />

  const serverNow = now + offset
  const mine = (cards || []).filter((card) => card.mine_open)
  const running = (cards || []).filter((card) => card.status === "Em execucao" && !card.mine_open)
  const ready = (cards || []).filter((card) => ["Pronta", "Pausada"].includes(card.status))
  const attention = (cards || []).filter((card) => ["Bloqueada", "Com pendencia"].includes(card.status))
  const done = (cards || []).filter((card) => card.status === "Concluida")
  const section = (title: string, list: Card[], emphasis = false) => list.length ? (
    <section className="space-y-3">
      <h2 className="text-2xl font-bold text-white">{title} <span className="text-slate-400">({list.length})</span></h2>
      <div className="grid gap-4 lg:grid-cols-2">{list.map((card) => <TaskCard key={card.id} card={card} serverNow={serverNow} emphasis={emphasis} onOpen={() => setOpen(card.id)} />)}</div>
    </section>
  ) : null

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-900 px-5 py-3">
        <div>
          <p className="text-2xl font-extrabold">{session.worker.name}</p>
          <p className="text-base text-slate-300">{session.worker.sectors.join(", ") || "Supervisor"}{session.worker.shift ? ` · turno ${session.worker.shift}` : ""} · matrícula {session.worker.code}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-slate-800 px-4 py-2 text-lg tabular-nums">{new Date(serverNow).toLocaleTimeString("pt-BR")}</span>
          {!online ? <span className="flex items-center gap-2 rounded-xl bg-red-700 px-4 py-2 text-lg font-bold"><WifiOff className="h-5 w-5" />Sem conexão</span> : null}
          <Big tone="bg-slate-700" onClick={() => void logout()} className="min-h-14 text-lg"><LogOut className="h-6 w-6" />Trocar colaborador</Big>
        </div>
      </header>
      <main className="space-y-8 p-5">
        {message ? <p className="rounded-2xl bg-amber-900/60 p-4 text-lg" role="status">{message}</p> : null}
        {cards === null ? <p className="flex items-center gap-3 text-xl text-slate-300"><Loader2 className="h-6 w-6 animate-spin" />Carregando suas tarefas...</p> : null}
        {cards && cards.length === 0 ? <p className="rounded-2xl bg-slate-900 p-8 text-center text-2xl text-slate-300">Nenhuma tarefa para você agora. Avise o gestor se estiver sem trabalho.</p> : null}
        {section("Fazendo agora", mine, true)}
        {section("Para fazer", ready)}
        {section("Com problema", attention)}
        {section("Feitas hoje", done)}
      </main>
      {open ? <TaskScreen id={open} session={session} serverOffset={offset} onClose={() => { setOpen(null); void load() }} onExpired={() => void logout("Sessão expirada: identifique-se novamente.")} /> : null}
    </div>
  )
}

function TaskCard({ card, serverNow, emphasis, onOpen }: { card: Card; serverNow: number; emphasis: boolean; onOpen: () => void }) {
  const since = card.working.find((w) => w.name)?.since
  return (
    <button type="button" onClick={onOpen} className={`rounded-3xl border-2 p-5 text-left active:scale-[0.99] ${emphasis ? "border-emerald-400 bg-emerald-950" : "border-slate-700 bg-slate-900"}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-2xl font-extrabold leading-tight">{card.step}</p>
        <span className={`shrink-0 rounded-xl px-3 py-1 text-lg font-bold ${statusTone[card.status] || "bg-slate-600"}`}>{statusLabel[card.status] || card.status}</span>
      </div>
      <p className="mt-2 text-xl text-slate-200">{card.product}{card.model ? ` · ${card.model}` : ""}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-lg text-slate-300">
        <div><dt className="inline text-slate-500">Ordem </dt><dd className="inline font-semibold text-white">{card.order_code}</dd></div>
        <div><dt className="inline text-slate-500">Unidade </dt><dd className="inline font-semibold text-white">{card.unit_number} de {Math.ceil(card.quantity)}</dd></div>
        <div className="col-span-2"><dt className="inline text-slate-500">Chassi </dt><dd className="inline font-mono font-semibold text-white">{card.vin || "a informar"}</dd></div>
        <div><dt className="inline text-slate-500">Prazo </dt><dd className="inline text-white">{dateBr(card.planned_end)}</dd></div>
        <div><dt className="inline text-slate-500">Responsável </dt><dd className="inline text-white">{card.assigned || "equipe"}</dd></div>
      </dl>
      {card.blocked_reason ? <p className="mt-3 flex items-start gap-2 rounded-xl bg-red-900/70 p-3 text-lg"><AlertTriangle className="mt-1 h-5 w-5 shrink-0" />{card.blocked_reason}</p> : null}
      {card.pending_reason ? <p className="mt-3 rounded-xl bg-orange-900/70 p-3 text-lg">{card.pending_reason}</p> : null}
      {card.status === "Em execucao" && since ? <p className="mt-3 text-3xl font-extrabold tabular-nums text-emerald-300">{clock((serverNow - new Date(since).getTime()) / 1000)}</p> : null}
    </button>
  )
}

function Login({ onSession, notice, online }: { onSession: (session: Session) => void; notice: string; online: boolean }) {
  const [code, setCode] = useState("")
  const [pin, setPin] = useState("")
  const [field, setField] = useState<"code" | "pin">("code")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const press = (digit: string) => { if (field === "code") setCode((value) => (value + digit).slice(0, 12)); else setPin((value) => (value + digit).slice(0, 8)) }
  const erase = () => { if (field === "code") setCode((value) => value.slice(0, -1)); else setPin((value) => value.slice(0, -1)) }
  async function enter(body: Record<string, unknown>) {
    setBusy(true); setError("")
    try {
      const data = await call<Session & { ok: boolean; message?: string }>("/api/chao-de-fabrica/sessao", null, { method: "POST", body: JSON.stringify({ device: "tablet", ...body }) })
      onSession({ token: data.token, worker: data.worker, idle_minutes: data.idle_minutes })
    } catch (failure) {
      setPin(""); setError(failure instanceof OfflineError ? "Sem conexão com o servidor." : failure instanceof Error ? failure.message : "Não foi possível entrar.")
    } finally { setBusy(false) }
  }
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-950 p-6 text-white">
      <h1 className="text-4xl font-extrabold">ND Carretas · Chão de fábrica</h1>
      <p className="text-xl text-slate-300">Identifique-se com sua matrícula e seu PIN pessoal</p>
      {notice ? <p className="max-w-xl rounded-2xl bg-amber-900/60 p-4 text-center text-lg">{notice}</p> : null}
      {!online ? <p className="flex items-center gap-2 rounded-xl bg-red-700 px-4 py-2 text-lg font-bold"><WifiOff className="h-5 w-5" />Sem conexão</p> : null}
      <div className="grid w-full max-w-xl gap-3">
        <label className={`rounded-2xl border-4 p-4 text-left ${field === "code" ? "border-sky-400 bg-slate-900" : "border-slate-700 bg-slate-900"}`}>
          <span className="block text-base text-slate-400">Matrícula</span>
          <input value={code} onFocus={() => setField("code")} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12))} autoCapitalize="characters" autoComplete="off" aria-label="Matrícula" placeholder="digite" className="w-full bg-transparent text-3xl outline-none placeholder:text-slate-600" />
        </label>
        <button type="button" onClick={() => setField("pin")} aria-label="PIN" className={`rounded-2xl border-4 p-4 text-left text-3xl tracking-[0.5em] ${field === "pin" ? "border-sky-400 bg-slate-900" : "border-slate-700 bg-slate-900"}`}><span className="block text-base tracking-normal text-slate-400">PIN</span>{pin ? "•".repeat(pin.length) : <span className="tracking-normal text-slate-600">use o teclado abaixo</span>}</button>
      </div>
      {error ? <p className="max-w-xl rounded-2xl bg-red-900/70 p-3 text-center text-xl" role="alert">{error}</p> : null}
      <div className="grid w-full max-w-xl grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => <Big key={digit} tone="bg-slate-700" onClick={() => press(digit)} className="min-h-20 text-3xl">{digit}</Big>)}
        <Big tone="bg-slate-700" onClick={() => { setCode(""); setPin(""); setField("code") }} className="min-h-20 text-lg">Limpar</Big>
        <Big tone="bg-slate-700" onClick={() => press("0")} className="min-h-20 text-3xl">0</Big>
        <Big tone="bg-slate-700" onClick={erase} className="min-h-20"><Delete className="h-8 w-8" /></Big>
      </div>
      <Big tone="bg-emerald-600" disabled={busy || !code || pin.length < 4} onClick={() => void enter({ code, pin })} className="w-full max-w-xl min-h-20 text-2xl">{busy ? <Loader2 className="h-7 w-7 animate-spin" /> : null}ENTRAR</Big>
      <button type="button" className="text-lg text-slate-400 underline" onClick={() => void enter({ action: "login_erp" })}>Tenho login próprio no ERP</button>
    </div>
  )
}

type Panel = null | "materiais" | "desenho" | "checklist" | "medidas" | "pausa" | "finalizar" | "ocorrencia"

function TaskScreen({ id, session, serverOffset, onClose, onExpired }: { id: string; session: Session; serverOffset: number; onClose: () => void; onExpired: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [panel, setPanel] = useState<Panel>(null)
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState<null | { action: string; body: Record<string, unknown> }>(null)   // operação que não chegou ao servidor: reenviada com a MESMA chave
  const [now, setNow] = useState(Date.now())
  const token = session.token
  const expired = useRef(onExpired)
  expired.current = onExpired
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])

  const load = useCallback(async () => {
    try { setDetail(await call<Detail>(`/api/chao-de-fabrica/tarefas/${id}`, token)); setError((current) => (current.startsWith("Sem conexão: a tela") ? "" : current)) } catch (failure) {
      if ((failure as { status?: number }).status === 401) { expired.current(); return }
      if (failure instanceof OfflineError) setError((current) => (current.includes("PENDENTE") ? current : "Sem conexão: a tela mostra os últimos dados recebidos."))
      else setError(failure instanceof Error ? failure.message : "Erro ao carregar a tarefa.")
    }
  }, [id, token])
  useEffect(() => { void load() }, [load])

  async function send(action: string, body: Record<string, unknown>, after?: (result: any) => void) {
    const payload = { action, taskId: id, requestKey: newKey(), clientAt: new Date().toISOString(), ...body }
    await run(payload, after)
  }
  async function run(payload: Record<string, unknown>, after?: (result: any) => void) {
    setBusy(String(payload.action)); setError("")
    try {
      const data = await call<{ result: any }>("/api/chao-de-fabrica/tarefas", token, { method: "POST", body: JSON.stringify(payload) })
      setPending(null)
      after?.(data.result)
      await load()
    } catch (failure) {
      if (failure instanceof OfflineError) { setPending({ action: String(payload.action), body: payload }); setError("Sem conexão: esta operação está PENDENTE de sincronização. Toque em “Tentar novamente” quando a conexão voltar.") }
      else if ((failure as { status?: number }).status === 401) expired.current()
      else setError(failure instanceof Error ? failure.message : "Operação não concluída.")
    } finally { setBusy("") }
  }

  if (!detail) return <Overlay title="Tarefa" onClose={onClose}>{error ? <p className="rounded-2xl bg-red-900/70 p-4 text-xl">{error}</p> : <p className="flex items-center gap-3 text-xl"><Loader2 className="h-6 w-6 animate-spin" />Carregando...</p>}</Overlay>
  const t = detail.task
  const serverNow = now + serverOffset
  const mineOpen = t.mine_open
  const since = t.working.find((w) => w.name === session.worker.name)?.since
  const canStart = ["Pronta", "Pausada"].includes(t.status) || (t.status === "Em execucao" && detail.step.allow_multiple && !mineOpen)
  const working = t.status === "Em execucao" || t.status === "Pausada"
  const missingChecklist = detail.checklist.filter((item) => item.mandatory && !item.result).length
  const measuresDone = detail.measures.length > 0

  return (
    <Overlay title={t.step} onClose={onClose}>
      <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-4">
          <div className="rounded-3xl bg-slate-900 p-5">
            <p className="text-3xl font-extrabold">{t.product}{t.model ? ` · ${t.model}` : ""}</p>
            <p className="mt-1 text-xl text-slate-300">Ordem {t.order_code} · unidade {t.unit_number} de {Math.ceil(t.quantity)}</p>
            <p className="mt-1 text-xl">Chassi <span className="font-mono font-bold">{t.vin || "a informar"}</span></p>
            <p className="mt-1 text-lg text-slate-400">Prazo {dateBr(t.planned_end)} · responsável {t.assigned || "equipe"}</p>
            <span className={`mt-3 inline-block rounded-xl px-4 py-1 text-xl font-bold ${statusTone[t.status] || "bg-slate-600"}`}>{statusLabel[t.status] || t.status}</span>
            {t.status === "Em execucao" && since ? <p className="mt-3 text-6xl font-extrabold tabular-nums text-emerald-300">{clock((serverNow - new Date(since).getTime()) / 1000)}</p> : null}
            {t.working.length ? <p className="mt-2 text-lg text-slate-300">Trabalhando agora: {t.working.map((w) => w.name).join(", ")}</p> : null}
            {t.blocked_reason ? <p className="mt-3 rounded-xl bg-red-900/70 p-3 text-lg">{t.blocked_reason}</p> : null}
            {t.pending_reason ? <p className="mt-3 rounded-xl bg-orange-900/70 p-3 text-lg">{t.pending_reason}</p> : null}
          </div>
          {error ? <p className="rounded-2xl bg-red-900/70 p-4 text-xl" role="alert">{error}</p> : null}
          {pending ? <Big tone="bg-red-700" disabled={Boolean(busy)} onClick={() => void run(pending.body)} className="w-full">Tentar novamente (operação pendente)</Big> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            {canStart ? <Big tone="bg-emerald-600" disabled={Boolean(busy)} onClick={() => void send("start", {})} className="min-h-24 text-2xl sm:col-span-2">{busy === "start" ? <Loader2 className="h-8 w-8 animate-spin" /> : <Play className="h-8 w-8" />}INICIAR TAREFA</Big> : null}
            {mineOpen ? <>
              <Big tone="bg-amber-600" disabled={Boolean(busy)} onClick={() => setPanel("pausa")} className="min-h-24 text-2xl"><Pause className="h-8 w-8" />PAUSAR TAREFA</Big>
              <Big tone="bg-sky-600" disabled={Boolean(busy)} onClick={() => setPanel("finalizar")} className="min-h-24 text-2xl"><CheckCircle2 className="h-8 w-8" />FINALIZAR TAREFA</Big>
            </> : null}
            {!mineOpen && working && !canStart ? <p className="rounded-2xl bg-slate-800 p-4 text-lg sm:col-span-2">Esta tarefa está em execução por outro colaborador.</p> : null}
            <Big tone="bg-slate-700" onClick={() => setPanel("materiais")}><Package className="h-7 w-7" />VER MATERIAIS</Big>
            <Big tone="bg-slate-700" onClick={() => setPanel("desenho")}><FileImage className="h-7 w-7" />VER DESENHO</Big>
            {detail.step.requires_checklist ? <Big tone={missingChecklist ? "bg-orange-700" : "bg-slate-700"} onClick={() => setPanel("checklist")}><ClipboardCheck className="h-7 w-7" />CHECKLIST{missingChecklist ? ` (${missingChecklist} faltam)` : ""}</Big> : null}
            {detail.step.requires_measures ? <Big tone={measuresDone ? "bg-slate-700" : "bg-orange-700"} onClick={() => setPanel("medidas")}><Ruler className="h-7 w-7" />CONFERIR MEDIDAS</Big> : null}
            <Big tone="bg-slate-800" onClick={() => setPanel("ocorrencia")}><AlertTriangle className="h-7 w-7" />REGISTRAR OCORRÊNCIA</Big>
          </div>
        </div>
        <div className="space-y-4">
          {detail.occurrences.length ? <div className="rounded-3xl bg-slate-900 p-5 text-lg"><p className="text-xl font-bold">Ocorrências</p>{detail.occurrences.map((o) => <p key={o.id} className="mt-2"><span className={o.status === "Aberta" ? "text-orange-300" : "text-slate-400"}>{o.status === "Aberta" ? "Aberta" : `Resolvida (${o.decision})`}:</span> {o.description}</p>)}</div> : null}
        </div>
      </div>

      {panel === "pausa" ? <PausePanel busy={Boolean(busy)} onCancel={() => setPanel(null)} onConfirm={(reason, note) => void send("pause", { reason, note }, () => setPanel(null))} /> : null}
      {panel === "finalizar" ? <FinishPanel busy={Boolean(busy)} onCancel={() => setPanel(null)} onConfirm={(form) => void send("finish", form, () => { setPanel(null) })} /> : null}
      {panel === "materiais" ? <MaterialsPanel detail={detail} canConsume={t.status === "Em execucao" || t.status === "Pausada"} busy={Boolean(busy)} onClose={() => setPanel(null)} onConsume={(materialId, quantity, kind) => send("consume", { materialId, quantity, kind })} /> : null}
      {panel === "desenho" ? <DrawingPanel detail={detail} onClose={() => setPanel(null)} /> : null}
      {panel === "checklist" ? <ChecklistPanel detail={detail} busy={Boolean(busy)} onClose={() => setPanel(null)} onCheck={(itemId, result, note, photos) => send("check", { itemId, result, note, photos })} /> : null}
      {panel === "medidas" ? <MeasuresPanel detail={detail} busy={Boolean(busy)} onClose={() => setPanel(null)} onSave={(measures) => send("measure", { measures }, () => setPanel(null))} /> : null}
      {panel === "ocorrencia" ? <OccurrencePanel busy={Boolean(busy)} onCancel={() => setPanel(null)} onSave={(description, photos) => send("occurrence", { kind: "ocorrencia", description, photos }, () => setPanel(null))} /> : null}
    </Overlay>
  )
}

function Overlay({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-30 overflow-y-auto bg-slate-950 text-white">
      <div className="sticky top-0 z-10 flex items-center gap-4 border-b border-slate-800 bg-slate-900 px-5 py-3">
        <Big tone="bg-slate-700" onClick={onClose} className="min-h-14 text-lg"><ArrowLeft className="h-6 w-6" />Voltar</Big>
        <h1 className="text-2xl font-extrabold">{title}</h1>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 p-0 md:items-center md:p-6" role="dialog" aria-label={title}>
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-3xl bg-slate-900 p-6 md:rounded-3xl">
        <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-3xl font-extrabold">{title}</h2><Big tone="bg-slate-700" onClick={onClose} className="min-h-14 px-5 text-lg">Fechar</Big></div>
        {children}
      </div>
    </div>
  )
}

function PausePanel({ busy, onCancel, onConfirm }: { busy: boolean; onCancel: () => void; onConfirm: (reason: string, note: string) => void }) {
  const [reason, setReason] = useState("")
  const [note, setNote] = useState("")
  return (
    <Sheet title="Por que você vai pausar?" onClose={onCancel}>
      <div className="grid gap-3 sm:grid-cols-2">{PAUSE_REASONS.map((item) => <Big key={item} tone={reason === item ? "bg-amber-600" : "bg-slate-700"} onClick={() => setReason(item)}>{item}</Big>)}</div>
      {reason === "Outro motivo" ? <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} placeholder="Descreva o motivo" className="mt-4 w-full rounded-2xl bg-slate-800 p-4 text-xl" /> : null}
      <Big tone="bg-amber-600" disabled={busy || !reason || (reason === "Outro motivo" && note.trim().length < 3)} onClick={() => onConfirm(reason, note)} className="mt-5 w-full min-h-20 text-2xl">{busy ? <Loader2 className="h-7 w-7 animate-spin" /> : <Pause className="h-7 w-7" />}CONFIRMAR PAUSA</Big>
    </Sheet>
  )
}

async function uploadPhoto(file: File): Promise<string> {
  const body = new FormData()
  body.append("file", file)
  const data = await call<{ path: string }>("/api/chao-de-fabrica/foto", null, { method: "POST", body })
  return data.path
}
function PhotoButton({ photos, onChange }: { photos: string[]; onChange: (photos: string[]) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function add(files: FileList | null) {
    if (!files?.length) return
    setBusy(true); setError("")
    try { const paths: string[] = []; for (const file of Array.from(files)) paths.push(await uploadPhoto(file)); onChange([...photos, ...paths]) } catch (failure) { setError(failure instanceof Error ? failure.message : "Foto não enviada.") } finally { setBusy(false) }
  }
  return (
    <div className="space-y-2">
      <label className="flex min-h-16 cursor-pointer items-center justify-center gap-3 rounded-2xl bg-slate-700 px-6 text-xl font-bold">
        {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <Camera className="h-6 w-6" />}Tirar / anexar foto{photos.length ? ` (${photos.length})` : ""}
        <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(event) => void add(event.target.files)} />
      </label>
      {error ? <p className="text-lg text-red-300">{error}</p> : null}
    </div>
  )
}

function FinishPanel({ busy, onCancel, onConfirm }: { busy: boolean; onCancel: () => void; onConfirm: (form: Record<string, unknown>) => void }) {
  const [notes, setNotes] = useState("")
  return (
    <Sheet title="Você concluiu esta tarefa?" onClose={onCancel}>
      <div className="space-y-4">
        <label className="block text-xl">Observações (opcional)
          <textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-2 w-full rounded-2xl bg-slate-800 p-4 text-xl" />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Big tone="bg-slate-700" onClick={onCancel}>NÃO, VOLTAR</Big>
          <Big tone="bg-emerald-600" disabled={busy} onClick={() => onConfirm({ quantityDone: 1, notes })}>{busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <CheckCircle2 className="h-6 w-6" />}SIM, CONCLUÍ</Big>
        </div>
      </div>
    </Sheet>
  )
}

function MaterialsPanel({ detail, canConsume, busy, onClose, onConsume }: { detail: Detail; canConsume: boolean; busy: boolean; onClose: () => void; onConsume: (materialId: string, quantity: number, kind: string) => void }) {
  const [target, setTarget] = useState<Detail["materials"][number] | null>(null)
  const [value, setValue] = useState("")
  const [kind, setKind] = useState("Consumo")
  const kits = useMemo(() => Array.from(new Set(detail.materials.map((m) => `${m.kit}${m.kit_version ? ` (v${m.kit_version})` : ""}`))), [detail.materials])
  return (
    <Sheet title="Kits e matérias-primas desta tarefa" onClose={onClose}>
      <p className="mb-3 text-lg text-slate-300">{kits.length ? `Kit: ${kits.join(" · ")}` : "Nenhum material vinculado a esta etapa."} Quantidades por unidade, da composição congelada da ordem.</p>
      <div className="space-y-3">
        {detail.materials.map((m) => (
          <div key={m.material_id} className="rounded-2xl bg-slate-800 p-4 text-lg">
            <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xl font-bold">{m.name}</p><p className="font-mono text-base text-slate-400">{m.sku}</p>{m.description ? <p className="text-base text-slate-400">{m.description}</p> : null}</div>
              {canConsume ? <Big tone="bg-sky-700" disabled={busy} onClick={() => { setTarget(m); setValue(String(Math.max(m.planned - m.consumed_by_task, 0) || "")); setKind("Consumo") }} className="min-h-14 px-4 text-lg">Apontar consumo</Big> : null}</div>
            <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4"><div><dt className="text-slate-500">Previsto</dt><dd className="font-bold">{qty(m.planned)} {m.unit}</dd></div><div><dt className="text-slate-500">Reservado</dt><dd className="font-bold">{qty(m.reserved)}</dd></div><div><dt className="text-slate-500">Disponível</dt><dd className="font-bold">{qty(m.available)}</dd></div><div><dt className="text-slate-500">Já consumido</dt><dd className="font-bold">{qty(m.consumed_by_task)}</dd></div></dl>
          </div>
        ))}
      </div>
      {target ? (
        <Sheet title={`Consumo: ${target.name}`} onClose={() => setTarget(null)}>
          <input inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value.replace(",", "."))} className="w-full rounded-2xl bg-slate-800 p-4 text-4xl" />
          <p className="mt-2 text-lg text-slate-300">Unidade: {target.unit}. Material baixado do estoque agora, por esta operação (não ao finalizar a tarefa).</p>
          <div className="mt-4 grid grid-cols-3 gap-3">{["Consumo", "Perda", "Retrabalho"].map((item) => <Big key={item} tone={kind === item ? "bg-sky-700" : "bg-slate-700"} onClick={() => setKind(item)} className="min-h-14 text-lg">{item}</Big>)}</div>
          <Big tone="bg-emerald-600" disabled={busy || !(Number(value) > 0)} onClick={() => { onConsume(target.material_id, Number(value), kind); setTarget(null) }} className="mt-5 w-full min-h-20 text-2xl">CONFIRMAR CONSUMO</Big>
        </Sheet>
      ) : null}
    </Sheet>
  )
}

function DrawingPanel({ detail, onClose }: { detail: Detail; onClose: () => void }) {
  const [zoom, setZoom] = useState(1)
  const cfg = detail.drawing.configuration
  const t = detail.task
  const grade = cfg?.drawing_spec?.grade === "validado" && cfg.homologated ? "validado" : "ilustrativo"
  const dims: Array<[string, string]> = cfg ? [["Comprimento", "comprimento"], ["Largura", "largura"], ["Altura", "altura"]].filter(([, key]) => cfg.params[key]).map(([label, key]) => [label, `${Number(cfg.params[key]).toLocaleString("pt-BR")} mm`]) : []
  return (
    <Sheet title="Desenho da carreta vendida" onClose={onClose}>
      <p className="text-xl font-bold">{detail.drawing.product?.name}{detail.drawing.product?.model ? ` · ${detail.drawing.product.model}` : ""}</p>
      <p className="text-lg text-slate-300">Ordem {t.order_code} · unidade {t.unit_number} · chassi {t.vin || "a informar"}</p>
      {cfg ? (
        <>
          <p className="mt-2 text-lg">{cfg.summary}</p>
          <div className="mt-3 grid grid-cols-3 gap-3">{dims.map(([label, value]) => <div key={label} className="rounded-2xl bg-slate-800 p-3"><p className="text-slate-400">{label}</p><p className="text-2xl font-extrabold">{value}</p></div>)}</div>
          <p className="mt-3 text-lg">Revisão de engenharia: <b>{cfg.revision || "sem revisão validada"}</b> · {grade === "validado" ? "desenho validado" : <span className="font-bold text-amber-300">DESENHO ILUSTRATIVO — não é desenho de fabricação; use os documentos técnicos aprovados</span>}</p>
          <div className="mt-3 flex gap-3"><Big tone="bg-slate-700" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} className="min-h-14"><ZoomOut className="h-6 w-6" /></Big><Big tone="bg-slate-700" onClick={() => setZoom((z) => Math.min(4, z + 0.5))} className="min-h-14"><ZoomIn className="h-6 w-6" /></Big><span className="self-center text-lg">{Math.round(zoom * 100)}%</span></div>
          <div className="mt-3 overflow-auto rounded-2xl bg-white" style={{ touchAction: "pan-x pan-y pinch-zoom", maxHeight: "60vh" }}>
            <div style={{ width: `${zoom * 100}%`, minWidth: "100%" }}>
              <TrailerDrawingView product={detail.drawing.product?.name || t.product} params={cfg.params} grade={grade} revision={cfg.revision} geometry={cfg.drawing_spec?.geometry} finish={cfg.options?.selected?.find((o) => o.group === "acabamento")?.label} accessories={(cfg.options?.selected || []).filter((o) => o.group === "acessorio").map((o) => o.label)} />
            </div>
          </div>
        </>
      ) : <p className="mt-4 rounded-2xl bg-slate-800 p-4 text-lg">Esta ordem é de produto padrão (sem personalização): fabrique conforme a estrutura{detail.drawing.bom_notes ? `. Instruções: ${detail.drawing.bom_notes}` : "."}</p>}
      {cfg && detail.drawing.bom_notes ? <p className="mt-3 rounded-2xl bg-slate-800 p-4 text-lg">Instruções técnicas: {detail.drawing.bom_notes}</p> : null}
    </Sheet>
  )
}

function ChecklistPanel({ detail, busy, onClose, onCheck }: { detail: Detail; busy: boolean; onClose: () => void; onCheck: (itemId: string, result: string, note: string, photos: string[]) => void }) {
  const [ncItem, setNcItem] = useState<Detail["checklist"][number] | null>(null)
  const [note, setNote] = useState("")
  const [photos, setPhotos] = useState<string[]>([])
  return (
    <Sheet title="Checklist" onClose={onClose}>
      {detail.checklist.length === 0 ? <p className="rounded-2xl bg-orange-900/70 p-4 text-xl">O checklist desta etapa ainda não foi configurado. Avise o gestor.</p> : null}
      <div className="space-y-3">
        {detail.checklist.map((item) => (
          <div key={item.item_id} className="rounded-2xl bg-slate-800 p-4">
            <p className="text-xl font-bold">{item.label}{item.mandatory ? <span className="ml-2 text-base font-normal text-amber-300">obrigatório</span> : null}</p>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <Big tone={item.result === "conforme" ? "bg-emerald-600" : "bg-slate-700"} disabled={busy} onClick={() => onCheck(item.item_id, "conforme", "", [])} className="min-h-16 text-lg">CONFORME</Big>
              <Big tone={item.result === "nao_conforme" ? "bg-red-700" : "bg-slate-700"} disabled={busy} onClick={() => { setNcItem(item); setNote(""); setPhotos([]) }} className="min-h-16 text-lg">NÃO CONFORME</Big>
              {item.allow_na ? <Big tone={item.result === "na" ? "bg-sky-700" : "bg-slate-700"} disabled={busy} onClick={() => onCheck(item.item_id, "na", "", [])} className="min-h-16 text-lg">NÃO SE APLICA</Big> : <span />}
            </div>
            {item.result === "nao_conforme" && item.note ? <p className="mt-2 text-lg text-red-300">{item.note}</p> : null}
          </div>
        ))}
      </div>
      {ncItem ? (
        <Sheet title="O que está errado?" onClose={() => setNcItem(null)}>
          <p className="mb-3 text-xl">{ncItem.label}</p>
          <textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Descreva a não conformidade" className="w-full rounded-2xl bg-slate-800 p-4 text-xl" />
          <div className="mt-3"><PhotoButton photos={photos} onChange={setPhotos} /></div>
          <Big tone="bg-red-700" disabled={busy || note.trim().length < 3} onClick={() => { onCheck(ncItem.item_id, "nao_conforme", note, photos); setNcItem(null) }} className="mt-4 w-full min-h-20 text-2xl">REGISTRAR NÃO CONFORMIDADE</Big>
        </Sheet>
      ) : null}
    </Sheet>
  )
}

function MeasuresPanel({ detail, busy, onClose, onSave }: { detail: Detail; busy: boolean; onClose: () => void; onSave: (measures: Array<{ param: string; measured: number }>) => void }) {
  const cfg = detail.drawing.configuration
  const keys = ["comprimento", "largura", "altura"].filter((key) => cfg?.params[key])
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(detail.measures.map((m) => [m.param, String(m.measured)])))
  return (
    <Sheet title="Conferência das medidas" onClose={onClose}>
      {!cfg ? <p className="rounded-2xl bg-orange-900/70 p-4 text-xl">A ordem não tem configuração dimensional congelada para conferir. Avise o gestor.</p> : <p className="mb-3 text-lg text-slate-300">Compare com as medidas VENDIDAS e digite o que você mediu na carreta.</p>}
      <div className="space-y-3">
        {keys.map((key) => (
          <div key={key} className="rounded-2xl bg-slate-800 p-4">
            <p className="text-xl font-bold capitalize">{key} — vendido: {Number(cfg!.params[key]).toLocaleString("pt-BR")} mm</p>
            <input inputMode="decimal" value={values[key] || ""} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value.replace(",", ".") }))} placeholder="medido (mm)" className="mt-2 w-full rounded-2xl bg-slate-700 p-4 text-3xl" />
            {detail.measures.find((m) => m.param === key)?.divergent ? <p className="mt-2 text-lg font-bold text-orange-300">Divergente da medida vendida: encaminhado para análise.</p> : null}
          </div>
        ))}
      </div>
      <Big tone="bg-emerald-600" disabled={busy || !keys.length || keys.some((key) => !(Number(values[key]) > 0))} onClick={() => onSave(keys.map((key) => ({ param: key, measured: Number(values[key]) })))} className="mt-5 w-full min-h-20 text-2xl">REGISTRAR MEDIDAS</Big>
    </Sheet>
  )
}

function OccurrencePanel({ busy, onCancel, onSave }: { busy: boolean; onCancel: () => void; onSave: (description: string, photos: string[]) => void }) {
  const [description, setDescription] = useState("")
  const [photos, setPhotos] = useState<string[]>([])
  return (
    <Sheet title="Registrar ocorrência" onClose={onCancel}>
      <textarea rows={4} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="O que aconteceu?" className="w-full rounded-2xl bg-slate-800 p-4 text-xl" />
      <div className="mt-3"><PhotoButton photos={photos} onChange={setPhotos} /></div>
      <Big tone="bg-orange-700" disabled={busy || description.trim().length < 3} onClick={() => onSave(description, photos)} className="mt-4 w-full min-h-20 text-2xl">ENVIAR OCORRÊNCIA</Big>
    </Sheet>
  )
}
