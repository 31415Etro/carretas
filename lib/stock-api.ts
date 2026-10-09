import { NextResponse } from "next/server"
import { currentUserRole } from "@/lib/server-authorization"
import { createAdminClient } from "@/lib/supabase/server"
import { isStockEngineMissing, STOCK_MIGRATION_HINT } from "@/lib/stock-engine"

/** Usuário interno autenticado + client admin; clientes externos não acessam o estoque. */
export async function stockContext() {
  const { user, role } = await currentUserRole()
  if (!user) return { error: NextResponse.json({ error: "Nao autenticado." }, { status: 401 }) } as const
  if (role === "client") return { error: NextResponse.json({ error: "Acesso restrito ao estoque." }, { status: 403 }) } as const
  const responsible = String(user.user_metadata?.full_name || user.user_metadata?.name || user.email || "Usuario")
  return { admin: createAdminClient(), responsible } as const
}

export function stockError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback
  const missing = isStockEngineMissing(message) || message === STOCK_MIGRATION_HINT
  return NextResponse.json({ error: missing ? STOCK_MIGRATION_HINT : message }, { status: missing ? 503 : 400 })
}
