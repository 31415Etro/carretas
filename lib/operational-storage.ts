export const OPERATIONAL_STORAGE_KEY = "carretas-operational.v1"

export type ClientType = "PF" | "PJ"
export type ClientStatus = "Ativo" | "Inativo" | "Prospect"
export type ProviderStatus = "Ativo" | "Inativo" | "Em férias" | "Bloqueado"
export type VehicleStatus = "Disponível" | "Em uso" | "Em manutenção" | "Inativo"
export type TireCondition = "Novo" | "3/4 vida" | "Meia vida" | "1/4 vida" | "Solicitar troca"

export interface Client {
  id: string
  type: ClientType
  name: string
  document: string
  corporateName: string
  tradeName: string
  stateRegistration: string
  responsibleName: string
  phone: string
  mobile: string
  email: string
  zipCode: string
  street: string
  number: string
  complement: string
  district: string
  city: string
  state: string
  status: ClientStatus
  notes: string
  createdAt: string
  updatedAt: string
}

export interface Supplier {
  id: string
  name: string
  document: string
  contactName: string
  phone: string
  email: string
  category: string
  categoryIds: string[]
  city: string
  state: string
  status: "Ativo" | "Inativo"
  notes: string
  createdAt: string
  updatedAt: string
}

export interface Provider {
  id: string
  fullName: string
  cpf: string
  rg: string
  birthDate: string
  phone: string
  email: string
  zipCode: string
  street: string
  number: string
  complement: string
  district: string
  city: string
  state: string
  role: string
  relationshipType: string
  status: ProviderStatus
  notes: string
  createdAt: string
  updatedAt: string
}

export interface Vehicle {
  id: string
  plate: string
  model: string
  brand: string
  year: string
  color: string
  currentKm: number
  frontRightTire: TireCondition
  frontLeftTire: TireCondition
  rearRightTire: TireCondition
  rearLeftTire: TireCondition
  lastOilChangeDate: string
  lastOilChangeKm: number
  status: VehicleStatus
  renavam: string
  licensingDueDate: string
  insuranceInfo: string
  notes: string
  createdAt: string
  updatedAt: string
}

export interface Material {
  id: string
  name: string
  category: string
  unit: string
  /** SKU / código interno */
  internalCode: string
  minimumStock: number
  currentStock: number
  status: "Ativo" | "Inativo"
  notes: string
  /** Código de barras GTIN/EAN */
  barcode?: string
  ncm?: string
  cest?: string
  /** Origem da mercadoria (tabela A do CST: 0 a 8) */
  origin?: string
  /** Tipo do item no SPED (00 a 99) */
  spedItemType?: string
  maximumStock?: number
  grossWeight?: number
  netWeight?: number
  height?: number
  width?: number
  length?: number
  location?: string
  costPrice?: number
  salePrice?: number
  supplierId?: string
  supplierCode?: string
  /** Depósito / almoxarifado padrão do item */
  warehouseId?: string
  reorderPoint?: number
  /** Calculados pelo banco a partir das movimentações e reservas (somente leitura) */
  reservedStock?: number
  averageCost?: number
  lastPurchaseCost?: number
  controlsLot?: boolean
  controlsSerial?: boolean
  controlsExpiry?: boolean
  /** Tipo no catálogo único (serviços ficam em service_types) */
  itemType?: "Produto" | "Materia-prima" | "Kit"
  description?: string
  subcategory?: string
  brand?: string
  manufacturer?: string
  controlsStock?: boolean
  allowsSale?: boolean
  warrantyMonths?: number
  photoUrl?: string
  technicalSheetUrl?: string
  createdAt: string
  updatedAt: string
}

/** Referência da OS usada por outros módulos (ex.: vincular uma conta financeira). A OS completa é lida por /api/os. */
export interface ServiceOrder {
  id: string
  orderNumber: string
  clientId: string
  status: string
  orderKind: string
  description: string
  totalAmount: number
}

