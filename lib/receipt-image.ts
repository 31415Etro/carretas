// Preparação de fotos de notinha: funções puras sobre pixels em tons de cinza (0-255), usadas pelo navegador (lib/ocr-client.ts, via canvas)
// e pelos testes com as notinhas reais (via sharp). Ficam aqui para a leitura testada ser exatamente a que roda no celular.

/** Limiar de Otsu (separa o papel claro do fundo). */
export function otsu(gray: Uint8ClampedArray) {
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

export type Box = { left: number; top: number; right: number; bottom: number }
export const WHOLE: Box = { left: 0, top: 0, right: 1, bottom: 1 }

/**
 * Acha o papel (região clara) numa miniatura em tons de cinza (~240 px de largura): o cupom costuma ocupar 20 a 40% do quadro, com mesa, mão ou
 * painel em volta. Devolve a caixa em fração da foto. Só conta a MAIOR região clara conectada (o resto do quadro, como o céu ou outra folha, não puxa o recorte).
 */
export function paperBox(gray: Uint8ClampedArray, width: number, height: number): Box {
  // o papel é a parte mais clara do quadro: o limiar nunca fica abaixo de 85% do tom que só 5% dos pontos superam (a mesa de madeira clara não entra)
  const sorted = Uint32Array.from(new Uint32Array(256))
  for (const value of gray) sorted[value]++
  let seen = 0, p95 = 255
  for (let level = 255; level >= 0; level--) { seen += sorted[level]; if (seen >= gray.length * 0.05) { p95 = level; break } }
  const threshold = Math.max(110, otsu(gray), Math.round(p95 * 0.85))
  const bright = new Uint8Array(width * height)
  let count = 0
  for (let at = 0; at < gray.length; at++) if (gray[at] >= threshold) { bright[at] = 1; count++ }
  // sem papel claro identificável (foto já recortada ou muito escura): usa a foto inteira
  if (count < width * height * 0.08 || count > width * height * 0.9) return WHOLE
  // maior componente conectado de pixels claros (a mesa clara e o papel podem se tocar: o papel tem texto, então o fechamento abaixo junta o miolo)
  const label = new Int32Array(width * height)
  let bestLabel = 0, bestSize = 0, next = 0
  const stack: number[] = []
  for (let start = 0; start < label.length; start++) {
    if (!bright[start] || label[start]) continue
    next++
    let size = 0
    stack.push(start); label[start] = next
    while (stack.length) {
      const at = stack.pop() as number
      size++
      const x = at % width, y = (at - x) / width
      if (x > 0 && bright[at - 1] && !label[at - 1]) { label[at - 1] = next; stack.push(at - 1) }
      if (x < width - 1 && bright[at + 1] && !label[at + 1]) { label[at + 1] = next; stack.push(at + 1) }
      if (y > 0 && bright[at - width] && !label[at - width]) { label[at - width] = next; stack.push(at - width) }
      if (y < height - 1 && bright[at + width] && !label[at + width]) { label[at + width] = next; stack.push(at + width) }
    }
    if (size > bestSize) { bestSize = size; bestLabel = next }
  }
  const columns = new Uint16Array(width), rows = new Uint16Array(height)
  for (let at = 0; at < label.length; at++) if (label[at] === bestLabel) { columns[at % width]++; rows[Math.floor(at / width)]++ }
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

/** Estica o contraste: o 1% mais escuro vira preto e o 1% mais claro vira branco. */
export function stretch(gray: Uint8ClampedArray) {
  const histogram = new Uint32Array(256)
  for (const value of gray) histogram[value]++
  let low = 0, high = 255
  for (let sum = 0; low < 255 && (sum += histogram[low]) < gray.length * 0.01;) low++
  for (let sum = 0; high > 0 && (sum += histogram[high]) < gray.length * 0.01;) high--
  const range = Math.max(1, high - low)
  return gray.map((value) => ((value - low) * 255) / range)
}

/** Binarização adaptativa (limiar local por média de bloco): segura sombra, reflexo e iluminação desigual do celular. */
export function adaptive(gray: Uint8ClampedArray, width: number, height: number) {
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
