import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import { extractPdfText } from "@/lib/pdf-text-extractor"
import { stockContext } from "@/lib/stock-api"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const BUCKET = "client-documents"
const MAX_FILE_SIZE = 15 * 1024 * 1024
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"]
const KINDS = ["cnh", "residencia"]

const safeName = (name: string) => name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "arquivo"

/**
 * Guarda a CNH ou o comprovante de residência do cliente num bucket PRIVADO e devolve o caminho. Se for PDF com texto, devolve também o texto
 * (a leitura de foto/escaneamento é feita no navegador, por OCR). multipart: file, kind = "cnh" | "residencia".
 */
export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const form = await request.formData()
    const file = form.get("file")
    const kind = String(form.get("kind") || "")
    if (!(file instanceof File)) return NextResponse.json({ error: "Envie um arquivo." }, { status: 400 })
    if (!KINDS.includes(kind)) return NextResponse.json({ error: "Tipo de documento inválido." }, { status: 400 })
    if (!ALLOWED_TYPES.includes(file.type)) return NextResponse.json({ error: "Use foto JPG, PNG, WEBP ou PDF." }, { status: 400 })
    if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "Arquivo maior que 15 MB." }, { status: 400 })
    const { data: bucket } = await context.admin.storage.getBucket(BUCKET)
    if (!bucket) {
      const { error } = await context.admin.storage.createBucket(BUCKET, { public: false, fileSizeLimit: MAX_FILE_SIZE, allowedMimeTypes: ALLOWED_TYPES })
      if (error && !/already exists/i.test(error.message)) throw new Error(error.message)
    }
    const path = `${kind}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}-${safeName(file.name)}`
    const { error } = await context.admin.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false })
    if (error) throw new Error(error.message)
    let text = ""
    if (file.type === "application/pdf") {
      try { text = (await extractPdfText(file)).text } catch { text = "" }
    }
    return NextResponse.json({ path, name: file.name, text: text.length > 30 ? text : "" })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao enviar o documento." }, { status: 400 })
  }
}

/** Abre o documento (?path=): só usuário logado; o link do arquivo vale 2 minutos. */
export async function GET(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const path = new URL(request.url).searchParams.get("path") || ""
  if (!/^(cnh|residencia)\/[\w.\-\/]+$/.test(path) || path.includes("..")) return NextResponse.json({ error: "Documento inválido." }, { status: 400 })
  const { data, error } = await context.admin.storage.from(BUCKET).createSignedUrl(path, 120)
  if (error || !data?.signedUrl) return NextResponse.json({ error: "Documento não encontrado." }, { status: 404 })
  return NextResponse.redirect(data.signedUrl)
}
