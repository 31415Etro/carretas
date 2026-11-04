"use client"

import { BrandMark } from "@/components/shell/brand-mark"
import { Suspense, useEffect } from "react"
import type React from "react"
import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { ArrowLeft, Building2, ChevronRight, Lock, Mail } from "lucide-react"
import { AppFooter } from "@/components/shell/app-footer"
import { useAuth } from "@/lib/auth-context"
import { GradientWave } from "@/components/ui/gradient-wave"

const WAVE_COLORS = ["#1d4ed8", "#93c5fd", "#2563eb", "#dbeafe", "#3b82f6", "#ffffff"]

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [availableCompanies, setAvailableCompanies] = useState<import("@/lib/system-company").SystemCompany[]>([])
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const { companies, login, selectCompany, user, isLoading: authLoading } = useAuth()
  const requestedReturnTo = searchParams.get("returnTo") || "/dashboard"
  const returnTo = requestedReturnTo.startsWith("/") && !requestedReturnTo.startsWith("//") ? requestedReturnTo : "/dashboard"

  useEffect(() => {
    if (!authLoading && user) {
      router.replace(returnTo)
    }
  }, [user, authLoading, router, returnTo])

  useEffect(() => {
    if (!authLoading && !user && companies.length) setAvailableCompanies(companies)
  }, [authLoading, user, companies])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    const result = await login(email, password)

    if (!result.success) {
      toast({
        title: "Falha no login",
        description: result.error || "Nao foi possivel entrar",
        variant: "destructive",
      })
      setIsLoading(false)
      return
    }

    setAvailableCompanies(result.companies || [])
    setIsLoading(false)
  }

  const handleCompanySelection = async (companyId: string) => {
    setIsLoading(true)
    const result = await selectCompany(companyId)
    if (!result.success) {
      toast({ title: "Falha ao acessar empresa", description: result.error, variant: "destructive" })
      setIsLoading(false)
      return
    }
    router.replace(returnTo)
  }

  const choosing = availableCompanies.length > 0

  return (
    <div className="relative min-h-screen overflow-hidden bg-[var(--brand-softer)]">
      <GradientWave colors={WAVE_COLORS} />
      <main className="relative z-10 flex min-h-screen items-center justify-center px-4 py-10 md:px-8">
        <div className="w-full max-w-md">
          <div className="mb-6 flex justify-center">
            <BrandMark className="h-20" />
          </div>
          <div className="rounded-2xl border border-white/60 bg-white/95 p-6 backdrop-blur shadow-xl shadow-blue-900/5 md:p-9">
            <div className="mb-7">
              <h2 className="text-2xl font-semibold text-slate-900">{choosing ? "Escolha a empresa" : "Bem-vindo de volta"}</h2>
              <p className="mt-1 text-sm text-slate-500">
                {choosing ? "Selecione o CNPJ que deseja acessar agora. Você pode trocar depois no menu." : "Entre com o usuário cadastrado no sistema."}
              </p>
            </div>

            {choosing ? (
              <div className="space-y-3">
                {availableCompanies.map((company) => {
                  const label = company.tradeName || company.name
                  return (
                    <button
                      key={company.id}
                      type="button"
                      disabled={isLoading}
                      onClick={() => handleCompanySelection(company.id)}
                      className="group flex w-full items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-[var(--brand)] hover:bg-[var(--brand-softer)] hover:shadow-md disabled:opacity-60"
                    >
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-soft)] text-[var(--brand-dark)]">
                        <Building2 className="h-5 w-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-slate-900">{label}</span>
                        <span className="block text-sm text-slate-500">{company.cnpj || "CNPJ não informado"}</span>
                      </span>
                      <ChevronRight className="h-5 w-5 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-[var(--brand)]" />
                    </button>
                  )
                })}
                <Button type="button" variant="ghost" className="w-full text-slate-600" onClick={() => setAvailableCompanies([])} disabled={isLoading}>
                  <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm font-medium text-slate-700">E-mail</Label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                    <Input id="email" type="email" placeholder="seu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} disabled={isLoading} className="h-11 pl-10" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-sm font-medium text-slate-700">Senha</Label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                    <Input id="password" type="password" placeholder="sua senha" value={password} onChange={(e) => setPassword(e.target.value)} disabled={isLoading} className="h-11 pl-10" />
                  </div>
                </div>
                <Button type="submit" className="mt-2 h-11 w-full bg-[var(--brand)] font-medium text-white shadow-md hover:bg-[var(--brand-dark)]" disabled={isLoading}>
                  {isLoading ? (
                    <span className="flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Entrando...
                    </span>
                  ) : (
                    "Entrar"
                  )}
                </Button>
              </form>
            )}
          </div>
          <p className="mt-5 text-center text-xs text-slate-500">Autenticação segura via Supabase Auth</p>
          <AppFooter className="mt-2" />
        </div>
      </main>
    </div>
  )
}
