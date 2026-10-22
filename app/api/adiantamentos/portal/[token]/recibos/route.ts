import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { addReceiptPhoto, advanceError, companyScopedByToken } from "@/lib/travel-advance-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

/** Sobe uma foto de notinha: multipart { file, ocrText }. O texto já foi lido no navegador (mesmo OCR da importação de NF). */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const admin = await companyScopedByToken(createAdminClient, token)
    const form = await request.formData()
    const file = form.get("file")
    if (!(file instanceof File)) return NextResponse.json({ error: "Envie a foto da notinha." }, { status: 400 })
    const result = await addReceiptPhoto(admin, token, file, String(form.get("ocrText") || ""))
    return NextResponse.json({ receipt: result })
  } catch (error) {
    return NextResponse.json({ error: advanceError(error, "Erro ao enviar a notinha.").message }, { status: 400 })
  }
}
