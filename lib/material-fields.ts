import type { Material } from "@/lib/operational-storage"

// Origem da mercadoria (Tabela A do CST ICMS)
export const materialOriginOptions = [
  { value: "0", label: "0 - Nacional" },
  { value: "1", label: "1 - Estrangeira (importação direta)" },
  { value: "2", label: "2 - Estrangeira (adquirida no mercado interno)" },
  { value: "3", label: "3 - Nacional, conteúdo de importação > 40% e <= 70%" },
  { value: "4", label: "4 - Nacional, produção conforme processos produtivos básicos" },
  { value: "5", label: "5 - Nacional, conteúdo de importação <= 40%" },
  { value: "6", label: "6 - Estrangeira (importação direta), sem similar nacional" },
  { value: "7", label: "7 - Estrangeira (mercado interno), sem similar nacional" },
  { value: "8", label: "8 - Nacional, conteúdo de importação > 70%" },
]

// Tipo do item (registro 0200 do SPED Fiscal)
export const materialSpedItemTypeOptions = [
  { value: "00", label: "00 - Mercadoria para revenda" },
  { value: "01", label: "01 - Matéria-prima" },
  { value: "02", label: "02 - Embalagem" },
  { value: "03", label: "03 - Produto em processo" },
  { value: "04", label: "04 - Produto acabado" },
  { value: "05", label: "05 - Subproduto" },
  { value: "06", label: "06 - Produto intermediário" },
  { value: "07", label: "07 - Material de uso e consumo" },
  { value: "08", label: "08 - Ativo imobilizado" },
  { value: "09", label: "09 - Serviços" },
  { value: "10", label: "10 - Outros insumos" },
  { value: "99", label: "99 - Outras" },
]

const textFields = ["barcode", "ncm", "cest", "origin", "spedItemType", "location", "supplierCode"] as const
const numberFields = ["maximumStock", "grossWeight", "netWeight", "height", "width", "length", "costPrice", "salePrice"] as const

const columnByField: Record<(typeof textFields)[number] | (typeof numberFields)[number] | "supplierId", string> = {
  barcode: "barcode",
  ncm: "ncm",
  cest: "cest",
  origin: "origin",
  spedItemType: "sped_item_type",
  location: "location",
  supplierCode: "supplier_code",
  supplierId: "supplier_id",
  maximumStock: "maximum_stock",
  grossWeight: "gross_weight",
  netWeight: "net_weight",
  height: "height",
  width: "width",
  length: "length",
  costPrice: "cost_price",
  salePrice: "sale_price",
}

/** Campos de cadastro ERP (fiscal, logística, preços) no formato da tabela `materials`. */
export function materialErpColumns(input: Record<string, any>) {
  const row: Record<string, string | number | null> = {}
  for (const field of textFields) row[columnByField[field]] = String(input[field] ?? input[columnByField[field]] ?? "").trim()
  for (const field of numberFields) row[columnByField[field]] = Number(input[field] ?? input[columnByField[field]] ?? 0) || 0
  const supplierId = String(input.supplierId || input.supplier_id || "")
  row.supplier_id = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(supplierId) ? supplierId : null
  return row
}

/** Inverso de `materialErpColumns`: linha da tabela -> campos do `Material`. */
export function materialErpFields(row: Record<string, any>): Partial<Material> {
  const fields: Record<string, string | number> = {}
  for (const field of textFields) fields[field] = row[columnByField[field]] || ""
  for (const field of numberFields) fields[field] = Number(row[columnByField[field]] || 0)
  fields.supplierId = row.supplier_id || ""
  return fields as Partial<Material>
}