export interface VehicleMaintenance {
  id: string
  vehicleId: string
  type: string
  date: string
  km: number
  cost: number
  description: string
  nextMaintenance: string
  status: "Programada" | "Realizada"
  attachmentName: string
}

export interface SystemUser {
  id: string
  name: string
  email: string
  phone: string
  profile: string
  temporaryPassword: string
  status: "Ativo" | "Inativo"
  permissions: string[]
  clientId?: string
}

export interface AuditLog {
  id: string
  userId: string
  entityType: string
  entityId: string
  action: string
  description: string
  createdAt: string
}

export interface OperationalState {
  clients: Client[]
  suppliers: Supplier[]
  providers: Provider[]
  vehicles: Vehicle[]
  vehicleMaintenance: VehicleMaintenance[]
  materials: Material[]
  serviceOrders: ServiceOrder[]
  systemUsers: SystemUser[]
  auditLogs: AuditLog[]
}

export function makeId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function nowIso() {
  return new Date().toISOString()
}

export function today() {
  return nowIso().slice(0, 10)
}

export function formatDate(value?: string) {
  if (!value) return "-"
  return new Intl.DateTimeFormat("pt-BR").format(new Date(`${value.slice(0, 10)}T12:00:00`))
}

export function createAudit(entityType: string, entityId: string, action: string, description: string): AuditLog {
  return { id: makeId("audit"), userId: "local-user", entityType, entityId, action, description, createdAt: nowIso() }
}

/** Cor do selo de situação (OS, compras, financeiro, cadastros). */
export function statusColor(status: string) {
  if (["Ativo", "Ativa", "Disponível", "Disponivel", "Concluída", "Entregue", "Recebido", "Recebida", "Paga", "Realizada", "Realizado"].includes(status)) return "success"
  if (["Aberta", "Em análise", "Aguardando orçamento", "Aprovado", "Em execução", "Em conferência", "Em uso", "Rascunho", "Prevista", "Previsto"].includes(status)) return "default"
  if (["Aguardando aprovação", "Aguardando peças", "Suspensa", "Em manutenção", "Em manutencao", "Parcialmente recebido", "Parcialmente paga", "Parcialmente recebida", "Pendente", "Em férias", "Em revisao"].includes(status)) return "warning"
  if (["Cancelada", "Cancelado", "Inativo", "Inativa", "Bloqueado", "Vencida", "Vencido"].includes(status)) return "danger"
  return "muted"
}

export function defaultOperationalState(): OperationalState {
  return {
    clients: [],
    suppliers: [],
    providers: [],
    vehicles: [],
    vehicleMaintenance: [],
    materials: [],
    serviceOrders: [],
    systemUsers: [],
    auditLogs: [],
  }
}

/** Garante todas as listas (cache local antigo ou resposta parcial). */
export function migrateOperationalState(state: Partial<OperationalState>): OperationalState {
  const defaults = defaultOperationalState()
  return Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, Array.isArray((state as any)?.[key]) ? (state as any)[key] : value])) as unknown as OperationalState
}

function operationalStorageKey(companyId?: string) {
  return companyId ? `${OPERATIONAL_STORAGE_KEY}:${companyId}` : OPERATIONAL_STORAGE_KEY
}

export function loadOperationalState(companyId?: string): OperationalState {
  if (typeof window === "undefined") return defaultOperationalState()
  try {
    const stored = window.localStorage.getItem(operationalStorageKey(companyId))
    return stored ? migrateOperationalState(JSON.parse(stored)) : defaultOperationalState()
  } catch {
    return defaultOperationalState()
  }
}

export function saveOperationalState(state: OperationalState, companyId?: string) {
  if (typeof window === "undefined") return false
  try {
    window.localStorage.setItem(operationalStorageKey(companyId), JSON.stringify(state))
    return true
  } catch {
    // O cache do navegador não pode impedir a gravação no banco.
    try {
      window.localStorage.removeItem(operationalStorageKey(companyId))
    } catch {
      // Armazenamento pode estar desativado pelo navegador.
    }
    return false
  }
}
