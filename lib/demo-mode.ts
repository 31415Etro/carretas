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

/** Produtos finais FICTÍCIOS só para visualizar as telas no modo de demonstração. */
const demoProductId = "44444444-4444-4444-8444-444444444444"
const demoProducts = [
  { id: demoProductId, sku: "PRD-000001", name: "Carreta Náutica FZ 1E (DEMO)", model: "FZ 1E", category: "Carreta", product_line: "Linha Náutica", status: "Ativo", sale_price: 9800, photo_url: null, updated_at: "2026-10-18T12:00:00Z", bom_version_id: "pv2", bom_version: 2, bom_status: "Ativa", kits_count: 2, est_cost: 6420.5, margin: 3379.5, margin_percent: 34.49, physical: 2, reserved: 1, available: 1, in_production: 3, make_to_order: false, available_for_quote: true, total_count: 2 },
  { id: "55555555-5555-4555-8555-555555555555", sku: "PRD-000002", name: "Reboque Utilitário RU 300 (DEMO)", model: "RU 300", category: "Carreta", product_line: "Linha Utilitária", status: "Ativo", sale_price: 6200, photo_url: null, updated_at: "2026-10-10T12:00:00Z", bom_version_id: null, bom_version: null, bom_status: null, kits_count: 0, est_cost: 0, margin: 6200, margin_percent: 100, physical: 0, reserved: 0, available: 0, in_production: 0, make_to_order: true, available_for_quote: true, total_count: 2 },
]
const demoProductDetail = () => ({
  detail: {
    product: { id: demoProductId, name: "Carreta Náutica FZ 1E (DEMO)", internal_code: "PRD-000001", item_type: "Produto", status: "Ativo", category: "Carreta", product_line: "Linha Náutica", product_model: "FZ 1E", description: "Carreta para jet ski (texto de demonstração).", unit: "UN", sale_price: 9800, lead_time_days: 30, warranty_months: 12, available_for_quote: true, allows_sale: true, make_to_order: false, length: 450, width: 180, height: 120, net_weight: 320, gross_weight: 900, payload_capacity: 580, axle_count: 1, finish_type: "Galvanizado a fogo", structural_notes: "Chassi em perfil U", engineering_notes: "Eixo único com freio", ncm: "87163900", ncm_confirmed_by: "Demonstração", updated_at: "2026-10-18T12:00:00Z" },
    availability: { physical: 2, reserved: 1, available: 1, incoming: 0 },
    in_production: { open_orders: 1, quantity: 3, expected_end: "2026-11-10" },
    stock_by_warehouse: [{ warehouse_id: "d1", warehouse: "Depósito principal (demonstração)", code: "DEP-01", quantity: 2 }],
    movements: [{ id: "m1", movement_type: "Entrada por producao", quantity: 2, unit_cost: 6380, total_cost: 12760, occurred_at: "2026-10-12T15:00:00Z", document_reference: "OP-0001", from_warehouse: null, to_warehouse: "Depósito principal (demonstração)" }],
    orders: [{ production_order_id: "o1", code: "OP-0002", status: "Em producao", quantity: 3, produced_quantity: 0, planned_end: "2026-11-10", bom_version: 2, sales_order: "PV-0003", created_at: "2026-10-20T10:00:00Z" }],
    documents: [], current_version_id: "pv2", shown_version_id: "pv2",
    versions: [
      { id: "pv2", version: 2, status: "Ativa", labor_cost: 900, labor_minutes: 960, overhead_cost: 150, other_cost: 0, estimated_production_days: 12, notes: "", change_reason: "Troca do kit de rodagem", created_by: "ana@demo.com", created_at: "2026-10-15T09:00:00Z", activated_at: "2026-10-15T10:00:00Z", activated_by: "ana@demo.com", kits_count: 2, total_cost: 6420.5, used_in_production: true, used_in_quotes: false },
      { id: "pv1", version: 1, status: "Obsoleta", labor_cost: 850, labor_minutes: 900, overhead_cost: 150, other_cost: 0, estimated_production_days: 12, notes: "", change_reason: "Estrutura inicial", created_by: "ana@demo.com", created_at: "2026-10-01T09:00:00Z", activated_at: "2026-10-01T10:00:00Z", activated_by: "ana@demo.com", kits_count: 2, total_cost: 6310.5, used_in_production: true, used_in_quotes: true },
    ],
    kits: [
      { id: "pk1", kit_id: "k1", sku: "KIT-000001", name: "Kit Chassi FZ 1E (DEMO)", kit_status: "Ativo", category: "Chassi", quantity: 1, pinned_version_id: null, follows_active: true, kit_version_id: "kv2", kit_version: 2, kit_version_status: "Ativa", kit_cost: 4120.5, line_cost: 4120.5, components_count: 6 },
      { id: "pk2", kit_id: "k2", sku: "KIT-000002", name: "Kit Elétrica (DEMO)", kit_status: "Ativo", category: "Elétrica", quantity: 1, pinned_version_id: "kv9", follows_active: false, kit_version_id: "kv9", kit_version: 1, kit_version_status: "Ativa", kit_cost: 1250, line_cost: 1250, components_count: 4 },
    ],
    cost: { materials: 5370.5, labor: 900, overhead: 150, other: 0, total: 6420.5, price: 9800, margin: 3379.5, margin_percent: 34.49 },
    cost_of_version: { total: 6400, materials: 5350, computed_at: "2026-10-15T10:00:00Z" },
    cost_history: [{ total_cost: 6420.5, materials_cost: 5370.5, computed_at: "2026-10-20T10:00:00Z", version: 2 }, { total_cost: 6400, materials_cost: 5350, computed_at: "2026-10-15T10:00:00Z", version: 2 }],
    real_cost: { quantity: 2, unit_cost: 6380, total_cost: 12760, lots: 1 },
    change_log: [{ id: "c1", action: "versao_ativada", description: "Estrutura v2 ativada.", detail: null, changed_by: "ana@demo.com", changed_at: "2026-10-15T10:00:00Z", version: 2 }, { id: "c2", action: "preco_alterado", description: "Preço de R$ 9.500,00 para R$ 9.800,00.", detail: null, changed_by: "ana@demo.com", changed_at: "2026-10-18T12:00:00Z", version: null }],
    sku_history: [], used_in_production: true,
  },
})
const demoExplosion = (quantity: number) => ({ explosion: { product_id: demoProductId, quantity, materials_cost: 5370.5 * quantity, kits: [
  { kit_id: "k1", sku: "KIT-000001", name: "Kit Chassi FZ 1E (DEMO)", kit_version: 2, quantity, cost: 4120.5 * quantity, components: [{ material_id: "11111111-1111-4111-8111-111111111111", sku: "MP-000001", name: "Perfil de aço U 6 m (DEMO)", unit: "M", required: 6.3 * quantity, cost: 78.12 * quantity }, { material_id: "22222222-2222-4222-8222-222222222222", sku: "MP-000002", name: "Parafuso sextavado M10 (DEMO)", unit: "UN", required: 16 * quantity, cost: 13.6 * quantity }] },
  { kit_id: "k2", sku: "KIT-000002", name: "Kit Elétrica (DEMO)", kit_version: 1, quantity, cost: 1250 * quantity, components: [{ material_id: "22222222-2222-4222-8222-222222222222", sku: "MP-000002", name: "Parafuso sextavado M10 (DEMO)", unit: "UN", required: 4 * quantity, cost: 3.4 * quantity }] },
], consolidated: [
  { material_id: "11111111-1111-4111-8111-111111111111", sku: "MP-000001", name: "Perfil de aço U 6 m (DEMO)", unit: "M", required: 6.3 * quantity, unit_cost: 12.4, cost: 78.12 * quantity, available: 50, incoming: 120, shortage: Math.max(6.3 * quantity - 50, 0), origins: [{ kit_id: "k1", kit_name: "Kit Chassi FZ 1E (DEMO)", required: 6.3 * quantity }] },
  { material_id: "22222222-2222-4222-8222-222222222222", sku: "MP-000002", name: "Parafuso sextavado M10 (DEMO)", unit: "UN", required: 20 * quantity, unit_cost: 0.85, cost: 17 * quantity, available: 1920, incoming: 0, shortage: 0, origins: [{ kit_id: "k1", kit_name: "Kit Chassi FZ 1E (DEMO)", required: 16 * quantity }, { kit_id: "k2", kit_name: "Kit Elétrica (DEMO)", required: 4 * quantity }] },
] }, version_id: "pv2" })
const demoCapacity = { capacity: { immediate_capacity: 7, projected_capacity: 19, company_name: "Carretas (demonstração)", computed_at: "2026-10-22T12:00:00Z", note: "Considera só o saldo físico livre da empresa (descontadas as reservas). Pedidos de compra não recebidos entram apenas na capacidade projetada.", warehouses: [{ id: "d1", code: "DEP-01", name: "Depósito principal (demonstração)" }], materials: [
  { material_id: "11111111-1111-4111-8111-111111111111", sku: "MP-000001", name: "Perfil de aço U 6 m (DEMO)", unit: "M", required_per_unit: 6.3, physical: 80, reserved: 30, available: 50, incoming: 120, immediate_units: 7, projected_units: 26, limits_immediate: true, limits_projected: false },
  { material_id: "22222222-2222-4222-8222-222222222222", sku: "MP-000002", name: "Parafuso sextavado M10 (DEMO)", unit: "UN", required_per_unit: 20, physical: 2400, reserved: 480, available: 1920, incoming: 0, immediate_units: 96, projected_units: 19, limits_immediate: false, limits_projected: true },
] } }

