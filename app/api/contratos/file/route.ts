import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"

const BUCKET = "contract-files"
const MAX_FILE_SIZE = 25 * 1024 * 1024
const allowed = ["application/pdf", "image/jpeg", "image/png", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]

const safeName = (name: string) => name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "arquivo"

/** Abre um documento do contrato (URL assinada de curta duração). */
export async function GET(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const path = new URL(request.url).searchParams.get("path") || ""
  if (!path || path.includes("..")) return NextResponse.json({ error: "Arquivo inválido." }, { status: 400 })
  const { data, error } = await context.admin.storage.from(BUCKET).createSignedUrl(path, 300)
  if (error || !data) return NextResponse.json({ error: "Arquivo não encontrado." }, { status: 404 })
  return NextResponse.redirect(data.signedUrl)
}

/** Envia o arquivo (PDF, JPG, PNG, DOC ou DOCX). Cada envio gera um caminho novo: nunca sobrescreve outro arquivo. */
export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const form = await request.formData()
  const file = form.get("file")
  if (!(file instanceof File)) return NextResponse.json({ error: "Selecione um arquivo." }, { status: 400 })
  if (!allowed.includes(file.type)) return NextResponse.json({ error: "Envie PDF, JPG, PNG, DOC ou DOCX." }, { status: 400 })
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "Arquivo acima de 25 MB." }, { status: 400 })
  const path = `contratos/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName(file.name)}`
  const { error } = await context.admin.storage.from(BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false })
  if (error) return NextResponse.json({ error: /bucket/i.test(error.message) ? "Rode scripts/211_contratos.sql para criar o armazenamento dos contratos." : error.message }, { status: 400 })
  return NextResponse.json({ path, name: file.name })
}
