import { NextResponse } from "next/server"
import { audit, auditContext } from "@/lib/audit"
import { createClient } from "@/lib/supabase/server"
import { SYSTEM_COMPANY_COOKIE } from "@/lib/system-company"

export async function POST() {
  try {
    const supabase = await createClient()

    const context = await auditContext()
    await audit({ module: "acesso", action: "Logout", description: `Logout de ${context.actorEmail || "usuário"}.`, origin: "Usuário" })
    await supabase.auth.signOut()

    const response = NextResponse.json({ success: true })
    response.cookies.delete(SYSTEM_COMPANY_COOKIE)
    return response
  } catch (error) {
    console.error("[v0] Logout error:", error)
    return NextResponse.json({ error: "Logout failed" }, { status: 500 })
  }
}
