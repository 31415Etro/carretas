// Estrutura do menu lateral (dados puros, testáveis). Os ícones são ligados no componente do menu pela chave `icon`.
// A fábrica produz carretas SOB ENCOMENDA, só por Ordens de Produção: Estoque (página), Serviços e Ordens de Serviço não aparecem no menu,
// mas as rotas, as tabelas e os históricos continuam existindo (links antigos funcionam e o acesso administrativo é preservado).

export type NavLeaf = { label: string; href: string; permission: string; icon: string; adminOnly?: boolean; /** rotas filhas que NÃO acendem este item (ficam com outro item) */ excludePrefixes?: string[] }
export type NavParent = { label: string; icon: string; children: NavLeaf[] }
export type NavEntry = NavLeaf | NavParent
export type NavGroup = { title: string; items: NavEntry[] }

export const isParent = (entry: NavEntry): entry is NavParent => "children" in entry

export const navGroups: NavGroup[] = [
  { title: "Visão geral", items: [
    { label: "Dashboard", href: "/dashboard", permission: "dashboard", icon: "dashboard" },
  ] },
  { title: "Comercial", items: [
    { label: "Comercial / CRM", href: "/comercial", permission: "comercial", icon: "crm" },
    { label: "Clientes & Fornecedores", href: "/clientes", permission: "comercial", icon: "clients" },
    { label: "Orçamentos", href: "/orcamento", permission: "orcamento", icon: "quotes" },
    { label: "Pedidos de venda", href: "/vendas", permission: "orcamento", icon: "sales" },
    { label: "Documentação veicular", href: "/documentacao", permission: "orcamento", icon: "documents" },
    { label: "Contratos", href: "/contratos", permission: "contratos", icon: "contracts" },
  ] },
  { title: "Operação", items: [
    { label: "Financeiro", href: "/financeiro", permission: "financeiro", icon: "finance" },
    { label: "Compras", href: "/compras", permission: "compras", icon: "purchases" },
    { label: "Estoque interno", icon: "inventory", children: [
      { label: "Matérias-primas", href: "/materias-primas", permission: "produtos_servicos", icon: "materials" },
      { label: "Kits e composições", href: "/kits", permission: "produtos_servicos", icon: "kits" },
      { label: "Produtos finais", href: "/produtos", permission: "produtos_servicos", icon: "products" },
    ] },
    { label: "Produção", icon: "production", children: [
      { label: "Produção e MRP", href: "/producao", permission: "estoque", icon: "mrp", excludePrefixes: ["/producao/esteira", "/producao/tablet"] },
      { label: "Esteira da fábrica", href: "/producao/esteira", permission: "estoque", icon: "line" },
      { label: "Tablet da fábrica", href: "/producao/tablet", permission: "chao_fabrica", icon: "tablet" },
    ] },
    { label: "Frota", href: "/frota", permission: "frota", icon: "fleet" },
    { label: "Máquinas e Equipamentos", href: "/maquinas", permission: "maquinas", icon: "machines" },
  ] },
  { title: "Sistema", items: [
    { label: "Relatórios", href: "/relatorios", permission: "relatorios", icon: "reports" },
    { label: "Logs do Sistema", href: "/logs-sistema", permission: "configuracoes", icon: "logs", adminOnly: true },
    { label: "Configurações", href: "/configuracoes", permission: "configuracoes", icon: "settings" },
  ] },
]

/** Rotas que saíram do menu mas continuam acessíveis (links antigos, históricos e operações de estoque acessadas por contexto). */
export const legacyRoutes = ["/estoque", "/servicos", "/ordens-servico"] as const

export type NavUser = { role?: string; permissions?: readonly string[] } | null | undefined

const allowed = (leaf: NavLeaf, user: NavUser) => {
  if (user?.role === "admin") return true
  if (leaf.adminOnly) return false
  return Boolean(user?.permissions?.includes(leaf.permission))
}

/** Itens que o usuário pode ver; grupos e menus expansíveis sem nenhum item visível somem. */
export function visibleNav(user: NavUser, groups: NavGroup[] = navGroups): NavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items
        .map((entry): NavEntry | null => {
          if (isParent(entry)) {
            const children = entry.children.filter((child) => allowed(child, user))
            return children.length ? { ...entry, children } : null
          }
          return allowed(entry, user) ? entry : null
        })
        .filter((entry): entry is NavEntry => entry !== null),
    }))
    .filter((group) => group.items.length)
}

export function isActive(leaf: NavLeaf, pathname: string) {
  const inside = pathname === leaf.href || pathname.startsWith(`${leaf.href}/`)
  if (!inside) return false
  return !(leaf.excludePrefixes || []).some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

export const allLeaves = (groups: NavGroup[] = navGroups): NavLeaf[] => groups.flatMap((group) => group.items.flatMap((entry) => (isParent(entry) ? entry.children : [entry])))
