"use client"

import { useCallback, useEffect, useState } from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TableCell, TableRow } from "@/components/ui/table"
import { DataTable, SectionCard, StatusBadge, useCrudFeedback } from "@/components/operations/shared"
import { api, post, stamp, type Row } from "@/components/settings/common"

type Overview = { integrations: Row[]; failedEvents: Row[]; history: Row[]; secretsConfigured: boolean }

/** Situação das integrações, histórico das ações e reprocessamento de webhooks que falharam. As chaves ficam no servidor e nunca aparecem aqui. */
export function IntegrationsPanel() {
  const { toast } = useCrudFeedback()
  const [data, setData] = useState<Overview | null>(null)
  const [busy, setBusy] = useState("")

  const load = useCallback(async () => setData(await api<Overview>("/api/configuracoes/integracoes")), [])
  useEffect(() => { void load().catch((reason) => toast({ title: "Erro ao carregar integrações", description: reason instanceof Error ? reason.message : "", variant: "destructive" })) }, [load, toast])

  async function testAsaas() {
    setBusy("test")
    try {
      const result = await api<{ accounts: Array<{ label: string; connected: boolean; message: string }> }>("/api/integrations/asaas/test-connection")
      toast({ title: "Teste de conexão (Asaas)", description: result.accounts.map((account) => `${account.label}: ${account.connected ? "conectada" : account.message}`).join(" | "), variant: result.accounts.every((account) => account.connected) ? undefined : "destructive" })
    } catch (reason) {
      toast({ title: "Teste não concluído", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    } finally {
      setBusy("")
      await load().catch(() => undefined)
    }
  }

  async function syncAsaas() {
    setBusy("sync")
    try {
      await api("/api/integrations/asaas/sync", { method: "POST", body: JSON.stringify({ account: "all" }) })
      toast({ title: "Sincronização do Asaas concluída" })
    } catch (reason) {
      toast({ title: "Sincronização falhou", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    } finally {
      setBusy("")
      await load().catch(() => undefined)
    }
  }

  async function reprocess(id: string) {
    setBusy(id)
    try {
      await post("integracoes", { action: "reprocess", eventId: id })
      toast({ title: "Evento reprocessado" })
    } catch (reason) {
      toast({ title: "Reprocessamento falhou", description: reason instanceof Error ? reason.message : "", variant: "destructive" })
    } finally {
      setBusy("")
      await load().catch(() => undefined)
    }
  }

  return (
    <div className="space-y-4">
      <SectionCard title="Integrações" description="Provedor, ambiente, escopos e situação. As credenciais ficam em variáveis de ambiente do servidor: não são exibidas nem gravadas em log.">
        <div className="mb-3 flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void load()}><RefreshCw className="h-4 w-4" />Atualizar</Button>
          <Button variant="outline" onClick={() => void testAsaas()} disabled={busy === "test"}>Testar conexão (Asaas)</Button>
          <Button variant="outline" onClick={() => void syncAsaas()} disabled={busy === "sync"}>Sincronizar extratos (Asaas)</Button>
        </div>
        <DataTable headers={["Identificador", "Provedor", "Ambiente", "Situação", "Escopos", "Autenticação", "Webhook", "Última sincronização", "Último webhook"]} empty={!data?.integrations.length}>
          {(data?.integrations || []).map((item) => (
            <TableRow key={item.key}>
              <TableCell className="font-mono text-xs">{item.key}</TableCell><TableCell>{item.name}</TableCell><TableCell>{item.environment}</TableCell>
              <TableCell><StatusBadge status={item.status === "Ativa" ? "Ativo" : item.status} />{item.error && <div className="text-xs text-destructive">{item.error}</div>}</TableCell>
              <TableCell className="max-w-[14rem] text-xs">{item.scopes.join(", ")}</TableCell><TableCell className="max-w-[14rem] text-xs">{item.authentication}</TableCell><TableCell className="text-xs">{item.webhook}</TableCell>
              <TableCell>{stamp(item.lastSyncAt)}</TableCell><TableCell>{stamp(item.lastWebhookAt)}</TableCell>
            </TableRow>
          ))}
        </DataTable>
        {data && !data.secretsConfigured && <p className="mt-2 text-xs text-amber-600">CONFIG_ENCRYPTION_KEY não definida: senhas de certificado digital não podem ser guardadas.</p>}
      </SectionCard>

      <SectionCard title="Eventos com falha (Asaas)" description="Webhooks recebidos que não puderam ser processados. Reprocesse depois de corrigir a causa; cada tentativa é contada e auditada.">
        <DataTable headers={["Recebido em", "Conta", "Evento", "Erro", "Tentativas", "Ações"]} empty={!data?.failedEvents.length}>
          {(data?.failedEvents || []).map((event) => (
            <TableRow key={event.id}>
              <TableCell>{stamp(event.receivedAt)}</TableCell><TableCell>{event.account}</TableCell><TableCell>{event.eventType}</TableCell><TableCell className="max-w-md text-xs text-destructive">{event.error}</TableCell><TableCell>{event.attempts}</TableCell>
              <TableCell><Button size="sm" variant="outline" onClick={() => void reprocess(event.id)} disabled={busy === event.id}>Reprocessar</Button></TableCell>
            </TableRow>
          ))}
        </DataTable>
      </SectionCard>

      <SectionCard title="Histórico das ações de integrações" description="Chamadas feitas ou recebidas pelas integrações, com resultado e origem (vem da trilha de auditoria).">
        <DataTable headers={["Data/hora", "Ação", "Descrição", "Resultado", "Origem", "Usuário"]} empty={!data?.history.length}>
          {(data?.history || []).map((item) => (
            <TableRow key={item.id}>
              <TableCell className="whitespace-nowrap">{stamp(item.at)}</TableCell><TableCell>{item.action}</TableCell><TableCell className="max-w-md text-xs">{item.description}</TableCell>
              <TableCell><StatusBadge status={item.result === "Sucesso" ? "Sucesso" : item.result === "Negado" ? "Negado" : "Falha"} /></TableCell><TableCell>{item.origin}</TableCell><TableCell>{item.actor || "-"}</TableCell>
            </TableRow>
          ))}
        </DataTable>
      </SectionCard>
    </div>
  )
}
