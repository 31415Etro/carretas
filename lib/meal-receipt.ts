// Recibo de ressarcimento de despesa de alimentação (viagem), no modelo impresso da ND Carretas Fort: A4 deitado, letra serifada, logotipo no canto,
// linhas em branco para preencher à mão (valor, data, destino, refeições) e a assinatura física do funcionário.
import { advanceNumber } from "./travel-advance-term.ts"

export type MealReceiptData = { employeeName: string; employeeCpf: string; companyName: string; companyCnpj: string; number: number | null; amount?: number; year?: number }

/** Dados fixos do rodapé do modelo (empresa que paga o ressarcimento). */
export const RECEIPT_FOOTER = {
  company: "ND CARRETAS FORT LTDA", cnpj: "31.690.385/0001-90", address: "Rua Clarindo Sebastião da Cunha, 36. Bairro Espinheiros/Itajaí.", zip: "88.317-193",
  phone: "(47)99227072", email: "ndcarretas@ndcarretasfort.com.br", city: "ITAJAÍ",
}

const clean = (value: string) => String(value || "").trim()
const line = (value: string, width: number) => clean(value) || "_".repeat(width)

/** Textos do recibo (puro, testável): o que vem preenchido e o que fica em branco. */
export function mealReceiptText(data: MealReceiptData) {
  const year = data.year || new Date().getFullYear()
  const company = clean(data.companyName) || RECEIPT_FOOTER.company
  const cnpj = clean(data.companyCnpj) || RECEIPT_FOOTER.cnpj
  return {
    title: `RECIBO n° ${data.number ? advanceNumber(data.number) : "______"}/${year}`,
    employeeLabel: "FUNCIONÁRIO:",
    employee: ` ${line(data.employeeName, 28)}, inscrito no CPF sob o n° ${line(data.employeeCpf, 14)}`,
    admission: `Admitido nessa empresa na data de ____ de ____________ de ${year}, no cargo de ________________________.`,
    receivedFrom: "RECEBI DE ",
    company: company.toUpperCase(),
    cnpjLine: ` INSCRITA NO CNPJ: ${cnpj}`,
    reason: "REFERENTE A RESSARCIMENTO DE DESPESA DE ALIMENTAÇÃO, CONFORME",
    reason2: "A CONVENÇÃO COLETIVA DO TRABALHO CCT, NA DATA DE:",
    reason3: ", PARA O PERÍODO DE VIAGEM (IDA E VOLTA)",
    meals: ["CAFÉ DA MANHÃ", "ALMOÇO", "JANTA."],
    legend: "Legenda: S (sim) N (não)",
    place: `${RECEIPT_FOOTER.city}, ______ DE ____________________ DE ${year}.`,
    year,
  }
}

async function logoDataUrl() {
  try {
    const blob = await (await fetch("/logo-nd.png")).blob()
    return await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob) })
  } catch { return "" }
}

