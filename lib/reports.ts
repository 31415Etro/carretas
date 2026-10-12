// Módulo Relatórios: catálogo dos relatórios, períodos, filtros, agrupamento, ordenação, totais
// e agendamento. Funções puras (testáveis); a busca dos dados fica em reports-server.ts.

export type ColumnType = "text" | "int" | "number" | "money" | "percent" | "date"
export type ColumnDef = { key: string; label: string; type: ColumnType; total?: "sum" | "avg"; hidden?: boolean }
export type FilterDef = { key: string; label: string; type: "text" | "select" | "number"; column?: string; options?: string[]; default?: string; hint?: string }
export type Totals = Record<string, number>

export type ReportDef = {
  id: string
  module: string
  name: string
  description: string
  /** "range": usa o período informado; "snapshot": posição atual (o período não se aplica). */
  periodMode: "range" | "snapshot"
  periodHint: string
  columns: ColumnDef[]
  filters: FilterDef[]
  groupBy: string[]
  sort: { key: string; dir: "asc" | "desc" }
  /** Totais calculados a partir dos totais somados (ex.: margem % = margem / receita). */
  derive?: (totals: Totals) => Totals
}

/** Cada módulo exige a permissão de página correspondente (além de "relatorios"). */
export const reportModules = [
  { value: "financeiro", label: "Financeiro", permission: "financeiro" },
  { value: "estoque", label: "Estoque", permission: "estoque" },
  { value: "produtos", label: "Produtos", permission: "produtos_servicos" },
  { value: "os", label: "Serviços / OS", permission: "ordens_servico" },
  { value: "frota", label: "Frota", permission: "frota" },
  { value: "comercial", label: "Comercial", permission: "comercial" },
  { value: "orcamentos", label: "Orçamentos", permission: "orcamento" },
  { value: "contratos", label: "Contratos", permission: "contratos" },
] as const

export const reportFormats = ["PDF", "Excel", "CSV"] as const
export type ReportFormat = (typeof reportFormats)[number]
export const periodKinds = ["Mês atual", "Mês anterior", "Últimos 30 dias", "Últimos 90 dias", "Trimestre atual", "Ano atual", "Personalizado"] as const
export const frequencies = ["Sob demanda", "Diária", "Semanal", "Mensal"] as const

const col = (key: string, label: string, type: ColumnType, extra: Partial<ColumnDef> = {}): ColumnDef => ({ key, label, type, ...extra })
const money = (key: string, label: string, total: ColumnDef["total"] = "sum") => col(key, label, "money", { total })
const text = (key: string, label: string, hidden = false) => col(key, label, "text", { hidden })
const date = (key: string, label: string) => col(key, label, "date")
const pct = (key: string, label: string) => col(key, label, "percent")
const int = (key: string, label: string, total: ColumnDef["total"] = "sum") => col(key, label, "int", { total })
const num = (key: string, label: string, total: ColumnDef["total"] = "sum") => col(key, label, "number", { total })
const monthCol = (key = "month", label = "Mês") => text(key, label, true)
const ratio = (a: number, b: number) => (b ? Math.round((a / b) * 10000) / 100 : 0)

const titleFilters = (statusOptions: string[], party: { key: string; label: string }): FilterDef[] => [
  { key: "status", label: "Situação", type: "select", column: "status", options: statusOptions },
  { key: "party", label: party.label, type: "text", column: party.key },
]

