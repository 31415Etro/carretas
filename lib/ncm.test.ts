import assert from "node:assert/strict"
import test from "node:test"
import { digitsOf, formatNcm, isCurrent, isLeafCode, rankNcm, searchTerms, suggestionOutcome, wordsOf, type NcmRecord } from "./ncm.ts"

const rec = (codigo: string, descricao: string, inicio = "2022-04-01", fim = "9999-12-31"): NcmRecord => ({ codigo, descricao, data_inicio: inicio, data_fim: fim, tipo_ato: "Res Camex", numero_ato: "000272", ano_ato: "2021" })
const table = [
  rec("87.16", "Reboques e semirreboques, para quaisquer veículos; outros veículos não autopropulsados; suas partes."),
  rec("8716.10.00", "- Reboques e semirreboques, para habitação ou para acampar, do tipo <i>trailer</i> (caravana*)"),
  rec("8716.31.00", "-- Tanques (cisternas)"),
  rec("8716.39.00", "-- Outros reboques e semirreboques para transporte de mercadorias"),
  rec("7318.15.00", "-- Outros parafusos e pinos ou pernos, mesmo com as porcas e arruelas"),
  rec("7318.16.00", "-- Porcas", "2012-01-01", "2021-12-31"),
]

test("só sugere códigos de 8 dígitos vigentes; ignora capítulos, posições e códigos vencidos", () => {
  const out = rankNcm(table, "reboque semirreboque transporte mercadorias")
  assert.ok(out.every((c) => /^\d{8}$/.test(c.code)))
  assert.equal(out[0].code, "87163900")
  assert.ok(!rankNcm(table, "porcas", "2026-10-22").some((c) => c.code === "73181600")) // 7318.16.00 venceu em 2021: nunca é sugerido
})

test("no máximo 3 candidatos, com fonte, ato legal, palavras em comum e justificativa", () => {
  const out = rankNcm([...table, rec("8716.80.00", "-- Outros veículos: reboques")], "reboques semirreboques")
  assert.ok(out.length <= 3)
  assert.match(out[0].source, /Siscomex.*Res Camex 000272\/2021/)
  assert.ok(out[0].matchedWords.length >= 1)
  assert.match(out[0].justification, /Coincide em/)
})

test("singular e plural casam (parafuso x parafusos) e a confiança reflete o quanto casou", () => {
  const out = rankNcm(table, "parafuso porca arruela aço")
  assert.equal(out[0].code, "73181500")
  assert.notEqual(out[0].confidence, "baixa")
})

test("sem palavra em comum não inventa NCM: pede classificação manual", () => {
  const out = rankNcm(table, "xyzzy qwerty")
  assert.deepEqual(out, [])
  const outcome = suggestionOutcome(out)
  assert.equal(outcome.needsManualReview, true)
  assert.match(outcome.message, /manualmente/)
})

test("confiança baixa (uma palavra só) também exige revisão manual", () => {
  const out = rankNcm(table, "tanques refrigerados inox industriais premium")
  assert.ok(out.length >= 1)
  assert.equal(out[0].confidence, "baixa")
  assert.equal(suggestionOutcome(out).needsManualReview, true)
})

test("utilitários: formatação, dígitos, vigência e termos de busca", () => {
  assert.equal(formatNcm("87163900"), "8716.39.00")
  assert.equal(digitsOf("8716.39.00"), "87163900")
  assert.equal(isLeafCode("87.16"), false)
  assert.equal(isCurrent({ data_inicio: "2022-04-01", data_fim: "2025-01-01" }, "2026-10-22"), false)
  assert.deepEqual(wordsOf("Perfil de aço U 6mm").slice(0, 2), ["perfil", "aco"])
  assert.ok(searchTerms("Barra de aço U 6mm").includes("barra"))
})
