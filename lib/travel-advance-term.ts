// Termo de autorização de desconto em folha (adiantamento salarial) da antecipação de reembolso para viagem.
// Só o texto com os dados do funcionário: a assinatura é física, então o PDF sai pronto para imprimir.
import { moneyInWords } from "./money-words.ts"

export type AdvanceTermData = {
  employeeName: string; employeeCpf: string; companyName: string; companyCnpj: string
  amount: number; number: number | null; reference?: string
}

const brl = (value: number) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const blank = (value: string, width = 24) => (String(value || "").trim() || "_".repeat(width))

/** Número do lançamento como aparece na tela e no termo: ANT-00012. */
export const advanceNumber = (value: number | null | undefined) => (value ? `ANT-${String(value).padStart(5, "0")}` : "")

/** Texto do termo (modelo do jurídico), com os dados do funcionário e o valor por extenso. */
export function advanceTermText(data: AdvanceTermData) {
  const amount = Math.round(Number(data.amount || 0) * 100) / 100
  const words = amount > 0 ? moneyInWords(amount) : "________________"
  const value = amount > 0 ? brl(amount) : "R$ _______"
  return {
    title: ["TERMO DE AUTORIZAÇÃO DE DESCONTO EM FOLHA DE PAGAMENTO", "REFERENTE A ADIANTAMENTO SALARIAL"],
    number: data.number ? `Lançamento nº ${advanceNumber(data.number)}` : "",
    paragraphs: [
      `Eu, ${blank(data.employeeName)}, inscrito(a) no CPF sob nº ${blank(data.employeeCpf, 18)}, funcionário(a) da empresa ${blank(data.companyName)}, inscrita no CNPJ sob nº ${blank(data.companyCnpj, 18)}, declaro que recebi, a título de adiantamento salarial, o valor de ${value} (${words}).`,
      "Por meio deste instrumento, AUTORIZO EXPRESSAMENTE a empresa a efetuar o desconto do referido valor em minha folha de pagamento, para fins de compensação do adiantamento salarial recebido.",
      "Declaro estar ciente e de acordo com o valor e as condições do desconto, reconhecendo que se trata de antecipação de parte da minha remuneração, não constituindo desconto adicional ou penalidade.",
      "A presente autorização é concedida de forma livre e consciente, em conformidade com o artigo 462 da Consolidação das Leis do Trabalho (CLT).",
    ],
    place: "Local e data: ________________________________________",
    signature: "Assinatura do(a) funcionário(a): ________________________________________",
  }
}

/** Monta o PDF (A4) no navegador e devolve o Blob; o nome do arquivo sugerido vai junto. */
export async function buildAdvanceTermPdf(data: AdvanceTermData) {
  const text = advanceTermText(data)
  const { jsPDF } = await import("jspdf")
  const doc = new jsPDF({ unit: "mm", format: "a4" })
  const width = 210, margin = 22, inner = width - margin * 2
  let y = 30
  doc.setFont("helvetica", "bold"); doc.setFontSize(13)
  for (const line of text.title) { doc.text(line, width / 2, y, { align: "center" }); y += 7 }
  if (text.number) { doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.text(text.number, width - margin, 22, { align: "right" }) }
  y += 8
  doc.setFont("helvetica", "normal"); doc.setFontSize(12)
  for (const paragraph of text.paragraphs) {
    const lines = doc.splitTextToSize(paragraph, inner) as string[]
    doc.text(lines, margin, y, { align: "justify", maxWidth: inner })
    y += lines.length * 6.2 + 6
  }
  y += 14
  doc.text(text.place, margin, y); y += 26
  doc.text(text.signature, margin, y)
  const slug = (data.employeeName || "funcionario").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase()
  return { blob: doc.output("blob") as Blob, fileName: `termo-adiantamento-${advanceNumber(data.number) || "sem-numero"}-${slug}.pdf` }
}
