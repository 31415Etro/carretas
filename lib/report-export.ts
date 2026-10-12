// Exportação dos relatórios (PDF, Excel e CSV). Roda no navegador e no servidor (envio agendado por e-mail).

import { formatCell, toCsv, type ColumnDef, type ReportFormat, type ReportResult } from "@/lib/reports"

export type ReportMeta = { title: string; periodLabel: string; filtersText: string; companyName: string; generatedAt: string }
export type ReportFile = { bytes: Uint8Array; mime: string; extension: string }

const rowValues = (row: Record<string, any>, columns: ColumnDef[]) => columns.map((column) => row[column.key])

/** Linhas planas (com títulos de grupo, subtotais e total) para a planilha e o PDF. */
function flatten(result: ReportResult) {
  const lines: Array<{ kind: "group" | "row" | "subtotal" | "total"; cells: Array<string | number | null>; raw?: Record<string, any> }> = []
  const totalCells = (totals: Record<string, number>, label: string) => result.columns.map((column, index) => (index === 0 ? label : column.key in totals ? totals[column.key] : null))
  for (const group of result.groups) {
    if (result.grouped) lines.push({ kind: "group", cells: [group.label, ...result.columns.slice(1).map(() => null)] })
    for (const row of group.rows) lines.push({ kind: "row", cells: rowValues(row, result.columns), raw: row })
    if (result.grouped && Object.keys(group.subtotals).length) lines.push({ kind: "subtotal", cells: totalCells(group.subtotals, `Subtotal ${group.label}`) })
  }
  if (Object.keys(result.totals).length) lines.push({ kind: "total", cells: totalCells(result.totals, "TOTAL") })
  return lines
}

export async function buildReportFile(format: ReportFormat, result: ReportResult, meta: ReportMeta): Promise<ReportFile> {
  if (format === "CSV") return { bytes: new TextEncoder().encode(toCsv(result, meta)), mime: "text/csv;charset=utf-8", extension: "csv" }
  if (format === "Excel") return buildXlsx(result, meta)
  return buildPdf(result, meta)
}

async function buildXlsx(result: ReportResult, meta: ReportMeta): Promise<ReportFile> {
  const XLSX = await import("xlsx")
  const lines = flatten(result)
  const header = [meta.companyName, meta.title, meta.periodLabel, ...(meta.filtersText ? [meta.filtersText] : []), `Gerado em ${meta.generatedAt}`]
  const sheet: any[][] = [...header.map((text) => [text]), [], result.columns.map((column) => column.label)]
  const firstData = sheet.length
  for (const line of lines) {
    sheet.push(line.cells.map((value, index) => {
      const column = result.columns[index]
      if (value === null || value === undefined) return ""
      if (line.kind === "group" || (line.kind !== "row" && index === 0)) return value
      if (column.type === "date") return String(value).slice(0, 10).split("-").reverse().join("/")
      return value
    }))
  }
  const worksheet = XLSX.utils.aoa_to_sheet(sheet)
  // formatos numéricos por tipo de coluna
  const formats: Record<string, string> = { money: '"R$" #,##0.00', percent: '0.00"%"', number: "#,##0.###", int: "#,##0" }
  lines.forEach((line, lineIndex) => {
    if (line.kind === "group") return
    line.cells.forEach((value, index) => {
      const column = result.columns[index]
      const format = formats[column.type]
      if (!format || typeof value !== "number") return
      const address = XLSX.utils.encode_cell({ r: firstData + lineIndex, c: index })
      if (worksheet[address]) worksheet[address].z = format
    })
  })
  worksheet["!cols"] = result.columns.map((column, index) => ({ wch: Math.min(48, Math.max(column.label.length + 2, ...lines.slice(0, 200).map((line) => String(line.cells[index] ?? "").length + 2), 10)) }))
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, meta.title.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Relatório")
  const output = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer
  return { bytes: new Uint8Array(output), mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extension: "xlsx" }
}

