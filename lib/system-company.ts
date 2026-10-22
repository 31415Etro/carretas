export const SYSTEM_COMPANY_COOKIE = "system_company_id"
export const SYSTEM_COMPANY_HEADER = "x-system-company-id"
export const DEFAULT_SYSTEM_COMPANY_ID = "00000000-0000-4000-8000-000000000001"

export interface SystemCompany {
  id: string
  name: string
  legalName: string
  tradeName: string
  cnpj: string
  email: string
  phone: string
  address: string
  active: boolean
  isDefault: boolean
}

export const defaultSystemCompany: SystemCompany = {
  id: DEFAULT_SYSTEM_COMPANY_ID,
  name: "ND Carretas",
  legalName: "ND Carretas",
  tradeName: "ND Carretas",
  cnpj: "",
  email: "",
  phone: "",
  address: "",
  active: true,
  isDefault: true,
}

export const sharedMasterTables = new Set([
  "clients", "client_contacts", "suppliers", "materials", "profiles", "providers", "provider_documents",
  "service_types", "service_type_checklist_items", "service_type_materials", "system_users", "vehicles",
  "fleet_drivers", "vehicle_documents", "vehicle_tires", "fleet_settings", "salespeople",
  "warehouses", "stock_balances", "stock_movements", "stock_reservations", "customer_assets",
])

export const tenantScopedTables = new Set([
  "accounts_payable", "accounts_receivable", "asaas_accounts", "asaas_balance_snapshots",
  "asaas_bill_payments", "asaas_customers", "asaas_fiscal_documents", "asaas_payments",
  "asaas_statement_entries", "asaas_transfers", "asaas_webhook_events", "audit_logs", "category_rules",
  "cost_centers", "credit_card_invoice_items", "credit_card_invoices", "credit_cards", "dre_accounts",
  "financial_categories", "financial_subcategories", "financial_transactions",
  "service_order_checklist_items", "service_order_events", "service_order_files",
  "service_order_materials", "service_order_signatures", "service_orders", "vehicle_maintenance",
  "bank_accounts", "payment_conditions", "purchase_orders", "purchase_order_items", "purchase_receipts",
  "purchase_receipt_items", "service_order_services", "service_order_time_entries",
  "service_order_status_history", "fuel_entries", "trips", "opportunities", "opportunity_interactions", "quotes", "quote_items", "quote_attachments", "quote_events", "contracts", "contract_billings", "contract_amendments", "contract_documents", "contract_obligations", "contract_os_plans", "contract_os_runs", "contract_events", "contract_alert_log", "saved_reports", "report_runs", "app_settings", "fiscal_operation_natures", "price_tables", "price_table_items", "quote_templates", "documents", "imported_invoices", "travel_advances", "travel_advance_receipts",
])

export function mapSystemCompany(row: any): SystemCompany {
  return {
    id: String(row?.id || DEFAULT_SYSTEM_COMPANY_ID),
    name: String(row?.name || row?.trade_name || "Empresa"),
    legalName: String(row?.legal_name || ""),
    tradeName: String(row?.trade_name || row?.name || ""),
    cnpj: String(row?.cnpj || ""),
    email: String(row?.email || ""),
    phone: String(row?.phone || ""),
    address: String(row?.address || ""),
    active: row?.active !== false,
    isDefault: row?.is_default === true,
  }
}

export function formatCnpj(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 14)
  return digits
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2")
}
