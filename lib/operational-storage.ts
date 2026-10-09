export const OPERATIONAL_STORAGE_KEY = "mc-operational-crm.v2"

export type ClientType = "PF" | "PJ"
export type ClientStatus = "Ativo" | "Inativo" | "Prospect"
export type WorkStatus = "Ativa" | "Em execução" | "Pausada" | "Finalizada" | "Inativa"
export type ProviderStatus = "Ativo" | "Inativo" | "Em férias" | "Bloqueado"
export type VehicleStatus = "Disponível" | "Em uso" | "Em manutenção" | "Inativo"
export type TireCondition = "Novo" | "3/4 vida" | "Meia vida" | "1/4 vida" | "Solicitar troca"
export type ServiceOrderStatus =
  | "Criada"
  | "Agendada"
  | "A caminho"
  | "Em execução"
  | "Pausada"
  | "Aguardando material"
  | "Finalizada"
  | "Finalizada parcialmente"
  | "Aguardando retorno"
  | "Cancelada"
export type ChecklistStatus = "Pendente" | "Em andamento" | "Concluída" | "Não se aplica"
export type MaterialStatus = "Previsto" | "Solicitado" | "Separado" | "Retirado" | "Utilizado" | "Devolvido" | "Pendente"

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
  serviceContexts?: ServiceOrderKind[]
  monthlyPmocValue?: number
  status: ClientStatus
  notes: string
  createdAt: string
  updatedAt: string
}

export interface ClientContact {
  id: string
  clientId: string
  name: string
  role: string
  phone: string
  email: string
  main: boolean
  notes: string
}

export interface ClientEnvironment {
  id: string
  clientId: string
  name: string
  location: string
  floor: string
  activityType: string
  equipmentDescription: string
  thermalLoad: string
  occupantsTotal: number
  occupantsFixed: number
  occupantsFloating: number
  airConditionedArea: number
  notes: string
  status: "Ativo" | "Inativo"
  createdAt: string
  updatedAt: string
}

