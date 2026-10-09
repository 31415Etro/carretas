import assert from "node:assert/strict"
import fs from "node:fs"
import { createClient } from "@supabase/supabase-js"

process.loadEnvFile(".env.local")

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3002"
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const stamp = Date.now()
const email = `teste-extrato-${stamp}@example.com`
const password = `Extrato@${stamp}`
const files = [
  { name: "comprovante_05-10-2026 14-07-34.pdf", bank: "Sicoob", items: 13, entries: 20000, outputs: 73100.87 },
  { name: "extrato_1791220272.0478969.pdf", bank: "Ailos", items: 144, entries: 184360.52, outputs: 175523.96 },
  { name: "comprovante_05-10-2026 14-09-09.pdf", bank: "Sicoob", items: 30, entries: 93635.20, outputs: 60177.40 },
]
let userId = ""
const cookies = new Map()

function updateCookies(response) {
  response.headers.getSetCookie().forEach((header) => {
    const pair = header.split(";", 1)[0]
    const separator = pair.indexOf("=")
    cookies.set(pair.slice(0, separator), pair.slice(separator + 1))
  })
}

function cookieHeader() {
  return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ")
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(180000),
    ...options,
    headers: { ...(options.headers || {}), ...(cookies.size ? { Cookie: cookieHeader() } : {}) },
  })
  updateCookies(response)
  return response
}

async function json(response, label) {
  const text = await response.text()
  assert.equal(response.status, 200, `${label}: HTTP ${response.status} ${text.slice(0, 500)}`)
  return JSON.parse(text)
}

try {
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true })
  if (auth.error || !auth.data.user) throw auth.error || new Error("Usuario temporario nao criado")
  userId = auth.data.user.id
  const profile = await db.from("profiles").upsert({
    id: userId,
    email,
    full_name: "TESTE IMPORTACAO EXTRATO",
    role: "admin",
    page_permissions: ["financeiro"],
    active: true,
  })
  if (profile.error) throw profile.error

  await json(await request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }), "login")

  const companies = await json(await request("/api/auth/companies"), "listar empresas")
  assert.ok(companies.companies?.length, "Nenhuma empresa ativa para o teste")
  await json(await request("/api/auth/companies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companyId: companies.companies[0].id }),
  }), "selecionar empresa")

  for (const expected of files) {
    assert.ok(fs.existsSync(expected.name), `Arquivo ausente: ${expected.name}`)
    const form = new FormData()
    form.append("file", new Blob([fs.readFileSync(expected.name)], { type: "application/pdf" }), expected.name)
    const parsed = await json(await request("/api/financeiro/parse-statement", { method: "POST", body: form }), expected.name)
    assert.equal(parsed.bank, expected.bank)
    assert.equal(parsed.periodStart, "2026-09-01")
    assert.equal(parsed.periodEnd, "2026-09-30")
    assert.ok(parsed.items.length > 0, `${expected.name}: nenhuma movimentacao`)
    assert.ok(parsed.items.some((item) => item.type === "Entrada"), `${expected.name}: nenhuma entrada`)
    assert.ok(parsed.items.some((item) => item.type === "Saida"), `${expected.name}: nenhuma saida`)
    assert.equal(new Set(parsed.items.map((item) => item.sourceKey)).size, parsed.items.length, `${expected.name}: chaves duplicadas`)
    assert.ok(parsed.items.every((item) => !/SALDO|RDC AUTOMATICO|RESGATE RDC/i.test(item.description)), `${expected.name}: saldo ou RDC importado`)
    const entries = parsed.items.filter((item) => item.type === "Entrada").reduce((sum, item) => sum + item.amount, 0)
    const outputs = parsed.items.filter((item) => item.type === "Saida").reduce((sum, item) => sum + item.amount, 0)
    assert.equal(parsed.items.length, expected.items, `${expected.name}: quantidade divergente`)
    assert.equal(Number(entries.toFixed(2)), expected.entries, `${expected.name}: total de entradas divergente`)
    assert.equal(Number(outputs.toFixed(2)), expected.outputs, `${expected.name}: total de saidas divergente`)
    console.log(`PASS ${expected.name}: ${parsed.bank}, ${parsed.pages} pagina(s), ${parsed.items.length} itens, entradas R$ ${entries.toFixed(2)}, saidas R$ ${outputs.toFixed(2)}, ignoradas ${parsed.ignoredCount}`)
  }
} finally {
  if (userId) {
    await db.from("profiles").delete().eq("id", userId)
    await db.auth.admin.deleteUser(userId)
  }
}
