import { NextResponse } from "next/server"
import { cleanCnpj } from "@/lib/cnpj-lookup"
import { lookupCnpj } from "@/lib/cnpj-server"
import { isValidCnpj } from "@/lib/commercial"
import { stockContext } from "@/lib/stock-api"

// Limite por usuário (a BrasilAPI também limita por IP): 20 consultas por minuto.
const hits = new Map<string, number[]>()
function allowed(key: string) {
  const now = Date.now()
  const recent = (hits.get(key) || []).filter((time) => now - time < 60_000)
  if (recent.length >= 20) { hits.set(key, recent); return false }
  hits.set(key, [...recent, now])
  return true
}

/** Consulta o CNPJ pelo servidor (BrasilAPI + cnpj.ws); a tela nunca chama o provedor direto. */
export async function GET(_request: Request, context: { params: Promise<{ cnpj: string }> }) {
  const auth = await stockContext()
  if ("error" in auth) return auth.error
  const cnpj = cleanCnpj((await context.params).cnpj)
  if (!isValidCnpj(cnpj)) return NextResponse.json({ error: "CNPJ inválido: confira os dígitos." }, { status: 400 })
  if (!allowed(auth.responsible)) return NextResponse.json({ error: "Muitas consultas seguidas. Aguarde um minuto e tente novamente." }, { status: 429 })

  const result = await lookupCnpj(cnpj)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ company: result.company, partners: result.company.partners, source: result.source, consultedAt: result.consultedAt })
}
