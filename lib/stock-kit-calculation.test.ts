import assert from "node:assert/strict"
import test from "node:test"
import { calculateKitComposition, parseKitDefinition } from "./stock-kit-calculation.ts"

const material = (id: string, name: string) => ({ id, name, status: "Ativo" as const, composesKit: true })

const materials = [
  material("tube-14", "Tubo de cobre 1/4"),
  material("tube-58", "Tubo de cobre 5/8"),
  material("line", "Linha de pedreiro"),
  material("corrugated", "Corrugado"),
  material("insulation-14", "Isolante 1/4"),
  material("insulation-58", "Isolante 5/8"),
  material("tape", "Fita Prata"),
]

test("interpreta tamanho e bitolas do nome do KIT", () => {
  assert.deepEqual(parseKitDefinition("Kit10,1|1/4|5/8"), {
    sizeMeters: 10.1,
    diameters: ["1/4", "5/8"],
  })
})

test("calcula toda a composicao pela regra do tamanho do KIT", () => {
  const composition = calculateKitComposition("Kit10,1|1/4|5/8", "", materials)
  assert.equal(composition.completeDefinition, true)
  assert.deepEqual(composition.missingMaterials, [])
  assert.deepEqual(Object.fromEntries(composition.items.map((item) => [item.materialId, item.quantity])), {
    "tube-14": 10.1,
    "insulation-14": 10.1,
    "tube-58": 10.1,
    "insulation-58": 10.1,
    line: 10.5,
    corrugated: 10.1,
    tape: 78.275,
  })
})

test("informa o material obrigatorio ausente", () => {
  const composition = calculateKitComposition("Kit2|1/4|1/2", 2, materials.filter((item) => item.id !== "insulation-14"))
  assert.ok(composition.missingMaterials.includes("Isolante 1/4"))
})