/** Monta o PDF (A4 deitado) no navegador e devolve o Blob com o nome sugerido. */
export async function buildMealReceiptPdf(data: MealReceiptData) {
  const text = mealReceiptText(data)
  const { jsPDF } = await import("jspdf")
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" })
  const left = 17, right = 280
  const font = (style: "normal" | "bold", size: number) => { doc.setFont("times", style); doc.setFontSize(size) }
  const underline = (x: number, y: number, width: number) => { doc.setLineWidth(0.25); doc.line(x, y + 0.8, x + width, y + 0.8) }

  // logotipo (canto superior direito) e título
  const logo = await logoDataUrl()
  if (logo) doc.addImage(logo, "PNG", 222, 10, 58, 40.3)
  font("normal", 13); doc.text(text.title, 148.5, 20, { align: "center" })

  // funcionário
  font("bold", 11.5); doc.text(text.employeeLabel, left, 46)
  const labelWidth = doc.getTextWidth(text.employeeLabel)
  font("normal", 13); doc.text(text.employee, left + labelWidth, 46)

  // admissão (grifada, como no modelo)
  font("normal", 12)
  const admissionWidth = doc.getTextWidth(text.admission)
  doc.setFillColor(255, 247, 160); doc.rect(left - 0.5, 53.2, admissionWidth + 1, 5.6, "F")
  doc.text(text.admission, left, 57.5)

  // recebi de
  font("normal", 12); doc.text(text.receivedFrom, left, 70)
  let x = left + doc.getTextWidth(text.receivedFrom)
  font("bold", 12); doc.text(text.company, x, 70)
  x += doc.getTextWidth(text.company) + 1.2
  font("normal", 12); doc.text(text.cnpjLine, x, 70)

  // quantia / referência (o valor, a data e o destino são preenchidos à mão)
  const body = (size: number) => font("normal", size)
  let size = 12
  body(size)
  const widest = () => Math.max(
    doc.getTextWidth("A QUANTIA DE: ") + 52 + doc.getTextWidth(` ${text.reason}`),
    doc.getTextWidth(`${text.reason2} `) + 22 + doc.getTextWidth(text.reason3),
  )
  while (widest() > right - left && size > 9) { size -= 0.5; body(size) }
  let y = 84
  doc.text("A QUANTIA DE:", left, y)
  x = left + doc.getTextWidth("A QUANTIA DE: ")
  underline(x, y, 52)
  if (Number(data.amount) > 0) { font("bold", size); doc.text(Number(data.amount).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }), x + 26, y - 0.3, { align: "center" }); body(size) }
  doc.text(` ${text.reason}`, x + 52, y)
  y += 8
  doc.text(`${text.reason2} `, left, y)
  x = left + doc.getTextWidth(`${text.reason2} `)
  underline(x, y, 10); doc.text("/", x + 10.5, y); underline(x + 12.5, y, 10); doc.text("/", x + 23, y); underline(x + 25, y, 10)
  doc.text(text.reason3, x + 36, y)
  y += 8
  doc.text("À", left, y); underline(left + 5, y, 60); doc.text(":", left + 66, y)

  // refeições
  font("normal", 12)
  doc.text("(    )", left + 25, 112); doc.text(text.meals[0], left + 38, 112)
  doc.text("(    )", left + 77, 112); doc.text(text.meals[1], left + 90, 112)
  doc.text("(    )", left + 118, 112); doc.text(text.meals[2], left + 131, 112)
  font("normal", 11); doc.text(text.legend, left, 128)

  // assinatura
  doc.setLineWidth(0.3); doc.line(112, 148, 182, 148)
  font("bold", 10); doc.text(clean(data.employeeName).toUpperCase() || "NOME DO FUNCIONÁRIO", 147, 153, { align: "center" })
  font("normal", 11.5); doc.text(text.place, left, 160)

  // rodapé: empresa à esquerda, contato à direita
  font("bold", 10.5)
  doc.text(RECEIPT_FOOTER.company, left, 172)
  doc.text(`CNPJ: ${RECEIPT_FOOTER.cnpj}`, left, 180)
  doc.text(RECEIPT_FOOTER.address, left, 188)
  doc.text(`CEP: ${RECEIPT_FOOTER.zip}`, left, 197)
  doc.text(`Telefone: ${RECEIPT_FOOTER.phone}`, 192, 175)
  doc.text("Email:", 192, 183)
  doc.setTextColor(5, 80, 190); doc.text(RECEIPT_FOOTER.email, 192 + doc.getTextWidth("Email: "), 183)
  underline(192 + doc.getTextWidth("Email: "), 183, doc.getTextWidth(RECEIPT_FOOTER.email)); doc.setTextColor(0, 0, 0)

  const slug = (data.employeeName || "funcionario").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase()
  return { blob: doc.output("blob") as Blob, fileName: `recibo-alimentacao-${advanceNumber(data.number) || "sem-numero"}-${slug}.pdf` }
}