/** Pedidos, ordens e MRP FICTÍCIOS só para visualizar as telas no modo de demonstração. */
const demoSaleId = "66666666-6666-4666-8666-666666666666"
const demoOrderId = "77777777-7777-4777-8777-777777777777"
const demoSales = [
  { id: demoSaleId, order_number: "PV-2026-00001", status: "Parcialmente disponivel", client_id: "c1", client_name: "Náutica Exemplo Ltda (DEMO)", order_date: "2026-10-18", delivery_date: "2026-11-20", total_amount: 49000, quote_number: "ORC-000012", items_count: 1, units_ordered: 5, units_ready: 3, units_delivered: 0, units_in_production: 2, payment_confirmed: true, created_at: "2026-10-18T12:00:00Z", total_count: 2 },
  { id: "88888888-8888-4888-8888-888888888888", order_number: "PV-2026-00002", status: "Aguardando confirmacao", client_id: "c2", client_name: "Marina Demo S.A.", order_date: "2026-10-21", delivery_date: "2026-12-05", total_amount: 19600, quote_number: "ORC-000015", items_count: 1, units_ordered: 2, units_ready: 0, units_delivered: 0, units_in_production: 0, payment_confirmed: false, created_at: "2026-10-21T12:00:00Z", total_count: 2 },
]
const demoSaleDetail = () => ({ detail: {
  order: { id: demoSaleId, order_number: "PV-2026-00001", status: "Parcialmente disponivel", client_name: "Náutica Exemplo Ltda (DEMO)", client_document: "00.000.000/0001-00", quote_number: "ORC-000012", quote_version: 1, payment_condition_name: "30/60/90 dias", total_amount: 49000, delivery_date: "2026-11-20", payment_confirmed_at: "2026-10-19T10:00:00Z", payment_confirmed_by: "financeiro@demo.com" },
  require_payment: true,
  items: [{ id: "it1", position: 0, line_type: "Produto", material_id: "44444444-4444-4444-8444-444444444444", sku: "PRD-000001", description: "Carreta Náutica FZ 1E (DEMO)", unit: "UN", quantity: 5, unit_price: 9800, discount_percent: 0, total: 49000, unit_cost: 6420.5, make_to_order: false, quantity_from_stock: 2, quantity_to_produce: 3, lead_time_days: 30, reserved: 3, delivered: 0, produced: 1, in_production: 2, quoted_bom_version: 1, bom_version: 2, structure_changed: true, planned: true }],
  production_orders: [{ id: demoOrderId, code: "OP-2026-00001", status: "Em producao", quantity: 3, produced_quantity: 1, planned_end: "2026-11-10", product: "Carreta Náutica FZ 1E (DEMO)", sku: "PRD-000001" }],
  deliveries: [], availability: [],
  release: { eligible: false, blockers: [{ code: "documentacao", message: "Documentação veicular: 0 de 2 unidade(s) liberada(s).", waivable: false }, { code: "autorizacao", message: "Falta a autorização operacional da produção.", waivable: false }] },
  documentation: { summary: { total: 2, approved: 0 }, items: [{ id: "99999999-9999-4999-8999-999999999999", unit_number: 1, units_in_item: 2, status: "Aguardando processamento", vin: "9BWZZZ377VT004251", protocol: "PORTAL-2026-0001" }, { id: "a1", unit_number: 2, units_in_item: 2, status: "Pendente de dados", vin: null, protocol: null }] },
  settings: { require_operational_authorization: true, documentation_channel: "manual" },
  events: [{ event: "Situação", description: "Situação alterada de Em producao para Parcialmente disponivel.", actor: "sistema", created_at: "2026-10-22T09:00:00Z" }, { event: "Pagamento", description: "Pagamento/sinal confirmado: sinal de 30%.", actor: "financeiro@demo.com", created_at: "2026-10-19T10:00:00Z" }, { event: "Criado", description: "Pedido PV-2026-00001 criado a partir do orçamento ORC-000012.", actor: "vendas@demo.com", created_at: "2026-10-18T12:00:00Z" }],
} })
const demoProduction = [
  { id: demoOrderId, code: "OP-2026-00001", status: "Em producao", product_id: "44444444-4444-4444-8444-444444444444", product_name: "Carreta Náutica FZ 1E (DEMO)", sku: "PRD-000001", quantity: 3, produced_quantity: 1, remaining: 2, sales_order_id: demoSaleId, order_number: "PV-2026-00001", client_name: "Náutica Exemplo Ltda (DEMO)", planned_end: "2026-10-15", priority: 2, responsible: "Chefe de produção", estimated_cost: 19261.5, actual_materials_cost: 5100, materials_missing: 1, late: true, total_count: 1 },
]
const demoProductionDetail = () => ({ detail: {
  order: { id: demoOrderId, code: "OP-2026-00001", status: "Em producao", product_name: "Carreta Náutica FZ 1E (DEMO)", sku: "PRD-000001", bom_version: 2, order_number: "PV-2026-00001", sales_order_id: demoSaleId, client_name: "Náutica Exemplo Ltda (DEMO)", quantity: 3, produced_quantity: 1, priority: 2, responsible: "Chefe de produção", planned_start: "2026-10-05", planned_end: "2026-11-10", estimated_materials_cost: 16111.5, estimated_labor_cost: 2700, estimated_other_cost: 450 },
  progress: { planned: 3, started: 2, produced: 1, remaining: 2 },
  kits: [{ kit_id: "k1", sku: "KIT-000001", name: "Kit Chassi FZ 1E (DEMO)", kit_version: 2, quantity: 3 }, { kit_id: "k2", sku: "KIT-000002", name: "Kit Elétrica (DEMO)", kit_version: 1, quantity: 3 }],
  materials: [
    { id: "pm1", material_id: "11111111-1111-4111-8111-111111111111", sku: "MP-000001", name: "Perfil de aço U 6 m (DEMO)", kit: "Kit Chassi FZ 1E (DEMO)", unit: "M", required: 18.9, reserved: 6.3, consumed: 12.6, remaining: 6.3, unit_cost_estimated: 12.4, cost_estimated: 234.36 },
    { id: "pm2", material_id: "22222222-2222-4222-8222-222222222222", sku: "MP-000002", name: "Parafuso sextavado M10 (DEMO)", kit: "Kit Chassi FZ 1E (DEMO)", unit: "UN", required: 60, reserved: 20, consumed: 40, remaining: 20, unit_cost_estimated: 0.85, cost_estimated: 51 },
  ],
  plan: [{ material_id: "11111111-1111-4111-8111-111111111111", name: "Perfil de aço U 6 m (DEMO)", unit: "M", required: 18.9, reserved_for_order: 6.3, consumed: 12.6, available_free: 0, incoming: 120, shortage: 0 }],
  consumptions: [{ id: "cs1", material: "Perfil de aço U 6 m (DEMO)", quantity: 12.6, unit: "M", kind: "Consumo", unit_cost: 12.4, total_cost: 156.24, responsible: "Operador", occurred_at: "2026-10-14T09:00:00Z", notes: null }],
  receipts: [{ id: "r1", quantity: 1, unit_cost: 6380, materials_cost: 5100, labor_other_cost: 1280, created_at: "2026-10-16T15:00:00Z", responsible: "Operador", warehouse: "Depósito principal (demonstração)", allocations: [{ cost_type: "materiais", amount: 5100, criterion: "x" }, { cost_type: "mao_de_obra", amount: 900, criterion: "x" }, { cost_type: "indiretos", amount: 380, criterion: "x" }], adjustments: [] }],
  events: [{ event: "Conclusão parcial/total", description: "1 unidade(s) concluída(s) e recebida(s) no estoque a 6380.0000 cada.", actor: "Operador", created_at: "2026-10-16T15:00:00Z" }, { event: "Situação", description: "Situação alterada de Pronta para producao para Em producao.", actor: "chefe@demo.com", created_at: "2026-10-14T08:00:00Z" }],
  costs: { estimated_materials: 16111.5, estimated_labor: 2700, estimated_other: 450, estimated_total: 19261.5, consumed_materials: 10200, allocated_materials: 5100, in_process_materials: 5100, received_cost: 6380, labor_other_applied: 1280, adjustments: 0 },
  purchase_requests: [],
} })
const demoMrp = { items: [
  { material_id: "11111111-1111-4111-8111-111111111111", sku: "MP-000001", name: "Perfil de aço U 6 m (DEMO)", unit: "M", required: 37.8, reserved_for_orders: 6.3, unreserved_need: 31.5, physical: 80, reserved_total: 80, available: 0, incoming: 20, shortage_now: 31.5, shortage_projected: 11.5, requested: 0, to_request: 11.5, supplier_name: "Aços Exemplo Ltda (DEMO)", lead_time_days: 7, next_arrival: "2026-10-28", needed_by: "2026-10-30", orders: [{ code: "OP-2026-00001" }, { code: "OP-2026-00002" }], arrivals: [{ purchase_order: "PC-000031", expected_date: "2026-10-28", quantity: 20 }] },
  { material_id: "22222222-2222-4222-8222-222222222222", sku: "MP-000002", name: "Parafuso sextavado M10 (DEMO)", unit: "UN", required: 120, reserved_for_orders: 20, unreserved_need: 100, physical: 2400, reserved_total: 480, available: 1920, incoming: 0, shortage_now: 0, shortage_projected: 0, requested: 0, to_request: 0, supplier_name: "Fixadores Demo S.A.", lead_time_days: 5, next_arrival: null, needed_by: "2026-10-30", orders: [{ code: "OP-2026-00001" }], arrivals: [] },
] }
const demoDashboard = { sales_awaiting_confirmation: 1, sales_awaiting_production: 0, sales_ready_for_delivery: 1, orders_in_progress: 1, orders_waiting_materials: 1, orders_open: 2, units_pending: 5, units_planned: 6, units_completed_30d: 1, orders_late: 1, materials_short: 1, materials_short_now: 1, purchase_requests_pending: 0, cost_completed: { orders: 0, estimated: 0, actual: 0 }, require_payment: true }

