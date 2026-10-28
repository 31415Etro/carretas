// Estrutura do menu lateral (dados puros, testáveis). Os ícones são ligados no componente do menu pela chave `icon`.
// A fábrica produz carretas SOB ENCOMENDA, só por Ordens de Produção. "Estoque" (matérias-primas, kits e produtos finais) e "Produção" (Produção e MRP, esteira e tablet) são páginas únicas com abas; a página antiga de estoque, Serviços e Ordens de Serviço não aparecem no menu,
// mas as rotas, as tabelas e os históricos continuam existindo (links antigos funcionam e o acesso administrativo é preservado).

export type NavLeaf = { label: string; href: string; permission: string; icon: string; adminOnly?: boolean; /** rotas filhas que NÃO acendem este item (ficam com outro item) */ excludePrefixes?: string[]; /** outras rotas que também acendem este item (ex.: páginas de detalhe) */ alsoPrefixes?: string[]; /** quem não tem `permission` mas tem esta, vê o mesmo item apontando para outra página (ex.: só o tablet da fábrica) */ alternate?: { permission: string; href: string } }
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
    { label: "Chassis", href: "/chassis", permission: "financeiro", icon: "chassis" },
    { label: "Compras", href: "/compras", permission: "compras", icon: "purchases" },
    { label: "Estoque", href: "/estoque-interno", permission: "produtos_servicos", icon: "inventory", alsoPrefixes: ["/materias-primas", "/kits", "/produtos"] },
    { label: "Produção", href: "/producao", permission: "estoque", icon: "production", alternate: { permission: "chao_fabrica", href: "/producao/tablet" } },
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
  return Boolean(user?.permissions?.includes(leaf.permission) || (leaf.alternate && user?.permissions?.includes(leaf.alternate.permission)))
}

/** O item aponta para a página principal; quem só tem a permissão alternativa vai direto para a página dela. */
const resolve = (leaf: NavLeaf, user: NavUser): NavLeaf => {
  if (leaf.alternate && user?.role !== "admin" && !user?.permissions?.includes(leaf.permission) && user?.permissions?.includes(leaf.alternate.permission)) return { ...leaf, href: leaf.alternate.href, alsoPrefixes: [...(leaf.alsoPrefixes || []), leaf.href] }
  return leaf
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
          return allowed(entry, user) ? resolve(entry, user) : null
        })
        .filter((entry): entry is NavEntry => entry !== null),
    }))
    .filter((group) => group.items.length)
}

export function isActive(leaf: NavLeaf, pathname: string) {
  const inside = [leaf.href, ...(leaf.alsoPrefixes || [])].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  if (!inside) return false
  return !(leaf.excludePrefixes || []).some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

export const allLeaves = (groups: NavGroup[] = navGroups): NavLeaf[] => groups.flatMap((group) => group.items.flatMap((entry) => (isParent(entry) ? entry.children : [entry])))
