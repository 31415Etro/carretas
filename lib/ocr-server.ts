import os from "node:os"
import path from "node:path"
import sharp from "sharp"
import { createWorker, type Worker } from "tesseract.js"
import { isReliableReading } from "@/lib/nfe-parser"
import { pickReceiptText } from "@/lib/receipt-ocr"
import { adaptive, paperBox, stretch, WHOLE } from "@/lib/receipt-image"

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

async function recognize(image: Buffer, pageMode: "3" | "4" | "6" | "11") {
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

const RECEIPT_BUDGET_MS = 18_000

const grayOf = (rgb: Buffer, channels: number) => { const gray = new Uint8ClampedArray(rgb.length / channels); for (let at = 0, index = 0; index < rgb.length; index += channels, at++) gray[at] = (rgb[index] * 299 + rgb[index + 1] * 587 + rgb[index + 2] * 114) / 1000; return gray }

/**
 * Prepara a notinha como no celular (lib/ocr-client.ts): acha o papel na foto e recorta, amplia para ~2200 px de largura, estica o contraste e,
 * se pedido, binariza com limiar local. A leitura testada com as notinhas reais é exatamente esta.
 */
async function prepareReceipt(image: Buffer, mode: "gray" | "binary", crop: boolean) {
  const base = sharp(image, { failOn: "none" }).rotate()
  const { info: meta } = await base.clone().toBuffer({ resolveWithObject: true })
  let box = WHOLE
  if (crop) {
    const thumb = await base.clone().resize({ width: 240 }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    box = paperBox(grayOf(thumb.data, thumb.info.channels), thumb.info.width, thumb.info.height)
  }
  const left = Math.round(box.left * meta.width), top = Math.round(box.top * meta.height)
  const sw = Math.max(1, Math.min(meta.width - left, Math.round((box.right - box.left) * meta.width))), sh = Math.max(1, Math.min(meta.height - top, Math.round((box.bottom - box.top) * meta.height)))
  const scale = Math.min(2200 / sw, Math.sqrt(9_000_000 / (sw * sh)), 3)
  const raw = await base.clone().extract({ left, top, width: sw, height: sh }).resize({ width: Math.max(1, Math.round(sw * scale)), height: Math.max(1, Math.round(sh * scale)), fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  let gray = stretch(grayOf(raw.data, raw.info.channels))
  if (mode === "binary") gray = adaptive(gray, raw.info.width, raw.info.height)
  return sharp(Buffer.from(gray), { raw: { width: raw.info.width, height: raw.info.height, channels: 1 } }).png().toBuffer()
}

/** Notinha (cupom/DANFE simplificado) lida no servidor, como reserva quando a leitura no celular não fechou: mesmas preparações e votação do celular. */
export async function ocrReceiptBuffer(image: Buffer) {
  const started = Date.now()
  const texts: string[] = []
  // a Vercel corta a função em 60 s: cada tentativa só começa se ainda couber no orçamento de tempo
  for (const attempt of [{ mode: "gray", crop: true, psm: "6" }, { mode: "binary", crop: true, psm: "6" }, { mode: "gray", crop: true, psm: "4" }, { mode: "gray", crop: false, psm: "11" }] as const) {
    if (texts.length && Date.now() - started > RECEIPT_BUDGET_MS) break
    texts.push(await recognize(await prepareReceipt(image, attempt.mode, attempt.crop), attempt.psm))
    const picked = pickReceiptText(texts)
    if (picked.sure) return picked.text
  }
  return pickReceiptText(texts).text
}
