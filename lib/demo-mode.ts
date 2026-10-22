// Modo de demonstração (SOMENTE desenvolvimento local): com DEMO_MODE=1 o sistema abre sem login e sem
// Supabase, só para ver o visual das telas. As APIs devolvem listas vazias. Nunca defina em produção.

import { defaultSystemCompany } from "@/lib/system-company"
import { formFromMaterial } from "@/lib/raw-materials"
import { systemPagePermissions } from "@/lib/types"
import { defaultsFor, settingSections } from "@/lib/config"

export const isDemoMode = () => process.env.DEMO_MODE === "1" && process.env.NODE_ENV !== "production"

export const demoSession = () => ({
  user: { id: "demo", name: "Demonstração", email: "demo@local", role: "admin", permissions: systemPagePermissions, clientId: null, company: defaultSystemCompany },
  companies: [defaultSystemCompany],
})

const emptyLists = ["items", "clients", "suppliers", "products", "services", "parties", "opportunities", "salespeople", "quotes", "contracts", "alerts", "saved", "runs", "events", "orders", "users", "providers", "warehouses", "materials", "vehicles", "movements", "technicians", "assets", "templates", "priceTables", "paymentConditions", "categories", "costCenters", "failedEvents", "history", "integrations", "modules", "logs", "companies", "interactions", "accounts", "conditions"]

