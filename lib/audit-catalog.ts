// Módulos e tipos de ação da trilha de auditoria (sem dependências de servidor, usado também na tela).

export const auditModules: Array<{ value: string; label: string }> = [
  { value: "acesso", label: "Acesso e segurança" }, { value: "financeiro", label: "Financeiro" }, { value: "estoque", label: "Estoque" }, { value: "produtos", label: "Produtos / Serviços" },
  { value: "fiscal", label: "Configurações fiscais" }, { value: "os", label: "Ordens de serviço" }, { value: "compras", label: "Compras" }, { value: "comercial", label: "Comercial" },
  { value: "orcamentos", label: "Orçamentos" }, { value: "contratos", label: "Contratos" }, { value: "frota", label: "Frota" }, { value: "maquinas", label: "Máquinas e Equipamentos" }, { value: "usuarios", label: "Usuários e permissões" },
  { value: "configuracoes", label: "Configurações" }, { value: "relatorios", label: "Relatórios" }, { value: "integracoes", label: "Integrações" }, { value: "auditoria", label: "Auditoria" },
]

export const auditActions = [
  "Login", "Logout", "Acesso negado", "Criação", "Edição", "Exclusão", "Cancelamento", "Alteração de preço/desconto", "Baixa de título", "Alteração de título", "Movimentação de estoque", "Ajuste de estoque",
  "Alteração de permissões", "Criação de usuário", "Exclusão de usuário", "Alteração fiscal", "Alteração de configuração", "Exportação de dados", "Acesso administrativo", "Expurgo por retenção",
]
