import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { listRegistry, registryError, saveRegistry, setRegistryStatus } from "@/lib/registry-server"

const bad = (error: unknown, fallback: string) => {
  const { message, status } = registryError(error, fallback)
  return NextResponse.json({ error: message }, { status })
}

export async function GET() {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    return NextResponse.json({ items: await listRegistry(context.admin, "client") })
  } catch (error) {
    return bad(error, "Erro ao carregar clientes.")
  }
}

export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const { item, linkFromId, statusOnly } = await request.json()
    if (statusOnly) return NextResponse.json({ item: await setRegistryStatus(context.admin, "client", String(statusOnly.id || ""), String(statusOnly.status || "")) })
    return NextResponse.json({ item: await saveRegistry(context.admin, "client", item || {}, context.responsible, String(linkFromId || "")) })
  } catch (error) {
    return bad(error, "Erro ao salvar cadastro.")
  }
}
