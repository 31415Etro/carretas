"use client"

import { LockKeyhole } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/auth-context"

export default function AccessDeniedPage() {
  const { logout } = useAuth()
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <section className="w-full max-w-md rounded-md border bg-card p-6 text-center shadow-sm">
        <LockKeyhole className="mx-auto h-10 w-10 text-primary" />
        <h1 className="mt-4 text-xl font-semibold">Acesso ainda nao liberado</h1>
        <p className="mt-2 text-sm text-muted-foreground">Este usuario nao possui nenhuma pagina selecionada. Solicite a um administrador que ajuste as permissoes.</p>
        <Button className="mt-5" variant="outline" onClick={logout}>Sair</Button>
      </section>
    </main>
  )
}
