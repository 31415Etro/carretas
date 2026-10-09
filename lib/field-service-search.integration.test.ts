import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("../components/operations/mvp-pages.tsx", import.meta.url), "utf8")

test("Operação em Campo usa pesquisa no seletor de OS", () => {
  const fieldServiceSection = source.match(
    /<SectionCard title="Servicos">([\s\S]*?)<\/SectionCard>/,
  )?.[1]

  assert.ok(fieldServiceSection, "seção de serviços da Operação em Campo não encontrada")
  assert.match(fieldServiceSection, /<SearchableSelectField/)
  assert.match(fieldServiceSection, /searchPlaceholder="Pesquisar por OS, cliente, obra ou status\.\.\."/)
  assert.match(fieldServiceSection, /emptyLabel="Nenhuma OS encontrada\."/)
})
