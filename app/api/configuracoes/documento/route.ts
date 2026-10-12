import { NextResponse } from "next/server"
import { configAccess, configError, documentLink } from "@/lib/config-server"

/** Abre um documento (URL assinada de 5 minutos), respeitando a visibilidade. */
export async function GET(request: Request) {
  const access = await configAccess({ allowStaff: true })
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status })
  try {
    const url = await documentLink(access.admin, access.root, new URL(request.url).searchParams.get("id") || "", { id: access.user.id, role: access.role })
    return NextResponse.redirect(url)
  } catch (error) {
    const { message, status } = configError(error, "Erro ao abrir o documento.")
    return NextResponse.json({ error: message }, { status })
  }
}