async function buildPdf(result: ReportResult, meta: ReportMeta): Promise<ReportFile> {
  const { jsPDF } = await import("jspdf")
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: result.columns.length > 6 ? "landscape" : "portrait" })
  const width = doc.internal.pageSize.getWidth()
  const height = doc.internal.pageSize.getHeight()
  const margin = 10
  const lines = flatten(result)
  const display = (value: string | number | null, column: ColumnDef) => (value === null || value === undefined ? "" : typeof value === "number" || column.type === "date" || column.type === "money" ? formatCell(value, column.type) : String(value))

  // largura das colunas proporcional ao conteúdo, limitada
  doc.setFont("helvetica", "normal").setFontSize(7.5)
  const usable = width - margin * 2
  const wanted = result.columns.map((column, index) => Math.min(70, Math.max(doc.getTextWidth(column.label) + 4, ...lines.slice(0, 300).filter((line) => line.kind === "row").map((line) => doc.getTextWidth(display(line.cells[index], column)) + 4), 14)))
  const scale = Math.min(1, usable / wanted.reduce((sum, value) => sum + value, 0))
  const widths = wanted.map((value) => value * scale)
  const xs = widths.map((_, index) => margin + widths.slice(0, index).reduce((sum, value) => sum + value, 0))
  const fit = (text: string, max: number) => {
    if (doc.getTextWidth(text) <= max - 2) return text
    let cut = text
    while (cut.length > 1 && doc.getTextWidth(`${cut}…`) > max - 2) cut = cut.slice(0, -1)
    return `${cut}…`
  }

  let y = margin
  const head = () => {
    doc.setFont("helvetica", "bold").setFontSize(13).setTextColor(20).text(meta.title, margin, y + 4)
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(90)
    doc.text([meta.companyName, meta.periodLabel, meta.filtersText].filter(Boolean).join("   ·   "), margin, y + 9)
    doc.text(`Gerado em ${meta.generatedAt}`, width - margin, y + 4, { align: "right" })
    y += 14
  }
  const columnHeader = () => {
    doc.setFillColor(238, 243, 249).rect(margin, y - 3.6, usable, 5.6, "F")
    doc.setFont("helvetica", "bold").setFontSize(7.5).setTextColor(20)
    result.columns.forEach((column, index) => {
      const right = column.type !== "text" && column.type !== "date"
      doc.text(fit(column.label, widths[index]), right ? xs[index] + widths[index] - 1 : xs[index] + 1, y, { align: right ? "right" : "left" })
    })
    y += 5.5
  }
  head()
  columnHeader()
  for (const line of lines) {
    if (y > height - 14) {
      doc.addPage()
      y = margin
      head()
      columnHeader()
    }
    const bold = line.kind !== "row"
    if (line.kind === "group") doc.setFillColor(246, 248, 251).rect(margin, y - 3.4, usable, 5, "F")
    if (line.kind === "total") doc.setDrawColor(120).line(margin, y - 3.4, margin + usable, y - 3.4)
    doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(7.5).setTextColor(30)
    if (line.kind === "group") {
      doc.text(fit(String(line.cells[0] ?? ""), usable), margin + 1, y)
    } else {
      line.cells.forEach((value, index) => {
        const column = result.columns[index]
        const right = column.type !== "text" && column.type !== "date" && !(bold && index === 0)
        const textValue = display(value, column)
        if (!textValue) return
        doc.text(fit(textValue, widths[index]), right ? xs[index] + widths[index] - 1 : xs[index] + 1, y, { align: right ? "right" : "left" })
      })
    }
    y += 4.6
    if (line.kind === "row") doc.setDrawColor(235).line(margin, y - 3.1, margin + usable, y - 3.1)
  }
  if (!lines.length) doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(100).text("Nenhum registro encontrado para os filtros informados.", margin, y + 4)
  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page)
    doc.setFontSize(7).setTextColor(130).text(`${meta.companyName} · ${meta.title} · página ${page} de ${pages}`, width / 2, height - 5, { align: "center" })
  }
  return { bytes: new Uint8Array(doc.output("arraybuffer")), mime: "application/pdf", extension: "pdf" }
}

export const reportFileName = (title: string, extension: string, date = new Date().toISOString().slice(0, 10)) =>
  `${title.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "relatorio"}-${date}.${extension}`
