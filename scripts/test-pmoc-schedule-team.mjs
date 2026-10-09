import fs from "node:fs"
import crypto from "node:crypto"
import { createClient } from "@supabase/supabase-js"

function loadEnvFile(path) {
  return Object.fromEntries(
    fs.readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=")
        const value = line.slice(separator + 1).replace(/^['"]|['"]$/g, "")
        return [line.slice(0, separator), value]
      }),
  )
}

const env = loadEnvFile(".env.local")
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const ids = {
  plan: crypto.randomUUID(),
  sector: crypto.randomUUID(),
  equipment: crypto.randomUUID(),
  serviceLink: crypto.randomUUID(),
  schedules: [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()],
  orders: [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()],
}

async function requiredQuery(promise, label) {
  const result = await promise
  if (result.error) throw new Error(`${label}: ${result.error.message}`)
  return result.data
}

async function cleanup() {
  const orderDelete = await supabase.from("service_orders").delete().in("id", ids.orders)
  if (orderDelete.error) throw new Error(`Limpar OS de teste: ${orderDelete.error.message}`)
  const planDelete = await supabase.from("pmoc_plans").delete().eq("id", ids.plan)
  if (planDelete.error) throw new Error(`Limpar plano de teste: ${planDelete.error.message}`)

  const remainingPlans = await requiredQuery(
    supabase.from("pmoc_plans").select("id").eq("id", ids.plan),
    "Conferir limpeza do plano",
  )
  const remainingOrders = await requiredQuery(
    supabase.from("service_orders").select("id").in("id", ids.orders),
    "Conferir limpeza das OS",
  )
  if (remainingPlans.length || remainingOrders.length) {
    throw new Error("A limpeza dos registros temporarios nao foi concluida.")
  }
}

async function main() {
  const schemaCheck = await requiredQuery(
    supabase.from("pmoc_plans").select("schedule_day,main_provider_id").limit(1),
    "Novas colunas de PMOC",
  )
  const providers = await requiredQuery(
    supabase.from("providers").select("id,full_name,status").eq("status", "Ativo").limit(1),
    "Prestador ativo",
  )
  const works = await requiredQuery(
    supabase.from("works").select("id,client_id").limit(1),
    "Obra para teste",
  )
  const services = await requiredQuery(
    supabase.from("service_types").select("id,name,status,enabled_contexts").eq("status", "Ativo"),
    "Servico PMOC",
  )

  const provider = providers[0]
  const work = works[0]
  const service = services.find((item) =>
    (item.enabled_contexts || []).some((context) => String(context).toLowerCase() === "pmoc"),
  ) || services[0]

  if (!provider || !work || !service) {
    throw new Error("O teste precisa de um prestador, uma obra e um servico ativos.")
  }

  const stamp = Date.now()
  const dates = ["2026-07-20", "2026-08-20", "2026-09-20"]

  await requiredQuery(supabase.from("pmoc_plans").insert({
    id: ids.plan,
    client_id: work.client_id,
    work_id: work.id,
    name: `TESTE AUTOMATICO DIA FIXO ${stamp}`,
    frequency: "Mensal",
    start_month: 7,
    start_year: 2026,
    start_date: "2026-07-01",
    end_date: "2026-09-30",
    schedule_day: 20,
    main_provider_id: provider.id,
    status: "Ativo",
    notes: "Registro temporario de validacao.",
  }), "Criar plano")

  await requiredQuery(supabase.from("pmoc_sectors").insert({
    id: ids.sector,
    pmoc_plan_id: ids.plan,
    name: "Ambiente teste",
    status: "Ativo",
  }), "Criar setor")

  await requiredQuery(supabase.from("pmoc_equipment").insert({
    id: ids.equipment,
    pmoc_plan_id: ids.plan,
    pmoc_sector_id: ids.sector,
    name: "Equipamento teste",
    status: "Ativo",
  }), "Criar equipamento")

  await requiredQuery(supabase.from("pmoc_equipment_services").insert({
    id: ids.serviceLink,
    pmoc_plan_id: ids.plan,
    pmoc_equipment_id: ids.equipment,
    service_type_id: service.id,
  }), "Vincular servico")

  const orderRows = dates.map((scheduledDate, index) => ({
    id: ids.orders[index],
    order_number: `OS-TEST-PMOC-${stamp}-${index + 1}`,
    order_type: "pmoc",
    service_category: "Manutencao Preventiva",
    client_id: work.client_id,
    work_id: work.id,
    service_type_id: service.id,
    simple_service: true,
    priority: "Media",
    description: "Teste PMOC dia fixo e equipe",
    scheduled_date: scheduledDate,
    scheduled_start_time: "08:00",
    scheduled_end_time: "10:00",
    main_provider_id: provider.id,
    status: "Agendada",
  }))
  await requiredQuery(supabase.from("service_orders").insert(orderRows), "Criar OS")

  const scheduleRows = dates.map((scheduledDate, index) => ({
    id: ids.schedules[index],
    pmoc_plan_id: ids.plan,
    pmoc_equipment_id: ids.equipment,
    service_type_id: service.id,
    month: index + 7,
    year: 2026,
    scheduled_date: scheduledDate,
    service_order_id: ids.orders[index],
    status: "OS aberta",
  }))
  await requiredQuery(supabase.from("pmoc_schedules").insert(scheduleRows), "Criar cronograma")

  const savedPlan = await requiredQuery(
    supabase.from("pmoc_plans").select("id,schedule_day,main_provider_id").eq("id", ids.plan).single(),
    "Ler plano salvo",
  )
  const savedOrders = await requiredQuery(
    supabase.from("service_orders").select("id,scheduled_date,main_provider_id,status").in("id", ids.orders).order("scheduled_date"),
    "Ler OS salvas",
  )

  const apiResponse = await fetch("http://localhost:3000/api/operational-state")
  const apiBody = await apiResponse.json()
  const mappedPlan = apiBody.state?.pmocPlans?.find((item) => item.id === ids.plan)
  const mappedOrders = apiBody.state?.serviceOrders?.filter((item) => ids.orders.includes(item.id)) || []

  const valid = savedPlan.schedule_day === 20
    && savedPlan.main_provider_id === provider.id
    && savedOrders.length === 3
    && savedOrders.every((order) => order.main_provider_id === provider.id && order.scheduled_date.endsWith("-20"))
    && mappedPlan?.scheduleDay === 20
    && mappedPlan?.mainProviderId === provider.id
    && mappedOrders.length === 3

  console.log(JSON.stringify({
    valid,
    schemaColumnsAvailable: Array.isArray(schemaCheck),
    provider: provider.full_name,
    service: service.name,
    plan: savedPlan,
    orders: savedOrders,
    apiStatus: apiResponse.status,
    apiPlan: mappedPlan ? { scheduleDay: mappedPlan.scheduleDay, mainProviderId: mappedPlan.mainProviderId } : null,
    apiOrderCount: mappedOrders.length,
  }, null, 2))

  if (!valid) throw new Error("Os registros foram gravados, mas a validacao final nao conferiu.")
}

try {
  await main()
} finally {
  await cleanup()
  console.log("CLEANUP_OK")
}
