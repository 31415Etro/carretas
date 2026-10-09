"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { useRouter, usePathname } from "next/navigation"
import { Topbar } from "@/components/topbar"
import { Sidebar as SidebarContainer, SidebarBody, SidebarLink, useSidebar } from "@/components/ui/sidebar-animated"
import {
  LayoutDashboard,
  ClipboardList,
  BarChart3,
  LogOut,
  Building2,
  Car,
  Landmark,
  Calculator,
  ClipboardCheck,
  FileText,
  Settings2,
  MapPinned,
  Package,
  ShoppingCart,
  Wrench,
  Activity,
} from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import { motion } from "framer-motion"

function MainContent({ children }: { children: React.ReactNode }) {
  const { open } = useSidebar()

  return (
    <motion.main
      animate={{
        marginLeft: open ? "280px" : "80px",
      }}
      transition={{
        duration: 0.3,
        ease: "easeInOut",
      }}
      className="p-4 md:p-8 md:ml-0"
      style={{
        marginLeft: typeof window !== "undefined" && window.innerWidth < 768 ? 0 : undefined,
      }}
    >
      {children}
    </motion.main>
  )
}

function SidebarContent() {
  const { logout, user } = useAuth()
  const { open } = useSidebar()

  const allLinks = [
    {
      label: "Dashboard",
      href: "/dashboard",
      permission: "dashboard" as const,
      icon: <LayoutDashboard className="text-sidebar-foreground h-5 w-5 flex-shrink-0" />,
    },
    {
      label: "Financeiro",
      href: "/financeiro",
      permission: "financeiro" as const,
      icon: <Landmark className="text-sidebar-foreground h-5 w-5 flex-shrink-0" />,
    },
    {
      label: "Estoque",
      href: "/estoque",
      permission: "estoque" as const,
      icon: <Package className="text-sidebar-foreground h-5 w-5 flex-shrink-0" />,
    },
    {
      label: "Compras",
      href: "/compras",
      permission: "compras" as const,
      icon: <ShoppingCart className="text-sidebar-foreground h-5 w-5 flex-shrink-0" />,
    },
    {
      label: "Produtos / Serviços",
      href: "/servicos",
      permission: "produtos_servicos" as const,
      icon: <Wrench className="text-sidebar-foreground h-5 w-5 flex-shrink-0" />,
    },
    {
      label: "Ordens de Serviço",
      href: "/ordens-servico",
      permission: "ordens_servico" as const,
      icon: <ClipboardList className="text-sidebar-foreground h-5 w-5 flex-shrink-0" />,
    },
    {
      label: "Frota",
      href: "/frota",
      permission: "frota" as const,
      icon: <Car className="text-sidebar-foreground h-5 w-5 flex-shrink-0" />,
    },
    {
      label: "Clientes e Fornecedores",
      href: "/clientes",
      permission: "clientes" as const,
      icon: <Building2 className="text-sidebar-foreground h-5 w-5 flex-shrink-0" />,
    },
    {
      label: "Comercial",
      href: "/comercial",
      permission: "comercial" as const,
      icon: <MapPinned className="text-sidebar-foreground h-5 w-5 flex-shrink-0" />,
    },
    {
      label: "Orçamentos",
      href: "/orcamento",
      permission: "orcamento" as const,
      icon: <Calculator className="text-sidebar-foreground h-5 w-5 flex-shrink-0" />,
    },
    {
      label: "Contratos",
      href: "/contratos",
      permission: "contratos" as const,
      icon: <FileText className="text-sidebar-foreground h-5 w-5 flex-shrink-0" />,
    },
    {
      label: "Relatórios",
      href: "/relatorios",
      permission: "relatorios" as const,
      icon: <BarChart3 className="text-sidebar-foreground h-5 w-5 flex-shrink-0" />,
    },
    {
      label: "Logs do Sistema",
      href: "/logs-sistema",
      permission: "configuracoes" as const,
      adminOnly: true,
      icon: <Activity className="text-sidebar-foreground h-5 w-5 flex-shrink-0" />,
    },
    {
      label: "Configurações",
      href: "/configuracoes",
      permission: "configuracoes" as const,
      icon: <Settings2 className="text-sidebar-foreground h-5 w-5 flex-shrink-0" />,
    },
  ]

  const links =
    user?.role === "admin"
      ? allLinks
      : allLinks.filter((link) => {
          if ("adminOnly" in link && link.adminOnly) return false
          if (!user || !user.permissions) return false
          return user.permissions.includes(link.permission)
        })

  return (
    <div className="fixed left-0 top-16 z-40 h-[calc(100vh-4rem)]">
      <SidebarBody className="justify-between gap-6">
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mt-4 flex min-h-0 flex-col gap-1 overflow-y-auto pr-1">
            {links.map((link, idx) => (
              <SidebarLink key={idx} link={link} />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <div className="border-t border-border pt-3">
            {open && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-2 px-2">
                <p className="text-sm font-medium text-foreground">{user?.name}</p>
                <p className="text-xs text-muted-foreground">{user?.email}</p>
              </motion.div>
            )}
            <Button
              onClick={logout}
              variant="ghost"
              className="w-full justify-start gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <LogOut className="h-5 w-5 flex-shrink-0" />
              {open && <span className="text-sm">Sair</span>}
            </Button>
          </div>
        </div>
      </SidebarBody>
    </div>
  )
}

export function PageLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
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
      { href: "/clientes", permission: "clientes" },
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
    <div className="min-h-screen flex flex-col">
      <Topbar />
      <SidebarContainer open={open} setOpen={setOpen}>
        <SidebarContent />
        <MainContent>{children}</MainContent>
      </SidebarContainer>
    </div>
  )
}
