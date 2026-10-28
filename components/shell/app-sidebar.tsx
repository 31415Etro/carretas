"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import {
  Activity, BarChart3, Building2, Calculator, Car, FileCheck2, Check, ChevronDown, ChevronsUpDown, ClipboardList, Cog, Factory, FileText, Landmark, LayoutDashboard, LogOut,
  MapPinned, Menu, Package, PackageCheck, PanelLeftClose, PanelLeftOpen, Receipt, Settings2, ShoppingCart, Tablet, Users, X,
  Boxes, Layers, Workflow, Truck,
} from "lucide-react"
import { BrandMark } from "@/components/shell/brand-mark"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useAuth } from "@/lib/auth-context"
import { cn, getInitials } from "@/lib/utils"
import { isActive, isParent, visibleNav, type NavLeaf } from "@/lib/navigation"

const icons: Record<string, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard, crm: MapPinned, clients: Users, quotes: Calculator, sales: Receipt, documents: FileCheck2, contracts: FileText, finance: Landmark, purchases: ShoppingCart,
  chassis: Truck, inventory: Package, materials: Boxes, kits: Layers, products: PackageCheck, production: Factory, mrp: Cog, line: Workflow, tablet: Tablet, fleet: Car, machines: Factory, reports: BarChart3, logs: Activity, settings: Settings2,
}
const iconOf = (key: string) => icons[key] || ClipboardList

const COLLAPSE_KEY = "nd-sidebar-collapsed"

export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    // sem escolha guardada: recolhe em telas médias (tablet) para sobrar espaço ao conteúdo
    const narrow = window.innerWidth < 1100
    try {
      const saved = localStorage.getItem(COLLAPSE_KEY)
      setCollapsed(saved === null ? narrow : saved === "1")
    } catch {
      setCollapsed(narrow)
    }
  }, [])
  const toggle = () => setCollapsed((current) => {
    const next = !current
    try { localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0") } catch { /* ignora */ }
    return next
  })
  return [collapsed, toggle] as const
}

/** Itens que o usuário pode ver (admin vê tudo; os demais, só o que tem permissão). */
function useVisibleGroups() {
  const { user } = useAuth()
  return visibleNav(user ? { role: user.role, permissions: user.permissions as readonly string[] } : null)
}

function CompanySwitcher({ collapsed }: { collapsed: boolean }) {
  const { user, companies, selectCompany } = useAuth()
  const switchCompany = async (companyId: string) => {
    if (companyId === user?.company.id) return
    const result = await selectCompany(companyId)
    if (result.success) window.location.reload()
  }
  const name = user?.company.tradeName || user?.company.name || "Empresa"
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={name}
          className={cn("flex w-full items-center gap-2.5 rounded-xl border border-border bg-[var(--brand-softer)] p-2 text-left transition-colors hover:border-primary/40 hover:bg-[var(--brand-soft)]/60", collapsed && "justify-center")}
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"><Building2 className="h-4 w-4" /></span>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Empresa ativa</span>
                <span className="block truncate text-sm font-medium text-foreground">{name}</span>
              </span>
              <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side={collapsed ? "right" : "bottom"} className="w-72">
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
  )
}

const OPEN_KEY = "nd-nav-open"