export const reportCatalog: ReportDef[] = [
  // ---------------- Financeiro
  { id: "fin_pagar", module: "financeiro", name: "Contas a pagar", description: "Títulos a pagar com vencimento no período, pagos e em aberto.", periodMode: "range", periodHint: "Vencimento no período",
    columns: [date("dueDate", "Vencimento"), text("supplier", "Fornecedor"), text("description", "Descrição"), text("category", "Categoria"), text("document", "Documento"), text("installment", "Parcela"), money("amount", "Valor"), money("paid", "Pago"), money("open", "Em aberto"), text("status", "Situação"), text("origin", "Origem"), monthCol()],
    filters: titleFilters(["Aberta", "Vencida", "Parcialmente paga", "Paga", "Cancelada"], { key: "supplier", label: "Fornecedor contém" }), groupBy: ["supplier", "category", "status", "origin", "month"], sort: { key: "dueDate", dir: "asc" } },
  { id: "fin_receber", module: "financeiro", name: "Contas a receber", description: "Títulos a receber com vencimento no período, recebidos e em aberto.", periodMode: "range", periodHint: "Vencimento no período",
    columns: [date("dueDate", "Vencimento"), text("client", "Cliente"), text("description", "Descrição"), text("category", "Categoria"), text("document", "Documento"), text("installment", "Parcela"), money("amount", "Valor"), money("received", "Recebido"), money("open", "Em aberto"), text("status", "Situação"), text("origin", "Origem"), monthCol()],
    filters: titleFilters(["Aberta", "Vencida", "Parcialmente recebida", "Recebida", "Cancelada"], { key: "client", label: "Cliente contém" }), groupBy: ["client", "category", "status", "origin", "month"], sort: { key: "dueDate", dir: "asc" } },
  { id: "fin_fluxo", module: "financeiro", name: "Fluxo de caixa", description: "Entradas e saídas realizadas por mês e o previsto (títulos em aberto por vencimento).", periodMode: "range", periodHint: "Meses do período",
    columns: [col("sortDate", "Ordem", "date", { hidden: true }), text("month", "Mês"), money("inflow", "Entradas realizadas"), money("outflow", "Saídas realizadas"), money("balance", "Saldo realizado"), money("expectedIn", "A receber (previsto)"), money("expectedOut", "A pagar (previsto)"), money("expectedBalance", "Saldo previsto"), col("accumulated", "Saldo acumulado (realizado + previsto)", "money")],
    filters: [], groupBy: [], sort: { key: "sortDate", dir: "asc" } },
  { id: "fin_receitas_despesas", module: "financeiro", name: "Receitas e despesas", description: "Lançamentos realizados no período, por categoria.", periodMode: "range", periodHint: "Data de realização no período",
    columns: [date("date", "Data"), text("kind", "Tipo"), text("description", "Descrição"), text("category", "Categoria"), text("party", "Fornecedor / origem"), text("origin", "Origem"), money("value", "Valor"), money("signed", "Resultado (+/-)"), monthCol()],
    filters: [{ key: "kind", label: "Tipo", type: "select", column: "kind", options: ["Receita", "Despesa"] }, { key: "category", label: "Categoria contém", type: "text", column: "category" }], groupBy: ["kind", "category", "month", "origin"], sort: { key: "date", dir: "asc" } },
  { id: "fin_dre", module: "financeiro", name: "DRE gerencial", description: "Resultado do período pelas contas da DRE (lançamentos realizados): receitas, custos, despesas e resultado.", periodMode: "range", periodHint: "Data de realização no período",
    columns: [text("account", "Conta da DRE"), text("kind", "Natureza"), int("entries", "Lançamentos"), money("value", "Valor"), pct("share", "% da receita")],
    filters: [{ key: "kind", label: "Natureza", type: "select", column: "kind", options: ["Receita", "Despesa"] }], groupBy: ["kind"], sort: { key: "kind", dir: "asc" } },

  // ---------------- Estoque
  { id: "est_posicao", module: "estoque", name: "Posição atual do estoque", description: "Saldo, reservas, disponível e valor em estoque por produto.", periodMode: "snapshot", periodHint: "Posição atual",
    columns: [text("code", "Código"), text("product", "Produto"), text("category", "Categoria"), text("unit", "Un."), num("stock", "Saldo"), num("reserved", "Reservado"), num("available", "Disponível"), money("averageCost", "Custo médio", "avg"), money("value", "Valor em estoque"), num("minimum", "Mínimo", "avg"), text("situation", "Situação")],
    filters: [{ key: "category", label: "Categoria contém", type: "text", column: "category" }, { key: "product", label: "Produto contém", type: "text", column: "product" }, { key: "situation", label: "Situação", type: "select", column: "situation", options: ["Normal", "Abaixo do mínimo", "Sem saldo"] }], groupBy: ["category", "situation"], sort: { key: "product", dir: "asc" } },
  { id: "est_movimentacao", module: "estoque", name: "Movimentação de estoque", description: "Entradas, saídas, transferências e ajustes do período.", periodMode: "range", periodHint: "Data da movimentação",
    columns: [date("date", "Data"), text("product", "Produto"), text("type", "Tipo"), num("quantity", "Quantidade"), text("from", "Origem"), text("to", "Destino"), money("unitCost", "Custo unit.", "avg"), money("total", "Custo total"), text("responsible", "Responsável"), text("document", "Documento"), monthCol()],
    filters: [{ key: "type", label: "Tipo", type: "select", column: "type", options: ["Saldo inicial", "Entrada por compra", "Saida por venda", "Consumo em OS", "Consumo em kit", "Transferencia", "Devolucao", "Ajuste de inventario", "Perda"] }, { key: "product", label: "Produto contém", type: "text", column: "product" }], groupBy: ["type", "product", "month", "responsible"], sort: { key: "date", dir: "desc" } },
  { id: "est_inventario", module: "estoque", name: "Inventário por depósito", description: "Lista de conferência: saldo do sistema por depósito, com colunas para a contagem física.", periodMode: "snapshot", periodHint: "Posição atual",
    columns: [text("warehouse", "Depósito"), text("code", "Código"), text("product", "Produto"), text("unit", "Un."), num("quantity", "Saldo do sistema"), text("count", "Contagem física"), text("difference", "Diferença")],
    filters: [{ key: "warehouse", label: "Depósito contém", type: "text", column: "warehouse" }, { key: "product", label: "Produto contém", type: "text", column: "product" }], groupBy: ["warehouse"], sort: { key: "product", dir: "asc" } },
  { id: "est_giro", module: "estoque", name: "Giro de estoque", description: "Saídas do período contra o estoque atual: giro e cobertura em dias.", periodMode: "range", periodHint: "Saídas no período",
    columns: [text("code", "Código"), text("product", "Produto"), text("category", "Categoria"), num("out", "Saídas no período"), num("stock", "Estoque atual"), num("turnover", "Giro (saídas ÷ estoque)", "avg"), num("coverageDays", "Cobertura (dias)", "avg"), money("outCost", "Custo das saídas")],
    filters: [{ key: "category", label: "Categoria contém", type: "text", column: "category" }, { key: "product", label: "Produto contém", type: "text", column: "product" }], groupBy: ["category"], sort: { key: "turnover", dir: "desc" } },
  { id: "est_baixo", module: "estoque", name: "Baixo estoque", description: "Produtos com saldo disponível no mínimo ou abaixo, com a quantidade e o valor para repor.", periodMode: "snapshot", periodHint: "Posição atual",
    columns: [text("code", "Código"), text("product", "Produto"), text("category", "Categoria"), num("stock", "Saldo"), num("reserved", "Reservado"), num("available", "Disponível"), num("minimum", "Mínimo"), num("reorderPoint", "Ponto de reposição"), num("missing", "Falta para o mínimo"), money("replenish", "Valor de reposição")],
    filters: [{ key: "category", label: "Categoria contém", type: "text", column: "category" }], groupBy: ["category"], sort: { key: "missing", dir: "desc" } },

  // ---------------- Produtos
  { id: "prod_vendas", module: "produtos", name: "Vendas por produto", description: "Itens de orçamentos formalizados (venda, OS ou contrato) no período, por produto/serviço.", periodMode: "range", periodHint: "Data da formalização do orçamento",
    columns: [text("item", "Produto / serviço"), text("type", "Tipo"), num("quantity", "Quantidade"), money("revenue", "Receita"), money("cost", "Custo"), money("margin", "Margem"), pct("marginPct", "Margem %"), int("quotes", "Orçamentos")],
    filters: [{ key: "type", label: "Tipo", type: "select", column: "type", options: ["Produto", "Serviço"] }, { key: "item", label: "Item contém", type: "text", column: "item" }], groupBy: ["type"], sort: { key: "revenue", dir: "desc" }, derive: (t) => ({ marginPct: ratio(t.margin, t.revenue) }) },
  { id: "prod_rentabilidade", module: "produtos", name: "Rentabilidade por produto", description: "Preço médio, custo médio e margem por produto/serviço vendido.", periodMode: "range", periodHint: "Data da formalização do orçamento",
    columns: [text("item", "Produto / serviço"), text("type", "Tipo"), num("quantity", "Quantidade"), money("avgPrice", "Preço médio", "avg"), money("avgCost", "Custo médio", "avg"), money("revenue", "Receita"), money("cost", "Custo"), money("margin", "Margem"), pct("marginPct", "Margem %")],
    filters: [{ key: "type", label: "Tipo", type: "select", column: "type", options: ["Produto", "Serviço"] }, { key: "item", label: "Item contém", type: "text", column: "item" }], groupBy: ["type"], sort: { key: "margin", dir: "desc" }, derive: (t) => ({ marginPct: ratio(t.margin, t.revenue) }) },
  { id: "prod_abc", module: "produtos", name: "Curva ABC de produtos", description: "Itens por receita no período: A (até 80% do acumulado), B (até 95%) e C.", periodMode: "range", periodHint: "Data da formalização do orçamento",
    columns: [col("rank", "Posição", "int"), text("item", "Produto / serviço"), text("type", "Tipo"), num("quantity", "Quantidade"), money("revenue", "Receita"), pct("share", "% da receita"), pct("accumulated", "% acumulado"), text("class", "Classe")],
    filters: [{ key: "type", label: "Tipo", type: "select", column: "type", options: ["Produto", "Serviço"] }, { key: "class", label: "Classe", type: "select", column: "class", options: ["A", "B", "C"] }], groupBy: ["class", "type"], sort: { key: "rank", dir: "asc" } },

  // ---------------- Serviços / OS
  { id: "os_status", module: "os", name: "OS por status", description: "Ordens de serviço abertas no período, com situação, prazos e valores.", periodMode: "range", periodHint: "Data de abertura",
    columns: [text("number", "OS"), text("client", "Cliente"), text("kind", "Tipo"), text("status", "Situação"), text("priority", "Prioridade"), date("openedAt", "Abertura"), date("dueDate", "Prazo"), date("finishedAt", "Conclusão"), money("total", "Valor"), monthCol()],
    filters: [{ key: "status", label: "Situação", type: "select", column: "status", options: ["Aberta", "Em análise", "Aguardando orçamento", "Aguardando aprovação", "Aguardando peças", "Em execução", "Em conferência", "Concluída", "Entregue", "Suspensa", "Cancelada"] }, { key: "kind", label: "Tipo", type: "text", column: "kind" }, { key: "client", label: "Cliente contém", type: "text", column: "client" }], groupBy: ["status", "kind", "client", "priority", "month"], sort: { key: "openedAt", dir: "desc" } },
  { id: "os_produtividade", module: "os", name: "Produtividade da equipe", description: "Por técnico: OS atendidas, concluídas, horas apontadas, custo e valor por hora.", periodMode: "range", periodHint: "Horas apontadas e OS abertas no período",
    columns: [text("technician", "Técnico"), int("orders", "OS como responsável"), int("finished", "OS concluídas"), num("hours", "Horas apontadas"), money("laborCost", "Custo de mão de obra"), money("billed", "Valor das OS concluídas"), money("perHour", "Valor por hora", "avg")],
    filters: [{ key: "technician", label: "Técnico contém", type: "text", column: "technician" }], groupBy: [], sort: { key: "hours", dir: "desc" } },
  { id: "os_rentabilidade", module: "os", name: "Custo e rentabilidade das OS", description: "OS concluídas no período: valor, custo (peças e mão de obra) e margem.", periodMode: "range", periodHint: "Data de conclusão",
    columns: [text("number", "OS"), text("client", "Cliente"), text("kind", "Tipo"), date("finishedAt", "Conclusão"), money("total", "Valor"), money("cost", "Custo"), money("margin", "Margem"), pct("marginPct", "Margem %"), num("hours", "Horas"), monthCol()],
    filters: [{ key: "kind", label: "Tipo", type: "text", column: "kind" }, { key: "client", label: "Cliente contém", type: "text", column: "client" }], groupBy: ["kind", "client", "month"], sort: { key: "finishedAt", dir: "desc" }, derive: (t) => ({ marginPct: ratio(t.margin, t.total) }) },
  { id: "os_tempo", module: "os", name: "Tempo de execução das OS", description: "Da abertura à conclusão: dias corridos, horas apontadas e atraso em relação ao prazo.", periodMode: "range", periodHint: "Data de conclusão",
    columns: [text("number", "OS"), text("client", "Cliente"), text("kind", "Tipo"), date("openedAt", "Abertura"), date("finishedAt", "Conclusão"), num("days", "Dias corridos", "avg"), num("hours", "Horas apontadas"), date("dueDate", "Prazo"), num("delay", "Atraso (dias)", "avg"), monthCol()],
    filters: [{ key: "kind", label: "Tipo", type: "text", column: "kind" }, { key: "client", label: "Cliente contém", type: "text", column: "client" }], groupBy: ["kind", "client", "month"], sort: { key: "finishedAt", dir: "desc" } },

  // ---------------- Frota
  { id: "frota_custo", module: "frota", name: "Custo por veículo", description: "Manutenção, combustível e contas a pagar vinculadas a cada veículo.", periodMode: "range", periodHint: "Data dos custos",
    columns: [text("fleetNumber", "Frota"), text("plate", "Placa"), text("vehicle", "Veículo"), money("maintenance", "Manutenção"), money("fuel", "Combustível"), money("payables", "Contas a pagar vinculadas"), money("total", "Custo total"), num("km", "Km rodados (abastecimentos)"), money("perKm", "Custo por km", "avg")],
    filters: [{ key: "vehicle", label: "Veículo contém", type: "text", column: "vehicle" }], groupBy: [], sort: { key: "total", dir: "desc" } },
  { id: "frota_manutencao", module: "frota", name: "Manutenções da frota", description: "Manutenções preventivas e corretivas do período, com custo e tempo parado.", periodMode: "range", periodHint: "Data da manutenção",
    columns: [date("date", "Data"), text("vehicle", "Veículo"), text("type", "Tipo"), text("service", "Serviço"), text("workshop", "Oficina"), money("parts", "Peças"), money("labor", "Mão de obra"), money("total", "Total"), num("downtime", "Parado (h)"), text("status", "Situação"), monthCol()],
    filters: [{ key: "type", label: "Tipo", type: "select", column: "type", options: ["Preventiva", "Corretiva"] }, { key: "status", label: "Situação", type: "select", column: "status", options: ["Programada", "Em andamento", "Realizada", "Cancelada"] }, { key: "vehicle", label: "Veículo contém", type: "text", column: "vehicle" }], groupBy: ["vehicle", "type", "status", "month"], sort: { key: "date", dir: "desc" } },
  { id: "frota_abastecimento", module: "frota", name: "Abastecimentos", description: "Abastecimentos do período por veículo, combustível e posto.", periodMode: "range", periodHint: "Data do abastecimento",
    columns: [date("date", "Data"), text("vehicle", "Veículo"), text("driver", "Motorista"), text("station", "Posto"), text("fuel", "Combustível"), num("liters", "Litros"), money("price", "R$/L", "avg"), money("total", "Total"), num("odometer", "Km", "avg"), monthCol()],
    filters: [{ key: "fuel", label: "Combustível", type: "text", column: "fuel" }, { key: "vehicle", label: "Veículo contém", type: "text", column: "vehicle" }], groupBy: ["vehicle", "fuel", "station", "month"], sort: { key: "date", dir: "desc" } },
  { id: "frota_disponibilidade", module: "frota", name: "Disponibilidade da frota", description: "Situação atual e tempo parado em manutenção no período, por veículo.", periodMode: "range", periodHint: "Paradas no período",
    columns: [text("fleetNumber", "Frota"), text("plate", "Placa"), text("vehicle", "Veículo"), text("status", "Situação atual"), int("stops", "Paradas no período"), num("downtimeHours", "Horas paradas"), pct("availability", "Disponibilidade %")],
    filters: [{ key: "status", label: "Situação atual", type: "text", column: "status" }, { key: "vehicle", label: "Veículo contém", type: "text", column: "vehicle" }], groupBy: ["status"], sort: { key: "availability", dir: "asc" } },

  // ---------------- Comercial
  { id: "com_funil", module: "comercial", name: "Funil de vendas", description: "Oportunidades por etapa: quantidade, valor e valor ponderado pela probabilidade.", periodMode: "snapshot", periodHint: "Posição atual do funil",
    columns: [col("order", "Ordem", "int", { hidden: true }), text("stage", "Etapa"), int("count", "Oportunidades"), money("value", "Valor"), money("weighted", "Valor ponderado")],
    filters: [{ key: "seller", label: "Vendedor contém", type: "text" }], groupBy: [], sort: { key: "order", dir: "asc" } },
  { id: "com_vendas_vendedor", module: "comercial", name: "Vendas por vendedor", description: "Ganhas, perdidas, em aberto, conversão e ticket médio por vendedor.", periodMode: "range", periodHint: "Data de encerramento (ganhas/perdidas)",
    columns: [text("seller", "Vendedor"), int("won", "Ganhas"), money("wonValue", "Valor ganho"), money("commission", "Comissão estimada"), int("lost", "Perdidas"), int("open", "Em aberto"), money("openValue", "Valor em aberto"), pct("conversion", "Conversão %"), money("ticket", "Ticket médio", "avg")],
    filters: [{ key: "seller", label: "Vendedor contém", type: "text", column: "seller" }], groupBy: [], sort: { key: "wonValue", dir: "desc" }, derive: (t) => ({ conversion: ratio(t.won, t.won + t.lost), ticket: t.won ? Math.round((t.wonValue / t.won) * 100) / 100 : 0 }) },
  { id: "com_conversao", module: "comercial", name: "Conversão por origem", description: "Oportunidades criadas no período por origem do lead e quanto converteu.", periodMode: "range", periodHint: "Data de criação",
    columns: [text("origin", "Origem"), int("created", "Criadas"), int("won", "Ganhas"), int("lost", "Perdidas"), int("open", "Em aberto"), pct("conversion", "Conversão %"), money("wonValue", "Valor ganho")],
    filters: [{ key: "origin", label: "Origem contém", type: "text", column: "origin" }], groupBy: [], sort: { key: "created", dir: "desc" }, derive: (t) => ({ conversion: ratio(t.won, t.won + t.lost) }) },
  { id: "com_clientes_inativos", module: "comercial", name: "Clientes inativos", description: "Clientes ativos sem OS, orçamento ou título há mais de N dias.", periodMode: "snapshot", periodHint: "Posição atual",
    columns: [text("client", "Cliente"), text("document", "CPF/CNPJ"), text("phone", "Telefone"), text("seller", "Vendedor"), date("lastDate", "Último movimento"), text("lastKind", "Tipo do último movimento"), int("daysInactive", "Dias sem movimento", "avg")],
    filters: [{ key: "days", label: "Sem movimento há mais de (dias)", type: "number", default: "180" }, { key: "seller", label: "Vendedor contém", type: "text", column: "seller" }], groupBy: ["seller", "lastKind"], sort: { key: "daysInactive", dir: "desc" } },

  // ---------------- Orçamentos
  { id: "orc_lista", module: "orcamentos", name: "Orçamentos enviados, aprovados e recusados", description: "Orçamentos emitidos no período (versões vigentes), com situação e valores.", periodMode: "range", periodHint: "Data de emissão",
    columns: [text("number", "Orçamento"), text("client", "Cliente"), text("seller", "Vendedor"), text("type", "Tipo"), date("issueDate", "Emissão"), date("validUntil", "Validade"), money("total", "Total"), text("status", "Situação"), date("sentAt", "Enviado em"), date("approvedAt", "Aprovado em"), monthCol()],
    filters: [{ key: "status", label: "Situação", type: "select", column: "status", options: ["Rascunho", "Enviado", "Aprovado", "Recusado", "Expirado", "Convertido", "Cancelado"] }, { key: "seller", label: "Vendedor contém", type: "text", column: "seller" }, { key: "client", label: "Cliente contém", type: "text", column: "client" }], groupBy: ["status", "seller", "client", "type", "month"], sort: { key: "issueDate", dir: "desc" } },
  { id: "orc_conversao", module: "orcamentos", name: "Taxa de conversão de orçamentos", description: "Por vendedor: enviados, aprovados, recusados, expirados e a taxa de aprovação.", periodMode: "range", periodHint: "Data de emissão",
    columns: [text("seller", "Vendedor"), int("issued", "Emitidos"), int("sent", "Enviados"), int("approved", "Aprovados"), int("refused", "Recusados"), int("expired", "Expirados"), money("sentValue", "Valor enviado"), money("approvedValue", "Valor aprovado"), pct("approvalRate", "Taxa de aprovação %")],
    filters: [{ key: "seller", label: "Vendedor contém", type: "text", column: "seller" }], groupBy: [], sort: { key: "approvedValue", dir: "desc" }, derive: (t) => ({ approvalRate: ratio(t.approved, t.approved + t.refused + t.expired) }) },

  // ---------------- Contratos
  { id: "ctr_vigentes", module: "contratos", name: "Contratos vigentes", description: "Contratos vigentes e suspensos, com vigência, valores e responsável.", periodMode: "snapshot", periodHint: "Posição atual",
    columns: [text("number", "Contrato"), text("type", "Tipo"), text("direction", "Natureza"), text("title", "Título"), text("party", "Parte"), date("start", "Início"), date("end", "Término"), money("total", "Valor total"), money("recurring", "Recorrente"), text("periodicity", "Periodicidade"), text("responsible", "Responsável"), text("status", "Situação")],
    filters: [{ key: "direction", label: "Natureza", type: "select", column: "direction", options: ["Receita", "Despesa"] }, { key: "type", label: "Tipo", type: "text", column: "type" }, { key: "party", label: "Parte contém", type: "text", column: "party" }], groupBy: ["direction", "type", "responsible", "status"], sort: { key: "end", dir: "asc" } },
  { id: "ctr_vencendo", module: "contratos", name: "Contratos vencendo", description: "Contratos vigentes que terminam nos próximos N dias, com prazo de aviso prévio e reajuste.", periodMode: "snapshot", periodHint: "Próximos dias",
    columns: [text("number", "Contrato"), text("title", "Título"), text("party", "Parte"), date("end", "Término"), int("daysLeft", "Dias restantes", "avg"), int("noticeDays", "Aviso prévio (dias)", "avg"), date("noticeDate", "Limite do aviso"), text("autoRenew", "Renova sozinho"), date("adjustment", "Próximo reajuste"), money("total", "Valor total"), text("responsible", "Responsável")],
    filters: [{ key: "days", label: "Terminam nos próximos (dias)", type: "number", default: "90" }, { key: "party", label: "Parte contém", type: "text", column: "party" }], groupBy: ["responsible"], sort: { key: "end", dir: "asc" } },
  { id: "ctr_encerrados", module: "contratos", name: "Contratos encerrados", description: "Contratos encerrados, rescindidos ou cancelados no período.", periodMode: "range", periodHint: "Data da última alteração de situação",
    columns: [text("number", "Contrato"), text("type", "Tipo"), text("title", "Título"), text("party", "Parte"), date("start", "Início"), date("end", "Término"), money("total", "Valor total"), text("status", "Situação"), text("reason", "Motivo"), date("changedAt", "Alterado em")],
    filters: [{ key: "status", label: "Situação", type: "select", column: "status", options: ["Encerrado", "Rescindido", "Cancelado"] }, { key: "party", label: "Parte contém", type: "text", column: "party" }], groupBy: ["status", "type"], sort: { key: "changedAt", dir: "desc" } },
  { id: "ctr_receita", module: "contratos", name: "Receita contratada", description: "Contratos de receita vigentes: equivalente mensal e anual, faturado no período e a faturar.", periodMode: "range", periodHint: "Faturamento no período",
    columns: [text("number", "Contrato"), text("party", "Cliente"), text("title", "Título"), text("periodicity", "Periodicidade"), money("recurring", "Valor recorrente"), money("monthly", "Equivalente mensal"), money("annual", "Projeção anual"), money("billedPeriod", "Faturado no período"), money("billedTotal", "Faturado total"), money("toBill", "A faturar (valor total - faturado)")],
    filters: [{ key: "party", label: "Cliente contém", type: "text", column: "party" }], groupBy: ["periodicity"], sort: { key: "monthly", dir: "desc" } },
]

