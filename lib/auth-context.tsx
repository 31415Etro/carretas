"use client"

import { createContext, useContext, useState, useEffect, useMemo, useCallback, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { systemPagePermissions, type PagePermission } from "@/lib/types"
import type { SystemCompany } from "@/lib/system-company"

export type UserRole = "admin" | "sdr" | "closer" | "representative" | "manager" | "sd" | "client" | "user"

export interface User {
  id: string
  name: string
  email: string
  role: UserRole
  permissions: PagePermission[]
  clientId?: string | null
  company: SystemCompany
}

interface AuthContextType {
  user: User | null
  companies: SystemCompany[]
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string; companies?: SystemCompany[] }>
  selectCompany: (companyId: string) => Promise<{ success: boolean; error?: string }>
  logout: () => Promise<void>
  isLoading: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const adminPermissions: PagePermission[] = systemPagePermissions

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [companies, setCompanies] = useState<SystemCompany[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    document.documentElement.dataset.userRole = user?.role || "guest"
    return () => {
      delete document.documentElement.dataset.userRole
    }
  }, [user?.role])

  useEffect(() => {
    fetch("/api/auth/user", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => {
        setCompanies(payload.companies || [])
        if (payload?.user) {
          setUser({
            ...payload.user,
            permissions: payload.user.role === "admin" ? adminPermissions : (payload.user.permissions || []),
          })
        } else {
          setUser(null)
        }
      })
      .catch((err) => {
        console.error("Erro ao carregar sessao:", err)
        setUser(null)
      })
      .finally(() => setIsLoading(false))
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) {
        return { success: false, error: payload.error || "E-mail ou senha invalidos" }
      }
      const available = payload.companies || []
      setCompanies(available)
      setUser(null)
      return { success: true, companies: available }
    } catch (err) {
      console.error("Erro ao iniciar sessao:", err)
      return { success: false, error: "Nao foi possivel iniciar a sessao" }
    }
  }, [])

  const selectCompany = useCallback(async (companyId: string) => {
    try {
      const response = await fetch("/api/auth/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      })
      const payload = await response.json()
      if (!response.ok) return { success: false, error: payload.error || "Nao foi possivel selecionar a empresa" }

      const userResponse = await fetch("/api/auth/user", { cache: "no-store" })
      const userPayload = await userResponse.json()
      if (!userPayload.user) return { success: false, error: "Usuario sem perfil cadastrado" }
      setCompanies(userPayload.companies || [])
      setUser({
        ...userPayload.user,
        permissions: userPayload.user.role === "admin" ? adminPermissions : (userPayload.user.permissions || []),
      })
      return { success: true }
    } catch (error) {
      console.error("Erro ao selecionar empresa:", error)
      return { success: false, error: "Nao foi possivel selecionar a empresa" }
    }
  }, [])

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {})
    setUser(null)
    setCompanies([])
    router.push("/login")
  }, [router])

  const value = useMemo(
    () => ({ user, companies, login, selectCompany, logout, isLoading }),
    [user, companies, login, selectCompany, logout, isLoading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
