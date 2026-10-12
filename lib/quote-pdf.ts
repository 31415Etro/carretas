// PDF do orçamento (gerado no navegador com jsPDF). Não mostra custo nem margem.

export type QuotePdfData = {
  company: { name: string; legalName: string; cnpj: string; email: string; phone: string; address: string; hasLogo: boolean }
  quote: {
    number: string; version: number; issueDate: string; validUntil: string; quoteType: string; clientName: string; salespersonName: string; paymentConditionName: string; deliveryText: string
    warrantyDays: number; notes: string; itemsSubtotal: number; discountAmount: number; freightAmount: number; expensesAmount: number; taxPercent: number; taxesAmount: number; totalAmount: number
  }
  client: { document: string; phone: string; email: string }
  items: Array<{ description: string; unit: string; quantity: number; unitPrice: number; discountPercent: number; total: number }>
}

const brl = (value: number) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const day = (value: string) => (value ? value.slice(0, 10).split("-").reverse().join("/") : "-")
const qty = (value: number) => Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 3 })

async function loadLogo() {
  try {
    const response = await fetch("/api/orcamentos/logo", { cache: "no-store" })
    if (!response.ok) return null
    const blob = await response.blob()
    const dataUrl: string = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
    const size: { width: number; height: number } = await new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
      image.onerror = reject
      image.src = dataUrl
    })
    return { dataUrl, format: blob.type === "image/png" ? "PNG" : "JPEG", ...size }
  } catch {
    return null
  }
}

