import os from "node:os"
import path from "node:path"
import sharp from "sharp"
import { createWorker, type Worker } from "tesseract.js"
import { isReliableReading } from "@/lib/nfe-parser"

// OCR local (tesseract.js) com o idioma português em public/tessdata. Um único worker é reaproveitado entre as requisições
// e as leituras são feitas uma por vez (o worker guarda parâmetros de leitura).
let workerPromise: Promise<Worker> | null = null
let queue: Promise<unknown> = Promise.resolve()

function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker("por", 1, { langPath: path.join(process.cwd(), "public", "tessdata"), gzip: false, cachePath: path.join(os.tmpdir(), "nd-tesseract") }).catch((error) => {
      workerPromise = null
      throw error
    })
  }
  return workerPromise
}

/** Carrega o OCR antes do primeiro uso (a tela chama ao abrir a página de importação). */
export async function warmOcr() {
  await getWorker()
}

async function recognize(image: Buffer, pageMode: "3" | "4" | "6") {
  const run = async () => {
    const worker = await getWorker()
    await worker.setParameters({ tessedit_pageseg_mode: pageMode as never })
    const { data } = await worker.recognize(image)
    return String(data.text || "")
  }
  const result = queue.then(run, run)
  queue = result.catch(() => undefined)
  return result
}

/**
 * Prepara a foto para o OCR: gira conforme o EXIF, reduz (fotos de celular têm 12 MP+), converte para tons de cinza e
 * normaliza o contraste. `topShare` < 1 mantém só a parte de cima da página, onde estão chave, destinatário, parcelas e total.
 */
async function prepare(image: Buffer, topShare: number) {
  const meta = await sharp(image, { failOn: "none" }).metadata()
  const rotated = (meta.orientation || 1) >= 5
  const width = (rotated ? meta.height : meta.width) || 2000
  const target = Math.min(2000, Math.max(1600, width)) // reduz as grandes e amplia um pouco as pequenas
  const { data, info } = await sharp(image, { failOn: "none" }).rotate().resize({ width: target, fit: "inside" }).grayscale().normalize().png().toBuffer({ resolveWithObject: true })
  if (topShare >= 1 || info.height < info.width * 1.1) return data // paisagem ou página inteira: não corta
  return sharp(data).extract({ left: 0, top: 0, width: info.width, height: Math.round(info.height * topShare) }).png().toBuffer()
}

/** A leitura rápida serve se achou a chave, o campo do valor total e as parcelas (quando houver) fecham com esse total. */
const good = (text: string) => isReliableReading(text)

/**
 * Lê uma foto/escaneamento de DANFE. Primeiro a metade de cima, reduzida (rápido, ~1,5 s); só se não vier uma leitura
 * confiável, a página inteira (mais lento, também lê os itens).
 */
export async function ocrInvoiceImage(image: Buffer) {
  const quick = await recognize(await prepare(image, 0.7), "4")
  if (good(quick)) return quick
  const full = await recognize(await prepare(image, 1), "3")
  return good(full) ? full : `${quick}\n${full}`
}
