import assert from "node:assert/strict"
import test from "node:test"
import { buildServiceOrderPhotoCaption, serviceOrderPhotoScopeId } from "./service-order-photo-caption.ts"

const point = {
  id: "11111111-1111-4111-8111-111111111111",
  label: "Ponto 1601",
  local: "Torre 1",
  floor: "Pavimento 16",
  final: "Apartamento",
  environment: "Sala",
}

test("descreve foto de obra com ponto, pavimento e torre", () => {
  const caption = buildServiceOrderPhotoCaption({
    orderType: "obra",
    notes: `equipment:${point.id}`,
    points: [point],
    equipment: [],
  })

  assert.equal(caption.title, "Ponto: Ponto 1601")
  assert.deepEqual(caption.details, ["Pavimento: Pavimento 16", "Torre/Local: Torre 1"])
})

test("descreve foto de PMOC com equipamento, ambiente e identificacao", () => {
  const caption = buildServiceOrderPhotoCaption({
    orderType: "pmoc",
    notes: `equipment:${point.id}`,
    points: [{ ...point, label: "Split 24.000 BTUs" }],
    equipment: [{ id: point.id, tag: "EQ-024", name: "Split 24.000 BTUs", model: "HW24", serialNumber: "ABC123" }],
  })

  assert.equal(caption.title, "Equipamento: EQ-024 - Split 24.000 BTUs")
  assert.deepEqual(caption.details, ["Ambiente: Sala", "Pavimento: Pavimento 16", "Modelo: HW24 | Serie: ABC123"])
})

test("identifica foto antiga e le o escopo mesmo com metadados adicionais", () => {
  assert.equal(serviceOrderPhotoScopeId(`origem:campo\nequipment:${point.id}\noperador:teste`), point.id)
  const caption = buildServiceOrderPhotoCaption({ orderType: "obra", notes: "", points: [point, { ...point, id: "22222222-2222-4222-8222-222222222222" }], equipment: [] })
  assert.equal(caption.title, "Foto geral da OS")
  assert.match(caption.details[0], /foto antiga/)
})
