import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { getSelectedSystemCompany } from "@/lib/system-company-server"

/** Logotipo da empresa selecionada (mesma origem, para o PDF do orçamento). */
export async function GET() {
  const context = await stockContext()
  if ("error" in context) return context.error
  const company = await getSelectedSystemCompany()
  const { data: row } = await context.admin.from("system_companies").select("logo_path").eq("id", company.id).maybeSingle()
  if (!row?.logo_path) return NextResponse.json({ error: "Logotipo não cadastrado." }, { status: 404 })
  const { data, error } = await context.admin.storage.from("quote-files").download(row.logo_path)
  if (error || !data) return NextResponse.json({ error: "Logotipo não encontrado." }, { status: 404 })
  return new NextResponse(Buffer.from(await data.arrayBuffer()), { headers: { "Content-Type": row.logo_path.endsWith(".png") ? "image/png" : "image/jpeg", "Cache-Control": "private, max-age=60" } })
}
