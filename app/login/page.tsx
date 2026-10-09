"use client"

import { Suspense, useEffect } from "react"
import type React from "react"
import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { Building2, Lock, Mail } from "lucide-react"
import Image from "next/image"
import { useAuth } from "@/lib/auth-context"

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

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-gradient-to-br from-blue-50 via-white to-blue-100">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-10 w-72 h-72 bg-blue-200/30 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-blue-300/20 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-blue-100/30 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md px-4 md:px-6">
        <div className="bg-white border border-gray-200 rounded-2xl shadow-2xl p-6 md:p-8 lg:p-10">
          <div className="mb-6 md:mb-8 text-center">
            <div className="flex justify-center mb-4 md:mb-6">
              <Image
                src="/images/azul-20abstrato-20onda-20criativo-20capa-20para-20ebook-20-281000-20x-201000-20mm-29-20-288-29.png"
                alt="Dexo Logo"
                width={600}
                height={180}
                className="w-auto h-32 lg:h-52 md:h-44"
                priority
              />
            </div>
            <p className="text-sm text-gray-600">
              {availableCompanies.length ? "Escolha o CNPJ que deseja acessar." : "Entre com o usuario cadastrado no sistema."}
            </p>
          </div>

          {availableCompanies.length ? (
            <div className="space-y-3">
              {availableCompanies.map((company) => (
                <button
                  key={company.id}
                  type="button"
                  disabled={isLoading}
                  onClick={() => handleCompanySelection(company.id)}
                  className="flex w-full items-center gap-3 rounded-lg border border-gray-200 p-4 text-left transition-colors hover:border-blue-500 hover:bg-blue-50 disabled:opacity-60"
                >
                  <Building2 className="h-5 w-5 shrink-0 text-blue-600" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-gray-900">{company.tradeName || company.name}</span>
                    <span className="block text-sm text-gray-500">{company.cnpj || "CNPJ nao informado"}</span>
                  </span>
                </button>
              ))}
              <Button type="button" variant="ghost" className="w-full" onClick={() => setAvailableCompanies([])} disabled={isLoading}>
                Voltar
              </Button>
            </div>
          ) : <form onSubmit={handleSubmit} className="space-y-4 md:space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium">
                Email
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
                <Input
                  id="email"
                  type="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                  className="pl-10 h-11"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium">
                Senha
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
                <Input
                  id="password"
                  type="password"
                  placeholder="sua senha"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  className="pl-10 h-11"
                />
              </div>
            </div>

            <Button
              type="submit"
              className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-lg mt-6"
              disabled={isLoading}
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Entrando...
                </span>
              ) : (
                "Entrar"
              )}
            </Button>
          </form>}
        </div>

        <p className="text-center text-xs text-gray-600 mt-4 md:mt-6">Autenticacao segura via Supabase Auth</p>
      </div>
    </div>
  )
}
