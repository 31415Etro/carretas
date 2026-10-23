import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { listPhotos, photoError, PhotoError, removePhoto, reorderPhotos, setMainPhoto, updatePhoto, uploadPhoto } from "@/lib/product-photos-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fail = (error: unknown) => { const mapped = photoError(error); return NextResponse.json({ error: mapped.message }, { status: mapped.status }) }

/** Galeria do produto: fotografias com caminho definitivo no armazenamento (a tela usa a URL estável /api/produtos/foto/<id>). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const { id } = await params
  if (!uuid.test(id)) return NextResponse.json({ error: "Produto inválido." }, { status: 400 })
  try { return NextResponse.json({ photos: await listPhotos(context.admin, id) }) } catch (error) { return fail(error) }
}

/** Envio (multipart: file, purpose, caption, makeMain) ou ação em JSON: set_main, reorder, update, remove (remoção só admin/gerente). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const { id } = await params
  if (!uuid.test(id)) return NextResponse.json({ error: "Produto inválido." }, { status: 400 })
  try {
    if ((request.headers.get("content-type") || "").includes("multipart/form-data")) {
      const form = await request.formData()
      const file = form.get("file")
      if (!(file instanceof File)) throw new PhotoError("Envie um arquivo.")
      const saved = await uploadPhoto(context.admin, id, file, { purpose: String(form.get("purpose") || "comercial"), caption: String(form.get("caption") || ""), makeMain: form.get("makeMain") === "1" }, context.responsible)
      return NextResponse.json({ saved, photos: await listPhotos(context.admin, id) })
    }
    const body = await request.json()
    const photoId = String(body.photoId || "")
    if (body.action !== "reorder" && !uuid.test(photoId)) throw new PhotoError("Fotografia inválida.")
    if (body.action === "set_main") await setMainPhoto(context.admin, photoId, context.responsible)
    else if (body.action === "reorder") await reorderPhotos(context.admin, id, (body.ids as string[]) || [])
    else if (body.action === "update") await updatePhoto(context.admin, photoId, { caption: body.caption, purpose: body.purpose })
    else if (body.action === "remove") {
      if (context.role !== "admin" && context.role !== "manager") throw new PhotoError("Só administrador ou gerente remove fotografias.", 403)
      await removePhoto(context.admin, photoId, String(body.reason || ""), context.responsible)
    } else throw new PhotoError("Ação desconhecida.")
    return NextResponse.json({ photos: await listPhotos(context.admin, id) })
  } catch (error) { return fail(error) }
}
