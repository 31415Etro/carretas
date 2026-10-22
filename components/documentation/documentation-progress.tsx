"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { FileCheck2 } from "lucide-react"

/** Andamento documental de uma oportunidade (vendas ganhas a partir dela). Some quando não há documentação nem o módulo está instalado. */
export function OpportunityDocumentationProgress({ opportunityId }: { opportunityId: string }) {
  const [summary, setSummary] = useState<Record<string, any> | null>(null)
  useEffect(() => {
    let alive = true
    fetch(`/api/documentacao/resumo?oportunidade=${opportunityId}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => { if (alive) setSummary(payload?.summary || null) })
      .catch(() => undefined)
    return () => { alive = false }
  }, [opportunityId])
  if (!summary || !Number(summary.total)) return null
  const total = Number(summary.total) - Number(summary.cancelled || 0)
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
      <FileCheck2 className="h-4 w-4 text-muted-foreground" />
      <span><strong>Documentação veicular:</strong> {Number(summary.approved)} de {total} unidade(s) liberada(s)</span>
      {Number(summary.needs_action) ? <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{summary.needs_action} pedem ação</span> : null}
      {Number(summary.waiting) ? <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs text-indigo-800">{summary.waiting} aguardando o portal</span> : null}
      <Link href="/documentacao" className="ml-auto text-xs text-primary underline">Abrir Documentação veicular</Link>
    </div>
  )
}
