import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { currentUserRole } from "@/lib/server-authorization"
import { releaseStockOrdersForServiceOrder } from "@/lib/stock-order-service-sync"

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const FILE_BUCKET = "service-order-files"

function storagePath(fileUrl: string) {
  const prefix = `/storage/v1/object/public/${FILE_BUCKET}/`
  const index = String(fileUrl || "").indexOf(prefix)
  return index >= 0 ? decodeURIComponent(String(fileUrl).slice(index + prefix.length)) : ""
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, role } = await currentUserRole()
    if (!user || role !== "admin") return NextResponse.json({ error: "Somente administradores podem excluir uma OS." }, { status: 403 })

    const { id } = await params
    if (!uuidPattern.test(id)) return NextResponse.json({ error: "OS invalida." }, { status: 400 })

    const supabase = createAdminClient()
    const { data: order, error: orderError } = await supabase
      .from("service_orders")
      .select("id,order_number")
      .eq("id", id)
      .maybeSingle()
    if (orderError) throw orderError
    if (!order) return NextResponse.json({ error: "OS nao encontrada." }, { status: 404 })

    const { data: files, error: filesError } = await supabase
      .from("service_order_files")
      .select("file_url")
      .eq("service_order_id", id)
    if (filesError) throw filesError

    const childTables = [
      "service_order_events",
      "service_order_checklist_items",
      "service_order_materials",
      "service_order_files",
      "service_order_signatures",
      "vehicle_checklists",
      "vehicle_usage",
    ]
    for (const table of childTables) {
      const { error } = await supabase.from(table).delete().eq("service_order_id", id)
      if (error) throw new Error(`${table}: ${error.message}`)
    }

    const { error: scheduleError } = await supabase
      .from("pmoc_schedules")
      .update({ service_order_id: null, status: "Planejado", updated_at: new Date().toISOString() })
      .eq("service_order_id", id)
    if (scheduleError && !String(scheduleError.message).toLowerCase().includes("does not exist")) throw scheduleError

    const { error: receivableError } = await supabase
      .from("accounts_receivable")
      .delete()
      .eq("service_order_id", id)
      .eq("origin", "OS")
    if (receivableError && !String(receivableError.message).toLowerCase().includes("does not exist")) throw receivableError

    await releaseStockOrdersForServiceOrder(supabase, id)
    const { error: deleteError } = await supabase.from("service_orders").delete().eq("id", id)
    if (deleteError) throw deleteError

    const paths = (files || []).map((file) => storagePath(file.file_url)).filter(Boolean)
    if (paths.length) {
      const { error: storageError } = await supabase.storage.from(FILE_BUCKET).remove(paths)
      if (storageError) console.error("[delete service order storage]", storageError.message)
    }

    await supabase.from("audit_logs").insert({
      user_id: user.id,
      entity_type: "service_order",
      entity_id: null,
      action: "Excluida",
      description: `${order.order_number} excluida definitivamente`,
    })

    return NextResponse.json({ success: true, id, orderNumber: order.order_number })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao excluir OS." }, { status: 500 })
  }
}
