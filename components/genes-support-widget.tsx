"use client"

import { useEffect, useMemo, useState } from "react"
import { CheckCircle2, Crosshair, Loader2, Send, X } from "lucide-react"
import { usePathname } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

type SelectedComponent = {
  code: string
  type: string
  label: string
  selector: string
}

type TicketResult = {
  taskId: string
  osNumber: string
}

function normalizeCode(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase()
    .slice(0, 28) || "INICIO"
}

function shortHash(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(6, "0").slice(0, 6)
}

function componentType(element: HTMLElement) {
  const tag = element.tagName.toLowerCase()
  const role = element.getAttribute("role") || ""
  if (tag === "button" || role === "button") return "BOTAO"
  if (tag === "input") return "CAMPO"
  if (tag === "textarea") return "TEXTO"
  if (tag === "select" || role === "combobox") return "SELECT"
  if (tag === "a") return "LINK"
  if (tag === "table" || element.closest("table")) return "TABELA"
  if (element.getAttribute("data-slot")?.includes("card") || /card/i.test(element.className)) return "CARD"
  if (/^h[1-6]$/.test(tag)) return "TITULO"
  if (tag === "img") return "IMAGEM"
  return "COMPONENTE"
}

function componentLabel(element: HTMLElement) {
  const value = element.getAttribute("aria-label")
    || element.getAttribute("title")
    || element.getAttribute("placeholder")
    || element.getAttribute("alt")
    || element.innerText
    || element.textContent
    || element.tagName
  return value.replace(/\s+/g, " ").trim().slice(0, 180)
}

