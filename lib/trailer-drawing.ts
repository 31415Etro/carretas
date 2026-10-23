// Desenho 2D paramétrico de reboque aberto de 1 eixo: vista lateral, superior e traseira, com cotas. A geometria é CONSTRUÍDA a partir das medidas
// (nada de esticar foto ou PDF). Enquanto a engenharia não validar o modelo, o desenho sai identificado como ILUSTRATIVO: não é desenho de fabricação.
// Família "reboque_aberto_1_eixo", versão 1. Mudar a geometria exige subir a versão (a configuração vendida guarda a versão usada).

export const TRAILER_TEMPLATE = { key: "reboque_aberto_1_eixo", version: 1 } as const

export type DrawingInput = {
  product: string
  revision?: string | null
  grade: "ilustrativo" | "validado"
  dims: { comprimento: number; largura: number; altura: number; balanco_traseiro?: number | null }
  geometry?: { wheel_diameter?: number; deck_height?: number; drawbar_ratio?: number } | null
  finish?: string | null
  accessories?: string[]
}

const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!)
const fmt = (value: number) => Math.round(value * 10) / 10
const mm = (value: number) => `${Math.round(value).toLocaleString("pt-BR")} mm`

type Box = { x: number; y: number; w: number; h: number }

function dimensionLine(x1: number, y1: number, x2: number, y2: number, label: string, side: "above" | "below" | "left" | "right") {
  const horizontal = y1 === y2
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
  const arrow = (x: number, y: number, dx: number, dy: number) => `<path d="M${x} ${y} l${dx * 7 - dy * 3} ${dy * 7 + dx * 3} M${x} ${y} l${dx * 7 + dy * 3} ${dy * 7 - dx * 3}" stroke="#1d4ed8" stroke-width="1" fill="none"/>`
  const dx = horizontal ? Math.sign(x2 - x1) : 0, dy = horizontal ? 0 : Math.sign(y2 - y1)
  const text = horizontal
    ? `<text x="${mx}" y="${my + (side === "above" ? -5 : 13)}" text-anchor="middle" font-size="11" fill="#1d4ed8">${esc(label)}</text>`
    : `<text x="${mx + (side === "left" ? -6 : 6)}" y="${my}" text-anchor="${side === "left" ? "end" : "start"}" font-size="11" fill="#1d4ed8" dominant-baseline="middle">${esc(label)}</text>`
  return `<g><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#1d4ed8" stroke-width="1"/>${arrow(x1, y1, dx, dy)}${arrow(x2, y2, -dx, -dy)}${text}</g>`
}

function wheel(cx: number, cy: number, r: number) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#374151" stroke="#111827" stroke-width="1.5"/><circle cx="${cx}" cy="${cy}" r="${r * 0.55}" fill="#9ca3af" stroke="#111827"/><circle cx="${cx}" cy="${cy}" r="${r * 0.12}" fill="#111827"/>`
}

