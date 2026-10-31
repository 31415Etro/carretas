import { Loader2 } from "lucide-react"

/** Aparece no mesmo instante em que se clica em outra página, enquanto ela é montada (a navegação não fica parecendo travada). */
export default function Loading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground" role="status" aria-label="Carregando">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  )
}
