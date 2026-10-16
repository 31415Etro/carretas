// Extrai as imagens JPEG (DCTDecode) embutidas num PDF escaneado: é o que celulares e apps de scanner (CamScanner etc.) geram.
// PDFs com imagens em outros formatos (Flate/JPX) não são cobertos aqui.

export function extractJpegImages(pdf: Uint8Array): Buffer[] {
  const buffer = Buffer.from(pdf)
  const text = buffer.toString("latin1")
  const images: Buffer[] = []
  let from = 0
  for (;;) {
    const filter = text.indexOf("/DCTDecode", from)
    if (filter < 0) break
    const streamKeyword = text.indexOf("stream", filter)
    const end = text.indexOf("endstream", streamKeyword)
    from = filter + 10
    if (streamKeyword < 0 || end < 0 || streamKeyword - filter > 600) continue
    let start = streamKeyword + "stream".length
    if (text[start] === "\r") start++
    if (text[start] === "\n") start++
    const slice = buffer.subarray(start, end)
    const eoi = slice.lastIndexOf(Buffer.from([0xff, 0xd9]))
    if (slice[0] === 0xff && slice[1] === 0xd8 && eoi > 0) {
      images.push(slice.subarray(0, eoi + 2))
      from = end
    }
  }
  return images
}
