import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const headers = { Accept: "application/json", "User-Agent": "ND-Carretas/1.0" }
const get = async (url: string) => {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(6000), cache: "no-store" })
  return { ok: response.ok, payload: await response.json().catch(() => null) }
}

/** Confere um CEP (?cep=88317193) numa base oficial (BrasilAPI v2, com ViaCEP de reserva) e devolve logradouro, bairro, cidade e UF. */
export async function GET(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  const cep = (new URL(request.url).searchParams.get("cep") || "").replace(/\D/g, "")
  if (cep.length !== 8) return NextResponse.json({ error: "CEP inválido." }, { status: 400 })
  try {
    const brasil = await get(`https://brasilapi.com.br/api/cep/v2/${cep}`).catch(() => null)
    if (brasil?.ok && brasil.payload?.city) return NextResponse.json({ zip: { street: brasil.payload.street || "", district: brasil.payload.neighborhood || "", city: brasil.payload.city, state: brasil.payload.state || "" } })
    const via = await get(`https://viacep.com.br/ws/${cep}/json/`).catch(() => null)
    if (via?.ok && via.payload && !via.payload.erro) return NextResponse.json({ zip: { street: via.payload.logradouro || "", district: via.payload.bairro || "", city: via.payload.localidade || "", state: via.payload.uf || "" } })
    return NextResponse.json({ zip: null })
  } catch {
    return NextResponse.json({ zip: null })
  }
}
