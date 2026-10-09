import { NextResponse } from "next/server"
import { cleanCnpj, mapBrasilApiCnpj } from "@/lib/cnpj-lookup"
import { currentUserRole } from "@/lib/server-authorization"

export async function GET(_request: Request, context: { params: Promise<{ cnpj: string }> }) {
  const { user, role } = await currentUserRole()
  if (!user) return NextResponse.json({ error: "Nao autenticado." }, { status: 401 })
  if (role === "client") return NextResponse.json({ error: "Sem permissao para consultar CNPJ." }, { status: 403 })

  const cnpj = cleanCnpj((await context.params).cnpj)
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(cnpj)) {
    return NextResponse.json({ error: "Informe um CNPJ valido com 14 caracteres." }, { status: 400 })
  }

  try {
    const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${encodeURIComponent(cnpj)}`, {
      headers: { Accept: "application/json", "User-Agent": "MC-Climatizacao/1.0" },
      signal: AbortSignal.timeout(12_000),
      next: { revalidate: 60 * 60 * 24 },
    })
    const payload = await response.json().catch(() => null)
    if (response.status === 404) return NextResponse.json({ error: "CNPJ nao encontrado na Receita Federal." }, { status: 404 })
    if (!response.ok || !payload) {
      return NextResponse.json({ error: payload?.message || "Nao foi possivel consultar o CNPJ agora." }, { status: response.status >= 400 && response.status < 500 ? response.status : 502 })
    }
    return NextResponse.json({ company: mapBrasilApiCnpj(payload), source: "BrasilAPI" })
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
    return NextResponse.json({ error: timedOut ? "A consulta do CNPJ demorou demais. Tente novamente." : "Servico de consulta de CNPJ indisponivel." }, { status: 502 })
  }
}