export interface ClientEquipment {
  id: string
  clientId: string
  clientEnvironmentId: string
  tag: string
  name: string
  type: string
  brand: string
  model: string
  serialNumber: string
  capacity: string
  notes: string
  status: "Ativo" | "Inativo"
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

export interface Work {
  id: string
  clientId: string
  uniqueNumber: string
  name: string
  type: string
  status: WorkStatus
  zipCode: string
  street: string
  number: string
  complement: string
  district: string
  city: string
  state: string
  responsibleName: string
  responsiblePhone: string
  responsibleEmail: string
  responsibleRole: string
  notes: string
  createdAt: string
  updatedAt: string
}

export interface WorkStructure {
  id: string
  workId: string
  location: string
  floor: string
  environment: string
  pointsQuantity: number
  requiredItems: string[]
  notes: string
  status: "Ativa" | "Inativa"
  createdAt: string
  updatedAt: string
}

export interface WorkFloor {
  id: string
  workId: string
  name: string
  status: "Ativo" | "Inativo"
  notes: string
  createdAt: string
  updatedAt: string
}

export interface WorkEnvironment {
  id: string
  workId: string
  floorId: string
  floor: string
  final: string
  environmentName: string
  serviceTypeId: string
  pointsQuantity: number
  notes: string
  status: "Ativo" | "Inativo"
  createdAt: string
  updatedAt: string
}

export interface EnvironmentPhoto {
  id: string
  environmentId: string
  fileName: string
  photoType: "Antes" | "Referência" | "Local de instalação" | "Problema encontrado" | "Outro"
  description: string
  uploadedBy: string
  createdAt: string
}

export interface WorkPoint {
  id: string
  workId: string
  environmentId: string
  pointNumber: number
  pointName: string
  serviceTypeId: string
  serviceTypeIds?: string[]
  kitId?: string
  kitName?: string
  status: "Ativo" | "Inativo" | "Pendente" | "Finalizado"
  equipmentExpected: string
  btus: string
  brand: string
  model: string
  serialNumber: string
  evaporatorLocation: string
  condenserLocation: string
  hasDrain: boolean
  hasElectricPoint: boolean
  hasPiping: boolean
  infrastructureMeasure: string
  measurementConfirmation: string
  technicalNotes: string
  createdAt: string
  updatedAt: string
}

export interface PointPhoto {
  id: string
  pointId: string
  fileName: string
  photoType: "Antes" | "Referência" | "Local de instalação" | "Problema encontrado" | "Outro"
  description: string
  uploadedBy: string
  createdAt: string
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

export interface ProviderDocument {
  id: string
  providerId: string
  type: string
  fileName: string
  notes: string
  createdAt: string
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
  composesKit: boolean
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
  createdAt: string
  updatedAt: string
}

export interface StockKit {
  id: string
  name: string
  description: string
  unitValue: number
  quantityInStock: number
  status: "Ativo" | "Inativo"
  notes: string
  createdAt: string
  updatedAt: string
}

export interface StockKitItem {
  id: string
  kitId: string
  materialId: string
  quantity: number
  unit: string
}

export interface ServiceTypeChecklistItem {
  id: string
  serviceTypeId: string
  taskName: string
  required: boolean
  requiresPhoto: boolean
  order: number
  notes: string
}

export interface ServiceTypeMaterial {
  id: string
  serviceTypeId: string
  materialId: string
  quantity: number
  unit: string
  required: boolean
}

export interface ServiceType {
  id: string
  name: string
  description: string
  status: "Ativo" | "Inativo"
  kitId?: string
  executionPercentage?: number
  periodicityMonths?: 1 | 2 | 3 | 6
  enabledContexts?: ServiceOrderKind[]
  requiredPhotos: string[]
  orientationVideoUrl: string
  orientationVideoDescription: string
  createdAt: string
  updatedAt: string
}

export type ServiceOrderKind = "obra" | "pmoc" | "servicos"
export type ServiceOrderCategory = "" | "Manutencao Preventiva" | "Instalacao" | "Manutencao Corretiva" | "Visita Tecnica"

export interface ServiceOrder {
  id: string
  orderNumber: string
  orderType: ServiceOrderKind
  serviceCategory: ServiceOrderCategory
  clientId: string
  workId: string
  clientEnvironmentId: string
  clientEquipmentId: string
  workStructureId: string
  floorId: string
  environmentId: string
  pointId: string
  simpleService: boolean
  serviceTypeId: string
  priority: "Baixa" | "Média" | "Alta" | "Urgente"
  description: string
  scheduledDate: string
  scheduledStartTime: string
  scheduledEndTime: string
  estimatedDuration: string
  allowReschedule: boolean
  scheduleNotes: string
  mainProviderId: string
  helperProviderId: string
  supervisorId: string
  vehicleId: string
  initialKm: number
  finalKm: number
  totalAmount: number
  paymentMethod?: string
  paymentType?: string
  paymentTerm?: string
  paymentDueDate?: string
  financialNotes?: string
  status: ServiceOrderStatus
  customerResponsibleName: string
  customerResponsiblePhone: string
  teamNotes: string
  notes: string
  pauseReason: string
  cancellationReason: string
  partialReason: string
  createdAt: string
  updatedAt: string
  finishedAt: string
  cancelledAt: string
}

export interface ServiceOrderEvent {
  id: string
  serviceOrderId: string
  stepName: string
  status: ServiceOrderStatus
  providerId: string
  eventDatetime: string
  latitude: string
  longitude: string
  notes: string
  fileId: string
  createdAt: string
}

export interface ChecklistItem {
  id: string
  serviceOrderId: string
  taskName: string
  required: boolean
  requiresPhoto: boolean
  status: ChecklistStatus
  responsibleProviderId: string
  notes: string
  completedAt: string
  createdAt: string
  updatedAt: string
}

export interface ServiceOrderMaterial {
  id: string
  serviceOrderId: string
  materialId: string
  itemName: string
  expectedQuantity: number
  usedQuantity: number
  unit: string
  status: MaterialStatus
  notes: string
  createdAt: string
  updatedAt: string
}

export interface ServiceOrderFile {
  id: string
  serviceOrderId: string
  category: string
  fileName: string
  fileUrl?: string
  fileType: string
  uploadedBy: string
  notes: string
  createdAt: string
}

export interface ServiceOrderSignature {
  id: string
  serviceOrderId: string
  responsibleName: string
  responsibleDocument: string
  signatureText: string
  rating: string
  customerNotes: string
  createdAt: string
}

export interface VehicleUsage {
  id: string
  vehicleId: string
  providerId: string
  serviceOrderId: string
  date: string
  initialKm: number
  finalKm: number
}

export interface VehicleChecklist {
  id: string
  serviceOrderId: string
  vehicleId: string
  providerId: string
  cleanlinessState: string
  conservationState: string
  frontRightTire: TireCondition
  frontLeftTire: TireCondition
  rearRightTire: TireCondition
  rearLeftTire: TireCondition
  mandatorySafetyItems: boolean
  oilLevel: string
  brakesTest: string
  windshieldWipers: string
  mirrors: string
  lights: string
  fuelLevel: string
  notes: string
  acceptedAt: string
  createdAt: string
  updatedAt: string
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

export interface OperationalStatus {
  id: string
  name: string
  color: string
  order: number
  finalStatus: boolean
  editable: boolean
  requiresReason: boolean
}

export interface ExecutionStep {
  id: string
  name: string
  order: number
  requiresPhoto: boolean
  requiresLocation: boolean
  requiresNotes: boolean
  changesStatusTo: ServiceOrderStatus
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

export interface CompanySettings {
  name: string
  cnpj: string
  phone: string
  email: string
  address: string
  logoName: string
  businessHours: string
  reportInfo: string
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

export type PmocFrequency = "Mensal" | "Bimestral" | "Trimestral" | "Semestral" | "Anual"
export type PmocScheduleStatus = "Planejado" | "OS aberta" | "Concluído" | "Cancelado"

export interface PmocPlan {
  id: string
  clientId: string
  workId: string
  name: string
  frequency: PmocFrequency
  startMonth: number
  startYear: number
  startDate: string
  endDate: string
  scheduleDay?: number
  mainProviderId?: string
  status: "Ativo" | "Inativo"
  paymentMethod?: string
  paymentType?: string
  paymentTerm?: string
  paymentDueDate?: string
  financialNotes?: string
  notes: string
  createdAt: string
  updatedAt: string
}

export interface PmocSector {
  id: string
  planId: string
  name: string
  floor: string
  notes: string
  status: "Ativo" | "Inativo"
  createdAt: string
  updatedAt: string
}

export interface PmocEquipment {
  id: string
  planId: string
  sectorId: string
  clientEnvironmentId?: string
  clientEquipmentId?: string
  tag: string
  name: string
  brand: string
  model: string
  serialNumber: string
  capacity: string
  location: string
  status: "Ativo" | "Inativo"
  notes: string
  createdAt: string
  updatedAt: string
}

export interface PmocEquipmentService {
  id: string
  planId: string
  equipmentId: string
  serviceTypeId: string
  createdAt: string
}

export interface PmocSchedule {
  id: string
  planId: string
  equipmentId: string
  serviceTypeId: string
  month: number
  year: number
  scheduledDate: string
  serviceOrderId: string
  status: PmocScheduleStatus
  createdAt: string
  updatedAt: string
}

export interface OperationalState {
  clients: Client[]
  clientContacts: ClientContact[]
  clientEnvironments: ClientEnvironment[]
  clientEquipment: ClientEquipment[]
  suppliers: Supplier[]
  works: Work[]
  workStructures: WorkStructure[]
  workFloors: WorkFloor[]
  workEnvironments: WorkEnvironment[]
  environmentPhotos: EnvironmentPhoto[]
  workPoints: WorkPoint[]
  pointPhotos: PointPhoto[]
  serviceOrders: ServiceOrder[]
  serviceOrderEvents: ServiceOrderEvent[]
  checklistItems: ChecklistItem[]
  serviceOrderMaterials: ServiceOrderMaterial[]
  serviceOrderFiles: ServiceOrderFile[]
  serviceOrderSignatures: ServiceOrderSignature[]
  providers: Provider[]
  providerDocuments: ProviderDocument[]
  vehicles: Vehicle[]
  vehicleUsage: VehicleUsage[]
  vehicleChecklists: VehicleChecklist[]
  vehicleMaintenance: VehicleMaintenance[]
  serviceTypes: ServiceType[]
  serviceTypeChecklistItems: ServiceTypeChecklistItem[]
  serviceTypeMaterials: ServiceTypeMaterial[]
  materials: Material[]
  stockKits: StockKit[]
  stockKitItems: StockKitItem[]
  statuses: OperationalStatus[]
  executionSteps: ExecutionStep[]
  systemUsers: SystemUser[]
  companySettings: CompanySettings
  auditLogs: AuditLog[]
  pmocPlans: PmocPlan[]
  pmocSectors: PmocSector[]
  pmocEquipment: PmocEquipment[]
  pmocEquipmentServices: PmocEquipmentService[]
  pmocSchedules: PmocSchedule[]
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
  return new Intl.DateTimeFormat("pt-BR").format(new Date(`${value}T12:00:00`))
}

export function createAudit(entityType: string, entityId: string, action: string, description: string): AuditLog {
  return { id: makeId("audit"), userId: "local-user", entityType, entityId, action, description, createdAt: nowIso() }
}

export function nextWorkNumber(state: OperationalState) {
  return `OB-${String(1000 + state.works.length + 1).padStart(4, "0")}`
}

export function nextOrderNumber(state: OperationalState) {
  const highestNumber = state.serviceOrders.reduce((highest, order) => {
    const match = /^OS-(\d+)$/i.exec(String(order.orderNumber || "").trim())
    return match ? Math.max(highest, Number(match[1])) : highest
  }, 2000)
  return `OS-${String(highestNumber + 1).padStart(4, "0")}`
}

export function statusColor(status: string) {
  if (["Ativo", "Ativa", "Disponível", "Finalizada", "Concluída", "Realizada"].includes(status)) return "success"
  if (["Criada", "Agendada", "A caminho", "Em execução", "Em uso", "Separado", "Retirado"].includes(status)) return "default"
  if (["Pausada", "Aguardando material", "Em manutenção", "Previsto", "Solicitado", "Pendente", "Em férias"].includes(status)) return "warning"
  if (["Cancelada", "Inativo", "Bloqueado"].includes(status)) return "danger"
  return "muted"
}

export function hydrateServiceOrderFromType(state: OperationalState, serviceOrderId: string, serviceTypeId: string) {
  const now = nowIso()
  const checklist = state.serviceTypeChecklistItems
    .filter((item) => item.serviceTypeId === serviceTypeId)
    .sort((a, b) => a.order - b.order)
    .map<ChecklistItem>((item) => ({
      id: makeId("check"),
      serviceOrderId,
      taskName: item.taskName,
      required: item.required,
      requiresPhoto: item.requiresPhoto,
      status: "Pendente",
      responsibleProviderId: "",
      notes: item.notes,
      completedAt: "",
      createdAt: now,
      updatedAt: now,
    }))
  const type = state.serviceTypes.find((item) => item.id === serviceTypeId)
  const kitMaterials = type?.kitId
    ? (state.stockKitItems || []).filter((item) => item.kitId === type.kitId).map<ServiceTypeMaterial>((item) => ({
        id: item.id,
        serviceTypeId,
        materialId: item.materialId,
        quantity: item.quantity,
        unit: item.unit,
        required: true,
      }))
    : []
  const materials = [...state.serviceTypeMaterials.filter((item) => item.serviceTypeId === serviceTypeId), ...kitMaterials]
    .map<ServiceOrderMaterial>((item) => {
      const material = state.materials.find((m) => m.id === item.materialId)
      return {
        id: makeId("osmat"),
        serviceOrderId,
        materialId: item.materialId,
        itemName: material?.name || "Material",
        expectedQuantity: item.quantity,
        usedQuantity: 0,
        unit: item.unit,
        status: "Previsto",
        notes: item.required ? "Obrigatório" : "",
        createdAt: now,
        updatedAt: now,
      }
    })
  return { checklist, materials }
}

export function canFinishServiceOrder(state: OperationalState, order: ServiceOrder) {
  const requiredPhotos = ["Foto Final"]
  const uploadedCategories = state.serviceOrderFiles.filter((file) => file.serviceOrderId === order.id).map((file) => file.category)
  const missingPhotos = requiredPhotos.filter((category) => !uploadedCategories.includes(category))
  return { ok: missingPhotos.length === 0, missingChecklist: [] as ChecklistItem[], missingPhotos }
}

export function pointFromEnvironment(environment: WorkEnvironment, pointNumber: number, now = nowIso()): WorkPoint {
  return {
    id: `${environment.id}-point-${pointNumber}`,
    workId: environment.workId,
    environmentId: environment.id,
    pointNumber,
    pointName: `Ponto ${pointNumber}`,
    serviceTypeId: environment.serviceTypeId,
    status: "Ativo",
    equipmentExpected: "",
    btus: "",
    brand: "",
    model: "",
    serialNumber: "",
    evaporatorLocation: "",
    condenserLocation: "",
    hasDrain: false,
    hasElectricPoint: false,
    hasPiping: false,
    infrastructureMeasure: "",
    measurementConfirmation: "",
    technicalNotes: "",
    createdAt: now,
    updatedAt: now,
  }
}

export function migrateOperationalState(state: OperationalState): OperationalState {
  const now = nowIso()
  const sourceFloors = state.workFloors || []
  const workEnvironments = state.workEnvironments?.length ? state.workEnvironments : (state.workStructures || []).map<WorkEnvironment>((structure) => ({
    id: `env-${structure.id}`,
    workId: structure.workId,
    floorId: "",
    floor: structure.floor,
    final: structure.location || "A",
    environmentName: structure.environment,
    serviceTypeId: state.serviceOrders.find((order) => order.workStructureId === structure.id)?.serviceTypeId || state.serviceTypes[0]?.id || "",
    pointsQuantity: structure.pointsQuantity || 1,
    notes: structure.notes,
    status: structure.status === "Inativa" ? "Inativo" : "Ativo",
    createdAt: structure.createdAt,
    updatedAt: structure.updatedAt,
  }))
  const generatedFloors = workEnvironments
    .filter((environment) => !sourceFloors.some((floor) => floor.workId === environment.workId && floor.name === environment.floor))
    .map<WorkFloor>((environment) => ({
      id: `floor-${environment.workId}-${environment.floor}`.replace(/\s+/g, "-").toLowerCase(),
      workId: environment.workId,
      name: environment.floor,
      status: "Ativo",
      notes: "",
      createdAt: environment.createdAt || now,
      updatedAt: environment.updatedAt || now,
    }))
  const workFloors = [...sourceFloors, ...generatedFloors]
  const normalizedEnvironments = workEnvironments.map((environment) => {
    const floor = workFloors.find((item) => item.id === environment.floorId) || workFloors.find((item) => item.workId === environment.workId && item.name === environment.floor)
    return { ...environment, floorId: environment.floorId || floor?.id || "" }
  })
  const workPoints = state.workPoints?.length ? state.workPoints : normalizedEnvironments.flatMap((environment) => Array.from({ length: Math.max(1, environment.pointsQuantity || 1) }, (_, index) => pointFromEnvironment(environment, index + 1, now)))
  const serviceOrders = (state.serviceOrders || []).map((order) => {
    const environment = normalizedEnvironments.find((item) => item.id === (order as any).environmentId) || normalizedEnvironments.find((item) => item.id === `env-${order.workStructureId}`) || normalizedEnvironments.find((item) => item.workId === order.workId)
    const point = workPoints.find((item) => item.id === (order as any).pointId) || workPoints.find((item) => item.environmentId === environment?.id)
    return { ...order, orderType: (order as any).orderType || "obra", serviceCategory: (order as any).serviceCategory || "", clientEnvironmentId: (order as any).clientEnvironmentId || "", clientEquipmentId: (order as any).clientEquipmentId || "", floorId: (order as any).floorId || environment?.floorId || "", environmentId: (order as any).environmentId || environment?.id || "", pointId: (order as any).pointId || point?.id || "", totalAmount: Number((order as any).totalAmount || 0), paymentMethod: (order as any).paymentMethod || "", paymentType: (order as any).paymentType || "", paymentTerm: (order as any).paymentTerm || "", paymentDueDate: (order as any).paymentDueDate || "", financialNotes: (order as any).financialNotes || "" }
  })
  return {
    ...state,
    vehicles: (state.vehicles || []).map((vehicle) => ({
      ...vehicle,
      frontRightTire: (vehicle as any).frontRightTire || "Meia vida",
      frontLeftTire: (vehicle as any).frontLeftTire || "Meia vida",
      rearRightTire: (vehicle as any).rearRightTire || "Meia vida",
      rearLeftTire: (vehicle as any).rearLeftTire || "Meia vida",
      lastOilChangeDate: (vehicle as any).lastOilChangeDate || "",
      lastOilChangeKm: Number((vehicle as any).lastOilChangeKm || 0),
    })),
    vehicleChecklists: state.vehicleChecklists || [],
    materials: (state.materials || []).map((material) => ({
      ...material,
      currentStock: (material as any).currentStock ?? material.minimumStock ?? 0,
      composesKit: Boolean((material as any).composesKit ?? false),
    })),
    stockKits: (state.stockKits || []).map((kit) => ({
      ...kit,
      unitValue: Number((kit as any).unitValue || 0),
      quantityInStock: Number((kit as any).quantityInStock || 0),
    })),
    stockKitItems: state.stockKitItems || [],
    clientEnvironments: state.clientEnvironments || [],
    clientEquipment: state.clientEquipment || [],
    suppliers: state.suppliers || [],
    pmocPlans: state.pmocPlans || [],
    pmocSectors: state.pmocSectors || [],
    pmocEquipment: state.pmocEquipment || [],
    pmocEquipmentServices: state.pmocEquipmentServices || [],
    pmocSchedules: state.pmocSchedules || [],
    workFloors,
    workEnvironments: normalizedEnvironments,
    environmentPhotos: state.environmentPhotos || [],
    workPoints,
    pointPhotos: state.pointPhotos || [],
    serviceOrders,
  }
}

export function defaultOperationalState(): OperationalState {
  const now = nowIso()
  const clientId = "client-vista-sul"
  const workId = "work-1042"
  const structureId = "structure-sala-301"
  const floorId = "floor-torre-a-3"
  const environmentId = "env-sala-301"
  const pointId = "point-sala-301-1"
  const providerId = "provider-carlos"
  const helperId = "provider-rafaela"
  const vehicleId = "vehicle-abc"
  const materialTubing = "mat-tubing"
  const materialSupport = "mat-support"
  const serviceTypeId = "stype-install"
  const orderId = "order-2031"

  const statuses: ServiceOrderStatus[] = ["Criada", "Agendada", "A caminho", "Em execução", "Pausada", "Aguardando material", "Finalizada", "Cancelada"]
  const steps = [
    ["Saída da empresa", "A caminho"],
    ["Chegada ao cliente", "A caminho"],
    ["Início do serviço", "Em execução"],
    ["Pausa", "Pausada"],
    ["Retorno do almoço/pausa", "Em execução"],
    ["Finalização", "Finalizada"],
    ["Saída do cliente", "Finalizada"],
    ["Chegada à empresa", "Finalizada"],
  ] as Array<[string, ServiceOrderStatus]>

  return {
    clients: [{
      id: clientId, type: "PJ", name: "Condomínio Vista Sul", document: "12.345.678/0001-90", corporateName: "Condomínio Vista Sul", tradeName: "Vista Sul", stateRegistration: "", responsibleName: "Marcos Lima", phone: "(11) 3333-0000", mobile: "(11) 99999-0000", email: "adm@vistasul.com", zipCode: "01000-000", street: "Av. Brasil", number: "1200", complement: "", district: "Centro", city: "São Paulo", state: "SP", status: "Ativo", notes: "Cliente recorrente", createdAt: now, updatedAt: now,
    }],
    clientContacts: [{ id: "contact-1", clientId, name: "Marcos Lima", role: "Síndico", phone: "(11) 99999-0000", email: "marcos@vistasul.com", main: true, notes: "" }],
    clientEnvironments: [],
    clientEquipment: [],
    suppliers: [],
    pmocPlans: [],
    pmocSectors: [],
    pmocEquipment: [],
    pmocEquipmentServices: [],
    pmocSchedules: [],
    works: [{
      id: workId, clientId, uniqueNumber: "OB-1042", name: "Torre A - Retrofit", type: "Condomínio", status: "Ativa", zipCode: "01000-000", street: "Av. Brasil", number: "1200", complement: "Torre A", district: "Centro", city: "São Paulo", state: "SP", responsibleName: "Marcos Lima", responsiblePhone: "(11) 99999-0000", responsibleEmail: "marcos@vistasul.com", responsibleRole: "Síndico", notes: "Acesso liberado pela portaria", createdAt: now, updatedAt: now,
    }],
    workStructures: [{ id: structureId, workId, location: "Torre A", floor: "3º andar", environment: "Sala 301", pointsQuantity: 4, requiredItems: ["Tubulação", "Dreno", "Suporte", "Elétrica"], notes: "", status: "Ativa", createdAt: now, updatedAt: now }],
    workFloors: [{ id: floorId, workId, name: "3º andar", status: "Ativo", notes: "", createdAt: now, updatedAt: now }],
    workEnvironments: [{ id: environmentId, workId, floorId, floor: "3Âº andar", final: "A", environmentName: "Sala 301", serviceTypeId, pointsQuantity: 4, notes: "", status: "Ativo", createdAt: now, updatedAt: now }],
    environmentPhotos: [],
    workPoints: [1, 2, 3, 4].map((number) => ({ ...pointFromEnvironment({ id: environmentId, workId, floorId, floor: "3Âº andar", final: "A", environmentName: "Sala 301", serviceTypeId, pointsQuantity: 4, notes: "", status: "Ativo", createdAt: now, updatedAt: now }, number, now), id: number === 1 ? pointId : `point-sala-301-${number}` })),
    pointPhotos: [],
    providers: [
      { id: providerId, fullName: "Carlos Lima", cpf: "111.222.333-44", rg: "12.345.678-9", birthDate: "1990-01-10", phone: "(11) 98888-1010", email: "carlos@empresa.com", zipCode: "02000-000", street: "Rua Azul", number: "10", complement: "", district: "Centro", city: "São Paulo", state: "SP", role: "Instalador", relationshipType: "Funcionário", status: "Ativo", notes: "", createdAt: now, updatedAt: now },
      { id: helperId, fullName: "Rafaela Souza", cpf: "222.333.444-55", rg: "22.333.444-5", birthDate: "1992-03-18", phone: "(11) 97777-2020", email: "rafaela@empresa.com", zipCode: "03000-000", street: "Rua Verde", number: "20", complement: "", district: "Centro", city: "São Paulo", state: "SP", role: "Técnico", relationshipType: "Funcionário", status: "Ativo", notes: "", createdAt: now, updatedAt: now },
    ],
    providerDocuments: [],
    vehicles: [{ id: vehicleId, plate: "ABC-1D23", model: "Fiorino", brand: "Fiat", year: "2022", color: "Branca", currentKm: 42180, frontRightTire: "Meia vida", frontLeftTire: "Meia vida", rearRightTire: "3/4 vida", rearLeftTire: "3/4 vida", lastOilChangeDate: "2026-03-20", lastOilChangeKm: 39800, status: "Em uso", renavam: "123456789", licensingDueDate: "2026-12-31", insuranceInfo: "Seguro ativo", notes: "", createdAt: now, updatedAt: now }],
    materials: [
      { id: materialTubing, name: "Tubulação cobre", category: "Instalação", unit: "metro", internalCode: "MAT-001", minimumStock: 20, currentStock: 80, composesKit: true, status: "Ativo", notes: "", createdAt: now, updatedAt: now },
      { id: materialSupport, name: "Suporte condensadora", category: "Fixação", unit: "unidade", internalCode: "MAT-002", minimumStock: 5, currentStock: 12, composesKit: true, status: "Ativo", notes: "", createdAt: now, updatedAt: now },
    ],
    stockKits: [],
    stockKitItems: [],
    serviceTypes: [{ id: serviceTypeId, name: "Instalação", description: "Instalação de equipamento", status: "Ativo", executionPercentage: 100, requiredPhotos: ["Foto Final"], orientationVideoUrl: "", orientationVideoDescription: "", createdAt: now, updatedAt: now }],
    serviceTypeChecklistItems: [
      { id: "stcheck-1", serviceTypeId, taskName: "Conferir equipamento", required: true, requiresPhoto: false, order: 1, notes: "" },
      { id: "stcheck-2", serviceTypeId, taskName: "Verificar local de instalação", required: true, requiresPhoto: true, order: 2, notes: "" },
      { id: "stcheck-3", serviceTypeId, taskName: "Instalar equipamento", required: true, requiresPhoto: true, order: 3, notes: "" },
      { id: "stcheck-4", serviceTypeId, taskName: "Testar funcionamento", required: true, requiresPhoto: false, order: 4, notes: "" },
      { id: "stcheck-5", serviceTypeId, taskName: "Coletar assinatura", required: true, requiresPhoto: false, order: 5, notes: "" },
    ],
    serviceTypeMaterials: [
      { id: "stmat-1", serviceTypeId, materialId: materialTubing, quantity: 15, unit: "metro", required: true },
      { id: "stmat-2", serviceTypeId, materialId: materialSupport, quantity: 2, unit: "unidade", required: true },
    ],
    serviceOrders: [{
      id: orderId, orderNumber: "OS-2031", orderType: "obra", serviceCategory: "", clientId, workId, clientEnvironmentId: "", clientEquipmentId: "", workStructureId: structureId, floorId, environmentId, pointId, simpleService: false, serviceTypeId, priority: "Alta", description: "Instalar evaporadora na sala 301", scheduledDate: today(), scheduledStartTime: "08:00", scheduledEndTime: "12:00", estimatedDuration: "4h", allowReschedule: true, scheduleNotes: "", mainProviderId: providerId, helperProviderId: helperId, supervisorId: "", vehicleId, initialKm: 42180, finalKm: 0, totalAmount: 0, status: "Em execução", customerResponsibleName: "Marcos Lima", customerResponsiblePhone: "(11) 99999-0000", teamNotes: "Levar escada", notes: "", pauseReason: "", cancellationReason: "", partialReason: "", createdAt: now, updatedAt: now, finishedAt: "", cancelledAt: "",
    }],
    serviceOrderEvents: [{ id: "event-1", serviceOrderId: orderId, stepName: "Início do serviço", status: "Em execução", providerId, eventDatetime: now, latitude: "", longitude: "", notes: "", fileId: "", createdAt: now }],
    checklistItems: [
      { id: "check-1", serviceOrderId: orderId, taskName: "Conferir equipamento", required: true, requiresPhoto: false, status: "Concluída", responsibleProviderId: providerId, notes: "", completedAt: now, createdAt: now, updatedAt: now },
      { id: "check-2", serviceOrderId: orderId, taskName: "Verificar local de instalação", required: true, requiresPhoto: true, status: "Em andamento", responsibleProviderId: providerId, notes: "", completedAt: "", createdAt: now, updatedAt: now },
    ],
    serviceOrderMaterials: [{ id: "osmat-1", serviceOrderId: orderId, materialId: materialTubing, itemName: "Tubulação cobre", expectedQuantity: 15, usedQuantity: 0, unit: "metro", status: "Separado", notes: "", createdAt: now, updatedAt: now }],
    serviceOrderFiles: [{ id: "file-1", serviceOrderId: orderId, category: "Foto Final", fileName: "foto-final-sala-301.jpg", fileType: "image", uploadedBy: providerId, notes: "", createdAt: now }],
    serviceOrderSignatures: [],
    vehicleUsage: [{ id: "vuse-1", vehicleId, providerId, serviceOrderId: orderId, date: today(), initialKm: 42180, finalKm: 42236 }],
    vehicleChecklists: [],
    vehicleMaintenance: [],
    statuses: statuses.map((name, index) => ({ id: `status-${index}`, name, color: "#2563EB", order: index + 1, finalStatus: ["Finalizada", "Cancelada"].includes(name), editable: true, requiresReason: ["Pausada", "Cancelada"].includes(name) })),
    executionSteps: steps.map(([name, changesStatusTo], index) => ({ id: `step-${index}`, name, order: index + 1, requiresPhoto: false, requiresLocation: false, requiresNotes: ["Pausa"].includes(name), changesStatusTo })),
    systemUsers: [
      { id: "sys-admin", name: "Administrador", email: "admin@empresa.com", phone: "(11) 99999-0000", profile: "Administrador", temporaryPassword: "123456", status: "Ativo", permissions: ["Acesso total", "Ver relatórios", "Acessar configurações"] },
      { id: "sys-tech", name: "Carlos Lima", email: "carlos@empresa.com", phone: "(11) 98888-1010", profile: "Técnico", temporaryPassword: "123456", status: "Ativo", permissions: ["Ver suas OS", "Executar etapas", "Enviar fotos"] },
    ],
    companySettings: { name: "M & C Climatização", cnpj: "", phone: "", email: "", address: "", logoName: "", businessHours: "08:00 às 18:00", reportInfo: "" },
    auditLogs: [createAudit("service_order", orderId, "Criada", "OS demonstrativa criada")],
  }
}

function operationalStorageKey(companyId?: string) {
  return companyId ? `${OPERATIONAL_STORAGE_KEY}:${companyId}` : OPERATIONAL_STORAGE_KEY
}

export function loadOperationalState(companyId?: string): OperationalState {
  if (typeof window === "undefined") return migrateOperationalState(defaultOperationalState())
  try {
    const key = operationalStorageKey(companyId)
    const stored = window.localStorage.getItem(key)
    if (!stored) {
      const initial = migrateOperationalState(defaultOperationalState())
      window.localStorage.setItem(key, JSON.stringify(initial))
      return initial
    }
    return migrateOperationalState({ ...defaultOperationalState(), ...JSON.parse(stored) })
  } catch {
    return migrateOperationalState(defaultOperationalState())
  }
}

export function saveOperationalState(state: OperationalState, companyId?: string) {
  if (typeof window === "undefined") return false
  try {
    const key = operationalStorageKey(companyId)
    window.localStorage.setItem(key, JSON.stringify(state))
    return true
  } catch {
    // The browser cache must not prevent the subsequent database request.
    try {
      window.localStorage.removeItem(operationalStorageKey(companyId))
    } catch {
      // Storage may be disabled entirely by the browser.
    }
    return false
  }
}
