// PDF do Pedido de Venda no modelo comercial da ND Carretas (montado no navegador com jsPDF).
// Usa SOMENTE o pedido e a configuração congelada da venda: medidas, acabamento e acessórios do cadastro atual do produto nunca entram aqui.
import { dimensionsText } from "./configurator.ts"
import { moneyInWords } from "./money-words.ts"
import { drawingDims, renderTrailerSvg } from "./trailer-drawing.ts"

export type PdfImage = { dataUrl: string; format: "JPEG" | "PNG" | "WEBP"; width: number; height: number }
export type SalesPdfItem = {
  description: string; commercial_description?: string; product_name: string; product_model: string; sku?: string; line_type: string; quantity: number; unit: string; unit_price: number; discount_percent: number; total: number; lead_time_days?: number | null
  photo: { dataUrl: string | null; format: string; width?: number; height?: number; problem: string; photoId?: string | null; path?: string | null }
  configuration: null | {
    id?: string; summary: string; status: string; homologated: boolean; revision_label: string | null; params: Record<string, number>; derived: Record<string, { label: string; value: number; unit: string }>
    options: { acabamento?: string | null; acessorios?: string[]; selected?: Array<{ group: string; label: string; code: string }> }; drawing_spec: { grade: "ilustrativo" | "validado"; geometry?: Record<string, number> } | null; frozen_at: string | null
  }
}
export type SalesPdfData = {
  company: { name: string; legalName: string; cnpj: string; email: string; phone: string; address: string; hasLogo: boolean }
  client: { name: string; document: string; phone: string; email: string; address?: string }
  order: { number: string; date: string; deliveryDate: string | null; quoteNumber: string | null; totalAmount: number; itemsTotal: number; discount: number; freight: number; expenses: number; taxes: number; paymentCondition: string; paymentMethod: string; warrantyDays: number; salesperson: string; notes: string; version?: number }
  installments: Array<{ number: number; dueDate: string; amount: number }>
  items: SalesPdfItem[]
}

const brl = (value: number) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const day = (value: string | null | undefined) => (value ? value.slice(0, 10).split("-").reverse().join("/") : "-")
const qty = (value: number) => Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 3 })
const months = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]
const dateLong = (value: string) => { const [y, m, d] = value.slice(0, 10).split("-").map(Number); return `${d} de ${months[m - 1]} de ${y}` }
const documentLabel = (value: string) => (value.replace(/\D/g, "").length > 11 ? "CNPJ" : "CPF")

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

/** O que o pedido diz do produto vendido, linha a linha (modelo, descrição comercial, medidas, acabamento, referências do projeto). */
export function productLines(item: SalesPdfItem) {
  const lines: string[] = []
  const model = item.product_model && !item.product_name.toLowerCase().includes(item.product_model.toLowerCase()) ? ` modelo ${item.product_model}` : ""
  lines.push(`${qty(item.quantity)} ${item.product_name}${model}`)
  for (const line of String(item.commercial_description || "").split(/\r?\n/).map((text) => text.trim().replace(/^[-•]\s*/, "")).filter(Boolean)) lines.push(line)
  const cfg = item.configuration
  if (cfg) {
    const p = cfg.params || {}
    const dims = dimensionsText(p)
    if (dims) lines.push(`Medidas externas (comprimento x largura x altura): ${dims}`)
    const finish = cfg.options.selected?.find((option) => option.group === "acabamento")
    if (finish) lines.push(`Acabamento: ${finish.label}`)
    for (const [key, label] of [["pbt", "PBT"], ["lotacao", "Capacidade de carga"], ["tara", "Tara"]] as const) if (p[key] !== undefined) lines.push(`${label}: ${Number(p[key]).toLocaleString("pt-BR")} kg`)
    if (p.eixos !== undefined) lines.push(`Eixos: ${Number(p.eixos).toLocaleString("pt-BR")}`)
  }
  return lines
}
export const accessoryLines = (item: SalesPdfItem) => (item.configuration?.options.selected || []).filter((option) => option.group === "acessorio").map((option) => option.label)

async function loadLogo(): Promise<PdfImage | null> {
  try {
    const response = await fetch("/api/orcamentos/logo", { cache: "no-store" })
    if (!response.ok) return null
    const blob = await response.blob()
    const dataUrl: string = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob) })
    const size: { width: number; height: number } = await new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight }); image.onerror = reject; image.src = dataUrl })
    return { dataUrl, format: blob.type === "image/png" ? "PNG" : "JPEG", ...size }
  } catch { return null }
}

