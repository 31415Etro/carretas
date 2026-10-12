import { NextResponse } from "next/server"
import { configAccess, configError, createDocument, saveCertificate, saveLogo } from "@/lib/config-server"

/** Envios (multipart): kind = certificado | logo (administrador) ou documento (qualquer usuário interno). */
export async function POST(request: Request) {
  const form = await request.formData()
  const kind = String(form.get("kind") || "")
  const access = await configAccess({ allowStaff: kind === "documento" })
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status })
  try {
    const file = form.get("file")
    if (!(file instanceof File)) return NextResponse.json({ error: "Selecione um arquivo." }, { status: 400 })
    const actor = { id: access.user.id, email: access.user.email || "" }
    if (kind === "certificado") {
      await saveCertificate(access.root, String(form.get("companyId") || ""), { file, password: String(form.get("password") || ""), expiresAt: String(form.get("expiresAt") || "") }, actor)
      return NextResponse.json({ ok: true })
    }
    if (kind === "logo") {
      await saveLogo(access.root, String(form.get("companyId") || ""), file)
      return NextResponse.json({ ok: true })
    }
    if (kind === "documento") {
      const name = String(access.user.user_metadata?.full_name || access.user.email || "Usuario")
      const version = await createDocument(access.admin, access.root, { id: actor.id, email: actor.email, name }, { docType: String(form.get("docType") || ""), title: String(form.get("title") || ""), entityType: String(form.get("entityType") || ""), entityRef: String(form.get("entityRef") || ""), visibility: String(form.get("visibility") || "Todos"), docDate: String(form.get("docDate") || ""), notes: String(form.get("notes") || ""), file })
      return NextResponse.json({ ok: true, version })
    }
    return NextResponse.json({ error: "Tipo de envio desconhecido." }, { status: 400 })
  } catch (error) {
    const { message, status } = configError(error, "Erro no envio.")
    return NextResponse.json({ error: message }, { status })
  }
}
