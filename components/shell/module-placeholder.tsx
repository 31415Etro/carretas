import { PageShell, SectionCard } from "@/components/operations/shared"

/** Módulo ainda sem implementação: mantém o item no menu até a especificação ser entregue. */
export function ModulePlaceholder({ title, description }: { title: string; description: string }) {
  return (
    <PageShell title={title} description={description}>
      <SectionCard title="Em construção">
        <p className="text-sm text-muted-foreground">Este módulo será montado conforme a especificação funcional das carretas.</p>
      </SectionCard>
    </PageShell>
  )
}
