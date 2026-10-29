// OCR de fotos/escaneamentos de DANFE NO NAVEGADOR (tesseract.js). O servidor só recebe o texto lido e analisa: assim a leitura não
// depende do tempo limite da hospedagem (erro 504) e não gasta processamento do servidor. O idioma português fica em /tessdata.
import { isReliableReading, parseInvoicePdfText } from "./nfe-parser"
import { pickReceiptText } from "./receipt-ocr"
import { extractJpegImages, looksScanned } from "./pdf-images"

type Progress = (message: string) => void
type OcrWorker = {
  recognize: (image: Blob) => Promise<{ data: { text: string } }>
  setParameters: (params: Record<string, string>) => Promise<unknown>
}

let workerPromise: Promise<OcrWorker> | null = null
let progressSink: Progress = () => undefined

function getWorker() {
  if (!workerPromise) {
    workerPromise = import("tesseract.js").then(async ({ createWorker }) => {
      const worker = await createWorker("por", 1, {
        langPath: "/tessdata",
        gzip: false,
        logger: (message: { status: string; progress: number }) => {
          if (message.status === "recognizing text") progressSink(`Lendo a nota (OCR)... ${Math.round(message.progress * 100)}%`)
        },
      })
      return worker as unknown as OcrWorker
    }).catch((error) => {
      workerPromise = null
      throw error
    })
  }
  return workerPromise
}

/** Começa a carregar o OCR (motor e idioma) para a primeira leitura sair mais rápido. */
export function warmClientOcr() {
  void getWorker().catch(() => undefined)
}

export const isImageFile = (file: File) => /\.(png|jpe?g|webp|bmp|tiff?|gif)$/i.test(file.name) || file.type.startsWith("image/")
export const isHeicFile = (file: File) => /\.(heic|heif)$/i.test(file.name) || /heic|heif/i.test(file.type)
export const isPdfFile = (file: File) => /\.pdf$/i.test(file.name) || file.type === "application/pdf"

/**
 * Prepara a foto: reduz (fotos de celular têm 12 MP+), converte para tons de cinza, estica o contraste e, em página em pé,
 * mantém só a parte de cima (chave, destinatário, parcelas e total).
 */
async function prepare(source: Blob, topShare: number): Promise<Blob> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(source) // respeita a rotação do EXIF
  } catch {
    throw new Error("Não consegui abrir esta imagem. Envie em JPG ou PNG.")
  }
  const target = Math.min(2000, Math.max(1600, bitmap.width))
  const scale = target / bitmap.width
  const width = target
  const height = Math.round(bitmap.height * scale)
  const cropHeight = topShare < 1 && height >= width * 1.1 ? Math.round(height * topShare) : height
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = cropHeight
  const context = canvas.getContext("2d", { willReadFrequently: true })!
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const image = context.getImageData(0, 0, width, cropHeight)
  const pixels = image.data
  const histogram = new Uint32Array(256)
  for (let index = 0; index < pixels.length; index += 4) {
    const gray = (pixels[index] * 299 + pixels[index + 1] * 587 + pixels[index + 2] * 114) / 1000
    pixels[index] = pixels[index + 1] = pixels[index + 2] = gray
    histogram[gray | 0]++
  }
  const total = width * cropHeight
  let low = 0
  let high = 255
  for (let sum = 0; low < 255 && (sum += histogram[low]) < total * 0.01;) low++
  for (let sum = 0; high > 0 && (sum += histogram[high]) < total * 0.01;) high--
  const range = Math.max(1, high - low)
  for (let index = 0; index < pixels.length; index += 4) {
    const stretched = Math.max(0, Math.min(255, ((pixels[index] - low) * 255) / range))
    pixels[index] = pixels[index + 1] = pixels[index + 2] = stretched
  }
  context.putImageData(image, 0, 0)
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Falha ao preparar a imagem."))), "image/png"))
}

async function recognize(image: Blob, pageMode: "3" | "4") {
  const worker = await getWorker()
  await worker.setParameters({ tessedit_pageseg_mode: pageMode })
  return String((await worker.recognize(image)).data.text || "")
}

/** A leitura rápida serve se achou a chave, o campo do valor total e as parcelas (quando há) fecham com o total. */
function good(text: string) {
  const invoice = parseInvoicePdfText(text, { ocr: true })
  const ok = isReliableReading(text, invoice)
  console.debug("[ocr] leitura", { total: invoice.total, totalDoCampo: invoice.totalFromLabel, parcelas: invoice.installments.length, serve: ok })
  return ok
}

async function ocrOneImage(image: Blob) {
  const quick = await recognize(await prepare(image, 0.7), "4")
  if (good(quick)) return quick
  const full = await recognize(await prepare(image, 1), "3") // mais lento: lê a página inteira
  return good(full) ? full : `${quick}\n${full}`
}

