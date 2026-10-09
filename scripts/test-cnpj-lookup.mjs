import assert from "node:assert/strict"
import { createClient } from "@supabase/supabase-js"

process.loadEnvFile(".env.local")

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3001"
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const cookies = new Map()
let userId = ""

function absorbCookies(response) {
  for (const value of response.headers.getSetCookie()) {
    const pair = value.split(";", 1)[0]
    const separator = pair.indexOf("=")
    cookies.set(pair.slice(0, separator), pair.slice(separator + 1))
  }
}

async function api(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; ") },
  })
  absorbCookies(response)
  return { response, payload: await response.json().catch(() => ({})) }
}

try {
  const stamp = Date.now()
  const email = `teste-cnpj-${stamp}@example.com`
  const password = `Cnpj@${stamp}`
  const auth = await supabase.auth.admin.createUser({ email, password, email_confirm: true })
  if (auth.error || !auth.data.user) throw auth.error || new Error("Usuario de teste nao criado")
  userId = auth.data.user.id
  const profile = await supabase.from("profiles").upsert({ id: userId, email, full_name: "Teste Consulta CNPJ", role: "admin", page_permissions: ["clientes_obras"], active: true })
  if (profile.error) throw profile.error

  const login = await api("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
  assert.equal(login.response.status, 200, JSON.stringify(login.payload))
  const selectCompany = await api("/api/auth/companies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companyId: login.payload.companies?.[0]?.id }),
  })
  assert.equal(selectCompany.response.status, 200, JSON.stringify(selectCompany.payload))

  const lookup = await api("/api/cnpj/19131243000197", { cache: "no-store" })
  assert.equal(lookup.response.status, 200, JSON.stringify(lookup.payload))
  assert.equal(lookup.payload.company?.document, "19.131.243/0001-97")
  assert.ok(lookup.payload.company?.legalName, "Razao social nao retornada")
  assert.ok(lookup.payload.company?.city, "Cidade nao retornada")
  console.log(`PASS: CNPJ consultado - ${lookup.payload.company.tradeName || lookup.payload.company.legalName}`)

  const invalid = await api("/api/cnpj/123", { cache: "no-store" })
  assert.equal(invalid.response.status, 400, JSON.stringify(invalid.payload))
  console.log("PASS: CNPJ incompleto rejeitado")

  const cpf = await api("/api/cnpj/12345678901", { cache: "no-store" })
  assert.equal(cpf.response.status, 400, JSON.stringify(cpf.payload))
  console.log("PASS: CPF nao e enviado para consulta de CNPJ")
} finally {
  if (userId) {
    await supabase.from("profiles").delete().eq("id", userId)
    await supabase.auth.admin.deleteUser(userId)
  }
  console.log("CLEANUP: usuario temporario removido")
}
