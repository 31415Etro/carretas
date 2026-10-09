"use client"

import type React from "react"
import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, Save } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import {
  type AuditLog,
  type Client,
  type OperationalState,
  createAudit,
  defaultOperationalState,
  loadOperationalState,
  saveOperationalState,
  statusColor,
} from "@/lib/operational-storage"
import { PageLayout } from "@/components/page-layout"
import { useAuth } from "@/lib/auth-context"
import { type SearchableOption } from "@/lib/searchable-options"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { fetchOperationalState, primeOperationalStateCache } from "@/lib/operational-state-cache"

export type CommitFn = (updater: (current: OperationalState) => OperationalState, options?: { persist?: boolean }) => void

const operationalEndpoint = "/api/operational-state"

/** Estado dos cadastros (clientes, fornecedores, técnicos, frota...). Clientes externos não têm acesso. */
export function useOperationalStore(options?: { skipInitialLoad?: boolean }) {
  const skipInitialLoad = Boolean(options?.skipInitialLoad)
  const [state, setState] = useState<OperationalState>(() => defaultOperationalState())
  const [stateLoading, setStateLoading] = useState(!skipInitialLoad)
  const { toast } = useToast()
  const { user, isLoading } = useAuth()
  const readOnlyClient = user?.role === "client"
  const cacheKey = () => `${user?.company.id || "anon"}:${user?.id || "anon"}:${operationalEndpoint}`

  useEffect(() => {
    if (skipInitialLoad) {
      setStateLoading(false)
      return
    }
    if (isLoading || readOnlyClient) return
    setStateLoading(true)
    let active = true
    const companyId = user?.company.id
    setState(loadOperationalState(companyId))
    fetchOperationalState(operationalEndpoint, cacheKey())
      .then((loaded) => {
        if (!active) return
        setState(loaded)
        saveOperationalState(loaded, companyId)
      })
      .catch((error) => {
        if (!active) return
        toast({ title: "Erro ao carregar dados", description: error instanceof Error ? error.message : "Recarregue a página antes de salvar.", variant: "destructive" })
      })
      .finally(() => { if (active) setStateLoading(false) })
    return () => { active = false }
  }, [isLoading, readOnlyClient, user?.id, user?.company.id, skipInitialLoad])

  const commit: CommitFn = (updater, commitOptions) => {
    if (readOnlyClient) return
    setState((current) => {
      const next = updater(current)
      saveOperationalState(next, user?.company.id)
      primeOperationalStateCache(cacheKey(), next)
      if (commitOptions?.persist === false) return next
      fetch(operationalEndpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: next }),
      })
        .then(async (response) => {
          if (response.ok) return
          const payload = await response.json().catch(() => null)
          throw new Error(payload?.error || `Falha ao salvar (${response.status})`)
        })
        .catch((error) => {
          toast({ title: "Erro ao salvar no banco", description: error instanceof Error ? error.message : "Supabase indisponível", variant: "destructive" })
        })
      return next
    })
  }

  return { state, commit, loading: isLoading || stateLoading }
}

export function PageShell({ title, description, actions, children }: { title: string; description: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <PageLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{title}</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground md:text-base">{description}</p>
          </div>
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>
        {children}
      </div>
    </PageLayout>
  )
}

export function SectionCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

export function MetricCard({ title, value, note, icon: Icon, onClick }: { title: string; value: string | number; note: string; icon: React.ComponentType<{ className?: string }>; onClick?: () => void }) {
  return (
    <Card onClick={onClick} className={onClick ? "cursor-pointer transition hover:border-primary/50 hover:shadow-md" : ""}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-5 w-5 text-primary" />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  )
}

export function StatusBadge({ status }: { status: string }) {
  const tone = statusColor(status)
  const label =
    {
      Saida: "Saída",
      Saidas: "Saídas",
      "Cartao de credito": "Cartão de crédito",
      "Importacao PDF": "Importação PDF",
      "Importacao Excel": "Importação Excel",
      "Sem classificacao": "Sem classificação",
      "Sem categoria": "Sem categoria",
      Operacao: "Operação",
      Veiculos: "Veículos",
      Manutencao: "Manutenção",
      "Manutencao Carro": "Manutenção Carro",
      "Manutencao Veiculo": "Manutenção Veículo",
      Tecnico: "Técnico",
      "Nao se aplica": "Não se aplica",
      Concluida: "Concluída",
      Obrigatoria: "Obrigatória",
    }[status] || status
  const classes: Record<string, string> = {
    default: "border-primary/20 bg-primary/10 text-primary",
    success: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700",
    warning: "border-amber-500/20 bg-amber-500/10 text-amber-700",
    danger: "border-red-500/20 bg-red-500/10 text-red-700",
    muted: "border-border bg-muted text-muted-foreground",
  }
  return <Badge variant="outline" className={classes[tone]}>{label}</Badge>
}

export function DataTable({
  headers,
  children,
  empty,
  viewportClassName,
  tableClassName,
  stickyHeader = false,
}: {
  headers: string[]
  children: React.ReactNode
  empty?: boolean
  viewportClassName?: string
  tableClassName?: string
  stickyHeader?: boolean
}) {
  return (
    <Table containerClassName={viewportClassName} className={tableClassName}>
      <TableHeader className={stickyHeader ? "sticky top-0 z-20 bg-card shadow-[0_1px_0_hsl(var(--border))]" : undefined}>
        <TableRow>{headers.map((header) => <TableHead key={header}>{header}</TableHead>)}</TableRow>
      </TableHeader>
      <TableBody>
        {empty ? <TableRow><TableCell colSpan={headers.length} className="py-8 text-center text-muted-foreground">Nenhum registro encontrado.</TableCell></TableRow> : children}
      </TableBody>
    </Table>
  )
}

export function TextField({ label, value, onChange, type = "text", placeholder }: { label: string; value: string | number; onChange: (value: string) => void; type?: string; placeholder?: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder || label} />
    </div>
  )
}

