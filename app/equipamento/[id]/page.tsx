import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { CalendarDays, CheckCircle2, MapPin, Snowflake, Wrench } from "lucide-react"
import { createAdminClient } from "@/lib/supabase/server"
import { equipmentCode, isCompletedOrder, orderIncludesEquipment } from "@/lib/equipment-public"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Histórico do equipamento | M&C Climatização",
  description: "Informações técnicas e últimas ordens de serviço do equipamento.",
  robots: { index: false, follow: false },
}

function displayDate(value?: string | null) {
  if (!value) return "-"
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value)
  return Number.isNaN(date.getTime()) ? "-" : new Intl.DateTimeFormat("pt-BR").format(date)
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return <div className="min-w-0 border-b py-3 last:border-0"><dt className="text-xs font-medium uppercase text-slate-500">{label}</dt><dd className="mt-1 break-words text-sm font-medium text-slate-900">{value || "-"}</dd></div>
}

export default async function EquipmentPublicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  // Public QR links identify the equipment by an unguessable UUID and cannot depend on a login cookie.
  const supabase = createAdminClient({ bypassCompanyScope: true })
  const equipmentResult = uuid.test(id)
    ? await supabase.from("client_equipment").select("*").eq("id", id).maybeSingle()
    : { data: null, error: null }
  const equipment = equipmentResult.data

  if (!equipment) {
    notFound()
  }

  const [clientResult, environmentResult, ordersResult, serviceTypesResult] = await Promise.all([
    supabase.from("clients").select("name").eq("id", equipment.client_id).maybeSingle(),
    supabase.from("client_environments").select("name,location,floor").eq("id", equipment.client_environment_id).maybeSingle(),
    supabase.from("service_orders").select("id,order_number,client_equipment_id,service_type_id,description,scheduled_date,status,finished_at,notes,order_type,created_at").eq("client_id", equipment.client_id).order("created_at", { ascending: false }).limit(300),
    supabase.from("service_types").select("id,name"),
  ])
  const serviceNames = new Map((serviceTypesResult.data || []).map((service) => [service.id, service.name]))
  const orders = (ordersResult.data || [])
    .filter((order) => isCompletedOrder(order.status) && orderIncludesEquipment(order, equipment.id))
    .sort((a, b) => String(b.finished_at || b.scheduled_date || b.created_at).localeCompare(String(a.finished_at || a.scheduled_date || a.created_at)))
    .slice(0, 10)
  const environment = environmentResult.data
  const location = [environment?.name, environment?.floor, environment?.location].filter(Boolean).join(" - ")
  const code = equipmentCode(equipment)

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-4 sm:px-8">
          <span className="grid h-9 w-9 place-items-center bg-blue-600 text-white"><Snowflake className="h-5 w-5" /></span>
          <div><p className="font-semibold">M&C Climatização</p><p className="text-xs text-slate-500">Registro do equipamento</p></div>
        </div>
      </header>

      <section className="border-b bg-white">
        <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-10">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0"><p className="font-mono text-sm font-semibold text-blue-700">{code}</p><h1 className="mt-2 break-words text-3xl font-semibold text-slate-950">{equipment.name}</h1><p className="mt-2 text-sm text-slate-600">{[equipment.brand, equipment.model, equipment.capacity].filter(Boolean).join(" · ") || "Informações técnicas cadastradas"}</p></div>
            <span className={`w-fit border px-3 py-1 text-sm font-medium ${equipment.status === "Ativo" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-100 text-slate-700"}`}>{equipment.status}</span>
          </div>
          {location ? <p className="mt-5 flex items-start gap-2 text-sm text-slate-600"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />{location}</p> : null}
        </div>
      </section>

      <div className="mx-auto grid max-w-5xl gap-8 px-5 py-8 sm:px-8 lg:grid-cols-[280px_1fr]">
        <section aria-labelledby="technical-title">
          <h2 id="technical-title" className="flex items-center gap-2 text-base font-semibold"><Wrench className="h-4 w-4 text-blue-600" />Dados técnicos</h2>
          <dl className="mt-3 border-y bg-white px-4">
            <Field label="Código" value={code} /><Field label="TAG" value={equipment.tag} /><Field label="Tipo" value={equipment.type} /><Field label="Marca" value={equipment.brand} /><Field label="Modelo" value={equipment.model} /><Field label="Capacidade" value={equipment.capacity} /><Field label="Número de série" value={equipment.serial_number} /><Field label="Cliente" value={clientResult.data?.name} />
          </dl>
        </section>

        <section aria-labelledby="orders-title">
          <div className="flex items-center justify-between gap-3"><h2 id="orders-title" className="flex items-center gap-2 text-base font-semibold"><CalendarDays className="h-4 w-4 text-blue-600" />Últimas OS realizadas</h2><span className="text-sm text-slate-500">{orders.length} registro{orders.length === 1 ? "" : "s"}</span></div>
          <div className="mt-3 divide-y border-y bg-white">
            {orders.length ? orders.map((order) => (
              <article key={order.id} className="px-4 py-4 sm:px-5">
                <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-mono text-sm font-semibold text-blue-700">{order.order_number}</p><h3 className="mt-1 text-sm font-semibold">{serviceNames.get(order.service_type_id) || order.description || (order.order_type === "pmoc" ? "Manutenção PMOC" : "Ordem de serviço")}</h3></div><span className="flex items-center gap-1 text-xs font-medium text-emerald-700"><CheckCircle2 className="h-4 w-4" />{order.status}</span></div>
                <p className="mt-3 text-xs text-slate-500">Realizada em {displayDate(order.finished_at || order.scheduled_date)}</p>
              </article>
            )) : <div className="px-5 py-10 text-center"><CheckCircle2 className="mx-auto h-7 w-7 text-slate-300" /><p className="mt-3 text-sm font-medium text-slate-700">Nenhuma OS finalizada registrada</p></div>}
          </div>
        </section>
      </div>
      <footer className="border-t bg-white px-5 py-5 text-center text-xs text-slate-500">Dados atualizados pelo sistema operacional da M&C Climatização.</footer>
    </main>
  )
}