export const reportById = (id: string) => reportCatalog.find((item) => item.id === id)
export const moduleOf = (value: string) => reportModules.find((item) => item.value === value)
export const reportPermission = (module: string) => moduleOf(module)?.permission || ""

/** Perfil pode ver relatórios do módulo se for administrador ou tiver "relatorios" e a permissão do módulo. */
export function canAccessReport(user: { role: string; permissions: string[] }, module: string) {
  if (user.role === "admin") return true
  return user.permissions.includes("relatorios") && user.permissions.includes(reportPermission(module))
}

// ---------------- Períodos

const iso = (date: Date) => date.toISOString().slice(0, 10)
const utc = (value: string) => new Date(`${value}T00:00:00Z`)

export function resolvePeriod(kind: string, today: string, custom?: { start?: string; end?: string }) {
  const now = utc(today)
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  const endOfMonth = (y: number, m: number) => iso(new Date(Date.UTC(y, m + 1, 0)))
  switch (kind) {
    case "Mês atual": return { start: iso(new Date(Date.UTC(year, month, 1))), end: endOfMonth(year, month) }
    case "Mês anterior": return { start: iso(new Date(Date.UTC(year, month - 1, 1))), end: endOfMonth(year, month - 1) }
    case "Últimos 30 dias": return { start: iso(new Date(now.getTime() - 29 * 86400000)), end: today }
    case "Últimos 90 dias": return { start: iso(new Date(now.getTime() - 89 * 86400000)), end: today }
    case "Trimestre atual": { const q = Math.floor(month / 3) * 3; return { start: iso(new Date(Date.UTC(year, q, 1))), end: endOfMonth(year, q + 2) } }
    case "Ano atual": return { start: `${year}-01-01`, end: `${year}-12-31` }
    default: return { start: custom?.start || `${year}-${String(month + 1).padStart(2, "0")}-01`, end: custom?.end || today }
  }
}