/** Matérias-primas FICTÍCIAS só para visualizar as telas no modo de demonstração (nunca existem em produção). */
const demoRawMaterials = [
  { id: "11111111-1111-4111-8111-111111111111", sku: "MP-000001", name: "Perfil de aço U 6 m (DEMO)", category: "Perfis e barras", subcategory: "Perfil U", unit: "M", status: "Ativo", ncm: "73011000", photo_url: null, unit_cost: 12.4, last_purchase_cost: 12.9, minimum_stock: 100, reorder_point: 150, maximum_stock: 600, physical: 80, reserved: 30, available: 50, incoming: 120, below_minimum: true, needs_reorder: true, primary_supplier: "Aços Exemplo Ltda (DEMO)", kits_count: 2, allows_sale: false },
  { id: "22222222-2222-4222-8222-222222222222", sku: "MP-000002", name: "Parafuso sextavado M10 (DEMO)", category: "Fixação", subcategory: "", unit: "UN", status: "Ativo", ncm: "73181500", photo_url: null, unit_cost: 0.85, last_purchase_cost: 0.8, minimum_stock: 500, reorder_point: 800, maximum_stock: 5000, physical: 2400, reserved: 480, available: 1920, incoming: 0, below_minimum: false, needs_reorder: false, primary_supplier: "Fixadores Demo S.A.", kits_count: 3, allows_sale: false },
  { id: "33333333-3333-4333-8333-333333333333", sku: "MP-000003", name: "Chapa de aço 3 mm (DEMO)", category: "Chapas", subcategory: "", unit: "UN", status: "Ativo", ncm: "", photo_url: null, unit_cost: 310, last_purchase_cost: 305, minimum_stock: 0, reorder_point: 0, maximum_stock: 0, physical: 0, reserved: 0, available: 0, incoming: 0, below_minimum: false, needs_reorder: false, primary_supplier: null, kits_count: 0, allows_sale: false },
]
const demoRawMaterialDetail = (id: string) => {
  const row = demoRawMaterials.find((item) => item.id === id) || demoRawMaterials[0]
  const material = { id: row.id, name: row.name, internal_code: row.sku, item_type: "Materia-prima", category: row.category, subcategory: row.subcategory, unit: row.unit, status: row.status, description: "Perfil laminado a quente, norma NBR 6650 (texto de demonstração).", material_kind: "Aço", length: 6000, width: 100, height: 50, thickness: 6, diameter: 0, net_weight: 45.2, gross_weight: 46, technical_attributes: { Norma: "NBR 6650", Acabamento: "Laminado a quente" }, minimum_stock: row.minimum_stock, reorder_point: row.reorder_point, maximum_stock: row.maximum_stock, lead_time_days: 7, min_purchase_qty: 60, average_cost: row.unit_cost, last_purchase_cost: row.last_purchase_cost, unit_cost: row.unit_cost, ncm: row.ncm, ncm_description: "Perfis de ferro ou aço (demonstração)", ncm_source: "Tabela NCM oficial (Siscomex/Camex) via BrasilAPI", ncm_confirmed_by: "Demonstração", ncm_confirmed_at: "2026-10-20T12:00:00Z", allows_sale: false, sale_price: 0, photo_url: null, technical_sheet_url: null, notes: "", warehouse_id: "d1", controls_lot: false, controls_serial: false, controls_expiry: false, cost_price: 12 }
  const suppliers = [{ id: "s1", supplier_id: "sup1", supplier_name: "Aços Exemplo Ltda (DEMO)", supplier_document: "00.000.000/0001-00", supplier_code: "AX-77", is_primary: true, last_cost: 12.9, lead_time_days: 7, min_purchase_qty: 60, notes: "" }, { id: "s2", supplier_id: "sup2", supplier_name: "Metais Alternativos (DEMO)", supplier_document: "", supplier_code: "", is_primary: false, last_cost: 13.5, lead_time_days: 12, min_purchase_qty: null, notes: "" }]
  return {
    hasHistory: true,
    form: null,
    detail: {
      material, availability: { physical: row.physical, reserved: row.reserved, available: row.available, incoming: row.incoming, projected: row.available + row.incoming }, suppliers,
      stock_by_warehouse: [{ warehouse_id: "d1", warehouse: "Depósito principal", code: "DEP-01", quantity: row.physical }],
      purchases: [{ purchase_order_id: "po1", order_number: "PC-2026-0007", order_date: "2026-10-02", status: "Aprovado", supplier_name: "Aços Exemplo Ltda (DEMO)", quantity: 200, received_quantity: 80, unit_cost: 12.9, total: 2580 }],
      movements: [{ id: "m1", movement_type: "Entrada por compra", quantity: 80, unit_cost: 12.9, total_cost: 1032, occurred_at: "2026-10-15T14:00:00Z", document_reference: "PC-2026-0007", responsible: "Demonstração", reason: "", from_warehouse: null, to_warehouse: "Depósito principal", balance_after: 80 }],
      kits: [{ kit_id: "k1", kit_sku: "KIT-000001", kit_name: "Kit Chassi FZ 1E (DEMO)", version_id: "kv1", version: 2, version_status: "Ativa", quantity: 6, unit: "M", loss_percent: 5, products: [{ product_id: "p1", product_sku: "PRD-000001", product_name: "Carreta FZ 1E (DEMO)" }] }],
      production: [{ production_order_id: "op1", code: "OP-2026-00001", status: "Aguardando materiais", product_name: "Carreta FZ 1E (DEMO)", required: 18, reserved: 18, consumed: 0, created_at: "2026-10-18T10:00:00Z" }],
      ncm: { code: row.ncm, description: material.ncm_description, source: material.ncm_source, confirmed_by: "Demonstração", confirmed_at: material.ncm_confirmed_at, valid_from: "2022-04-01" },
      sku_history: [],
    },
  }
}

