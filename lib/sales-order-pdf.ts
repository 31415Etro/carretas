// PDF do Pedido de Venda (montado no navegador com jsPDF). Usa SOMENTE o pedido e a configuração congelada da venda:
// as medidas do cadastro atual do produto nunca entram aqui.
import { dimensionsText } from "./configurator.ts"
import { drawingDims, renderTrailerSvg } from "./trailer-drawing.ts"

export type SalesPdfItem = {
  description: string; product_name: string; product_model: string; sku?: string; line_type: string; quantity: number; unit: string; unit_price: number; discount_percent: number; total: number; lead_time_days?: number | null
  photo: { dataUrl: string | null; format: string; problem: string }
  configuration: null | {
    summary: string; status: string; homologated: boolean; revision_label: string | null; params: Record<string, number>; derived: Record<string, { label: string; value: number; unit: string }>
    options: { acabamento?: string | null; acessorios?: string[]; selected?: Array<{ group: string; label: string; code: string }> }; drawing_spec: { grade: "ilustrativo" | "validado"; geometry?: Record<string, number> } | null; frozen_at: string | null
  }
}
export type SalesPdfData = {
  company: { name: string; legalName: string; cnpj: string; email: string; phone: string; address: string; hasLogo: boolean }
  client: { name: string; document: string; phone: string; email: string }
  order: { number: string; date: string; deliveryDate: string | null; quoteNumber: string | null; totalAmount: number; itemsTotal: number; discount: number; freight: number; expenses: number; taxes: number; paymentCondition: string; paymentMethod: string; warrantyDays: number; salesperson: string; notes: string }
  installments: Array<{ number: number; dueDate: string; amount: number }>
  items: SalesPdfItem[]
}

const brl = (value: number) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const day = (value: string | null | undefined) => (value ? value.slice(0, 10).split("-").reverse().join("/") : "-")
const qty = (value: number) => Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 3 })

/** Linhas "característica: valor" da configuração vendida (medidas escolhidas, acabamento, acessórios e referências do projeto). */
export function configurationFacts(configuration: NonNullable<SalesPdfItem["configuration"]>) {
  const facts: Array<[string, string]> = []
  const p = configuration.params || {}
  const dims = dimensionsText(p)
  if (p.comprimento) facts.push(["Comprimento", `${Number(p.comprimento).toLocaleString("pt-BR")} mm`])
  if (p.largura) facts.push(["Largura", `${Number(p.largura).toLocaleString("pt-BR")} mm`])
  if (p.altura) facts.push(["Altura", `${Number(p.altura).toLocaleString("pt-BR")} mm`])
  if (dims) facts.push(["Dimensões (C x L x A)", dims])
  for (const [key, label] of [["pbt", "PBT"], ["tara", "Tara de referência"], ["lotacao", "Lotação de referência"], ["eixos", "Eixos"]] as const) if (p[key] !== undefined) facts.push([label, `${Number(p[key]).toLocaleString("pt-BR")}${key === "eixos" ? "" : " kg"}`])
  const finish = configuration.options.selected?.find((option) => option.group === "acabamento")
  facts.push(["Acabamento", finish?.label || "Padrão do modelo"])
  const accessories = (configuration.options.selected || []).filter((option) => option.group === "acessorio").map((option) => option.label)
  facts.push(["Acessórios", accessories.length ? accessories.join(", ") : "Nenhum"])
  facts.push(["Validação técnica", configuration.homologated && configuration.status === "Valida" ? `Dentro dos parâmetros homologados (revisão ${configuration.revision_label || "-"})` : configuration.status === "Aprovada pela engenharia" ? "Aprovada pela engenharia (análise técnica específica)" : configuration.status])
  return facts
}

async function loadLogo() {
  try {
    const response = await fetch("/api/orcamentos/logo", { cache: "no-store" })
    if (!response.ok) return null
    const blob = await response.blob()
    const dataUrl: string = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob) })
    const size: { width: number; height: number } = await new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight }); image.onerror = reject; image.src = dataUrl })
    return { dataUrl, format: blob.type === "image/png" ? "PNG" : "JPEG", ...size }
  } catch { return null }
}

