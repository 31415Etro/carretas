// Reduz a foto do celular antes de enviar: fotos de câmera têm 5 a 12 MB (12 MP+) e a hospedagem recusa corpo acima de ~4,5 MB.
// Devolve um JPEG de, no máximo, `maxSide` pixels no maior lado (a rotação do EXIF é respeitada).

async function decode(file: Blob): Promise<{ draw: (context: CanvasRenderingContext2D, width: number, height: number) => void; width: number; height: number; close: () => void }> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions)
    return { draw: (context, width, height) => context.drawImage(bitmap, 0, 0, width, height), width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }
  } catch {
    // Safari antigo / formatos que createImageBitmap não abre: tenta pela tag <img> (o navegador também aplica a rotação)
    const url = URL.createObjectURL(file)
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => { const element = new Image(); element.onload = () => resolve(element); element.onerror = () => reject(new Error("decode")); element.src = url })
      return { draw: (context, width, height) => context.drawImage(image, 0, 0, width, height), width: image.naturalWidth, height: image.naturalHeight, close: () => undefined }
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    }
  }
}

export async function compressPhoto(file: File, { maxSide = 1600, quality = 0.8 }: { maxSide?: number; quality?: number } = {}): Promise<File> {
  const source = await decode(file)
  try {
    const scale = Math.min(1, maxSide / Math.max(source.width, source.height))
    const width = Math.max(1, Math.round(source.width * scale)), height = Math.max(1, Math.round(source.height * scale))
    const canvas = document.createElement("canvas")
    canvas.width = width; canvas.height = height
    const context = canvas.getContext("2d")
    if (!context) throw new Error("canvas")
    context.fillStyle = "#ffffff"; context.fillRect(0, 0, width, height)
    source.draw(context, width, height)
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality))
    if (!blob || blob.size === 0) throw new Error("toBlob")
    return new File([blob], (file.name.replace(/\.[^.]+$/, "") || "notinha") + ".jpg", { type: "image/jpeg" })
  } finally {
    source.close()
  }
}
