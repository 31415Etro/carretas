// OCR de fotos/escaneamentos de DANFE NO NAVEGADOR (tesseract.js). O servidor só recebe o texto lido e analisa: assim a leitura não
// depende do tempo limite da hospedagem (erro 504) e não gasta processamento do servidor. O idioma português fica em /tessdata.
import { isReliableReading, parseInvoicePdfText } from "./nfe-parser"
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

/** Lê uma foto de notinha (cupom/recibo, não é DANFE): página inteira, sem o recorte "só o topo" usado para notas fiscais. */
export async function ocrReceiptImage(file: File, progress: Progress = () => undefined) {
  if (isHeicFile(file)) throw new Error("Fotos HEIC (iPhone) não são lidas. Envie em JPG ou PNG, ou tire um print.")
  progressSink = progress
  progress("Lendo a notinha...")
  return recognize(await prepare(file, 1), "3")
}
