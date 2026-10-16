import os from "node:os"
import path from "node:path"
import { createWorker, type Worker } from "tesseract.js"

// OCR local (tesseract.js) com o idioma português em public/tessdata. Um único worker é reaproveitado entre as requisições.
let workerPromise: Promise<Worker> | null = null

function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker("por", 1, { langPath: path.join(process.cwd(), "public", "tessdata"), gzip: false, cachePath: path.join(os.tmpdir(), "nd-tesseract") }).catch((error) => {
      workerPromise = null
      throw error
    })
  }
  return workerPromise
}

export async function ocrImage(image: Buffer) {
  const worker = await getWorker()
  const { data } = await worker.recognize(image, { rotateAuto: true })
  return String(data.text || "")
}