function NavLink({ item, pathname, collapsed, onNavigate, nested = false }: { item: NavLeaf; pathname: string; collapsed: boolean; onNavigate?: () => void; nested?: boolean }) {
  const active = isActive(item, pathname)
  const Icon = iconOf(item.icon)
  return (
    <Link
      href={item.href}
      prefetch={false}
      title={collapsed ? item.label : undefined}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={cn(
        "group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors duration-150",
        collapsed && "justify-center px-0",
        nested && !collapsed && "py-1.5 pl-9",
        active ? "bg-[var(--brand-soft)] text-[var(--brand-dark)]" : "text-slate-600 hover:bg-slate-100 hover:text-foreground",
      )}
    >
      {active && <span aria-hidden className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-primary" />}
      {(!nested || collapsed) && <Icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-primary" : "text-slate-500 group-hover:text-foreground")} />}
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  )
}

function Nav({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname() || ""
  const visible = useVisibleGroups()
  const [open, setOpen] = useState<Record<string, boolean>>({})
  useEffect(() => { try { setOpen(JSON.parse(localStorage.getItem(OPEN_KEY) || "{}")) } catch { /* sem armazenamento */ } }, [])
  const toggle = (label: string, current: boolean) => setOpen((state) => {
    const next = { ...state, [label]: !current }
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(next)) } catch { /* ignora */ }
    return next
  })
  return (
    <nav aria-label="Menu principal" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto py-1 pr-0.5">
      {visible.map((group) => (
        <div key={group.title}>
          {collapsed ? <div className="mx-3 mb-2 border-t border-border first:hidden" /> : <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">{group.title}</p>}
          <ul className="flex flex-col gap-0.5">
            {group.items.map((entry) => {
              if (!isParent(entry)) return <li key={entry.href}><NavLink item={entry} pathname={pathname} collapsed={collapsed} onNavigate={onNavigate} /></li>
              const hasActive = entry.children.some((child) => isActive(child, pathname))
              const expanded = hasActive || open[entry.label] === true
              const Icon = iconOf(entry.icon)
              // menu recolhido (só ícones): os subitens aparecem como ícones, sem o botão de expandir
              if (collapsed) return <li key={entry.label}><ul className="flex flex-col gap-0.5">{entry.children.map((child) => <li key={child.href}><NavLink item={child} pathname={pathname} collapsed onNavigate={onNavigate} /></li>)}</ul></li>
              return (
                <li key={entry.label}>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={`nav-${entry.label}`}
                    onClick={() => toggle(entry.label, expanded)}
                    className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors duration-150", hasActive ? "text-[var(--brand-dark)]" : "text-slate-600 hover:bg-slate-100 hover:text-foreground")}
                  >
                    <Icon className={cn("h-[18px] w-[18px] shrink-0", hasActive ? "text-primary" : "text-slate-500")} />
                    <span className="flex-1 truncate">{entry.label}</span>
                    <ChevronDown className={cn("h-4 w-4 shrink-0 text-slate-400 transition-transform", expanded && "rotate-180")} />
                  </button>
                  {expanded ? (
                    <ul id={`nav-${entry.label}`} className="mt-0.5 flex flex-col gap-0.5">
                      {entry.children.map((child) => <li key={child.href}><NavLink item={child} pathname={pathname} collapsed={false} onNavigate={onNavigate} nested /></li>)}
                    </ul>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

function UserCard({ collapsed }: { collapsed: boolean }) {
  const { user, logout } = useAuth()
  const role = user?.role === "admin" ? "Administrador" : "Colaborador"
  return (
    <div className="border-t border-border pt-3">
      <div className={cn("flex items-center gap-2.5 rounded-xl border border-border bg-slate-50/70 p-2", collapsed && "flex-col border-transparent bg-transparent p-0")} title={collapsed ? `${user?.name} · ${user?.email} · ${role}` : undefined}>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{user ? getInitials(user.name) : "US"}</span>
        {!collapsed && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium leading-tight text-foreground">{user?.name}</span>
            <span className="block truncate text-[11px] text-muted-foreground">{user?.email}</span>
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-primary">{role}</span>
          </span>
        )}
        <Button onClick={logout} variant="ghost" size="icon-sm" className="shrink-0 text-slate-500 hover:bg-red-50 hover:text-destructive" title="Sair" aria-label="Sair">
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

/** Menu lateral fixo (a partir de md): recolhe e expande por botão e lembra a escolha. */
export function DesktopSidebar({ collapsed, toggle }: { collapsed: boolean; toggle: () => void }) {
  return (
    <aside
      className={cn("app-sidebar fixed inset-y-0 left-0 z-40 hidden flex-col gap-4 border-r border-border bg-sidebar px-3 py-4 transition-[width] duration-200 ease-out md:flex", collapsed ? "w-[var(--sidebar-width-collapsed)]" : "w-[var(--sidebar-width)]")}
    >
      <div className={cn("flex items-center px-1", collapsed ? "flex-col gap-3" : "justify-between")}>
        {collapsed ? <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-sm font-bold text-primary-foreground">ND</span> : <BrandMark className="text-xl" />}
        <button type="button" onClick={toggle} aria-label={collapsed ? "Expandir menu" : "Recolher menu"} title={collapsed ? "Expandir menu" : "Recolher menu"} className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-foreground">
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>
      <CompanySwitcher collapsed={collapsed} />
      <Nav collapsed={collapsed} />
      <UserCard collapsed={collapsed} />
    </aside>
  )
}

/** Barra superior e gaveta do menu no celular e no tablet. */
export function MobileBar() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  useEffect(() => { setOpen(false) }, [pathname])
  return (
    <>
      <header className="app-mobilebar sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-sidebar px-4 md:hidden">
        <BrandMark className="text-lg" />
        <button type="button" onClick={() => setOpen(true)} aria-label="Abrir menu" className="grid h-9 w-9 place-items-center rounded-lg text-slate-600 hover:bg-slate-100"><Menu className="h-5 w-5" /></button>
      </header>
      {open && (
        <div className="fixed inset-0 z-[90] md:hidden">
          <button type="button" aria-label="Fechar menu" className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[17.5rem] max-w-[85vw] flex-col gap-4 bg-sidebar px-3 py-4 shadow-2xl">
            <div className="flex items-center justify-between px-1">
              <BrandMark className="text-xl" />
              <button type="button" onClick={() => setOpen(false)} aria-label="Fechar menu" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>
            </div>
            <CompanySwitcher collapsed={false} />
            <Nav collapsed={false} onNavigate={() => setOpen(false)} />
            <UserCard collapsed={false} />
          </aside>
        </div>
      )}
    </>
  )
}
