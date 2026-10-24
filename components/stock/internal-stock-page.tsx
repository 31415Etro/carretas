"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageShell } from "@/components/operations/shared"
import { EmbeddedPageContext } from "@/lib/embedded-page"
import { RawMaterialsPage } from "@/components/raw-materials/raw-materials-page"
import { KitsPage } from "@/components/kits/kits-page"
import { ProductsPage } from "@/components/products/products-page"

const tabs = ["materias-primas", "kits", "produtos"] as const
type Tab = (typeof tabs)[number]

/** Estoque: uma página só, com as três abas (matérias-primas, kits e composições, produtos finais). */
export function InternalStockPage() {
  const router = useRouter()
  const params = useSearchParams()
  const requested = params.get("aba") as Tab | null
  const tab: Tab = requested && tabs.includes(requested) ? requested : "materias-primas"
  return (
    <PageShell title="Estoque" description="Matérias-primas, kits e composições e produtos finais: escolha a aba.">
      <Tabs value={tab} onValueChange={(value) => router.replace(`/estoque-interno?aba=${value}`, { scroll: false })}>
        <TabsList>
          <TabsTrigger value="materias-primas">Matérias-primas</TabsTrigger>
          <TabsTrigger value="kits">Kits e composições</TabsTrigger>
          <TabsTrigger value="produtos">Produtos finais</TabsTrigger>
        </TabsList>
        <EmbeddedPageContext.Provider value>
          <TabsContent value="materias-primas" className="mt-4"><RawMaterialsPage /></TabsContent>
          <TabsContent value="kits" className="mt-4"><KitsPage /></TabsContent>
          <TabsContent value="produtos" className="mt-4"><ProductsPage /></TabsContent>
        </EmbeddedPageContext.Provider>
      </Tabs>
    </PageShell>
  )
}
