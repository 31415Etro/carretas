// Consultas de cada relatório: devolvem as linhas brutas do período; filtros, ordenação,
// agrupamento e totais são aplicados depois por buildResult (lib/reports.ts).

import type { createAdminClient } from "@/lib/supabase/server"
import { funnelStages, stageProbability } from "@/lib/commercial"
import { billingPeriodicities } from "@/lib/contracts"
import { loadSection } from "@/lib/config-server"
import { effectiveStatus } from "@/lib/quotes"
import { inRange, monthKey, type Row } from "@/lib/reports"
import { readAllPages } from "@/lib/supabase-pagination"

type Admin = ReturnType<typeof createAdminClient>
export type RunnerContext = { admin: Admin; start: string; end: string; today: string; params: Record<string, string> }
export type Runner = (context: RunnerContext) => Promise<Row[]>

const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100
const day = (value: unknown) => String(value || "").slice(0, 10)
const sum = <T>(items: T[], pick: (item: T) => number) => round2(items.reduce((total, item) => total + (Number(pick(item)) || 0), 0))
const all = (admin: Admin, table: string, select = "*") => readAllPages<any>((from, to) => admin.from(table).select(select).order("id").range(from, to))
const nameMap = async (admin: Admin, table: string, field = "name") => new Map<string, string>((await all(admin, table, `id,${field}`)).map((row) => [row.id as string, row[field] as string]))
const settlement = (row: any) => round2(Number(row.expected_amount || 0) + Number(row.interest_amount || 0) + Number(row.fine_amount || 0) - Number(row.discount_amount || 0))
const daysBetween = (from: string, to: string) => Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000)
const monthsIn = (start: string, end: string) => {
  const months: string[] = []
  const cursor = new Date(`${start.slice(0, 7)}-01T00:00:00Z`)
  while (cursor.toISOString().slice(0, 10) <= end && months.length < 60) {
    months.push(cursor.toISOString().slice(0, 7))
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  return months
}

function titleStatus(row: any, settled: number, today: string, labels: { paid: string; partial: string }) {
  if (row.status === "Cancelada") return "Cancelada"
  const due = settlement(row)
  if (due > 0 && settled >= due - 0.005) return labels.paid
  if (settled > 0) return labels.partial
  return day(row.due_date) && day(row.due_date) < today ? "Vencida" : "Aberta"
}

// ---------------- Financeiro

const payables: Runner = async ({ admin, start, end, today }) => {
  const [rows, categories] = await Promise.all([all(admin, "accounts_payable"), nameMap(admin, "financial_categories")])
  return rows.filter((row) => inRange(row.due_date, start, end)).map((row) => {
    const paid = Number(row.paid_amount || 0)
    return { dueDate: day(row.due_date), supplier: row.supplier_name || "-", description: row.description, category: categories.get(row.category_id) || "", document: row.document_number || "", installment: row.installment_count ? `${row.installment_number}/${row.installment_count}` : "", amount: settlement(row), paid, open: row.status === "Cancelada" ? 0 : Math.max(round2(settlement(row) - paid), 0), status: titleStatus(row, paid, today, { paid: "Paga", partial: "Parcialmente paga" }), origin: row.origin || "", month: monthKey(row.due_date) }
  })
}

const receivables: Runner = async ({ admin, start, end, today }) => {
  const [rows, categories, clients] = await Promise.all([all(admin, "accounts_receivable"), nameMap(admin, "financial_categories"), nameMap(admin, "clients")])
  return rows.filter((row) => inRange(row.due_date, start, end)).map((row) => {
    const received = Number(row.received_amount || 0)
    return { dueDate: day(row.due_date), client: clients.get(row.client_id) || "-", description: row.description, category: categories.get(row.category_id) || "", document: row.document_number || "", installment: row.installment_count ? `${row.installment_number}/${row.installment_count}` : "", amount: settlement(row), received, open: row.status === "Cancelada" ? 0 : Math.max(round2(settlement(row) - received), 0), status: titleStatus(row, received, today, { paid: "Recebida", partial: "Parcialmente recebida" }), origin: row.origin || "", month: monthKey(row.due_date) }
  })
}

const cashFlow: Runner = async ({ admin, start, end }) => {
  const [transactions, receivableRows, payableRows] = await Promise.all([all(admin, "financial_transactions"), all(admin, "accounts_receivable"), all(admin, "accounts_payable")])
  const realized = transactions.filter((row) => row.status === "Realizado")
  let accumulated = 0
  return monthsIn(start, end).map((month) => {
    const inflow = sum(realized.filter((row) => row.type === "entrada" && day(row.realized_date).startsWith(month)), (row) => row.realized_amount)
    const outflow = sum(realized.filter((row) => row.type === "saida" && day(row.realized_date).startsWith(month)), (row) => row.realized_amount)
    const expectedIn = sum(receivableRows.filter((row) => row.status !== "Cancelada" && day(row.due_date).startsWith(month)), (row) => Math.max(settlement(row) - Number(row.received_amount || 0), 0))
    const expectedOut = sum(payableRows.filter((row) => row.status !== "Cancelada" && day(row.due_date).startsWith(month)), (row) => Math.max(settlement(row) - Number(row.paid_amount || 0), 0))
    accumulated = round2(accumulated + inflow - outflow + expectedIn - expectedOut)
    return { month: `${month.slice(5)}/${month.slice(0, 4)}`, inflow, outflow, balance: round2(inflow - outflow), expectedIn, expectedOut, expectedBalance: round2(expectedIn - expectedOut), accumulated, sortDate: `${month}-01` }
  })
}

const incomeExpenses: Runner = async ({ admin, start, end }) => {
  const [transactions, categories] = await Promise.all([all(admin, "financial_transactions"), nameMap(admin, "financial_categories")])
  return transactions.filter((row) => row.status === "Realizado" && inRange(row.realized_date, start, end)).map((row) => {
    const value = Number(row.realized_amount || 0)
    const income = row.type === "entrada"
    return { date: day(row.realized_date), kind: income ? "Receita" : "Despesa", description: row.description, category: categories.get(row.category_id) || "Sem categoria", party: row.supplier_name || "", origin: row.origin || "", value, signed: income ? value : -value, month: monthKey(row.realized_date) }
  })
}

const dre: Runner = async ({ admin, start, end }) => {
  const [transactions, accounts, categories] = await Promise.all([all(admin, "financial_transactions"), nameMap(admin, "dre_accounts"), all(admin, "financial_categories", "id,dre_account_id")])
  const categoryAccount = new Map<string, string>(categories.map((row) => [row.id as string, row.dre_account_id as string]))
  const buckets = new Map<string, { account: string; kind: string; value: number; entries: number }>()
  for (const row of transactions.filter((item) => item.status === "Realizado" && inRange(item.realized_date, start, end))) {
    const accountId = row.dre_account_id || categoryAccount.get(row.category_id)
    const account = accounts.get(accountId) || "Sem classificação na DRE"
    const income = row.type === "entrada"
    const key = `${income ? "R" : "D"}|${account}`
    const bucket = buckets.get(key) || { account, kind: income ? "Receita" : "Despesa", value: 0, entries: 0 }
    bucket.value = round2(bucket.value + (income ? 1 : -1) * Number(row.realized_amount || 0))
    bucket.entries += 1
    buckets.set(key, bucket)
  }
  const revenue = [...buckets.values()].filter((item) => item.kind === "Receita").reduce((total, item) => total + item.value, 0)
  return [...buckets.values()].map((item) => ({ ...item, share: revenue ? round2((item.value / revenue) * 100) : 0 }))
}

// ---------------- Estoque

const stockRow = (row: any) => {
  const stock = Number(row.current_stock || 0)
  const reserved = Number(row.reserved_stock || 0)
  const cost = Number(row.average_cost || row.cost_price || 0)
  return { stock, reserved, available: round2(stock - reserved), cost, minimum: Number(row.minimum_stock || 0), reorderPoint: Number(row.reorder_point || 0) }
}

const stockPosition: Runner = async ({ admin }) => {
  const materials = (await all(admin, "materials")).filter((row) => row.status !== "Inativo")
  return materials.map((row) => {
    const s = stockRow(row)
    return { code: row.internal_code || "", product: row.name, category: row.category || "", unit: row.unit || "", stock: s.stock, reserved: s.reserved, available: s.available, averageCost: s.cost, value: round2(s.stock * s.cost), minimum: s.minimum, situation: s.stock <= 0 ? "Sem saldo" : s.minimum > 0 && s.available <= s.minimum ? "Abaixo do mínimo" : "Normal" }
  })
}

const stockMovements: Runner = async ({ admin, start, end }) => {
  const [movements, materials, warehouses] = await Promise.all([all(admin, "stock_movements"), nameMap(admin, "materials"), nameMap(admin, "warehouses")])
  return movements.filter((row) => inRange(row.occurred_at, start, end)).map((row) => ({ date: day(row.occurred_at), product: materials.get(row.material_id) || "-", type: row.movement_type, quantity: Number(row.quantity || 0), from: warehouses.get(row.from_warehouse_id) || "", to: warehouses.get(row.to_warehouse_id) || "", unitCost: Number(row.unit_cost || 0), total: Number(row.total_cost || 0), responsible: row.responsible || "", document: row.document_reference || "", month: monthKey(row.occurred_at) }))
}

const stockCount: Runner = async ({ admin }) => {
  const [balances, materials, warehouses] = await Promise.all([all(admin, "stock_balances", "material_id,warehouse_id,quantity"), all(admin, "materials", "id,name,internal_code,unit"), nameMap(admin, "warehouses")])
  const byId = new Map<string, any>(materials.map((row) => [row.id as string, row]))
  return balances.filter((row) => Number(row.quantity) !== 0).map((row) => ({ warehouse: warehouses.get(row.warehouse_id) || "-", code: byId.get(row.material_id)?.internal_code || "", product: byId.get(row.material_id)?.name || "-", unit: byId.get(row.material_id)?.unit || "", quantity: Number(row.quantity), count: "", difference: "" }))
}

const outTypes = new Set(["Saida por venda", "Consumo em OS", "Consumo em kit"])

const stockTurnover: Runner = async ({ admin, start, end }) => {
  const [movements, materials] = await Promise.all([all(admin, "stock_movements"), all(admin, "materials")])
  const days = Math.max(1, daysBetween(start, end) + 1)
  const out = movements.filter((row) => outTypes.has(row.movement_type) && inRange(row.occurred_at, start, end))
  return materials.filter((row) => row.status !== "Inativo").map((row) => {
    const mine = out.filter((item) => item.material_id === row.id)
    const quantity = sum(mine, (item) => item.quantity)
    const stock = Number(row.current_stock || 0)
    return { code: row.internal_code || "", product: row.name, category: row.category || "", out: quantity, stock, turnover: stock > 0 ? round2(quantity / stock) : quantity > 0 ? quantity : 0, coverageDays: quantity > 0 ? round2(stock / (quantity / days)) : 0, outCost: sum(mine, (item) => item.total_cost) }
  }).filter((row) => row.out > 0 || row.stock > 0)
}

const lowStock: Runner = async ({ admin }) => {
  const materials = (await all(admin, "materials")).filter((row) => row.status !== "Inativo")
  return materials.map((row) => ({ row, s: stockRow(row) })).filter(({ s }) => (s.minimum > 0 && s.available <= s.minimum) || (s.reorderPoint > 0 && s.available <= s.reorderPoint)).map(({ row, s }) => {
    const missing = Math.max(round2(s.minimum - s.available), 0)
    return { code: row.internal_code || "", product: row.name, category: row.category || "", stock: s.stock, reserved: s.reserved, available: s.available, minimum: s.minimum, reorderPoint: s.reorderPoint, missing, replenish: round2(missing * s.cost) }
  })
}

// ---------------- Produtos (itens de orçamentos formalizados)

async function soldItems(admin: Admin, start: string, end: string) {
  const quotes = (await all(admin, "quotes")).filter((row) => row.status === "Convertido" && inRange(row.converted_at, start, end))
  if (!quotes.length) return []
  const ids = new Set(quotes.map((row) => row.id as string))
  const items = (await all(admin, "quote_items")).filter((row) => ids.has(row.quote_id))
  const buckets = new Map<string, { item: string; type: string; quantity: number; revenue: number; cost: number; quotes: Set<string> }>()
  for (const row of items) {
    const key = `${row.line_type}|${row.material_id || row.service_type_id || row.description}`
    const bucket = buckets.get(key) || { item: row.description, type: row.line_type, quantity: 0, revenue: 0, cost: 0, quotes: new Set<string>() }
    bucket.quantity += Number(row.quantity)
    bucket.revenue += Number(row.total)
    bucket.cost += Number(row.quantity) * Number(row.unit_cost)
    bucket.quotes.add(row.quote_id)
    buckets.set(key, bucket)
  }
  return [...buckets.values()].map((bucket) => ({ item: bucket.item, type: bucket.type, quantity: round2(bucket.quantity), revenue: round2(bucket.revenue), cost: round2(bucket.cost), margin: round2(bucket.revenue - bucket.cost), marginPct: bucket.revenue ? round2(((bucket.revenue - bucket.cost) / bucket.revenue) * 100) : 0, quotes: bucket.quotes.size }))
}

const productSales: Runner = ({ admin, start, end }) => soldItems(admin, start, end)

const productProfitability: Runner = async ({ admin, start, end }) => (await soldItems(admin, start, end)).map((row) => ({ ...row, avgPrice: row.quantity ? round2(row.revenue / row.quantity) : 0, avgCost: row.quantity ? round2(row.cost / row.quantity) : 0 }))

const productAbc: Runner = async ({ admin, start, end }) => {
  const items = (await soldItems(admin, start, end)).sort((a, b) => b.revenue - a.revenue)
  const total = items.reduce((acc, item) => acc + item.revenue, 0)
  let accumulated = 0
  return items.map((item, index) => {
    const before = total ? (accumulated / total) * 100 : 0
    accumulated += item.revenue
    const share = total ? (item.revenue / total) * 100 : 0
    return { rank: index + 1, item: item.item, type: item.type, quantity: item.quantity, revenue: item.revenue, share: round2(share), accumulated: round2(total ? (accumulated / total) * 100 : 0), class: before < 80 ? "A" : before < 95 ? "B" : "C" }
  })
}

// ---------------- Serviços / OS

const hoursByOrder = async (admin: Admin) => {
  const entries = await all(admin, "service_order_time_entries", "service_order_id,provider_id,work_date,hours,hourly_cost")
  return entries as Array<{ service_order_id: string; provider_id: string; work_date: string; hours: number; hourly_cost: number }>
}

const orderStatus: Runner = async ({ admin, start, end }) => {
  const [orders, clients] = await Promise.all([all(admin, "service_orders"), nameMap(admin, "clients")])
  return orders.filter((row) => inRange(row.created_at, start, end)).map((row) => ({ number: row.order_number, client: clients.get(row.client_id) || "-", kind: row.order_kind || "", status: row.status, priority: row.priority || "", openedAt: day(row.created_at), dueDate: day(row.due_date), finishedAt: day(row.finished_at), total: Number(row.total_amount || 0), month: monthKey(row.created_at) }))
}

const finishedStatus = new Set(["Concluída", "Entregue", "Finalizada", "Finalizada parcialmente"])

const orderProductivity: Runner = async ({ admin, start, end }) => {
  const [orders, providers, entries] = await Promise.all([all(admin, "service_orders"), nameMap(admin, "providers", "full_name"), hoursByOrder(admin)])
  const periodEntries = entries.filter((row) => inRange(row.work_date, start, end))
  return [...providers.entries()].map(([id, name]) => {
    const mine = orders.filter((row) => row.main_provider_id === id)
    const opened = mine.filter((row) => inRange(row.created_at, start, end))
    const finished = mine.filter((row) => finishedStatus.has(row.status) && inRange(row.finished_at || row.updated_at, start, end))
    const hours = sum(periodEntries.filter((row) => row.provider_id === id), (row) => row.hours)
    const billed = sum(finished, (row) => row.total_amount)
    return { technician: name, orders: opened.length, finished: finished.length, hours, laborCost: sum(periodEntries.filter((row) => row.provider_id === id), (row) => Number(row.hours) * Number(row.hourly_cost)), billed, perHour: hours ? round2(billed / hours) : 0 }
  }).filter((row) => row.orders || row.finished || row.hours)
}

const orderProfitability: Runner = async ({ admin, start, end }) => {
  const [orders, clients, entries] = await Promise.all([all(admin, "service_orders"), nameMap(admin, "clients"), hoursByOrder(admin)])
  return orders.filter((row) => finishedStatus.has(row.status) && inRange(row.finished_at, start, end)).map((row) => {
    const total = Number(row.total_amount || 0)
    const cost = Number(row.cost_amount || 0)
    return { number: row.order_number, client: clients.get(row.client_id) || "-", kind: row.order_kind || "", finishedAt: day(row.finished_at), total, cost, margin: round2(total - cost), marginPct: total ? round2(((total - cost) / total) * 100) : 0, hours: sum(entries.filter((item) => item.service_order_id === row.id), (item) => item.hours), month: monthKey(row.finished_at) }
  })
}

const orderDuration: Runner = async ({ admin, start, end }) => {
  const [orders, clients, entries] = await Promise.all([all(admin, "service_orders"), nameMap(admin, "clients"), hoursByOrder(admin)])
  return orders.filter((row) => finishedStatus.has(row.status) && inRange(row.finished_at, start, end)).map((row) => ({
    number: row.order_number, client: clients.get(row.client_id) || "-", kind: row.order_kind || "", openedAt: day(row.created_at), finishedAt: day(row.finished_at), days: Math.max(0, daysBetween(day(row.created_at), day(row.finished_at))),
    hours: sum(entries.filter((item) => item.service_order_id === row.id), (item) => item.hours), dueDate: day(row.due_date), delay: day(row.due_date) ? Math.max(0, daysBetween(day(row.due_date), day(row.finished_at))) : 0, month: monthKey(row.finished_at),
  }))
}

// ---------------- Frota

const vehicleLabel = (row: any) => [row.brand, row.model].filter(Boolean).join(" ") || row.vehicle_type || "-"

const fleetCost: Runner = async ({ admin, start, end }) => {
  const [vehicles, maintenance, fuel, payableRows] = await Promise.all([all(admin, "vehicles"), all(admin, "vehicle_maintenance"), all(admin, "fuel_entries"), all(admin, "accounts_payable", "id,vehicle_id,status,expected_amount,competence_date,due_date")])
  return vehicles.map((vehicle) => {
    const maint = sum(maintenance.filter((row) => row.vehicle_id === vehicle.id && row.status !== "Cancelada" && inRange(row.start_date, start, end)), (row) => Number(row.parts_cost || 0) + Number(row.labor_cost || 0) || Number(row.cost || 0))
    const fuels = fuel.filter((row) => row.vehicle_id === vehicle.id && inRange(row.fuel_date, start, end))
    const fuelCost = sum(fuels, (row) => row.total_amount)
    const bills = sum(payableRows.filter((row) => row.vehicle_id === vehicle.id && row.status !== "Cancelada" && inRange(row.competence_date || row.due_date, start, end)), (row) => row.expected_amount)
    const odometers = fuels.map((row) => Number(row.odometer || 0)).filter((value) => value > 0)
    const km = odometers.length > 1 ? Math.max(...odometers) - Math.min(...odometers) : 0
    const total = round2(maint + fuelCost + bills)
    return { fleetNumber: vehicle.fleet_number || "", plate: vehicle.plate || "", vehicle: vehicleLabel(vehicle), maintenance: maint, fuel: fuelCost, payables: bills, total, km, perKm: km ? round2(total / km) : 0 }
  }).filter((row) => row.total > 0)
}

const fleetMaintenance: Runner = async ({ admin, start, end }) => {
  const [rows, vehicles] = await Promise.all([all(admin, "vehicle_maintenance"), all(admin, "vehicles", "id,fleet_number,plate,model,brand")])
  const label = new Map<string, string>(vehicles.map((row) => [row.id as string, `${row.fleet_number || ""} ${row.plate || vehicleLabel(row)}`.trim()]))
  return rows.filter((row) => inRange(row.start_date, start, end)).map((row) => {
    const parts = Number(row.parts_cost || 0)
    const labor = Number(row.labor_cost || 0)
    return { date: day(row.start_date), vehicle: label.get(row.vehicle_id) || "-", type: row.maintenance_type || row.type || "", service: row.service_description || row.description || "", workshop: row.workshop || "", parts, labor, total: round2(parts + labor) || Number(row.cost || 0), downtime: Number(row.downtime_hours || 0), status: row.status, month: monthKey(row.start_date) }
  })
}

const fleetFuel: Runner = async ({ admin, start, end }) => {
  const [rows, vehicles, drivers] = await Promise.all([all(admin, "fuel_entries"), all(admin, "vehicles", "id,fleet_number,plate,model,brand"), nameMap(admin, "fleet_drivers")])
  const label = new Map<string, string>(vehicles.map((row) => [row.id as string, `${row.fleet_number || ""} ${row.plate || vehicleLabel(row)}`.trim()]))
  return rows.filter((row) => inRange(row.fuel_date, start, end)).map((row) => ({ date: day(row.fuel_date), vehicle: label.get(row.vehicle_id) || "-", driver: drivers.get(row.driver_id) || "", station: row.station || "", fuel: row.fuel_type, liters: Number(row.liters), price: Number(row.price_per_liter), total: Number(row.total_amount), odometer: Number(row.odometer || 0), month: monthKey(row.fuel_date) }))
}

const fleetAvailability: Runner = async ({ admin, start, end, today }) => {
  const [vehicles, maintenance] = await Promise.all([all(admin, "vehicles"), all(admin, "vehicle_maintenance")])
  const from = new Date(`${start}T00:00:00Z`).getTime()
  const to = Math.min(new Date(`${end}T23:59:59Z`).getTime(), new Date(`${today}T23:59:59Z`).getTime())
  const periodHours = Math.max(1, (to - from) / 3600000)
  return vehicles.filter((row) => !["Vendido", "Inativo"].includes(row.status)).map((vehicle) => {
    const stops = maintenance.filter((row) => row.vehicle_id === vehicle.id && row.stopped_at && row.status !== "Cancelada")
    let hours = 0
    let count = 0
    for (const stop of stops) {
      const begin = Math.max(new Date(stop.stopped_at).getTime(), from)
      const finish = Math.min(stop.released_at ? new Date(stop.released_at).getTime() : to, to)
      if (finish > begin) { hours += (finish - begin) / 3600000; count++ }
    }
    return { fleetNumber: vehicle.fleet_number || "", plate: vehicle.plate || "", vehicle: vehicleLabel(vehicle), status: vehicle.status, stops: count, downtimeHours: round2(hours), availability: Math.max(0, round2(100 - (hours / periodHours) * 100)) }
  })
}

// ---------------- Comercial

const funnel: Runner = async ({ admin, params }) => {
  const [rows, people] = await Promise.all([all(admin, "opportunities"), nameMap(admin, "salespeople")])
  const seller = (params.seller || "").toLowerCase()
  const mine = rows.filter((row) => !seller || (people.get(row.salesperson_id) || "").toLowerCase().includes(seller))
  return funnelStages.map((stage, index) => {
    const items = mine.filter((row) => row.stage === stage)
    return { order: index + 1, stage, count: items.length, value: sum(items, (row) => row.estimated_value), weighted: sum(items, (row) => (Number(row.estimated_value) * (Number(row.probability) || stageProbability[stage])) / 100) }
  })
}

const salesBySeller: Runner = async ({ admin, start, end }) => {
  const [rows, people, commercial] = await Promise.all([all(admin, "opportunities"), all(admin, "salespeople", "id,name"), loadSection(admin, "commercial")])
  const commissionPercent = Number(commercial.defaultCommissionPercent || 0)
  return people.map((person) => {
    const mine = rows.filter((row) => row.salesperson_id === person.id)
    const won = mine.filter((row) => row.stage === "Ganho" && inRange(row.closed_at, start, end))
    const lost = mine.filter((row) => row.stage === "Perdido" && inRange(row.closed_at, start, end))
    const open = mine.filter((row) => !["Ganho", "Perdido"].includes(row.stage))
    const wonValue = sum(won, (row) => row.estimated_value)
    return { seller: person.name, won: won.length, wonValue, commission: round2((wonValue * commissionPercent) / 100), lost: lost.length, open: open.length, openValue: sum(open, (row) => row.estimated_value), conversion: won.length + lost.length ? round2((won.length / (won.length + lost.length)) * 100) : 0, ticket: won.length ? round2(wonValue / won.length) : 0 }
  }).filter((row) => row.won || row.lost || row.open)
}

const conversionByOrigin: Runner = async ({ admin, start, end }) => {
  const rows = (await all(admin, "opportunities")).filter((row) => inRange(row.created_at, start, end))
  const origins = [...new Set(rows.map((row) => String(row.origin || "Não informada")))]
  return origins.map((origin) => {
    const mine = rows.filter((row) => String(row.origin || "Não informada") === origin)
    const won = mine.filter((row) => row.stage === "Ganho")
    const lost = mine.filter((row) => row.stage === "Perdido")
    return { origin, created: mine.length, won: won.length, lost: lost.length, open: mine.length - won.length - lost.length, conversion: won.length + lost.length ? round2((won.length / (won.length + lost.length)) * 100) : 0, wonValue: sum(won, (row) => row.estimated_value) }
  })
}

const inactiveClients: Runner = async ({ admin, today, params }) => {
  const limit = Number(params.days || 180)
  const [clients, orders, quotes, receivableRows, people] = await Promise.all([all(admin, "clients"), all(admin, "service_orders", "client_id,created_at"), all(admin, "quotes", "client_id,issue_date"), all(admin, "accounts_receivable", "client_id,due_date"), nameMap(admin, "salespeople")])
  const last = new Map<string, { date: string; kind: string }>()
  const mark = (clientId: string, date: string, kind: string) => {
    if (!clientId || !date) return
    const current = last.get(clientId)
    if (!current || date > current.date) last.set(clientId, { date, kind })
  }
  orders.forEach((row) => mark(row.client_id, day(row.created_at), "OS"))
  quotes.forEach((row) => mark(row.client_id, day(row.issue_date), "Orçamento"))
  receivableRows.forEach((row) => mark(row.client_id, day(row.due_date), "Título a receber"))
  return clients.filter((row) => row.status === "Ativo").map((row) => {
    const movement = last.get(row.id)
    const reference = movement?.date || day(row.created_at)
    return { client: row.name, document: row.document || "", phone: row.phone || "", seller: people.get(row.salesperson_id) || "", lastDate: movement?.date || "", lastKind: movement?.kind || "Nenhum", daysInactive: Math.max(0, daysBetween(reference, today)) }
  }).filter((row) => row.daysInactive > limit)
}

// ---------------- Orçamentos

const currentQuotes = async (admin: Admin, start: string, end: string) => (await all(admin, "quotes")).filter((row) => row.status !== "Substituído" && inRange(row.issue_date, start, end))

const quotesList: Runner = async ({ admin, start, end }) => {
  const [quotes, clients, people] = await Promise.all([currentQuotes(admin, start, end), nameMap(admin, "clients"), nameMap(admin, "salespeople")])
  return quotes.map((row) => ({ number: `${row.quote_number}${row.version > 1 ? ` v${row.version}` : ""}`, client: clients.get(row.client_id) || "-", seller: people.get(row.salesperson_id) || "-", type: row.quote_type, issueDate: day(row.issue_date), validUntil: day(row.valid_until), total: Number(row.total_amount), status: effectiveStatus(row.status, row.valid_until), sentAt: day(row.sent_at), approvedAt: day(row.approved_at), month: monthKey(row.issue_date) }))
}

const quotesConversion: Runner = async ({ admin, start, end }) => {
  const [quotes, people] = await Promise.all([currentQuotes(admin, start, end), nameMap(admin, "salespeople")])
  return [...new Set(quotes.map((row) => row.salesperson_id as string))].map((id) => {
    const mine = quotes.filter((row) => row.salesperson_id === id)
    const sent = mine.filter((row) => row.sent_at)
    const approved = mine.filter((row) => ["Aprovado", "Convertido"].includes(row.status))
    const refused = mine.filter((row) => row.status === "Recusado")
    const expired = mine.filter((row) => effectiveStatus(row.status, row.valid_until) === "Expirado")
    const decided = approved.length + refused.length + expired.length
    return { seller: people.get(id) || "-", issued: mine.length, sent: sent.length, approved: approved.length, refused: refused.length, expired: expired.length, sentValue: sum(sent, (row) => row.total_amount), approvedValue: sum(approved, (row) => row.total_amount), approvalRate: decided ? round2((approved.length / decided) * 100) : 0 }
  })
}

// ---------------- Contratos

async function contractRows(admin: Admin, statuses: string[]) {
  const [contracts, clients, suppliers] = await Promise.all([all(admin, "contracts"), nameMap(admin, "clients"), nameMap(admin, "suppliers")])
  return contracts.filter((row) => statuses.includes(row.status)).map((row) => ({ row, party: row.direction === "Receita" ? clients.get(row.client_id) || "-" : suppliers.get(row.supplier_id) || "-" }))
}

const contractsActive: Runner = async ({ admin }) => (await contractRows(admin, ["Vigente", "Suspenso"])).map(({ row, party }) => ({ number: row.contract_number, type: row.contract_type, direction: row.direction, title: row.title, party, start: day(row.start_date), end: day(row.end_date), total: Number(row.total_value), recurring: Number(row.recurring_value), periodicity: row.billing_periodicity || "", responsible: row.responsible_name, status: row.status }))

const contractsExpiring: Runner = async ({ admin, today, params }) => {
  const horizon = Number(params.days || 90)
  return (await contractRows(admin, ["Vigente"])).filter(({ row }) => row.end_date && daysBetween(today, day(row.end_date)) <= horizon).map(({ row, party }) => {
    const notice = Number(row.notice_days || 0)
    const end = day(row.end_date)
    return { number: row.contract_number, title: row.title, party, end, daysLeft: daysBetween(today, end), noticeDays: notice, noticeDate: notice ? new Date(new Date(`${end}T00:00:00Z`).getTime() - notice * 86400000).toISOString().slice(0, 10) : "", autoRenew: row.auto_renew ? "Sim" : "Não", adjustment: day(row.next_adjustment_date), total: Number(row.total_value), responsible: row.responsible_name }
  })
}

const contractsClosed: Runner = async ({ admin, start, end }) => (await contractRows(admin, ["Encerrado", "Rescindido", "Cancelado"])).filter(({ row }) => inRange(row.updated_at, start, end)).map(({ row, party }) => ({ number: row.contract_number, type: row.contract_type, title: row.title, party, start: day(row.start_date), end: day(row.end_date), total: Number(row.total_value), status: row.status, reason: row.status_reason || "", changedAt: day(row.updated_at) }))

const contractRevenue: Runner = async ({ admin, start, end }) => {
  const [rows, billings] = await Promise.all([contractRows(admin, ["Vigente"]), all(admin, "contract_billings", "contract_id,competence_date,amount")])
  return rows.filter(({ row }) => row.direction === "Receita").map(({ row, party }) => {
    const mine = billings.filter((item) => item.contract_id === row.id)
    const months = billingPeriodicities[row.billing_periodicity as keyof typeof billingPeriodicities] || 0
    const monthly = months ? round2(Number(row.recurring_value) / months) : 0
    const billedTotal = sum(mine, (item) => item.amount)
    return { number: row.contract_number, party, title: row.title, periodicity: row.billing_periodicity || "", recurring: Number(row.recurring_value), monthly, annual: round2(monthly * 12), billedPeriod: sum(mine.filter((item) => inRange(item.competence_date, start, end)), (item) => item.amount), billedTotal, toBill: Math.max(round2(Number(row.total_value) - billedTotal), 0) }
  })
}

export const reportRunners: Record<string, Runner> = {
  fin_pagar: payables, fin_receber: receivables, fin_fluxo: cashFlow, fin_receitas_despesas: incomeExpenses, fin_dre: dre,
  est_posicao: stockPosition, est_movimentacao: stockMovements, est_inventario: stockCount, est_giro: stockTurnover, est_baixo: lowStock,
  prod_vendas: productSales, prod_rentabilidade: productProfitability, prod_abc: productAbc,
  os_status: orderStatus, os_produtividade: orderProductivity, os_rentabilidade: orderProfitability, os_tempo: orderDuration,
  frota_custo: fleetCost, frota_manutencao: fleetMaintenance, frota_abastecimento: fleetFuel, frota_disponibilidade: fleetAvailability,
  com_funil: funnel, com_vendas_vendedor: salesBySeller, com_conversao: conversionByOrigin, com_clientes_inativos: inactiveClients,
  orc_lista: quotesList, orc_conversao: quotesConversion,
  ctr_vigentes: contractsActive, ctr_vencendo: contractsExpiring, ctr_encerrados: contractsClosed, ctr_receita: contractRevenue,
}