function componentSelector(element: HTMLElement) {
  const explicitCode = element.closest<HTMLElement>("[data-component-code]")?.dataset.componentCode
  if (explicitCode) return `[data-component-code="${explicitCode}"]`
  const parts: string[] = []
  let current: HTMLElement | null = element
  while (current && current !== document.body && parts.length < 5) {
    let part = current.tagName.toLowerCase()
    if (current.id) {
      part += `#${current.id}`
      parts.unshift(part)
      break
    }
    const name = current.getAttribute("name")
    const slot = current.getAttribute("data-slot")
    if (name) part += `[name="${name}"]`
    else if (slot) part += `[data-slot="${slot}"]`
    else if (current.parentElement) {
      const siblings = Array.from(current.parentElement.children).filter((item) => item.tagName === current?.tagName)
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`
    }
    parts.unshift(part)
    current = current.parentElement
  }
  return parts.join(" > ")
}

function selectedComponent(element: HTMLElement, pathname: string): SelectedComponent {
  const type = componentType(element)
  const label = componentLabel(element)
  const selector = componentSelector(element)
  const page = normalizeCode(pathname.split("/").filter(Boolean).join("-") || "INICIO")
  const explicitCode = element.closest<HTMLElement>("[data-component-code]")?.dataset.componentCode
  return {
    code: explicitCode || `PAG-${page}-${type}-${shortHash(`${pathname}|${type}|${selector}|${label}`)}`,
    type,
    label,
    selector,
  }
}

export function GenesSupportWidget() {
  const { user } = useAuth()
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [hoveredRect, setHoveredRect] = useState<DOMRect | null>(null)
  const [hoveredType, setHoveredType] = useState("")
  const [selected, setSelected] = useState<SelectedComponent | null>(null)
  const [description, setDescription] = useState("")
  const [costAcknowledged, setCostAcknowledged] = useState(true)
  const [inDevelopment, setInDevelopment] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<TicketResult | null>(null)

  const hidden = !user || pathname === "/login" || pathname.startsWith("/campo/atendimento/") || pathname.startsWith("/campo/checklist/")
  const pageTitle = useMemo(() => typeof document !== "undefined" ? document.querySelector("h1")?.textContent?.trim() || document.title || pathname : pathname, [pathname, selected])

  useEffect(() => {
    if (!selecting) return
    const previousCursor = document.body.style.cursor
    document.body.style.cursor = "crosshair"

    function validTarget(target: EventTarget | null) {
      const element = target instanceof HTMLElement ? target : null
      return element && !element.closest("[data-genes-support]") ? element : null
    }

    function handlePointerMove(event: PointerEvent) {
      const element = validTarget(event.target)
      if (!element) return
      setHoveredRect(element.getBoundingClientRect())
      setHoveredType(componentType(element))
    }

    function handleClick(event: MouseEvent) {
      const element = validTarget(event.target)
      if (!element) return
      event.preventDefault()
      event.stopPropagation()
      setSelected(selectedComponent(element, pathname))
      setSelecting(false)
      setHoveredRect(null)
      setError("")
      setResult(null)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelecting(false)
        setHoveredRect(null)
      }
    }

    document.addEventListener("pointermove", handlePointerMove, true)
    document.addEventListener("click", handleClick, true)
    document.addEventListener("keydown", handleKeyDown, true)
    return () => {
      document.body.style.cursor = previousCursor
      document.removeEventListener("pointermove", handlePointerMove, true)
      document.removeEventListener("click", handleClick, true)
      document.removeEventListener("keydown", handleKeyDown, true)
    }
  }, [pathname, selecting])

  async function submitTicket() {
    if (!selected || !description.trim() || !costAcknowledged || sending) return
    setSending(true)
    setError("")
    try {
      const response = await fetch("/api/genes/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          componentCode: selected.code,
          description: description.trim(),
          costAcknowledged,
          inDevelopment,
          context: {
            pathname,
            pageTitle,
            componentType: selected.type,
            componentLabel: selected.label,
            componentSelector: selected.selector,
            url: window.location.href,
          },
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || "Não foi possível abrir o chamado.")
      setResult({ taskId: payload.task_id || "", osNumber: payload.os_number || "" })
    } catch (ticketError) {
      setError(ticketError instanceof Error ? ticketError.message : "Erro ao abrir chamado.")
    } finally {
      setSending(false)
    }
  }

  function reset() {
    setSelected(null)
    setDescription("")
    setCostAcknowledged(true)
    setInDevelopment(false)
    setError("")
    setResult(null)
  }

  if (hidden) return null

  return (
    <>
      {selecting ? (
        <div data-genes-support className="pointer-events-none fixed inset-0 z-[90]">
          <div className="absolute left-1/2 top-20 -translate-x-1/2 rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white shadow-lg">
            Clique no componente do chamado. Pressione Esc para cancelar.
          </div>
          {hoveredRect ? <div className="absolute border-2 border-orange-500 bg-orange-400/10" style={{ left: hoveredRect.left, top: hoveredRect.top, width: hoveredRect.width, height: hoveredRect.height }}>
            <span className="absolute -top-7 left-0 rounded bg-orange-600 px-2 py-1 text-xs font-semibold text-white">{hoveredType}</span>
          </div> : null}
        </div>
      ) : null}

      <div data-genes-support className="pointer-events-auto fixed bottom-5 right-4 z-[80] flex flex-col items-end gap-2" style={{ pointerEvents: "auto" }}>
        {menuOpen ? (
          <div className="w-56 rounded-md border bg-background p-3 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="font-semibold">Suporte Genes</p>
                <p className="text-xs text-muted-foreground">Informe um problema ou ajuste.</p>
              </div>
              <Button size="icon" variant="ghost" className="h-8 w-8" title="Fechar" onClick={() => setMenuOpen(false)}><X className="h-4 w-4" /></Button>
            </div>
            <Button className="w-full" onClick={() => { setMenuOpen(false); setSelecting(true) }}>
              <Crosshair className="h-4 w-4" />Abrir chamado
            </Button>
          </div>
        ) : null}
        <button type="button" className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border bg-slate-950 shadow-lg transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2" title="Suporte Genes" aria-label="Abrir suporte Genes" onClick={() => setMenuOpen((current) => !current)}>
          <img src="/genes-logo.png" alt="Genes" className="h-9 w-9 object-contain" />
        </button>
      </div>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) reset() }}>
        <DialogContent data-genes-support>
          {result ? (
            <div className="space-y-4 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
              <DialogHeader>
                <DialogTitle>Chamado aberto</DialogTitle>
                <DialogDescription>{result.osNumber || "A solicitação foi recebida pela Genes."}</DialogDescription>
              </DialogHeader>
              {result.taskId ? <p className="text-xs text-muted-foreground">Tarefa: {result.taskId}</p> : null}
              <Button onClick={reset}>Concluir</Button>
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Abrir chamado</DialogTitle>
                <DialogDescription>Descreva o problema ou ajuste referente ao componente selecionado.</DialogDescription>
              </DialogHeader>
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-xs font-medium text-muted-foreground">Componente</p>
                <p className="mt-1 font-medium">{selected?.label || "Componente sem texto"}</p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">{selected?.code}</p>
                <Button className="mt-3" size="sm" variant="outline" onClick={() => { setSelected(null); setSelecting(true) }}>Trocar componente</Button>
              </div>
              <div className="space-y-2">
                <Label htmlFor="genes-ticket-description">Descrição</Label>
                <Textarea id="genes-ticket-description" autoFocus rows={5} value={description} onChange={(event) => setDescription(event.target.value)} onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault()
                    void submitTicket()
                  }
                }} placeholder="Explique o problema ou ajuste necessário..." />
                <p className="text-xs text-muted-foreground">Enter envia. Shift + Enter cria uma nova linha.</p>
              </div>
              <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
                <Checkbox checked={costAcknowledged} onCheckedChange={(checked) => setCostAcknowledged(checked === true)} />
                <span>Estou ciente de que o atendimento poderá gerar custos.</span>
              </label>
              <label className="flex items-center gap-3 text-sm">
                <Checkbox checked={inDevelopment} onCheckedChange={(checked) => setInDevelopment(checked === true)} />
                <span>Este componente ainda está em desenvolvimento.</span>
              </label>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <DialogFooter>
                <Button variant="outline" onClick={reset}>Cancelar</Button>
                <Button disabled={!description.trim() || !costAcknowledged || sending} onClick={submitTicket}>
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {sending ? "Enviando..." : "Enviar chamado"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
