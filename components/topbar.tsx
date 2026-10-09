"use client"

import { BrandMark } from "@/components/shell/brand-mark"
import Link from "next/link"
import { Bell, Building2, Check, ChevronsUpDown, LogOut, Settings } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useAuth } from "@/lib/auth-context"
import { getInitials } from "@/lib/utils"

export function Topbar() {
  const { user, companies, selectCompany, logout } = useAuth()

  const switchCompany = async (companyId: string) => {
    if (companyId === user?.company.id) return
    const result = await selectCompany(companyId)
    if (result.success) window.location.reload()
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center justify-between gap-3 px-3 md:h-16 md:px-6">
        <div className="flex min-w-0 items-center gap-3 md:gap-6">
          <BrandMark className="text-xl md:text-2xl" />
        </div>

        <div className="flex items-center gap-1 md:gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-9 w-9 justify-center gap-2 px-0 md:w-auto md:max-w-[320px] md:justify-between md:px-3" title={user?.company.tradeName || user?.company.name || "Trocar empresa"}>
                <Building2 className="h-4 w-4 shrink-0 text-primary" />
                <span className="hidden truncate text-sm md:block">{user?.company.tradeName || user?.company.name || "Empresa"}</span>
                <ChevronsUpDown className="hidden h-4 w-4 shrink-0 text-muted-foreground md:block" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel>Empresa ativa</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {companies.map((company) => (
                <DropdownMenuItem key={company.id} className="cursor-pointer gap-2" onClick={() => switchCompany(company.id)}>
                  <Check className={`h-4 w-4 ${company.id === user?.company.id ? "opacity-100" : "opacity-0"}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{company.tradeName || company.name}</span>
                    <span className="block text-xs text-muted-foreground">{company.cnpj || "CNPJ nao informado"}</span>
                  </span>
                </DropdownMenuItem>
              ))}
              {user?.role === "admin" && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild className="cursor-pointer">
                    <Link href="/configuracoes" prefetch={false}>Gerenciar empresas</Link>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon" className="relative h-9 w-9">
            <Bell className="h-4 w-4" />
            <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-primary" />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Avatar className="h-8 w-8 cursor-pointer ring-2 ring-transparent transition-all hover:ring-primary/20 md:h-9 md:w-9">
                <AvatarImage src="/placeholder-user.jpg" alt={user?.name || "User"} />
                <AvatarFallback className="bg-primary text-xs text-primary-foreground md:text-sm">
                  {user ? getInitials(user.name) : "US"}
                </AvatarFallback>
              </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium">{user?.name || "Usuário"}</p>
                  <p className="text-xs text-muted-foreground">{user?.email || ""}</p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild className="cursor-pointer">
                <Link href="/configuracoes" prefetch={false}>
                  <Settings className="mr-2 h-4 w-4" />
                  <span>Configurações</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="cursor-pointer text-destructive focus:text-destructive" onClick={logout}>
                <LogOut className="mr-2 h-4 w-4" />
                <span>Sair</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}
