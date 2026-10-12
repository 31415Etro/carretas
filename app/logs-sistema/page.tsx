"use client"

import { AlertTriangle } from "lucide-react"
import { PageLayout } from "@/components/page-layout"
import { PageShell } from "@/components/operations/shared"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AuditPanel } from "@/components/audit/audit-panel"
import { SystemErrorsPanel } from "@/components/system-logs/errors-panel"
import { useAuth } from "@/lib/auth-context"

export default function SystemLogsPage() {
  const { user, isLoading } = useAuth()
  if (!isLoading && user?.role !== "admin") return <PageLayout><div className="py-16 text-center"><AlertTriangle className="mx-auto mb-3 h-8 w-8 text-destructive" /><h1 className="text-xl font-semibold">Acesso restrito</h1><p className="mt-1 text-sm text-muted-foreground">O log do sistema é exclusivo para administradores.</p></div></PageLayout>
  return (
    <PageShell title="Log do Sistema" description="Trilha de auditoria (quem fez o quê, quando e com quais dados) e falhas técnicas. Os registros não podem ser alterados nem apagados, exceto pela retenção.">
      {user?.role === "admin" && (
        <Tabs defaultValue="auditoria">
          <TabsList><TabsTrigger value="auditoria">Auditoria</TabsTrigger><TabsTrigger value="falhas">Falhas técnicas</TabsTrigger></TabsList>
          <TabsContent value="auditoria"><AuditPanel /></TabsContent>
          <TabsContent value="falhas"><SystemErrorsPanel /></TabsContent>
        </Tabs>
      )}
    </PageShell>
  )
}
