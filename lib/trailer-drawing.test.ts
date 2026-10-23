import assert from "node:assert/strict"
import test from "node:test"
import { drawingDims, renderTrailerSvg, type DrawingInput } from "./trailer-drawing.ts"

const base: DrawingInput = { product: "FZ 1E", revision: "R1", grade: "ilustrativo", dims: { comprimento: 3000, largura: 1500, altura: 1000 } }
const rectWidths = (svg: string) => [...svg.matchAll(/<rect x="[\d.]+" y="[\d.]+" width="([\d.]+)" height="([\d.]+)"/g)].map((m) => [Number(m[1]), Number(m[2])])

test("traz as três vistas, as cotas e as medidas escolhidas", () => {
  const svg = renderTrailerSvg(base)
  for (const text of ["Vista lateral", "Vista superior", "Vista traseira", "Comprimento 3.000 mm", "Largura 1.500 mm", "Altura 1.000 mm"]) assert.ok(svg.includes(text), text)
  assert.ok(svg.startsWith("<svg"))
})
test("a geometria reage às medidas (não é imagem esticada) e é determinística", () => {
  const small = renderTrailerSvg(base)
  const wide = renderTrailerSvg({ ...base, dims: { ...base.dims, largura: 2000 } })
  const long = renderTrailerSvg({ ...base, dims: { ...base.dims, comprimento: 6000 } })
  assert.notEqual(small, wide)
  assert.notEqual(small, long)
  assert.equal(renderTrailerSvg(base), small)
  assert.ok(wide.includes("Largura 2.000 mm") && long.includes("Comprimento 6.000 mm"))
  // a carroceria da vista superior fica mais larga/mais comprida conforme a medida (em proporção)
  const topBody = (svg: string) => rectWidths(svg).find(([, h]) => h > 60 && h < 200) || [0, 0]
  assert.ok(topBody(wide)[1] !== topBody(small)[1] || topBody(long)[0] !== topBody(small)[0])
})
test("sem validação o desenho é identificado como ilustrativo; validado cita a revisão", () => {
  assert.match(renderTrailerSvg(base), /ILUSTRATIVO — NÃO É DESENHO DE FABRICAÇÃO/)
  const ok = renderTrailerSvg({ ...base, grade: "validado" })
  assert.doesNotMatch(ok, /ILUSTRATIVO/)
  assert.match(ok, /revisão R1 validada pela engenharia/)
})
test("textos do usuário são escapados (sem injeção de marcação)", () => {
  const svg = renderTrailerSvg({ ...base, product: '<script>alert(1)</script>', finish: '"><img src=x>', accessories: ["a&b"] })
  assert.ok(!svg.includes("<script>") && !svg.includes("<img"))
  assert.ok(svg.includes("&lt;script&gt;") && svg.includes("a&amp;b"))
})
test("medidas do banco viram dimensões do desenho; sem as três medidas não há desenho", () => {
  assert.deepEqual(drawingDims({ comprimento: "3000", largura: 1500, altura: 1000, balanco_traseiro: 800 }), { comprimento: 3000, largura: 1500, altura: 1000, balanco_traseiro: 800 })
  assert.equal(drawingDims({ comprimento: 3000, largura: 1500 }), null)
})
