import type { createAdminClient } from "@/lib/supabase/server"

type Admin = ReturnType<typeof createAdminClient>
type Row = Record<string, any>

export const SNAPSHOT_HINT = "Os vínculos técnicos (snapshot e reconciliação) ainda não estão no banco: rode o script 235_vinculos_pedido_ordem_kits.sql no SQL Editor do Supabase."

/**
 * Dados da Central de Produção para UMA ordem, tudo da mesma fonte (ordem, kits congelados, tarefas da esteira):
 * identificação, configuração vendida (medidas, acabamento, acessórios, desenho), kits com versão e componentes e a linha do tempo das tarefas por carreta.
 */
export async function centralExtras(admin: Admin, orderId: string) {
  // snapshot técnico existe só depois do script 235: tenta com a coluna e cai para a leitura simples
  let order: Row | null = null
  const withSnapshot = await admin.from("production_orders").select("id,code,status,quantity,produced_quantity,planned_end,responsible,product_id,client_id,sales_order_id,sales_order_item_id,bom_version_id,configuration_id,technical_snapshot").eq("id", orderId).maybeSingle()
  if (withSnapshot.error) {
    const plain = await admin.from("production_orders").select("id,code,status,quantity,produced_quantity,planned_end,responsible,product_id,client_id,sales_order_id,sales_order_item_id,bom_version_id,configuration_id").eq("id", orderId).maybeSingle()
    if (plain.error) throw plain.error
    order = plain.data
  } else order = withSnapshot.data
  if (!order) throw new Error("Ordem de produção não encontrada.")

  const [product, client, sales, bom] = await Promise.all([
    admin.from("materials").select("name,internal_code,product_model").eq("id", order.product_id).maybeSingle(),
    order.client_id ? admin.from("clients").select("name").eq("id", order.client_id).maybeSingle() : Promise.resolve({ data: null }),
    order.sales_order_id ? admin.from("sales_orders").select("order_number,status").eq("id", order.sales_order_id).maybeSingle() : Promise.resolve({ data: null }),
    order.bom_version_id ? admin.from("product_bom_versions").select("version").eq("id", order.bom_version_id).maybeSingle() : Promise.resolve({ data: null }),
  ])

  // configuração vendida (medidas, acabamento, acessórios, desenho)
  let configuration: Row | null = null
  if (order.configuration_id) {
    const cfg = await admin.from("product_configurations").select("id,status,summary,params,options,revision_label,bom_version,drawing_spec,homologated").eq("id", order.configuration_id).maybeSingle()
    if (cfg.data) {
      const selected: Row[] = cfg.data.options?.selected || []
      configuration = { ...cfg.data, finish: selected.filter((item) => item.group === "acabamento").map((item) => item.label), accessories: selected.filter((item) => item.group === "acessorio").map((item) => item.label) }
    }
  }

  // kits congelados na ordem, cada um com a versão congelada e seus componentes (com perda)
  const kitRows = (await admin.from("production_order_kits").select("kit_id,kit_version_id,quantity").eq("production_order_id", orderId)).data || []
  const kitIds = kitRows.map((row) => row.kit_id as string)
  const versionIds = kitRows.map((row) => row.kit_version_id as string)
  const names = new Map<string, Row>()
  if (kitIds.length) for (const row of (await admin.from("materials").select("id,name,internal_code,category").in("id", kitIds)).data || []) names.set(row.id as string, row)
  const versions = new Map<string, number>()
  if (versionIds.length) for (const row of (await admin.from("kit_versions").select("id,version").in("id", versionIds)).data || []) versions.set(row.id as string, Number(row.version))
  const components = versionIds.length ? (await admin.from("kit_components").select("kit_version_id,component_id,quantity,unit,loss_percent,position").in("kit_version_id", versionIds).order("position")).data || [] : []
  const componentIds = [...new Set(components.map((row) => row.component_id as string))]
  const componentNames = new Map<string, Row>()
  if (componentIds.length) for (const row of (await admin.from("materials").select("id,name,internal_code").in("id", componentIds)).data || []) componentNames.set(row.id as string, row)
  const kits = kitRows.map((row) => ({
    kitId: row.kit_id, sku: names.get(row.kit_id as string)?.internal_code || "", name: names.get(row.kit_id as string)?.name || "", category: names.get(row.kit_id as string)?.category || "",
    version: versions.get(row.kit_version_id as string) ?? null, quantity: Number(row.quantity),
    components: components.filter((comp) => comp.kit_version_id === row.kit_version_id).map((comp) => ({ materialId: comp.component_id, sku: componentNames.get(comp.component_id as string)?.internal_code || "", name: componentNames.get(comp.component_id as string)?.name || "", unit: comp.unit, quantity: Number(comp.quantity), lossPercent: Number(comp.loss_percent || 0) })),
  }))

  // tarefas por carreta com responsável, início, término e tempo decorrido (horário oficial do servidor)
  const tasks = (await admin.from("shop_tasks").select("id,unit_number,step_code,step_name,seq,kind,status,assigned_worker_id,planned_end,started_at,finished_at,blocked_reason,pending_reason").eq("production_order_id", orderId).order("seq")).data || []
  const taskIds = tasks.map((task) => task.id as string)
  const entries = taskIds.length ? (await admin.from("shop_time_entries").select("task_id,worker_id,started_at,ended_at").in("task_id", taskIds)).data || [] : []
  const workerIds = [...new Set([...tasks.map((task) => task.assigned_worker_id as string | null), ...entries.map((entry) => entry.worker_id as string | null)].filter(Boolean) as string[])]
  const workers = new Map<string, string>()
  if (workerIds.length) for (const row of (await admin.from("shop_workers").select("id,name").in("id", workerIds)).data || []) workers.set(row.id as string, row.name as string)
  const vins = (await admin.from("vehicle_documentation").select("unit_number,vin,protocol,status").eq("sales_order_id", order.sales_order_id || "00000000-0000-0000-0000-000000000000").neq("status", "Cancelado")).data || []
  const now = Date.now()
  const units = new Map<number, Row>()
  for (const task of tasks) {
    const unit = Number(task.unit_number)
    const mine = entries.filter((entry) => entry.task_id === task.id)
    const elapsedMinutes = Math.round(mine.reduce((sum, entry) => sum + ((entry.ended_at ? new Date(entry.ended_at as string).getTime() : now) - new Date(entry.started_at as string).getTime()), 0) / 60000)
    const working = [...new Set(mine.filter((entry) => !entry.ended_at).map((entry) => workers.get(entry.worker_id as string) || "?"))]
    const row = { id: task.id, step: task.step_name, code: task.step_code, kind: task.kind, status: task.status, responsible: task.assigned_worker_id ? workers.get(task.assigned_worker_id as string) || "" : "", working, plannedEnd: task.planned_end || "", startedAt: task.started_at || "", finishedAt: task.finished_at || "", elapsedMinutes, blockedReason: task.blocked_reason || "", pendingReason: task.pending_reason || "" }
    const entry = units.get(unit) || { unit, vin: (vins.find((doc) => doc.unit_number === unit)?.vin as string) || "", protocol: (vins.find((doc) => doc.unit_number === unit)?.protocol as string) || "", tasks: [] as Row[] }
    entry.tasks.push(row)
    units.set(unit, entry)
  }
  const unitList = [...units.values()].sort((a, b) => a.unit - b.unit).map((unit) => {
    const open = (unit.tasks as Row[]).filter((task) => !["Concluida", "Cancelada"].includes(task.status))
    return { ...unit, current: open[0] || null, next: open[1] || null, done: (unit.tasks as Row[]).filter((task) => task.status === "Concluida").length }
  })

  return {
    order: { id: order.id, code: order.code, status: order.status, quantity: Number(order.quantity), produced: Number(order.produced_quantity || 0), plannedEnd: order.planned_end || "", responsible: order.responsible || "", productId: order.product_id },
    product: { name: product.data?.name || "", sku: product.data?.internal_code || "", model: product.data?.product_model || "" },
    client: client.data?.name || "", salesOrder: sales.data ? { id: order.sales_order_id, number: sales.data.order_number, status: sales.data.status } : null,
    bomVersion: bom.data?.version ?? null, configuration, kits, snapshotTakenAt: order.technical_snapshot?.taken_at || "", hasSnapshot: Boolean(order.technical_snapshot), units: unitList,
  }
}
