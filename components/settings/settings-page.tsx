"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageShell } from "@/components/operations/shared"
import { TeamPanel } from "@/components/operations/registry-pages"
import { BranchesPanel } from "@/components/settings/branches-panel"
import { CommercialPanel } from "@/components/settings/commercial-panel"
import { CompaniesPanel } from "@/components/settings/companies-panel"
import { DocumentsPanel } from "@/components/settings/documents-panel"
import { IntegrationsPanel } from "@/components/settings/integrations-panel"
import { PerformancePanel } from "@/components/settings/performance-panel"
import { FiscalPanel, ParametersPanel } from "@/components/settings/parameters-panel"
import { UsersPanel } from "@/components/settings/users-panel"
import { useAuth } from "@/lib/auth-context"

/** Configurações: administradores veem tudo; os demais perfis com a permissão veem a equipe técnica e os documentos. */
export function SettingsPage() {
  const { user } = useAuth()
  const admin = user?.role === "admin"
  const owner = String(user?.email || "").trim().toLowerCase() === "pmalvesi61@gmail.com" // aba Desempenho: só o dono do sistema
  return (
    <PageShell title="Configurações" description="Empresas, filiais, usuários e permissões, parâmetros por área, fiscais, comerciais, notificações, integrações e documentos.">
      <Tabs defaultValue={admin ? "empresas" : "equipe"}>
        <TabsList className="flex h-auto flex-wrap">
          {admin && <TabsTrigger value="empresas">Empresas</TabsTrigger>}
          {admin && <TabsTrigger value="filiais">Filiais</TabsTrigger>}
          {admin && <TabsTrigger value="usuarios">Usuários</TabsTrigger>}
          <TabsTrigger value="equipe">Equipe técnica</TabsTrigger>
          {admin && <TabsTrigger value="financeiras">Financeiras</TabsTrigger>}
          {admin && <TabsTrigger value="estoque">Estoque</TabsTrigger>}
          {admin && <TabsTrigger value="operacionais">Operacionais</TabsTrigger>}
          {admin && <TabsTrigger value="fiscais">Fiscais</TabsTrigger>}
          {admin && <TabsTrigger value="comerciais">Comerciais</TabsTrigger>}
          {admin && <TabsTrigger value="notificacoes">Notificações</TabsTrigger>}
          {admin && <TabsTrigger value="integracoes">Integrações</TabsTrigger>}
          <TabsTrigger value="documentos">Documentos</TabsTrigger>
          {owner && <TabsTrigger value="desempenho">Desempenho</TabsTrigger>}
        </TabsList>
        {admin && <TabsContent value="empresas"><CompaniesPanel /></TabsContent>}
        {admin && <TabsContent value="filiais"><BranchesPanel /></TabsContent>}
        {admin && <TabsContent value="usuarios"><UsersPanel /></TabsContent>}
        <TabsContent value="equipe"><TeamPanel /></TabsContent>
        {admin && <TabsContent value="financeiras"><ParametersPanel sectionKey="finance" /></TabsContent>}
        {admin && <TabsContent value="estoque"><ParametersPanel sectionKey="stock" /></TabsContent>}
        {admin && <TabsContent value="operacionais"><ParametersPanel sectionKey="os" /></TabsContent>}
        {admin && <TabsContent value="fiscais"><FiscalPanel /></TabsContent>}
        {admin && <TabsContent value="comerciais"><div className="space-y-4"><ParametersPanel sectionKey="commercial" /><CommercialPanel /></div></TabsContent>}
        {admin && <TabsContent value="notificacoes"><ParametersPanel sectionKey="notifications" /></TabsContent>}
        {admin && <TabsContent value="integracoes"><IntegrationsPanel /></TabsContent>}
        <TabsContent value="documentos"><DocumentsPanel /></TabsContent>
        {owner && <TabsContent value="desempenho"><PerformancePanel /></TabsContent>}
      </Tabs>
    </PageShell>
  )
}
