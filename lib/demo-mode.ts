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

/** Resposta genérica das APIs no modo de demonstração. */
export function demoApiPayload(pathname: string, search = "") {
  if (pathname === "/api/vendas") return { items: demoSales, total: demoSales.length, page: 1, pageSize: 25 }
  if (pathname === "/api/vendas/config") return { requirePayment: true }
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
