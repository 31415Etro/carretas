import { NextResponse } from "next/server"
import { NotaAsApiError, notaAsRequest, notaAsStatusPath, type NotaAsDocumentKind } from "@/lib/notaas"
import { isCurrentUserAdmin } from "@/lib/server-authorization"

export const dynamic = "force-dynamic"

async function test(kind: NotaAsDocumentKind) {
  try {
    await notaAsRequest(kind, notaAsStatusPath(kind, "00000000-0000-4000-8000-000000000001"))
    return { kind, connected: true, message: "Chave aceita pelo NotaAS." }
  } catch (error) {
    if (error instanceof NotaAsApiError && error.status === 404) return { kind, connected: true, message: "Chave aceita pelo NotaAS." }
    return { kind, connected: false, message: error instanceof Error ? error.message : "Falha de autenticacao." }
  }
}

export async function GET() {
  if (!(await isCurrentUserAdmin())) return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 })
  const results = await Promise.all([test("service"), test("material")])
  return NextResponse.json({ results }, { status: results.every((item) => item.connected) ? 200 : 502 })
}
