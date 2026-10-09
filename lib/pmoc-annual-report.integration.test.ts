import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("../components/operations/mvp-pages.tsx", import.meta.url), "utf8")

test("a aba PMOC expõe o relatório completo por cliente e período retroativo", () => {
  for (const expected of [
    'TabsTrigger value="relatorio-anual"',
    "Competência de referência",
    "Período do relatório",
    "Somente a competência atual",
    "reportMonthsBack",
    "referenceMonth: reportReferenceMonth",
    "buildPmocAnnualReport",
    "renderPmocAnnualReportHtml",
    "PMOC_LEGAL_REFERENCE",
    "Gerar relatório anual / PDF",
  ]) assert.match(source, new RegExp(expected))

  assert.doesNotMatch(source, /const annualReport = useMemo\(\(\) => buildPmocAnnualReport/)
  assert.match(source, /function generateAnnualReport\(\)[\s\S]*buildPmocAnnualReport/)
})
