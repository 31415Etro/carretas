// Indicadores do Dashboard ERP calculados a partir das linhas dos módulos.
// Funções puras (sem banco) para serem testadas e reaproveitadas no drill-down.

export type DashboardSection = "financeiro" | "estoque" | "os" | "frota" | "comercial"
export type DashboardFilters = { start: string; end: string; today: string; costCenterId?: string; providerId?: string }

export type DashboardData = {
  receivables: any[]
  payables: any[]
  transactions: any[]
  materials: any[]
  movements: any[]
  orders: any[]
  orderStarts: Record<string, string>
  vehicles: any[]
  maintenance: any[]
  fuel: any[]
  leads: any[]
  contracts: any[]
  categories?: Array<{ id: string; name: string }>
  names: { clients: Record<string, string>; providers: Record<string, string>; vehicles: Record<string, string>; salespeople?: Record<string, string> }
}

export type Indicator = { key: string; label: string; value: number; format: "money" | "number" | "percent" | "hours" | "times"; hint?: string; tone?: "good" | "bad" | "neutral" }
export type DetailTable = { title: string; columns: string[]; rows: Array<Array<string | number>>; href: string }
export type SeriesPoint = Record<string, string | number>
export type DashboardChart = {
  key: string
  title: string
  series: SeriesPoint[]
  bars: Array<{ key: string; label: string }>
  /** "bar" (padrão: segue a preferência do usuário), "hbar" (barras horizontais, ranking) ou "pie" (composição). */
  kind?: "bar" | "hbar" | "pie"
  /** Valores em reais ou contagens (define o formato dos eixos e dicas). */
  format?: "money" | "number"
  /** Ocupa a largura toda (séries de tempo com várias barras). */
  wide?: boolean
}
export type SectionResult = { indicators: Indicator[]; charts: DashboardChart[]; notes: string[] }

// Fluxo da OS das carretas + situações do sistema anterior.
const doneOrderStatuses = new Set(["Concluída", "Entregue", "Finalizada", "Finalizada parcialmente"])
const finalOrderStatuses = new Set([...doneOrderStatuses, "Cancelada"])
const openOrderStatuses = new Set(["Aberta", "Em análise", "Aguardando orçamento", "Aguardando aprovação", "Criada", "Agendada"])
const runningOrderStatuses = new Set(["Aguardando peças", "Em execução", "Em conferência", "Suspensa", "A caminho", "Em execucao", "Pausada", "Aguardando material", "Aguardando retorno"])
const consumptionTypes = new Set(["Consumo em OS", "Consumo em kit", "Saida por venda", "Consumo em producao"])
const cogsTypes = new Set(["Consumo em OS", "Saida por venda"])
const leadStages = ["Novo lead", "Contato realizado", "Qualificação", "Orçamento", "Negociação", "Ganho", "Perdido"]

const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100
const day = (value?: string | null) => String(value || "").slice(0, 10)
const inPeriod = (value: string | null | undefined, filters: DashboardFilters) => {
  const date = day(value)
  return Boolean(date) && date >= filters.start && date <= filters.end
}
const br = (value?: string | null) => day(value) ? day(value).split("-").reverse().join("/") : "-"
const money = (value: number) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const sum = <T>(rows: T[], value: (row: T) => number) => round2(rows.reduce((total, row) => total + (Number(value(row)) || 0), 0))
const settlement = (row: any) => Number(row.expected_amount || 0) + Number(row.interest_amount || 0) + Number(row.fine_amount || 0) - Number(row.discount_amount || 0)

function addDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function monthsBetween(start: string, end: string) {
  const months: string[] = []
  let year = Number(start.slice(0, 4))
  let month = Number(start.slice(5, 7))
  const last = end.slice(0, 7)
  while (`${year}-${String(month).padStart(2, "0")}` <= last && months.length < 36) {
    months.push(`${year}-${String(month).padStart(2, "0")}`)
    month += 1
    if (month > 12) { month = 1; year += 1 }
  }
  return months
}

