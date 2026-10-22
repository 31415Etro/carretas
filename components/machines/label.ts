// Etiqueta de patrimônio com QR Code (PDF 90 x 50 mm). Gerada no navegador; a segunda via usa o mesmo código e o mesmo QR.

export type LabelInput = { code: string; name: string; url: string; company?: string }

export async function buildLabelPdf({ code, name, url, company = "ND Carretas" }: LabelInput) {
  const [{ jsPDF }, QRCode] = await Promise.all([import("jspdf"), import("qrcode")])
  const qr = await QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 1, width: 480 })
  const doc = new jsPDF({ unit: "mm", format: [90, 50], orientation: "landscape" })
  doc.setDrawColor(30, 58, 138).setLineWidth(0.5).roundedRect(1.5, 1.5, 87, 47, 2, 2)
  doc.addImage(qr, "PNG", 5, 7, 36, 36)
  doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(30, 58, 138).text(company, 45, 10)
  doc.setFont("courier", "bold").setFontSize(12).setTextColor(0).text(code, 45, 19)
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(30)
  doc.text(doc.splitTextToSize(name, 40).slice(0, 3), 45, 26)
  doc.setFontSize(7.5).setTextColor(90).text("Escaneie para consultar", 45, 44)
  return doc
}

export async function downloadLabel(input: LabelInput) {
  const doc = await buildLabelPdf(input)
  doc.save(`etiqueta-${input.code}.pdf`)
}

export async function printLabel(input: LabelInput) {
  const doc = await buildLabelPdf(input)
  window.open(String(doc.output("bloburl")), "_blank", "noopener")
}