export const inRange = (value: unknown, start: string, end: string) => {
  const day = String(value || "").slice(0, 10)
  return Boolean(day) && day >= start && day <= end
}

export function monthKey(value: unknown) {
  const day = String(value || "").slice(0, 10)
  return day ? `${day.slice(5, 7)}/${day.slice(0, 4)}` : ""
}

// ---------------- Motor: filtros, ordenação, agrupamento e totais

export type Row = Record<string, any>
export type ReportOptions = { filters?: Record<string, string>; columns?: string[]; groupBy?: string; sortKey?: string; sortDir?: "asc" | "desc"; showTotals?: boolean }
export type ReportGroup = { label: string; rows: Row[]; subtotals: Totals }
export type ReportResult = { columns: ColumnDef[]; groups: ReportGroup[]; totals: Totals; rowCount: number; grouped: boolean }

const normalize = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()

export function applyFilters(rows: Row[], def: ReportDef, filters: Record<string, string> = {}) {
  return rows.filter((row) => def.filters.every((filter) => {
    const value = String(filters[filter.key] ?? "").trim()
    if (!value || !filter.column) return true
    if (filter.type === "select") return String(row[filter.column] ?? "") === value
    if (filter.type === "number") return Number(row[filter.column] || 0) >= Number(value)
    return normalize(row[filter.column]).includes(normalize(value))
  }))
}