/** Documentação veicular FICTÍCIA só para visualizar as telas no modo de demonstração. */
const demoDocId = "99999999-9999-4999-8999-999999999999"
const demoDocs = [
  { id: demoDocId, sales_order_id: "66666666-6666-4666-8666-666666666666", order_number: "PV-2026-00001", client_name: "Náutica Exemplo Ltda (DEMO)", product_name: "Carreta Náutica FZ 1E (DEMO)", product_model: "FZ 1E", unit_number: 1, units_in_item: 2, vin: "9BWZZZ377VT004251", protocol: "PORTAL-2026-0001", portal: "SERPRO/RENAVAM - Pré-cadastro de veículos", channel: "manual", status: "Aguardando processamento", final_stage: "Nao iniciada", submitted_at: "2026-10-12T10:00:00Z", last_checked_at: "2026-10-14T10:00:00Z", approved_at: null, responsible: "Documentação", pendencies: [], last_error: null, stale: true, total_count: 3 },
  { id: "a1", sales_order_id: "66666666-6666-4666-8666-666666666666", order_number: "PV-2026-00001", client_name: "Náutica Exemplo Ltda (DEMO)", product_name: "Carreta Náutica FZ 1E (DEMO)", product_model: "FZ 1E", unit_number: 2, units_in_item: 2, vin: null, protocol: null, portal: "SERPRO/RENAVAM - Pré-cadastro de veículos", channel: "manual", status: "Pendente de dados", final_stage: "Nao iniciada", submitted_at: null, last_checked_at: null, approved_at: null, responsible: "Documentação", pendencies: ["Chassi (VIN)"], last_error: null, stale: false, total_count: 3 },
  { id: "a2", sales_order_id: "88888888-8888-4888-8888-888888888888", order_number: "PV-2026-00002", client_name: "Marina Demo S.A.", product_name: "Reboque Utilitário RU 300 (DEMO)", product_model: "RU 300", unit_number: 1, units_in_item: 1, vin: "9BWZZZ377VT004999", protocol: "PORTAL-2026-0002", portal: "SERPRO/RENAVAM - Pré-cadastro de veículos", channel: "manual", status: "Em exigencia", final_stage: "Nao iniciada", submitted_at: "2026-10-18T10:00:00Z", last_checked_at: "2026-10-20T10:00:00Z", approved_at: null, responsible: "Documentação", pendencies: ["Informar o número do CAT"], last_error: "Informar o CAT", stale: false, total_count: 3 },
]
const demoDocDashboard = { open: 3, pending_data: 1, ready: 0, waiting: 1, requirements: 1, rejected: 0, approved: 0, stale: 1 }
const demoDocDetail = () => ({ detail: {
  documentation: { ...demoDocs[0], id: demoDocId, client_document: "00.000.000/0001-00", quote_number: "ORC-000012", bom_version: 2, missing: [], cat_number: "", brand_model_version_code: "", notes: "", final_stage_note: null, status: "Aguardando processamento" },
  attempts: [{ id: "t2", attempt_number: 1, kind: "envio", channel: "manual", outcome: "sucesso", message: "Pré-cadastro feito manualmente no portal.", protocol: "PORTAL-2026-0001", actor: "docs@demo.com", created_at: "2026-10-12T10:00:00Z", finished_at: "2026-10-12T10:00:00Z" }],
  events: [{ event: "Envio", description: "Envio sucesso: Pré-cadastro feito manualmente no portal. (protocolo PORTAL-2026-0001).", actor: "docs@demo.com", created_at: "2026-10-12T10:00:00Z" }, { event: "Criada", description: "Documentação da unidade 1 criada para o pedido.", actor: "gerente@demo.com", created_at: "2026-10-10T09:00:00Z" }],
  files: [],
  release: { eligible: false, blockers: [{ code: "documentacao", message: "Documentação veicular: 0 de 2 unidade(s) liberada(s).", waivable: false }, { code: "autorizacao", message: "Falta a autorização operacional da produção.", waivable: false }] },
} })

