import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"

export const runtime = "nodejs"

const BUCKET = "engineering-files"
const MAX_FILE_SIZE = 40 * 1024 * 1024
const ALLOWED_EXTENSIONS = /\.(pdf|jpe?g|png|webp|dwg|dxf|step|stp|iges|igs|zip|docx?)$/i

function safeName(name: string) {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "arquivo"
}

/** Documentos de engenharia (desenho, CCT, CAT, memorial, fotos, CAD) vão para uma área PRIVADA; o acesso é por link temporário (/api/engenharia/arquivo). */
export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const form = await request.formData()
    const file = form.get("file")
    if (!(file instanceof File)) return NextResponse.json({ error: "Envie um arquivo." }, { status: 400 })
    if (!ALLOWED_EXTENSIONS.test(file.name)) return NextResponse.json({ error: "Tipo de arquivo não aceito. Use PDF, imagem, DWG/DXF, STEP/IGES, ZIP ou Word." }, { status: 400 })
    if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "Arquivo maior que 40 MB." }, { status: 400 })
    const { data: bucket } = await context.admin.storage.getBucket(BUCKET)
    if (!bucket) {
      const { error } = await context.admin.storage.createBucket(BUCKET, { public: false, fileSizeLimit: MAX_FILE_SIZE })
      if (error && !/already exists/i.test(error.message)) throw new Error(error.message)
    }
    const path = `${new Date().toISOString().slice(0, 7)}/${randomUUID()}-${safeName(file.name)}`
    const { error } = await context.admin.storage.from(BUCKET).upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false })
    if (error) throw new Error(error.message)
    return NextResponse.json({ path, name: file.name })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao enviar o arquivo." }, { status: 400 })
  }
}
