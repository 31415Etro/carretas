"use client"

import { ExternalLink } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageShell } from "@/components/operations/shared"
import { ProductionPage } from "@/components/production/production-page"
import { ShopBoardPage } from "@/components/shop-floor/shop-board-page"
import { useAuth } from "@/lib/auth-context"
import { EmbeddedPageContext } from "@/lib/embedded-page"

const tabs = ["esteira", "ordens", "tablet"] as const
type Tab = (typeof tabs)[number]

/** Produção: uma página só, com as abas Produção e MRP, Esteira da fábrica e Tablet da fábrica. */
export function ProductionHubPage() {
  const router = useRouter()
  const params = useSearchParams()
  const { user } = useAuth()
  const canTablet = !user || user.role === "admin" || (user.permissions as readonly string[] | undefined)?.includes("chao_fabrica")
  const requested = params.get("aba") as Tab | null
  const legacy = (params.get("aba") === "mrp" ? "ordens" : requested) as Tab | null
  const tab: Tab = legacy && tabs.includes(legacy) && (legacy !== "tablet" || canTablet) ? legacy : "esteira"
  return (
    <PageShell title="Produção" description="A esteira da fábrica é o centro: cada carreta na sua etapa, com um clique para avançar.">
      <Tabs value={tab} onValueChange={(value) => router.replace(`/producao?aba=${value}`, { scroll: false })}>
        <TabsList>
          <TabsTrigger value="esteira">Esteira da fábrica</TabsTrigger>
          <TabsTrigger value="ordens">Ordens e materiais</TabsTrigger>
          {canTablet ? <TabsTrigger value="tablet">Tablet da fábrica</TabsTrigger> : null}
        </TabsList>
        <EmbeddedPageContext.Provider value>
          <TabsContent value="esteira" className="mt-4"><ShopBoardPage /></TabsContent>
          <TabsContent value="ordens" className="mt-4"><ProductionPage /></TabsContent>
        </EmbeddedPageContext.Provider>
        {canTablet ? (
          <TabsContent value="tablet" className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-3xl text-sm text-muted-foreground">Tela que os colaboradores usam no tablet (matrícula e senha, tarefas, desenho e materiais). Nos tablets da fábrica, abra o endereço <span className="font-mono">/producao/tablet</span> direto, em tela cheia.</p>
              <Button variant="outline" asChild><a href="/producao/tablet" target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" />Abrir em tela cheia</a></Button>
            </div>
            <iframe title="Tablet da fábrica" src="/producao/tablet" className="h-[78vh] w-full rounded-xl border bg-slate-950" />
          </TabsContent>
        ) : null}
      </Tabs>
    </PageShell>
  )
}