/** SVG completo (fundo branco, viewBox 1000x700) com as três vistas. Determinístico: mesma entrada, mesmo desenho. */
export function renderTrailerSvg(input: DrawingInput) {
  const L = Math.max(input.dims.comprimento, 1), W = Math.max(input.dims.largura, 1), H = Math.max(input.dims.altura, 1)
  const wheelD = input.geometry?.wheel_diameter ?? 600
  const deckH = Math.min(input.geometry?.deck_height ?? 500, H * 0.8)
  const drawbarRatio = Math.min(Math.max(input.geometry?.drawbar_ratio ?? 0.3, 0.15), 0.45)
  const drawbar = L * drawbarRatio                                   // lança (parte à frente da carroceria)
  const bodyL = L - drawbar
  const rear = input.dims.balanco_traseiro && input.dims.balanco_traseiro < bodyL ? input.dims.balanco_traseiro : Math.max(Math.min(bodyL * 0.25, 2500), 0)
  const axleX = L - rear                                              // posição do eixo a partir da frente
  const parts: string[] = []

  // --- vista lateral (superior esquerda): escala própria para caber em 600 x 230
  const side: Box = { x: 40, y: 96, w: 600, h: 230 }
  const sideScale = Math.min((side.w - 60) / L, (side.h - 70) / H)
  const sx = (v: number) => fmt(side.x + 30 + v * sideScale)
  const sy = (v: number) => fmt(side.y + side.h - 28 - v * sideScale)   // v = altura a partir do solo
  const r = (wheelD / 2) * sideScale
  parts.push(`<g><text x="${side.x}" y="${side.y - 14}" font-size="12" font-weight="700" fill="#111827">Vista lateral</text>`)
  parts.push(`<line x1="${side.x}" y1="${sy(0)}" x2="${side.x + side.w}" y2="${sy(0)}" stroke="#9ca3af" stroke-dasharray="4 3"/>`)
  parts.push(`<rect x="${sx(drawbar)}" y="${sy(deckH + 40)}" width="${fmt(bodyL * sideScale)}" height="${fmt(40 * sideScale + 2)}" fill="#e5e7eb" stroke="#111827" stroke-width="1.5"/>`)   // plataforma
  parts.push(`<polyline points="${sx(0)},${sy(deckH + 20)} ${sx(drawbar)},${sy(deckH + 20)}" stroke="#111827" stroke-width="2" fill="none"/><circle cx="${sx(0)}" cy="${sy(deckH + 20)}" r="4" fill="#111827"/>`)  // lança e engate
  parts.push(`<rect x="${sx(drawbar)}" y="${sy(H)}" width="${fmt(bodyL * sideScale)}" height="${fmt((H - deckH - 40) * sideScale)}" fill="none" stroke="#111827" stroke-width="1.5"/>`)  // laterais
  const rails = Math.max(1, Math.round((H - deckH) / 350))
  for (let i = 1; i < rails; i++) parts.push(`<line x1="${sx(drawbar)}" y1="${sy(deckH + 40 + ((H - deckH - 40) * i) / rails)}" x2="${sx(L)}" y2="${sy(deckH + 40 + ((H - deckH - 40) * i) / rails)}" stroke="#6b7280"/>`)
  parts.push(wheel(sx(axleX), fmt(sy(0) - r), fmt(r)))
  parts.push(dimensionLine(Number(sx(0)), side.y + side.h + 4, Number(sx(L)), side.y + side.h + 4, `Comprimento ${mm(L)}`, "below"))
  parts.push(dimensionLine(side.x + 4, Number(sy(H)), side.x + 4, Number(sy(0)), `Altura ${mm(H)}`, "right"))
  parts.push("</g>")

  // --- vista superior (inferior esquerda): 600 x 230
  const top: Box = { x: 40, y: 410, w: 600, h: 220 }
  const topScale = Math.min((top.w - 60) / L, (top.h - 70) / (W + 200))
  const tx = (v: number) => fmt(top.x + 30 + v * topScale)
  const ty = (v: number) => fmt(top.y + 20 + v * topScale)
  parts.push(`<g><text x="${top.x}" y="${top.y - 14}" font-size="12" font-weight="700" fill="#111827">Vista superior</text>`)
  parts.push(`<rect x="${tx(drawbar)}" y="${ty(100)}" width="${fmt(bodyL * topScale)}" height="${fmt(W * topScale)}" fill="#f3f4f6" stroke="#111827" stroke-width="1.5"/>`)
  parts.push(`<polygon points="${tx(0)},${ty(100 + W / 2)} ${tx(drawbar)},${ty(100)} ${tx(drawbar)},${ty(100 + W)}" fill="none" stroke="#111827" stroke-width="1.5"/>`)
  const wheelW = 160
  for (const y of [100 - wheelW * 0.6, 100 + W - wheelW * 0.4]) parts.push(`<rect x="${fmt(Number(tx(axleX)) - (wheelD / 2) * topScale)}" y="${ty(y)}" width="${fmt(wheelD * topScale)}" height="${fmt(wheelW * topScale)}" fill="#374151" stroke="#111827"/>`)
  parts.push(dimensionLine(Number(tx(drawbar)) + bodyL * topScale + 14, Number(ty(100)), Number(tx(drawbar)) + bodyL * topScale + 14, Number(ty(100 + W)), `Largura ${mm(W)}`, "right"))
  parts.push("</g>")

  // --- vista traseira (direita): altura x largura
  const back: Box = { x: 690, y: 96, w: 290, h: 280 }
  const backScale = Math.min((back.w - 150) / (W + 300), (back.h - 70) / H)
  const bx = (v: number) => fmt(back.x + 30 + (v + 150) * backScale)
  const by = (v: number) => fmt(back.y + back.h - 28 - v * backScale)
  parts.push(`<g><text x="${back.x}" y="${back.y - 14}" font-size="12" font-weight="700" fill="#111827">Vista traseira</text>`)
  parts.push(`<line x1="${back.x}" y1="${by(0)}" x2="${back.x + back.w}" y2="${by(0)}" stroke="#9ca3af" stroke-dasharray="4 3"/>`)
  parts.push(`<rect x="${bx(0)}" y="${by(H)}" width="${fmt(W * backScale)}" height="${fmt((H - deckH) * backScale)}" fill="none" stroke="#111827" stroke-width="1.5"/>`)
  parts.push(`<rect x="${bx(0)}" y="${by(deckH + 40)}" width="${fmt(W * backScale)}" height="${fmt(40 * backScale + 2)}" fill="#e5e7eb" stroke="#111827" stroke-width="1.5"/>`)
  const rb = (wheelD / 2) * backScale
  for (const cx of [-70, W + 70]) parts.push(`<rect x="${fmt(Number(bx(cx)) - (wheelW / 2) * backScale)}" y="${fmt(Number(by(0)) - 2 * rb)}" width="${fmt(wheelW * backScale)}" height="${fmt(2 * rb)}" fill="#374151" stroke="#111827"/>`)
  parts.push(dimensionLine(Number(bx(0)), Number(by(0)) + 16, Number(bx(W)), Number(by(0)) + 16, `Largura ${mm(W)}`, "below"))
  parts.push(dimensionLine(Number(bx(W)) + 34, Number(by(H)), Number(bx(W)) + 34, Number(by(0)), `Altura ${mm(H)}`, "right"))
  parts.push("</g>")

  const validated = input.grade === "validado"
  const banner = validated
    ? `Desenho conforme revisão ${esc(input.revision || "-")} validada pela engenharia`
    : "ILUSTRATIVO — NÃO É DESENHO DE FABRICAÇÃO. Geometria esquemática a partir das medidas escolhidas; aguarda modelagem e validação técnica."
  // texto do quadro de medidas: quebra em linhas que cabem na caixa (38 caracteres) e limita a 5 linhas
  const wrap = (text: string, max = 38) => {
    const lines: string[] = []
    let line = ""
    for (const word of text.split(/\s+/)) {
      if ((line + " " + word).trim().length > max && line) { lines.push(line); line = word } else line = (line + " " + word).trim()
    }
    if (line) lines.push(line)
    return lines
  }
  const extraLines = [...(input.finish ? wrap(`Acabamento: ${input.finish}`) : []), ...(input.accessories?.length ? wrap(`Acessórios: ${input.accessories.join(", ")}`) : [])]
  const shown = extraLines.slice(0, 5).map((line, index, all) => (index === 4 && extraLines.length > 5 ? `${line.slice(0, 37)}…` : line))
  const extras = shown.length ? shown.map((line, index) => `<tspan x="712" dy="${index === 0 ? 0 : 15}">${esc(line)}</tspan>`).join("") : "Sem acabamento/acessórios escolhidos"
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 700" width="1000" height="700" font-family="Arial, Helvetica, sans-serif">
<rect width="1000" height="700" fill="#ffffff"/>
<text x="40" y="34" font-size="16" font-weight="700" fill="#111827">${esc(input.product)}</text>
<text x="40" y="52" font-size="11" fill="#4b5563">Comprimento ${mm(L)} · Largura ${mm(W)} · Altura ${mm(H)} · Revisão ${esc(input.revision || "sem revisão validada")} · modelo de desenho ${TRAILER_TEMPLATE.key} v${TRAILER_TEMPLATE.version}</text>
${parts.join("\n")}
<rect x="700" y="400" width="270" height="230" fill="#f9fafb" stroke="#d1d5db"/>
<text x="712" y="422" font-size="12" font-weight="700" fill="#111827">Medidas selecionadas</text>
<text x="712" y="446" font-size="12" fill="#111827">Comprimento: ${mm(L)}</text>
<text x="712" y="466" font-size="12" fill="#111827">Largura: ${mm(W)}</text>
<text x="712" y="486" font-size="12" fill="#111827">Altura: ${mm(H)}</text>
<text x="712" y="506" font-size="12" fill="#111827">Altura da plataforma: ${mm(deckH)}</text>
<text x="712" y="526" font-size="12" fill="#111827">Eixo a ${mm(rear)} da traseira</text>
<text x="712" y="552" font-size="11" fill="#4b5563">${extras || "Sem acabamento/acessórios escolhidos"}</text>
<rect x="40" y="656" width="930" height="30" fill="${validated ? "#ecfdf5" : "#fff7ed"}" stroke="${validated ? "#34d399" : "#fb923c"}"/>
<text x="52" y="676" font-size="11" font-weight="700" fill="${validated ? "#065f46" : "#9a3412"}">${banner}</text>
</svg>`
}

/** Valores numéricos para o desenho, a partir do que o banco devolve em params/derived. */
export function drawingDims(params: Record<string, unknown>) {
  const num = (key: string) => { const value = Number(params[key]); return Number.isFinite(value) && value > 0 ? value : null }
  const comprimento = num("comprimento"), largura = num("largura"), altura = num("altura")
  return comprimento && largura && altura ? { comprimento, largura, altura, balanco_traseiro: num("balanco_traseiro") } : null
}