const compare = (a: unknown, b: unknown, type: ColumnType) => {
  if (type === "text") return String(a ?? "").localeCompare(String(b ?? ""), "pt-BR", { numeric: true })
  if (type === "date") return String(a ?? "9999").localeCompare(String(b ?? "9999"))
  return Number(a ?? 0) - Number(b ?? 0)
}

export function sortRows(rows: Row[], def: ReportDef, key: string, dir: "asc" | "desc") {
  const column = def.columns.find((item) => item.key === key)
  const type = column?.type || "text"
  const factor = dir === "desc" ? -1 : 1
  return [...rows].sort((a, b) => factor * compare(a[key], b[key], type))
}

const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100

export function computeTotals(rows: Row[], def: ReportDef, columns: ColumnDef[]) {
  const totals: Totals = {}
  for (const column of def.columns) {
    if (!column.total) continue
    const values = rows.map((row) => Number(row[column.key])).filter((value) => Number.isFinite(value))
    totals[column.key] = column.total === "sum" ? round2(values.reduce((sum, value) => sum + value, 0)) : values.length ? round2(values.reduce((sum, value) => sum + value, 0) / values.length) : 0
  }
  const derived = def.derive ? def.derive(totals) : {}
  const visible = new Set(columns.map((column) => column.key))
  return Object.fromEntries(Object.entries({ ...totals, ...derived }).filter(([key]) => visible.has(key) || def.columns.some((column) => column.key === key && column.total))) as Totals
}

