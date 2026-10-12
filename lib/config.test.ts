import assert from "node:assert/strict"
import test from "node:test"

import { canSeeDocument, certificateStatus, defaultsFor, discountNeedsApproval, dueDateForPriority, maxDiscountPercent, normalizeSection, parseEmails, priorityDeadlines, resolveTablePrice, settingSections, stockAdjustmentNeedsApproval, validateBranch, validateCompany, validateNature, validatePriceTable, validateQuoteTemplate, validateUserAccess, type CompanyInput } from "./config.ts"

const company: CompanyInput = {
  legalName: "Carretas Indústria Ltda", tradeName: "Carretas", cnpj: "11.222.333/0001-81", stateRegistration: "123456789", municipalRegistration: "98765", taxRegime: "Simples Nacional", cnae: "2910701",
  zipCode: "01310-100", street: "Av. Paulista", number: "1000", district: "Bela Vista", city: "São Paulo", state: "SP", phone: "(11) 3333-4444", email: "contato@carretas.com.br",
  fiscalEnvironment: "Homologação", nfeSeries: "1", nfeNextNumber: 1, nfseSeries: "", nfseNextNumber: 0, certificateExpiresAt: "2027-06-30", active: true,
}

test("empresa: obrigatórios e inscrições condicionais à emissão fiscal", () => {
  assert.equal(validateCompany(company), "")
  assert.match(validateCompany({ ...company, legalName: "" }), /razão social/)
  assert.match(validateCompany({ ...company, cnpj: "11.222.333/0001-82" }), /CNPJ/)
  assert.match(validateCompany({ ...company, taxRegime: "" }), /regime/)
  assert.match(validateCompany({ ...company, zipCode: "123" }), /CEP/)
  assert.match(validateCompany({ ...company, state: "XX" }), /UF/)
  assert.match(validateCompany({ ...company, email: "sem-arroba" }), /e-mail/)
  assert.match(validateCompany({ ...company, stateRegistration: "" }), /Inscrição Estadual/)
  assert.equal(validateCompany({ ...company, stateRegistration: "", nfeSeries: "", nfeNextNumber: 0 }), "")
  assert.match(validateCompany({ ...company, nfseSeries: "A", nfseNextNumber: 1, municipalRegistration: "" }), /Inscrição Municipal/)
  assert.match(validateCompany({ ...company, nfeNextNumber: 0 }), /próximo número/)
  assert.match(validateCompany({ ...company, cnae: "123" }), /CNAE/)
})

test("certificado digital: situação pela validade", () => {
  assert.equal(certificateStatus("", "2026-10-12").label, "Sem certificado")
  assert.equal(certificateStatus("2026-10-01", "2026-10-12").label, "Vencido")
  assert.equal(certificateStatus("2026-10-20", "2026-10-12").label, "Vence em 8 dia(s)")
  assert.equal(certificateStatus("2027-06-30", "2026-10-12").tone, "good")
})

test("filial, natureza, tabela de preços, modelo e acesso do usuário", () => {
  assert.match(validateBranch({ name: "", zipCode: "", state: "", phone: "" }), /nome da filial/)
  assert.equal(validateBranch({ name: "Matriz", zipCode: "01310100", state: "SP", phone: "11999998888" }), "")
  assert.match(validateNature({ name: "Venda de carreta", kind: "Venda", defaultCfop: "9999" }), /CFOP/)
  assert.equal(validateNature({ name: "Venda de carreta", kind: "Venda", defaultCfop: "5101" }), "")
  const table = { name: "Frotistas", validFrom: "2026-10-01", validUntil: "", items: [{ materialId: "m1", price: 100 }] }
  assert.equal(validatePriceTable(table), "")
  assert.match(validatePriceTable({ ...table, validUntil: "2026-09-01" }), /vigência/)
  assert.match(validatePriceTable({ ...table, items: [] }), /ao menos um item/)
  assert.match(validatePriceTable({ ...table, items: [{ materialId: "m1", price: 1 }, { materialId: "m1", price: 2 }] }), /repetido/)
  assert.match(validatePriceTable({ ...table, items: [{ materialId: "m1", serviceTypeId: "s1", price: 1 }] }), /produto ou um serviço/)
  assert.match(validateQuoteTemplate({ name: "Padrão", validityDays: 0, warrantyDays: 0 }), /Validade/)
  assert.match(validateUserAccess({ role: "user", companyIds: [] }), /empresa/)
  assert.equal(validateUserAccess({ role: "client", companyIds: [] }), "")
  assert.match(validateUserAccess({ role: "user", companyIds: ["c1"], branchId: "b1", branchCompanyId: "c2" }), /filial/)
})