/** Engenharia e configurador FICTÍCIOS (dados do modelo FZ 1E só para ver as telas no modo de demonstração; nada é homologado). */
const demoEngDocs = [
  { id: "ed1", revision_id: "rev1", kind: "CCT", name: "CCT — Certificado de Capacitação Técnica (FZ 1E)", file_path: null, document_number: "A0.051.856", issuer: "CIVA (OIA-SV 1014)", issued_at: "2025-05-23", valid_until: "2027-05-19", notes: "", created_by: "demo", created_at: "2026-10-22T12:00:00Z" },
  { id: "ed2", revision_id: "rev1", kind: "Desenho tecnico", name: "Desenho técnico — R/ND Carretas FZ 1E", file_path: "2026-10/x-desenho.pdf", document_number: "8102.12.170-1", issuer: "VIP Engenharia", issued_at: "2025-05-24", valid_until: null, notes: "", created_by: "demo", created_at: "2026-10-22T12:00:00Z" },
  { id: "ed3", revision_id: "rev1", kind: "CAT", name: "CAT nº 1143/2019", file_path: null, document_number: "1143/2019", issuer: "SENATRAN/INMETRO", issued_at: null, valid_until: null, notes: "", created_by: "demo", created_at: "2026-10-22T12:00:00Z" },
]
const demoEngSources = (rows: Array<[string, string, number | null, number | null, number | null]>) => rows.map(([id, document, min, max, fixed]) => ({ id, document_id: id, document, min, max, fixed, note: null }))
const demoEngOverview = () => ({ overview: {
  current_revision_id: "rev1",
  revisions: [{ id: "rev1", revision: "R1", status: "Em validacao", bom_version: null, brand_model_version_code: "R/ND CARRETAS FZ 1E", cat_number: "1143/2019", cct_number: "A0.051.856", cct_valid_until: "2027-05-19", technical_responsible: "Igor Vigorito (CREA 2608328377)", revised_at: "2025-05-19", notes: "", validated_by: null, validated_at: null, open_issues: 2 }],
  documents: demoEngDocs,
  parameters: [
    { id: "pp1", revision_id: "rev1", key: "comprimento", label: "Comprimento", unit: "mm", scope: "nao_declarada", configurable: true, integer_only: false, step: null, default_value: null, adopted_min: null, adopted_max: null, adopted_fixed: null, adoption_note: null, sources: demoEngSources([["ed1", "CCT A0.051.856", 2000, 6000, null], ["ed2", "Desenho técnico 8102.12.170-1", null, 6000, null]]), in_conflict: false },
    { id: "pp2", revision_id: "rev1", key: "largura", label: "Largura", unit: "mm", scope: "nao_declarada", configurable: true, integer_only: false, step: null, default_value: null, adopted_min: null, adopted_max: null, adopted_fixed: null, adoption_note: null, sources: demoEngSources([["ed1", "CCT A0.051.856", 1000, 2000, null], ["ed2", "Desenho técnico 8102.12.170-1", null, 2300, null]]), in_conflict: true },
    { id: "pp3", revision_id: "rev1", key: "altura", label: "Altura", unit: "mm", scope: "nao_declarada", configurable: true, integer_only: false, step: null, default_value: null, adopted_min: null, adopted_max: null, adopted_fixed: null, adoption_note: null, sources: demoEngSources([["ed1", "CCT A0.051.856", 500, 2500, null], ["ed2", "Desenho técnico 8102.12.170-1", null, 2200, null]]), in_conflict: true },
    { id: "pp4", revision_id: "rev1", key: "pbt", label: "PBT", unit: "kg", scope: "referencia", configurable: false, integer_only: false, step: null, default_value: null, adopted_min: null, adopted_max: null, adopted_fixed: null, adoption_note: null, sources: demoEngSources([["ed1", "CCT A0.051.856", null, null, 750]]), in_conflict: false },
  ],
  issues: [
    { id: "i1", revision_id: "rev1", parameter_key: "largura", kind: "conflito_documental", description: "Conflito no máximo de \"Largura\": 2000 x 2300 (fontes: CCT A0.051.856; Desenho tecnico 8102.12.170-1). A engenharia precisa decidir qual vale.", status: "Aberta" },
    { id: "i2", revision_id: "rev1", parameter_key: "altura", kind: "conflito_documental", description: "Conflito no máximo de \"Altura\": 2200 x 2500 (fontes: CCT A0.051.856; Desenho tecnico 8102.12.170-1). A engenharia precisa decidir qual vale.", status: "Aberta" },
  ],
  options: [], rules: [], formulas: [], templates: [{ revision_id: "rev1", template_key: "reboque_aberto_1_eixo", template_version: 1, grade: "ilustrativo", geometry: {} }],
  bom_kits: [{ kit_id: "k1", name: "Kit Chassi FZ 1E (DEMO)", components: [{ material_id: "11111111-1111-4111-8111-111111111111", name: "Perfil de aço U 6 m (DEMO)", unit: "M", quantity: 6, comp_unit: "M" }] }],
} })
const demoConfigResult = { configuration_id: "cfg1", status: "Requer analise tecnica", homologated: false, errors: [], warnings: [{ code: "conflito", message: "Os documentos divergem sobre largura: usado o limite mais restritivo até a engenharia decidir." }], review_reasons: ["A revisão de engenharia R1 ainda não foi validada: os limites não são homologados.", "Conflito documental em largura (pendência de engenharia)."],
  params: { comprimento: 4000, largura: 1800, altura: 1200, pbt: 750, tara: 200, lotacao: 550, eixos: 1 }, summary: "Carreta Náutica FZ 1E (DEMO) 4.000 x 1.800 x 1.200 mm", options: { acabamento: null, acessorios: [], selected: [] },
  materials: [{ name: "Perfil de aço U 6 m (DEMO)", kit_name: "Kit Chassi FZ 1E (DEMO)", quantity: 6.3, unit: "M", source: "fixa", cost: 78.12 }], cut_list: [], kits: [],
  costs: { materials: 5370.5, labor: 900, overhead: 150, other: 0, finishing: 0, total: 6420.5 }, price: 9800, margin: 3379.5, margin_percent: 34.49, margin_alert: false, revision: "R1", bom_version: 2, drawing: { grade: "ilustrativo", geometry: {} } }