export function TextAreaField({ label, value, onChange, rows = 3 }: { label: string; value: string; onChange: (value: string) => void; rows?: number }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Textarea value={value} onChange={(event) => onChange(event.target.value)} rows={rows} />
    </div>
  )
}

export function SelectField({ label, value, onChange, options, placeholder, actionLabel, onAction }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string; disabled?: boolean }>; placeholder?: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <SearchableSelect value={value} onValueChange={onChange} options={options} placeholder={placeholder || label} actionLabel={actionLabel} onAction={onAction} />
    </div>
  )
}

export function SearchableSelectField({ label, value, onChange, options, placeholder, searchPlaceholder = "Pesquisar...", emptyLabel = "Nenhuma opção encontrada." }: { label: string; value: string; onChange: (value: string) => void; options: SearchableOption[]; placeholder?: string; searchPlaceholder?: string; emptyLabel?: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <SearchableSelect
        value={value}
        onValueChange={onChange}
        options={options}
        placeholder={placeholder || label}
        searchPlaceholder={searchPlaceholder}
        emptyLabel={emptyLabel}
      />
    </div>
  )
}

export function FormSheet({ open, onOpenChange, title, description, children, footer }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : null}
        </SheetHeader>
        <div className="space-y-6 px-4 pb-4">{children}</div>
        {footer ? <SheetFooter>{footer}</SheetFooter> : null}
      </SheetContent>
    </Sheet>
  )
}

export function ConfirmInline({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false)
  if (!armed) return <Button size="sm" variant="outline" onClick={() => setArmed(true)}>{label}</Button>
  return <Button size="sm" variant="destructive" onClick={onConfirm}>Confirmar</Button>
}

export function SaveButton({ children = "Salvar", onClick, disabled = false }: { children?: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return <Button onClick={onClick} disabled={disabled}><Save className="h-4 w-4" />{children}</Button>
}

export function useCrudFeedback() {
  const { toast } = useToast()
  const requireFields = (fields: Array<[string, string | number | boolean | undefined]>) => {
    const missing = fields.find(([, value]) => value === undefined || value === "" || value === false)
    if (missing) {
      toast({ title: "Campo obrigatório", description: `Preencha: ${missing[0]}`, variant: "destructive" })
      return false
    }
    return true
  }
  return { toast, requireFields }
}

export function names(state: OperationalState) {
  return {
    client: (id: string) => state.clients.find((item) => item.id === id)?.name || "-",
    supplier: (id: string) => state.suppliers.find((item) => item.id === id)?.name || "-",
    provider: (id: string) => state.providers.find((item) => item.id === id)?.fullName || "-",
    vehicle: (id: string) => state.vehicles.find((item) => item.id === id)?.plate || "-",
    material: (id: string) => state.materials.find((item) => item.id === id)?.name || "-",
  }
}

export function appendAudit(state: OperationalState, entityType: string, entityId: string, action: string, description: string): AuditLog[] {
  return [createAudit(entityType, entityId, action, description), ...state.auditLogs]
}

export function fullAddress(item: Client) {
  return [item.street, item.number, item.complement, item.district, item.city, item.state].filter(Boolean).join(", ")
}

export function exportToastMessage() {
  return "Exportação simulada no MVP local."
}

export function useGo() {
  const router = useRouter()
  return (path: string) => router.push(path)
}

export function AlertRow({ children }: { children: React.ReactNode }) {
  return <div className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{children}</div>
}

export function useFiltered<T>(items: T[], predicate: (item: T) => boolean, deps: React.DependencyList) {
  return useMemo(() => items.filter(predicate), [items, ...deps])
}