/** Aplica filtros, ordenação, agrupamento, colunas e totais ao resultado bruto do relatório. */
export function buildResult(def: ReportDef, rawRows: Row[], options: ReportOptions = {}): ReportResult {
  const filtered = applyFilters(rawRows, def, options.filters)
  const sorted = sortRows(filtered, def, options.sortKey || def.sort.key, options.sortDir || def.sort.dir)
  const chosen = options.columns?.length ? def.columns.filter((column) => options.columns!.includes(column.key)) : def.columns.filter((column) => !column.hidden)
  const columns = chosen.length ? chosen : def.columns.filter((column) => !column.hidden)
  const groupKey = options.groupBy && def.groupBy.includes(options.groupBy) ? options.groupBy : ""
  let groups: ReportGroup[]
  if (groupKey) {
    const order: string[] = []
    const buckets = new Map<string, Row[]>()
    for (const row of sorted) {
      const label = String(row[groupKey] ?? "").trim() || "(vazio)"
      if (!buckets.has(label)) { buckets.set(label, []); order.push(label) }
      buckets.get(label)!.push(row)
    }
    groups = order.map((label) => ({ label, rows: buckets.get(label)!, subtotals: computeTotals(buckets.get(label)!, def, columns) }))
  } else {
    groups = [{ label: "", rows: sorted, subtotals: {} }]
  }
  return { columns, groups, totals: options.showTotals === false ? {} : computeTotals(sorted, def, columns), rowCount: sorted.length, grouped: Boolean(groupKey) }
}

