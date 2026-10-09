type PdfTextItem = {
  str?: string
  transform?: number[]
}

function ensurePdfJsNodeGlobals() {
  const globalScope = globalThis as any

  if (!globalScope.DOMMatrix) {
    globalScope.DOMMatrix = class DOMMatrix {
      a = 1
      b = 0
      c = 0
      d = 1
      e = 0
      f = 0
      is2D = true
      isIdentity = true

      constructor(init?: number[] | string) {
        if (Array.isArray(init)) {
          this.a = Number(init[0] ?? 1)
          this.b = Number(init[1] ?? 0)
          this.c = Number(init[2] ?? 0)
          this.d = Number(init[3] ?? 1)
          this.e = Number(init[4] ?? 0)
          this.f = Number(init[5] ?? 0)
        }
      }

      multiply() { return this }
      translate() { return this }
      scale() { return this }
      rotate() { return this }
      inverse() { return this }
      transformPoint(point = { x: 0, y: 0 }) { return point }
    }
  }

  if (!globalScope.ImageData) {
    globalScope.ImageData = class ImageData {
      data: Uint8ClampedArray
      width: number
      height: number

      constructor(dataOrWidth: Uint8ClampedArray | number, width?: number, height?: number) {
        if (typeof dataOrWidth === "number") {
          this.width = dataOrWidth
          this.height = Number(width || 0)
          this.data = new Uint8ClampedArray(this.width * this.height * 4)
        } else {
          this.data = dataOrWidth
          this.width = Number(width || 0)
          this.height = Number(height || 0)
        }
      }
    }
  }

  if (!globalScope.Path2D) globalScope.Path2D = class Path2D {}
}

export async function extractPdfText(file: File) {
  ensurePdfJsNodeGlobals()
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
  // The worker module is bundled correctly by Next, but pdfjs does not publish its declaration.
  // @ts-expect-error pdfjs-dist worker has no TypeScript declaration
  const pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs")
  ;(globalThis as any).pdfjsWorker = pdfjsWorker

  const data = new Uint8Array(await file.arrayBuffer())
  // @ts-expect-error disableWorker is supported at runtime by the legacy Node build.
  const pdf = await pdfjs.getDocument({ data, disableWorker: true }).promise
  const pages: string[] = []

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    const rows = new Map<number, Array<{ x: number; text: string }>>()

    for (const item of content.items as PdfTextItem[]) {
      const text = String(item.str || "").trim()
      if (!text) continue
      const x = item.transform?.[4] || 0
      const y = Math.round(item.transform?.[5] || 0)
      const existingY = [...rows.keys()].find((rowY) => Math.abs(rowY - y) <= 3) ?? y
      const row = rows.get(existingY) || []
      row.push({ x, text })
      rows.set(existingY, row)
    }

    pages.push([...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, row]) => row.sort((a, b) => a.x - b.x).map((cell) => cell.text).join(" "))
      .join("\n"))
  }

  return { text: pages.join("\n"), pages: pdf.numPages }
}
