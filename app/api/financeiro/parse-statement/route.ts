import { NextResponse } from "next/server"
import { parseBankStatement } from "@/lib/bank-statement-parser"
import { extractPdfText } from "@/lib/pdf-text-extractor"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const form = await request.formData()
    const file = form.get("file")
    if (!(file instanceof File)) return NextResponse.json({ error: "Arquivo PDF nao enviado." }, { status: 400 })
    if (file.size > 4 * 1024 * 1024) return NextResponse.json({ error: "PDF muito grande. Envie um arquivo com ate 4 MB." }, { status: 413 })
    if (file.type && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json({ error: "Envie um extrato em PDF." }, { status: 400 })
    }

    const extracted = await extractPdfText(file)
    const parsed = parseBankStatement(extracted.text)
    return NextResponse.json({ ...parsed, pages: extracted.pages, fileName: file.name })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao processar o extrato bancario." },
      { status: 500 },
    )
  }
}
