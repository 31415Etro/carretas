import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { photoError, readPhoto } from "@/lib/product-photos-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** URL estável da fotografia: o registro aponta o arquivo e a rota o lê no armazenamento privado. Exige login. */
export async function GET(_request: Request, { params }: { params: Promise<{ foto: string }> }) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const { foto } = await params
  if (!uuid.test(foto)) return NextResponse.json({ error: "Fotografia inválida." }, { status: 400 })
  try {
    const { bytes, type } = await readPhoto(context.admin, foto)
    return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=300" } })
  } catch (error) {
    const mapped = photoError(error)
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}