const demoConfigurator = { spec: { has_engineering: true, homologated: false, revision: "R1", revision_status: "Em validacao", base_price: 9800, open_issues: 2,
  params: [{ key: "comprimento", label: "Comprimento", unit: "mm", min: 2000, max: 6000, step: null, default: null, in_conflict: false }, { key: "largura", label: "Largura", unit: "mm", min: 1000, max: 2000, step: null, default: null, in_conflict: true }, { key: "altura", label: "Altura", unit: "mm", min: 500, max: 2200, step: null, default: null, in_conflict: true }],
  reference: [{ key: "pbt", label: "PBT", unit: "kg", value: 750 }, { key: "tara", label: "Tara de referência", unit: "kg", value: 200 }, { key: "lotacao", label: "Lotação de referência", unit: "kg", value: 550 }],
  options: [], drawing: { template_key: "reboque_aberto_1_eixo", grade: "ilustrativo", geometry: {} } }, result: demoConfigResult, configuration: null }
const demoFicha = { sheet: { order: { id: "o1", code: "OP-2026-00001", quantity: 3, status: "Em producao", planned_end: "2026-11-10", priority: 2 }, product: { name: "Carreta Náutica FZ 1E (DEMO)", sku: "PRD-000001", model: "FZ 1E" },
  sales_order: { order_number: "PV-2026-00001", client: "Náutica Exemplo Ltda (DEMO)" }, bom: { version: 2, notes: "Soldar conforme o gabarito do chassi.", estimated_days: 12 },
  configuration: { ...demoConfigResult, id: "cfg1", status: "Valida", homologated: true, revision_label: "R1", frozen_at: "2026-10-18T12:00:00Z", cost_total: 6420.5, drawing_spec: { grade: "ilustrativo", geometry: {} },
    options: { selected: [{ group: "acabamento", label: "Galvanizado a fogo", code: "galv" }] }, cut_list: [{ name: "Perfil de aço U 6 m (DEMO)", plan: { bars: 3, bar_length_mm: 6000, waste_mm: 2000, pieces: [{ label: "Longarina", length_mm: 4000, count: 2 }, { label: "Travessa", length_mm: 1800, count: 3 }] } }] },
  kits: [{ name: "Kit Chassi FZ 1E (DEMO)", sku: "KIT-000001", version: 2, quantity: 3 }], materials: [{ name: "Perfil de aço U 6 m (DEMO)", sku: "MP-000001", kit: "Kit Chassi FZ 1E (DEMO)", unit: "M", required: 18.9 }],
  release: { eligible: false, blockers: [{ code: "documentacao", message: "Documentação veicular: 0 de 3 unidade(s) liberada(s).", waivable: false }] } } }

