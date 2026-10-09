import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"

const BUCKET = "catalog-files"
const MAX_FILE_SIZE = 15 * 1024 * 1024
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"]

function safeName(name: string) {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "arquivo"
}

/** Foto (JPG/PNG/WEBP) ou ficha técnica (PDF) de um item do catálogo. Retorna a URL pública. */
export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const form = await request.formData()
    const file = form.get("file")
    if (!(file instanceof File)) return NextResponse.json({ error: "Envie um arquivo." }, { status: 400 })
    if (!ALLOWED_TYPES.includes(file.type)) return NextResponse.json({ error: "Use imagem JPG, PNG, WEBP ou PDF." }, { status: 400 })
    if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "Arquivo maior que 15 MB." }, { status: 400 })
    const { data: bucket } = await context.admin.storage.getBucket(BUCKET)
    if (!bucket) {
      const { error } = await context.admin.storage.createBucket(BUCKET, { public: true, fileSizeLimit: MAX_FILE_SIZE, allowedMimeTypes: ALLOWED_TYPES })
      if (error && !/already exists/i.test(error.message)) throw new Error(error.message)
    }
    const path = `${new Date().toISOString().slice(0, 7)}/${randomUUID()}-${safeName(file.name)}`
    const { error } = await context.admin.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false })
    if (error) throw new Error(error.message)
    const { data } = context.admin.storage.from(BUCKET).getPublicUrl(path)
    return NextResponse.json({ url: data.publicUrl, name: file.name })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao enviar arquivo." }, { status: 400 })
  }
}
