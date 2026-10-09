"use client"

import { useEffect } from "react"
import { RefreshCw } from "lucide-react"

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    void fetch("/api/system-logs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: "Falha global da interface", message: error.message, severity: "critical", path: window.location.pathname, method: "CLIENT", details: { digest: error.digest || "" } }) }).catch(() => {})
  }, [error])
  return <html lang="pt-BR"><body><main className="flex min-h-screen items-center justify-center bg-background p-6"><div className="max-w-md text-center"><h1 className="text-2xl font-bold">Nao foi possivel abrir esta tela</h1><p className="mt-2 text-muted-foreground">A falha foi registrada para analise.</p><button className="mt-6 inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground" onClick={reset}><RefreshCw className="h-4 w-4" />Tentar novamente</button></div></main></body></html>
}