/** Kits FICTÍCIOS só para visualizar as telas no modo de demonstração. */
const demoKits = [
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", sku: "KIT-000001", name: "Kit Chassi FZ 1E (DEMO)", category: "Chassi", status: "Ativo", photo_url: null, updated_at: "2026-10-20T12:00:00Z", version_id: "v2", version: 2, version_status: "Ativa", components_count: 3, cost: 215.4, products_count: 2, last_change: "2026-10-21T15:30:00Z", total_count: 3 },
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", sku: "KIT-000002", name: "Kit Elétrica (DEMO)", category: "Elétrica", status: "Ativo", photo_url: null, updated_at: "2026-10-19T12:00:00Z", version_id: "v1", version: 1, version_status: "Ativa", components_count: 5, cost: 88.9, products_count: 1, last_change: "2026-10-19T12:00:00Z", total_count: 3 },
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", sku: "CARFZ1CAR", name: "FZ1E (DEMO, cadastro antigo)", category: null, status: "Ativo", photo_url: null, updated_at: "2026-10-18T12:00:00Z", version_id: null, version: null, version_status: null, components_count: 0, cost: 0, products_count: 0, last_change: "2026-10-18T12:00:00Z", total_count: 3 },
]
const demoKitComponents = (version: number) => [
  { id: "c1", component_id: "11111111-1111-4111-8111-111111111111", sku: "MP-000001", name: "Perfil de aço U 6 m (DEMO)", category: "Perfis", item_type: "Materia-prima", status: "Ativo", position: 0, quantity: version === 1 ? 4 : 6, unit: "M", loss_percent: 5, notes: null, material_unit: "M", quantity_in_material_unit: version === 1 ? 4 : 6, required_with_loss: version === 1 ? 4.2 : 6.3, unit_cost: 12.4, line_cost: version === 1 ? 52.08 : 78.12, available: 50, units: [{ unit: "BARRA", factor: 6 }, { unit: "CM", factor: 0.01 }, { unit: "M", factor: 1 }, { unit: "MM", factor: 0.001 }] },
  { id: "c2", component_id: "22222222-2222-4222-8222-222222222222", sku: "MP-000002", name: "Parafuso sextavado M10 (DEMO)", category: "Fixação", item_type: "Materia-prima", status: "Ativo", position: 1, quantity: 16, unit: "UN", loss_percent: 0, notes: null, material_unit: "UN", quantity_in_material_unit: 16, required_with_loss: 16, unit_cost: 0.85, line_cost: 13.6, available: 1920, units: [{ unit: "UN", factor: 1 }] },
  ...(version === 2 ? [{ id: "c3", component_id: "33333333-3333-4333-8333-333333333333", sku: "MP-000003", name: "Chapa de aço 3 mm (DEMO)", category: "Chapas", item_type: "Materia-prima", status: "Ativo", position: 2, quantity: 0.5, unit: "UN", loss_percent: 0, notes: null, material_unit: "UN", quantity_in_material_unit: 0.5, required_with_loss: 0.5, unit_cost: 310, line_cost: 155, available: 0, units: [{ unit: "UN", factor: 1 }] }] : []),
]
const demoKitDetail = (id: string, versionId: string | null) => {
  const shown = versionId === "v1" ? 1 : 2
  const kit = demoKits.find((item) => item.id === id) || demoKits[0]
  const components = demoKitComponents(shown)
  return {
    detail: {
      kit: { id: kit.id, name: kit.name, internal_code: kit.sku, category: kit.category, status: kit.status, description: "Estrutura do chassi: perfis, chapa e fixação (texto de demonstração).", photo_url: null, updated_at: kit.updated_at, item_type: "Kit" },
      current_version_id: "v2", shown_version_id: shown === 1 ? "v1" : "v2",
      versions: [
        { id: "v3", version: 3, status: "Rascunho", composition_kind: "fabricacao", notes: "troca do perfil por modelo mais leve", created_by: "ana@demo.com", created_at: "2026-10-22T09:00:00Z", activated_at: null, components_count: 3, cost: 190.2, used_in_production: false, used_by_products: 0 },
        { id: "v2", version: 2, status: "Ativa", composition_kind: "fabricacao", notes: "inclui chapa", created_by: "ana@demo.com", created_at: "2026-10-15T09:00:00Z", activated_at: "2026-10-15T10:00:00Z", components_count: 3, cost: 215.4, used_in_production: true, used_by_products: 2 },
        { id: "v1", version: 1, status: "Obsoleta", composition_kind: "fabricacao", notes: "original", created_by: "joao@demo.com", created_at: "2026-09-30T09:00:00Z", activated_at: "2026-09-30T10:00:00Z", components_count: 2, cost: 65.68, used_in_production: true, used_by_products: 0 },
      ],
      components, cost: components.reduce((sum, item) => sum + item.line_cost, 0),
      products: [
        { product_id: "p1", sku: "PRD-000001", name: "Carreta FZ 1E (DEMO)", status: "Ativo", bom_version_id: "b1", bom_version: 1, bom_status: "Ativa", quantity: 1, pinned_kit_version: null, follows_active: true },
        { product_id: "p2", sku: "PRD-000002", name: "Carreta FZ 2E (DEMO)", status: "Ativo", bom_version_id: "b2", bom_version: 3, bom_status: "Ativa", quantity: 2, pinned_kit_version: 2, follows_active: false },
      ],
      cost_history: [{ id: "h1", total_cost: 215.4, computed_at: "2026-10-21T15:30:00Z", version: 2 }, { id: "h2", total_cost: 209.9, computed_at: "2026-10-15T10:00:00Z", version: 2 }, { id: "h3", total_cost: 65.68, computed_at: "2026-09-30T10:00:00Z", version: 1 }],
      change_log: [
        { id: "l1", action: "versao_criada", description: "Versão 3 criada em rascunho.", detail: null, changed_by: "ana@demo.com", changed_at: "2026-10-22T09:00:00Z", version: 3 },
        { id: "l2", action: "componente_alterado", description: "v2: Perfil de aço U 6 m (DEMO) passou de 4 M para 6 M.", detail: null, changed_by: "ana@demo.com", changed_at: "2026-10-15T09:30:00Z", version: 2 },
        { id: "l3", action: "versao_ativada", description: "Versão 2 ativada (passou a ser a vigente).", detail: null, changed_by: "ana@demo.com", changed_at: "2026-10-15T10:00:00Z", version: 2 },
      ],
      used_in_production: true,
    },
  }
}