/** Gera o PDF e devolve o documento (para salvar) e o conteúdo em base64 (para anexar ao e-mail). */
export async function buildQuotePdf(data: QuotePdfData) {
  const { jsPDF } = await import("jspdf")
  const doc = new jsPDF({ unit: "mm", format: "a4" })
  const width = doc.internal.pageSize.getWidth()
  const height = doc.internal.pageSize.getHeight()
  const margin = 14
  let y = margin

  const logo = data.company.hasLogo ? await loadLogo() : null
  if (logo) {
    const boxWidth = 44
    const boxHeight = 20
    const ratio = Math.min(boxWidth / logo.width, boxHeight / logo.height)
    doc.addImage(logo.dataUrl, logo.format, margin, y, logo.width * ratio, logo.height * ratio)
  } else {
    doc.setFont("helvetica", "bold").setFontSize(16).text(data.company.name, margin, y + 7)
  }
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(90)
  const companyLines = [data.company.legalName || data.company.name, data.company.cnpj && `CNPJ ${data.company.cnpj}`, data.company.address, [data.company.phone, data.company.email].filter(Boolean).join(" · ")].filter(Boolean) as string[]
  companyLines.forEach((line, index) => doc.text(line, width - margin, y + 3 + index * 4, { align: "right" }))
  y += 24
  doc.setDrawColor(200).line(margin, y, width - margin, y)
  y += 8

  doc.setTextColor(20).setFont("helvetica", "bold").setFontSize(15).text(`Orçamento ${data.quote.number}${data.quote.version > 1 ? ` · versão ${data.quote.version}` : ""}`, margin, y)
  y += 6
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(60)
  doc.text(`Emissão: ${day(data.quote.issueDate)}    Validade: ${day(data.quote.validUntil)}    Tipo: ${data.quote.quoteType}    Vendedor: ${data.quote.salespersonName}`, margin, y)
  y += 8

  doc.setTextColor(20).setFont("helvetica", "bold").setFontSize(10).text("Cliente", margin, y)
  y += 5
  doc.setFont("helvetica", "normal").setFontSize(9)
  doc.text(data.quote.clientName, margin, y)
  y += 4.5
  doc.setTextColor(80).text([data.client.document && `CPF/CNPJ ${data.client.document}`, data.client.phone, data.client.email].filter(Boolean).join("  ·  ") || "-", margin, y)
  y += 9

  // tabela de itens
  const columns = [
    { label: "#", x: margin, w: 8, align: "left" as const },
    { label: "Descrição", x: margin + 8, w: 82, align: "left" as const },
    { label: "Un.", x: margin + 90, w: 12, align: "left" as const },
    { label: "Qtd.", x: margin + 102, w: 18, align: "right" as const },
    { label: "Preço unit.", x: margin + 120, w: 24, align: "right" as const },
    { label: "Desc.", x: margin + 144, w: 14, align: "right" as const },
    { label: "Total", x: margin + 158, w: 24, align: "right" as const },
  ]
  const header = () => {
    doc.setFillColor(238, 243, 249).rect(margin, y - 4.5, width - margin * 2, 7, "F")
    doc.setFont("helvetica", "bold").setFontSize(8.5).setTextColor(20)
    columns.forEach((column) => doc.text(column.label, column.align === "right" ? column.x + column.w : column.x + 1, y, { align: column.align === "right" ? "right" : "left" }))
    y += 6
  }
  header()
  doc.setFont("helvetica", "normal").setFontSize(8.5)
  data.items.forEach((item, index) => {
    const description = doc.splitTextToSize(item.description, columns[1].w - 2) as string[]
    const rowHeight = Math.max(description.length * 4, 5) + 1.5
    if (y + rowHeight > height - 40) {
      doc.addPage()
      y = margin + 4
      header()
      doc.setFont("helvetica", "normal").setFontSize(8.5)
    }
    doc.setTextColor(30)
    doc.text(String(index + 1), columns[0].x + 1, y)
    doc.text(description, columns[1].x + 1, y)
    doc.text(item.unit, columns[2].x + 1, y)
    doc.text(qty(item.quantity), columns[3].x + columns[3].w, y, { align: "right" })
    doc.text(brl(item.unitPrice), columns[4].x + columns[4].w, y, { align: "right" })
    doc.text(item.discountPercent ? `${qty(item.discountPercent)}%` : "-", columns[5].x + columns[5].w, y, { align: "right" })
    doc.text(brl(item.total), columns[6].x + columns[6].w, y, { align: "right" })
    y += rowHeight
    doc.setDrawColor(230).line(margin, y - 2.5, width - margin, y - 2.5)
  })

  // totais
  if (y + 45 > height - 30) { doc.addPage(); y = margin + 4 }
  y += 3
  const totalsX = width - margin
  const line = (label: string, value: string, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(bold ? 11 : 9).setTextColor(20)
    doc.text(label, totalsX - 62, y)
    doc.text(value, totalsX, y, { align: "right" })
    y += bold ? 7 : 5
  }
  line("Subtotal", brl(data.quote.itemsSubtotal))
  if (data.quote.discountAmount) line("Desconto", `- ${brl(data.quote.discountAmount)}`)
  if (data.quote.freightAmount) line("Frete", brl(data.quote.freightAmount))
  if (data.quote.expensesAmount) line("Despesas adicionais", brl(data.quote.expensesAmount))
  if (data.quote.taxesAmount) line(`Impostos (${qty(data.quote.taxPercent)}%)`, brl(data.quote.taxesAmount))
  line("Total", brl(data.quote.totalAmount), true)

  // condições
  y += 3
  doc.setFont("helvetica", "bold").setFontSize(10).text("Condições comerciais", margin, y)
  y += 5
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(50)
  const conditions = [
    `Condição de pagamento: ${data.quote.paymentConditionName || "-"}`,
    `Prazo de entrega/execução: ${data.quote.deliveryText || "a combinar"}`,
    `Garantia: ${data.quote.warrantyDays ? `${data.quote.warrantyDays} dias` : "conforme legislação"}`,
    `Validade da proposta: até ${day(data.quote.validUntil)}. Os preços acima são os negociados neste orçamento.`,
  ]
  for (const text of [...conditions, ...(data.quote.notes ? [`Observações: ${data.quote.notes}`] : [])]) {
    for (const wrapped of doc.splitTextToSize(text, width - margin * 2) as string[]) {
      if (y > height - 28) { doc.addPage(); y = margin + 4 }
      doc.text(wrapped, margin, y)
      y += 4.5
    }
  }

  // aceite
  if (y > height - 40) { doc.addPage(); y = margin + 4 }
  y += 10
  doc.setDrawColor(120).line(margin, y, margin + 80, y).line(width - margin - 60, y, width - margin, y)
  doc.setFontSize(8).setTextColor(90)
  doc.text("De acordo — responsável pelo aceite", margin, y + 4)
  doc.text("Data", width - margin - 60, y + 4)

  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page)
    doc.setFontSize(7.5).setTextColor(130).text(`${data.company.name} · Orçamento ${data.quote.number}${data.quote.version > 1 ? ` v${data.quote.version}` : ""} · página ${page} de ${pages}`, width / 2, height - 8, { align: "center" })
  }
  const dataUri = doc.output("datauristring")
  return { doc, fileName: `${data.quote.number}${data.quote.version > 1 ? `-v${data.quote.version}` : ""}.pdf`, base64: dataUri.slice(dataUri.indexOf("base64,") + 7) }
}
