import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { SHOP_PHOTO_BUCKET, ShopError, shopError, uploadShopPhoto } from "@/lib/shop-floor-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Envio de fotografia de ocorrência/não conformidade: área privada, devolve só o caminho. */
export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const file = (await request.formData()).get("file")
    if (!(file instanceof File)) throw new ShopError("Envie uma imagem.")
    return NextResponse.json({ path: await uploadShopPhoto(context.admin, file) })
  } catch (error) {
    const mapped = shopError(error)
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}

/** Link temporário (5 minutos) para ver a fotografia. */
export async function GET(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const path = new URL(request.url).searchParams.get("path") || ""
  if (!/^\d{4}-\d{2}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(path)) return NextResponse.json({ error: "Arquivo inválido." }, { status: 400 })
  const { data, error } = await context.admin.storage.from(SHOP_PHOTO_BUCKET).createSignedUrl(path, 300)
  if (error || !data) return NextResponse.json({ error: "Arquivo não encontrado." }, { status: 404 })
  return NextResponse.redirect(data.signedUrl)
}