// ---------------- Formatação

export function formatCell(value: unknown, type: ColumnType) {
  if (value === null || value === undefined || value === "") return ""
  if (type === "money") return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
  if (type === "percent") return `${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`
  if (type === "number") return Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 3 })
  if (type === "int") return Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 0 })
  if (type === "date") return String(value).slice(0, 10).split("-").reverse().join("/")
  return String(value)
}

export function describeFilters(def: ReportDef, filters: Record<string, string> = {}) {
  return def.filters.filter((filter) => String(filters[filter.key] ?? "").trim()).map((filter) => `${filter.label}: ${filters[filter.key]}`).join(" · ")
}

/** CSV para Excel em português: separador ";", vírgula decimal, datas dd/mm/aaaa e BOM UTF-8. */
export function toCsv(result: ReportResult, meta: { title: string; periodLabel: string; filtersText: string }) {
  const esc = (value: unknown) => {
    const text = String(value ?? "")
    return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const cell = (value: unknown, type: ColumnType) => (type === "money" || type === "number" || type === "percent" || type === "int" ? (value === "" || value == null ? "" : String(Number(value)).replace(".", ",")) : type === "date" ? formatCell(value, "date") : String(value ?? ""))
  const lines: string[] = [esc(meta.title), esc(meta.periodLabel), ...(meta.filtersText ? [esc(meta.filtersText)] : []), ""]
  lines.push((result.grouped ? ["Grupo", ...result.columns.map((column) => column.label)] : result.columns.map((column) => column.label)).map(esc).join(";"))
  for (const group of result.groups) {
    for (const row of group.rows) lines.push((result.grouped ? [group.label, ...result.columns.map((column) => cell(row[column.key], column.type))] : result.columns.map((column) => cell(row[column.key], column.type))).map(esc).join(";"))
    if (result.grouped && Object.keys(group.subtotals).length) lines.push(["Subtotal " + group.label, ...result.columns.map((column) => (column.key in group.subtotals ? cell(group.subtotals[column.key], column.type) : ""))].map(esc).join(";"))
  }
  if (Object.keys(result.totals).length) lines.push([...(result.grouped ? ["TOTAL"] : []), ...result.columns.map((column, index) => (column.key in result.totals ? cell(result.totals[column.key], column.type) : !result.grouped && index === 0 ? "TOTAL" : ""))].map(esc).join(";"))
  return `﻿${lines.join("\r\n")}\r\n`
}

// ---------------- Agendamento

export type Schedule = { frequency: string; weekday?: number; day?: number }

function addDays(value: string, days: number) {
  return iso(new Date(utc(value).getTime() + days * 86400000))
}

/** Próxima geração depois de `from` (inclusive "hoje" não conta). Semanal: weekday 0=domingo..6; Mensal: dia do mês (limitado ao fim do mês). */
export function nextRunDate(schedule: Schedule, from: string) {
  if (schedule.frequency === "Diária") return addDays(from, 1)
  if (schedule.frequency === "Semanal") {
    const target = Math.min(6, Math.max(0, Math.round(schedule.weekday ?? 1)))
    const current = utc(from).getUTCDay()
    return addDays(from, ((target - current + 7) % 7) || 7)
  }
  if (schedule.frequency === "Mensal") {
    const day = Math.min(31, Math.max(1, Math.round(schedule.day ?? 1)))
    const [year, month] = from.split("-").map(Number)
    const build = (y: number, m: number) => {
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
      return `${new Date(Date.UTC(y, m - 1, 1)).getUTCFullYear()}-${String(new Date(Date.UTC(y, m - 1, 1)).getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`
    }
    const thisMonth = build(year, month)
    return thisMonth > from ? thisMonth : build(year, month + 1)
  }
  return ""
}

export type SavedReportInput = {
  name: string
  module: string
  reportId: string
  periodKind: string
  startDate?: string
  endDate?: string
  format: string
  authorizedUserIds: string[]
  frequency: string
  weekday?: number
  day?: number
}

/** Mensagem de erro ou "" quando o relatório salvo é válido. */
export function validateSavedReport(input: SavedReportInput) {
  if (!input.name.trim()) return "Informe o nome do relatório."
  const def = reportById(input.reportId)
  if (!def) return "Escolha o relatório."
  if (def.module !== input.module) return "O relatório não pertence ao módulo informado."
  if (!(periodKinds as readonly string[]).includes(input.periodKind)) return "Informe o período."
  if (input.periodKind === "Personalizado" && def.periodMode === "range") {
    if (!input.startDate || !input.endDate) return "Informe as datas do período personalizado."
    if (input.endDate < input.startDate) return "O fim do período não pode ser anterior ao início."
  }
  if (!(reportFormats as readonly string[]).includes(input.format)) return "Escolha o formato: PDF, Excel ou CSV."
  if (!input.authorizedUserIds.length) return "Informe ao menos um usuário autorizado."
  if (!(frequencies as readonly string[]).includes(input.frequency)) return "Frequência inválida."
  if (input.frequency !== "Sob demanda" && input.periodKind === "Personalizado") return "Relatório agendado precisa de um período relativo (ex.: Mês anterior), não datas fixas."
  if (input.frequency === "Mensal" && !(Number(input.day) >= 1 && Number(input.day) <= 31)) return "Informe o dia do mês do agendamento."
  if (input.frequency === "Semanal" && !(Number(input.weekday) >= 0 && Number(input.weekday) <= 6)) return "Informe o dia da semana do agendamento."
  return ""
}