/** Resposta genérica das APIs no modo de demonstração. */
export function demoApiPayload(pathname: string) {
  if (pathname === "/api/kits") return { items: demoKits, total: demoKits.length, page: 1, pageSize: 25 }
  if (pathname === "/api/kits/materiais") return { items: demoRawMaterials.map((item) => ({ id: item.id, sku: item.sku, name: item.name, category: item.category, unit: item.unit, unit_cost: item.unit_cost, available: item.available, units: [{ unit: item.unit, factor: 1 }] })) }
  const kitMatch = pathname.match(/^\/api\/kits\/([0-9a-f-]{36})$/)
  if (kitMatch) return demoKitDetail(kitMatch[1], null)
  const rawMaterialMatch = pathname.match(/^\/api\/materias-primas\/([0-9a-f-]{36})$/)
  if (rawMaterialMatch) { const payload = demoRawMaterialDetail(rawMaterialMatch[1]); return { ...payload, form: formFromMaterial(payload.detail.material, payload.detail.suppliers) } }
  if (pathname === "/api/materias-primas") return { items: demoRawMaterials }
  if (pathname.startsWith("/api/estoque/warehouses")) return { warehouses: [{ id: "d1", name: "Depósito principal (demonstração)", isDefault: true }] }
  if (pathname.startsWith("/api/suppliers")) return { suppliers: [{ id: "sup1", name: "Aços Exemplo Ltda (DEMO)", document: "00.000.000/0001-00", status: "Ativo" }, { id: "sup2", name: "Metais Alternativos (DEMO)", document: "", status: "Ativo" }] }
  if (pathname.startsWith("/api/catalog/ncm")) return { source: "Tabela NCM oficial (Siscomex/Camex) via BrasilAPI", needsManualReview: false, message: "Confira a descrição oficial e confirme o NCM. A sugestão nunca é gravada sem a sua confirmação.", candidates: [
    { code: "73011000", codeFormatted: "7301.10.00", description: "Estacas-pranchas (demonstração)", validFrom: "2022-04-01", source: "Tabela NCM oficial (Siscomex/Camex) via BrasilAPI · Res Camex 000272/2021", confidence: "alta", matchedWords: ["perfil", "aco"], justification: "Coincide em: perfil, aco (2 de 2 palavras informadas). Confira a descrição oficial antes de confirmar." },
    { code: "72162100", codeFormatted: "7216.21.00", description: "Cantoneiras de ferro ou aço (demonstração)", validFrom: "2022-04-01", source: "Tabela NCM oficial (Siscomex/Camex) via BrasilAPI · Res Camex 000272/2021", confidence: "baixa", matchedWords: ["aco"], justification: "Coincide em: aco (1 de 2 palavras informadas). Confira a descrição oficial antes de confirmar." }] }
  const base: Record<string, unknown> = Object.fromEntries(emptyLists.map((key) => [key, []]))
  base.company = { id: "demo", name: "Carretas (demonstração)", legalName: "", cnpj: "", email: "", phone: "", address: "", hasLogo: false }
  base.paymentMethods = ["PIX", "Boleto", "Transferência", "Cartão"]
  base.settings = {}
  if (pathname.startsWith("/api/configuracoes/parametros")) return { settings: Object.fromEntries(settingSections.map((section) => [section.key, defaultsFor(section.key)])) }
  if (pathname.startsWith("/api/relatorios/meta")) return { user: { id: "demo", name: "Demonstração", isAdmin: true }, modules: ["financeiro", "estoque", "produtos", "os", "frota", "comercial", "orcamentos", "contratos"], users: [], emailConfigured: false }
  if (pathname.startsWith("/api/orcamentos/options")) return { ...base, company: { id: "demo", name: "Carretas", legalName: "", cnpj: "", email: "", phone: "", address: "", hasLogo: false }, settings: { defaultValidityDays: 15, discountApprovalPercent: 10 }, emailConfigured: false, canConfigure: true }
  if (pathname.startsWith("/api/os/options")) return { ...base, settings: { defaultChecklist: defaultsFor("os").defaultChecklist, priorityDays: { Baixa: 15, Media: 7, Alta: 3, Urgente: 1 } } }
  if (pathname.startsWith("/api/cadastros/verificar")) return { client: null, supplier: null }
  if (pathname.startsWith("/api/cadastros/cnpj/")) return { company: { document: "19.131.243/0001-97", legalName: "EMPRESA DEMONSTRACAO LTDA", tradeName: "DEMO CARRETAS", phone: "4930000000", email: "contato@demo.com.br", zipCode: "89800-000", street: "RUA EXEMPLO", number: "100", complement: "", district: "CENTRO", city: "CHAPECO", state: "SC", address: "", registrationStatus: "ATIVA", openedAt: "2015-03-10", primaryActivity: "Fabricação de carrocerias e reboques", legalNature: "Sociedade Empresária Limitada", size: "DEMAIS", statusDate: "2015-03-10", branchType: "Matriz", cnaeCode: "2930101", secondaryActivities: ["4530703 - Comércio de peças e acessórios"], partners: [{ name: "SOCIO DEMONSTRACAO", role: "Sócio-Administrador" }] }, partners: [{ name: "SOCIO DEMONSTRACAO", role: "Sócio-Administrador" }], source: "Demonstração", consultedAt: new Date().toISOString() }
  if (pathname.startsWith("/api/cadastros/opcoes")) return { salespeople: [], paymentConditions: [], priceTables: [] }
  if (pathname.startsWith("/api/dashboard/erp/preferences")) return { config: null }
  if (pathname.startsWith("/api/dashboard/erp")) { const today = new Date().toISOString().slice(0, 10); return { period: { start: today, end: today, today }, allowedSections: ["financeiro", "estoque", "os", "frota", "comercial"], sections: {}, options: { costCenters: [], providers: [] }, warnings: ["modo demonstração, sem banco de dados."], generatedAt: new Date().toISOString() } }
  if (pathname.startsWith("/api/auditoria/summary")) return { last24h: 0, denied24h: 0, failed24h: 0 }
  if (pathname.startsWith("/api/auditoria/settings")) return { retentionDays: 1825, companyId: "demo" }
  if (pathname.startsWith("/api/auditoria")) return { events: [], nextBefore: "" }
  if (pathname.startsWith("/api/configuracoes/integracoes")) return { ...base, secretsConfigured: false }
  return { ...base, demo: true }
}