/** Precisa de OCR? Imagens sempre; PDF só se for escaneado (sem texto). XML e PDF com texto vão direto ao servidor. */
export async function needsOcr(file: File) {
  if (isImageFile(file) || isHeicFile(file)) return true
  if (isPdfFile(file)) return looksScanned(new Uint8Array(await file.arrayBuffer()))
  return false
}

/** Lê a foto/escaneamento por OCR e devolve o texto. */
export async function ocrInvoiceFile(file: File, progress: Progress = () => undefined) {
  if (isHeicFile(file)) throw new Error("Fotos HEIC (iPhone) não são lidas. Envie em JPG ou PNG (no iPhone: Ajustes > Câmera > Formatos > Mais Compatível) ou tire um print.")
  progressSink = progress
  progress("Preparando a imagem...")
  const images: Blob[] = isPdfFile(file)
    ? extractJpegImages(new Uint8Array(await file.arrayBuffer())).filter((image) => image.length > 20_000).slice(0, 3).map((image) => new Blob([image.slice().buffer], { type: "image/jpeg" }))
    : [file]
  if (!images.length) throw new Error("Este PDF não tem uma imagem JPEG que eu consiga ler. Envie o XML, ou a nota como foto JPG/PNG.")
  progress("Carregando o leitor de texto (OCR)...")
  const texts: string[] = []
  for (const image of images) texts.push(await ocrOneImage(image))
  return texts.join("\n")
}

/** Pixels da imagem já em tons de cinza. */
function grayPixels(image: ImageData) {
  const pixels = image.data
  const gray = new Uint8ClampedArray(pixels.length / 4)
  for (let index = 0, at = 0; index < pixels.length; index += 4, at++) gray[at] = (pixels[index] * 299 + pixels[index + 1] * 587 + pixels[index + 2] * 114) / 1000
  return gray
}

/** Limiar de Otsu (separa o papel claro do fundo). */
function otsu(gray: Uint8ClampedArray) {
  const histogram = new Uint32Array(256)
  for (const value of gray) histogram[value]++
  const total = gray.length
  let sumAll = 0
  for (let level = 0; level < 256; level++) sumAll += level * histogram[level]
  let sumBack = 0, weightBack = 0, best = 0, threshold = 128
  for (let level = 0; level < 256; level++) {
    weightBack += histogram[level]
    if (!weightBack) continue
    const weightFront = total - weightBack
    if (!weightFront) break
    sumBack += level * histogram[level]
    const between = weightBack * weightFront * (sumBack / weightBack - (sumAll - sumBack) / weightFront) ** 2
    if (between > best) { best = between; threshold = level }
  }
  return threshold
}

/** Acha o papel (região clara) na foto: o cupom costuma ocupar 20 a 40% do quadro, com mesa, mão ou painel em volta. Devolve a caixa em fração da foto. */
function findPaper(bitmap: ImageBitmap) {
  const width = 240, height = Math.max(1, Math.round((bitmap.height * width) / bitmap.width))
  const canvas = document.createElement("canvas")
  canvas.width = width; canvas.height = height
  const context = canvas.getContext("2d", { willReadFrequently: true })!
  context.drawImage(bitmap, 0, 0, width, height)
  const gray = grayPixels(context.getImageData(0, 0, width, height))
  const threshold = Math.max(110, otsu(gray))
  const columns = new Uint16Array(width), rows = new Uint16Array(height)
  let bright = 0
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (gray[y * width + x] >= threshold) { columns[x]++; rows[y]++; bright++ }
  // sem papel claro identificável (foto já recortada ou muito escura): usa a foto inteira
  if (bright < width * height * 0.08 || bright > width * height * 0.9) return { left: 0, top: 0, right: 1, bottom: 1 }
  const span = (counts: Uint16Array, margin: number) => {
    const cut = Math.max(...counts) * 0.3
    const first = counts.findIndex((value) => value >= cut)
    let last = counts.length - 1
    while (last > first && counts[last] < cut) last--
    return [Math.max(0, first / counts.length - margin), Math.min(1, (last + 1) / counts.length + margin)]
  }
  const [left, right] = span(columns, 0.03), [top, bottom] = span(rows, 0.02)
  return { left, top, right, bottom }
}

