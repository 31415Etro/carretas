import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Link temporário (5 minutos) para abrir um documento de engenharia guardado em área privada. Exige login. */
export async function GET(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const path = new URL(request.url).searchParams.get("path") || ""
  if (!/^\d{4}-\d{2}\/[0-9a-f-]{36}-[A-Za-z0-9._-]+$/.test(path)) return NextResponse.json({ error: "Arquivo inválido." }, { status: 400 })
  const { data, error } = await context.admin.storage.from("engineering-files").createSignedUrl(path, 300)
  if (error || !data) return NextResponse.json({ error: "Arquivo não encontrado." }, { status: 404 })
  return NextResponse.redirect(data.signedUrl)
}