/** SVG do desenho -> PNG (para o PDF). */
async function svgToPng(svg: string, width = 1500, height = 1050) {
  const image = new Image()
  const loaded = new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("Desenho não renderizado.")) })
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await loaded
  const canvas = document.createElement("canvas")
  canvas.width = width; canvas.height = height
  const context = canvas.getContext("2d")!
  context.fillStyle = "#ffffff"; context.fillRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)
  return canvas.toDataURL("image/png")
}

export async function buildSalesOrderPdf(data: SalesPdfData) {
  const { jsPDF } = await import("jspdf")
  const doc = new jsPDF({ unit: "mm", format: "a4" })
  const width = doc.internal.pageSize.getWidth(), height = doc.internal.pageSize.getHeight(), margin = 14
  let y = margin
  const ensure = (needed: number) => { if (y + needed > height - 16) { doc.addPage(); y = margin } }

  const logo = data.company.hasLogo ? await loadLogo() : null
  if (logo) { const ratio = Math.min(44 / logo.width, 20 / logo.height); doc.addImage(logo.dataUrl, logo.format, margin, y, logo.width * ratio, logo.height * ratio) }
  else doc.setFont("helvetica", "bold").setFontSize(16).text(data.company.name, margin, y + 7)
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(90)
  ;[data.company.legalName || data.company.name, data.company.cnpj && `CNPJ ${data.company.cnpj}`, data.company.address, [data.company.phone, data.company.email].filter(Boolean).join("  ·  ")].filter(Boolean)
    .forEach((line, index) => doc.text(String(line), width - margin, y + 3 + index * 4, { align: "right" }))
  y += 24
  doc.setDrawColor(200).line(margin, y, width - margin, y)
  y += 8
  doc.setTextColor(20).setFont("helvetica", "bold").setFontSize(15).text(`Pedido de Venda ${data.order.number}`, margin, y)
  y += 6
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(60)
  doc.text(`Data: ${day(data.order.date)}    Orçamento de origem: ${data.order.quoteNumber || "-"}    Vendedor: ${data.order.salesperson || "-"}    Prazo de entrega: ${day(data.order.deliveryDate)}`, margin, y)
  y += 8
  doc.setTextColor(20).setFont("helvetica", "bold").setFontSize(10).text("Cliente", margin, y)
  y += 5
  doc.setFont("helvetica", "normal").setFontSize(9).text(data.client.name, margin, y)
  y += 4.5
  doc.setTextColor(80).text([data.client.document && `CPF/CNPJ ${data.client.document}`, data.client.phone, data.client.email].filter(Boolean).join("  ·  ") || "-", margin, y)
  y += 9

  for (const [index, item] of data.items.entries()) {
    ensure(40)
    doc.setTextColor(20).setFont("helvetica", "bold").setFontSize(11).text(`${index + 1}. ${item.configuration?.summary || item.description}`, margin, y)
    y += 5
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(70)
    doc.text(`${qty(item.quantity)} ${item.unit} × ${brl(item.unit_price)}${item.discount_percent ? ` (desconto ${qty(item.discount_percent)}%)` : ""} = ${brl(item.total)}`, margin, y)
    y += 6
    if (item.line_type !== "Produto") continue
    const photoBox = { w: 56, h: 40 }
    const top = y
    if (item.photo.dataUrl) {
      try { doc.addImage(item.photo.dataUrl, item.photo.format, margin, top, photoBox.w, photoBox.h, undefined, "FAST") } catch { doc.setFontSize(8).setTextColor(160, 60, 0).text("Fotografia não pôde ser inserida.", margin, top + 8) }
    } else {
      doc.setDrawColor(210).rect(margin, top, photoBox.w, photoBox.h)
      doc.setFontSize(8).setTextColor(160, 60, 0).text(doc.splitTextToSize(item.photo.problem || "Fotografia indisponível.", photoBox.w - 4), margin + 2, top + 6)
    }
    let ty = top + 3
    doc.setFontSize(9).setTextColor(20)
    const facts: Array<[string, string]> = item.configuration ? configurationFacts(item.configuration) : [["Modelo", item.product_model || item.product_name], ["Configuração", "Produto padrão (sem personalização)"]]
    for (const [label, value] of facts) {
      doc.setFont("helvetica", "bold").text(`${label}:`, margin + photoBox.w + 6, ty)
      doc.setFont("helvetica", "normal").text(doc.splitTextToSize(value, width - margin * 2 - photoBox.w - 44), margin + photoBox.w + 52, ty)
      ty += 5
    }
    y = Math.max(top + photoBox.h, ty) + 4
    const dims = item.configuration ? drawingDims(item.configuration.params) : null
    if (item.configuration && dims) {
      ensure(100)
      const grade = item.configuration.drawing_spec?.grade === "validado" && item.configuration.homologated ? "validado" : "ilustrativo"
      try {
        const png = await svgToPng(renderTrailerSvg({ product: item.product_name, revision: item.configuration.revision_label, grade, dims, geometry: item.configuration.drawing_spec?.geometry, finish: item.configuration.options.selected?.find((option) => option.group === "acabamento")?.label, accessories: (item.configuration.options.selected || []).filter((option) => option.group === "acessorio").map((option) => option.label) }))
        const w = width - margin * 2
        doc.addImage(png, "PNG", margin, y, w, w * 0.7, undefined, "FAST")
        y += w * 0.7 + 3
      } catch {
        doc.setFontSize(8).setTextColor(160, 60, 0).text("Desenho não pôde ser inserido neste PDF.", margin, y + 4)
        y += 8
      }
      doc.setFontSize(7.5).setTextColor(110).text(grade === "validado" ? "Desenho gerado a partir da configuração vendida (revisão validada pela engenharia)." : "Desenho ilustrativo gerado a partir das medidas vendidas; não é desenho de fabricação.", margin, y)
      y += 6
    }
  }

  ensure(60)
  doc.setDrawColor(200).line(margin, y, width - margin, y)
  y += 7
  doc.setTextColor(20).setFont("helvetica", "bold").setFontSize(10).text("Valores e condições", margin, y)
  y += 6
  doc.setFont("helvetica", "normal").setFontSize(9)
  const lines: Array<[string, string]> = [["Itens", brl(data.order.itemsTotal)]]
  if (data.order.discount) lines.push(["Desconto", `- ${brl(data.order.discount)}`])
  if (data.order.freight) lines.push(["Frete", brl(data.order.freight)])
  if (data.order.expenses) lines.push(["Despesas", brl(data.order.expenses)])
  if (data.order.taxes) lines.push(["Impostos destacados", brl(data.order.taxes)])
  lines.push(["TOTAL DO PEDIDO", brl(data.order.totalAmount)])
  for (const [label, value] of lines) { doc.setFont("helvetica", label === "TOTAL DO PEDIDO" ? "bold" : "normal").text(label, margin, y); doc.text(value, width - margin, y, { align: "right" }); y += 5 }
  y += 3
  doc.setFont("helvetica", "bold").text("Pagamento", margin, y); y += 5
  doc.setFont("helvetica", "normal").text(`Condição negociada: ${data.order.paymentCondition || "-"}${data.order.paymentMethod ? ` · ${data.order.paymentMethod}` : ""}`, margin, y); y += 5
  for (const parcel of data.installments) {
    ensure(6)
    doc.text(`${data.installments.length > 1 ? `Parcela ${parcel.number}/${data.installments.length}` : "Pagamento"}${parcel.number === 1 && data.installments.length > 1 && data.installments[0].dueDate === data.order.date.slice(0, 10) ? " (entrada)" : ""}`, margin, y)
    doc.text(`${day(parcel.dueDate)}   ${brl(parcel.amount)}`, width - margin, y, { align: "right" })
    y += 5
  }
  y += 3
  doc.text(`Prazo de entrega: ${day(data.order.deliveryDate)}${data.order.warrantyDays ? `    Garantia: ${data.order.warrantyDays} dias` : ""}`, margin, y)
  y += 6
  if (data.order.notes) { ensure(16); doc.setFont("helvetica", "bold").text("Observações e condições negociadas", margin, y); y += 5; const wrapped = doc.splitTextToSize(data.order.notes, width - margin * 2); doc.setFont("helvetica", "normal").text(wrapped, margin, y); y += wrapped.length * 4.5 }

  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page)
    doc.setFontSize(7.5).setTextColor(130).text(`Pedido ${data.order.number} · gerado a partir da configuração confirmada na venda · página ${page}/${pages}`, margin, height - 8)
  }
  return { doc, fileName: `pedido-${data.order.number}.pdf` }
}
