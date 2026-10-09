"use client"

import { useState } from "react"
import {
  LayoutDashboard,
  Kanban,
  Calendar,
  BarChart3,
  Shield,
  LogOut,
  MessageSquare,
  Users,
  Frame,
  Landmark,
  Calculator,
  ClipboardCheck,
  FileText,
  MapPinned,
} from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import { Sidebar as SidebarContainer, SidebarBody, SidebarLink } from "@/components/ui/sidebar-animated"
import Image from "next/image"
import Link from "next/link"
import { motion } from "framer-motion"

export function Sidebar() {
  const { logout, user } = useAuth()
  const [open, setOpen] = useState(false)

  const links = [
    {
      label: "Dashboard",
      href: "/dashboard",
      icon: <LayoutDashboard className="text-sidebar-foreground h-5 w-5 flex-shrink-0" />,
    },
    {
      label: "Closer Board",
      href: "/kanban/closer",
      icon: <Kanban className="text-sidebar-foreground h-5 w-5 flex-shrink-0" />,
    },
    {
      label: "Cadastro",
      href: "/cadastro",
      icon: <Frame className="text-sidebar-foreground h-5 w-5 flex-shrink-0" />,
    },
    {
      label: "Financeiro",
      href: "/financeiro",
      icon: <Landmark className="text-sidebar-foreground h-5 w-5 flex-shrink-0" />,
    },
    {
      label: "Comercial",
      href: "/comercial",
      icon: <MapPinned className="text-sidebar-foreground h-5 w-5 flex-shrink-0" />,
    },
    {
      label: "PMOC",
      href: "/pmoc",
      icon: <ClipboardCheck className="text-sidebar-foreground h-5 w-5 flex-shrink-0" />,
    },
    {
      label: "Orçamento",
      href: "/orcamento",
      icon: <Calculator className="text-sidebar-foreground h-5 w-5 flex-shrink-0" />,
    },
    {
      label: "Contratos",
      href: "/contratos",
      icon: <FileText className="text-sidebar-foreground h-5 w-5 flex-shrink-0" />,
    },
    {
      label: "Clients",
      href: "/clients",
      icon: <Users className="text-sidebar-foreground h-5 w-5 flex-shrink-0" />,
    },
    {
      label: "Calendario",
      href: "/calendar",
      icon: <Calendar className="text-sidebar-foreground h-5 w-5 flex-shrink-0" />,
    },
    {
      label: "Analytics",
      href: "/analytics",
      icon: <BarChart3 className="text-sidebar-foreground h-5 w-5 flex-shrink-0" />,
    },
    {
      label: "Mensagens",
      href: "/messages",
      icon: <MessageSquare className="text-sidebar-foreground h-5 w-5 flex-shrink-0" />,
    },
    {
      label: "Usuarios",
      href: "/users",
      icon: <Shield className="text-sidebar-foreground h-5 w-5 flex-shrink-0" />,
    },
  ]

  return (
    <div className="fixed left-0 top-16 z-40 h-[calc(100vh-4rem)]">
      <SidebarContainer open={open} setOpen={setOpen}>
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
                {open && <span className="text-sm">Sign out</span>}
              </Button>
            </div>
          </div>
        </SidebarBody>
      </SidebarContainer>
    </div>
  )
}

export const Logo = () => {
  return (
    <Link href="/dashboard" className="font-normal flex space-x-2 items-center text-sm py-1 relative z-20">
      <Image src="/nexo-logo.png" alt="Dexo" width={120} height={36} className="h-9 w-auto" priority />
    </Link>
  )
}

export const LogoIcon = () => {
  return (
    <Link href="/dashboard" className="font-normal flex items-center justify-center text-sm py-1 relative z-20">
      <div className="h-10 w-10 bg-primary rounded-lg flex items-center justify-center flex-shrink-0">
        <span className="text-primary-foreground font-bold text-xl">D</span>
      </div>
    </Link>
  )
}
