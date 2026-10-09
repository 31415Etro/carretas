// Cadastro de serviços do catálogo (tabela service_types) com dados da NFS-e.

export const billingUnits = [
  { value: "Servico", label: "Por serviço" },
  { value: "Hora", label: "Por hora" },
  { value: "Unidade", label: "Por unidade" },
  { value: "Diaria", label: "Por diária" },
  { value: "Km", label: "Por km" },
]

export type ServiceRetentions = { ir: number; pis: number; cofins: number; csll: number; inss: number }

export type CatalogService = {
  id?: string
  code: string
  name: string
  description: string
  category: string
  billingUnit: string
  defaultPrice: number
  estimatedCost: number
  estimatedMinutes: number
  nfseNationalCode: string
  lc116Item: string
  municipalTaxCode: string
  nbsCode: string
  issRate: number
  issRetained: boolean
  retentions: ServiceRetentions
  responsibleProviderId: string
  warrantyDays: number
  status: "Ativo" | "Inativo"
  materials: Array<{ materialId: string; quantity: number; unit: string }>
  tasks: string[]
}

/** Mensagem de erro ou "" quando o serviço pode ser salvo. `codes` = códigos já usados por outros serviços. */
export function validateService(service: CatalogService, codes: string[] = []) {
  if (!service.code.trim()) return "Informe o código interno do serviço."
  if (codes.some((code) => code.trim().toLowerCase() === service.code.trim().toLowerCase())) return `O código ${service.code} já está em uso.`
  if (!service.name.trim()) return "Informe o nome do serviço."
  if (!service.description.trim()) return "Informe a descrição do serviço."
  if (!service.category.trim()) return "Informe a categoria."
  if (!billingUnits.some((unit) => unit.value === service.billingUnit)) return "Escolha a unidade de cobrança."
  if (!(Number(service.defaultPrice) > 0)) return "Informe o valor padrão."
  if (Number(service.estimatedCost) < 0 || Number(service.estimatedMinutes) < 0 || Number(service.warrantyDays) < 0) return "Custo, tempo e garantia não podem ser negativos."
  if (service.lc116Item && !/^\d{1,2}\.\d{2}$/.test(service.lc116Item.trim())) return "Item da LC 116 no formato 14.01."
  if (service.nfseNationalCode && !/^\d{6}$/.test(service.nfseNationalCode.replace(/\D/g, ""))) return "Código de tributação nacional da NFS-e tem 6 dígitos."
  if (service.nbsCode && !/^\d{9}$/.test(service.nbsCode.replace(/\D/g, ""))) return "NBS tem 9 dígitos (ex.: 1.1403.10.00)."
  if (Number(service.issRate) < 0 || Number(service.issRate) > 5) return "Alíquota de ISS deve ficar entre 0% e 5%."
  if (Object.values(service.retentions || {}).some((rate) => Number(rate) < 0 || Number(rate) > 30)) return "Alíquotas de retenção devem ficar entre 0% e 30%."
  if (service.materials.some((item) => !item.materialId || !(Number(item.quantity) > 0))) return "Materiais necessários precisam de item e quantidade."
  if (new Set(service.materials.map((item) => item.materialId)).size !== service.materials.length) return "Material repetido na lista de materiais necessários."
  return ""
}

/** Margem estimada do serviço sobre o valor padrão. */
export function serviceMargin(service: Pick<CatalogService, "defaultPrice" | "estimatedCost">) {
  const price = Number(service.defaultPrice || 0)
  return price > 0 ? Math.round(((price - Number(service.estimatedCost || 0)) / price) * 1000) / 10 : null
}
