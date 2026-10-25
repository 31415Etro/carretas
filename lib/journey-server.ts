import type { createAdminClient } from "@/lib/supabase/server"
import { getOpportunity } from "@/lib/commercial-server"
import { quoteStructureProblems } from "@/lib/production-links-server"

type Admin = ReturnType<typeof createAdminClient>
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Estado da Jornada comercial de uma oportunidade: oportunidade (com produtos), propostas, pedido de venda e o acompanhamento
 * (produção na esteira, documentação veicular e entregas). Só consulta; NÃO traz nada de financeiro (parcelas, pagamentos, baixas).
 */
export async function journeyState(admin: Admin, opportunityId: string) {
  if (!uuid.test(opportunityId)) throw new Error("Oportunidade inválida.")
  const opportunity = await getOpportunity(admin, opportunityId)
  if (!opportunity) throw new Error("Oportunidade não encontrada.")

  const quotesResult = await admin.from("quotes").select("id,quote_number,version,status,total_amount,valid_until,created_at").eq("opportunity_id", opportunityId).order("created_at", { ascending: false })
  if (quotesResult.error) throw quotesResult.error
  const quotes = (quotesResult.data || []).map((row) => ({ id: row.id as string, number: row.quote_number as string, version: Number(row.version), status: row.status as string, totalAmount: Number(row.total_amount || 0), validUntil: (row.valid_until as string) || "", createdAt: row.created_at as string }))
  // proposta em vigor: a que virou pedido, senão a aprovada, senão a mais recente ainda viva
  const alive = quotes.filter((quote) => !["Cancelado", "Recusado"].includes(quote.status))
  const quote = alive.find((item) => item.status === "Convertido") || alive.find((item) => item.status === "Aprovado") || alive[0] || null

  let order: { id: string; number: string; status: string; deliveryDate: string; totalAmount: number } | null = null
  if (quotes.length) {
    const found = await admin.from("sales_orders").select("id,order_number,status,delivery_date,total_amount").in("quote_id", quotes.map((item) => item.id)).neq("status", "Cancelado").order("created_at", { ascending: false }).limit(1)
    const row = found.data?.[0]
    if (row) order = { id: row.id as string, number: row.order_number as string, status: row.status as string, deliveryDate: (row.delivery_date as string) || "", totalAmount: Number(row.total_amount || 0) }
  }

  // acompanhamento: ordens de produção, unidades na esteira e documentação veicular
  const production: Array<Record<string, unknown>> = []
  const documentation: Array<Record<string, unknown>> = []
  const deliveries: Array<Record<string, unknown>> = []
  if (order) {
    const orders = await admin.from("production_orders").select("id,code,status,quantity,produced_quantity,planned_end,responsible,product_id").eq("sales_order_id", order.id).neq("status", "Cancelada")
    const orderRows = orders.data || []
    const names = new Map<string, string>()
    const productIds = [...new Set(orderRows.map((row) => row.product_id as string))]
    if (productIds.length) for (const row of (await admin.from("materials").select("id,name").in("id", productIds)).data || []) names.set(row.id as string, row.name as string)
    const orderIds = orderRows.map((row) => row.id as string)
    const tasks = orderIds.length ? (await admin.from("shop_tasks").select("production_order_id,unit_number,step_name,seq,status,assigned_worker_id,planned_end").in("production_order_id", orderIds).order("seq")).data || [] : []
    const workerIds = [...new Set(tasks.map((task) => task.assigned_worker_id as string | null).filter(Boolean) as string[])]
    const workers = new Map<string, string>()
    if (workerIds.length) for (const row of (await admin.from("shop_workers").select("id,name").in("id", workerIds)).data || []) workers.set(row.id as string, row.name as string)
    const docs = (await admin.from("vehicle_documentation").select("id,sales_order_item_id,production_order_id,unit_number,vin,protocol,status,final_stage,pendencies,responsible,updated_at").eq("sales_order_id", order.id).neq("status", "Cancelado").order("unit_number")).data || []

    for (const po of orderRows) {
      const units = new Map<number, typeof tasks>()
      for (const task of tasks.filter((item) => item.production_order_id === po.id)) units.set(task.unit_number as number, [...(units.get(task.unit_number as number) || []), task])
      const unitRows = [...units.entries()].sort((a, b) => a[0] - b[0]).map(([unit, list]) => {
        const done = list.filter((task) => task.status === "Concluida").length
        const current = list.find((task) => task.status !== "Concluida") || null
        const matched = docs.find((doc) => doc.production_order_id === po.id && doc.unit_number === unit) || docs.find((doc) => doc.unit_number === unit)
        return {
          unit, vin: (matched?.vin as string) || "", step: current ? (current.step_name as string) : "Concluída", stepStatus: current ? (current.status as string) : "Concluida",
          responsible: current?.assigned_worker_id ? workers.get(current.assigned_worker_id as string) || "" : "", progress: list.length ? Math.round((done / list.length) * 100) : 0, plannedEnd: (current?.planned_end as string) || "",
        }
      })
      production.push({ id: po.id, code: po.code, product: names.get(po.product_id as string) || "", status: po.status, quantity: Number(po.quantity), produced: Number(po.produced_quantity || 0), plannedEnd: po.planned_end || "", responsible: po.responsible || "", units: unitRows })
    }
    for (const doc of docs) documentation.push({ id: doc.id, unit: doc.unit_number, vin: doc.vin || "", protocol: doc.protocol || "", status: doc.status, finalStage: doc.final_stage, pendencies: Array.isArray(doc.pendencies) ? doc.pendencies : [], responsible: doc.responsible || "", updatedAt: doc.updated_at })
    const delivered = await admin.from("sales_order_deliveries").select("id,created_at,delivered_by,items").eq("sales_order_id", order.id).order("created_at", { ascending: false })
    for (const row of delivered.data || []) deliveries.push({ id: row.id, at: row.created_at, by: row.delivered_by || "", items: row.items || [] })
  }

  // o que impede de fabricar o que está na proposta em vigor (aparece nas conferências do fechamento)
  const structure = quote ? await quoteStructureProblems(admin, quote.id).catch(() => []) : []
  return { opportunity, quotes, quote, order, production, documentation, deliveries, structure }
}
