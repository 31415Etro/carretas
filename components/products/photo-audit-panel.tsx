"use client"

import { useState } from "react"
import { Loader2, ScanSearch } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SectionCard } from "@/components/operations/shared"
import { api } from "@/components/catalog/catalog-fields"
import { useAuth } from "@/lib/auth-context"

type Audit = { mode: string; catalogued?: number; checked: number; available: number; unavailable: number; counts: Record<string, number> }
const statusLabel: Record<string, string> = { Disponivel: "Disponíveis", Indisponivel: "Indisponíveis", "Pendente de verificacao": "A conferir", Removida: "Removidas" }

/** Auditoria das fotografias antigas (só administrador). Catalogar apenas registra; verificar confere cada arquivo no armazenamento. Nada é apagado nem substituído. */
export function PhotoAuditPanel({ onDone }: { onDone?: () => void }) {
  const { user } = useAuth()
  const [busy, setBusy] = useState("")
  const [audit, setAudit] = useState<Audit | null>(null)
  const [message, setMessage] = useState("")
  if (user?.role !== "admin") return null
  async function run(mode: "catalogar" | "verificar") {
    setBusy(mode); setMessage("")
    try {
      const data = await api<{ audit: Audit }>("/api/produtos/fotos-auditoria", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) })
      setAudit(data.audit)
      setMessage(mode === "catalogar" ? `${data.audit.catalogued ?? 0} referência(s) antiga(s) registrada(s). Nada foi alterado nos cadastros.` : `${data.audit.checked} fotografia(s) conferida(s): ${data.audit.available} disponível(is), ${data.audit.unavailable} indisponível(is).`)
      if (mode === "verificar") onDone?.()
    } catch (error) { setMessage(error instanceof Error ? error.message : "Auditoria não concluída.") } finally { setBusy("") }
  }
  return (
    <SectionCard title="Auditoria das fotografias antigas">
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">1) <strong>Registrar</strong> cataloga as fotos já cadastradas sem mexer nos produtos. 2) <strong>Conferir arquivos</strong> verifica se cada arquivo ainda existe: os que existem passam a usar o endereço estável do sistema; os que sumiram ficam marcados como indisponíveis (a referência quebrada some das telas e o registro antigo é mantido) para você enviar a foto nova no produto.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => void run("catalogar")} disabled={Boolean(busy)}>{busy === "catalogar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}1. Registrar fotos antigas</Button>
          <Button variant="outline" onClick={() => void run("verificar")} disabled={Boolean(busy)}>{busy === "verificar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}2. Conferir arquivos</Button>
        </div>
        {message ? <p className="rounded-md border bg-muted/40 p-2" role="status">{message}</p> : null}
        {audit ? <p className="text-xs text-muted-foreground">{Object.entries(audit.counts).map(([key, value]) => `${statusLabel[key] || key}: ${value}`).join(" · ")}</p> : null}
      </div>
    </SectionCard>
  )
}
