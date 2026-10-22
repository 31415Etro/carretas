import { NextResponse } from "next/server"
import {
  addMeterReading, changeStatus, loadStatusHistory, deleteDocument, deletePlan, loadDetail, loadOverview, loadSettings, machineError, machinesContext, orderAction, orderFromPlan, qrInfo, qrMarkPrinted, qrReissue, qrResolve,
  saveCategory, saveDocument, saveMachine, saveOrder, savePlan, saveSector, saveSettings, searchMaterials, searchSuppliers, seedCategories, setAdminStatus, MachineError,
} from "@/lib/machines-server"

type Params = { params: Promise<{ action: string }> }

/** Todas as leituras do módulo. Sempre sem cache: o status operacional precisa estar sincronizado entre usuários. */
export async function GET(request: Request, { params }: Params) {
  const { action } = await params
  const context = await machinesContext()
  if (context instanceof NextResponse) return context
  const url = new URL(request.url)
  try {
    switch (action) {
      case "data": return NextResponse.json(await loadOverview(context), { headers: { "Cache-Control": "no-store" } })
      case "detail": return NextResponse.json(await loadDetail(context, url.searchParams.get("id") || ""), { headers: { "Cache-Control": "no-store" } })
      case "resolve": return NextResponse.json(await qrResolve(context, url.searchParams.get("token") || ""))
      case "qr": return NextResponse.json(await qrInfo(context, url.searchParams.get("id") || "", url.origin))
      case "status-history": return NextResponse.json({ items: await loadStatusHistory(context, url.searchParams.get("start") || "", url.searchParams.get("end") || "") })
      case "materials": return NextResponse.json({ items: await searchMaterials(context, url.searchParams.get("q") || "") })
      case "suppliers": return NextResponse.json({ items: await searchSuppliers(context) })
      case "settings": return NextResponse.json(await loadSettings(context.admin))
      default: return NextResponse.json({ error: "Ação desconhecida." }, { status: 404 })
    }
  } catch (error) {
    return machineError(error, "Erro ao carregar máquinas.")
  }
}

export async function POST(request: Request, { params }: Params) {
  const { action } = await params
  const context = await machinesContext()
  if (context instanceof NextResponse) return context
  try {
    const body = await request.json().catch(() => ({}))
    const item = body?.item || {}
    switch (action) {
      case "machine": return NextResponse.json({ item: await saveMachine(context, item) })
      case "admin-status": return NextResponse.json({ item: await setAdminStatus(context, item) })
      case "status": return NextResponse.json({ item: await changeStatus(context, item) })
      case "meter": return NextResponse.json({ item: await addMeterReading(context, item) })
      case "plan": return NextResponse.json({ item: await savePlan(context, item) })
      case "plan-order": return NextResponse.json({ item: await orderFromPlan(context, String(item.planId || "")) })
      case "order": return NextResponse.json({ item: await saveOrder(context, item) })
      case "order-action": return NextResponse.json(await orderAction(context, item))
      case "qr-printed": return NextResponse.json(await qrMarkPrinted(context, String(item.machineId || "")))
      case "qr-reissue": return NextResponse.json(await qrReissue(context, String(item.machineId || ""), String(item.reason || "")))
      case "sector": return NextResponse.json({ item: await saveSector(context, item) })
      case "category": return NextResponse.json({ item: await saveCategory(context, item) })
      case "categories-seed": return NextResponse.json(await seedCategories(context))
      case "settings": return NextResponse.json(await saveSettings(context, item))
      case "document": return NextResponse.json({ item: await saveDocument(context, item) })
      default: throw new MachineError("Ação desconhecida.", 404)
    }
  } catch (error) {
    return machineError(error, "Erro ao salvar.")
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const { action } = await params
  const context = await machinesContext()
  if (context instanceof NextResponse) return context
  const id = new URL(request.url).searchParams.get("id") || ""
  try {
    if (action === "plan") return NextResponse.json(await deletePlan(context, id))
    if (action === "document") return NextResponse.json(await deleteDocument(context, id))
    throw new MachineError("Exclusão não permitida.", 400)
  } catch (error) {
    return machineError(error, "Erro ao excluir.")
  }
}
