import assert from "node:assert/strict"
import test from "node:test"
import { emptyProductForm, formFromProductDetail, linkFromOption, margin, productPayload, specProfileFor, structureCost, validateProduct, type ProductForm } from "./products.ts"

const valid = (patch: Partial<ProductForm> = {}): ProductForm => ({ ...emptyProductForm(), name: "Carreta FZ 1E", salePrice: "5.000,00", category: "Carreta", ...patch })
const withKit = (form: ProductForm, quantity = "1", cost = 100) => ({ ...form, structure: { ...form.structure, kits: [...form.structure.kits, { ...linkFromOption({ id: `k${form.structure.kits.length}`, sku: "KIT-000001", name: "Kit", version: 1, version_id: "v", cost, components_count: 2 }), quantity }] } })

test("perfil de especificações segue a categoria", () => {
  assert.equal(specProfileFor("Carreta Náutica").id, "carreta")
  assert.equal(specProfileFor("Acessórios").id, "implemento")
  assert.equal(specProfileFor("Serviço de pintura").id, "geral")
  assert.ok(!specProfileFor("Outros").fields.some((field) => field.key === "axle_count"))
})
test("validação do cadastro: só o nome é obrigatório; preço, SKU e NCM são opcionais", () => {
  assert.deepEqual(validateProduct(valid()), {})
  assert.ok(validateProduct(valid({ name: "" })).name)
  assert.deepEqual(validateProduct(valid({ name: "P", salePrice: "" })), {})                 // sem preço: salva (só não fica disponível para venda)
  assert.deepEqual(validateProduct(valid({ salePrice: "", allowsSale: false })), {})
  assert.deepEqual(validateProduct(valid({ autoSku: false, sku: "PRD 1" })), {})
  assert.ok(validateProduct(valid({ leadTimeDays: "2,5" })).leadTimeDays)
  assert.ok(validateProduct(valid({ specs: { axle_count: "1,5" } }))["spec:axle_count"])
  assert.deepEqual(validateProduct(valid({ ncm: "8716" })), {})                               // NCM incompleto é ignorado, não bloqueia
  assert.deepEqual(validateProduct(valid({ ncm: "87163900", ncmConfirmed: false })), {})
  assert.equal(productPayload(valid({ ncm: "8716" })).ncm, "")
  assert.equal(productPayload(valid({ ncm: "8716.39.00", ncmConfirmed: false })).ncm, "87163900")
  assert.equal(productPayload(valid({ salePrice: "", allowsSale: true })).allows_sale, false)
})

test("estrutura opcional: sem kit não envia estrutura; kit repetido conta uma vez e quantidade vazia vira 1", () => {
  assert.deepEqual(validateProduct(valid(), { requireStructure: true }), {})
  assert.equal("structure" in productPayload(valid(), { withStructure: true }), false)
  const zero = withKit(valid(), "0")
  assert.deepEqual(validateProduct(zero, { requireStructure: true }), {})
  assert.equal((productPayload(zero, { withStructure: true }).structure as any).kits[0].quantity, 1)
  const dup = withKit(valid()); dup.structure.kits = [...dup.structure.kits, { ...dup.structure.kits[0], key: "outra" }]
  assert.deepEqual(validateProduct(dup, { requireStructure: true }), {})
  assert.equal((productPayload(dup, { withStructure: true }).structure as any).kits.length, 1)
})

test("custo da estrutura e margem (preço manual, sem forçar pelo custo)", () => {
  let form = withKit(withKit(valid(), "2", 50), "1", 30)
  form = { ...form, structure: { ...form.structure, laborCost: "20", overheadCost: "5", otherCost: "" } }
  assert.deepEqual(structureCost(form.structure), { materials: 130, labor: 20, overhead: 5, other: 0, total: 155 })
  assert.deepEqual(margin(1000, 155), { value: 845, percent: 84.5 })
  assert.deepEqual(margin(0, 155), { value: 0, percent: null })
})
test("payload: só vai estrutura quando alterada; especificações fora do perfil não vão", () => {
  const form = withKit(valid({ specs: { length: "450", axle_count: "1", finish_type: " Galvanizado " }, engineeringNotes: "Eixo único", ncm: "8716.39.00", ncmConfirmed: true }))
  const payload: any = productPayload(form, { withStructure: true })
  assert.equal(payload.sale_price, 5000)
  assert.equal(payload.ncm, "87163900")
  assert.deepEqual([payload.specs.length, payload.specs.axle_count, payload.specs.finish_type, payload.specs.engineering_notes], [450, 1, "Galvanizado", "Eixo único"])
  assert.equal(payload.structure.kits[0].quantity, 1)
  assert.equal("structure" in (productPayload(form) as object), false)
  const other: any = productPayload(valid({ category: "Serviço", specs: { axle_count: "2", net_weight: "10" } }))
  assert.equal("axle_count" in other.specs, false)
  assert.equal(other.specs.net_weight, 10)
})
test("detalhe do banco vira formulário com a estrutura da versão exibida", () => {
  const form = formFromProductDetail({
    product: { name: "Carreta", internal_code: "PRD-000001", category: "Carreta", sale_price: 5000, net_weight: 320, ncm: "87163900", ncm_confirmed_by: "Fiscal", available_for_quote: false },
    shown_version_id: "v2", versions: [{ id: "v2", labor_cost: 100, overhead_cost: 0 }],
    kits: [{ kit_id: "k1", sku: "KIT-000001", name: "Chassi", quantity: "2.0000", pinned_version_id: null, kit_version: 3, kit_cost: 40, components_count: 4 }], documents: [{ name: "Ficha", url: "https://x", kind: "Ficha técnica" }],
  })
  assert.deepEqual([form.sku, form.autoSku, form.salePrice, form.specs.net_weight, form.availableForQuote, form.ncmConfirmed], ["PRD-000001", false, "5000", "320", false, true])
  assert.deepEqual([form.structure.kits[0].quantity, form.structure.kits[0].activeVersion, form.structure.laborCost, form.documents.length], ["2", 3, "100", 1])
})
