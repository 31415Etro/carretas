import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { advanceError, applyReceiptOcr, companyScopedByToken, deleteReceipt, editReceipt } from "@/lib/travel-advance-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Corrige um campo lido errado pelo OCR, antes de finalizar. */
export async function PATCH(request: Request, { params }: { params: Promise<{ token: string; reciboId: string }> }) {
  try {
    const { token, reciboId } = await params
    const admin = await companyScopedByToken(createAdminClient, token)
    const body = await request.json()
    if (typeof body.ocrText === "string") return NextResponse.json({ ok: true, ...(await applyReceiptOcr(admin, token, reciboId, body.ocrText)) })
    await editReceipt(admin, token, reciboId, {
      amount: body.amount !== undefined ? Number(body.amount) : undefined,
      establishment: body.establishment !== undefined ? String(body.establishment) : undefined,
      occurredAt: body.occurredAt !== undefined ? String(body.occurredAt) : undefined,
      category: body.category !== undefined ? String(body.category) : undefined,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: advanceError(error, "Erro ao corrigir o registro.").message }, { status: 400 })
  }
}

/** Remove uma notinha enviada por engano (só enquanto o link está aberto e a nota não foi aprovada). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ token: string; reciboId: string }> }) {
  try {
    const { token, reciboId } = await params
    const admin = await companyScopedByToken(createAdminClient, token)
    await deleteReceipt(admin, token, reciboId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: advanceError(error, "Erro ao remover o registro.").message }, { status: 400 })
  }
}