/** SVG do desenho -> PNG (para o PDF), com fundo branco. */
async function svgToPng(svg: string, width = 1800, height = 1260) {
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

const fit = (width: number, height: number, boxW: number, boxH: number) => { const ratio = Math.min(boxW / width, boxH / height); return { w: width * ratio, h: height * ratio } }

export type SalesPdfResult = {
  doc: import("jspdf").jsPDF; fileName: string
  /** O que foi realmente colocado no documento (vai para o registro da versão): fotografia usada por item e dados da configuração. */
  photoRefs: Array<{ item: string; product: string; photo_id: string | null; path: string | null; included: boolean; problem: string }>
  configurationRefs: Array<{ item: string; configuration_id: string | null; summary: string; params: Record<string, number>; revision: string | null; homologated: boolean; drawing_grade: string | null; drawing_included: boolean }>
  warnings: string[]
}

export async function buildSalesOrderPdf(data: SalesPdfData): Promise<SalesPdfResult> {
  const { jsPDF } = await import("jspdf")
  const doc = new jsPDF({ unit: "mm", format: "a4" })
  const width = doc.internal.pageSize.getWidth(), height = doc.internal.pageSize.getHeight(), margin = 18, bottom = height - 18
  const content = width - margin * 2
  const version = data.order.version || 1
  const warnings: string[] = []
  const photoRefs: SalesPdfResult["photoRefs"] = []
  const configurationRefs: SalesPdfResult["configurationRefs"] = []
  let y = 0
  const font = (style: "normal" | "bold", size: number, color: number | [number, number, number] = 20) => {
    doc.setFont("times", style).setFontSize(size)
    if (Array.isArray(color)) doc.setTextColor(color[0], color[1], color[2]); else doc.setTextColor(color)
  }
  const newPage = () => { doc.addPage(); y = margin + 4 }
  const ensure = (needed: number) => { if (y + needed > bottom) newPage() }
  const write = (text: string, x = margin, maxWidth = content, lineHeight = 5.2) => {
    const lines = doc.splitTextToSize(text, maxWidth) as string[]
    ensure(lines.length * lineHeight)
    doc.text(lines, x, y)
    y += lines.length * lineHeight
  }
  const heading = (text: string) => { ensure(14); y += 2; font("bold", 11); doc.text(text, margin, y); y += 6 }

  // ---- cabeçalho: título e logotipo
  const logo = data.company.hasLogo ? await loadLogo() : null
  if (logo) { const size = fit(logo.width, logo.height, 58, 34); doc.addImage(logo.dataUrl, logo.format, width - margin - size.w, 8, size.w, size.h, undefined, "FAST") }
  else { font("bold", 15); doc.text(data.company.name, width - margin, 18, { align: "right" }) }
  font("normal", 12); doc.text(`PEDIDO- ${data.order.number}`, margin + 54, 26)
  y = 42
  font("bold", 12); doc.text("Pedido para:", margin, y); y += 7
  font("normal", 11)
  const clientLines = [data.client.name, data.client.document && `${documentLabel(data.client.document)}: ${data.client.document}`, data.client.phone && `Telefone: ${data.client.phone}`, data.client.email && `E-mail: ${data.client.email}`, data.client.address && `Endereço: ${data.client.address}`].filter(Boolean) as string[]
  for (const line of clientLines) write(line, margin, content - 60, 5.4)
  y += 3

  // ---- produtos
  heading("DESCRIÇÃO DO PRODUTO:")
  const photoColumn = 78, textWidth = content - photoColumn - 4
  for (const [index, item] of data.items.entries()) {
    const label = `Item ${index + 1}`
    if (item.line_type !== "Produto") {
      font("normal", 11); write(`-${qty(item.quantity)} ${item.description}`, margin, content, 6)
      continue
    }
    const lines = productLines(item)
    font("normal", 11)
    const wrapped = lines.map((line, at) => (doc.splitTextToSize(`${at === 0 && lines.length > 0 ? "-" : "-"}${line}`, textWidth) as string[]))
    const textHeight = wrapped.reduce((sum, block) => sum + block.length * 5.0, 0)
    const photoBox = item.photo.dataUrl && item.photo.width && item.photo.height ? fit(item.photo.width, item.photo.height, photoColumn, 54) : item.photo.dataUrl ? { w: photoColumn, h: 52 } : null
    const blockHeight = Math.max(textHeight, photoBox ? photoBox.h + 12 : 0)
    ensure(Math.min(blockHeight + 4, bottom - margin - 10))
    const top = y
    let ty = y
    font("normal", 11)
    for (const block of wrapped) { doc.text(block, margin, ty); ty += block.length * 5.0 }
    const included = Boolean(photoBox && item.photo.dataUrl)
    if (photoBox && item.photo.dataUrl) {
      const x = width - margin - photoColumn + (photoColumn - photoBox.w)
      try {
        doc.addImage(item.photo.dataUrl, item.photo.format as "JPEG" | "PNG" | "WEBP", x, top, photoBox.w, photoBox.h, undefined, "FAST")
        doc.setFillColor(91, 155, 213).rect(width - margin - 50, top + photoBox.h + 3, 50, 7, "F")
        font("normal", 9.5, 255); doc.text("FOTO ILUSTRATIVA", width - margin - 25, top + photoBox.h + 8, { align: "center" })
      } catch { warnings.push(`A fotografia do item ${index + 1} não pôde ser inserida no PDF.`) }
    } else {
      warnings.push(`Item ${index + 1} (${item.product_name}): ${item.photo.problem || "sem fotografia principal disponível."}`)
    }
    photoRefs.push({ item: label, product: item.product_name, photo_id: item.photo.photoId || null, path: item.photo.path || null, included, problem: included ? "" : item.photo.problem || "Sem fotografia." })
    y = top + blockHeight + 2
    const accessories = accessoryLines(item)
    if (accessories.length) {
      font("normal", 11); ensure(8 + accessories.length * 5.0); doc.text("ACESSÓRIOS:", margin, y); y += 6
      for (const accessory of accessories) write(`- ${accessory}`, margin, content, 5.0)
      y += 2
    }
    y += 3
  }

  // ---- valores e condições
  const products = data.items
  const adjustments = data.order.discount || data.order.freight || data.order.expenses || data.order.taxes
  heading("VALORES:")
  font("normal", 11)
  if (products.length === 1 && !adjustments) {
    write(`VALOR DO PRODUTO: ${brl(data.order.totalAmount)} (${moneyInWords(data.order.totalAmount)})`, margin, content, 6)
  } else {
    for (const item of products) write(`- ${item.configuration?.summary || item.description}: ${qty(item.quantity)} ${item.unit} × ${brl(item.unit_price)}${item.discount_percent ? ` (desconto ${qty(item.discount_percent)}%)` : ""} = ${brl(item.total)}`, margin, content, 5.8)
    if (data.order.discount) write(`Desconto: - ${brl(data.order.discount)}`, margin, content, 5.8)
    if (data.order.freight) write(`Frete: ${brl(data.order.freight)}`, margin, content, 5.8)
    if (data.order.expenses) write(`Despesas: ${brl(data.order.expenses)}`, margin, content, 5.8)
    if (data.order.taxes) write(`Impostos destacados: ${brl(data.order.taxes)}`, margin, content, 5.8)
    font("bold", 11); write(`VALOR TOTAL: ${brl(data.order.totalAmount)} (${moneyInWords(data.order.totalAmount)})`, margin, content, 6.2); font("normal", 11)
  }
  const first = data.installments[0]
  const hasDownPayment = Boolean(first && first.dueDate.slice(0, 10) === data.order.date.slice(0, 10) && data.installments.length >= 1)
  if (hasDownPayment) {
    const rest = Math.round((data.order.totalAmount - first.amount) * 100) / 100
    font("bold", 11); write(`ENTRADA: ${brl(first.amount)} (${moneyInWords(first.amount)})${data.order.paymentMethod ? ` — ${data.order.paymentMethod}` : ""}`, margin, content, 6.2); font("normal", 11)
    if (rest > 0) write(`SALDO: ${brl(rest)} (${moneyInWords(rest)})`, margin, content, 6)
  }
  const parcels = data.installments.slice(hasDownPayment ? 1 : 0)
  if (parcels.length) {
    font("bold", 11); ensure(8); y += 1; doc.text("PARCELAS:", margin, y); y += 6; font("normal", 11)
    for (const parcel of parcels) write(`${parcel.number}/${data.installments.length} — vencimento ${day(parcel.dueDate)} — ${brl(parcel.amount)}`, margin + 3, content, 5.0)
  }
  if (data.order.paymentCondition) { font("normal", 11); write(`CONDIÇÃO DE PAGAMENTO: ${data.order.paymentCondition}${!hasDownPayment && data.order.paymentMethod ? ` — ${data.order.paymentMethod}` : ""}`, margin, content, 6) }
  font("bold", 11); write(`PRAZO DE ENTREGA: ${data.order.deliveryDate ? `previsão até ${day(data.order.deliveryDate)}` : "a combinar"}${data.order.warrantyDays ? `. Garantia: ${data.order.warrantyDays} dias.` : "."}`, margin, content, 6.2)
  font("normal", 11)
  if (data.order.notes) { y += 1; write(`OBSERVAÇÕES: ${data.order.notes}`, margin, content, 5.0) }
  y += 1

  // ---- fechamento: data e dados da empresa (como no modelo comercial)
  ensure(24)
  font("normal", 11); write(`Emitido em ${dateLong(data.order.date)}.`, margin, content, 6)
  y += 2
  font("normal", 9.5, 40)
  const left = [data.company.legalName || data.company.name, data.company.cnpj && `CNPJ: ${data.company.cnpj}`, data.company.address].filter(Boolean) as string[]
  const right = [data.company.phone && `Telefone: ${data.company.phone}`, data.company.email && `E-mail: ${data.company.email}`].filter(Boolean) as string[]
  let ly = y
  for (const line of left) { const wrapped = doc.splitTextToSize(line, content * 0.58) as string[]; doc.text(wrapped, margin, ly); ly += wrapped.length * 4.4 }
  let ry = y
  for (const line of right) { doc.text(line, width - margin - content * 0.36, ry); ry += 4.4 }
  y = Math.max(ly, ry)

  // ---- anexo: desenho da configuração vendida (cada desenho em página própria, depois do pedido)
  for (const [index, item] of data.items.entries()) {
    const cfg = item.configuration
    if (!cfg) continue
    const dims = drawingDims(cfg.params)
    const grade = cfg.drawing_spec?.grade === "validado" && cfg.homologated ? "validado" : "ilustrativo"
    let drawn = false
    if (dims) {
      try {
        const png = await svgToPng(renderTrailerSvg({ product: item.product_name, revision: cfg.revision_label, grade, dims, geometry: cfg.drawing_spec?.geometry, finish: cfg.options.selected?.find((option) => option.group === "acabamento")?.label, accessories: accessoryLines(item) }))
        const drawW = content, drawH = content * 0.7
        newPage()
        font("bold", 11); doc.text(`ANEXO — DESENHO DA CONFIGURAÇÃO — ${cfg.summary}`, margin, y + 4); y += 8
        doc.addImage(png, "PNG", margin, y, drawW, drawH, undefined, "FAST")
        doc.setDrawColor(200).rect(margin, y, drawW, drawH)
        y += drawH + 4
        font("normal", 9, 90)
        write(grade === "validado" ? `Desenho gerado a partir da configuração vendida, conforme revisão ${cfg.revision_label || "-"} validada pela engenharia.` : "Desenho ILUSTRATIVO gerado a partir das medidas vendidas. Não é desenho de fabricação nem projeto executivo homologado.", margin, content, 4.4)
        y += 3
        drawn = true
      } catch { warnings.push(`O desenho do item ${index + 1} não pôde ser inserido no PDF.`) }
    }
    configurationRefs.push({ item: `Item ${index + 1}`, configuration_id: cfg.id || null, summary: cfg.summary, params: cfg.params, revision: cfg.revision_label, homologated: cfg.homologated, drawing_grade: dims ? grade : null, drawing_included: drawn })
  }

  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page)
    font("normal", 8, 130)
    doc.text(`Pedido ${data.order.number} · versão ${version} · ${data.company.legalName || data.company.name}${data.company.cnpj ? ` · CNPJ ${data.company.cnpj}` : ""}`, margin, height - 10)
    doc.text(`Página ${page}/${pages}`, width - margin, height - 10, { align: "right" })
  }
  return { doc, fileName: `pedido-${data.order.number.replace(/[^\w.-]+/g, "-")}-v${version}.pdf`, photoRefs, configurationRefs, warnings }
}
