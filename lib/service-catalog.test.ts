import assert from "node:assert/strict"
import test from "node:test"

import { serviceMargin, validateService, type CatalogService } from "./service-catalog.ts"

const service: CatalogService = {
  code: "SRV-001", name: "Revisão de freios", description: "Revisão completa do sistema de freios", category: "Manutenção", billingUnit: "Servico",
  defaultPrice: 800, estimatedCost: 300, estimatedMinutes: 120, nfseNationalCode: "140101", lc116Item: "14.01", municipalTaxCode: "", nbsCode: "1.2001.10.00",
  issRate: 3, issRetained: false, retentions: { ir: 0, pis: 0, cofins: 0, csll: 0, inss: 0 }, responsibleProviderId: "", warrantyDays: 90, status: "Ativo",
  materials: [{ materialId: "m1", quantity: 2, unit: "UN" }], tasks: [],
}

test("serviço válido e campos obrigatórios", () => {
  assert.equal(validateService(service), "")
  assert.match(validateService({ ...service, code: "" }), /código/)
  assert.match(validateService(service, ["srv-001"]), /já está em uso/)
  assert.match(validateService({ ...service, description: "" }), /descrição/)
  assert.match(validateService({ ...service, defaultPrice: 0 }), /valor padrão/)
})

test("formatos fiscais da NFS-e", () => {
  assert.match(validateService({ ...service, lc116Item: "1401" }), /LC 116/)
  assert.match(validateService({ ...service, nfseNationalCode: "1401" }), /6 dígitos/)
  assert.match(validateService({ ...service, nbsCode: "123" }), /NBS/)
  assert.match(validateService({ ...service, issRate: 6 }), /ISS/)
  assert.match(validateService({ ...service, materials: [service.materials[0], service.materials[0]] }), /repetido/)
})

test("margem do serviço", () => {
  assert.equal(serviceMargin(service), 62.5)
  assert.equal(serviceMargin({ defaultPrice: 0, estimatedCost: 10 }), null)
})
