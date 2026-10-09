"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Activity, AlertTriangle, CheckCircle2, MailWarning, RefreshCw, Send } from "lucide-react"
import { PageLayout } from "@/components/page-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/lib/auth-context"
import { useToast } from "@/hooks/use-toast"

type SystemLog = {
  id: string
  fingerprint: string
  source: string
  message: string
  severity: "warning" | "error" | "critical"
  statusCode: number | null
  path: string
  method: string
  actorEmail: string
  emailStatus: "sent" | "failed" | "suppressed" | "not_configured"
  emailRecipients: string[]
  emailError: string
  occurredAt: string
}

const deliveryLabel = { sent: "Enviado", failed: "Falhou", suppressed: "Agrupado", not_configured: "Pendente" }

export default function SystemLogsPage() {
  const { user, isLoading } = useAuth()
  const { toast } = useToast()
  const [logs, setLogs] = useState<SystemLog[]>([])
  const [email, setEmail] = useState({ providerConfigured: false, explicitRecipient: false, senderConfigured: false })
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState(false)
  const [query, setQuery] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch("/api/system-logs", { cache: "no-store" })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || "Falha ao carregar logs.")
      setLogs(payload.logs || [])
      setEmail(payload.email || {})
    } catch (error) {
      toast({ title: "Erro ao carregar logs", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { if (user?.role === "admin") void load() }, [user?.role, load])

  const testAlert = async () => {
    setTesting(true)
    try {
      const response = await fetch("/api/system-logs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ test: true }) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || "Falha no teste.")
      const status = payload.log?.emailStatus
      toast({ title: status === "sent" ? "E-mail de teste enviado" : "Teste registrado", description: status === "sent" ? "A entrega foi aceita pelo provedor." : payload.log?.emailError || "O alerta ficou salvo no historico." })
      await load()
    } catch (error) {
      toast({ title: "Falha ao testar alerta", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" })
    } finally {
      setTesting(false)
    }
  }

  const filtered = useMemo(() => logs.filter((log) => [log.source, log.message, log.path, log.actorEmail, log.fingerprint].join(" ").toLowerCase().includes(query.toLowerCase())), [logs, query])
  const lastDay = logs.filter((log) => Date.now() - new Date(log.occurredAt).getTime() <= 86_400_000).length
  if (!isLoading && user?.role !== "admin") return <PageLayout><div className="py-16 text-center"><AlertTriangle className="mx-auto mb-3 h-8 w-8 text-destructive" /><h1 className="text-xl font-semibold">Acesso restrito</h1></div></PageLayout>

  return (
    <PageLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div><h1 className="text-2xl font-bold md:text-3xl">Logs do Sistema</h1><p className="mt-1 text-sm text-muted-foreground">Falhas tecnicas, rotas afetadas e situacao dos alertas.</p></div>
          <div className="flex gap-2"><Button variant="outline" size="icon" title="Atualizar logs" onClick={load} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></Button><Button onClick={testAlert} disabled={testing}><Send className="h-4 w-4" />{testing ? "Testando..." : "Testar alerta"}</Button></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Ultimas 24 horas</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{lastDay}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Falhas criticas</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{logs.filter((log) => log.severity === "critical").length}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">E-mails enviados</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{logs.filter((log) => log.emailStatus === "sent").length}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Monitor de e-mail</CardTitle></CardHeader><CardContent className="flex items-center gap-2 text-sm font-semibold">{email.providerConfigured ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <MailWarning className="h-5 w-5 text-amber-600" />}{email.providerConfigured ? "Configurado" : "Pendente"}</CardContent></Card>
        </div>
        <div className="flex items-center gap-3"><Activity className="h-5 w-5 text-muted-foreground" /><Input className="max-w-xl" placeholder="Filtrar por erro, origem, rota ou usuario" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        <div className="overflow-hidden rounded-md border bg-background">
          <div className="max-h-[35rem] overflow-auto overscroll-contain [scrollbar-gutter:stable]"><Table><TableHeader className="sticky top-0 z-20 bg-background"><TableRow><TableHead>Data/hora</TableHead><TableHead>Origem</TableHead><TableHead>Falha</TableHead><TableHead>Rota</TableHead><TableHead>Usuario</TableHead><TableHead>E-mail</TableHead></TableRow></TableHeader><TableBody>
            {!loading && !filtered.length ? <TableRow><TableCell colSpan={6} className="h-28 text-center text-muted-foreground">Nenhuma falha encontrada.</TableCell></TableRow> : filtered.map((log) => <TableRow key={log.id}><TableCell className="whitespace-nowrap">{new Date(log.occurredAt).toLocaleString("pt-BR")}</TableCell><TableCell><div className="flex items-center gap-2"><Badge variant={log.severity === "critical" ? "destructive" : "secondary"}>{log.severity}</Badge><span className="whitespace-nowrap">{log.source}</span></div></TableCell><TableCell className="max-w-md"><p className="line-clamp-2" title={log.message}>{log.message}</p><p className="mt-1 font-mono text-xs text-muted-foreground">{log.fingerprint}</p></TableCell><TableCell className="font-mono text-xs">{log.statusCode ? `${log.statusCode} ` : ""}{log.method} {log.path || "-"}</TableCell><TableCell>{log.actorEmail || "-"}</TableCell><TableCell><Badge variant={log.emailStatus === "failed" ? "destructive" : "outline"} title={log.emailError}>{deliveryLabel[log.emailStatus]}</Badge></TableCell></TableRow>)}
          </TableBody></Table></div>
        </div>
      </div>
    </PageLayout>
  )
}