/** Fotografias e PDFs do pedido FICTÍCIOS (a imagem é um arquivo local de demonstração; nada vai ao armazenamento). */
const demoPhotos = () => ({ photos: [
  { id: "f1111111-1111-4111-8111-111111111111", url: "/demo-foto.jpg", purpose: "comercial", caption: "Vista geral", is_main: true, position: 1, status: "Disponivel", original_name: "carreta.jpg", verify_note: null, legacy: false, created_by: "demo" },
  { id: "f2222222-2222-4222-8222-222222222222", url: "/demo-foto.jpg", purpose: "detalhe", caption: "Cubo e eixo", is_main: false, position: 2, status: "Disponivel", original_name: "cubo.jpg", verify_note: null, legacy: false, created_by: "demo" },
  { id: "f3333333-3333-4333-8333-333333333333", url: "/api/produtos/foto/f3333333-3333-4333-8333-333333333333", purpose: "comercial", caption: null, is_main: false, position: 3, status: "Indisponivel", original_name: null, verify_note: "O arquivo não existe no armazenamento.", legacy: true, created_by: "auditoria 226" },
] })
const demoSalesDocs = () => ({ documents: [
  { id: "d2", version: 2, trigger_source: "revisao", reason: "Cliente trocou o acabamento para galvanizado a fogo", file_name: "pedido-PV-2026-00001-v2.pdf", size_bytes: 182000, sha256: "x", emitted_by: "gerente@demo.com", emitted_at: "2026-10-21T15:00:00Z", photo_refs: [{ item: "Item 1", product: "Carreta Náutica FZ 1E (DEMO)", included: true, problem: "" }], configuration_refs: [{ item: "Item 1", summary: "Carreta Náutica FZ 1E (DEMO) 4.000 x 1.800 x 1.200 mm", revision: "R1", drawing_grade: "ilustrativo" }] },
  { id: "d1", version: 1, trigger_source: "conversao", reason: null, file_name: "pedido-PV-2026-00001-v1.pdf", size_bytes: 176000, sha256: "y", emitted_by: "vendedor@demo.com", emitted_at: "2026-10-18T12:00:00Z", photo_refs: [{ item: "Item 1", product: "Carreta Náutica FZ 1E (DEMO)", included: false, problem: "sem foto" }], configuration_refs: [] },
] })

/** Orçamento FICTÍCIO com um produto configurável (para ver o fluxo "Personalizar produto" no modo de demonstração). */
const demoQuoteId = "99999999-9999-4999-8999-999999999999"
const demoQuote = { id: demoQuoteId, number: "ORC-000099", version: 1, title: "Carreta FZ 1E (DEMO)", clientId: "c1", clientName: "Náutica Exemplo Ltda (DEMO)", clientPhone: "(47) 99999-0000", clientEmail: "cliente@demo.com", salespersonId: "s1", salespersonName: "Vendedor Demo", opportunityId: "", issueDate: "2026-10-20", validUntil: "2026-11-20",
  quoteType: "Produto", status: "Rascunho", effectiveStatus: "Rascunho", itemsSubtotal: 9800, discountAmount: 0, freightAmount: 0, expensesAmount: 0, taxPercent: 0, taxesAmount: 0, totalAmount: 9800, estimatedCost: 6420.5, paymentConditionId: "pc1", paymentConditionName: "Entrada + 30 dias",
  deliveryText: "", warrantyDays: 90, notes: "", sentAt: "", sentVia: "", sentTo: "", approvedAt: "", acceptedBy: "", acceptNotes: "", refusalReason: "", convertedAt: "", convertedTo: "", receivablesGenerated: false, createdBy: "demo", createdAt: "2026-10-20T12:00:00Z", updatedAt: "2026-10-20T12:00:00Z" }
const demoQuoteDetail = () => ({ quote: demoQuote, items: [{ id: "qi1", lineType: "Produto", catalogId: demoProductId, description: "Carreta Náutica FZ 1E (DEMO) 4.000 x 1.800 x 1.200 mm", unit: "UN", quantity: 1, unitPrice: 9800, catalogPrice: 9800, unitCost: 6420.5, discountPercent: 0, total: 9800, notes: "",
  configurationId: "cfg1", bomVersionId: "pv2", bomVersionNumber: 2, leadTimeDays: 20, productSku: "PRD-000001", config: { status: "Requer analise tecnica", summary: "Carreta Náutica FZ 1E (DEMO) 4.000 x 1.800 x 1.200 mm", price: 9800, cost_total: 6420.5, frozen_at: null, homologated: false } }], events: [], attachments: [], versions: [{ id: demoQuoteId, version: 1, status: "Rascunho", total_amount: 9800, valid_until: "2026-11-20", created_at: "2026-10-20T12:00:00Z" }], orders: [], receivables: [] })
const demoQuoteOptions = () => ({ clients: [{ id: "c1", name: "Náutica Exemplo Ltda (DEMO)", document: "12.345.678/0001-95", status: "Ativo", phone: "(47) 99999-0000", email: "cliente@demo.com" }], salespeople: [{ id: "s1", name: "Vendedor Demo" }],
  paymentConditions: [{ id: "pc1", name: "Entrada + 30 dias", installments: 2, firstDueDays: 0, intervalDays: 30 }],
  products: [{ id: demoProductId, name: "Carreta Náutica FZ 1E (DEMO)", code: "PRD-000001", unit: "UN", price: 9800, cost: 6420.5, bomVersion: 2, hasEngineering: true, photoUrl: "/demo-foto.jpg", leadTimeDays: 20, marginPercent: 34.49, stock: 2, reserved: 1, controlsStock: true }], services: [], warehouses: [], opportunities: [],
  company: { id: "demo", name: "ND Carretas (demonstração)", legalName: "", cnpj: "", email: "", phone: "", address: "", hasLogo: false }, settings: { defaultValidityDays: 15, discountApprovalPercent: 10 }, emailConfigured: false, canConfigure: true, paymentMethods: ["PIX", "Boleto"] })

/** Chão de fábrica FICTÍCIO (tablet e esteira) para ver as telas no modo de demonstração. */
const demoShopWorker = { id: "w1", code: "S01", name: "João Soldador (DEMO)", sectors: ["Soldagem"], shift: "Manhã", is_inspector: false, is_supervisor: false }
const demoShopCard = (extra: Record<string, unknown>) => ({ id: "t1", step_code: "soldagem", step: "Soldagem / produção do chassi", status: "Pronta", kind: "fabricacao", unit_number: 1, planned_end: "2026-11-10", blocked_reason: null, pending_reason: null, started_at: null, finished_at: null, rework_count: 0,
  order_id: "77777777-7777-4777-8777-777777777777", order_code: "OP-2026-00001", priority: 2, quantity: 3, order_status: "Em producao", product: "Carreta Náutica FZ 1E (DEMO)", model: "FZ 1E", vin: "9BWZZZ377VT004251", assigned: null, working: [], mine_open: false, worked_by_me: false, ...extra })
