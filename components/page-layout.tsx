"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { useRouter, usePathname } from "next/navigation"
import { DesktopSidebar, MobileBar, useSidebarCollapsed } from "@/components/shell/app-sidebar"
import { useAuth } from "@/lib/auth-context"

export function PageLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, toggleCollapsed] = useSidebarCollapsed()
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const [hasRedirected, setHasRedirected] = useState(false)

  useEffect(() => {
    if (!isLoading && !user && pathname !== "/login") {
      router.push("/login")
    }
  }, [user, isLoading, router, pathname])

  useEffect(() => {
    if (!user || isLoading || user.role === "admin" || hasRedirected) return

    const allLinks = [
      { href: "/", permission: "dashboard" },
      { href: "/dashboard", permission: "dashboard" },
      { href: "/financeiro", permission: "financeiro" },
      { href: "/estoque", permission: "estoque" },
      { href: "/compras", permission: "compras" },
      { href: "/servicos", permission: "produtos_servicos" },
      { href: "/ordens-servico", permission: "ordens_servico" },
      { href: "/frota", permission: "frota" },
      { href: "/clientes", permission: "comercial" },
      { href: "/comercial", permission: "comercial" },
      { href: "/orcamento", permission: "orcamento" },
      { href: "/contratos", permission: "contratos" },
      { href: "/relatorios", permission: "relatorios" },
      { href: "/configuracoes", permission: "configuracoes" },
    ]

    const currentPage = allLinks.find((link) => link.href === pathname)
    if (!currentPage) return

    if (user.permissions && !user.permissions.includes(currentPage.permission as any)) {
      const firstAllowedPage = allLinks.find((link) => user.permissions?.includes(link.permission as any))
      if (firstAllowedPage && firstAllowedPage.href !== pathname) {
        setHasRedirected(true)
        router.replace(firstAllowedPage.href)
      }
    }
  }, [user, isLoading, pathname, router, hasRedirected])

  useEffect(() => {
    setHasRedirected(false)
  }, [pathname])

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="min-h-screen">
      <DesktopSidebar collapsed={collapsed} toggle={toggleCollapsed} />
      <MobileBar />
      <main className={`min-w-0 p-4 transition-[margin] duration-200 ease-out md:p-6 lg:p-8 ${collapsed ? "md:ml-[var(--sidebar-width-collapsed)]" : "md:ml-[var(--sidebar-width)]"}`}>
        {children}
      </main>
    </div>
  )
}
