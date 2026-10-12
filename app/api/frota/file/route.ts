import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"

const BUCKET = "fleet-files"
const MAX_FILE_SIZE = 20 * 1024 * 1024
const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"]

const safeName = (name: string) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "arquivo"

/** Abre um arquivo da frota (URL assinada de curta duração). */
export async function GET(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const path = new URL(request.url).searchParams.get("path") || ""
  if (!path || path.includes("..")) return NextResponse.json({ error: "Arquivo inválido." }, { status: 400 })
  const { data, error } = await context.admin.storage.from(BUCKET).createSignedUrl(path, 300)
  if (error || !data) return NextResponse.json({ error: "Arquivo não encontrado." }, { status: 404 })
  return NextResponse.redirect(data.signedUrl)
}

/** Envia foto, documento ou comprovante (JPG, PNG, WEBP ou PDF até 20 MB). */
export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const form = await request.formData()
  const file = form.get("file")
  const folder = String(form.get("folder") || "geral").replace(/[^a-z]/g, "") || "geral"
  if (!(file instanceof File)) return NextResponse.json({ error: "Selecione um arquivo." }, { status: 400 })
  if (!allowed.includes(file.type)) return NextResponse.json({ error: "Envie JPG, PNG, WEBP ou PDF." }, { status: 400 })
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "Arquivo acima de 20 MB." }, { status: 400 })
  const path = `${folder}/${Date.now()}-${safeName(file.name)}`
  const { error } = await context.admin.storage.from(BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false })
  if (error) return NextResponse.json({ error: /bucket/i.test(error.message) ? "Rode scripts/208_frota_erp.sql para criar o armazenamento da frota." : error.message }, { status: 400 })
  return NextResponse.json({ path, name: file.name })
}