const demoShopTasks = () => ({ worker: demoShopWorker, server_time: new Date().toISOString(), tasks: [
  demoShopCard({ id: "t1", status: "Em execucao", mine_open: true, started_at: new Date(Date.now() - 42 * 60000).toISOString(), working: [{ name: "João Soldador (DEMO)", since: new Date(Date.now() - 42 * 60000).toISOString() }] }),
  demoShopCard({ id: "t2", unit_number: 2, vin: "9BWZZZ377VT004252", status: "Pronta" }),
  demoShopCard({ id: "t3", unit_number: 3, vin: null, status: "Bloqueada", blocked_reason: "Aguardando a reserva/informação do número de chassi da unidade 3." }),
  demoShopCard({ id: "t4", unit_number: 1, status: "Concluida", step: "Corte dos perfis (DEMO)", finished_at: new Date().toISOString(), worked_by_me: true }),
] })
const demoShopDetail = (id = "t1") => ({ task: id === "t1" ? demoShopCard({ id: "t1", status: "Em execucao", mine_open: true, working: [{ name: "João Soldador (DEMO)", since: new Date(Date.now() - 42 * 60000).toISOString() }] }) : demoShopCard({ id, unit_number: 2, vin: "9BWZZZ377VT004252", status: "Pronta" }), step: { code: "soldagem", name: "Soldagem / produção do chassi", requires_checklist: false, requires_measures: false, allow_multiple: true },
  materials: [{ material_id: "m1", sku: "MP-000001", name: "Perfil de aço U 6 m (DEMO)", description: "Perfil U 100x50", unit: "M", kit: "Kit Chassi FZ 1E (DEMO)", kit_version: 2, planned: 6, planned_order: 18, reserved: 18, consumed: 6, consumed_by_task: 0, available: 482 },
    { material_id: "m2", sku: "MP-000003", name: "Chapa de aço 3 mm (DEMO)", description: null, unit: "UN", kit: "Kit Chassi FZ 1E (DEMO)", kit_version: 2, planned: 2, planned_order: 6, reserved: 6, consumed: 0, consumed_by_task: 0, available: 14 }],
  drawing: { product: { name: "Carreta Náutica FZ 1E (DEMO)", model: "FZ 1E", sku: "PRD-000001" }, configuration: { params: { comprimento: 4000, largura: 1800, altura: 1200, pbt: 750 }, options: { selected: [{ group: "acabamento", label: "Galvanizado a fogo" }] }, homologated: false, revision: "R1", summary: "Carreta Náutica FZ 1E (DEMO) 4.000 x 1.800 x 1.200 mm", drawing_spec: { grade: "ilustrativo", geometry: {} } }, bom_notes: "Soldar conforme o gabarito do chassi." },
  checklist: [], measures: [], occurrences: [], metrics: { elapsed_productive_minutes: 42, labor_minutes: 84, pause_minutes: 6, workers: [{ name: "João Soldador (DEMO)", minutes: 42 }, { name: "Maria Soldadora (DEMO)", minutes: 42 }], planned_minutes: 180 }, server_time: new Date().toISOString() })
const demoShopBoard = () => {
  const steps = [["soldagem", "Soldagem / produção do chassi"], ["acabamento", "Galvanização ou acabamento (terceirizado)"], ["montagem", "Montagem"], ["gravacao", "Impressão/gravação do chassi"], ["checklist", "Checklist de inspeção"], ["medidas", "Conferência das medidas"], ["faixas", "Faixas reflexivas"], ["despachante", "Acionamento do despachante (emplacamento)"]]
  const unit = (n: number, step: string, status: string, extra: Record<string, unknown> = {}) => ({ order_id: "77777777-7777-4777-8777-777777777777", order_code: "OP-2026-00001", unit_number: n, priority: 2, product: "Carreta Náutica FZ 1E (DEMO)", model: "FZ 1E", vin: `9BWZZZ377VT00425${n}`, planned_end: "2026-11-10", token: `a1b2c3d4e5f60718293a4b5c6d7e8f0${n}`, current_step: step, current_status: status, current_name: step, blocked_reason: null, pending_reason: null, task_id: `t${n}`, done_tasks: 2, total_tasks: 8, finished: false, late: false, working: [], assigned: null, ...extra })
  return { server_time: new Date().toISOString(), steps: steps.map(([code, name], index) => ({ code, name, seq: index + 1, kind: "fabricacao" })),
    units: [unit(1, "soldagem", "Em execucao", { working: ["João Soldador (DEMO)", "Maria Soldadora (DEMO)"] }), unit(2, "acabamento", "Em execucao", { done_tasks: 1 }), unit(3, "montagem", "Pausada", { late: true }), unit(4, "checklist", "Com pendencia", { pending_reason: "1 item(ns) obrigatório(s) não conforme(s): aguardando decisão do gestor/inspetor.", done_tasks: 4 }), unit(5, "soldagem", "Bloqueada", { blocked_reason: "Aguardando a reserva/informação do número de chassi da unidade 5.", vin: null, done_tasks: 0 }), unit(6, "despachante", "Pronta", { done_tasks: 7 })],
    active_workers: [{ worker: "João Soldador (DEMO)", task: "Soldagem / produção do chassi", order_code: "OP-2026-00001", unit: 1, since: new Date(Date.now() - 42 * 60000).toISOString() }, { worker: "Maria Soldadora (DEMO)", task: "Soldagem / produção do chassi", order_code: "OP-2026-00001", unit: 1, since: new Date(Date.now() - 40 * 60000).toISOString() }],
    stopped: [{ task_id: "t3", order_code: "OP-2026-00001", unit: 3, step: "Montagem", status: "Pausada", reason: "Falta de material" }, { task_id: "t4", order_code: "OP-2026-00001", unit: 4, step: "Checklist de inspeção", status: "Com pendencia", reason: "1 item(ns) obrigatório(s) não conforme(s)" }],
    late_count: 1, open_occurrences: [{ id: "o1", kind: "nao_conformidade", description: "Gravação do chassi torta", order_code: "OP-2026-00001", unit: 4, step: "gravacao", created_at: new Date().toISOString() }], rework_count: 1,
    external: [{ task_id: "t2", provider: "Galvanizadora Sul (DEMO)", finish_type: "galvanizacao_a_fogo", sent_at: "2026-10-19T12:00:00Z", expected_return: "2026-10-26", returned_at: null, cost: null, order_code: "OP-2026-00001", unit: 2 }] }
}
const demoShopOverview = () => ({ board: demoShopBoard(), workers: [{ id: "w1", code: "S01", name: "João Soldador (DEMO)", sectors: ["Soldagem"], shift: "Manhã", hourly_rate: 22.5, is_inspector: false, is_supervisor: false, active: true, has_pin: true, profile_id: null, locked: false }],
  steps: [{ id: "s1", code: "soldagem", name: "Soldagem / produção do chassi", seq: 1, kind: "fabricacao", sector: "Soldagem", depends_on: [], allow_multiple: true, requires_checklist: false, requires_measures: false, kit_match: "chassi", standard_minutes: 180, tolerance_mm: null, active: true, kits: [], items: [] },
    { id: "s2", code: "gravacao", name: "Impressão/gravação do chassi", seq: 4, kind: "fabricacao", sector: "Montagem", depends_on: ["montagem"], allow_multiple: false, requires_checklist: true, requires_measures: false, kit_match: null, standard_minutes: null, tolerance_mm: null, active: true, kits: [], items: [{ id: "i1", label: "Chassi gravado e legível", mandatory: true, allow_na: false, position: 1 }] }],
  productivity: { by_step: [{ seq: 1, step: "Soldagem / produção do chassi", tasks: 6, done: 4, labor_hours: 38.5, avg_elapsed_minutes: 195, planned_minutes: 180, rework: 1 }], by_worker: [{ worker_id: "w1", name: "João Soldador (DEMO)", hours: 21.5, tasks: 5, cost: 483.75 }] }, kits: [{ id: "k1", name: "Kit Chassi FZ 1E (DEMO)", category: "Chassi" }] })