const monthLabel = (key: string) => `${key.slice(5, 7)}/${key.slice(2, 4)}`

export function scopeData(data: DashboardData, filters: DashboardFilters): DashboardData {
  const byCostCenter = (row: any) => !filters.costCenterId || row.cost_center_id === filters.costCenterId
  const byProvider = (row: any) => !filters.providerId || [row.main_provider_id, row.helper_provider_id, row.supervisor_id].includes(filters.providerId)
  return {
    ...data,
    receivables: data.receivables.filter(byCostCenter),
    payables: data.payables.filter(byCostCenter),
    transactions: data.transactions.filter(byCostCenter),
    orders: data.orders.filter(byProvider),
  }
}

export function buildDashboard(raw: DashboardData, filters: DashboardFilters) {
  const data = scopeData(raw, filters)
  const details: Record<string, DetailTable> = {}
  const sections: Partial<Record<DashboardSection, SectionResult>> = {}
  const client = (id?: string) => data.names.clients[id || ""] || "-"

  // ---------------- Financeiro
  {
    const validReceivables = data.receivables.filter((row) => row.status !== "Cancelada")
    const validPayables = data.payables.filter((row) => row.status !== "Cancelada")
    const billed = validReceivables.filter((row) => inPeriod(row.competence_date || row.due_date, filters))
    const realized = data.transactions.filter((row) => row.status === "Realizado" && inPeriod(row.realized_date, filters))
    const revenue = realized.filter((row) => row.type === "entrada")
    const expenses = realized.filter((row) => row.type === "saida")
    const openReceivables = validReceivables.filter((row) => Number(row.received_amount || 0) < settlement(row) - 0.005)
    const openPayables = validPayables.filter((row) => Number(row.paid_amount || 0) < settlement(row) - 0.005)
    const overdueReceivables = openReceivables.filter((row) => day(row.due_date) && day(row.due_date) < filters.today)
    const overduePayables = openPayables.filter((row) => day(row.due_date) && day(row.due_date) < filters.today)
    const cogsMovements = data.movements.filter((row) => cogsTypes.has(row.movement_type) && inPeriod(row.occurred_at, filters))
    const billedTotal = sum(billed, (row) => row.expected_amount)
    const cogs = sum(cogsMovements, (row) => row.total_cost)
    const openBalance = (row: any, field: string) => round2(settlement(row) - Number(row[field] || 0))

    details["fin.faturamento"] = { title: "Faturamento do período (contas a receber por competência)", href: "/financeiro", columns: ["Competência", "Cliente", "Descrição", "Documento", "Valor", "Situação"], rows: billed.map((row) => [br(row.competence_date || row.due_date), client(row.client_id), row.description, row.document_number || "-", money(row.expected_amount), row.status]) }
    details["fin.receitas"] = { title: "Receitas realizadas", href: "/financeiro", columns: ["Data", "Descrição", "Origem", "Valor"], rows: revenue.map((row) => [br(row.realized_date), row.description, row.origin || "-", money(row.realized_amount)]) }
    details["fin.despesas"] = { title: "Despesas realizadas", href: "/financeiro", columns: ["Data", "Descrição", "Fornecedor", "Valor"], rows: expenses.map((row) => [br(row.realized_date), row.description, row.supplier_name || "-", money(row.realized_amount)]) }
    details["fin.lucro"] = { title: "Custo das mercadorias/materiais (saídas e consumo em OS)", href: "/estoque", columns: ["Data", "Tipo", "Quantidade", "Custo"], rows: cogsMovements.map((row) => [br(row.occurred_at), row.movement_type, row.quantity, money(row.total_cost)]) }
    details["fin.receber"] = { title: "Contas a receber em aberto", href: "/financeiro", columns: ["Vencimento", "Cliente", "Descrição", "Em aberto", "Situação"], rows: openReceivables.map((row) => [br(row.due_date), client(row.client_id), row.description, money(openBalance(row, "received_amount")), row.status]) }
    details["fin.vencidas_receber"] = { title: "Contas a receber vencidas", href: "/financeiro", columns: ["Vencimento", "Cliente", "Descrição", "Em aberto"], rows: overdueReceivables.map((row) => [br(row.due_date), client(row.client_id), row.description, money(openBalance(row, "received_amount"))]) }
    details["fin.vencidas_pagar"] = { title: "Contas a pagar vencidas", href: "/financeiro", columns: ["Vencimento", "Fornecedor", "Descrição", "Em aberto"], rows: overduePayables.map((row) => [br(row.due_date), row.supplier_name || "-", row.description, money(openBalance(row, "paid_amount"))]) }

    const months = monthsBetween(filters.start, filters.end)
    const flow = months.map((key) => ({
      mes: monthLabel(key),
      entradasRealizadas: sum(revenue.filter((row) => day(row.realized_date).startsWith(key)), (row) => row.realized_amount),
      saidasRealizadas: sum(expenses.filter((row) => day(row.realized_date).startsWith(key)), (row) => row.realized_amount),
      entradasPrevistas: sum(openReceivables.filter((row) => day(row.due_date).startsWith(key)), (row) => openBalance(row, "received_amount")),
      saidasPrevistas: sum(openPayables.filter((row) => day(row.due_date).startsWith(key)), (row) => openBalance(row, "paid_amount")),
    }))

    // composição das despesas por categoria (as 7 maiores + "Outras")
    const categoryName = (id?: string) => data.categories?.find((item) => item.id === id)?.name || "Sem categoria"
    const expenseByCategory = new Map<string, number>()
    expenses.forEach((row) => { const name = categoryName(row.category_id); expenseByCategory.set(name, (expenseByCategory.get(name) || 0) + Number(row.realized_amount || 0)) })
    const rankedCategories = [...expenseByCategory.entries()].sort((a, b) => b[1] - a[1])
    const topCategories = rankedCategories.slice(0, 7).map(([categoria, valor]) => ({ categoria, valor: round2(valor) }))
    const otherCategories = round2(rankedCategories.slice(7).reduce((total, [, value]) => total + value, 0))
    if (otherCategories > 0) topCategories.push({ categoria: "Outras", valor: otherCategories })

    // contas em aberto por faixa de vencimento (a pagar x a receber)
    const bucketOf = (due: string) => {
      if (due < filters.today) return "Vencidas"
      if (due <= addDays(filters.today, 7)) return "Até 7 dias"
      if (due <= addDays(filters.today, 30)) return "8 a 30 dias"
      if (due <= addDays(filters.today, 60)) return "31 a 60 dias"
      return "Mais de 60 dias"
    }
    const bucketNames = ["Vencidas", "Até 7 dias", "8 a 30 dias", "31 a 60 dias", "Mais de 60 dias"]
    const dueChart = bucketNames.map((faixa) => ({
      faixa,
      pagar: sum(openPayables.filter((row) => day(row.due_date) && bucketOf(day(row.due_date)) === faixa), (row) => openBalance(row, "paid_amount")),
      receber: sum(openReceivables.filter((row) => day(row.due_date) && bucketOf(day(row.due_date)) === faixa), (row) => openBalance(row, "received_amount")),
    }))

    // faturamento por cliente (os 8 maiores)
    const billedByClient = new Map<string, number>()
    billed.forEach((row) => billedByClient.set(client(row.client_id), (billedByClient.get(client(row.client_id)) || 0) + Number(row.expected_amount || 0)))
    const topClients = [...billedByClient.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([cliente, valor]) => ({ cliente: cliente.slice(0, 26), valor: round2(valor) }))

    sections.financeiro = {
      indicators: [
        { key: "fin.faturamento", label: "Faturamento", value: billedTotal, format: "money", hint: "Contas a receber emitidas no período" },
        { key: "fin.receitas", label: "Receitas realizadas", value: sum(revenue, (row) => row.realized_amount), format: "money", tone: "good" },
        { key: "fin.despesas", label: "Despesas realizadas", value: sum(expenses, (row) => row.realized_amount), format: "money", tone: "bad" },
        { key: "fin.lucro", label: "Lucro bruto", value: round2(billedTotal - cogs), format: "money", hint: `Faturamento - custo dos materiais (${money(cogs)})` },
        { key: "fin.receber", label: "Contas a receber", value: sum(openReceivables, (row) => openBalance(row, "received_amount")), format: "money", hint: `${openReceivables.length} título(s) em aberto` },
        { key: "fin.vencidas_receber", label: "A receber vencidas", value: sum(overdueReceivables, (row) => openBalance(row, "received_amount")), format: "money", hint: `${overdueReceivables.length} título(s)`, tone: overdueReceivables.length ? "bad" : "neutral" },
        { key: "fin.vencidas_pagar", label: "A pagar vencidas", value: sum(overduePayables, (row) => openBalance(row, "paid_amount")), format: "money", hint: `${overduePayables.length} título(s)`, tone: overduePayables.length ? "bad" : "neutral" },
      ],
      charts: [{ key: "fin.fluxo", title: "Fluxo de caixa: previsto x realizado", series: flow, format: "money", wide: true, bars: [{ key: "entradasRealizadas", label: "Entradas realizadas" }, { key: "entradasPrevistas", label: "Entradas previstas" }, { key: "saidasRealizadas", label: "Saídas realizadas" }, { key: "saidasPrevistas", label: "Saídas previstas" }] },
        { key: "fin.vencimentos", title: "Contas em aberto por vencimento", series: dueChart, format: "money", bars: [{ key: "pagar", label: "A pagar" }, { key: "receber", label: "A receber" }] },
        { key: "fin.categorias", title: "Despesas realizadas por categoria", kind: "pie", format: "money", series: topCategories, bars: [{ key: "valor", label: "Despesas" }] },
        { key: "fin.clientes", title: "Faturamento por cliente (maiores)", kind: "hbar", format: "money", series: topClients, bars: [{ key: "valor", label: "Faturamento" }] },
      ],
      notes: [],
    }
  }

  // ---------------- Estoque
  {
    const active = data.materials.filter((row) => row.status !== "Inativo")
    const value = sum(active, (row) => Math.max(Number(row.current_stock || 0), 0) * Number(row.average_cost || 0))
    const available = (row: any) => Number(row.current_stock || 0) - Number(row.reserved_stock || 0)
    const below = active.filter((row) => {
      const trigger = Math.max(Number(row.reorder_point || 0), Number(row.minimum_stock || 0))
      return trigger > 0 && available(row) <= trigger
    })
    const consumption = data.movements.filter((row) => consumptionTypes.has(row.movement_type) && inPeriod(row.occurred_at, filters))
    const consumedCost = sum(consumption, (row) => row.total_cost)
    const byMaterial = new Map<string, { quantity: number; cost: number }>()
    consumption.forEach((row) => {
      const current = byMaterial.get(row.material_id) || { quantity: 0, cost: 0 }
      byMaterial.set(row.material_id, { quantity: current.quantity + Number(row.quantity || 0), cost: current.cost + Number(row.total_cost || 0) })
    })
    const material = (id: string) => data.materials.find((row) => row.id === id)
    const top = [...byMaterial.entries()].sort((a, b) => b[1].cost - a[1].cost).slice(0, 10)

    details["est.valor"] = { title: "Valor do estoque (saldo x custo médio)", href: "/estoque", columns: ["SKU", "Item", "Saldo", "Custo médio", "Valor"], rows: active.filter((row) => Number(row.current_stock || 0) > 0).sort((a, b) => b.current_stock * b.average_cost - a.current_stock * a.average_cost).map((row) => [row.internal_code || "-", row.name, `${row.current_stock} ${row.unit || ""}`, money(row.average_cost), money(row.current_stock * row.average_cost)]) }
    details["est.minimo"] = { title: "Itens abaixo do mínimo / no ponto de reposição", href: "/estoque", columns: ["SKU", "Item", "Disponível", "Mínimo", "Ponto de reposição"], rows: below.map((row) => [row.internal_code || "-", row.name, `${round2(available(row))} ${row.unit || ""}`, row.minimum_stock, row.reorder_point || 0]) }
    details["est.giro"] = { title: "Saídas do período (base do giro)", href: "/estoque", columns: ["Data", "Item", "Tipo", "Quantidade", "Custo"], rows: consumption.map((row) => [br(row.occurred_at), material(row.material_id)?.name || "-", row.movement_type, row.quantity, money(row.total_cost)]) }
    details["est.consumo"] = { title: "Materiais com maior consumo", href: "/estoque", columns: ["Item", "Quantidade", "Custo"], rows: top.map(([id, totals]) => [material(id)?.name || "-", `${round2(totals.quantity)} ${material(id)?.unit || ""}`, money(totals.cost)]) }

    const stockFlow = monthsBetween(filters.start, filters.end).map((key) => ({
      mes: monthLabel(key),
      entradas: sum(data.movements.filter((row) => day(row.occurred_at).startsWith(key) && String(row.movement_type || "").startsWith("Entrada")), (row) => row.total_cost),
      saidas: sum(data.movements.filter((row) => day(row.occurred_at).startsWith(key) && (consumptionTypes.has(row.movement_type) || String(row.movement_type || "").startsWith("Saida"))), (row) => row.total_cost),
    }))

    sections.estoque = {
      indicators: [
        { key: "est.valor", label: "Valor do estoque", value, format: "money" },
        { key: "est.minimo", label: "Abaixo do mínimo", value: below.length, format: "number", tone: below.length ? "bad" : "good" },
        { key: "est.giro", label: "Giro do estoque", value: value > 0 ? round2(consumedCost / value) : 0, format: "times", hint: `Custo das saídas ${money(consumedCost)} / valor do estoque` },
        { key: "est.consumo", label: "Custo consumido", value: consumedCost, format: "money", hint: "Consumo em OS, kits e vendas no período" },
      ],
      charts: [{ key: "est.top", title: "Materiais com maior consumo (custo)", series: top.map(([id, totals]) => ({ item: String(material(id)?.name || "-").slice(0, 24), custo: round2(totals.cost) })), kind: "hbar", format: "money", bars: [{ key: "custo", label: "Custo" }] },
        { key: "est.mensal", title: "Entradas x saídas de estoque (R$)", wide: true, format: "money", series: stockFlow, bars: [{ key: "entradas", label: "Entradas" }, { key: "saidas", label: "Saídas" }] },
      ],
      notes: [],
    }
  }

  // ---------------- OS
  {
    const orders = data.orders
    const open = orders.filter((row) => openOrderStatuses.has(row.status))
    const running = orders.filter((row) => runningOrderStatuses.has(row.status))
    const late = orders.filter((row) => !finalOrderStatuses.has(row.status) && day(row.scheduled_date) && day(row.scheduled_date) < filters.today)
    const done = orders.filter((row) => doneOrderStatuses.has(row.status) && inPeriod(row.finished_at, filters))
    const durations = done.map((row) => {
      const start = data.orderStarts[row.id] || row.created_at
      const hours = (new Date(row.finished_at).getTime() - new Date(start).getTime()) / 3_600_000
      return Number.isFinite(hours) && hours >= 0 ? hours : null
    }).filter((value): value is number => value !== null)
    const orderRow = (row: any) => [row.order_number, br(row.scheduled_date), client(row.client_id), data.names.providers[row.main_provider_id] || "-", row.status, money(row.total_amount)]
    const columns = ["OS", "Agendada", "Cliente", "Responsável", "Situação", "Valor"]
    details["os.abertas"] = { title: "OS abertas (abertas, em análise ou aguardando orçamento/aprovação)", href: "/ordens-servico", columns, rows: open.map(orderRow) }
    details["os.execucao"] = { title: "OS em andamento (aguardando peças, em execução, em conferência ou suspensas)", href: "/ordens-servico", columns, rows: running.map(orderRow) }
    details["os.atrasadas"] = { title: "OS atrasadas (agendamento vencido)", href: "/ordens-servico", columns, rows: late.map(orderRow) }
    details["os.concluidas"] = { title: "OS concluídas no período", href: "/ordens-servico", columns: [...columns, "Finalizada em"], rows: done.map((row) => [...orderRow(row), br(row.finished_at)]) }
    details["os.ticket"] = details["os.concluidas"]
    details["os.tempo"] = { title: "Tempo de execução das OS concluídas", href: "/ordens-servico", columns: ["OS", "Início", "Fim", "Horas"], rows: done.map((row) => { const start = data.orderStarts[row.id] || row.created_at; return [row.order_number, br(start), br(row.finished_at), round2((new Date(row.finished_at).getTime() - new Date(start).getTime()) / 3_600_000)] }) }

    const statusCounts = new Map<string, number>()
    orders.filter((row) => !finalOrderStatuses.has(row.status) || inPeriod(row.finished_at || row.cancelled_at, filters)).forEach((row) => statusCounts.set(row.status, (statusCounts.get(row.status) || 0) + 1))

    const osFlow = monthsBetween(filters.start, filters.end).map((key) => ({
      mes: monthLabel(key),
      abertas: orders.filter((row) => day(row.created_at).startsWith(key)).length,
      concluidas: orders.filter((row) => doneOrderStatuses.has(row.status) && day(row.finished_at).startsWith(key)).length,
    }))

    sections.os = {
      indicators: [
        { key: "os.abertas", label: "OS abertas", value: open.length, format: "number" },
        { key: "os.execucao", label: "OS em execução", value: running.length, format: "number" },
        { key: "os.atrasadas", label: "OS atrasadas", value: late.length, format: "number", tone: late.length ? "bad" : "good" },
        { key: "os.concluidas", label: "OS concluídas", value: done.length, format: "number", tone: "good" },
        { key: "os.ticket", label: "Ticket médio", value: done.length ? round2(sum(done, (row) => row.total_amount) / done.length) : 0, format: "money" },
        { key: "os.tempo", label: "Tempo médio de execução", value: durations.length ? round2(durations.reduce((a, b) => a + b, 0) / durations.length) : 0, format: "hours", hint: "Do início do serviço à finalização" },
      ],
      charts: [{ key: "os.status", title: "OS por situação", series: [...statusCounts.entries()].map(([status, total]) => ({ situacao: status, total })), kind: "pie", format: "number", bars: [{ key: "total", label: "OS" }] },
        { key: "os.mensal", title: "OS abertas x concluídas por mês", wide: true, format: "number", series: osFlow, bars: [{ key: "abertas", label: "Abertas" }, { key: "concluidas", label: "Concluídas" }] },
      ],
      notes: [],
    }
  }

  // ---------------- Frota
  {
    const active = data.vehicles.filter((row) => !["Inativo", "Vendido"].includes(row.status))
    const inMaintenance = active.filter((row) => row.status === "Em manutencao")
    const availableVehicles = active.filter((row) => row.status === "Disponivel")
    const maintenance = data.maintenance.filter((row) => inPeriod(row.start_date, filters))
    const vehiclePayables = data.payables.filter((row) => row.vehicle_id && row.status !== "Cancelada" && inPeriod(row.competence_date || row.due_date, filters))
    const costs = new Map<string, number>()
    maintenance.forEach((row) => costs.set(row.vehicle_id, (costs.get(row.vehicle_id) || 0) + Number(row.cost || 0) + Number(row.parts_cost || 0) + Number(row.labor_cost || 0)))
    data.fuel.filter((row) => inPeriod(row.fuel_date, filters)).forEach((row) => costs.set(row.vehicle_id, (costs.get(row.vehicle_id) || 0) + Number(row.total_amount || 0)))
    vehiclePayables.forEach((row) => costs.set(row.vehicle_id, (costs.get(row.vehicle_id) || 0) + Number(row.expected_amount || 0)))
    const limit = addDays(filters.today, 30)
    const due = [
      ...active.filter((row) => day(row.licensing_due_date) && day(row.licensing_due_date) <= limit).map((row) => ({ vehicle_id: row.id, what: "Licenciamento", date: day(row.licensing_due_date) })),
      ...data.maintenance.filter((row) => row.status === "Programada" && day(row.next_date || row.next_maintenance || row.start_date) && day(row.next_date || row.next_maintenance || row.start_date) <= limit).map((row) => ({ vehicle_id: row.vehicle_id, what: `Manutenção: ${row.maintenance_type || row.type || ""} ${row.service_description || ""}`.trim(), date: day(row.next_date || row.next_maintenance || row.start_date) })),
    ].sort((a, b) => a.date.localeCompare(b.date))
    const vehicle = (id: string) => data.names.vehicles[id] || "-"
    const vehicleRow = (row: any) => [row.plate || row.fleet_number, `${row.brand || ""} ${row.model || ""}`.trim(), row.status, br(row.licensing_due_date)]

    details["frota.ativos"] = { title: "Veículos ativos", href: "/frota", columns: ["Placa", "Veículo", "Situação", "Licenciamento"], rows: active.map(vehicleRow) }
    details["frota.manutencao"] = { title: "Veículos em manutenção", href: "/frota", columns: ["Placa", "Veículo", "Situação", "Licenciamento"], rows: inMaintenance.map(vehicleRow) }
    details["frota.disponibilidade"] = { title: "Veículos disponíveis", href: "/frota", columns: ["Placa", "Veículo", "Situação", "Licenciamento"], rows: availableVehicles.map(vehicleRow) }
    details["frota.custos"] = { title: "Custos por veículo no período (manutenções + combustível + contas a pagar vinculadas)", href: "/frota", columns: ["Veículo", "Custo"], rows: [...costs.entries()].sort((a, b) => b[1] - a[1]).map(([id, cost]) => [vehicle(id), money(cost)]) }
    details["frota.vencimentos"] = { title: "Vencimentos nos próximos 30 dias", href: "/frota", columns: ["Data", "Veículo", "Vencimento"], rows: due.map((row) => [br(row.date), vehicle(row.vehicle_id), row.what]) }

    const fleetFlow = monthsBetween(filters.start, filters.end).map((key) => ({
      mes: monthLabel(key),
      manutencao: sum(maintenance.filter((row) => day(row.start_date).startsWith(key)), (row) => Number(row.cost || 0) + Number(row.parts_cost || 0) + Number(row.labor_cost || 0)),
      combustivel: sum(data.fuel.filter((row) => day(row.fuel_date).startsWith(key)), (row) => row.total_amount),
      contas: sum(vehiclePayables.filter((row) => day(row.competence_date || row.due_date).startsWith(key)), (row) => row.expected_amount),
    }))

    sections.frota = {
      indicators: [
        { key: "frota.ativos", label: "Veículos ativos", value: active.length, format: "number" },
        { key: "frota.disponibilidade", label: "Disponibilidade", value: active.length ? round2((availableVehicles.length / active.length) * 100) : 0, format: "percent", hint: `${availableVehicles.length} disponível(is)` },
        { key: "frota.manutencao", label: "Em manutenção", value: inMaintenance.length, format: "number", tone: inMaintenance.length ? "bad" : "neutral" },
        { key: "frota.custos", label: "Custo da frota", value: round2([...costs.values()].reduce((a, b) => a + b, 0)), format: "money" },
        { key: "frota.vencimentos", label: "Vencimentos (30 dias)", value: due.length, format: "number", tone: due.length ? "bad" : "neutral" },
      ],
      charts: [{ key: "frota.custos", title: "Custo por veículo", series: [...costs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, cost]) => ({ veiculo: vehicle(id), custo: round2(cost) })), kind: "hbar", format: "money", bars: [{ key: "custo", label: "Custo" }] },
        { key: "frota.mensal", title: "Custo da frota por mês", wide: true, format: "money", series: fleetFlow, bars: [{ key: "manutencao", label: "Manutenção" }, { key: "combustivel", label: "Combustível" }, { key: "contas", label: "Contas vinculadas" }] },
      ],
      notes: [],
    }
  }

  // ---------------- Comercial
  {
    const leads = data.leads
    const proposals = leads.filter((row) => ["Orçamento", "Negociação"].includes(row.stage))
    const closedInPeriod = leads.filter((row) => ["Ganho", "Perdido"].includes(row.stage) && inPeriod(row.closed_at || row.updated_at, filters))
    const won = closedInPeriod.filter((row) => row.stage === "Ganho")
    const pipeline = leads.filter((row) => !["Ganho", "Perdido"].includes(row.stage))
    const sentContracts = data.contracts.filter((row) => row.status === "Aguardando assinatura")
    const leadRow = (row: any) => [row.title, data.names.clients[row.client_id] || "-", row.stage, money(row.estimated_value), br(row.updated_at)]
    const leadColumns = ["Negociação", "Cliente / lead", "Etapa", "Valor estimado", "Atualizado"]
    details["com.propostas"] = { title: "Propostas em andamento (orçamento e negociação) e contratos aguardando assinatura", href: "/comercial", columns: leadColumns, rows: [...proposals.map(leadRow), ...sentContracts.map((row) => [`Contrato ${row.contract_number}`, (row.direction === "Receita" ? data.names.clients[row.client_id] : "") || "-", row.status, money(row.total_value), br(row.updated_at)])] }
    details["com.conversao"] = { title: "Oportunidades encerradas no período", href: "/comercial", columns: leadColumns, rows: closedInPeriod.map(leadRow) }
    details["com.vendas"] = { title: "Oportunidades ganhas no período", href: "/comercial", columns: leadColumns, rows: won.map(leadRow) }
    details["com.funil"] = { title: "Oportunidades no funil", href: "/comercial", columns: leadColumns, rows: pipeline.map(leadRow) }

    const salesByMonth = monthsBetween(filters.start, filters.end).map((key) => ({
      mes: monthLabel(key),
      vendas: sum(won.filter((row) => day(row.closed_at || row.updated_at).startsWith(key)), (row) => row.estimated_value),
    }))

    sections.comercial = {
      indicators: [
        { key: "com.propostas", label: "Propostas enviadas", value: proposals.length + sentContracts.length, format: "number" },
        { key: "com.conversao", label: "Conversão", value: closedInPeriod.length ? round2((won.length / closedInPeriod.length) * 100) : 0, format: "percent", hint: `${won.length} ganha(s) de ${closedInPeriod.length} encerrada(s)` },
        { key: "com.vendas", label: "Vendas ganhas", value: sum(won, (row) => row.estimated_value), format: "money" },
        { key: "com.funil", label: "Oportunidades no funil", value: pipeline.length, format: "number", hint: money(sum(pipeline, (row) => row.estimated_value)) },
      ],
      charts: [{ key: "com.vendedor", title: "Vendas ganhas por vendedor (R$)", series: [...new Set(won.map((row) => row.salesperson_id))].map((id) => ({ vendedor: data.names.salespeople?.[id] || "-", vendas: round2(sum(won.filter((row) => row.salesperson_id === id), (item) => item.estimated_value)) })), kind: "hbar", format: "money", bars: [{ key: "vendas", label: "Vendas" }] }, { key: "com.mensal", title: "Vendas ganhas por mês (R$)", wide: true, format: "money", series: salesByMonth, bars: [{ key: "vendas", label: "Vendas" }] }, { key: "com.funil", title: "Funil de vendas", series: leadStages.map((stage) => ({ etapa: stage, oportunidades: leads.filter((row) => row.stage === stage).length })), kind: "hbar", format: "number", bars: [{ key: "oportunidades", label: "Oportunidades" }] }],
      notes: [],
    }
  }

  return { sections, details }
}
