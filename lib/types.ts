export type UserRole = "admin" | "sdr" | "closer" | "representative" | "manager" | "sd" | "client" | "user"

/** Permissões de página: cada uma libera um módulo do menu. */
export type PagePermission =
  | "dashboard"
  | "financeiro"
  | "estoque"
  | "compras"
  | "produtos_servicos"
  | "ordens_servico"
  | "frota"
  | "clientes"
  | "comercial"
  | "orcamento"
  | "contratos"
  | "relatorios"
  | "configuracoes"

export const systemPagePermissions: PagePermission[] = [
  "dashboard",
  "financeiro",
  "estoque",
  "compras",
  "produtos_servicos",
  "ordens_servico",
  "frota",
  "clientes",
  "comercial",
  "orcamento",
  "contratos",
  "relatorios",
  "configuracoes",
]

export const pagePermissionLabels: Record<PagePermission, string> = {
  dashboard: "Dashboard",
  financeiro: "Financeiro",
  estoque: "Estoque",
  compras: "Compras",
  produtos_servicos: "Produtos / Serviços",
  ordens_servico: "Ordens de Serviço",
  frota: "Frota",
  clientes: "Clientes e Fornecedores",
  comercial: "Comercial",
  orcamento: "Orçamentos",
  contratos: "Contratos",
  relatorios: "Relatórios",
  configuracoes: "Configurações",
}
