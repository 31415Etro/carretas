"use client"

import { useState } from "react"
import { NfeEmissionPanel } from "@/components/finance/nfe-emission-panel"
import { NotaAsInvoicePanel } from "@/components/finance/notaas-invoice-panel"
import type { OperationalState } from "@/lib/operational-storage"

/** Aba "Emitir NF" da Contabilidade: NF-e de venda emitida pelo NFeMail (padrão) ou serviços/materiais pelo NotaAS. */
export function EmitirNfTabs({ state }: { state: OperationalState }) {
  const [mode, setMode] = useState<"nfe" | "notaas">("nfe")
  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-md border p-0.5 text-sm">
        {([["nfe", "NF-e de venda (NFeMail)"], ["notaas", "Serviços e outras (NotaAS)"]] as const).map(([value, label]) => (
          <button key={value} type="button" onClick={() => setMode(value)} className={`rounded px-3 py-1 ${mode === value ? "bg-primary text-primary-foreground" : "text-foreground"}`}>{label}</button>
        ))}
      </div>
      {mode === "nfe" ? <NfeEmissionPanel /> : <NotaAsInvoicePanel state={state} />}
    </div>
  )
}
