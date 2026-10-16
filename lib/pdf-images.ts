// Extrai as imagens JPEG (DCTDecode) embutidas num PDF escaneado: é o que celulares e apps de scanner (CamScanner etc.) geram.
// PDFs com imagens em outros formatos (Flate/JPX) não são cobertos aqui. Funciona no navegador e no servidor (só Uint8Array).

const latin1 = new TextDecoder("latin1")

/** O PDF é uma foto/escaneamento: tem uma imagem JPEG grande e nenhuma fonte de texto. */
export function looksScanned(pdf: Uint8Array) {
  return extractJpegImages(pdf).some((image) => image.length > 100_000) && !/\/Type\s*\/Font\b/.test(latin1.decode(pdf))
}

export function extractJpegImages(pdf: Uint8Array): Uint8Array[] {
  const text = latin1.decode(pdf) // latin1: cada byte vira um caractere, então os índices servem para o Uint8Array
  const images: Uint8Array[] = []
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
    const slice = pdf.subarray(start, end)
    let eoi = -1
    for (let index = slice.length - 2; index > 0; index--) {
      if (slice[index] === 0xff && slice[index + 1] === 0xd9) { eoi = index; break }
    }
    if (slice[0] === 0xff && slice[1] === 0xd8 && eoi > 0) {
      images.push(slice.subarray(0, eoi + 2))
      from = end
    }
  }
  return images
}
