import { NextResponse } from "next/server"
import { cachedUser } from "@/lib/auth-cache"
import { clearPerf, perfSnapshot } from "@/lib/perf-monitor"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Único usuário que enxerga o monitor de lentidão. */
const PERFORMANCE_OWNER_EMAIL = "pmalvesi61@gmail.com"

async function allowed() {
  const user = await cachedUser(await createClient())
  return String(user?.email || "").trim().toLowerCase() === PERFORMANCE_OWNER_EMAIL
}

const denied = () => NextResponse.json({ error: "Acesso restrito." }, { status: 403 })

export async function GET(request: Request) {
  if (!(await allowed())) return denied()
  const limit = Math.min(500, Math.max(10, Number(new URL(request.url).searchParams.get("limite")) || 200))
  return NextResponse.json(perfSnapshot(limit))
}

/** Zera as medições (para medir de novo depois de uma melhoria). */
export async function DELETE() {
  if (!(await allowed())) return denied()
  clearPerf()
  return NextResponse.json({ ok: true })
}
