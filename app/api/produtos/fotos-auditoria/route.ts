import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { auditPhotos, photoError, PhotoError } from "@/lib/product-photos-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

/** Auditoria das fotografias antigas (só administrador): { mode: "catalogar" | "verificar" }. Não apaga nem substitui nenhuma imagem. */
export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    if (context.role !== "admin") throw new PhotoError("Somente o administrador executa a auditoria das fotografias.", 403)
    const body = await request.json().catch(() => ({}))
    const mode = body.mode === "verificar" ? "verificar" : "catalogar"
    return NextResponse.json({ audit: await auditPhotos(context.admin, mode, context.responsible) })
  } catch (error) {
    const mapped = photoError(error)
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}
