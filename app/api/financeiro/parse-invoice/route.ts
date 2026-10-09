import { NextResponse } from "next/server"
import {
  parseCreditCardInvoicePdf,
  type FinancialState,
} from "@/lib/financial-storage"
import { extractPdfText } from "@/lib/pdf-text-extractor"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const form = await request.formData()
    const file = form.get("file")
    const stateRaw = form.get("state")
    const cardId = String(form.get("cardId") || "")
    const fallbackRaw = form.get("fallback")
    const manualText = String(form.get("rawText") || "")

    if (!(file instanceof File) && !manualText.trim()) {
      return NextResponse.json({ text: "", pages: 0, error: "Arquivo nao enviado." }, { status: 400 })
    }

    if (file instanceof File && file.size > 4 * 1024 * 1024) {
      return NextResponse.json({ text: "", pages: 0, error: "PDF muito grande para processamento web. Envie um arquivo com ate 4 MB." }, { status: 413 })
    }

    const fallback = fallbackRaw ? JSON.parse(String(fallbackRaw)) : {
      referenceMonth: String(new Date().getMonth() + 1),
      referenceYear: String(new Date().getFullYear()),
      dueDate: new Date().toISOString().slice(0, 10),
      holderName: "",
    }
    const state = stateRaw ? JSON.parse(String(stateRaw)) as FinancialState : null

    if (!(file instanceof File)) {
      if (!state) return NextResponse.json({ text: manualText, pages: 0 })
      const parsed = await parseCreditCardInvoicePdf(new File([manualText], "fatura.txt", { type: "text/plain" }), state, cardId, fallback, manualText)
      return NextResponse.json({ ...parsed, text: manualText, pages: 0, parser: "manual-text" })
    }

    const extracted = await extractPdfText(file)
    const text = extracted.text
    if (!state) return NextResponse.json({ text, pages: extracted.pages, parser: "pdfjs-text" })

    const parsed = await parseCreditCardInvoicePdf(file, state, cardId, fallback, manualText.trim() || text)
    return NextResponse.json({
      ...parsed,
      text,
      pages: extracted.pages,
      parser: "pdfjs-text",
      warnings: [
        ...(parsed.warnings || []),
        ...(!parsed.items.length ? ["Nao encontrei linhas de fatura no texto extraido. Se o arquivo for PDF escaneado como imagem, envie um PDF com texto selecionavel ou cole o texto extraido no campo de apoio."] : []),
      ],
    })
  } catch (error) {
    return NextResponse.json(
      { text: "", pages: 0, error: error instanceof Error ? error.message : "Falha ao ler PDF." },
      { status: 500 },
    )
  }
}
