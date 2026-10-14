import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { findByDocument, registryError } from "@/lib/registry-server"

/** Diz se o CPF/CNPJ já existe como cliente e/ou fornecedor. */
export async function GET(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    return NextResponse.json(await findByDocument(context.admin, new URL(request.url).searchParams.get("document") || ""))
  } catch (error) {
    const { message, status } = registryError(error, "Erro ao verificar o documento.")
    return NextResponse.json({ error: message }, { status })
  }
}