test("tabela de preços: do cliente antes da geral, só vigente e ativa", () => {
  const tables = [
    { id: "geral", clientId: "", validFrom: "2026-01-01", validUntil: "", active: true, items: [{ materialId: "m1", serviceTypeId: "", price: 100 }, { materialId: "", serviceTypeId: "s1", price: 50 }] },
    { id: "frotista", clientId: "c1", validFrom: "2026-10-01", validUntil: "2026-12-31", active: true, items: [{ materialId: "m1", serviceTypeId: "", price: 90 }] },
    { id: "inativa", clientId: "c2", validFrom: "2026-01-01", validUntil: "", active: false, items: [{ materialId: "m1", serviceTypeId: "", price: 10 }] },
  ]
  assert.deepEqual(resolveTablePrice(tables, "c1", "Produto", "m1", "2026-10-12"), { price: 90, tableId: "frotista" })
  assert.deepEqual(resolveTablePrice(tables, "c1", "Serviço", "s1", "2026-10-12"), { price: 50, tableId: "geral" })
  assert.deepEqual(resolveTablePrice(tables, "c2", "Produto", "m1", "2026-10-12"), { price: 100, tableId: "geral" })
  assert.equal(resolveTablePrice(tables, "c1", "Produto", "m1", "2027-02-01")?.tableId, "geral")
  assert.equal(resolveTablePrice(tables, "c1", "Produto", "outro", "2026-10-12"), null)
})

test("aprovação de desconto e de ajuste de estoque", () => {
  assert.equal(maxDiscountPercent([{ discountPercent: 5 }, { discountPercent: 12 }], 0, 1000), 12)
  assert.equal(maxDiscountPercent([{ discountPercent: 0 }], 200, 1000), 20)
  assert.equal(discountNeedsApproval(15, 10, "user"), true)
  assert.equal(discountNeedsApproval(15, 10, "manager"), false)
  assert.equal(discountNeedsApproval(15, 0, "user"), false)
  assert.equal(discountNeedsApproval(10, 10, "user"), false)
  const rule = { adjustmentApprovalRequired: true, adjustmentApprovalThreshold: 500 }
  assert.equal(stockAdjustmentNeedsApproval(rule, 800, "user"), true)
  assert.equal(stockAdjustmentNeedsApproval(rule, 300, "user"), false)
  assert.equal(stockAdjustmentNeedsApproval(rule, 800, "admin"), false)
  assert.equal(stockAdjustmentNeedsApproval({ ...rule, adjustmentApprovalRequired: false }, 800, "user"), false)
})

test("parâmetros: padrões, validação e normalização", () => {
  assert.equal(settingSections.length, 5)
  for (const section of settingSections) assert.equal(normalizeSection(section.key, defaultsFor(section.key)).error, "", section.key)
  assert.match(normalizeSection("finance", { ...defaultsFor("finance"), finePercent: 50 }).error, /máximo/)
  assert.match(normalizeSection("finance", { ...defaultsFor("finance"), graceDays: "x" }).error, /número/)
  assert.deepEqual(normalizeSection("os", { ...defaultsFor("os"), defaultChecklist: "Freios\n\n Pneus \nFreios" }).value.defaultChecklist, ["Freios", "Pneus"])
  assert.match(normalizeSection("os", { ...defaultsFor("os"), defaultChecklist: "  " }).error, /ao menos um item/)
  assert.match(normalizeSection("notifications", { ...defaultsFor("notifications"), digestEnabled: true }).error, /destinatário/)
  assert.match(normalizeSection("notifications", { ...defaultsFor("notifications"), digestRecipients: "a@b.com, ruim" }).error, /e-mail inválido/)
  assert.deepEqual(parseEmails("A@B.com; a@b.com\nc@d.com"), ["a@b.com", "c@d.com"])
  assert.match(normalizeSection("stock", { ...defaultsFor("stock"), costingMethod: "PEPS" }).error, /opção inválida/)
  assert.equal(normalizeSection("nada", {}).error.length > 0, true)
})

test("prazo por prioridade e visibilidade de documentos", () => {
  const days = priorityDeadlines({ deadlineBaixa: 15, deadlineMedia: 7, deadlineAlta: 3, deadlineUrgente: 1 })
  assert.equal(dueDateForPriority("2026-10-12", "Alta", days), "2026-10-15")
  assert.equal(dueDateForPriority("2026-10-12", "Inexistente", days), "")
  assert.equal(canSeeDocument({ visibility: "Todos", responsibleId: "" }, { id: "u1", role: "user" }), true)
  assert.equal(canSeeDocument({ visibility: "Administradores", responsibleId: "u1" }, { id: "u1", role: "user" }), false)
  assert.equal(canSeeDocument({ visibility: "Administradores", responsibleId: "" }, { id: "a", role: "admin" }), true)
  assert.equal(canSeeDocument({ visibility: "Responsável", responsibleId: "u1" }, { id: "u1", role: "user" }), true)
  assert.equal(canSeeDocument({ visibility: "Responsável", responsibleId: "u2" }, { id: "u1", role: "user" }), false)
})