/** Binarização adaptativa (limiar local por média de bloco): segura sombra, reflexo e iluminação desigual do celular. */
function adaptive(gray: Uint8ClampedArray, width: number, height: number) {
  const stride = width + 1
  const integral = new Float64Array(stride * (height + 1))
  for (let y = 1; y <= height; y++) {
    let rowSum = 0
    for (let x = 1; x <= width; x++) { rowSum += gray[(y - 1) * width + (x - 1)]; integral[y * stride + x] = integral[(y - 1) * stride + x] + rowSum }
  }
  const radius = Math.max(12, Math.round(width / 28)), out = new Uint8ClampedArray(gray.length)
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius), y1 = Math.min(height, y + radius + 1)
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius), x1 = Math.min(width, x + radius + 1)
      const sum = integral[y1 * stride + x1] - integral[y0 * stride + x1] - integral[y1 * stride + x0] + integral[y0 * stride + x0]
      out[y * width + x] = gray[y * width + x] * (x1 - x0) * (y1 - y0) < sum * 0.88 ? 0 : 255
    }
  }
  return out
}

/** Prepara a notinha: recorta o papel, amplia para o texto ficar legível (~2200 px de largura) e entrega em tons de cinza ou binarizada. */
async function prepareReceipt(bitmap: ImageBitmap, mode: "gray" | "binary", crop: boolean): Promise<Blob> {
  const box = crop ? findPaper(bitmap) : { left: 0, top: 0, right: 1, bottom: 1 }
  const sx = Math.round(box.left * bitmap.width), sy = Math.round(box.top * bitmap.height)
  const sw = Math.max(1, Math.round((box.right - box.left) * bitmap.width)), sh = Math.max(1, Math.round((box.bottom - box.top) * bitmap.height))
  const scale = Math.min(2200 / sw, Math.sqrt(9_000_000 / (sw * sh)), 3) // largura-alvo, sem estourar a memória do celular
  const width = Math.max(1, Math.round(sw * scale)), height = Math.max(1, Math.round(sh * scale))
  const canvas = document.createElement("canvas")
  canvas.width = width; canvas.height = height
  const context = canvas.getContext("2d", { willReadFrequently: true })!
  context.fillStyle = "#ffffff"; context.fillRect(0, 0, width, height)
  context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height)
  const image = context.getImageData(0, 0, width, height)
  let gray = grayPixels(image)
  const histogram = new Uint32Array(256)
  for (const value of gray) histogram[value]++
  let low = 0, high = 255
  for (let sum = 0; low < 255 && (sum += histogram[low]) < gray.length * 0.01;) low++
  for (let sum = 0; high > 0 && (sum += histogram[high]) < gray.length * 0.01;) high--
  const range = Math.max(1, high - low)
  gray = gray.map((value) => ((value - low) * 255) / range)
  if (mode === "binary") gray = adaptive(gray, width, height)
  for (let at = 0, index = 0; at < gray.length; at++, index += 4) image.data[index] = image.data[index + 1] = image.data[index + 2] = gray[at]
  context.putImageData(image, 0, 0)
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Falha ao preparar a imagem."))), "image/png"))
}

async function recognizeMode(image: Blob, pageMode: "3" | "4" | "6" | "11") {
  const worker = await getWorker()
  await worker.setParameters({ tessedit_pageseg_mode: pageMode })
  return String((await worker.recognize(image)).data.text || "")
}

/**
 * Lê uma foto de notinha (cupom/recibo/DANFE simplificado) na foto ORIGINAL do celular (a reduzida perde o texto). Recorta o papel do
 * fundo, amplia e tenta em sequência: tons de cinza, binarização local e a foto inteira, parando assim que o valor total fecha.
 * Devolve o texto da leitura que fechou (ou todos juntos, se nenhuma fechou).
 */
export async function ocrReceiptImage(file: File, progress: Progress = () => undefined) {
  if (isHeicFile(file)) throw new Error("Fotos HEIC (iPhone) não são lidas. Envie em JPG ou PNG, ou tire um print.")
  progressSink = progress
  progress("Lendo a notinha...")
  let bitmap: ImageBitmap
  try { bitmap = await createImageBitmap(file) } catch { throw new Error("Não consegui abrir esta imagem. Envie em JPG ou PNG.") }
  const attempts: Array<{ mode: "gray" | "binary"; crop: boolean; psm: "6" | "4" | "11" | "3" }> = [
    { mode: "gray", crop: true, psm: "6" }, { mode: "binary", crop: true, psm: "6" }, { mode: "gray", crop: true, psm: "4" }, { mode: "gray", crop: false, psm: "11" }, { mode: "binary", crop: false, psm: "3" },
  ]
  const texts: string[] = []
  try {
    for (const attempt of attempts) {
      texts.push(await recognizeMode(await prepareReceipt(bitmap, attempt.mode, attempt.crop), attempt.psm))
      const picked = pickReceiptText(texts)
      if (picked.sure) return picked.text
    }
  } finally { bitmap.close() }
  return pickReceiptText(texts).text
}
