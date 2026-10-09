import { randomUUID } from "node:crypto"
import { createClient } from "@supabase/supabase-js"

process.loadEnvFile(".env.local")

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3003"
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

let userId = ""

try {
  const email = `teste-performance-${randomUUID()}@example.com`
  const password = `Performance!${randomUUID()}`
  const created = await supabase.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error || !created.data.user) throw created.error || new Error("Usuario temporario nao criado")
  userId = created.data.user.id

  const profile = await supabase.from("profiles").upsert({
    id: userId,
    email,
    full_name: "TESTE TEMPORARIO PERFORMANCE",
    role: "admin",
    page_permissions: ["dashboard"],
    active: true,
  })
  if (profile.error) throw profile.error

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
  if (!login.ok) throw new Error(`Login falhou: HTTP ${login.status}`)
  const cookie = login.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ")

  const startedAt = performance.now()
  const sections = await Promise.all(["registry", "pmoc", "execution"].map(async (section) => {
    const sectionStartedAt = performance.now()
    const response = await fetch(`${baseUrl}/api/operational-state?section=${section}`, { headers: { Cookie: cookie } })
    const body = await response.text()
    if (!response.ok) throw new Error(`${section}: HTTP ${response.status} ${body.slice(0, 300)}`)
    const payload = JSON.parse(body)
    if (!payload.state) throw new Error(`${section}: resposta sem estado`)
    return {
      section,
      durationMs: Math.round(performance.now() - sectionStartedAt),
      sizeKb: Math.round(Buffer.byteLength(body) / 1024),
    }
  }))

  console.log(JSON.stringify({ ok: true, totalDurationMs: Math.round(performance.now() - startedAt), sections }))
} finally {
  if (userId) {
    await supabase.from("profiles").delete().eq("id", userId)
    await supabase.auth.admin.deleteUser(userId)
  }
  console.log("CLEANUP: usuario temporario removido")
}
