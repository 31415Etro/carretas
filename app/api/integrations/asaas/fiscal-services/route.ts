import { NextResponse } from "next/server"
import { AsaasApiError, asaasRequest } from "@/lib/asaas"
import { isCurrentUserAdmin } from "@/lib/server-authorization"
import { createAdminClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  if (!(await isCurrentUserAdmin())) return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 })
  try {
    const url = new URL(request.url)
    const kind = url.searchParams.get("kind") === "material" ? "material" : "service"
    const query = String(url.searchParams.get("query") || "").trim()
    if (kind === "material") {
      const admin = createAdminClient()
      let builder = admin.from("materials").select("id,name,internal_code,unit,category").eq("status", "Ativo").order("name").limit(100)
      if (query) builder = builder.or(`name.ilike.%${query.replace(/[%_,]/g, "")}%,internal_code.ilike.%${query.replace(/[%_,]/g, "")}%`)
      const { data, error } = await builder
      if (error) throw error
      return NextResponse.json({ items: (data || []).map((item) => ({ id: item.id, code: item.internal_code || item.id, name: item.name, description: `${item.internal_code || "Sem codigo"} - ${item.name}` })) })
    }
    const params = new URLSearchParams({ limit: "100", offset: "0" })
    if (query) params.set("description", query)
    try {
      const page = await asaasRequest<{ data?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>>("services", `/fiscalInfo/services?${params}`)
      const source = Array.isArray(page) ? page : (page.data || [])
      const items = source.map((item) => ({ id: item.id, code: item.code || "", name: item.description || item.name || item.id, description: item.description || item.name || item.id }))
      return NextResponse.json({
        items,
        selectionMode: items.length ? "catalog" : "manual",
        message: items.length ? undefined : "Nenhum servico municipal foi disponibilizado pelo Asaas. Informe o codigo e a descricao municipal manualmente.",
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      const normalized = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      const manualEntryRequired = error instanceof AsaasApiError && (
        normalized.includes("codigo de servicos municipais nao esta habilitado") ||
        normalized.includes("portal nacional") ||
        normalized.includes("servico municipal nao esta habilitado")
      )
      if (!manualEntryRequired) throw error
      return NextResponse.json({
        items: [],
        selectionMode: "manual",
        message: "Esta conta nao disponibiliza o catalogo municipal pelo Asaas. Informe o codigo e a descricao municipal manualmente.",
      })
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao consultar catalogo fiscal." }, { status: 400 })
  }
}
