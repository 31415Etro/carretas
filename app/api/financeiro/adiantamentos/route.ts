import { NextResponse } from "next/server"
import { stockContext } from "@/lib/stock-api"
import { ADVANCE_MIGRATION_HINT, advanceError, createAdvance, listAdvances } from "@/lib/travel-advance-server"

const bad = (error: unknown, fallback: string) => NextResponse.json({ error: advanceError(error, fallback).message }, { status: advanceError(error, fallback).message === ADVANCE_MIGRATION_HINT ? 503 : 400 })

export async function GET() {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    return NextResponse.json({ items: await listAdvances(context.admin) })
  } catch (error) {
    return bad(error, "Erro ao carregar os adiantamentos.")
  }
}

/** Cria um adiantamento e gera o link público (token). */
export async function POST(request: Request) {
  const context = await stockContext()
  if ("error" in context) return context.error
  try {
    const body = await request.json()
    const result = await createAdvance(context.admin, {
      employeeId: String(body.employeeId || ""), reason: String(body.reason || ""), amount: Number(body.amount || 0),
      startDate: String(body.startDate || ""), endDate: String(body.endDate || ""),
      bank: { bankName: String(body.bank?.bankName || ""), bankAgency: String(body.bank?.bankAgency || ""), bankAccount: String(body.bank?.bankAccount || ""), bankAccountType: String(body.bank?.bankAccountType || ""), pixKey: String(body.bank?.pixKey || "") },
    }, context.responsible)
    return NextResponse.json({ id: result.id, link: `/portal-adiantamento/${result.token}` })
  } catch (error) {
    return bad(error, "Erro ao criar o adiantamento.")
  }
}
