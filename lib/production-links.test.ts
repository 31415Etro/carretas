import assert from "node:assert/strict"
import test from "node:test"
import { structureMessage, structureProblems, type StructureFacts } from "./production-links.ts"

const facts: StructureFacts = {
  activeBom: { ok: "b1", semKits: "b2", kitQuebrado: "b3", semEstrutura: null },
  kitsOfBom: { b1: [{ kitId: "k1", kitName: "Chassi" }], b2: [], b3: [{ kitId: "k1", kitName: "Chassi" }, { kitId: "k9", kitName: "Eixos" }] },
  kitReady: { k1: true, k9: false },
}

test("produto com estrutura, kits e matérias-primas não tem problema", () => {
  assert.deepEqual(structureProblems([{ productId: "ok", name: "FZ 1E" }], facts), [])
})

test("aponta cada tipo de vínculo quebrado e não repete o mesmo produto", () => {
  const problems = structureProblems([{ productId: "semEstrutura", name: "A" }, { productId: "semKits", name: "B" }, { productId: "kitQuebrado", name: "C" }, { productId: "semEstrutura", name: "A" }, { productId: "naoExiste", name: "D" }], facts)
  assert.deepEqual(problems.map((item) => [item.product, item.problem]), [
    ["A", "não tem estrutura de fabricação ativa"], ["B", "a estrutura ativa não tem kits"], ["C", "o kit Eixos não tem versão ativa com matérias-primas"], ["D", "não tem estrutura de fabricação ativa"],
  ])
  assert.match(structureMessage(problems), /"A" não tem estrutura de fabricação ativa; "B"/)
  assert.equal(structureMessage([]), "")
})
