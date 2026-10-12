import { NextResponse } from "next/server"
import { currentUserRole } from "@/lib/server-authorization"
import { stockContext } from "@/lib/stock-api"
import { getSelectedSystemCompany } from "@/lib/system-company-server"

const BUCKET = "quote-files"
const MAX_FILE_SIZE = 20 * 1024 * 1024
const attachmentTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"]
const logoTypes = ["image/jpeg", "image/png"]

const safeName = (name: string) => name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "arquivo"

/** Abre um anexo do orçamento (URL assinada de curta duração). */
export async function GET(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const path = new URL(request.url).searchParams.get("path") || ""
  if (!path || path.includes("..")) return NextResponse.json({ error: "Arquivo inválido." }, { status: 400 })
  const { data, error } = await context.admin.storage.from(BUCKET).createSignedUrl(path, 300)
  if (error || !data) return NextResponse.json({ error: "Arquivo não encontrado." }, { status: 404 })
  return NextResponse.redirect(data.signedUrl)
}

/** Envia um anexo (folder=anexos) ou o logotipo da empresa (folder=logo, só administrador/gerente; JPG ou PNG). */
export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const form = await request.formData()
  const file = form.get("file")
  const folder = form.get("folder") === "logo" ? "logo" : "anexos"
  if (!(file instanceof File)) return NextResponse.json({ error: "Selecione um arquivo." }, { status: 400 })
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "Arquivo acima de 20 MB." }, { status: 400 })
  if (!(folder === "logo" ? logoTypes : attachmentTypes).includes(file.type)) return NextResponse.json({ error: folder === "logo" ? "O logotipo deve ser JPG ou PNG." : "Envie JPG, PNG, WEBP ou PDF." }, { status: 400 })
  if (folder === "logo") {
    const { role } = await currentUserRole()
    if (role !== "admin" && role !== "manager") return NextResponse.json({ error: "Somente administrador ou gerente altera o logotipo." }, { status: 403 })
  }
  const company = folder === "logo" ? await getSelectedSystemCompany() : null
  const path = folder === "logo" ? `logo/${company!.id}-${Date.now()}.${file.type === "image/png" ? "png" : "jpg"}` : `anexos/${Date.now()}-${safeName(file.name)}`
  const { error } = await context.admin.storage.from(BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false })
  if (error) return NextResponse.json({ error: /bucket/i.test(error.message) ? "Rode scripts/210_orcamentos.sql para criar o armazenamento dos orçamentos." : error.message }, { status: 400 })
  if (folder === "logo") {
    const { error: updateError } = await context.admin.from("system_companies").update({ logo_path: path }).eq("id", company!.id)
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 400 })
  }
  return NextResponse.json({ path, name: file.name })
}
