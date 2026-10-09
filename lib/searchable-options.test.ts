import assert from "node:assert/strict"
import test from "node:test"

import { filterSearchableOptions } from "./searchable-options.ts"

test("filtra opções do seletor ignorando acentos e maiúsculas", () => {
  const options = [
    { value: "env-1", label: "Recepção - Térreo - Bloco A" },
    { value: "env-2", label: "Sala Técnica - Primeiro andar" },
  ]

  assert.deepEqual(filterSearchableOptions(options, "recepcao").map((option) => option.value), ["env-1"])
  assert.deepEqual(filterSearchableOptions(options, "TECNICA").map((option) => option.value), ["env-2"])
  assert.deepEqual(filterSearchableOptions(options, "bloco a").map((option) => option.value), ["env-1"])
})
