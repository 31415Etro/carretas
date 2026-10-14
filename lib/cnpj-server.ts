import { cleanCnpj, formatCnpjZipCode, isGarbled, mapBrasilApiCnpj, mapCnpjWs, mergeCnpjCompanies, type CnpjCompany } from "@/lib/cnpj-lookup"

// Consulta de CNPJ no servidor com duas fontes públicas da Receita Federal:
//  - BrasilAPI (principal): razão social, fantasia, endereço, CNAEs, porte, natureza, quadro societário.
//  - cnpj.ws (complementar e reserva): inscrição estadual, e-mail e demais dados quando a BrasilAPI não traz ou está fora do ar.
// Os dados de uma fonte nunca sobrescrevem os da outra: a complementar só preenche o que faltou.

const headers = { Accept: "application/json", "User-Agent": "ND-Carretas/1.0" }

// cnpj.ws limita a 3 consultas por minuto por IP: acima disso, pula a fonte complementar em vez de falhar.
const wsHits: number[] = []
function wsAllowed() {
  const now = Date.now()
  while (wsHits.length && now - wsHits[0] > 60_000) wsHits.shift()
  if (wsHits.length >= 3) return false
  wsHits.push(now)
  return true
}

async function getJson(url: string, timeoutMs: number) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" })
  const payload = await response.json().catch(() => null)
  return { status: response.status, ok: response.ok, payload }
}

/** Cidade/bairro/rua que vieram com caracteres quebrados são refeitos pelo CEP (BrasilAPI CEP v2). */
async function repairAddress(company: CnpjCompany): Promise<CnpjCompany> {
  if (![company.city, company.district, company.street].some(isGarbled)) return company
  const cep = company.zipCode.replace(/\D/g, "")
  if (cep.length !== 8) return company
  // BrasilAPI CEP v2 primeiro; ViaCEP como reserva
  const sources: Array<() => Promise<{ city?: string; neighborhood?: string; street?: string } | null>> = [
    async () => {
      const { ok, payload } = await getJson(`https://brasilapi.com.br/api/cep/v2/${cep}`, 6_000)
      return ok && payload ? { city: payload.city, neighborhood: payload.neighborhood, street: payload.street } : null
    },
    async () => {
      const { ok, payload } = await getJson(`https://viacep.com.br/ws/${cep}/json/`, 6_000)
      return ok && payload && !payload.erro ? { city: payload.localidade, neighborhood: payload.bairro, street: payload.logradouro } : null
    },
  ]
  for (const source of sources) {
    try {
      const found = await source()
      if (!found) continue
      const fixed = { ...company }
      if (isGarbled(fixed.city) && found.city) fixed.city = String(found.city)
      if (isGarbled(fixed.district) && found.neighborhood) fixed.district = String(found.neighborhood).toUpperCase()
      if (isGarbled(fixed.street) && found.street) fixed.street = String(found.street).toUpperCase()
      fixed.zipCode = formatCnpjZipCode(cep)
      fixed.address = [fixed.street, fixed.number, fixed.complement, fixed.district, [fixed.city, fixed.state].filter(Boolean).join("/"), fixed.zipCode].filter(Boolean).join(", ")
      return fixed
    } catch {
      // tenta a próxima fonte
    }
  }
  return company
}

export type CnpjLookup =
  | { ok: true; company: CnpjCompany; source: string; consultedAt: string }
  | { ok: false; status: number; error: string }

export async function lookupCnpj(raw: string): Promise<CnpjLookup> {
  const cnpj = cleanCnpj(raw)
  const [brasil, ws] = await Promise.allSettled([
    getJson(`https://brasilapi.com.br/api/cnpj/v1/${encodeURIComponent(cnpj)}`, 12_000),
    wsAllowed() ? getJson(`https://publica.cnpj.ws/cnpj/${encodeURIComponent(cnpj)}`, 12_000) : Promise.reject(new Error("limite")),
  ])
  const brasilOk = brasil.status === "fulfilled" && brasil.value.ok && brasil.value.payload
  const wsOk = ws.status === "fulfilled" && ws.value.ok && ws.value.payload?.estabelecimento
  const notFound = (result: typeof brasil) => result.status === "fulfilled" && result.value.status === 404

  if (!brasilOk && !wsOk) {
    if (notFound(brasil) || notFound(ws)) return { ok: false, status: 404, error: "CNPJ não encontrado na Receita Federal." }
    if (brasil.status === "fulfilled" && brasil.value.status === 429) return { ok: false, status: 429, error: "O provedor limitou as consultas. Tente novamente em instantes." }
    const timedOut = brasil.status === "rejected" && brasil.reason instanceof Error && (brasil.reason.name === "TimeoutError" || brasil.reason.name === "AbortError")
    return { ok: false, status: 502, error: timedOut ? "A consulta demorou demais. Tente novamente." : "Não foi possível consultar o CNPJ agora (serviços da Receita indisponíveis)." }
  }

  const primary = brasilOk ? mapBrasilApiCnpj((brasil as PromiseFulfilledResult<any>).value.payload) : mapCnpjWs((ws as PromiseFulfilledResult<any>).value.payload)
  if (brasilOk) primary.tradeName = String((brasil as PromiseFulfilledResult<any>).value.payload.nome_fantasia || "").trim() // sem fantasia na Receita, fica em branco
  const extra = brasilOk && wsOk ? mapCnpjWs((ws as PromiseFulfilledResult<any>).value.payload) : null
  const company = await repairAddress(mergeCnpjCompanies(primary, extra))
  const source = brasilOk && wsOk ? "BrasilAPI + cnpj.ws (Receita Federal)" : brasilOk ? "BrasilAPI (Receita Federal)" : "cnpj.ws (Receita Federal)"
  return { ok: true, company, source, consultedAt: new Date().toISOString() }
}