const demoShopUnit = () => ({ unit: { order_code: "OP-2026-00001", order_status: "Em producao", unit_number: 1, units: 3, vin: "9BWZZZ377VT004251", current_step: "Soldagem / produção do chassi", product: { name: "Carreta Náutica FZ 1E (DEMO)", model: "FZ 1E", sku: "PRD-000001" },
  tasks: [{ id: "t1", step: "Soldagem / produção do chassi", status: "Em execucao", started_at: new Date().toISOString(), finished_at: null }, { id: "t2", step: "Galvanização ou acabamento (terceirizado)", status: "Aguardando", started_at: null, finished_at: null }, { id: "t3", step: "Montagem", status: "Aguardando", started_at: null, finished_at: null }],
  history: [{ at: new Date().toISOString(), event: "Iniciada", step: "Soldagem / produção do chassi", worker: "João Soldador (DEMO)" }], drawing: { configuration: { params: { comprimento: 4000, largura: 1800, altura: 1200 }, summary: "Carreta Náutica FZ 1E (DEMO) 4.000 x 1.800 x 1.200 mm", revision: "R1", homologated: false } } } })

/** Resposta genérica das APIs no modo de demonstração. */
export function demoApiPayload(pathname: string, search = "") {
  if (/^\/api\/engenharia\/[0-9a-f-]{36}$/.test(pathname)) return demoEngOverview()
  if (pathname === "/api/configurador") return demoConfigurator
  if (pathname === "/api/chao-de-fabrica/sessao") return { ok: true, token: "demo-token", worker: demoShopWorker, idle_minutes: 10 }
  if (pathname === "/api/chao-de-fabrica/tarefas") return demoShopTasks()
  if (/^\/api\/chao-de-fabrica\/tarefas\/[0-9a-z-]+$/.test(pathname)) return demoShopDetail(pathname.split("/").pop())
  if (pathname === "/api/chao-de-fabrica/gestor") return demoShopOverview()
  if (pathname.startsWith("/api/chao-de-fabrica/unidade/")) return demoShopUnit()
  if (/^\/api\/produtos\/[0-9a-f-]{36}\/fotos$/.test(pathname)) return demoPhotos()
  if (/^\/api\/vendas\/[0-9a-f-]{36}\/pdf$/.test(pathname)) return demoSalesDocs()
  if (/^\/api\/producao\/[0-9a-f-]{36}\/ficha$/.test(pathname)) return demoFicha
  if (pathname === "/api/documentacao") return { items: demoDocs, total: demoDocs.length, page: 1, pageSize: 25, dashboard: demoDocDashboard }
  if (/^\/api\/documentacao\/[0-9a-f-]{36}$/.test(pathname)) return demoDocDetail()
  if (pathname === "/api/vendas") return { items: demoSales, total: demoSales.length, page: 1, pageSize: 25 }
  if (pathname === "/api/vendas/config") return { requirePayment: true, require_payment_before_production: true, require_documentation_before_production: true, require_operational_authorization: true, allow_payment_exception: false, generate_receivables_on_confirmation: false, documentation_channel: "manual", documentation_stale_days: 7 }
  if (/^\/api\/vendas\/[0-9a-f-]{36}$/.test(pathname)) return demoSaleDetail()
  if (pathname === "/api/producao") return { items: demoProduction, total: demoProduction.length, page: 1, pageSize: 25, dashboard: demoDashboard }
  if (pathname === "/api/producao/mrp") return demoMrp
  if (pathname === "/api/producao/solicitacoes") return { items: [{ id: "sc1", request_number: "SC-2026-00001", status: "Pendente", requested_by: "compras@demo.com", created_at: "2026-10-21T10:00:00Z", production_order: null, orders: ["OP-2026-00001"], items: [{ name: "Perfil de aço U 6 m (DEMO)", quantity: 12, unit: "M", supplier: "Aços Exemplo Ltda (DEMO)" }] }] }
  if (/^\/api\/producao\/[0-9a-f-]{36}$/.test(pathname)) return demoProductionDetail()
  if (pathname === "/api/produtos") return { items: demoProducts, total: demoProducts.length, page: 1, pageSize: 25 }
  if (pathname === "/api/produtos/kits") return { items: [{ id: "k1", sku: "KIT-000001", name: "Kit Chassi FZ 1E (DEMO)", version: 2, version_id: "kv2", cost: 4120.5, components_count: 6 }, { id: "k2", sku: "KIT-000002", name: "Kit Elétrica (DEMO)", version: 1, version_id: "kv9", cost: 1250, components_count: 4 }] }
  if (/^\/api\/produtos\/[0-9a-f-]{36}$/.test(pathname)) {
    const query = new URLSearchParams(search)
    if (query.get("capacidade")) return demoCapacity
    if (query.get("explosao")) return demoExplosion(Number(query.get("explosao")) || 1)
    return demoProductDetail()
  }
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
  if (pathname === "/api/orcamentos/options") return { ...base, ...demoQuoteOptions() }
  if (pathname === "/api/orcamentos") return { quotes: [demoQuote] }
  if (pathname === `/api/orcamentos/${demoQuoteId}`) return demoQuoteDetail()
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
