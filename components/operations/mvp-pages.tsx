"use client"

import type React from "react"
import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import * as XLSX from "xlsx"
import {
  AlertTriangle,
  BarChart3,
  Building2,
  CalendarDays,
  Camera,
  Car,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  FileBarChart,
  FileUp,
  HardHat,
  Images,
  ListChecks,
  MapPin,
  Package,
  Plus,
  Printer,
  Search,
  Settings2,
  Share2,
  UserPlus,
  Users,
  Wrench,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TableCell, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { createClient as createBrowserSupabaseClient } from "@/lib/supabase/client"
import { useAuth } from "@/lib/auth-context"
import { pagePermissionLabels, type PagePermission } from "@/lib/types"
import { sortServiceOrdersByNewestCreation, sortServiceOrdersByNewestScheduledDate } from "@/lib/field-service-order-sort"
import { budgetKitsForPoints, budgetKitsForWork, mergeStoredAndBudgetKits } from "@/lib/order-budget-kits"
import { compareAlphaNumeric, sortChoiceOptions } from "@/lib/utils"
import { cnpjRegistrationNotes, cleanCpfCnpj, formatCpfCnpjDocument, type CnpjCompany } from "@/lib/cnpj-lookup"
import { buildPmocAnnualReport, PMOC_LEGAL_REFERENCE, renderPmocAnnualReportHtml } from "@/lib/pmoc-annual-report"
import { calculateKitComposition, calculateKitMaterialQuantity, inferKitMeters, kitMaterialRule, kitMaterialRuleLabel, parseKitDefinition, parseKitMeters } from "@/lib/stock-kit-calculation"
import { buildServiceOrderPhotoCaption } from "@/lib/service-order-photo-caption"
import { materialOriginOptions, materialSpedItemTypeOptions } from "@/lib/material-fields"
import { EquipmentQrDialog } from "./equipment-qr-dialog"
import { MaterialFormFields, emptyMaterialForm, materialFormFromItem, materialRecordFromForm, validateMaterialForm } from "@/components/catalog/product-form"
import { InventoryTab, MovementSheet, MovementsTab, PurchaseSuggestionTab, ReservationsTab, StockAlertBanner, WarehousesTab, materialAvailable, needsReplenishment, useWarehouses } from "./stock-erp"
import { SystemCompaniesManager } from "@/components/system-companies-manager"
import {
  type ChecklistItem,
  type Client,
  type ClientEnvironment,
  type ClientEquipment,
  type Material,
  type OperationalState,
  type Provider,
  type ServiceOrder,
  type ServiceOrderEvent,
  type ServiceOrderFile,
  type ServiceOrderMaterial,
  type ServiceOrderKind,
  type ServiceOrderStatus,
  type Supplier,
  type Vehicle,
  type VehicleChecklist,
  type Work,
  type WorkEnvironment,
  type WorkFloor,
  type WorkPoint,
  type WorkStructure,
  formatDate,
  hydrateServiceOrderFromType,
  makeId,
  nextOrderNumber,
  nextWorkNumber,
  nowIso,
  pointFromEnvironment,
  saveOperationalState,
  today,
} from "@/lib/operational-storage"
import {
  AlertRow,
  ConfirmInline,
  DataTable,
  FormSheet,
  MetricCard,
  PageShell,
  SaveButton,
  SearchableSelectField,
  SectionCard,
  SelectField,
  StatusBadge,
  TextAreaField,
  TextField,
  appendAudit,
  fullAddress,
  names,
  useCrudFeedback,
  useGo,
  useOperationalStore,
} from "./shared"

type SheetKind = "client" | "clientEnvironment" | "clientEquipment" | "supplier" | "work" | "floor" | "structure" | "provider" | "vehicle" | "order" | "material" | "serviceType" | "user" | "maintenance" | "usage" | ""

const selectablePagePermissions: PagePermission[] = [
  "dashboard",
  "clientes_obras",
  "ordens_servico",
  "frota",
  "estoque",
  "compras",
  "financeiro",
  "comercial",
  "orcamento",
  "contratos",
  "relatorios",
  "configuracoes",
]

const clientDefaultPermissions: PagePermission[] = []

function budgetMetaValue(notes: string | undefined, key: string) {
  const match = String(notes || "").match(new RegExp(`__budget_${key}:([^\\n]+)`))
  return match?.[1]?.trim() || ""
}

function uniqueByValue<T extends { value: string }>(items: T[]) {
  const map = new Map<string, T>()
  items.forEach((item) => {
    if (item.value && !map.has(item.value)) map.set(item.value, item)
  })
  return Array.from(map.values())
}

function normalizeClientImportKey(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeClientDocument(value: unknown) {
  return String(value || "").replace(/\D/g, "")
}

function cleanSpreadsheetValue(value: unknown) {
  const text = String(value || "").replace(/\s+/g, " ").trim()
  return /^-+$/.test(text) ? "" : text
}

function spreadsheetValue(row: Record<string, unknown>, expectedHeader: string) {
  const normalizedHeader = normalizeClientImportKey(expectedHeader).replace(/[^a-z0-9]/g, "")
  const entry = Object.entries(row).find(([header]) => normalizeClientImportKey(header).replace(/[^a-z0-9]/g, "") === normalizedHeader)
  return cleanSpreadsheetValue(entry?.[1])
}

function importedServiceContexts(value: unknown): ServiceOrderKind[] {
  const normalized = normalizeClientImportKey(value)
  const contexts: ServiceOrderKind[] = []
  if (normalized.includes("obra")) contexts.push("obra")
  if (normalized.includes("pmoc")) contexts.push("pmoc")
  if (normalized.includes("servico")) contexts.push("servicos")
  return contexts
}

function streetWithoutRepeatedNumber(street: string, number: string) {
  if (!street || !number) return street
  const escapedNumber = number.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return street.replace(new RegExp(`\\s*,?\\s*${escapedNumber}\\s*$`, "i"), "").trim()
}

function parseStructuredClientRow(row: Record<string, unknown>) {
  const document = spreadsheetValue(row, "CNPJ") || spreadsheetValue(row, "CPF/CNPJ")
  const name = spreadsheetValue(row, "Nome/Razão social")
  if (!document || !name) return null
  const number = spreadsheetValue(row, "NÚMERO") || spreadsheetValue(row, "Numero")
  const rawStreet = spreadsheetValue(row, "Endereço")
  const phone = spreadsheetValue(row, "Telefone/Celular")
  return {
    type: spreadsheetValue(row, "Tipo").toUpperCase() === "PF" ? "PF" as const : "PJ" as const,
    name,
    document,
    corporateName: spreadsheetValue(row, "Razão Social/Nome Social") || name,
    tradeName: spreadsheetValue(row, "Nome/Nome Fantasia") || name,
    phone,
    mobile: phone,
    email: spreadsheetValue(row, "E-mail"),
    zipCode: spreadsheetValue(row, "CEP"),
    street: streetWithoutRepeatedNumber(rawStreet, number),
    number,
    complement: spreadsheetValue(row, "Complemento"),
    district: spreadsheetValue(row, "Bairro"),
    city: spreadsheetValue(row, "Cidade"),
    state: spreadsheetValue(row, "Estado").toUpperCase(),
    serviceContexts: importedServiceContexts(spreadsheetValue(row, "TIPO SERVIÇO")),
  }
}

function splitCodeName(value: unknown) {
  const text = String(value || "").replace(/\s+/g, " ").trim()
  const match = text.match(/^([A-Za-z0-9.]+)\s*-\s*(.+)$/)
  return match ? { tag: match[1].trim(), name: match[2].trim() } : { tag: "", name: text }
}

function importedEquipmentCapacity(value: unknown) {
  const text = String(value || "").replace(/\s+/g, " ").trim()
  const match = text.match(/(\d{1,3}(?:[.\s]\d{3})+|\d+)\s*BTU(?:S|\/H)?/i)
  const compactMatch = text.match(/\b(7|9|10|12|18|20|22|24|28|30|32|36|42|46|48|54|55|60)\s*K(?:\s*BTU(?:S|\/H)?)?\b/i)
  const inferredMatch = text.match(/\b(\d{1,3}[.]\d{3})\b/)
  const btu = match
    ? Number(match[1].replace(/\D/g, ""))
    : compactMatch
      ? Number(compactMatch[1]) * 1000
      : inferredMatch
        ? Number(inferredMatch[1].replace(/\D/g, ""))
        : 0
  if (!btu) return { label: "", btu: 0 }
  return { label: `${btu.toLocaleString("pt-BR")} BTU/h`, btu }
}

function importedEquipmentMetadata(value: unknown) {
  const text = normalizeClientImportKey(value)
  const brands = ["SPRINGER MIDEA", "MITSUBISHI", "ELECTROLUX", "SPRINGER", "CARRIER", "FUJITSU", "SAMSUNG", "AGRATTO", "HITACHI", "KOMECO", "PHILCO", "DAIKIN", "ELGIN", "MIDEA", "GREE", "TRANE", "YORK", "CONSUL", "BRASTEMP", "TCL", "LG"]
  const brand = brands.find((item) => new RegExp(`\\b${item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) || ""
  if (/DUTAD/.test(text)) return { type: "Split", brand, model: "Dutado" }
  if (/PISO\s*TETO|\bPT\b/.test(text)) return { type: "Split", brand, model: "Piso Teto" }
  if (/HI\s*WALL|HIGH\s*WALL|\bHW\b/.test(text)) return { type: "Split", brand, model: "Hi Wall" }
  if (/\bK7\b|CASSET/.test(text)) return { type: "Split", brand, model: "Cassete" }
  if (/\bVRF\b/.test(text)) return { type: "VRF", brand, model: "VRF" }
  if (/JANELA|\bACJ\b/.test(text)) return { type: "Ar-condicionado", brand, model: "Janela" }
  if (/FAN\s*COIL/.test(text)) return { type: "Fan Coil", brand, model: "Fan Coil" }
  if (/CHILLER/.test(text)) return { type: "Chiller", brand, model: "Chiller" }
  if (/SPLIT/.test(text)) return { type: "Split", brand, model: "Split" }
  return { type: "Ar-condicionado", brand, model: "" }
}

function parseClientEquipmentRow(row: Array<string | number>) {
  const cells = row.map((cell) => String(cell || "").replace(/\s+/g, " ").trim())
  if (normalizeClientImportKey(cells[0]) === "cliente" && normalizeClientImportKey(cells[1]).includes("ambiente")) return null
  if (cells.length >= 5 && cells[0] && cells[1] && cells[3]) {
    const capacity = importedEquipmentCapacity(cells[3])
    const metadata = importedEquipmentMetadata(cells[3])
    return {
      clientName: cells[0],
      environmentCode: cells[2],
      environmentName: cells[1].replace(new RegExp(`^${cells[2].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*-?\\s*`, "i"), "").trim() || cells[1],
      environmentRaw: cells[1],
      equipmentTag: cells[4],
      equipmentName: cells[3],
      equipmentRaw: cells[3],
      equipmentCapacity: capacity.label,
      equipmentCapacityBtu: capacity.btu,
      ...metadata,
    }
  }
  const text = row.map((cell) => String(cell || "").trim()).filter(Boolean).join(" / ").trim()
  if (!text) return null
  const parts = text.split("/").map((part) => part.trim()).filter(Boolean)
  if (parts.length < 3) return null
  const clientName = parts[0]
  const equipmentRaw = parts[parts.length - 1]
  const environmentRaw = parts.slice(1, -1).join(" / ")
  const capacity = importedEquipmentCapacity(equipmentRaw)
  const metadata = importedEquipmentMetadata(equipmentRaw)
  return {
    clientName,
    environmentCode: "",
    environmentName: environmentRaw,
    environmentRaw,
    equipmentTag: "",
    equipmentName: equipmentRaw,
    equipmentRaw,
    equipmentCapacity: capacity.label,
    equipmentCapacityBtu: capacity.btu,
    ...metadata,
  }
}

const PHOTO_CATEGORIES = ["Foto Inicial", "Foto Adicional 1", "Foto Adicional 2", "Foto Adicional 3", "Foto Final"] as const
type OrderPhotoCategory = typeof PHOTO_CATEGORIES[number]
const REQUIRED_PHOTO_CATEGORIES: OrderPhotoCategory[] = ["Foto Inicial", "Foto Final"]
const MAX_PROXY_PHOTO_SIZE = 2.5 * 1024 * 1024

async function loadPhotoImage(file: File) {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file)
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw: (context: CanvasRenderingContext2D, width: number, height: number) => context.drawImage(bitmap, 0, 0, width, height),
        close: () => bitmap.close(),
      }
    } catch {}
  }

  const objectUrl = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error("O navegador nao conseguiu abrir esta imagem."))
      element.src = objectUrl
    })
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      draw: (context: CanvasRenderingContext2D, width: number, height: number) => context.drawImage(image, 0, 0, width, height),
      close: () => URL.revokeObjectURL(objectUrl),
    }
  } catch (error) {
    URL.revokeObjectURL(objectUrl)
    throw error
  }
}

async function optimizePhotoForUpload(file: File) {
  if (file.size <= MAX_PROXY_PHOTO_SIZE) return file
  try {
    const image = await loadPhotoImage(file)
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    const context = canvas.getContext("2d")
    if (!context) {
      image.close()
      return file
    }
    image.draw(context, canvas.width, canvas.height)
    image.close()

    let blob: Blob | null = null
    for (const quality of [0.82, 0.7, 0.58]) {
      blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality))
      if (blob && blob.size <= MAX_PROXY_PHOTO_SIZE) break
    }
    if (!blob || blob.size >= file.size) return file
    const baseName = file.name.replace(/\.[^.]+$/, "") || "foto"
    return new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: Date.now() })
  } catch {
    return file
  }
}

async function uploadServiceOrderFileThroughApp(input: { serviceOrderId: string; category: string; file: File; uploadedBy: string; equipmentId?: string; keepPrevious?: boolean }) {
  if (input.file.size > MAX_PROXY_PHOTO_SIZE) throw new Error("A conexao direta falhou e a foto ficou grande demais para o envio alternativo. Escolha uma imagem menor que 3 MB.")
  const formData = new FormData()
  formData.append("file", input.file)
  formData.append("serviceOrderId", input.serviceOrderId)
  formData.append("category", input.category)
  formData.append("uploadedBy", input.uploadedBy)
  formData.append("equipmentId", input.equipmentId || "")
  formData.append("keepPrevious", String(input.keepPrevious === true))
  const response = await fetch("/api/operational-files/upload", { method: "POST", body: formData })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.error || `Erro ao enviar a foto pelo sistema (HTTP ${response.status}).`)
  return payload.file as ServiceOrderFile
}

async function uploadServiceOrderFile(input: { serviceOrderId: string; category: OrderPhotoCategory; file: File; uploadedBy: string; equipmentId?: string; keepPrevious?: boolean }): Promise<ServiceOrderFile> {
  const optimizedFile = await optimizePhotoForUpload(input.file)
  const uploadInput = { ...input, file: optimizedFile }
  if (optimizedFile.size <= MAX_PROXY_PHOTO_SIZE) {
    return uploadServiceOrderFileThroughApp(uploadInput)
  }
  const prepareResponse = await fetch("/api/operational-files/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "prepare",
      serviceOrderId: input.serviceOrderId,
      category: input.category,
      uploadedBy: input.uploadedBy,
      equipmentId: input.equipmentId || "",
      fileName: optimizedFile.name,
      fileType: optimizedFile.type,
      fileSize: optimizedFile.size,
    }),
  })
  const prepared = await prepareResponse.json().catch(() => ({}))
  if (!prepareResponse.ok) throw new Error(prepared?.error || "Erro ao preparar o envio da foto.")

  const upload = prepared.upload
  const supabase = createBrowserSupabaseClient()
  try {
    const { error: uploadError } = await supabase.storage
      .from("service-order-files")
      .uploadToSignedUrl(upload.storagePath, upload.token, optimizedFile, {
        contentType: upload.fileType,
        upsert: false,
      })
    if (uploadError) return uploadServiceOrderFileThroughApp(uploadInput)
  } catch {
    return uploadServiceOrderFileThroughApp(uploadInput)
  }

  let lastError = "Erro ao registrar a foto na OS."
  for (const delay of [0, 350, 900]) {
    if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay))
    const finalizeResponse = await fetch("/api/operational-files/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "finalize",
        id: upload.id,
        storagePath: upload.storagePath,
        serviceOrderId: input.serviceOrderId,
        category: input.category,
        uploadedBy: input.uploadedBy,
        equipmentId: input.equipmentId || "",
        keepPrevious: input.keepPrevious === true,
        fileName: upload.fileName,
        fileType: upload.fileType,
      }),
    })
    const finalized = await finalizeResponse.json().catch(() => ({}))
    if (finalizeResponse.ok) return finalized.file as ServiceOrderFile
    lastError = finalized?.error || lastError
    if (finalizeResponse.status !== 409) break
  }
  throw new Error(lastError)
}

async function fetchServiceOrderPhotos(serviceOrderId: string) {
  const params = new URLSearchParams({ serviceOrderId })
  const response = await fetch(`/api/operational-files/upload?${params.toString()}`, { cache: "no-store" })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.error || "Erro ao confirmar as fotos no banco de dados.")
  return (payload.files || []) as ServiceOrderFile[]
}

const emptyClient = {
  type: "PJ",
  name: "",
  document: "",
  corporateName: "",
  tradeName: "",
  stateRegistration: "",
  responsibleName: "",
  phone: "",
  mobile: "",
  email: "",
  zipCode: "",
  street: "",
  number: "",
  complement: "",
  district: "",
  city: "",
  state: "SP",
  serviceContexts: [] as ServiceOrderKind[],
  monthlyPmocValue: 0,
  status: "Ativo",
  notes: "",
}

const emptySupplier = {
  name: "",
  document: "",
  contactName: "",
  phone: "",
  email: "",
  category: "",
  categoryIds: [] as string[],
  city: "",
  state: "SP",
  status: "Ativo",
  notes: "",
}

function CnpjLookupField({ value, onChange, onLookup, loading, label = "CPF/CNPJ" }: { value: string; onChange: (value: string) => void; onLookup: () => void; loading: boolean; label?: string }) {
  const document = cleanCpfCnpj(value)
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          inputMode="text"
          value={value}
          onChange={(event) => onChange(formatCpfCnpjDocument(event.target.value))}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onLookup() } }}
          placeholder="CPF ou CNPJ"
        />
        {document.length === 14 ? <Button type="button" variant="outline" size="icon" onClick={onLookup} disabled={loading} title="Consultar dados do CNPJ">
          <Search className={`h-4 w-4 ${loading ? "animate-pulse" : ""}`} />
        </Button> : null}
      </div>
      {loading ? <p className="text-xs text-muted-foreground">Consultando dados cadastrais...</p> : null}
    </div>
  )
}

function withCnpjNotes(current: string, company: CnpjCompany) {
  const details = cnpjRegistrationNotes(company)
  const previous = String(current || "").split("\n\nDados do CNPJ:\n")[0].trim()
  return [previous, details ? `Dados do CNPJ:\n${details}` : ""].filter(Boolean).join("\n\n")
}

const emptyClientEnvironment = {
  clientId: "",
  name: "",
  location: "",
  floor: "",
  activityType: "",
  equipmentDescription: "",
  thermalLoad: "",
  occupantsTotal: "0",
  occupantsFixed: "0",
  occupantsFloating: "0",
  airConditionedArea: "0",
  status: "Ativo",
  notes: "",
}

const emptyClientEquipment = {
  clientId: "",
  clientEnvironmentId: "",
  tag: "",
  name: "",
  type: "",
  brand: "",
  model: "",
  serialNumber: "",
  capacity: "",
  status: "Ativo",
  notes: "",
}

const emptyWork = {
  clientId: "",
  uniqueNumber: "",
  name: "",
  type: "Comercial",
  status: "Ativa",
  zipCode: "",
  street: "",
  number: "",
  complement: "",
  district: "",
  city: "",
  state: "SP",
  responsibleName: "",
  responsiblePhone: "",
  responsibleEmail: "",
  responsibleRole: "",
  notes: "",
}

const emptyStructure = {
  workId: "",
  floorId: "",
  floor: "",
  final: "",
  environmentName: "",
  serviceTypeId: "",
  pointsQuantity: "1",
  photoFileName: "",
  photoType: "Antes",
  photoDescription: "",
  notes: "",
}

const emptyFloor = {
  workId: "",
  name: "",
  status: "Ativo",
  notes: "",
}

const emptyProvider = {
  fullName: "",
  cpf: "",
  rg: "",
  birthDate: "",
  phone: "",
  email: "",
  zipCode: "",
  street: "",
  number: "",
  complement: "",
  district: "",
  city: "",
  state: "SP",
  role: "Instalador de ar-condicionado",
  relationshipType: "Funcionario",
  status: "Ativo",
  notes: "",
}

const emptyVehicle = {
  plate: "",
  model: "",
  brand: "",
  year: "",
  color: "",
  currentKm: "0",
  frontRightTire: "Novo",
  frontLeftTire: "Novo",
  rearRightTire: "Novo",
  rearLeftTire: "Novo",
  lastOilChangeDate: "",
  lastOilChangeKm: "0",
  status: "Disponivel",
  renavam: "",
  licensingDueDate: "",
  insuranceInfo: "",
  notes: "",
}

const emptyOrder = {
  orderType: "obra",
  serviceCategory: "",
  clientId: "",
  workId: "",
  clientEnvironmentId: "",
  clientEquipmentId: "",
  workStructureId: "",
  floorId: "",
  environmentId: "",
  pointId: "",
  simpleService: false,
  serviceTypeId: "",
  priority: "Media",
  description: "",
  scheduledDate: today(),
  scheduledStartTime: "08:00",
  scheduledEndTime: "12:00",
  estimatedDuration: "4h",
  allowReschedule: true,
  scheduleNotes: "",
  mainProviderId: "",
  helperProviderId: "",
  supervisorId: "",
  vehicleId: "",
  initialKm: "0",
  totalAmount: "0",
  paymentMethod: "",
  paymentType: "",
  paymentTerm: "",
  paymentDueDate: "",
  financialNotes: "",
  customerResponsibleName: "",
  customerResponsiblePhone: "",
  teamNotes: "",
  notes: "",
}

const emptyServiceTypeForm = {
  id: "",
  name: "",
  description: "",
  status: "Ativo",
  kitId: "",
  executionPercentage: "0",
  periodicityMonths: "1",
  enabledContexts: ["obra"],
  tasks: "Conferir equipamento; Testar funcionamento",
  materials: "",
}

const servicePeriodicityOptions = [
  { value: "1", label: "1 mês" },
  { value: "2", label: "2 meses" },
  { value: "3", label: "3 meses" },
  { value: "6", label: "6 meses" },
]

function servicePeriodicityLabel(value?: number | string) {
  const months = Number(value || 1)
  return months === 1 ? "1 mês" : `${months} meses`
}

const serviceContextLabels: Record<ServiceOrderKind, string> = {
  obra: "Obras",
  pmoc: "PMOC",
  servicos: "Serviços Diversos",
}

const serviceContextOptions: ServiceOrderKind[] = ["obra", "pmoc", "servicos"]
const defaultServiceContexts: ServiceOrderKind[] = ["obra"]
const diverseServiceCategoryOptions = [
  { value: "Manutencao Preventiva", label: "Manutenção Preventiva" },
  { value: "Instalacao", label: "Instalação" },
  { value: "Manutencao Corretiva", label: "Manutenção Corretiva" },
  { value: "Visita Tecnica", label: "Visita Técnica" },
]

function serviceCategoryLabel(value?: string) {
  return diverseServiceCategoryOptions.find((item) => item.value === value)?.label || value || "-"
}

function isTechnicalVisitCategory(value?: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase() === "visita tecnica"
}

function serviceContexts(service: any): ServiceOrderKind[] {
  return Array.isArray(service?.enabledContexts) && service.enabledContexts.length ? service.enabledContexts : defaultServiceContexts
}

function serviceEnabledFor(service: any, context: ServiceOrderKind) {
  return serviceContexts(service).includes(context)
}

const statusColumns = ["Criada", "Agendada", "A caminho", "Em execucao", "Pausada", "Aguardando material", "Finalizada", "Cancelada"]
const tireOptions = ["Novo", "3/4 vida", "Meia vida", "1/4 vida", "Solicitar troca"]
const fieldSteps = [
  ["Iniciar servico", "Em execucao"],
  ["Pausar servico", "Pausada"],
  ["Retornar do almoco/pausa", "Em execucao"],
  ["Finalizar servico", "Finalizada"],
] as Array<[string, string]>

function normalizeStatus(value: string) {
  return value as ServiceOrderStatus
}

function dateTime(value: string) {
  return value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "-"
}

function escapeHtml(value: React.ReactNode) {
  return String(value ?? "-")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

function orderAddress(state: OperationalState, order: ServiceOrder) {
  const client = state.clients.find((item) => item.id === order.clientId)
  const clientAddress = client ? fullAddress(client) : ""
  return clientAddress || "-"
}

async function saveServiceOrderEvent(input: { orderId: string; event: any; status: string; finishedAt?: string; upsert?: boolean }) {
  const response = await fetch(`/api/ordens-servico/${input.orderId}/eventos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.error || "Erro ao registrar evento no banco.")
  return payload
}

async function resetServiceOrderExecution(input: { orderId: string; status: string }) {
  const response = await fetch(`/api/ordens-servico/${input.orderId}/eventos`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: input.status }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.error || "Erro ao resetar execucao no banco.")
  return payload
}

function vehicleMaintenanceConflict(state: OperationalState, vehicleId: string, scheduledDate: string) {
  if (!vehicleId || !scheduledDate) return null
  const records = state.vehicleMaintenance.filter((item) => item.vehicleId === vehicleId)
  const conflict = records.find((item) => {
    const start = item.date
    const end = item.nextMaintenance || item.date
    return Boolean(start && scheduledDate >= start && scheduledDate <= end)
  })
  if (conflict) return conflict
  const vehicle = state.vehicles.find((item) => item.id === vehicleId)
  if (vehicle && String(vehicle.status).toLowerCase().includes("manuten") && !records.length) {
    return { id: "status-maintenance", vehicleId, type: "Manutencao", date: scheduledDate, km: vehicle.currentKm, cost: 0, description: "Veiculo marcado como em manutencao sem periodo definido.", nextMaintenance: scheduledDate, status: "Programada" as const, attachmentName: "" }
  }
  return null
}

function materialStock(material: Material) {
  return (material as any).currentStock ?? material.minimumStock ?? 0
}

function serviceNamesForOrder(state: OperationalState, order: ServiceOrder) {
  const primary = names(state).serviceType(order.serviceTypeId)
  const notesLine = String(order.notes || "").split("\n").find((line) => line.startsWith("Servicos selecionados:"))
  const fromNotes = notesLine
    ? notesLine.replace("Servicos selecionados:", "").split(",").map((item) => item.trim()).filter(Boolean)
    : []
  return Array.from(new Set([primary, ...fromNotes].filter((item) => item && item !== "-")))
}

function serviceIdsForOrder(order: ServiceOrder) {
  const selection = orderSelectionFromNotes(order.notes)
  return Array.from(new Set([...(selection?.serviceTypeIds || []), order.serviceTypeId].filter(Boolean)))
}

type OrderSelectionSnapshot = {
  localIds?: string[]
  floorIds?: string[]
  finalKeys?: string[]
  environmentIds?: string[]
  pointIds?: string[]
  clientEnvironmentIds?: string[]
  clientEquipmentIds?: string[]
  serviceTypeIds?: string[]
  kitSelections?: Array<{ kitId: string; quantity: number; notes: string }>
  materialSelections?: Array<{ materialId: string; quantity: number; notes: string }>
}

const orderSelectionPrefixes = [
  "Selecoes OS JSON:",
  "Locais/Torres selecionados:",
  "Pavimentos selecionados:",
  "Finais/Tipos selecionados:",
  "Ambientes selecionados:",
  "Pontos selecionados:",
  "Ambientes do cliente selecionados:",
  "Equipamentos selecionados:",
  "Servicos selecionados:",
  "Kits selecionados:",
  "Valor dos kits:",
  "Valor da OS:",
  "Soma total da OS:",
]

function orderSelectionFromNotes(notes?: string): OrderSelectionSnapshot | null {
  const line = String(notes || "").split("\n").find((item) => item.startsWith("Selecoes OS JSON:"))
  if (!line) return null
  try {
    return JSON.parse(line.replace("Selecoes OS JSON:", "").trim())
  } catch {
    return null
  }
}

function cleanOrderSelectionNotes(notes?: string) {
  return String(notes || "")
    .split("\n")
    .filter((line) => !orderSelectionPrefixes.some((prefix) => line.trim().startsWith(prefix)))
    .join("\n")
    .trim()
}

type OrderExecutionService = {
  id: string
  name: string
}

type OrderExecutionPoint = {
  id: string
  label: string
  local: string
  floor: string
  final: string
  environment: string
  services: OrderExecutionService[]
}

function serviceDetailStep(pointId: string) {
  return `Detalhamento servico executado: ${pointId}`
}

function serviceDetailEvent(events: ServiceOrderEvent[], pointId: string) {
  return events.find((event) => event.stepName === serviceDetailStep(pointId))
}

function equipmentPhotoNote(equipmentId: string) {
  return equipmentId ? `equipment:${equipmentId}` : ""
}

function canStorePhotoScope(id: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
}

function orderPhotoFile(files: ServiceOrderFile[], category: OrderPhotoCategory, equipmentId = "") {
  const expectedNote = equipmentPhotoNote(equipmentId)
  return files
    .filter((file) => file.category === category && String(file.notes || "") === expectedNote)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0]
}

function orderPhotoFiles(files: ServiceOrderFile[], category: OrderPhotoCategory, equipmentId = "") {
  const expectedNote = equipmentPhotoNote(equipmentId)
  return files
    .filter((file) => file.category === category && String(file.notes || "") === expectedNote)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
}

function hasRequiredOrderPhoto(files: ServiceOrderFile[], category: OrderPhotoCategory, equipmentId: string, orderType: ServiceOrderKind) {
  if (orderType === "obra") return files.some((file) => file.category === category)
  return Boolean(orderPhotoFile(files, category, equipmentId))
}

function requiredOrderPhotos(orderType: ServiceOrderKind, executionPoints: OrderExecutionPoint[]) {
  if (orderType === "pmoc") {
    return executionPoints.flatMap((point) => (["Foto Inicial", "Foto Final"] as const).map((category) => ({
      category,
      equipmentId: point.id,
      label: `${category} - ${point.label}`,
      equipmentLabel: point.label,
      environment: point.environment,
    })))
  }
  if (orderType === "servicos") {
    return executionPoints.flatMap((point) => (["Foto Inicial", "Foto Final"] as const).map((category) => ({
      category,
      equipmentId: point.id,
      label: `${category} - ${point.label}`,
      equipmentLabel: point.label,
      environment: point.environment,
    })))
  }
  return (["Foto Inicial", "Foto Final"] as const).map((category) => ({
    category,
    equipmentId: "",
    label: category,
    equipmentLabel: "",
    environment: "",
  }))
}

function eventStepLabel(event: ServiceOrderEvent) {
  if (event.stepName.startsWith("Detalhamento servico executado:")) return "Detalhamento do servico executado"
  if (event.stepName.startsWith("Ponto:")) {
    const kind = event.stepName.endsWith("- Inicio") ? "Inicio" : event.stepName.endsWith("- Fim") ? "Fim" : "Horario"
    return `${kind}: ${event.notes || "servico"}`
  }
  return event.stepName
}

function executionPointOptionLabel(point: OrderExecutionPoint) {
  return [point.label, point.final !== "-" ? point.final : "", point.environment].filter(Boolean).join(" - ")
}

function serviceIdsForPoint(point: WorkPoint | undefined, selection: OrderSelectionSnapshot | null, order: ServiceOrder) {
  const pointServices = [
    ...(((point as any)?.serviceTypeIds || []).filter(Boolean) as string[]),
    point?.serviceTypeId || "",
  ].filter(Boolean)
  const selectedServices = (selection?.serviceTypeIds || []).filter(Boolean)
  const services = pointServices.length ? pointServices : !point && selectedServices.length ? selectedServices : [order.serviceTypeId].filter(Boolean)
  return Array.from(new Set(services))
}

function orderExecutionTree(state: OperationalState, order: ServiceOrder): OrderExecutionPoint[] {
  const selection = orderSelectionFromNotes(order.notes)
  if (order.orderType === "servicos" || order.orderType === "pmoc") {
    const pmocEquipmentIds = order.orderType === "pmoc"
      ? (state.pmocSchedules || [])
          .filter((schedule) => schedule.serviceOrderId === order.id)
          .map((schedule) => (state.pmocEquipment || []).find((equipment) => equipment.id === schedule.equipmentId)?.clientEquipmentId || "")
      : []
    const selectedEquipmentIds = Array.from(new Set([...(selection?.clientEquipmentIds || []), order.clientEquipmentId, ...pmocEquipmentIds].filter(Boolean)))
    const selectedEnvironmentIds = Array.from(new Set([...(selection?.clientEnvironmentIds || []), order.clientEnvironmentId].filter(Boolean)))
    const equipmentItems = selectedEquipmentIds.map((id) => state.clientEquipment.find((item) => item.id === id)).filter(Boolean) as ClientEquipment[]
    const serviceIds = serviceIdsForOrder(order)
    const services = serviceIds.map((serviceId) => {
      const service = state.serviceTypes.find((item) => item.id === serviceId)
      return { id: serviceId, name: service?.name || serviceId }
    }).filter((service) => service.name && service.name !== "-")
    const serviceList = services.length ? services : serviceNamesForOrder(state, order).map((name) => ({ id: name, name }))
    if (equipmentItems.length) {
      return equipmentItems.map((clientEquipment) => {
        const clientEnvironment = state.clientEnvironments.find((item) => item.id === clientEquipment.clientEnvironmentId)
        return {
          id: clientEquipment.id,
          label: clientEquipment.name || "Equipamento/Maquina",
          local: names(state).client(order.clientId),
          floor: clientEnvironment?.floor || "-",
          final: order.orderType === "pmoc" ? "PMOC" : "Servicos diversos",
          environment: clientEnvironment?.name || "-",
          services: serviceList,
        }
      })
    }
    if (order.orderType === "pmoc") return []
    return (selectedEnvironmentIds.length ? selectedEnvironmentIds : [`servicos-${order.id}`]).map((environmentId) => {
      const clientEnvironment = state.clientEnvironments.find((item) => item.id === environmentId)
      return {
        id: environmentId,
        label: clientEnvironment?.name || "Ambiente",
        local: names(state).client(order.clientId),
        floor: clientEnvironment?.floor || "-",
        final: order.orderType === "pmoc" ? "PMOC" : "Servicos diversos",
        environment: clientEnvironment?.name || "-",
        services: serviceList,
      }
    })
  }
  const selectedPointIds = (selection?.pointIds?.length ? selection.pointIds : [order.pointId]).filter(Boolean)
  const pointIds = selectedPointIds.length ? selectedPointIds : state.workPoints.filter((point) => point.workId === order.workId).map((point) => point.id)
  const fallbackServices = serviceNamesForOrder(state, order).map((name) => ({ id: name, name }))

  if (!pointIds.length && fallbackServices.length) {
    return [{
      id: "servico-avulso",
      label: "Servico avulso",
      local: names(state).work(order.workId),
      floor: names(state).floor(order.floorId),
      final: "-",
      environment: names(state).environment(order.environmentId),
      services: fallbackServices,
    }]
  }

  return pointIds.map((pointId) => {
    const point = state.workPoints.find((item) => item.id === pointId)
    const environment = state.workEnvironments.find((item) => item.id === (point?.environmentId || order.environmentId))
    const floor = state.workFloors.find((item) => item.id === (environment?.floorId || order.floorId))
    const localId = budgetMetaValue(environment?.notes, "tower_id") || order.workStructureId
    const serviceIds = serviceIdsForPoint(point, selection, order)
    const services = serviceIds.map((serviceId) => {
      const service = state.serviceTypes.find((item) => item.id === serviceId)
      return { id: serviceId, name: service?.name || serviceId }
    }).filter((service) => service.name && service.name !== "-")

    return {
      id: pointId,
      label: point?.pointName || names(state).point(pointId) || pointId,
      local: names(state).structure(localId) !== "-" ? names(state).structure(localId) : names(state).work(order.workId),
      floor: floor?.name || names(state).floor(order.floorId),
      final: environment?.final || "-",
      environment: environment?.environmentName || names(state).environment(order.environmentId),
      services: services.length ? services : fallbackServices,
    }
  })
}

function DetailGrid({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="rounded-md border p-3">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="mt-1 text-sm font-medium">{value || "-"}</div>
        </div>
      ))}
    </div>
  )
}

function QuickSheets({
  state,
  commit,
  sheet,
  setSheet,
  preset,
}: {
  state: OperationalState
  commit: (updater: (current: OperationalState) => OperationalState, options?: { persist?: boolean }) => void
  sheet: SheetKind
  setSheet: (sheet: SheetKind) => void
  preset?: Record<string, string>
}) {
  const { requireFields, toast } = useCrudFeedback()
  const [client, setClient] = useState<Record<string, any>>(emptyClient)
  const [clientEnvironment, setClientEnvironment] = useState<Record<string, any>>(emptyClientEnvironment)
  const [clientEquipment, setClientEquipment] = useState<Record<string, any>>(emptyClientEquipment)
  const [supplier, setSupplier] = useState<Record<string, any>>(emptySupplier)
  const [supplierCategories, setSupplierCategories] = useState<Array<{ id: string; name: string }>>([])
  const [supplierCategoriesLoading, setSupplierCategoriesLoading] = useState(false)
  const [supplierCategoriesError, setSupplierCategoriesError] = useState("")
  const [work, setWork] = useState<Record<string, any>>(emptyWork)
  const [floor, setFloor] = useState<Record<string, any>>(emptyFloor)
  const [structure, setStructure] = useState<Record<string, any>>(emptyStructure)
  const [provider, setProvider] = useState<Record<string, any>>(emptyProvider)
  const [vehicle, setVehicle] = useState<Record<string, any>>(emptyVehicle)
  const [order, setOrder] = useState<Record<string, any>>(emptyOrder)
  const [orderFinalKey, setOrderFinalKey] = useState("")
  const [step, setStep] = useState(0)
  const [orderMaterial, setOrderMaterial] = useState({ materialId: "", quantity: "1", notes: "" })
  const [orderMaterials, setOrderMaterials] = useState<Array<{ materialId: string; quantity: number; notes: string }>>([])
  const [selectedLocals, setSelectedLocals] = useState<string[]>([])
  const [selectedFloors, setSelectedFloors] = useState<string[]>([])
  const [selectedFinals, setSelectedFinals] = useState<string[]>([])
  const [selectedEnvironments, setSelectedEnvironments] = useState<string[]>([])
  const [selectedPoints, setSelectedPoints] = useState<string[]>([])
  const [selectedClientEnvironments, setSelectedClientEnvironments] = useState<string[]>([])
  const [selectedClientEquipment, setSelectedClientEquipment] = useState<string[]>([])
  const [selectedServices, setSelectedServices] = useState<string[]>([])
  const [orderKit, setOrderKit] = useState({ kitId: "", quantity: "1", notes: "" })
  const [orderKits, setOrderKits] = useState<Array<{ kitId: string; quantity: number; notes: string }>>([])
  const [material, setMaterial] = useState<Record<string, any>>(emptyMaterialForm)
  const [serviceType, setServiceType] = useState<Record<string, any>>(emptyServiceTypeForm)
  const [savingServiceType, setSavingServiceType] = useState(false)
  const [savingClientEnvironment, setSavingClientEnvironment] = useState(false)
  const savingClientEnvironmentRef = useRef(false)
  const [savingClientEquipment, setSavingClientEquipment] = useState(false)
  const savingClientEquipmentRef = useRef(false)
  const [savingClient, setSavingClient] = useState(false)
  const savingClientRef = useRef(false)
  const [savingSupplier, setSavingSupplier] = useState(false)
  const savingSupplierRef = useRef(false)
  const [cnpjLookupTarget, setCnpjLookupTarget] = useState<"client" | "supplier" | "">("")
  const lastAutomaticCnpjRef = useRef("")
  const [user, setUser] = useState<Record<string, any>>({ name: "", email: "", phone: "", profile: "Tecnico", temporaryPassword: "123456", status: "Ativo", permissions: ["dashboard", "ordens_servico"], clientId: "" })

  useEffect(() => {
    if (!sheet) return
    if (sheet === "work") setWork({ ...emptyWork, uniqueNumber: nextWorkNumber(state), ...preset })
    if (sheet === "floor") setFloor({ ...emptyFloor, ...preset })
    if (sheet === "structure") setStructure({ ...emptyStructure, ...preset })
    if (sheet === "order") {
      const existingOrder = state.serviceOrders.find((item) => item.id === preset?.id)
      const orderBase = existingOrder ? { ...existingOrder } : { ...emptyOrder, ...preset }
      const presetStructure = state.workStructures.find((item) => item.id === preset?.structureId)
      const presetEnvironment = state.workEnvironments.find((item) => item.id === (existingOrder?.environmentId || preset?.environmentId))
      const presetPoint = state.workPoints.find((item) => item.id === (existingOrder?.pointId || preset?.pointId))
      const environment = presetEnvironment || state.workEnvironments.find((item) => item.id === presetPoint?.environmentId)
      const presetWork = state.works.find((item) => item.id === (existingOrder?.workId || preset?.workId || presetPoint?.workId || environment?.workId || presetStructure?.workId))
      const towerId = budgetMetaValue(environment?.notes, "tower_id")
      const finalKey = budgetMetaValue(environment?.notes, "type_id") || environment?.final || ""
      const selection = existingOrder ? orderSelectionFromNotes(existingOrder.notes) : null
      const localSelection = (selection?.localIds?.length ? selection.localIds : [existingOrder?.workStructureId || preset?.structureId || towerId || ""]).filter(Boolean) as string[]
      const floorSelection = (selection?.floorIds?.length ? selection.floorIds : [existingOrder?.floorId || environment?.floorId || preset?.floorId || ""]).filter(Boolean) as string[]
      const finalSelection = (selection?.finalKeys?.length ? selection.finalKeys : [finalKey]).filter(Boolean) as string[]
      const environmentSelection = (selection?.environmentIds?.length ? selection.environmentIds : [existingOrder?.environmentId || environment?.id || preset?.environmentId || ""]).filter(Boolean) as string[]
      const pointSelection = (selection?.pointIds?.length ? selection.pointIds : [existingOrder?.pointId || presetPoint?.id || preset?.pointId || ""]).filter(Boolean) as string[]
      const clientEnvironmentSelection = (selection?.clientEnvironmentIds?.length ? selection.clientEnvironmentIds : [existingOrder?.clientEnvironmentId || preset?.clientEnvironmentId || ""]).filter(Boolean) as string[]
      const clientEquipmentSelection = (selection?.clientEquipmentIds?.length ? selection.clientEquipmentIds : [existingOrder?.clientEquipmentId || preset?.clientEquipmentId || ""]).filter(Boolean) as string[]
      const serviceSelection = (selection?.serviceTypeIds?.length ? selection.serviceTypeIds : [existingOrder?.serviceTypeId || presetPoint?.serviceTypeId || environment?.serviceTypeId || preset?.serviceTypeId || ""]).filter(Boolean) as string[]
      const storedKitSelection = (selection?.kitSelections || []).map((item) => ({ kitId: item.kitId, quantity: Number(item.quantity || 1), notes: item.notes || "" })).filter((item) => item.kitId)
      const budgetKitSelection = (existingOrder?.orderType || orderBase.orderType || "obra") === "obra"
        ? budgetKitsForPoints(pointSelection, state.workPoints, state.stockKits || [])
        : []
      const kitSelection = mergeStoredAndBudgetKits(storedKitSelection, budgetKitSelection)
      const materialSelection = (selection?.materialSelections?.length
        ? selection.materialSelections
        : existingOrder
          ? state.serviceOrderMaterials.filter((item) => item.serviceOrderId === existingOrder.id).map((item) => ({ materialId: item.materialId, quantity: Number(item.expectedQuantity || item.usedQuantity || 0), notes: item.notes || "" }))
          : []
      ).map((item) => ({ materialId: item.materialId, quantity: Number(item.quantity || 1), notes: item.notes || "" })).filter((item) => item.materialId)
      const kitTotal = kitSelection.reduce((sum, item) => {
        const kit = state.stockKits.find((stockKit) => stockKit.id === item.kitId)
        return sum + Number((kit as any)?.unitValue || 0) * Number(item.quantity || 0)
      }, 0)
      setOrder({
        ...orderBase,
        totalAmount: existingOrder ? Math.max(0, Number(existingOrder.totalAmount || 0) - kitTotal) : orderBase.totalAmount,
        workStructureId: localSelection[0] || "",
        floorId: floorSelection[0] || "",
        environmentId: environmentSelection[0] || "",
        pointId: pointSelection[0] || "",
        workId: existingOrder?.workId || preset?.workId || presetPoint?.workId || environment?.workId || presetStructure?.workId || "",
        clientId: existingOrder?.clientId || preset?.clientId || presetWork?.clientId || "",
        clientEnvironmentId: clientEnvironmentSelection[0] || "",
        clientEquipmentId: clientEquipmentSelection[0] || "",
        serviceTypeId: serviceSelection[0] || "",
      })
      setOrderFinalKey(finalSelection[0] || "")
      setSelectedLocals(localSelection)
      setSelectedFloors(floorSelection)
      setSelectedFinals(finalSelection)
      setSelectedEnvironments(environmentSelection)
      setSelectedPoints(pointSelection)
      setSelectedClientEnvironments(clientEnvironmentSelection)
      setSelectedClientEquipment(clientEquipmentSelection)
      setSelectedServices(serviceSelection)
      setOrderMaterials(materialSelection)
      setOrderMaterial({ materialId: "", quantity: "1", notes: "" })
      setOrderKits(kitSelection)
      setOrderKit({ kitId: "", quantity: "1", notes: "" })
    }
    if (sheet === "client") {
      const existingClient = state.clients.find((item) => item.id === preset?.id)
      setClient(existingClient ? { ...emptyClient, ...existingClient } : emptyClient)
    }
    if (sheet === "clientEnvironment") {
      const existing = state.clientEnvironments?.find((item) => item.id === preset?.id)
      setClientEnvironment(existing ? { ...emptyClientEnvironment, ...existing } : { ...emptyClientEnvironment, ...preset })
    }
    if (sheet === "clientEquipment") {
      const existing = state.clientEquipment?.find((item) => item.id === preset?.id)
      setClientEquipment(existing ? { ...emptyClientEquipment, ...existing } : { ...emptyClientEquipment, ...preset })
    }
    if (sheet === "supplier") {
      const existingSupplier = state.suppliers.find((item) => item.id === preset?.id)
      setSupplier(existingSupplier ? { ...emptySupplier, ...existingSupplier, categoryIds: existingSupplier.categoryIds || [] } : emptySupplier)
    }
    if (sheet === "provider") {
      const existingProvider = state.providers.find((item) => item.id === preset?.id)
      setProvider(existingProvider ? { ...emptyProvider, ...existingProvider } : emptyProvider)
    }
    if (sheet === "vehicle") {
      const existingVehicle = state.vehicles.find((item) => item.id === preset?.id)
      setVehicle(existingVehicle ? { ...emptyVehicle, ...existingVehicle } : emptyVehicle)
    }
    if (sheet === "serviceType") {
      const existingService = state.serviceTypes.find((item) => item.id === preset?.id)
      if (existingService) {
        const tasks = state.serviceTypeChecklistItems
          .filter((item) => item.serviceTypeId === existingService.id)
          .sort((a, b) => a.order - b.order)
          .map((item) => item.taskName)
          .join("; ")
        setServiceType({
          id: existingService.id,
          name: existingService.name,
          description: existingService.description || "",
          status: existingService.status,
          kitId: existingService.kitId || "",
          executionPercentage: String(existingService.executionPercentage || 0),
          periodicityMonths: String(existingService.periodicityMonths || 1),
          enabledContexts: serviceContexts(existingService),
          tasks,
          materials: "",
        })
      } else {
        setServiceType(emptyServiceTypeForm)
      }
    }
    if (sheet === "material") {
      const existingMaterial = state.materials.find((item) => item.id === preset?.id)
      setMaterial(existingMaterial ? { ...materialFormFromItem(existingMaterial), id: existingMaterial.id } : emptyMaterialForm)
    }
    if (sheet === "user") {
      const existingUser = state.systemUsers.find((item) => item.id === preset?.id)
      setUser(existingUser
        ? { ...existingUser, temporaryPassword: "" }
        : { name: "", email: "", phone: "", profile: "Tecnico", temporaryPassword: "123456", status: "Ativo", permissions: ["dashboard", "ordens_servico"], clientId: "" })
    }
  }, [sheet, preset, state])

  useEffect(() => {
    const target = sheet === "client" && !client.id
      ? "client"
      : sheet === "supplier" && !supplier.id ? "supplier" : ""
    if (!target) return
    const document = cleanCpfCnpj(target === "client" ? client.document : supplier.document)
    const key = `${target}:${document}`
    if (document.length !== 14 || lastAutomaticCnpjRef.current === key) return
    const timer = window.setTimeout(() => {
      lastAutomaticCnpjRef.current = key
      void lookupCnpj(target, true)
    }, 500)
    return () => window.clearTimeout(timer)
  }, [sheet, client.type, client.id, client.document, supplier.id, supplier.document])

  useEffect(() => {
    if (sheet !== "supplier") return
    let active = true
    setSupplierCategoriesLoading(true)
    setSupplierCategoriesError("")
    fetch("/api/financial-categories/options", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null)
        if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
        if (active) setSupplierCategories(Array.isArray(payload?.categories) ? payload.categories : [])
      })
      .catch((error) => {
        if (active) setSupplierCategoriesError(error instanceof Error ? error.message : "Erro ao carregar categorias")
      })
      .finally(() => {
        if (active) setSupplierCategoriesLoading(false)
      })
    return () => { active = false }
  }, [sheet])

  useEffect(() => {
    if (sheet !== "supplier" || !supplierCategories.length) return
    setSupplier((current) => {
      if (current.categoryIds?.length || !current.category) return current
      const legacyNames = String(current.category).split(/[,;]/).map((value) => value.trim().toLocaleLowerCase("pt-BR")).filter(Boolean)
      const categoryIds = supplierCategories.filter((item) => legacyNames.includes(item.name.toLocaleLowerCase("pt-BR"))).map((item) => item.id)
      return categoryIds.length ? { ...current, categoryIds } : current
    })
  }, [sheet, supplierCategories])

  const orderType = ((order.orderType || "obra") as ServiceOrderKind)
  const workOptions = orderType === "obra"
    ? state.works.filter((item) => item.type === "Orçamento" && ["", "obra"].includes(budgetMetaValue(item.notes, "kind")))
    : state.works.filter((item) => !order.clientId || item.clientId === order.clientId)
  const isTechnicalVisit = orderType === "servicos" && isTechnicalVisitCategory(order.serviceCategory)
  const activeServiceTypes = state.serviceTypes.filter((item) => item.status === "Ativo")
  const serviceTypesForOrder = activeServiceTypes.filter((item) => serviceEnabledFor(item, orderType))
  const serviceTypesForWorks = activeServiceTypes.filter((item) => serviceEnabledFor(item, "obra"))
  const clientEnvironmentOptions = (state.clientEnvironments || []).filter((item) => item.status === "Ativo" && (!order.clientId || item.clientId === order.clientId))
  const clientEquipmentOptions = (state.clientEquipment || []).filter((item) => item.status === "Ativo" && (!order.clientId || item.clientId === order.clientId) && (!selectedClientEnvironments.length || selectedClientEnvironments.includes(item.clientEnvironmentId)))
  const equipmentEnvironmentOptions = (state.clientEnvironments || []).filter((item) => item.status === "Ativo" && (!clientEquipment.clientId || item.clientId === clientEquipment.clientId))
  const structureOptions = state.workStructures.filter((item) => item.workId === order.workId && item.status !== "Inativa")
  const workEnvironmentsForOrder = state.workEnvironments.filter((item) => item.workId === order.workId && item.status !== "Inativo")
  const localOptions = uniqueByValue(workEnvironmentsForOrder.map((item) => ({
    value: budgetMetaValue(item.notes, "tower_id"),
    label: budgetMetaValue(item.notes, "tower_name") || "Local/Torre",
  })).filter((item) => item.value))
  const rawFloorOptions = state.workFloors
    .filter((item) => item.workId === order.workId && item.status !== "Inativo")
    .filter((item) => {
      const towerId = budgetMetaValue(item.notes, "tower_id")
      return !selectedLocals.length || !towerId || selectedLocals.includes(towerId)
    })
  const floorOptions = Array.from(rawFloorOptions.reduce((acc, item) => {
    const key = normalizeClientImportKey(item.name)
    const current = acc.get(key) || { ids: [] as string[], label: item.name || "Pavimento" }
    current.ids.push(item.id)
    acc.set(key, current)
    return acc
  }, new Map<string, { ids: string[]; label: string }>()).values()).map((item) => ({
    id: item.ids[0],
    ids: item.ids,
    value: item.ids.join("|"),
    name: item.label,
  }))
  const selectedFloorIds = new Set(selectedFloors.flatMap((value) => value.split("|").filter(Boolean)))
  const primarySelectedFloorId = selectedFloors[0]?.split("|").filter(Boolean)[0] || ""
  const environmentsByLocalAndFloor = workEnvironmentsForOrder
    .filter((item) => !selectedLocals.length || selectedLocals.includes(budgetMetaValue(item.notes, "tower_id")))
    .filter((item) => !selectedFloors.length || selectedFloorIds.has(item.floorId))
  const finalOptions = uniqueByValue(environmentsByLocalAndFloor.map((item) => ({
    value: budgetMetaValue(item.notes, "type_id") || item.final,
    label: item.final || "Final",
  })).filter((item) => item.value))
  const environmentOptions = environmentsByLocalAndFloor.filter((item) => !selectedFinals.length || selectedFinals.includes(budgetMetaValue(item.notes, "type_id") || item.final))
  const workPointOptions = state.workPoints
    .filter((item) => item.status !== "Inativo")
    .filter((item) => !order.workId || item.workId === order.workId)
  const deferLargeWorkPoints = orderType === "obra" && workPointOptions.length > 300 && !selectedFloors.length
  const pointOptions = (deferLargeWorkPoints ? [] : workPointOptions)
    .filter((item) => {
      const environment = state.workEnvironments.find((candidate) => candidate.id === item.environmentId)
      if (selectedLocals.length && !selectedLocals.includes(budgetMetaValue(environment?.notes, "tower_id"))) return false
      if (selectedFloors.length && !selectedFloorIds.has(environment?.floorId || "")) return false
      if (selectedFinals.length && !selectedFinals.includes(budgetMetaValue(environment?.notes, "type_id") || environment?.final || "")) return false
      if (selectedEnvironments.length && !selectedEnvironments.includes(item.environmentId)) return false
      return true
    })
  const activeProviders = state.providers.filter((item) => item.status === "Ativo")
  const availableVehicles = state.vehicles.filter((item) => item.status !== "Inativo" && !vehicleMaintenanceConflict(state, item.id, order.scheduledDate))
  const selectedVehicleConflict = vehicleMaintenanceConflict(state, order.vehicleId, order.scheduledDate)
  const activeKits = (state.stockKits || []).filter((item) => item.status === "Ativo")

  function money(value: number) {
    return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
  }

  function kitUnitValue(kitId: string) {
    const kit = state.stockKits.find((item) => item.id === kitId)
    return Number((kit as any)?.unitValue || 0)
  }

  function orderKitsAmount(rows = orderKits) {
    return rows.reduce((sum, row) => sum + kitUnitValue(row.kitId) * Number(row.quantity || 0), 0)
  }

  function orderServiceAmount() {
    return Number(order.totalAmount || 0)
  }

  function orderTotalAmount() {
    return orderServiceAmount() + orderKitsAmount()
  }

  function toggleValue(values: string[], setter: (values: string[]) => void, value: string, checked: boolean) {
    const next = checked ? Array.from(new Set([...values, value])) : values.filter((item) => item !== value)
    setter(next)
    return next
  }

  function applyPrimarySelection(next: Record<string, any>) {
    setOrder((current) => ({ ...current, ...next }))
  }

  function servicesFromPoints(pointIds: string[]) {
    return Array.from(new Set(pointIds.flatMap((pointId) => {
      const point = state.workPoints.find((item) => item.id === pointId) as any
      return Array.isArray(point?.serviceTypeIds) && point.serviceTypeIds.length ? point.serviceTypeIds : [point?.serviceTypeId]
    }).filter(Boolean) as string[]))
  }

  function applyBudgetKits(pointIds: string[], workId = order.workId) {
    if (orderType !== "obra") return
    setOrderKits(pointIds.length
      ? budgetKitsForPoints(pointIds, state.workPoints, state.stockKits || [])
      : budgetKitsForWork(workId, state.workPoints, state.stockKits || []))
  }

  function selectedLabels(ids: string[], label: (id: string) => string) {
    return ids.map(label).filter(Boolean).join(", ")
  }

  function MultiChecklist({
    label,
    emptyLabel,
    options,
    values,
    onToggle,
    onSelectAll,
    onClear,
  }: {
    label: string
    emptyLabel: string
    options: Array<{ value: string; label: string; disabled?: boolean }>
    values: string[]
    onToggle: (value: string, checked: boolean) => void
    onSelectAll?: () => void
    onClear?: () => void
  }) {
    const sortedOptions = sortChoiceOptions(options)
    const enabledOptions = sortedOptions.filter((option) => !option.disabled)
    return (
      <div className="space-y-2" data-checklist-field={label}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label>{label}</Label>
          {options.length ? (
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onSelectAll ? onSelectAll() : enabledOptions.forEach((option) => onToggle(option.value, true))}
                disabled={!enabledOptions.length || enabledOptions.every((option) => values.includes(option.value))}
              >
                Selecionar tudo
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onClear ? onClear() : values.forEach((value) => onToggle(value, false))}
                disabled={!values.length}
              >
                Limpar
              </Button>
            </div>
          ) : null}
        </div>
        <div className="rounded-md border p-2">
          {sortedOptions.length ? (
            <div className="grid gap-2 md:grid-cols-2">
              {sortedOptions.map((option) => (
                <label key={option.value} className={`flex items-center gap-2 rounded-md px-2 py-2 text-sm ${option.disabled ? "opacity-50" : "hover:bg-muted"}`}>
                  <Checkbox
                    checked={values.includes(option.value)}
                    disabled={option.disabled}
                    onCheckedChange={(checked) => onToggle(option.value, checked === true)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="px-2 py-3 text-sm text-muted-foreground">{emptyLabel}</p>
          )}
        </div>
      </div>
    )
  }

  function expandedOrderKitMaterials(rows = orderKits) {
    const usage = new Map<string, { materialId: string; quantity: number; notes: string }>()
    rows.forEach((row) => {
      const kit = state.stockKits.find((item) => item.id === row.kitId)
      state.stockKitItems.filter((item) => item.kitId === row.kitId).forEach((kitItem) => {
        const current = usage.get(kitItem.materialId)
        const quantity = Number(kitItem.quantity || 0) * Number(row.quantity || 0)
        usage.set(kitItem.materialId, {
          materialId: kitItem.materialId,
          quantity: (current?.quantity || 0) + quantity,
          notes: [current?.notes, `${row.quantity}x ${kit?.name || "Kit"}${row.notes ? ` - ${row.notes}` : ""}`].filter(Boolean).join("; "),
        })
      })
    })
    return Array.from(usage.values())
  }

  function combinedOrderMaterials() {
    const usage = new Map<string, { materialId: string; quantity: number; notes: string }>()
    ;[...expandedOrderKitMaterials(), ...orderMaterials].forEach((row) => {
      const current = usage.get(row.materialId)
      usage.set(row.materialId, {
        materialId: row.materialId,
        quantity: Number(current?.quantity || 0) + Number(row.quantity || 0),
        notes: [current?.notes, row.notes].filter(Boolean).join("; "),
      })
    })
    return Array.from(usage.values())
  }

  async function lookupCnpj(target: "client" | "supplier", automatic = false) {
    const document = cleanCpfCnpj(target === "client" ? client.document : supplier.document)
    if (document.length !== 14) {
      if (!automatic) toast({ title: "CNPJ incompleto", description: "Informe os 14 caracteres do CNPJ.", variant: "destructive" })
      return
    }
    setCnpjLookupTarget(target)
    try {
      const response = await fetch(`/api/cnpj/${encodeURIComponent(document)}`, { cache: "no-store" })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.company) throw new Error(payload?.error || `Falha ao consultar CNPJ (HTTP ${response.status}).`)
      const company = payload.company as CnpjCompany
      if (target === "client") {
        setClient((current) => ({
          ...current,
          type: "PJ",
          document: company.document,
          name: company.legalName || current.name,
          corporateName: company.legalName || current.corporateName,
          tradeName: company.tradeName || current.tradeName,
          phone: company.phone || current.phone,
          mobile: company.phone || current.mobile,
          email: company.email || current.email,
          zipCode: company.zipCode || current.zipCode,
          street: company.street || current.street,
          number: company.number || current.number,
          complement: company.complement || current.complement,
          district: company.district || current.district,
          city: company.city || current.city,
          state: company.state || current.state,
          notes: withCnpjNotes(current.notes, company),
        }))
      } else {
        setSupplier((current) => ({
          ...current,
          document: company.document,
          name: company.tradeName || company.legalName || current.name,
          phone: company.phone || current.phone,
          email: company.email || current.email,
          city: company.city || current.city,
          state: company.state || current.state,
          notes: withCnpjNotes(current.notes, company),
        }))
      }
      toast({ title: "CNPJ encontrado", description: `${company.tradeName || company.legalName} preenchido automaticamente.` })
    } catch (error) {
      toast({ title: "Nao foi possivel consultar o CNPJ", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" })
    } finally {
      setCnpjLookupTarget("")
    }
  }

  function close() {
    setSheet("")
    setStep(0)
    setOrderMaterials([])
    setOrderMaterial({ materialId: "", quantity: "1", notes: "" })
    setSelectedLocals([])
    setSelectedFloors([])
    setSelectedFinals([])
    setSelectedEnvironments([])
    setSelectedPoints([])
    setSelectedServices([])
    setOrderKits([])
    setOrderKit({ kitId: "", quantity: "1", notes: "" })
  }

  async function saveClient(openWorkAfter = false) {
    if (savingClientRef.current) return
    if (!requireFields([["Nome ou razao social", client.name], ["CPF/CNPJ", client.document]])) return
    const now = nowIso()
    const existing = state.clients.find((item) => item.id === client.id)
    const record: Client = { ...(client as any), monthlyPmocValue: (client.serviceContexts || []).includes("pmoc") ? Math.max(0, Number(client.monthlyPmocValue || 0)) : 0, id: existing?.id || client.id || makeId("client"), createdAt: existing?.createdAt || now, updatedAt: now }
    savingClientRef.current = true
    setSavingClient(true)
    setClient((current) => ({ ...current, id: record.id }))
    try {
      const response = await fetch("/api/clients", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client: record }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || `Falha ao salvar cliente (HTTP ${response.status}).`)
      const saved: Client = payload.client
      commit((current) => ({
        ...current,
        clients: [saved, ...current.clients.filter((item) => item.id !== saved.id)],
        auditLogs: appendAudit(current, "client", saved.id, existing ? "Editado" : "Criado", `Cliente ${saved.name} ${existing ? "editado" : "criado"}`),
      }), { persist: false })
      setClient(emptyClient)
      toast({ title: existing ? "Cliente atualizado" : "Cliente salvo", description: "Cadastro atualizado no banco de dados." })
      if (openWorkAfter) {
        setWork({ ...emptyWork, clientId: saved.id, uniqueNumber: nextWorkNumber(state) })
        setSheet("work")
      } else {
        close()
      }
    } catch (error) {
      toast({ title: "Erro ao salvar no banco", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" })
    } finally {
      savingClientRef.current = false
      setSavingClient(false)
    }
  }

  async function saveClientEnvironment() {
    if (savingClientEnvironmentRef.current) return
    if (!requireFields([["Cliente", clientEnvironment.clientId], ["Ambiente", clientEnvironment.name]])) return
    const now = nowIso()
    const existing = (state.clientEnvironments || []).find((item) => item.id === clientEnvironment.id)
    const record: ClientEnvironment = {
      ...(clientEnvironment as any),
      id: existing?.id || clientEnvironment.id || makeId("client-env"),
      occupantsTotal: Math.max(0, Number(clientEnvironment.occupantsTotal || 0)),
      occupantsFixed: Math.max(0, Number(clientEnvironment.occupantsFixed || 0)),
      occupantsFloating: Math.max(0, Number(clientEnvironment.occupantsFloating || 0)),
      airConditionedArea: Math.max(0, Number(clientEnvironment.airConditionedArea || 0)),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    }
    savingClientEnvironmentRef.current = true
    setSavingClientEnvironment(true)
    // Keep the same ID after a failed request so a retry cannot create duplicates.
    setClientEnvironment((current) => ({ ...current, id: record.id }))
    try {
      const response = await fetch("/api/client-environments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ environment: record }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || `Falha ao salvar ambiente (HTTP ${response.status}).`)
      const saved: ClientEnvironment = payload.environment
      commit((current) => ({
        ...current,
        clientEnvironments: [saved, ...(current.clientEnvironments || []).filter((item) => item.id !== saved.id)],
        auditLogs: appendAudit(current, "client_environment", record.id, existing ? "Editado" : "Criado", `Ambiente ${record.name} ${existing ? "editado" : "criado"}`),
      }), { persist: false })
      setClientEnvironment(emptyClientEnvironment)
      toast({ title: existing ? "Ambiente atualizado" : "Ambiente salvo", description: "Ambiente vinculado ao cliente." })
      close()
    } catch (error) {
      toast({ title: "Erro ao salvar no banco", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" })
    } finally {
      savingClientEnvironmentRef.current = false
      setSavingClientEnvironment(false)
    }
  }

  async function saveClientEquipment() {
    if (savingClientEquipmentRef.current) return
    if (!requireFields([["Cliente", clientEquipment.clientId], ["Ambiente", clientEquipment.clientEnvironmentId], ["Equipamento", clientEquipment.name]])) return
    const now = nowIso()
    const existing = (state.clientEquipment || []).find((item) => item.id === clientEquipment.id)
    const record: ClientEquipment = {
      ...(clientEquipment as any),
      id: existing?.id || clientEquipment.id || makeId("client-eq"),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    }
    savingClientEquipmentRef.current = true
    setSavingClientEquipment(true)
    setClientEquipment((current) => ({ ...current, id: record.id }))
    try {
      const response = await fetch("/api/client-equipment", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ equipment: record }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || `Falha ao salvar equipamento (HTTP ${response.status}).`)
      const saved: ClientEquipment = payload.equipment
      commit((current) => ({
        ...current,
        clientEquipment: [saved, ...(current.clientEquipment || []).filter((item) => item.id !== saved.id)],
        auditLogs: appendAudit(current, "client_equipment", saved.id, existing ? "Editado" : "Criado", `Equipamento ${saved.name} salvo`),
      }), { persist: false })
      setClientEquipment(emptyClientEquipment)
      toast({ title: existing ? "Equipamento atualizado" : "Equipamento salvo", description: "Equipamento vinculado ao ambiente do cliente." })
      close()
    } catch (error) {
      toast({ title: "Erro ao salvar no banco", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" })
    } finally {
      savingClientEquipmentRef.current = false
      setSavingClientEquipment(false)
    }
  }

  async function saveSupplier() {
    if (savingSupplierRef.current) return
    if (!requireFields([["Fornecedor", supplier.name], ["Telefone", supplier.phone]])) return
    const now = nowIso()
    const existing = (state.suppliers || []).find((item) => item.id === supplier.id)
    const categoryIds = Array.from(new Set((supplier.categoryIds || []).filter(Boolean))) as string[]
    const selectedCategoryNames = categoryIds.map((id) => supplierCategories.find((item) => item.id === id)?.name).filter(Boolean) as string[]
    const record: Supplier = { ...(supplier as any), id: existing?.id || supplier.id || makeId("supplier"), categoryIds, category: selectedCategoryNames.join(", ") || supplier.category || "", createdAt: existing?.createdAt || now, updatedAt: now }
    savingSupplierRef.current = true
    setSavingSupplier(true)
    setSupplier((current) => ({ ...current, id: record.id }))
    try {
      const response = await fetch("/api/suppliers", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ supplier: record }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || `Falha ao salvar fornecedor (HTTP ${response.status}).`)
      const saved: Supplier = payload.supplier
      commit((current) => ({
        ...current,
        suppliers: [saved, ...(current.suppliers || []).filter((item) => item.id !== saved.id)],
        auditLogs: appendAudit(current, "supplier", saved.id, existing ? "Editado" : "Criado", `Fornecedor ${saved.name} ${existing ? "editado" : "criado"}`),
      }), { persist: false })
      setSupplier(emptySupplier)
      toast({ title: existing ? "Fornecedor atualizado" : "Fornecedor salvo", description: "Cadastro atualizado no banco de dados." })
      close()
    } catch (error) {
      toast({ title: "Erro ao salvar no banco", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" })
    } finally {
      savingSupplierRef.current = false
      setSavingSupplier(false)
    }
  }

  function saveWork(openStructureAfter = false) {
    const number = work.uniqueNumber || nextWorkNumber(state)
    if (!requireFields([["Cliente", work.clientId], ["Nome da obra", work.name]])) return
    const now = nowIso()
    const record: Work = { id: makeId("work"), ...(work as any), uniqueNumber: number, createdAt: now, updatedAt: now }
    commit((current) => ({ ...current, works: [record, ...current.works], auditLogs: appendAudit(current, "work", record.id, "Criada", `Obra ${record.name} criada`) }))
    setWork(emptyWork)
    toast({ title: "Obra salva", description: "Obra vinculada ao cliente." })
    if (openStructureAfter) {
      setStructure({ ...emptyStructure, workId: record.id })
      setSheet("structure")
    } else {
      close()
    }
  }

  function saveFloor() {
    if (!requireFields([["Obra/Local", floor.workId], ["Pavimento", floor.name]])) return
    const now = nowIso()
    const record: WorkFloor = { id: makeId("floor"), workId: floor.workId, name: floor.name, status: floor.status, notes: floor.notes, createdAt: now, updatedAt: now }
    commit((current) => ({ ...current, workFloors: [record, ...current.workFloors], auditLogs: appendAudit(current, "work_floor", record.id, "Criado", `Pavimento ${record.name} criado`) }))
    toast({ title: "Pavimento salvo", description: "Agora ele pode ser usado no cadastro de ambientes e na OS." })
    setFloor(emptyFloor)
    close()
  }

  function saveStructure(addAnother = false) {
    const selectedFloor = state.workFloors.find((item) => item.id === structure.floorId)
    if (!requireFields([["Obra/Local", structure.workId], ["Pavimento", structure.floorId], ["Final", structure.final], ["Ambiente", structure.environmentName], ["Tipo de servico", structure.serviceTypeId]])) return
    const now = nowIso()
    const environmentId = makeId("env")
    const record: WorkEnvironment = {
      id: environmentId,
      workId: structure.workId,
      floorId: structure.floorId,
      floor: selectedFloor?.name || structure.floor,
      final: structure.final,
      environmentName: structure.environmentName,
      serviceTypeId: structure.serviceTypeId,
      pointsQuantity: Number(structure.pointsQuantity || 0),
      notes: structure.notes,
      status: "Ativo",
      createdAt: now,
      updatedAt: now,
    }
    const points = Array.from({ length: Math.max(1, Number(structure.pointsQuantity || 1)) }, (_, index) => pointFromEnvironment(record, index + 1, now))
    const legacyStructure: WorkStructure = { id: makeId("structure"), workId: record.workId, location: record.final, floor: record.floor, environment: record.environmentName, pointsQuantity: record.pointsQuantity, requiredItems: [], notes: record.notes, status: "Ativa", createdAt: now, updatedAt: now }
    const photo = structure.photoFileName ? { id: makeId("envphoto"), environmentId, fileName: structure.photoFileName, photoType: structure.photoType, description: structure.photoDescription, uploadedBy: "local-user", createdAt: now } : null
    commit((current) => ({
      ...current,
      workEnvironments: [record, ...current.workEnvironments],
      workPoints: [...points, ...current.workPoints],
      environmentPhotos: photo ? [photo as any, ...current.environmentPhotos] : current.environmentPhotos,
      workStructures: [legacyStructure, ...current.workStructures],
      auditLogs: appendAudit(current, "work_environment", record.id, "Criado", `Ambiente ${record.environmentName} criado com ${points.length} pontos`),
    }))
    toast({ title: "Ambiente salvo", description: `${points.length} pontos criados automaticamente.` })
    setStructure(addAnother ? { ...emptyStructure, workId: record.workId } : emptyStructure)
    if (!addAnother) close()
  }

  function saveProvider() {
    if (!requireFields([["Nome", provider.fullName], ["Celular", provider.phone], ["Cargo", provider.role]])) return
    const now = nowIso()
    const existing = state.providers.find((item) => item.id === provider.id)
    const record: Provider = {
      ...(provider as any),
      id: existing?.id || provider.id || makeId("provider"),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    }
    commit((current) => ({
      ...current,
      providers: existing
        ? current.providers.map((item) => item.id === record.id ? record : item)
        : [record, ...current.providers],
      auditLogs: appendAudit(current, "provider", record.id, existing ? "Editado" : "Criado", `Prestador ${record.fullName} ${existing ? "editado" : "criado"}`),
    }))
    setProvider(emptyProvider)
    toast({ title: existing ? "Prestador atualizado" : "Prestador salvo" })
    close()
  }

  function saveVehicle() {
    if (!requireFields([["Placa", vehicle.plate], ["Modelo", vehicle.model], ["Marca", vehicle.brand]])) return
    const now = nowIso()
    const existing = state.vehicles.find((item) => item.id === vehicle.id)
    const record: Vehicle = {
      ...(vehicle as any),
      id: existing?.id || vehicle.id || makeId("vehicle"),
      currentKm: Number(vehicle.currentKm || 0),
      lastOilChangeKm: Number(vehicle.lastOilChangeKm || 0),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    }
    commit((current) => ({
      ...current,
      vehicles: existing
        ? current.vehicles.map((item) => item.id === record.id ? record : item)
        : [record, ...current.vehicles],
      auditLogs: appendAudit(current, "vehicle", record.id, existing ? "Editado" : "Criado", `Veiculo ${record.plate} ${existing ? "editado" : "criado"}`),
    }))
    setVehicle(emptyVehicle)
    toast({ title: existing ? "Veiculo atualizado" : "Veiculo salvo" })
    close()
  }

  async function saveOrder(sendToTeam = false) {
    const stockMaterials = combinedOrderMaterials()
    const kind = ((order.orderType || "obra") as ServiceOrderKind)
    const primaryServiceId = selectedServices[0] || order.serviceTypeId
    const primaryPointId = selectedPoints[0] || order.pointId
    const primaryPointRecord = state.workPoints.find((item) => item.id === primaryPointId)
    const primaryPointEnvironment = state.workEnvironments.find((item) => item.id === primaryPointRecord?.environmentId)
    const primaryEnvironmentId = kind === "obra"
      ? primaryPointEnvironment?.id || selectedEnvironments[0] || order.environmentId
      : selectedEnvironments[0] || order.environmentId
    const primaryFloorId = kind === "obra"
      ? primaryPointEnvironment?.floorId || primarySelectedFloorId || order.floorId
      : primarySelectedFloorId || order.floorId
    const primaryLocalId = kind === "obra"
      ? budgetMetaValue(primaryPointEnvironment?.notes, "tower_id") || selectedLocals[0] || order.workStructureId
      : selectedLocals[0] || order.workStructureId
    const primaryClientEquipmentId = selectedClientEquipment[0] || order.clientEquipmentId
    const primaryClientEquipment = state.clientEquipment.find((item) => item.id === primaryClientEquipmentId)
    const primaryClientEnvironmentId = primaryClientEquipment?.clientEnvironmentId || selectedClientEnvironments[0] || order.clientEnvironmentId
    const normalizedClientEnvironmentIds = Array.from(new Set([
      ...selectedClientEnvironments,
      ...selectedClientEquipment.map((equipmentId) => state.clientEquipment.find((item) => item.id === equipmentId)?.clientEnvironmentId || ""),
    ].filter(Boolean)))
    const selectedClient = state.clients.find((item) => item.id === order.clientId)
    const autoWorkName = `${kind === "pmoc" ? "PMOC" : "Servicos diversos"} - ${selectedClient?.name || "Cliente"}`
    const existingAutoWork = state.works.find((item) => item.clientId === order.clientId && item.type === (kind === "pmoc" ? "PMOC" : "Servicos diversos"))
    const autoWork: Work | null = kind !== "obra" && !order.workId && order.clientId ? {
      id: existingAutoWork?.id || makeId("work"),
      clientId: order.clientId,
      uniqueNumber: existingAutoWork?.uniqueNumber || nextWorkNumber(state),
      name: existingAutoWork?.name || autoWorkName,
      type: kind === "pmoc" ? "PMOC" : "Servicos diversos",
      status: existingAutoWork?.status || "Ativa",
      zipCode: selectedClient?.zipCode || "",
      street: selectedClient?.street || "",
      number: selectedClient?.number || "",
      complement: selectedClient?.complement || "",
      district: selectedClient?.district || "",
      city: selectedClient?.city || "",
      state: selectedClient?.state || "",
      responsibleName: selectedClient?.responsibleName || "",
      responsiblePhone: selectedClient?.mobile || selectedClient?.phone || "",
      responsibleEmail: selectedClient?.email || "",
      responsibleRole: "Responsavel",
      notes: `Local operacional criado automaticamente para OS de ${kind === "pmoc" ? "PMOC" : "servicos diversos"}.`,
      createdAt: existingAutoWork?.createdAt || nowIso(),
      updatedAt: nowIso(),
    } : null
    const effectiveWorkId = order.workId || autoWork?.id || ""
    const requiredFields: Array<[string, any]> = [["Cliente", order.clientId], ["Tipo de servico", primaryServiceId], ["Data prevista", order.scheduledDate]]
    if (kind === "obra") requiredFields.push(["Obra", effectiveWorkId])
    if (kind === "servicos") requiredFields.push(["Categoria do serviço", order.serviceCategory])
    if (kind === "pmoc" || (kind === "servicos" && !isTechnicalVisitCategory(order.serviceCategory))) {
      requiredFields.push(["Ambiente", primaryClientEnvironmentId], ["Equipamento", primaryClientEquipmentId])
    }
    if (!requireFields(requiredFields)) return
    if (kind === "obra" && !order.simpleService && !primaryPointId) {
      toast({ title: "Ponto obrigatorio", description: "Marque atendimento simples ou selecione um ponto da estrutura.", variant: "destructive" })
      return
    }
    const conflict = vehicleMaintenanceConflict(state, order.vehicleId, order.scheduledDate)
    if (conflict) {
      toast({ title: "Veiculo indisponivel", description: `Este veiculo esta em manutencao de ${formatDate(conflict.date)} ate ${formatDate(conflict.nextMaintenance || conflict.date)}.`, variant: "destructive" })
      return
    }
    const stockProblem = stockMaterials.find((row) => {
      const mat = state.materials.find((item) => item.id === row.materialId)
      return !mat || row.quantity <= 0 || row.quantity > materialStock(mat)
    })
    if (stockProblem) {
      const mat = state.materials.find((item) => item.id === stockProblem.materialId)
      toast({ title: "Material sem saldo", description: `${mat?.name || "Material"} tem saldo ${mat ? materialStock(mat) : 0} ${mat?.unit || ""}. Ajuste a quantidade antes de criar a OS.`, variant: "destructive" })
      return
    }
    const existing = state.serviceOrders.find((item) => item.id === order.id)
    const id = existing?.id || makeId("order")
    const now = nowIso()
    const selectionSnapshot: OrderSelectionSnapshot = {
      localIds: selectedLocals,
      floorIds: selectedFloors,
      finalKeys: selectedFinals,
      environmentIds: selectedEnvironments,
      pointIds: selectedPoints,
      clientEnvironmentIds: normalizedClientEnvironmentIds,
      clientEquipmentIds: selectedClientEquipment,
      serviceTypeIds: selectedServices,
      kitSelections: orderKits,
      materialSelections: orderMaterials,
    }
    const baseNotes = cleanOrderSelectionNotes(order.notes)
    const record: ServiceOrder = {
      id,
      orderNumber: existing?.orderNumber || nextOrderNumber(state),
      orderType: kind,
      serviceCategory: kind === "servicos" ? order.serviceCategory as any : "",
      clientId: order.clientId,
      workId: effectiveWorkId,
      clientEnvironmentId: kind === "obra" ? "" : primaryClientEnvironmentId,
      clientEquipmentId: kind === "obra" ? "" : primaryClientEquipmentId,
      workStructureId: primaryLocalId,
      floorId: primaryFloorId,
      environmentId: primaryEnvironmentId,
      pointId: primaryPointId,
      simpleService: kind !== "obra" ? true : Boolean(order.simpleService),
      serviceTypeId: primaryServiceId,
      priority: order.priority as any,
      description: order.description,
      scheduledDate: order.scheduledDate,
      scheduledStartTime: order.scheduledStartTime,
      scheduledEndTime: order.scheduledEndTime,
      estimatedDuration: order.estimatedDuration,
      allowReschedule: Boolean(order.allowReschedule),
      scheduleNotes: order.scheduleNotes,
      mainProviderId: order.mainProviderId,
      helperProviderId: order.helperProviderId,
      supervisorId: order.supervisorId,
      vehicleId: order.vehicleId,
      initialKm: Number(order.initialKm || 0),
      finalKm: 0,
      totalAmount: orderTotalAmount(),
      status: sendToTeam ? normalizeStatus("Agendada") : (existing?.status || normalizeStatus("Criada")),
      customerResponsibleName: order.customerResponsibleName,
      customerResponsiblePhone: order.customerResponsiblePhone,
      teamNotes: order.teamNotes,
      notes: [
        baseNotes,
        `Selecoes OS JSON: ${JSON.stringify(selectionSnapshot)}`,
        selectedLocals.length ? `Locais/Torres selecionados: ${selectedLabels(selectedLocals, (id) => localOptions.find((item) => item.value === id)?.label || id)}` : "",
        selectedFloors.length ? `Pavimentos selecionados: ${selectedLabels(selectedFloors, (id) => floorOptions.find((item) => item.value === id)?.name || names(state).floor(id.split("|")[0]) || id)}` : "",
        selectedFinals.length ? `Finais/Tipos selecionados: ${selectedLabels(selectedFinals, (id) => finalOptions.find((item) => item.value === id)?.label || id)}` : "",
        selectedEnvironments.length ? `Ambientes selecionados: ${selectedLabels(selectedEnvironments, (id) => names(state).environment(id) || id)}` : "",
        selectedPoints.length ? `Pontos selecionados: ${selectedLabels(selectedPoints, (id) => names(state).point(id) || id)}` : "",
        normalizedClientEnvironmentIds.length ? `Ambientes do cliente selecionados: ${selectedLabels(normalizedClientEnvironmentIds, (id) => state.clientEnvironments.find((item) => item.id === id)?.name || id)}` : "",
        selectedClientEquipment.length ? `Equipamentos selecionados: ${selectedLabels(selectedClientEquipment, (id) => state.clientEquipment.find((item) => item.id === id)?.name || id)}` : "",
        selectedServices.length ? `Servicos selecionados: ${selectedLabels(selectedServices, (id) => names(state).serviceType(id) || id)}` : "",
        orderKits.length ? `Kits selecionados: ${orderKits.map((row) => `${row.quantity}x ${state.stockKits.find((kit) => kit.id === row.kitId)?.name || "Kit"} (${money(kitUnitValue(row.kitId))} un.)`).join(", ")}` : "",
        orderMaterials.length ? `Materiais avulsos selecionados: ${orderMaterials.map((row) => `${row.quantity} ${state.materials.find((mat) => mat.id === row.materialId)?.unit || ""} - ${state.materials.find((mat) => mat.id === row.materialId)?.name || "Material"}`).join(", ")}` : "",
        orderKits.length ? `Valor dos kits: ${money(orderKitsAmount())}` : "",
        `Valor da OS: ${money(orderServiceAmount())}`,
        `Soma total da OS: ${money(orderTotalAmount())}`,
      ].filter(Boolean).join("\n"),
      pauseReason: "",
      cancellationReason: "",
      partialReason: "",
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      finishedAt: existing?.finishedAt || "",
      cancelledAt: existing?.cancelledAt || "",
    }
    const defaults = hydrateServiceOrderFromType(state, id, primaryServiceId)
    const selectedMaterials = stockMaterials.map<ServiceOrderMaterial>((row) => {
      const mat = state.materials.find((item) => item.id === row.materialId)
      return {
        id: makeId("osmat"),
        serviceOrderId: id,
        materialId: row.materialId,
        itemName: mat?.name || "Material",
        expectedQuantity: row.quantity,
        usedQuantity: row.quantity,
        unit: mat?.unit || "unidade",
        status: "Utilizado",
        notes: row.notes,
        createdAt: now,
        updatedAt: now,
      }
    })
    // Os materiais da OS são reservados no servidor e baixados quando a OS é finalizada.
    const nextMaterials = state.materials
    const workRecord = state.works.find((item) => item.id === record.workId)
    const floorRecord = state.workFloors.find((item) => item.id === record.floorId)
    const environmentRecord = state.workEnvironments.find((item) => item.id === record.environmentId)
    const pointRecord = primaryPointRecord || state.workPoints.find((item) => item.id === record.pointId)
    let savedRecord = record

    try {
      const response = await fetch("/api/ordens-servico", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order: record,
          work: workRecord || autoWork,
          floor: floorRecord,
          environment: environmentRecord,
          point: pointRecord,
          checklistItems: defaults.checklist,
          serviceOrderMaterials: selectedMaterials,
          includeChildren: !existing,
          auditDescription: `${record.orderNumber} ${existing ? "editada" : "criada"}`,
        }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.error || `Erro ${response.status}`)
      }
      const payload = await response.json().catch(() => null)
      if (payload?.data) savedRecord = { ...record, ...payload.data }
    } catch (error) {
      toast({
        title: "Erro ao salvar OS no banco",
        description: error instanceof Error ? error.message : "Tente novamente.",
        variant: "destructive",
      })
      return
    }
    commit((current) => ({
      ...current,
      works: (autoWork && !current.works.some((item) => item.id === autoWork.id) ? [autoWork, ...current.works] : current.works).map((item) => item.id === savedRecord.workId && !item.clientId ? { ...item, clientId: savedRecord.clientId, updatedAt: now } : item),
      serviceOrders: existing ? current.serviceOrders.map((item) => item.id === savedRecord.id ? savedRecord : item) : [savedRecord, ...current.serviceOrders],
      checklistItems: existing ? current.checklistItems : [...defaults.checklist, ...current.checklistItems],
      serviceOrderMaterials: existing ? current.serviceOrderMaterials : [...selectedMaterials, ...current.serviceOrderMaterials],
      materials: nextMaterials,
      auditLogs: appendAudit(current, "service_order", id, existing ? "Editada" : "Criada", `${savedRecord.orderNumber} ${existing ? "editada" : "criada"}`),
    }), { persist: false })
    setOrder(emptyOrder)
    toast({ title: existing ? "OS atualizada" : "OS criada", description: existing ? "Alterações salvas." : sendToTeam ? "Enviada para equipe." : "Salva como Criada." })
    close()
  }

  async function saveMaterial() {
    if (!requireFields([["Nome do material", material.name], ["Unidade", material.unit]])) return
    const existing = material.id ? state.materials.find((item) => item.id === material.id) : undefined
    const invalid = validateMaterialForm(material, state.materials, existing?.id)
    if (invalid) {
      toast({ title: "Revise o cadastro", description: invalid, variant: "destructive" })
      return
    }
    let record = materialRecordFromForm(material, existing, existing?.id || material.id || makeId("mat"))
    try {
      const response = await fetch("/api/estoque/materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ material: record }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
      // Saldo inicial vira movimentação no servidor; usa o item como ficou gravado.
      if (payload?.material) record = { ...record, ...payload.material }
    } catch (error) {
      toast({ title: "Erro ao salvar material no banco", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" })
      return
    }
    commit((current) => ({ ...current, materials: existing ? current.materials.map((item) => item.id === record.id ? record : item) : [record, ...current.materials], auditLogs: appendAudit(current, "material", record.id, existing ? "Editado" : "Criado", `Material ${record.name} ${existing ? "editado" : "criado"}`) }), { persist: false })
    close()
  }

  function addOrderMaterial() {
    const mat = state.materials.find((item) => item.id === orderMaterial.materialId)
    const quantity = Number(orderMaterial.quantity || 0)
    if (!mat || quantity <= 0) {
      toast({ title: "Material obrigatorio", description: "Escolha o material e informe a quantidade.", variant: "destructive" })
      return
    }
    const alreadyUsed = orderMaterials.filter((row) => row.materialId === mat.id).reduce((sum, row) => sum + row.quantity, 0)
    if (alreadyUsed + quantity > materialStock(mat)) {
      toast({ title: "Saldo insuficiente", description: `Saldo disponivel: ${materialStock(mat) - alreadyUsed} ${mat.unit}.`, variant: "destructive" })
      return
    }
    setOrderMaterials([...orderMaterials, { materialId: mat.id, quantity, notes: orderMaterial.notes }])
    setOrderMaterial({ materialId: "", quantity: "1", notes: "" })
  }

  function addOrderKit() {
    const kit = state.stockKits.find((item) => item.id === orderKit.kitId)
    const quantity = Number(orderKit.quantity || 0)
    if (!kit || quantity <= 0) {
      toast({ title: "Kit obrigatorio", description: "Escolha o kit e informe a quantidade.", variant: "destructive" })
      return
    }
    const nextKits = [...orderKits, { kitId: kit.id, quantity, notes: orderKit.notes }]
    const usage = expandedOrderKitMaterials(nextKits)
    const problem = usage.find((row) => {
      const mat = state.materials.find((item) => item.id === row.materialId)
      return !mat || row.quantity > materialStock(mat)
    })
    if (problem) {
      const mat = state.materials.find((item) => item.id === problem.materialId)
      toast({ title: "Saldo insuficiente", description: `${mat?.name || "Material"} tem saldo ${mat ? materialStock(mat) : 0} ${mat?.unit || ""}.`, variant: "destructive" })
      return
    }
    setOrderKits(nextKits)
    setOrderKit({ kitId: "", quantity: "1", notes: "" })
  }

  async function saveServiceType() {
    if (!requireFields([["Nome do servico", serviceType.name]])) return
    if (savingServiceType) return
    const now = nowIso()
    const serviceName = String(serviceType.name || "").trim()
    const existingService = state.serviceTypes.find((item) => item.id === serviceType.id) || state.serviceTypes.find((item) => item.name.trim().toLowerCase() === serviceName.toLowerCase())
    const id = existingService?.id || makeId("stype")
    const type = {
      id,
      name: serviceName,
      description: serviceType.description,
      status: serviceType.status,
      kitId: serviceType.kitId || "",
      executionPercentage: Number(serviceType.executionPercentage || 0),
      periodicityMonths: Number(serviceType.periodicityMonths || 1),
      enabledContexts: Array.isArray(serviceType.enabledContexts) && serviceType.enabledContexts.length ? serviceType.enabledContexts : defaultServiceContexts,
      requiredPhotos: [],
      orientationVideoUrl: "",
      orientationVideoDescription: "",
      createdAt: existingService?.createdAt || now,
      updatedAt: now,
    }
    const checklist = String(serviceType.tasks).split(";").map((task, index) => task.trim()).filter(Boolean).map((task, index) => ({ id: makeId("stcheck"), serviceTypeId: id, taskName: task, required: true, requiresPhoto: false, order: index + 1, notes: "" }))
    setSavingServiceType(true)
    try {
      const response = await fetch("/api/service-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceType: type, checklist }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || `Falha ao salvar (${response.status})`)
      const savedType = payload?.serviceType || type
      const savedChecklist = Array.isArray(payload?.checklist) ? payload.checklist : checklist.map((item) => ({ ...item, serviceTypeId: savedType.id }))
      const nextState = {
        ...state,
        serviceTypes: state.serviceTypes.some((item) => item.id === savedType.id || item.name.trim().toLowerCase() === savedType.name.trim().toLowerCase())
          ? state.serviceTypes.map((item) => item.id === savedType.id || item.name.trim().toLowerCase() === savedType.name.trim().toLowerCase() ? savedType as any : item)
          : [savedType as any, ...state.serviceTypes],
        serviceTypeChecklistItems: [...savedChecklist, ...state.serviceTypeChecklistItems.filter((item) => item.serviceTypeId !== savedType.id)],
        auditLogs: appendAudit(state, "service_type", savedType.id, existingService ? "Editado" : "Criado", `Tipo ${savedType.name} ${existingService ? "editado" : "criado"}`),
      }
      saveOperationalState(nextState)
      commit(() => nextState, { persist: false } as any)
      toast({ title: existingService ? "Serviço atualizado" : "Serviço salvo", description: "Cadastro gravado no Supabase." })
    } catch (error) {
      toast({ title: "Erro ao salvar serviço no banco", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" })
      return
    } finally {
      setSavingServiceType(false)
    }
    close()
  }

  async function saveUser() {
    const editingUser = Boolean(user.id)
    const requiredFields: Array<[string, unknown]> = [["Nome", user.name], ["E-mail", user.email], ["Perfil", user.profile]]
    if (!editingUser) requiredFields.push(["Senha", user.temporaryPassword])
    if (!requireFields(requiredFields)) return
    if (user.profile === "Cliente" && !user.clientId) {
      toast({ title: "Empresa obrigatoria", description: "Selecione qual empresa este usuario cliente podera visualizar.", variant: "destructive" })
      return
    }
    const permissions = (Array.isArray(user.permissions) ? user.permissions : String(user.permissions || "").split(","))
      .map((item: string) => item.trim())
      .filter((item: string): item is PagePermission => selectablePagePermissions.includes(item as PagePermission))
    const roleMap: Record<string, string> = {
      Administrador: "admin",
      Supervisor: "manager",
      Atendimento: "sdr",
      Tecnico: "user",
      Técnico: "user",
      Cliente: "client",
    }
    if ((roleMap[user.profile] || "user") !== "admin" && !permissions.length) {
      toast({ title: "Selecione as paginas", description: "Marque pelo menos uma pagina que este usuario podera acessar.", variant: "destructive" })
      return
    }
    try {
      const response = await fetch(editingUser ? `/api/users/${user.id}` : "/api/users/create", {
        method: editingUser ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: user.name,
          email: user.email,
          password: user.temporaryPassword,
          phone: user.phone,
          role: roleMap[user.profile] || "user",
          permissions,
          clientId: user.profile === "Cliente" ? user.clientId : null,
          active: user.status !== "Inativo",
        }),
      })
      const payload = await response.json()
      if (!response.ok) {
        toast({ title: editingUser ? "Erro ao editar usuario" : "Erro ao criar usuario", description: payload.error || "Nao foi possivel salvar no Supabase Auth.", variant: "destructive" })
        return
      }
      const record = { id: editingUser ? user.id : payload.user.id, name: user.name, email: user.email, phone: user.phone, profile: user.profile, temporaryPassword: "", status: user.status, permissions, clientId: user.profile === "Cliente" ? user.clientId : "" }
      commit((current) => ({ ...current, systemUsers: [record as any, ...current.systemUsers.filter((row) => row.id !== record.id && row.email !== record.email)], auditLogs: appendAudit(current, "system_user", record.id, editingUser ? "Editado" : "Criado", `Usuario ${record.name} ${editingUser ? "editado" : "criado"} no Supabase Auth`) }), { persist: false } as any)
      toast({ title: editingUser ? "Usuario atualizado" : "Usuario criado", description: editingUser ? "As alteracoes ja valem no proximo acesso." : "Login e senha ja podem ser usados na tela de login." })
      close()
    } catch (error) {
      toast({ title: "Erro ao criar usuario", description: error instanceof Error ? error.message : "Falha ao chamar API.", variant: "destructive" })
    }
  }

  return (
    <>
      <FormSheet open={sheet === "client"} onOpenChange={(open) => !open && close()} title="Cadastro de Cliente" description="Dados principais, endereco e dados comerciais.">
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField label="Tipo de cliente" value={client.type} onChange={(value) => setClient({ ...client, type: value })} options={[{ value: "PF", label: "Pessoa Fisica" }, { value: "PJ", label: "Pessoa Juridica" }]} />
          <SelectField label="Status" value={client.status} onChange={(value) => setClient({ ...client, status: value })} options={["Ativo", "Inativo", "Prospect"].map((value) => ({ value, label: value }))} />
          <TextField label={client.type === "PF" ? "Nome completo" : "Razao social"} value={client.name} onChange={(value) => setClient({ ...client, name: value })} />
          <CnpjLookupField value={client.document} onChange={(value) => {
            const length = cleanCpfCnpj(value).length
            setClient({ ...client, document: value, type: length === 11 ? "PF" : length === 14 ? "PJ" : client.type })
          }} onLookup={() => lookupCnpj("client")} loading={cnpjLookupTarget === "client"} />
          {client.type === "PJ" ? <TextField label="Nome fantasia" value={client.tradeName} onChange={(value) => setClient({ ...client, tradeName: value })} /> : null}
          {client.type === "PJ" ? <TextField label="Inscricao estadual" value={client.stateRegistration} onChange={(value) => setClient({ ...client, stateRegistration: value })} /> : null}
          <TextField label="Responsavel" value={client.responsibleName} onChange={(value) => setClient({ ...client, responsibleName: value })} />
          <TextField label="Telefone/Celular" value={client.mobile || client.phone} onChange={(value) => setClient({ ...client, mobile: value, phone: value })} />
          <TextField label="E-mail" value={client.email} onChange={(value) => setClient({ ...client, email: value })} />
          <TextField label="CEP" value={client.zipCode} onChange={(value) => setClient({ ...client, zipCode: value })} />
          <TextField label="Rua" value={client.street} onChange={(value) => setClient({ ...client, street: value })} />
          <TextField label="Numero" value={client.number} onChange={(value) => setClient({ ...client, number: value })} />
          <TextField label="Complemento" value={client.complement} onChange={(value) => setClient({ ...client, complement: value })} />
          <TextField label="Bairro" value={client.district} onChange={(value) => setClient({ ...client, district: value })} />
          <TextField label="Cidade" value={client.city} onChange={(value) => setClient({ ...client, city: value })} />
          <TextField label="Estado" value={client.state} onChange={(value) => setClient({ ...client, state: value })} />
        </div>
        <div className="space-y-2">
          <Label>Tipos de serviço do cliente</Label>
          <div className="grid gap-2 sm:grid-cols-3">
            {serviceContextOptions.map((context) => {
              const checked = (client.serviceContexts || []).includes(context)
              return (
                <label key={context} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(value) => setClient({
                      ...client,
                      serviceContexts: value
                        ? Array.from(new Set([...(client.serviceContexts || []), context]))
                        : (client.serviceContexts || []).filter((item: ServiceOrderKind) => item !== context),
                      monthlyPmocValue: context === "pmoc" && !value ? 0 : client.monthlyPmocValue,
                    })}
                  />
                  <span>{serviceContextLabels[context]}</span>
                </label>
              )
            })}
          </div>
        </div>
        {(client.serviceContexts || []).includes("pmoc") ? (
          <TextField label="Valor mensal do PMOC (R$)" type="number" value={client.monthlyPmocValue || ""} onChange={(value) => setClient({ ...client, monthlyPmocValue: value })} placeholder="0,00" />
        ) : null}
        <TextAreaField label="Observacoes" value={client.notes} onChange={(value) => setClient({ ...client, notes: value })} />
        <div className="flex flex-wrap gap-2">
          <SaveButton onClick={() => saveClient(false)} disabled={savingClient}>{savingClient ? "Salvando..." : "Salvar cliente"}</SaveButton>
          <Button variant="secondary" onClick={() => saveClient(true)} disabled={savingClient}>Salvar e criar obra</Button>
          <Button variant="outline" onClick={close}>Cancelar</Button>
        </div>
      </FormSheet>

      <FormSheet open={sheet === "clientEnvironment"} onOpenChange={(open) => !open && close()} title={clientEnvironment.id ? "Editar ambiente do cliente" : "Ambiente do cliente"} description="Ambientes cadastrados aqui aparecem nas OS de PMOC e Servicos diversos.">
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField label="Cliente" value={clientEnvironment.clientId || "nenhum"} onChange={(value) => setClientEnvironment({ ...clientEnvironment, clientId: value === "nenhum" ? "" : value })} options={[{ value: "nenhum", label: "Selecione um cliente" }, ...state.clients.map((item) => ({ value: item.id, label: item.name, disabled: item.status === "Inativo" }))]} />
          <SelectField label="Status" value={clientEnvironment.status} onChange={(value) => setClientEnvironment({ ...clientEnvironment, status: value })} options={["Ativo", "Inativo"].map((value) => ({ value, label: value }))} />
          <TextField label="Nome do ambiente" value={clientEnvironment.name} onChange={(value) => setClientEnvironment({ ...clientEnvironment, name: value })} placeholder="Sala tecnica, Recepcao, Suite 01..." />
          <TextField label="Pavimento/Setor" value={clientEnvironment.floor} onChange={(value) => setClientEnvironment({ ...clientEnvironment, floor: value })} />
          <TextField label="Localizacao" value={clientEnvironment.location} onChange={(value) => setClientEnvironment({ ...clientEnvironment, location: value })} />
          <TextField label="Tipo de atividade" value={clientEnvironment.activityType} onChange={(value) => setClientEnvironment({ ...clientEnvironment, activityType: value })} placeholder="Escritorio, recepcao, loja..." />
          <TextField label="Nº de ocupantes" type="number" value={clientEnvironment.occupantsTotal} onChange={(value) => setClientEnvironment({ ...clientEnvironment, occupantsTotal: value })} />
          <TextField label="Ocupantes fixos" type="number" value={clientEnvironment.occupantsFixed} onChange={(value) => setClientEnvironment({ ...clientEnvironment, occupantsFixed: value })} />
          <TextField label="Ocupantes flutuantes" type="number" value={clientEnvironment.occupantsFloating} onChange={(value) => setClientEnvironment({ ...clientEnvironment, occupantsFloating: value })} />
          <TextField label="Area climatizada (m²)" type="number" value={clientEnvironment.airConditionedArea} onChange={(value) => setClientEnvironment({ ...clientEnvironment, airConditionedArea: value })} />
        </div>
        <TextAreaField label="Observacoes" value={clientEnvironment.notes} onChange={(value) => setClientEnvironment({ ...clientEnvironment, notes: value })} />
        <SaveButton onClick={saveClientEnvironment} disabled={savingClientEnvironment}>{savingClientEnvironment ? "Salvando..." : "Salvar ambiente"}</SaveButton>
      </FormSheet>

      <FormSheet open={sheet === "clientEquipment"} onOpenChange={(open) => !open && close()} title={clientEquipment.id ? "Editar equipamento" : "Equipamento do cliente"} description="Equipamentos cadastrados aqui ficam vinculados ao ambiente do cliente.">
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField label="Cliente" value={clientEquipment.clientId || "nenhum"} onChange={(value) => setClientEquipment({ ...clientEquipment, clientId: value === "nenhum" ? "" : value, clientEnvironmentId: "" })} options={[{ value: "nenhum", label: "Selecione um cliente" }, ...state.clients.map((item) => ({ value: item.id, label: item.name, disabled: item.status === "Inativo" }))]} />
          <SearchableSelectField
            label="Ambiente"
            value={clientEquipment.clientEnvironmentId}
            onChange={(value) => setClientEquipment({ ...clientEquipment, clientEnvironmentId: value })}
            options={equipmentEnvironmentOptions.map((item) => ({ value: item.id, label: [item.name, item.floor, item.location].filter(Boolean).join(" - ") }))}
            placeholder={equipmentEnvironmentOptions.length ? "Selecione um ambiente" : "Nenhum ambiente cadastrado"}
            searchPlaceholder="Pesquisar ambiente..."
            emptyLabel="Nenhum ambiente encontrado."
          />
          <TextField label="TAG" value={clientEquipment.tag} onChange={(value) => setClientEquipment({ ...clientEquipment, tag: value })} placeholder="Identificacao do equipamento" />
          <TextField label="Nome do equipamento" value={clientEquipment.name} onChange={(value) => setClientEquipment({ ...clientEquipment, name: value })} />
          <TextField label="Capacidade" value={clientEquipment.capacity} onChange={(value) => setClientEquipment({ ...clientEquipment, capacity: value })} placeholder="12.000 BTUs, 5 TR..." />
          <TextField label="Nº de serie" value={clientEquipment.serialNumber} onChange={(value) => setClientEquipment({ ...clientEquipment, serialNumber: value })} />
          <TextField label="Tipo" value={clientEquipment.type} onChange={(value) => setClientEquipment({ ...clientEquipment, type: value })} placeholder="Split, VRF, Chiller..." />
          <TextField label="Marca" value={clientEquipment.brand} onChange={(value) => setClientEquipment({ ...clientEquipment, brand: value })} />
          <TextField label="Modelo" value={clientEquipment.model} onChange={(value) => setClientEquipment({ ...clientEquipment, model: value })} />
          <SelectField label="Status" value={clientEquipment.status} onChange={(value) => setClientEquipment({ ...clientEquipment, status: value })} options={["Ativo", "Inativo"].map((value) => ({ value, label: value }))} />
        </div>
        <TextAreaField label="Observacoes" value={clientEquipment.notes} onChange={(value) => setClientEquipment({ ...clientEquipment, notes: value })} />
        <SaveButton onClick={saveClientEquipment} disabled={savingClientEquipment}>{savingClientEquipment ? "Salvando..." : "Salvar equipamento"}</SaveButton>
      </FormSheet>

      <FormSheet open={sheet === "supplier"} onOpenChange={(open) => !open && close()} title="Cadastro de Fornecedor" description="Dados do fornecedor para compras, contratos e financeiro.">
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label="Fornecedor" value={supplier.name} onChange={(value) => setSupplier({ ...supplier, name: value })} />
          <CnpjLookupField value={supplier.document} onChange={(value) => setSupplier({ ...supplier, document: value })} onLookup={() => lookupCnpj("supplier")} loading={cnpjLookupTarget === "supplier"} />
          <TextField label="Contato" value={supplier.contactName} onChange={(value) => setSupplier({ ...supplier, contactName: value })} />
          <TextField label="Telefone" value={supplier.phone} onChange={(value) => setSupplier({ ...supplier, phone: value })} />
          <TextField label="E-mail" value={supplier.email} onChange={(value) => setSupplier({ ...supplier, email: value })} />
          <div className="space-y-3 md:col-span-2">
            <SearchableSelectField
              label="Categorias do fornecedor"
              value=""
              onChange={(categoryId) => setSupplier({ ...supplier, categoryIds: Array.from(new Set([...(supplier.categoryIds || []), categoryId])) })}
              options={supplierCategories.filter((item) => !(supplier.categoryIds || []).includes(item.id)).map((item) => ({ value: item.id, label: item.name }))}
              placeholder={supplierCategoriesLoading ? "Carregando categorias..." : "Pesquisar e adicionar categoria"}
              searchPlaceholder="Pesquisar categoria..."
              emptyLabel="Nenhuma categoria disponível."
            />
            {supplierCategoriesError ? <AlertRow>{supplierCategoriesError}</AlertRow> : null}
            <div className="flex min-h-10 flex-wrap gap-2 rounded-md border p-2">
              {(supplier.categoryIds || []).map((categoryId: string) => {
                const category = supplierCategories.find((item) => item.id === categoryId)
                return (
                  <Badge key={categoryId} variant="secondary" className="gap-1 py-1 pl-2 pr-1">
                    {category?.name || categoryId}
                    <Button type="button" size="icon" variant="ghost" className="h-5 w-5" title="Remover categoria" onClick={() => setSupplier({ ...supplier, categoryIds: (supplier.categoryIds || []).filter((id: string) => id !== categoryId) })}>
                      <X className="h-3 w-3" />
                    </Button>
                  </Badge>
                )
              })}
              {!(supplier.categoryIds || []).length ? <span className="px-1 text-sm text-muted-foreground">Nenhuma categoria vinculada.</span> : null}
            </div>
          </div>
          <TextField label="Cidade" value={supplier.city} onChange={(value) => setSupplier({ ...supplier, city: value })} />
          <TextField label="Estado" value={supplier.state} onChange={(value) => setSupplier({ ...supplier, state: value })} />
          <SelectField label="Status" value={supplier.status} onChange={(value) => setSupplier({ ...supplier, status: value })} options={["Ativo", "Inativo"].map((value) => ({ value, label: value }))} />
        </div>
        <TextAreaField label="Observações" value={supplier.notes} onChange={(value) => setSupplier({ ...supplier, notes: value })} />
        <div className="flex flex-wrap gap-2">
          <SaveButton onClick={saveSupplier} disabled={savingSupplier}>{savingSupplier ? "Salvando..." : "Salvar fornecedor"}</SaveButton>
          <Button variant="outline" onClick={close}>Cancelar</Button>
        </div>
      </FormSheet>

      <FormSheet open={sheet === "work"} onOpenChange={(open) => !open && close()} title="Cadastro de Obra" description="Obra ou local de atendimento vinculado ao cliente.">
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField label="Cliente vinculado" value={work.clientId || preset?.clientId || ""} onChange={(value) => setWork({ ...work, clientId: value })} options={state.clients.map((item) => ({ value: item.id, label: item.name, disabled: item.status === "Inativo" }))} />
          <TextField label="Numero unico" value={work.uniqueNumber || nextWorkNumber(state)} onChange={(value) => setWork({ ...work, uniqueNumber: value })} />
          <TextField label="Nome da obra" value={work.name} onChange={(value) => setWork({ ...work, name: value })} />
          <SelectField label="Tipo de obra" value={work.type} onChange={(value) => setWork({ ...work, type: value })} options={["Residencial", "Comercial", "Industrial", "Condominio", "Outro"].map((value) => ({ value, label: value }))} />
          <SelectField label="Status da obra" value={work.status} onChange={(value) => setWork({ ...work, status: value })} options={["Ativa", "Em execucao", "Pausada", "Finalizada", "Inativa"].map((value) => ({ value, label: value }))} />
          <TextField label="CEP" value={work.zipCode} onChange={(value) => setWork({ ...work, zipCode: value })} />
          <TextField label="Rua" value={work.street} onChange={(value) => setWork({ ...work, street: value })} />
          <TextField label="Numero" value={work.number} onChange={(value) => setWork({ ...work, number: value })} />
          <TextField label="Cidade" value={work.city} onChange={(value) => setWork({ ...work, city: value })} />
          <TextField label="Estado" value={work.state} onChange={(value) => setWork({ ...work, state: value })} />
          <TextField label="Responsavel" value={work.responsibleName} onChange={(value) => setWork({ ...work, responsibleName: value })} />
          <TextField label="Telefone responsavel" value={work.responsiblePhone} onChange={(value) => setWork({ ...work, responsiblePhone: value })} />
        </div>
        <TextAreaField label="Observacoes gerais" value={work.notes} onChange={(value) => setWork({ ...work, notes: value })} />
        <div className="flex flex-wrap gap-2">
          <SaveButton onClick={() => saveWork(false)}>Salvar obra</SaveButton>
          <Button variant="secondary" onClick={() => saveWork(true)}>Salvar e cadastrar estrutura</Button>
          <Button variant="outline" onClick={close}>Cancelar</Button>
        </div>
      </FormSheet>

      <FormSheet open={sheet === "floor"} onOpenChange={(open) => !open && close()} title="Cadastrar Pavimento" description="Cadastre o pavimento antes de criar ambientes.">
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField label="Obra/Local" value={floor.workId} onChange={(value) => setFloor({ ...floor, workId: value })} options={state.works.map((item) => ({ value: item.id, label: `${item.uniqueNumber} - ${item.name}` }))} />
          <TextField label="Pavimento" value={floor.name} onChange={(value) => setFloor({ ...floor, name: value })} placeholder="Terreo, 1º andar, Cobertura..." />
          <SelectField label="Status" value={floor.status} onChange={(value) => setFloor({ ...floor, status: value })} options={["Ativo", "Inativo"].map((value) => ({ value, label: value }))} />
        </div>
        <TextAreaField label="Observacoes" value={floor.notes} onChange={(value) => setFloor({ ...floor, notes: value })} />
        <div className="flex flex-wrap gap-2">
          <SaveButton onClick={saveFloor}>Salvar pavimento</SaveButton>
          <Button variant="outline" onClick={close}>Cancelar</Button>
        </div>
      </FormSheet>

      <FormSheet open={sheet === "structure"} onOpenChange={(open) => !open && close()} title="Cadastrar Ambiente" description="Obra significa Local. O ambiente gera os pontos automaticamente.">
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField label="Obra/Local" value={structure.workId} onChange={(value) => setStructure({ ...structure, workId: value, floorId: "" })} options={state.works.map((item) => ({ value: item.id, label: `${item.uniqueNumber} - ${item.name}` }))} />
          <SelectField label="Pavimento" value={structure.floorId || "nenhum"} onChange={(value) => setStructure({ ...structure, floorId: value === "nenhum" ? "" : value, floor: state.workFloors.find((item) => item.id === value)?.name || "" })} options={[{ value: "nenhum", label: "Selecione um pavimento" }, ...state.workFloors.filter((item) => item.workId === structure.workId && item.status === "Ativo").map((item) => ({ value: item.id, label: item.name }))]} />
          <TextField label="Final" value={structure.final} onChange={(value) => setStructure({ ...structure, final: value })} placeholder="A, Final 01, Ala Norte..." />
          <TextField label="Ambiente" value={structure.environmentName} onChange={(value) => setStructure({ ...structure, environmentName: value })} />
          <SelectField label="Tipo de servico" value={structure.serviceTypeId} onChange={(value) => setStructure({ ...structure, serviceTypeId: value })} options={serviceTypesForWorks.map((item) => ({ value: item.id, label: item.name }))} />
          <TextField label="Quantidade de pontos" type="number" value={structure.pointsQuantity} onChange={(value) => setStructure({ ...structure, pointsQuantity: value })} />
          <SelectField label="Tipo da foto do ambiente" value={structure.photoType} onChange={(value) => setStructure({ ...structure, photoType: value })} options={["Antes", "Referência", "Local de instalação", "Problema encontrado", "Outro"].map((value) => ({ value, label: value }))} />
          <div className="space-y-2"><Label>Fotos do Ambiente</Label><Input type="file" accept="image/*" onChange={(event) => setStructure({ ...structure, photoFileName: event.target.files?.[0]?.name || "" })} /></div>
        </div>
        <TextAreaField label="Descricao da foto" value={structure.photoDescription} onChange={(value) => setStructure({ ...structure, photoDescription: value })} />
        <TextAreaField label="Observacoes" value={structure.notes} onChange={(value) => setStructure({ ...structure, notes: value })} />
        <div className="flex flex-wrap gap-2">
          <SaveButton onClick={() => saveStructure(false)}>Salvar ambiente</SaveButton>
          <Button variant="secondary" onClick={() => saveStructure(true)}>Salvar e adicionar outro ambiente</Button>
        </div>
      </FormSheet>

      <FormSheet open={sheet === "provider"} onOpenChange={(open) => !open && close()} title={provider.id ? "Editar Prestador" : "Cadastro de Prestador"}>
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label="Nome completo" value={provider.fullName} onChange={(value) => setProvider({ ...provider, fullName: value })} />
          <TextField label="CPF" value={provider.cpf} onChange={(value) => setProvider({ ...provider, cpf: value })} />
          <TextField label="RG" value={provider.rg} onChange={(value) => setProvider({ ...provider, rg: value })} />
          <TextField label="Data de nascimento" type="date" value={provider.birthDate} onChange={(value) => setProvider({ ...provider, birthDate: value })} />
          <TextField label="Celular" value={provider.phone} onChange={(value) => setProvider({ ...provider, phone: value })} />
          <TextField label="E-mail" value={provider.email} onChange={(value) => setProvider({ ...provider, email: value })} />
          <TextField label="Cidade" value={provider.city} onChange={(value) => setProvider({ ...provider, city: value })} />
          <SelectField label="Cargo" value={provider.role} onChange={(value) => setProvider({ ...provider, role: value })} options={["Diretor", "Conselheira", "Instalador de ar-condicionado", "Auxiliar Administrativo", "Auxiliar de instalador", "Gerente Administrativo", "Limpeza", "Ajudante Geral"].map((value) => ({ value, label: value }))} />
          <SelectField label="Vinculo" value={provider.relationshipType} onChange={(value) => setProvider({ ...provider, relationshipType: value })} options={["Funcionario", "Terceirizado", "Parceiro"].map((value) => ({ value, label: value }))} />
          <SelectField label="Status" value={provider.status} onChange={(value) => setProvider({ ...provider, status: value })} options={["Ativo", "Inativo", "Em ferias", "Bloqueado"].map((value) => ({ value, label: value }))} />
        </div>
        <TextAreaField label="Observacoes" value={provider.notes} onChange={(value) => setProvider({ ...provider, notes: value })} />
        <SaveButton onClick={saveProvider}>{provider.id ? "Salvar edições" : "Salvar prestador"}</SaveButton>
      </FormSheet>

      <FormSheet open={sheet === "vehicle"} onOpenChange={(open) => !open && close()} title="Cadastro de Veiculo">
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label="Placa" value={vehicle.plate} onChange={(value) => setVehicle({ ...vehicle, plate: value })} />
          <TextField label="Modelo" value={vehicle.model} onChange={(value) => setVehicle({ ...vehicle, model: value })} />
          <TextField label="Marca" value={vehicle.brand} onChange={(value) => setVehicle({ ...vehicle, brand: value })} />
          <TextField label="Ano" value={vehicle.year} onChange={(value) => setVehicle({ ...vehicle, year: value })} />
          <TextField label="Cor" value={vehicle.color} onChange={(value) => setVehicle({ ...vehicle, color: value })} />
          <TextField label="KM atual" type="number" value={vehicle.currentKm} onChange={(value) => setVehicle({ ...vehicle, currentKm: value })} />
          <SelectField label="Status" value={vehicle.status} onChange={(value) => setVehicle({ ...vehicle, status: value })} options={["Disponivel", "Em uso", "Em manutencao", "Inativo"].map((value) => ({ value, label: value }))} />
          <SelectField label="Pneu dianteiro direito" value={vehicle.frontRightTire} onChange={(value) => setVehicle({ ...vehicle, frontRightTire: value })} options={tireOptions.map((value) => ({ value, label: value }))} />
          <SelectField label="Pneu dianteiro esquerdo" value={vehicle.frontLeftTire} onChange={(value) => setVehicle({ ...vehicle, frontLeftTire: value })} options={tireOptions.map((value) => ({ value, label: value }))} />
          <SelectField label="Pneu traseiro direito" value={vehicle.rearRightTire} onChange={(value) => setVehicle({ ...vehicle, rearRightTire: value })} options={tireOptions.map((value) => ({ value, label: value }))} />
          <SelectField label="Pneu traseiro esquerdo" value={vehicle.rearLeftTire} onChange={(value) => setVehicle({ ...vehicle, rearLeftTire: value })} options={tireOptions.map((value) => ({ value, label: value }))} />
          <TextField label="Ultima troca de oleo - data" type="date" value={vehicle.lastOilChangeDate} onChange={(value) => setVehicle({ ...vehicle, lastOilChangeDate: value })} />
          <TextField label="Ultima troca de oleo - KM" type="number" value={vehicle.lastOilChangeKm} onChange={(value) => setVehicle({ ...vehicle, lastOilChangeKm: value })} />
          <TextField label="Renavam" value={vehicle.renavam} onChange={(value) => setVehicle({ ...vehicle, renavam: value })} />
          <TextField label="Vencimento licenciamento" type="date" value={vehicle.licensingDueDate} onChange={(value) => setVehicle({ ...vehicle, licensingDueDate: value })} />
        </div>
        <TextAreaField label="Seguro/observacoes" value={vehicle.insuranceInfo || vehicle.notes} onChange={(value) => setVehicle({ ...vehicle, insuranceInfo: value, notes: value })} />
        <SaveButton onClick={saveVehicle}>Salvar veiculo</SaveButton>
      </FormSheet>

      <FormSheet open={sheet === "order"} onOpenChange={(open) => !open && close()} title="Cadastro de Ordem de Servico" description={`Etapa ${step + 1} de 7`}>
        <Tabs value={String(step)} onValueChange={(value) => setStep(Number(value))}>
          <TabsList className="grid grid-cols-4 md:grid-cols-7">
            {["Cliente", "Local", "Tipo", "Agenda", "Equipe", "Materiais", "Revisao"].map((item, index) => <TabsTrigger key={item} value={String(index)}>{index + 1} - {item}</TabsTrigger>)}
          </TabsList>
          <TabsContent value="0" className="space-y-4">
            <SelectField label="Tipo da OS" value={orderType} onChange={(value) => {
              setOrderFinalKey("")
              setSelectedLocals([])
              setSelectedFloors([])
              setSelectedFinals([])
              setSelectedEnvironments([])
              setSelectedPoints([])
              setOrderKits([])
              setSelectedServices([])
              setSelectedClientEnvironments([])
              setSelectedClientEquipment([])
              setOrder({ ...order, orderType: value, serviceCategory: value === "servicos" ? order.serviceCategory : "", workId: "", clientEnvironmentId: "", clientEquipmentId: "", floorId: "", environmentId: "", pointId: "", workStructureId: "", serviceTypeId: "", simpleService: value !== "obra" })
            }} options={[
              { value: "obra", label: "Obra" },
              { value: "pmoc", label: "PMOC" },
              { value: "servicos", label: "Servicos diversos" },
            ]} />
            {orderType === "servicos" ? (
              <div className="grid gap-4 md:grid-cols-2">
                <SelectField label="Categoria do serviço" value={order.serviceCategory || "sem-categoria"} onChange={(value) => setOrder({ ...order, serviceCategory: value === "sem-categoria" ? "" : value })} options={[{ value: "sem-categoria", label: "Selecione a categoria" }, ...diverseServiceCategoryOptions]} />
                <TextField label="Valor da OS" type="number" value={order.totalAmount} onChange={(value) => setOrder({ ...order, totalAmount: value })} />
                <div className="rounded-md border p-3 text-sm md:col-span-2">
                  <div className="grid gap-2 md:grid-cols-3">
                    <div><span className="text-muted-foreground">Valor dos kits</span><div className="font-semibold">{money(orderKitsAmount())}</div></div>
                    <div><span className="text-muted-foreground">Valor da OS</span><div className="font-semibold">{money(orderServiceAmount())}</div></div>
                    <div><span className="text-muted-foreground">Soma total da OS</span><div className="font-semibold">{money(orderTotalAmount())}</div></div>
                  </div>
                </div>
              </div>
            ) : null}
            <SelectField label="Cliente" value={order.clientId} onChange={(value) => {
              if (orderType === "obra") {
                setOrder({ ...order, clientId: value })
                return
              }
              setOrderFinalKey("")
              setSelectedLocals([])
              setSelectedFloors([])
              setSelectedFinals([])
              setSelectedEnvironments([])
              setSelectedPoints([])
              setOrderKits([])
              setSelectedServices([])
              setSelectedClientEnvironments([])
              setSelectedClientEquipment([])
              setOrder({ ...order, clientId: value, workId: "", clientEnvironmentId: "", clientEquipmentId: "", floorId: "", environmentId: "", pointId: "", workStructureId: "" })
            }} options={state.clients.map((item) => ({ value: item.id, label: item.name, disabled: item.status === "Inativo" }))} />
            {orderType === "obra" ? (
              <>
                <SelectField label="Obra vinculada" value={order.workId} onChange={(value) => {
                  const selectedWork = state.works.find((item) => item.id === value)
                  setOrderFinalKey("")
                  setSelectedLocals([])
                  setSelectedFloors([])
                  setSelectedFinals([])
                  setSelectedEnvironments([])
                  setSelectedPoints([])
                  applyBudgetKits([], value)
                  setSelectedServices([])
                  setOrder({ ...order, clientId: selectedWork?.clientId || order.clientId, workId: value, floorId: "", environmentId: "", pointId: "", workStructureId: "" })
                }} options={workOptions.map((item) => ({ value: item.id, label: `${item.uniqueNumber} - ${item.name}${item.clientId ? ` - ${names(state).client(item.clientId)}` : ""}` }))} />
                <DetailGrid rows={[["Endereco automatico", fullAddress(state.works.find((item) => item.id === order.workId) || state.clients.find((item) => item.id === order.clientId) || ({} as Client)) || "-"], ["Responsavel", state.works.find((item) => item.id === order.workId)?.responsibleName || state.clients.find((item) => item.id === order.clientId)?.responsibleName || "-"]]} />
              </>
            ) : null}
          </TabsContent>
          <TabsContent value="1" className="space-y-4">
            {orderType === "obra" ? (
              <>
                <MultiChecklist
                  label="Local/Torre"
                  emptyLabel="Sem local/torre cadastrado no orçamento desta obra."
                  options={localOptions}
                  values={selectedLocals}
                  onSelectAll={() => {
                    const next = localOptions.filter((item) => !item.disabled).map((item) => item.value)
                    setSelectedLocals(next)
                    setSelectedFloors([])
                    setSelectedFinals([])
                    setSelectedEnvironments([])
                    setSelectedPoints([])
                    applyBudgetKits([])
                    applyPrimarySelection({ workStructureId: next[0] || "", floorId: "", environmentId: "", pointId: "" })
                  }}
                  onClear={() => {
                    setSelectedLocals([])
                    setSelectedFloors([])
                    setSelectedFinals([])
                    setSelectedEnvironments([])
                    setSelectedPoints([])
                    applyBudgetKits([])
                    applyPrimarySelection({ workStructureId: "", floorId: "", environmentId: "", pointId: "" })
                  }}
                  onToggle={(value, checked) => {
                    const next = toggleValue(selectedLocals, setSelectedLocals, value, checked)
                    setSelectedFloors([])
                    setSelectedFinals([])
                    setSelectedEnvironments([])
                    setSelectedPoints([])
                    applyBudgetKits([])
                    applyPrimarySelection({ workStructureId: next[0] || "", floorId: "", environmentId: "", pointId: "" })
                  }}
                />
                <MultiChecklist
                  label="Pavimento"
                  emptyLabel="Selecione uma obra para listar os pavimentos cadastrados."
                  options={floorOptions.map((item) => ({ value: item.value, label: item.name }))}
                  values={selectedFloors}
                  onSelectAll={() => {
                    const next = floorOptions.map((item) => item.value)
                    setSelectedFloors(next)
                    setSelectedFinals([])
                    setSelectedEnvironments([])
                    setSelectedPoints([])
                    applyBudgetKits([])
                    applyPrimarySelection({ floorId: next[0]?.split("|").filter(Boolean)[0] || "", environmentId: "", pointId: "" })
                  }}
                  onClear={() => {
                    setSelectedFloors([])
                    setSelectedFinals([])
                    setSelectedEnvironments([])
                    setSelectedPoints([])
                    applyBudgetKits([])
                    applyPrimarySelection({ floorId: "", environmentId: "", pointId: "" })
                  }}
                  onToggle={(value, checked) => {
                    const next = toggleValue(selectedFloors, setSelectedFloors, value, checked)
                    setSelectedFinals([])
                    setSelectedEnvironments([])
                    setSelectedPoints([])
                    applyBudgetKits([])
                    applyPrimarySelection({ floorId: next[0]?.split("|").filter(Boolean)[0] || "", environmentId: "", pointId: "" })
                  }}
                />
                <MultiChecklist
                  label="Final/Tipo"
                  emptyLabel="Selecione um pavimento para listar os finais/tipos cadastrados."
                  options={finalOptions}
                  values={selectedFinals}
                  onSelectAll={() => {
                    const next = finalOptions.map((item) => item.value)
                    setSelectedFinals(next)
                    setOrderFinalKey(next[0] || "")
                    setSelectedEnvironments([])
                    setSelectedPoints([])
                    applyBudgetKits([])
                    applyPrimarySelection({ environmentId: "", pointId: "" })
                  }}
                  onClear={() => {
                    setSelectedFinals([])
                    setOrderFinalKey("")
                    setSelectedEnvironments([])
                    setSelectedPoints([])
                    applyBudgetKits([])
                    applyPrimarySelection({ environmentId: "", pointId: "" })
                  }}
                  onToggle={(value, checked) => {
                    const next = toggleValue(selectedFinals, setSelectedFinals, value, checked)
                    setOrderFinalKey(next[0] || "")
                    setSelectedEnvironments([])
                    setSelectedPoints([])
                    applyBudgetKits([])
                    applyPrimarySelection({ environmentId: "", pointId: "" })
                  }}
                />
                <MultiChecklist
                  label="Ambiente"
                  emptyLabel="Selecione final/tipo para listar os ambientes cadastrados."
                  options={environmentOptions.map((item) => ({ value: item.id, label: `${item.floor} / ${item.final} / ${item.environmentName} - ${item.pointsQuantity} pontos` }))}
                  values={selectedEnvironments}
                  onSelectAll={() => {
                    const next = environmentOptions.map((item) => item.id)
                    const environment = state.workEnvironments.find((item) => item.id === next[0])
                    setSelectedEnvironments(next)
                    setSelectedPoints([])
                    applyBudgetKits([])
                    applyPrimarySelection({
                      workStructureId: budgetMetaValue(environment?.notes, "tower_id") || selectedLocals[0] || order.workStructureId,
                      floorId: environment?.floorId || primarySelectedFloorId || order.floorId,
                      environmentId: next[0] || "",
                      pointId: "",
                      simpleService: next.length === 0,
                    })
                  }}
                  onClear={() => {
                    setSelectedEnvironments([])
                    setSelectedPoints([])
                    applyBudgetKits([])
                    applyPrimarySelection({ environmentId: "", pointId: "", simpleService: true })
                  }}
                  onToggle={(value, checked) => {
                    const next = toggleValue(selectedEnvironments, setSelectedEnvironments, value, checked)
                    const environment = state.workEnvironments.find((item) => item.id === next[0])
                    setSelectedPoints([])
                    applyBudgetKits([])
                    applyPrimarySelection({
                      workStructureId: budgetMetaValue(environment?.notes, "tower_id") || selectedLocals[0] || order.workStructureId,
                      floorId: environment?.floorId || primarySelectedFloorId || order.floorId,
                      environmentId: next[0] || "",
                      pointId: "",
                      simpleService: next.length === 0,
                    })
                  }}
                />
                <MultiChecklist
                  label="Ponto"
                  emptyLabel={deferLargeWorkPoints ? "Selecione um pavimento para listar os pontos desta obra." : "Selecione uma obra para listar os pontos cadastrados."}
                  options={pointOptions.map((item) => ({ value: item.id, label: `${item.pointName} - ${names(state).serviceType(item.serviceTypeId)}` }))}
                  values={selectedPoints}
                  onSelectAll={() => {
                    const next = pointOptions.map((item) => item.id)
                    const point = state.workPoints.find((item) => item.id === next[0])
                    const environment = state.workEnvironments.find((item) => item.id === point?.environmentId)
                    const pointServices = servicesFromPoints(next)
                    const nextServices = Array.from(new Set([...selectedServices, ...pointServices]))
                    setSelectedPoints(next)
                    setSelectedServices(nextServices)
                    applyBudgetKits(next)
                    setOrderFinalKey(budgetMetaValue(environment?.notes, "type_id") || environment?.final || orderFinalKey)
                    applyPrimarySelection({
                      pointId: next[0] || "",
                      workStructureId: budgetMetaValue(environment?.notes, "tower_id") || selectedLocals[0] || order.workStructureId,
                      floorId: environment?.floorId || primarySelectedFloorId || order.floorId,
                      environmentId: environment?.id || selectedEnvironments[0] || order.environmentId,
                      workId: point?.workId || order.workId,
                      serviceTypeId: nextServices[0] || "",
                      simpleService: next.length === 0,
                    })
                  }}
                  onClear={() => {
                    setSelectedPoints([])
                    applyBudgetKits([])
                    applyPrimarySelection({ pointId: "", simpleService: true })
                  }}
                  onToggle={(value, checked) => {
                    const next = toggleValue(selectedPoints, setSelectedPoints, value, checked)
                    const point = state.workPoints.find((item) => item.id === next[0])
                    const environment = state.workEnvironments.find((item) => item.id === point?.environmentId)
                    const pointServices = servicesFromPoints(next)
                    const nextServices = Array.from(new Set([...selectedServices, ...pointServices]))
                    setSelectedServices(nextServices)
                    applyBudgetKits(next)
                    setOrderFinalKey(budgetMetaValue(environment?.notes, "type_id") || environment?.final || orderFinalKey)
                    applyPrimarySelection({
                      pointId: next[0] || "",
                      workStructureId: budgetMetaValue(environment?.notes, "tower_id") || selectedLocals[0] || order.workStructureId,
                      floorId: environment?.floorId || primarySelectedFloorId || order.floorId,
                      environmentId: environment?.id || selectedEnvironments[0] || order.environmentId,
                      workId: point?.workId || order.workId,
                      serviceTypeId: nextServices[0] || "",
                      simpleService: next.length === 0,
                    })
                  }}
                />
                <DetailGrid rows={[["Local/Torre", selectedLabels(selectedLocals, (id) => localOptions.find((item) => item.value === id)?.label || id)], ["Pavimento", selectedLabels(selectedFloors, (id) => floorOptions.find((item) => item.value === id)?.name || names(state).floor(id.split("|")[0]) || id)], ["Final/Tipo", selectedLabels(selectedFinals, (id) => finalOptions.find((item) => item.value === id)?.label || id)], ["Ambiente", selectedLabels(selectedEnvironments, (id) => names(state).environment(id) || id)], ["Ponto", selectedLabels(selectedPoints, (id) => names(state).point(id) || id)], ["Tipos de servico", selectedLabels(selectedServices, (id) => names(state).serviceType(id) || id)]]} />
              </>
            ) : (
              <>
                <MultiChecklist
                  label={isTechnicalVisit ? "Ambientes do cliente (opcional)" : "Ambientes do cliente"}
                  emptyLabel="Nenhum ambiente cadastrado para este cliente."
                  options={clientEnvironmentOptions.map((item) => ({ value: item.id, label: [item.name, item.floor].filter(Boolean).join(" - ") }))}
                  values={selectedClientEnvironments}
                  onSelectAll={() => {
                    const next = clientEnvironmentOptions.map((item) => item.id)
                    setSelectedClientEnvironments(next)
                    setSelectedClientEquipment([])
                    setOrder({ ...order, clientEnvironmentId: next[0] || "", clientEquipmentId: "" })
                  }}
                  onClear={() => {
                    setSelectedClientEnvironments([])
                    setSelectedClientEquipment([])
                    setOrder({ ...order, clientEnvironmentId: "", clientEquipmentId: "" })
                  }}
                  onToggle={(value, checked) => {
                    const next = toggleValue(selectedClientEnvironments, setSelectedClientEnvironments, value, checked)
                    const nextEquipment = selectedClientEquipment.filter((equipmentId) => {
                      const equipment = state.clientEquipment.find((item) => item.id === equipmentId)
                      return equipment && next.includes(equipment.clientEnvironmentId)
                    })
                    setSelectedClientEquipment(nextEquipment)
                    setOrder({ ...order, clientEnvironmentId: next[0] || "", clientEquipmentId: nextEquipment[0] || "" })
                  }}
                />
                <MultiChecklist
                  label={isTechnicalVisit ? "Equipamentos/Maquinas (opcional)" : "Equipamentos/Maquinas"}
                  emptyLabel="Selecione um ambiente para listar os equipamentos cadastrados."
                  options={clientEquipmentOptions.map((item) => ({ value: item.id, label: [item.name, item.model, item.capacity].filter(Boolean).join(" - ") }))}
                  values={selectedClientEquipment}
                  onSelectAll={() => {
                    const next = clientEquipmentOptions.map((item) => item.id)
                    setSelectedClientEquipment(next)
                    setOrder({ ...order, clientEquipmentId: next[0] || "" })
                  }}
                  onClear={() => {
                    setSelectedClientEquipment([])
                    setOrder({ ...order, clientEquipmentId: "" })
                  }}
                  onToggle={(value, checked) => {
                    const next = toggleValue(selectedClientEquipment, setSelectedClientEquipment, value, checked)
                    const equipment = state.clientEquipment.find((item) => item.id === next[0])
                    setOrder({ ...order, clientEquipmentId: next[0] || "", clientEnvironmentId: equipment?.clientEnvironmentId || selectedClientEnvironments[0] || order.clientEnvironmentId })
                  }}
                />
                <DetailGrid rows={[
                  ["Cliente", names(state).client(order.clientId)],
                  ["Ambientes do cliente", selectedLabels(selectedClientEnvironments, (id) => state.clientEnvironments.find((item) => item.id === id)?.name || id) || "-"],
                  ["Equipamentos/Maquinas", selectedLabels(selectedClientEquipment, (id) => state.clientEquipment.find((item) => item.id === id)?.name || id) || "-"],
                  ["Categoria", orderType === "servicos" ? serviceCategoryLabel(order.serviceCategory) : "-"],
                  ["Tipo da OS", orderType === "pmoc" ? "PMOC" : "Serviços diversos"],
                ]} />
              </>
            )}
          </TabsContent>
          <TabsContent value="2" className="space-y-4">
            <MultiChecklist
              label="Tipos de servico"
              emptyLabel="Nenhum tipo de servico ativo cadastrado."
              options={serviceTypesForOrder.map((item) => ({ value: item.id, label: item.name }))}
              values={selectedServices}
              onSelectAll={() => {
                const next = serviceTypesForOrder.map((item) => item.id)
                setSelectedServices(next)
                setOrder({ ...order, serviceTypeId: next[0] || "" })
              }}
              onClear={() => {
                setSelectedServices([])
                setOrder({ ...order, serviceTypeId: "" })
              }}
              onToggle={(value, checked) => {
                const next = toggleValue(selectedServices, setSelectedServices, value, checked)
                setOrder({ ...order, serviceTypeId: next[0] || "" })
              }}
            />
            {orderType === "obra" ? <p className="text-sm text-muted-foreground">Os servicos vinculados aos pontos selecionados entram marcados automaticamente. Voce pode adicionar mais servicos aqui.</p> : null}
            <TextAreaField label="Descricao do servico" value={order.description} onChange={(value) => setOrder({ ...order, description: value })} />
            <SelectField label="Prioridade" value={order.priority} onChange={(value) => setOrder({ ...order, priority: value })} options={["Baixa", "Media", "Alta", "Urgente"].map((value) => ({ value, label: value }))} />
          </TabsContent>
          <TabsContent value="3" className="grid gap-4 md:grid-cols-2">
            <TextField label="Data prevista" type="date" value={order.scheduledDate} onChange={(value) => setOrder({ ...order, scheduledDate: value })} />
            <TextField label="Horario inicial" type="time" value={order.scheduledStartTime} onChange={(value) => setOrder({ ...order, scheduledStartTime: value })} />
            <TextField label="Horario final" type="time" value={order.scheduledEndTime} onChange={(value) => setOrder({ ...order, scheduledEndTime: value })} />
            <TextField label="Duracao estimada" value={order.estimatedDuration} onChange={(value) => setOrder({ ...order, estimatedDuration: value })} />
            <TextField label="Valor da OS" type="number" value={order.totalAmount} onChange={(value) => setOrder({ ...order, totalAmount: value })} />
            <SelectField label="Forma de pagamento" value={order.paymentMethod || "nao-informado"} onChange={(value) => setOrder({ ...order, paymentMethod: value === "nao-informado" ? "" : value })} options={["nao-informado", "Pix", "Boleto", "Cartao de credito", "Cartao de debito", "Dinheiro", "Transferencia"].map((value) => ({ value, label: value === "nao-informado" ? "Nao informado" : value }))} />
            <SelectField label="Tipo de pagamento" value={order.paymentType || "nao-informado"} onChange={(value) => setOrder({ ...order, paymentType: value === "nao-informado" ? "" : value })} options={["nao-informado", "A vista", "Parcelado", "Entrada e saldo", "Faturado"].map((value) => ({ value, label: value === "nao-informado" ? "Nao informado" : value }))} />
            <TextField label="Prazo de pagamento" value={order.paymentTerm || ""} onChange={(value) => setOrder({ ...order, paymentTerm: value })} placeholder="Ex.: 30 dias, 2x, entrada + entrega" />
            <TextField label="Vencimento previsto" type="date" value={order.paymentDueDate || ""} onChange={(value) => setOrder({ ...order, paymentDueDate: value })} />
            <TextAreaField label="Instrucoes financeiras" value={order.financialNotes || ""} onChange={(value) => setOrder({ ...order, financialNotes: value })} />
            <div className="rounded-md border p-3 text-sm md:col-span-2">
              <div className="grid gap-2 md:grid-cols-3">
                <div><span className="text-muted-foreground">Valor dos kits</span><div className="font-semibold">{money(orderKitsAmount())}</div></div>
                <div><span className="text-muted-foreground">Valor da OS</span><div className="font-semibold">{money(orderServiceAmount())}</div></div>
                <div><span className="text-muted-foreground">Soma total da OS</span><div className="font-semibold">{money(orderTotalAmount())}</div></div>
              </div>
            </div>
          </TabsContent>
          <TabsContent value="4" className="grid gap-4 md:grid-cols-2">
            <SelectField label="Prestador principal" value={order.mainProviderId || "nenhum"} onChange={(value) => setOrder({ ...order, mainProviderId: value === "nenhum" ? "" : value })} options={[{ value: "nenhum", label: "Sem prestador" }, ...activeProviders.map((item) => ({ value: item.id, label: item.fullName }))]} />
            <SelectField label="Ajudante" value={order.helperProviderId || "nenhum"} onChange={(value) => setOrder({ ...order, helperProviderId: value === "nenhum" ? "" : value })} options={[{ value: "nenhum", label: "Sem ajudante" }, ...activeProviders.map((item) => ({ value: item.id, label: item.fullName }))]} />
            <SelectField label="Supervisor" value={order.supervisorId || "nenhum"} onChange={(value) => setOrder({ ...order, supervisorId: value === "nenhum" ? "" : value })} options={[{ value: "nenhum", label: "Sem supervisor" }, ...activeProviders.map((item) => ({ value: item.id, label: item.fullName }))]} />
            <SelectField label="Veiculo" value={order.vehicleId || "nenhum"} onChange={(value) => setOrder({ ...order, vehicleId: value === "nenhum" ? "" : value })} options={[{ value: "nenhum", label: "Sem veiculo" }, ...availableVehicles.map((item) => ({ value: item.id, label: `${item.plate} - ${item.model}` }))]} />
            <div className="rounded-md border p-3 text-sm text-muted-foreground md:col-span-2">
              {selectedVehicleConflict ? `Veiculo selecionado indisponivel: manutencao de ${formatDate(selectedVehicleConflict.date)} ate ${formatDate(selectedVehicleConflict.nextMaintenance || selectedVehicleConflict.date)}.` : availableVehicles.length ? "A lista mostra apenas veiculos disponiveis para a data prevista da OS." : "Nenhum veiculo disponivel para a data prevista da OS."}
            </div>
          </TabsContent>
          <TabsContent value="5">
            <div className="mb-4 grid gap-3 md:grid-cols-[1.4fr_0.8fr_1fr_auto]">
              <SelectField label="Kit" value={orderKit.kitId || "nenhum"} onChange={(value) => setOrderKit({ ...orderKit, kitId: value === "nenhum" ? "" : value })} options={[{ value: "nenhum", label: activeKits.length ? "Selecione um kit" : "Nenhum kit cadastrado" }, ...activeKits.map((item) => ({ value: item.id, label: `${item.name} - ${money(Number((item as any).unitValue || 0))}` }))]} />
              <TextField label="Quantidade" type="number" value={orderKit.quantity} onChange={(value) => setOrderKit({ ...orderKit, quantity: value })} />
              <TextField label="Observacao" value={orderKit.notes} onChange={(value) => setOrderKit({ ...orderKit, notes: value })} />
              <div className="flex items-end"><Button type="button" onClick={addOrderKit}>Adicionar</Button></div>
            </div>
            <p className="mb-3 text-sm text-muted-foreground">Ao criar a OS, os itens dos kits selecionados serao baixados do saldo de Materiais/Estoque.</p>
            <DataTable headers={["Kit", "Quantidade", "Valor unitário", "Valor dos kits", "Itens consumidos", "Acoes"]} empty={!orderKits.length}>
              {orderKits.map((row, index) => {
                const kit = state.stockKits.find((item) => item.id === row.kitId)
                const unitValue = kitUnitValue(row.kitId)
                const totalValue = unitValue * Number(row.quantity || 0)
                const kitUsage = expandedOrderKitMaterials([row]).map((usage) => {
                  const mat = state.materials.find((item) => item.id === usage.materialId)
                  return `${usage.quantity} ${mat?.unit || ""} - ${mat?.name || "Material"}`
                }).join("; ")
                return <TableRow key={`${row.kitId}-${index}`}><TableCell>{kit?.name || "Kit"}</TableCell><TableCell>{row.quantity}</TableCell><TableCell>{money(unitValue)}</TableCell><TableCell>{money(totalValue)}</TableCell><TableCell>{kitUsage || "-"}</TableCell><TableCell><Button size="sm" variant="outline" onClick={() => setOrderKits(orderKits.filter((_, rowIndex) => rowIndex !== index))}>Remover</Button></TableCell></TableRow>
              })}
            </DataTable>
            <div className="my-4 grid gap-3 md:grid-cols-[1.4fr_0.8fr_1fr_auto]">
              <SelectField label="Materia prima / material individual" value={orderMaterial.materialId || "nenhum"} onChange={(value) => setOrderMaterial({ ...orderMaterial, materialId: value === "nenhum" ? "" : value })} options={[{ value: "nenhum", label: state.materials.length ? "Selecione um material" : "Nenhum material cadastrado" }, ...state.materials.filter((item) => item.status === "Ativo").map((item) => ({ value: item.id, label: `${item.name} - saldo ${materialStock(item)} ${item.unit}` }))]} />
              <TextField label="Quantidade" type="number" value={orderMaterial.quantity} onChange={(value) => setOrderMaterial({ ...orderMaterial, quantity: value })} />
              <TextField label="Observacao" value={orderMaterial.notes} onChange={(value) => setOrderMaterial({ ...orderMaterial, notes: value })} />
              <div className="flex items-end"><Button type="button" onClick={addOrderMaterial}>Adicionar</Button></div>
            </div>
            <DataTable headers={["Material", "Quantidade", "Saldo atual", "Observacao", "Acoes"]} empty={!orderMaterials.length}>
              {orderMaterials.map((row, index) => {
                const mat = state.materials.find((item) => item.id === row.materialId)
                return <TableRow key={`${row.materialId}-${index}`}><TableCell>{mat?.name || "Material"}</TableCell><TableCell>{row.quantity} {mat?.unit || ""}</TableCell><TableCell>{mat ? `${materialStock(mat)} ${mat.unit}` : "-"}</TableCell><TableCell>{row.notes || "-"}</TableCell><TableCell><Button size="sm" variant="outline" onClick={() => setOrderMaterials(orderMaterials.filter((_, rowIndex) => rowIndex !== index))}>Remover</Button></TableCell></TableRow>
              })}
            </DataTable>
            <div className="mt-3 rounded-md border p-3 text-sm">
              <div className="grid gap-2 md:grid-cols-3">
                <div><span className="text-muted-foreground">Valor dos kits</span><div className="font-semibold">{money(orderKitsAmount())}</div></div>
                <div><span className="text-muted-foreground">Valor da OS</span><div className="font-semibold">{money(orderServiceAmount())}</div></div>
                <div><span className="text-muted-foreground">Soma total da OS</span><div className="font-semibold">{money(orderTotalAmount())}</div></div>
              </div>
            </div>
          </TabsContent>
          <TabsContent value="6" className="space-y-4">
            <DetailGrid rows={[["Cliente", names(state).client(order.clientId)], ["Obra/Local", names(state).work(order.workId)], ["Categoria", orderType === "servicos" ? serviceCategoryLabel(order.serviceCategory) : "-"], ["Pavimento", names(state).floor(order.floorId)], ["Ambiente", names(state).environment(order.environmentId)], ["Ponto", names(state).point(order.pointId)], ["Tipo", names(state).serviceType(order.serviceTypeId)], ["Data", formatDate(order.scheduledDate)], ["Valor dos kits", money(orderKitsAmount())], ["Valor da OS", money(orderServiceAmount())], ["Soma total da OS", money(orderTotalAmount())], ["Forma de pagamento", order.paymentMethod || "-"], ["Tipo de pagamento", order.paymentType || "-"], ["Prazo", order.paymentTerm || "-"], ["Vencimento", formatDate(order.paymentDueDate)], ["Materiais avulsos", orderMaterials.length ? orderMaterials.map((row) => `${row.quantity} ${state.materials.find((mat) => mat.id === row.materialId)?.unit || ""} - ${state.materials.find((mat) => mat.id === row.materialId)?.name || "Material"}`).join(", ") : "-"], ["Equipe", names(state).provider(order.mainProviderId)], ["Veiculo", names(state).vehicle(order.vehicleId)]]} />
            <div className="flex flex-wrap gap-2">
              <SaveButton onClick={() => saveOrder(false)}>Criar OS</SaveButton>
              <Button onClick={() => saveOrder(true)}>Criar e enviar para equipe</Button>
            </div>
          </TabsContent>
        </Tabs>
        <div className="flex justify-between border-t pt-4">
          <Button variant="outline" disabled={step === 0} onClick={() => setStep(Math.max(0, step - 1))}>Voltar</Button>
          <Button disabled={step === 6} onClick={() => setStep(Math.min(6, step + 1))}>Proximo</Button>
        </div>
      </FormSheet>

      <FormSheet open={sheet === "material"} onOpenChange={(open) => !open && close()} title="Cadastro de Produto / Material">
        <MaterialFormFields material={material} setMaterial={setMaterial} suppliers={state.suppliers} existing={state.materials.find((item) => item.id === material.id)} />
        <SaveButton onClick={saveMaterial}>Salvar material</SaveButton>
      </FormSheet>

      <FormSheet open={sheet === "serviceType"} onOpenChange={(open) => !open && close()} title="Tipo de Servico">
        <TextField label="Nome do servico" value={serviceType.name} onChange={(value) => setServiceType({ ...serviceType, name: value })} />
        <TextAreaField label="Descricao" value={serviceType.description} onChange={(value) => setServiceType({ ...serviceType, description: value })} />
        <SelectField label="Kit vinculado" value={serviceType.kitId || "nenhum"} onChange={(value) => setServiceType({ ...serviceType, kitId: value === "nenhum" ? "" : value })} options={[{ value: "nenhum", label: state.stockKits.length ? "Sem kit vinculado" : "Nenhum kit cadastrado" }, ...state.stockKits.filter((item) => item.status === "Ativo").map((item) => ({ value: item.id, label: item.name }))]} />
        <TextField label="Percentual de execucao" type="number" value={serviceType.executionPercentage} onChange={(value) => setServiceType({ ...serviceType, executionPercentage: value })} />
        <SelectField label="Periodicidade" value={String(serviceType.periodicityMonths || 1)} onChange={(value) => setServiceType({ ...serviceType, periodicityMonths: value })} options={servicePeriodicityOptions} />
        <SelectField label="Status" value={serviceType.status} onChange={(value) => setServiceType({ ...serviceType, status: value })} options={["Ativo", "Inativo"].map((value) => ({ value, label: value }))} />
        <div className="space-y-2 rounded-md border p-3">
          <Label>Habilitar serviço para</Label>
          <div className="grid gap-2 md:grid-cols-3">
            {serviceContextOptions.map((context) => {
              const values = serviceContexts(serviceType)
              return (
                <label key={context} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                  <Checkbox
                    checked={values.includes(context)}
                    onCheckedChange={(checked) => {
                      const current = serviceContexts(serviceType)
                      const next = checked === true ? Array.from(new Set([...current, context])) : current.filter((item) => item !== context)
                      setServiceType({ ...serviceType, enabledContexts: next.length ? next : [context] })
                    }}
                  />
                  {serviceContextLabels[context]}
                </label>
              )
            })}
          </div>
        </div>
        <TextAreaField label="Checklist padrao (separar por ;)" value={serviceType.tasks} onChange={(value) => setServiceType({ ...serviceType, tasks: value })} />
        <Button onClick={saveServiceType} disabled={savingServiceType}>{savingServiceType ? "Salvando..." : serviceType.id ? "Salvar alteracoes" : "Salvar tipo de servico"}</Button>
      </FormSheet>

      <FormSheet open={sheet === "user"} onOpenChange={(open) => !open && close()} title="Usuario e Permissoes">
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label="Nome" value={user.name} onChange={(value) => setUser({ ...user, name: value })} />
          <TextField label="E-mail" value={user.email} onChange={(value) => setUser({ ...user, email: value })} />
          <TextField label="Telefone" value={user.phone} onChange={(value) => setUser({ ...user, phone: value })} />
          <SelectField label="Perfil" value={user.profile} onChange={(value) => setUser({
            ...user,
            profile: value,
            clientId: value === "Cliente" ? user.clientId : "",
            permissions: value === "Administrador" ? selectablePagePermissions : value === "Cliente" ? clientDefaultPermissions : (Array.isArray(user.permissions) ? user.permissions : []),
          })} options={["Administrador", "Supervisor", "Atendimento", "Tecnico", "Cliente"].map((value) => ({ value, label: value }))} />
          <TextField label={user.id ? "Nova senha (opcional)" : "Senha temporaria"} value={user.temporaryPassword} onChange={(value) => setUser({ ...user, temporaryPassword: value })} />
          <SelectField label="Status" value={user.status} onChange={(value) => setUser({ ...user, status: value })} options={["Ativo", "Inativo"].map((value) => ({ value, label: value }))} />
          {user.profile === "Cliente" ? <SelectField label="Empresa/Cliente permitido" value={user.clientId || "nenhum"} onChange={(value) => setUser({ ...user, clientId: value === "nenhum" ? "" : value })} options={[{ value: "nenhum", label: state.clients.length ? "Selecione uma empresa/cliente" : "Nenhum cliente cadastrado" }, ...state.clients.filter((item) => item.status !== "Inativo").map((item) => ({ value: item.id, label: item.name }))]} /> : null}
        </div>
        <div className="space-y-3">
          <div>
            <Label>Paginas permitidas</Label>
            <p className="mt-1 text-sm text-muted-foreground">Selecione exatamente as paginas que aparecerao para este login.</p>
          </div>
          <div className="grid gap-2 rounded-md border p-3 md:grid-cols-2">
            {selectablePagePermissions.map((permission) => {
              const selected = (Array.isArray(user.permissions) ? user.permissions : []).includes(permission)
              return (
                <label key={permission} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                  <Checkbox
                    checked={selected}
                    disabled={user.profile === "Administrador"}
                    onCheckedChange={(checked) => setUser({
                      ...user,
                      permissions: checked === true
                        ? Array.from(new Set([...(Array.isArray(user.permissions) ? user.permissions : []), permission]))
                        : (Array.isArray(user.permissions) ? user.permissions : []).filter((item: string) => item !== permission),
                    })}
                  />
                  {pagePermissionLabels[permission]}
                </label>
              )
            })}
          </div>
        </div>
        {user.profile === "Cliente" ? <p className="text-sm text-muted-foreground">Os dados exibidos nessas paginas ficarao limitados a empresa selecionada.</p> : null}
        <SaveButton onClick={saveUser}>{user.id ? "Salvar alteracoes" : "Salvar usuario"}</SaveButton>
      </FormSheet>
    </>
  )
}

function useSheetWithPreset() {
  const [sheet, setSheet] = useState<SheetKind>("")
  const [preset, setPreset] = useState<Record<string, string>>({})
  const openSheet = (kind: SheetKind, values: Record<string, string> = {}) => {
    setPreset(values)
    setSheet(kind)
  }
  return { sheet, setSheet, preset, openSheet }
}

export function OperationsDashboardPage() {
  const { state, commit } = useOperationalStore()
  const { sheet, setSheet, preset, openSheet } = useSheetWithPreset()
  const go = useGo()
  const n = names(state)
  const todayOrders = state.serviceOrders.filter((order) => order.scheduledDate === today())
  const delayed = state.serviceOrders.filter((order) => order.scheduledDate < today() && !["Finalizada", "Cancelada"].includes(order.status))
  const alerts = [
    ...state.serviceOrders.filter((order) => !order.mainProviderId).map((order) => `${order.orderNumber} sem prestador vinculado`),
    ...state.serviceOrders.filter((order) => !order.vehicleId).map((order) => `${order.orderNumber} sem veiculo vinculado`),
    ...delayed.map((order) => `${order.orderNumber} atrasada desde ${formatDate(order.scheduledDate)}`),
    ...state.works.filter((work) => !work.street || !work.city).map((work) => `${work.name} sem endereco completo`),
    ...state.providers.filter((provider) => !provider.phone).map((provider) => `${provider.fullName} sem telefone cadastrado`),
  ]

  return (
    <PageShell
      title="Dashboard Operacional"
      description="Acompanhe clientes, obras, ordens de servico, equipe e frota em tempo real."
      actions={<><Button onClick={() => openSheet("order")}><Plus className="h-4 w-4" />Nova OS</Button><Button variant="secondary" onClick={() => openSheet("client")}><UserPlus className="h-4 w-4" />Novo Cliente</Button><Button variant="secondary" onClick={() => openSheet("work")}><Building2 className="h-4 w-4" />Nova Obra</Button><Button variant="secondary" onClick={() => openSheet("provider")}><HardHat className="h-4 w-4" />Novo Prestador</Button></>}
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="OS em aberto" value={state.serviceOrders.filter((item) => ["Criada", "Agendada"].includes(item.status)).length} note="Criadas ou agendadas" icon={FileBarChart} onClick={() => go("/ordens-servico?status=abertas")} />
        <MetricCard title="OS em andamento" value={state.serviceOrders.filter((item) => String(item.status).includes("execu")).length} note="Equipe executando" icon={Wrench} onClick={() => go("/ordens-servico?status=andamento")} />
        <MetricCard title="OS finalizadas hoje" value={state.serviceOrders.filter((item) => item.finishedAt?.slice(0, 10) === today()).length} note="Concluidas no dia" icon={CheckCircle2} onClick={() => go("/ordens-servico?status=finalizada")} />
        <MetricCard title="OS atrasadas" value={delayed.length} note="Prazo vencido" icon={AlertTriangle} onClick={() => go("/ordens-servico?tab=atrasadas")} />
        <MetricCard title="Obras/Locais ativos" value={state.works.filter((item) => item.status === "Ativa").length} note="Estrutura no orçamento" icon={Building2} onClick={() => go("/orcamento")} />
        <MetricCard title="Ambientes cadastrados" value={state.workEnvironments.length} note="Estrutura no orçamento" icon={MapPin} onClick={() => go("/orcamento")} />
        <MetricCard title="Pontos cadastrados" value={state.workPoints.length} note="Estrutura no orçamento" icon={ListChecks} onClick={() => go("/orcamento")} />
        <MetricCard title="Servicos pausados" value={state.serviceOrders.filter((item) => item.status === "Pausada").length} note="Precisam de acao" icon={Clock3} onClick={() => go("/ordens-servico?status=Pausada")} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Servicos de hoje" description="Agenda operacional do dia.">
          <DataTable headers={["Horario", "Cliente", "Obra", "Tipo", "Prestador", "Status", "Acoes"]} empty={!todayOrders.length}>
            {todayOrders.map((order) => <TableRow key={order.id}><TableCell>{order.scheduledStartTime}</TableCell><TableCell>{n.client(order.clientId)}</TableCell><TableCell>{n.work(order.workId)}</TableCell><TableCell>{n.serviceType(order.serviceTypeId)}</TableCell><TableCell>{n.provider(order.mainProviderId)}</TableCell><TableCell><StatusBadge status={order.status} /></TableCell><TableCell><Button asChild size="sm" variant="outline"><Link href={`/ordens-servico/${order.id}`}>Ver OS</Link></Button></TableCell></TableRow>)}
          </DataTable>
        </SectionCard>
        <SectionCard title="Equipes em campo" description="Ultima movimentacao por prestador.">
          <DataTable headers={["Prestador", "OS atual", "Cliente", "Local", "Status", "Ultima atualizacao"]} empty={!todayOrders.length}>
            {todayOrders.map((order) => <TableRow key={order.id}><TableCell>{n.provider(order.mainProviderId)}</TableCell><TableCell>{order.orderNumber}</TableCell><TableCell>{n.client(order.clientId)}</TableCell><TableCell>{n.environment(order.environmentId)} / {n.point(order.pointId)}</TableCell><TableCell><StatusBadge status={order.status} /></TableCell><TableCell>{dateTime(order.updatedAt)}</TableCell></TableRow>)}
          </DataTable>
        </SectionCard>
      </div>
      <SectionCard title="Alertas operacionais">
        <div className="grid gap-2 md:grid-cols-2">{alerts.length ? alerts.map((alert) => <AlertRow key={alert}>{alert}</AlertRow>) : <p className="text-sm text-muted-foreground">Nenhum alerta critico agora.</p>}</div>
      </SectionCard>
      <QuickSheets state={state} commit={commit} sheet={sheet} setSheet={setSheet} preset={preset} />
    </PageShell>
  )
}

export function ClientsWorksPage() {
  const { state, commit } = useOperationalStore()
  const { sheet, setSheet, preset, openSheet } = useSheetWithPreset()
  const [tab, setTab] = useState("clientes")
  const [query, setQuery] = useState("")
  const [importing, setImporting] = useState(false)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const [detail, setDetail] = useState<{ type: "client" | "work" | "point"; id: string } | null>(null)
  const normalizedQuery = normalizeClientImportKey(query)
  const matchesQuery = (values: unknown[]) => normalizeClientImportKey(values.filter(Boolean).join(" ")).includes(normalizedQuery)
  const clients = state.clients
    .filter((item) => matchesQuery([item.name, item.corporateName, item.tradeName, item.document, item.responsibleName, item.phone, item.mobile, item.email, item.city, item.state, item.status, ...(item.serviceContexts || []).map((context) => serviceContextLabels[context])]))
    .sort((left, right) => compareAlphaNumeric(left.name, right.name))
  const suppliers = (state.suppliers || [])
    .filter((item) => matchesQuery([item.name, item.document, item.contactName, item.phone, item.email, item.category, item.city, item.state, item.status, item.notes]))
    .sort((left, right) => compareAlphaNumeric(left.name, right.name))
  const clientEnvironments = (state.clientEnvironments || [])
    .filter((item) => matchesQuery([item.name, item.floor, item.location, item.activityType, item.equipmentDescription, item.thermalLoad, names(state).client(item.clientId), item.status]))
    .sort((left, right) => compareAlphaNumeric(`${names(state).client(left.clientId)} ${left.name}`, `${names(state).client(right.clientId)} ${right.name}`))
  const clientEquipment = (state.clientEquipment || [])
    .filter((item) => matchesQuery([item.tag, item.name, item.type, item.brand, item.model, item.capacity, item.serialNumber, names(state).client(item.clientId), state.clientEnvironments.find((environment) => environment.id === item.clientEnvironmentId)?.name || "", item.status]))
    .sort((left, right) => compareAlphaNumeric(`${names(state).client(left.clientId)} ${left.name}`, `${names(state).client(right.clientId)} ${right.name}`))
  const searchPlaceholder = tab === "fornecedores"
    ? "Pesquisar fornecedor, CPF/CNPJ, contato, categoria ou cidade"
    : tab === "ambientes"
      ? "Pesquisar cliente, ambiente, equipamento, TAG, marca ou modelo"
      : "Pesquisar cliente, CPF/CNPJ, nome fantasia, contato ou cidade"

  function inactivate(kind: "client" | "supplier", id: string) {
    commit((current) => ({
      ...current,
      clients: kind === "client" ? current.clients.map((item) => item.id === id ? { ...item, status: "Inativo", updatedAt: nowIso() } : item) : current.clients,
      suppliers: kind === "supplier" ? (current.suppliers || []).map((item) => item.id === id ? { ...item, status: "Inativo", updatedAt: nowIso() } : item) : (current.suppliers || []),
      auditLogs: appendAudit(current, kind, id, "Inativado", `${kind === "client" ? "Cliente" : "Fornecedor"} inativado`),
    }))
  }

  async function importClientEquipment(file?: File | null) {
    if (!file) return
    setImporting(true)
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const structuredRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false })
      const parsedClients = structuredRows.map(parseStructuredClientRow).filter(Boolean) as NonNullable<ReturnType<typeof parseStructuredClientRow>>[]

      if (parsedClients.length) {
        const now = nowIso()
        const clientByDocument = new Map(state.clients.filter((client) => normalizeClientDocument(client.document)).map((client) => [normalizeClientDocument(client.document), client]))
        const clientByName = new Map(state.clients.map((client) => [normalizeClientImportKey(client.name), client]))
        const clientsToSave = new Map<string, Client>()

        parsedClients.forEach((row) => {
          const documentKey = normalizeClientDocument(row.document)
          const nameKey = normalizeClientImportKey(row.name)
          const existing = clientByDocument.get(documentKey) || (!documentKey ? clientByName.get(nameKey) : undefined)
          const importedEarlier = clientsToSave.get(existing?.id || "")
          const previous = importedEarlier || existing
          const record: Client = {
            ...(emptyClient as any),
            ...(previous || {}),
            ...row,
            id: previous?.id || makeId("client"),
            stateRegistration: previous?.stateRegistration || "",
            responsibleName: previous?.responsibleName || "",
            serviceContexts: importedEarlier ? Array.from(new Set([...(importedEarlier.serviceContexts || []), ...row.serviceContexts])) : row.serviceContexts,
            status: previous?.status || "Ativo",
            notes: previous?.notes || "",
            createdAt: previous?.createdAt || now,
            updatedAt: now,
          }
          clientsToSave.set(record.id, record)
          clientByDocument.set(documentKey, record)
          clientByName.set(nameKey, record)
        })

        const response = await fetch("/api/client-equipment/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clients: Array.from(clientsToSave.values()) }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload?.error || `Erro ${response.status} ao salvar clientes no Supabase.`)
        const savedClients = Array.isArray(payload.clients) ? payload.clients : Array.from(clientsToSave.values())

        commit((current) => ({
          ...current,
          clients: [...savedClients, ...current.clients.filter((client) => !savedClients.some((saved: Client) => saved.id === client.id))],
          auditLogs: appendAudit(current, "client_import", savedClients[0]?.id || "import", "Importado", `${savedClients.length} clientes importados da planilha`),
        }), { persist: false })
        setTab("clientes")
        window.alert(`Importacao salva no Supabase: ${savedClients.length} clientes com todos os campos da planilha.`)
        return
      }

      const rows = XLSX.utils.sheet_to_json<Array<string | number>>(sheet, { header: 1, defval: "", raw: false })
      const parsedRows = rows.map(parseClientEquipmentRow).filter(Boolean) as NonNullable<ReturnType<typeof parseClientEquipmentRow>>[]
      if (!parsedRows.length) return window.alert("Nao encontrei linhas no formato Cliente / Ambiente / Equipamento.")

      const now = nowIso()
      const clientByName = new Map(state.clients.map((client) => [normalizeClientImportKey(client.name), client]))
      const environmentByKey = new Map((state.clientEnvironments || []).map((environment) => [`${environment.clientId}|${normalizeClientImportKey([environment.location, environment.name].filter(Boolean).join(" "))}`, environment]))
      const equipmentByKey = new Map((state.clientEquipment || []).map((equipment) => [`${equipment.clientEnvironmentId}|${normalizeClientImportKey([equipment.tag, equipment.name].filter(Boolean).join(" "))}`, equipment]))
      const importedClients: Client[] = []
      const importedEnvironments: ClientEnvironment[] = []
      const importedEquipment: ClientEquipment[] = []
      const clientsToSave = new Map<string, Client>()
      const environmentsToSave = new Map<string, ClientEnvironment>()
      const equipmentToSave = new Map<string, ClientEquipment>()
      parsedRows.forEach((row) => {
        const clientKey = normalizeClientImportKey(row.clientName)
        let client = clientByName.get(clientKey)
        if (!client) {
          client = { ...(emptyClient as any), id: makeId("client"), type: "PJ", name: row.clientName, corporateName: row.clientName, tradeName: row.clientName, status: "Ativo", createdAt: now, updatedAt: now } as Client
          clientByName.set(clientKey, client)
          importedClients.push(client)
        }
        clientsToSave.set(client.id, client)

        const environmentKey = `${client.id}|${normalizeClientImportKey([row.environmentCode, row.environmentName].filter(Boolean).join(" "))}`
        let environment = environmentByKey.get(environmentKey)
        if (!environment) {
          environment = {
            id: makeId("client-env"),
            clientId: client.id,
            name: row.environmentName,
            location: row.environmentCode,
            floor: "",
            activityType: "",
            equipmentDescription: "",
            thermalLoad: "",
            occupantsTotal: 0,
            occupantsFixed: 0,
            occupantsFloating: 0,
            airConditionedArea: 0,
            notes: row.environmentRaw,
            status: normalizeClientImportKey(row.environmentRaw).includes("inativo") ? "Inativo" : "Ativo",
            createdAt: now,
            updatedAt: now,
          }
          environmentByKey.set(environmentKey, environment)
          importedEnvironments.push(environment)
        } else if (environment.equipmentDescription || environment.thermalLoad) {
          environment = {
            ...environment,
            equipmentDescription: "",
            thermalLoad: "",
            updatedAt: now,
          }
          environmentByKey.set(environmentKey, environment)
        }
        environmentsToSave.set(environment.id, environment)

        const equipmentKey = `${environment.id}|${normalizeClientImportKey([row.equipmentTag, row.equipmentName].filter(Boolean).join(" "))}`
        const existingEquipment = equipmentByKey.get(equipmentKey)
        if (existingEquipment) {
          equipmentToSave.set(existingEquipment.id, {
            ...existingEquipment,
            tag: row.equipmentTag,
            name: row.equipmentName,
            type: row.type || existingEquipment.type,
            brand: row.brand || existingEquipment.brand,
            model: row.model || existingEquipment.model,
            capacity: row.equipmentCapacity || existingEquipment.capacity,
            updatedAt: now,
          })
          return
        }
        const equipment: ClientEquipment = {
          id: makeId("client-eq"),
          clientId: client.id,
          clientEnvironmentId: environment.id,
          tag: row.equipmentTag,
          name: row.equipmentName,
          type: row.type,
          brand: row.brand,
          model: row.model,
          serialNumber: "",
          capacity: row.equipmentCapacity,
          notes: row.equipmentRaw,
          status: "Ativo",
          createdAt: now,
          updatedAt: now,
        }
        equipmentByKey.set(equipmentKey, equipment)
        importedEquipment.push(equipment)
        equipmentToSave.set(equipment.id, equipment)
      })

      const response = await fetch("/api/client-equipment/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clients: Array.from(clientsToSave.values()), environments: Array.from(environmentsToSave.values()), equipment: Array.from(equipmentToSave.values()) }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || `Erro ${response.status} ao salvar no Supabase.`)
      const savedClients = Array.isArray(payload.clients) ? payload.clients : importedClients
      const savedEnvironments = Array.isArray(payload.environments) ? payload.environments : importedEnvironments
      const savedEquipment = Array.isArray(payload.equipment) ? payload.equipment : importedEquipment

      commit((current) => ({
        ...current,
        clients: [...savedClients, ...current.clients.filter((client) => !savedClients.some((saved: Client) => saved.id === client.id))],
        clientEnvironments: [...savedEnvironments, ...(current.clientEnvironments || []).filter((environment) => !savedEnvironments.some((saved: ClientEnvironment) => saved.id === environment.id))],
        clientEquipment: [...savedEquipment, ...(current.clientEquipment || []).filter((equipment) => !savedEquipment.some((saved: ClientEquipment) => saved.id === equipment.id))],
        auditLogs: appendAudit(current, "client_equipment_import", savedClients[0]?.id || "import", "Importado", `${savedClients.length} clientes, ${savedEnvironments.length} ambientes e ${savedEquipment.length} equipamentos importados`),
      }), { persist: false })
      setTab("ambientes")
      window.alert(`Importacao salva no Supabase: ${savedClients.length} clientes, ${savedEnvironments.length} ambientes e ${savedEquipment.length} equipamentos.`)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Erro ao importar planilha.")
    } finally {
      setImporting(false)
      if (importInputRef.current) importInputRef.current.value = ""
    }
  }

  return (
    <PageShell title="Clientes e Fornecedores" description="Cadastre clientes, ambientes, equipamentos e fornecedores." actions={<><Input ref={importInputRef} className="hidden" type="file" accept=".xlsx,.xls,.csv" onChange={(event) => importClientEquipment(event.target.files?.[0])} /><Button variant="outline" disabled={importing} onClick={() => importInputRef.current?.click()}><FileUp className="h-4 w-4" />{importing ? "Importando..." : "Importar clientes/ambientes/equipamentos"}</Button><Button onClick={() => openSheet("client")}><Plus className="h-4 w-4" />Novo Cliente</Button><Button variant="secondary" onClick={() => openSheet("supplier")}><Building2 className="h-4 w-4" />Novo Fornecedor</Button></>}>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap"><TabsTrigger value="clientes">Clientes</TabsTrigger><TabsTrigger value="ambientes">Ambientes/Equipamentos</TabsTrigger><TabsTrigger value="fornecedores">Fornecedores</TabsTrigger><TabsTrigger value="historico">Histórico</TabsTrigger></TabsList>
        {tab !== "historico" ? <div className="my-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative w-full max-w-3xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-11 pl-9 pr-10" placeholder={searchPlaceholder} value={query} onChange={(event) => setQuery(event.target.value)} />
            {query ? <Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2" title="Limpar pesquisa" onClick={() => setQuery("")}><X className="h-4 w-4" /></Button> : null}
          </div>
          <Button variant="outline" onClick={() => window.alert("Exportação simulada no MVP.")}>Exportar lista</Button>
        </div> : null}
        <TabsContent value="clientes">
          <SectionCard title="Clientes">
            <DataTable headers={["Cliente", "Tipo", "CPF/CNPJ", "Tipos de servico", "Ambientes", "Equipamentos", "Status", "Acoes"]} empty={!clients.length} stickyHeader viewportClassName="max-h-[calc(100vh-19rem)] overflow-auto overscroll-contain" tableClassName="h-auto min-w-[1180px] [&_tbody_tr]:h-auto [&_td]:py-2.5">
              {clients.map((client) => <TableRow key={client.id}><TableCell>{client.name}</TableCell><TableCell>{client.type}</TableCell><TableCell>{client.document}</TableCell><TableCell>{(client.serviceContexts || []).map((context) => serviceContextLabels[context]).join(", ") || "-"}</TableCell><TableCell>{(state.clientEnvironments || []).filter((item) => item.clientId === client.id).length}</TableCell><TableCell>{(state.clientEquipment || []).filter((item) => item.clientId === client.id).length}</TableCell><TableCell><StatusBadge status={client.status} /></TableCell><TableCell className="space-x-1"><Button size="sm" variant="outline" onClick={() => setDetail({ type: "client", id: client.id })}>Detalhes</Button><Button size="sm" variant="outline" onClick={() => openSheet("clientEnvironment", { clientId: client.id })}>Ambiente</Button><Button size="sm" variant="outline" onClick={() => openSheet("client", { id: client.id })}>Editar</Button><Button size="sm" variant="outline" onClick={() => openSheet("order", { clientId: client.id })}>Criar OS</Button><ConfirmInline label="Inativar" onConfirm={() => inactivate("client", client.id)} /></TableCell></TableRow>)}
            </DataTable>
          </SectionCard>
        </TabsContent>
        <TabsContent value="ambientes">
          <SectionCard title="Ambientes e Equipamentos">
            <div className="mb-3 flex flex-wrap gap-2"><Button size="sm" onClick={() => openSheet("clientEnvironment")}>Novo ambiente</Button><Button size="sm" variant="outline" onClick={() => openSheet("clientEquipment")}>Novo equipamento</Button></div>
            <DataTable headers={["Cliente", "Ambiente", "Tipo atividade", "Ocupantes (total / fixos / flutuantes)", "Area climatizada", "Status", "Acoes"]} empty={!clientEnvironments.length} stickyHeader viewportClassName="max-h-[min(46vh,34rem)] overflow-auto overscroll-contain" tableClassName="h-auto min-w-[1080px] [&_tbody_tr]:h-auto [&_td]:py-2.5">
              {clientEnvironments.map((environment) => {
                return <TableRow key={environment.id}><TableCell>{names(state).client(environment.clientId)}</TableCell><TableCell>{environment.name}</TableCell><TableCell>{environment.activityType || "-"}</TableCell><TableCell>{`${Number(environment.occupantsTotal || 0)} / ${Number(environment.occupantsFixed || 0)} / ${Number(environment.occupantsFloating || 0)}`}</TableCell><TableCell>{Number(environment.airConditionedArea || 0) ? `${Number(environment.airConditionedArea).toLocaleString("pt-BR")} m²` : "-"}</TableCell><TableCell><StatusBadge status={environment.status} /></TableCell><TableCell className="space-x-1"><Button size="sm" variant="outline" onClick={() => openSheet("clientEnvironment", { id: environment.id })}>Editar</Button><Button size="sm" variant="outline" onClick={() => openSheet("clientEquipment", { clientId: environment.clientId, clientEnvironmentId: environment.id })}>Equipamento</Button></TableCell></TableRow>
              })}
            </DataTable>
            <div className="mt-4">
              <DataTable headers={["Cliente", "TAG", "Ambiente", "Equipamento", "Tipo", "Marca", "Modelo", "Capacidade", "Nº de serie", "Status", "Acoes"]} empty={!clientEquipment.length} stickyHeader viewportClassName="max-h-[min(46vh,34rem)] overflow-auto overscroll-contain" tableClassName="h-auto min-w-[1480px] [&_tbody_tr]:h-auto [&_td]:py-2.5">
                {clientEquipment.map((equipment) => {
                  const environment = state.clientEnvironments.find((item) => item.id === equipment.clientEnvironmentId)
                  return <TableRow key={equipment.id}><TableCell>{names(state).client(equipment.clientId)}</TableCell><TableCell>{equipment.tag || "-"}</TableCell><TableCell>{environment?.name || "-"}</TableCell><TableCell>{equipment.name}</TableCell><TableCell>{equipment.type || "-"}</TableCell><TableCell>{equipment.brand || "-"}</TableCell><TableCell>{equipment.model || "-"}</TableCell><TableCell>{equipment.capacity || "-"}</TableCell><TableCell>{equipment.serialNumber || "-"}</TableCell><TableCell><StatusBadge status={equipment.status} /></TableCell><TableCell><div className="flex gap-1"><EquipmentQrDialog equipment={equipment} /><Button size="sm" variant="outline" onClick={() => openSheet("clientEquipment", { id: equipment.id })}>Editar</Button></div></TableCell></TableRow>
                })}
              </DataTable>
            </div>
          </SectionCard>
        </TabsContent>
        <TabsContent value="fornecedores">
          <SectionCard title="Fornecedores">
            <DataTable headers={["Fornecedor", "CPF/CNPJ", "Categoria", "Contato", "Telefone", "E-mail", "Cidade", "Status", "Ações"]} empty={!suppliers.length} stickyHeader viewportClassName="max-h-[calc(100vh-19rem)] overflow-auto overscroll-contain" tableClassName="h-auto min-w-[1220px] [&_tbody_tr]:h-auto [&_td]:py-2.5">
              {suppliers.map((supplier) => <TableRow key={supplier.id}><TableCell>{supplier.name}</TableCell><TableCell>{supplier.document || "-"}</TableCell><TableCell>{supplier.category || "-"}</TableCell><TableCell>{supplier.contactName || "-"}</TableCell><TableCell>{supplier.phone || "-"}</TableCell><TableCell>{supplier.email || "-"}</TableCell><TableCell>{[supplier.city, supplier.state].filter(Boolean).join(" / ") || "-"}</TableCell><TableCell><StatusBadge status={supplier.status} /></TableCell><TableCell><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => openSheet("supplier", { id: supplier.id })}>Editar</Button><ConfirmInline label="Inativar" onConfirm={() => inactivate("supplier", supplier.id)} /></div></TableCell></TableRow>)}
            </DataTable>
          </SectionCard>
        </TabsContent>
        <TabsContent value="historico">
          <AuditTable state={state} filter={["client", "supplier"]} />
        </TabsContent>
      </Tabs>
      {detail ? <EntityDetail state={state} detail={detail} onClose={() => setDetail(null)} openSheet={openSheet} /> : null}
      <QuickSheets state={state} commit={commit} sheet={sheet} setSheet={setSheet} preset={preset} />
    </PageShell>
  )
}

export function ServicesPage() {
  const { state, commit } = useOperationalStore()
  const { sheet, setSheet, preset, openSheet } = useSheetWithPreset()
  const [tab, setTab] = useState("produtos")
  const [query, setQuery] = useState("")
  const [productQuery, setProductQuery] = useState("")
  const services = state.serviceTypes.filter((service) => [service.name, service.description, service.status, servicePeriodicityLabel(service.periodicityMonths), serviceContexts(service).map((context) => serviceContextLabels[context]).join(" "), state.stockKits.find((kit) => kit.id === service.kitId)?.name || ""].join(" ").toLowerCase().includes(query.toLowerCase()))
  const products = state.materials.filter((item) => [item.name, item.internalCode, item.ncm, item.barcode, item.category, item.status].join(" ").toLowerCase().includes(productQuery.toLowerCase()))
  const money = (value?: number) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
  const supplierName = (id?: string) => state.suppliers.find((item) => item.id === id)?.name || "-"

  return (
    <PageShell
      title="Produtos / Serviços"
      description="Catálogo de produtos (dados fiscais, logística e preços) e tipos de serviço usados em orçamentos e ordens de serviço."
      actions={tab === "produtos"
        ? <Button onClick={() => openSheet("material")}><Plus className="h-4 w-4" />Novo Produto</Button>
        : <Button onClick={() => openSheet("serviceType")}><Plus className="h-4 w-4" />Novo Serviço</Button>}
    >
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList><TabsTrigger value="produtos">Produtos</TabsTrigger><TabsTrigger value="servicos">Serviços</TabsTrigger></TabsList>
        <TabsContent value="produtos" className="mt-4">
          <SectionCard title="Produtos">
            <div className="mb-4 grid gap-3 md:grid-cols-3">
              <Input placeholder="Buscar por nome, SKU, NCM, código de barras..." value={productQuery} onChange={(event) => setProductQuery(event.target.value)} />
            </div>
            <DataTable headers={["Produto", "SKU", "NCM", "Origem", "Unidade", "Saldo", "Custo", "Venda", "Fornecedor", "Status", "Ações"]} empty={!products.length}>
              {products.map((item) => <TableRow key={item.id}><TableCell>{item.name}</TableCell><TableCell className="font-mono">{item.internalCode || "-"}</TableCell><TableCell className="font-mono">{item.ncm || "-"}</TableCell><TableCell>{item.origin || "-"}</TableCell><TableCell>{item.unit}</TableCell><TableCell>{materialStock(item)}</TableCell><TableCell>{money(item.costPrice)}</TableCell><TableCell>{money(item.salePrice)}</TableCell><TableCell>{supplierName(item.supplierId)}</TableCell><TableCell><StatusBadge status={item.status} /></TableCell><TableCell><Button size="sm" variant="outline" onClick={() => openSheet("material", { id: item.id })}>Editar</Button></TableCell></TableRow>)}
            </DataTable>
          </SectionCard>
        </TabsContent>
        <TabsContent value="servicos" className="mt-4">
          <SectionCard title="Tipos de serviço">
            <div className="mb-4 grid gap-3 md:grid-cols-3">
              <Input placeholder="Buscar serviço, kit ou status..." value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
            <DataTable headers={["Serviço", "Descrição", "Disponivel em", "Periodicidade", "Kit", "Execução", "Checklist", "Status", "Ações"]} empty={!services.length}>
              {services.map((service) => <TableRow key={service.id}><TableCell>{service.name}</TableCell><TableCell>{service.description || "-"}</TableCell><TableCell>{serviceContexts(service).map((context) => serviceContextLabels[context]).join(", ")}</TableCell><TableCell>{servicePeriodicityLabel(service.periodicityMonths)}</TableCell><TableCell>{state.stockKits.find((kit) => kit.id === service.kitId)?.name || "-"}</TableCell><TableCell>{Number(service.executionPercentage || 0)}%</TableCell><TableCell>{state.serviceTypeChecklistItems.filter((item) => item.serviceTypeId === service.id).length}</TableCell><TableCell><StatusBadge status={service.status} /></TableCell><TableCell><Button size="sm" variant="outline" onClick={() => openSheet("serviceType", { id: service.id })}>Editar</Button></TableCell></TableRow>)}
            </DataTable>
          </SectionCard>
        </TabsContent>
      </Tabs>
      <QuickSheets state={state} commit={commit} sheet={sheet} setSheet={setSheet} preset={preset} />
    </PageShell>
  )
}

const pmocMonths = [
  { value: 1, label: "Janeiro" },
  { value: 2, label: "Fevereiro" },
  { value: 3, label: "Março" },
  { value: 4, label: "Abril" },
  { value: 5, label: "Maio" },
  { value: 6, label: "Junho" },
  { value: 7, label: "Julho" },
  { value: 8, label: "Agosto" },
  { value: 9, label: "Setembro" },
  { value: 10, label: "Outubro" },
  { value: 11, label: "Novembro" },
  { value: 12, label: "Dezembro" },
]

function pmocFrequencyInterval(frequency: string) {
  return frequency === "Anual" ? 12 : frequency === "Semestral" ? 6 : frequency === "Trimestral" ? 3 : frequency === "Bimestral" ? 2 : 1
}

function dateFromParts(year: number, month: number, day = 10) {
  return `${year}-${String(Math.max(1, Math.min(12, month || 1))).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function parseLocalDate(value: string) {
  const [year, month, day] = String(value || "").split("-").map(Number)
  return new Date(year || new Date().getFullYear(), (month || 1) - 1, day || 10, 12, 0, 0, 0)
}

function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function pmocPlanStartDate(plan: { startDate?: string; startYear: number; startMonth: number }) {
  return plan.startDate || dateFromParts(plan.startYear, plan.startMonth)
}

function pmocPlanEndDate(plan: { endDate?: string; startYear: number }) {
  return plan.endDate || `${plan.startYear}-12-31`
}

function pmocDateForMonth(monthIndex: number, day: number) {
  const year = Math.floor(monthIndex / 12)
  const month = monthIndex % 12
  const lastDay = new Date(year, month + 1, 0, 12).getDate()
  return new Date(year, month, Math.min(Math.max(1, day), lastDay), 12)
}

function pmocDateForCompetency(competency: string, day: number) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(competency || ""))
  if (!match) return ""
  const year = Number(match[1])
  const month = Number(match[2])
  if (!year || month < 1 || month > 12) return ""
  return isoDate(pmocDateForMonth(year * 12 + month - 1, day))
}

function pmocCompetencyValidation(plan: { frequency: string; startDate?: string; endDate?: string; startYear: number; startMonth: number; scheduleDay?: number }, competency: string) {
  const scheduledDate = pmocDateForCompetency(competency, Number(plan.scheduleDay || 1))
  if (!scheduledDate) return { valid: false, scheduledDate: "", reason: "Selecione uma competência válida." }
  const start = parseLocalDate(pmocPlanStartDate(plan))
  const end = parseLocalDate(pmocPlanEndDate(plan))
  const scheduled = parseLocalDate(scheduledDate)
  if (scheduled < start || scheduled > end) {
    return { valid: false, scheduledDate, reason: "A competência precisa estar dentro da data inicial e da data final do plano." }
  }
  const startMonthIndex = start.getFullYear() * 12 + start.getMonth()
  const competencyMonthIndex = scheduled.getFullYear() * 12 + scheduled.getMonth()
  if ((competencyMonthIndex - startMonthIndex) % pmocFrequencyInterval(plan.frequency) !== 0) {
    return { valid: false, scheduledDate, reason: `A competência não corresponde à periodicidade ${plan.frequency.toLowerCase()} iniciada em ${formatDate(pmocPlanStartDate(plan))}.` }
  }
  return { valid: true, scheduledDate, reason: "" }
}

function pmocChecklistIdsFromNotes(notes?: string) {
  const line = String(notes || "").split("\n").find((item) => item.startsWith("__pmoc_checklist_ids:"))
  return line ? line.replace("__pmoc_checklist_ids:", "").split(",").map((item) => item.trim()).filter(Boolean) : []
}

function cleanPmocMeta(notes?: string) {
  return String(notes || "").split("\n").filter((line) => !line.startsWith("__pmoc_checklist_ids:")).join("\n").trim()
}

function withPmocChecklistMeta(notes: string, checklistIds: string[]) {
  return `${cleanPmocMeta(notes)}\n__pmoc_checklist_ids:${checklistIds.join(",")}`.trim()
}

function hydratePmocOrderFromType(state: OperationalState, serviceOrderId: string, serviceTypeId: string, selectedChecklistIds: string[]) {
  const defaults = hydrateServiceOrderFromType(state, serviceOrderId, serviceTypeId)
  if (!selectedChecklistIds.length) return defaults
  const allowedNames = new Set(
    state.serviceTypeChecklistItems
      .filter((item) => item.serviceTypeId === serviceTypeId && selectedChecklistIds.includes(item.id))
      .map((item) => item.taskName),
  )
  return { ...defaults, checklist: defaults.checklist.filter((item) => allowedNames.has(item.taskName)) }
}

function ensurePmocWork(current: OperationalState, plan: NonNullable<OperationalState["pmocPlans"]>[number]) {
  const existing = current.works.find((work) => work.id === plan.workId) || current.works.find((work) => work.clientId === plan.clientId)
  if (existing) return { state: current, workId: existing.id }
  const client = current.clients.find((item) => item.id === plan.clientId)
  const now = nowIso()
  const work: Work = {
    id: makeId("work"),
    clientId: plan.clientId,
    uniqueNumber: nextWorkNumber(current),
    name: `PMOC - ${client?.name || "Cliente"}`,
    type: "PMOC",
    status: "Ativa",
    zipCode: client?.zipCode || "",
    street: client?.street || "",
    number: client?.number || "",
    complement: client?.complement || "",
    district: client?.district || "",
    city: client?.city || "",
    state: client?.state || "",
    responsibleName: client?.responsibleName || "",
    responsiblePhone: client?.phone || client?.mobile || "",
    responsibleEmail: client?.email || "",
    responsibleRole: "Responsável",
    notes: "Local criado automaticamente pelo PMOC.",
    createdAt: now,
    updatedAt: now,
  }
  return { state: { ...current, works: [work, ...current.works] }, workId: work.id }
}

export function PmocPage() {
  const { state, commitConfirmed, saving, loading } = useOperationalStore()
  const { user } = useAuth()
  const readOnly = user?.role === "client"
  const { requireFields, toast } = useCrudFeedback()
  const labels = names(state)
  const [tab, setTab] = useState("planos")
  const [sheet, setSheet] = useState<"plan" | "sector" | "equipment" | "">("")
  const [selectedPlanId, setSelectedPlanId] = useState("")
  const [editingPlanId, setEditingPlanId] = useState("")
  const currentCompetency = today().slice(0, 7)
  const [planForm, setPlanForm] = useState<Record<string, any>>({ clientId: "", workId: "__auto", name: "", frequency: "Mensal", competency: currentCompetency, startMonth: String(new Date().getMonth() + 1), startYear: String(new Date().getFullYear()), startDate: today(), endDate: `${new Date().getFullYear()}-12-31`, scheduleDay: String(parseLocalDate(today()).getDate()), mainProviderId: "", status: "Ativo", paymentMethod: "", paymentType: "", paymentTerm: "", paymentDueDate: "", financialNotes: "", notes: "" })
  const [generationCompetency, setGenerationCompetency] = useState(currentCompetency)
  const [reportClientId, setReportClientId] = useState("")
  const [reportReferenceMonth, setReportReferenceMonth] = useState(currentCompetency)
  const [reportMonthsBack, setReportMonthsBack] = useState("11")
  const [isGeneratingAnnualReport, setIsGeneratingAnnualReport] = useState(false)
  const [sectorForm, setSectorForm] = useState<Record<string, any>>({ planId: "", name: "", floor: "", status: "Ativo", notes: "" })
  const [equipmentForm, setEquipmentForm] = useState<Record<string, any>>({ planId: "", sectorId: "", clientEnvironmentId: "", clientEquipmentId: "", tag: "", name: "", brand: "", model: "", serialNumber: "", capacity: "", location: "", status: "Ativo", notes: "" })
  const [selectedPlanEnvironmentIds, setSelectedPlanEnvironmentIds] = useState<string[]>([])
  const [selectedPlanEquipmentIds, setSelectedPlanEquipmentIds] = useState<string[]>([])
  const [planEnvironmentSearch, setPlanEnvironmentSearch] = useState("")
  const [planEquipmentSearch, setPlanEquipmentSearch] = useState("")
  const [serviceToAdd, setServiceToAdd] = useState("")
  const [selectedServices, setSelectedServices] = useState<string[]>([])
  const [selectedChecklistTaskIds, setSelectedChecklistTaskIds] = useState<string[]>([])

  const plans = state.pmocPlans || []
  const pmocClients = state.clients.filter((client) => (client.serviceContexts || []).includes("pmoc") || (Boolean(editingPlanId) && client.id === planForm.clientId))
  const reportClients = state.clients.filter((client) => plans.some((plan) => plan.clientId === client.id))
  const reportClientIds = reportClients.map((client) => client.id).join("|")
  const reportScopeClientId = readOnly ? (user?.clientId || "__sem_cliente__") : reportClientId
  const reportReferenceIndex = (() => {
    const [year, month] = reportReferenceMonth.split("-").map(Number)
    return (year || new Date().getFullYear()) * 12 + (month || 1) - 1
  })()
  const reportScopedPlans = plans.filter((plan) => {
    if (reportScopeClientId !== "all" && plan.clientId !== reportScopeClientId) return false
    const [startYear, startMonth] = String(plan.startDate || `${plan.startYear}-${plan.startMonth}`).split("-").map(Number)
    const [endYear, endMonth] = String(plan.endDate || `${plan.startYear}-12`).split("-").map(Number)
    const startIndex = (startYear || plan.startYear) * 12 + (startMonth || plan.startMonth) - 1
    const endIndex = (endYear || plan.startYear) * 12 + (endMonth || 12) - 1
    return startIndex <= reportReferenceIndex && endIndex >= reportReferenceIndex
  })
  const reportPlanIds = new Set(reportScopedPlans.map((plan) => plan.id))
  const reportClientCount = new Set(reportScopedPlans.map((plan) => plan.clientId)).size
  const reportEquipmentCount = (state.pmocEquipment || []).filter((item) => item.status === "Ativo" && reportPlanIds.has(item.planId)).length
  const pmocProviders = state.providers.filter((provider) => provider.status === "Ativo" || provider.id === planForm.mainProviderId)
  const selectedPlan = plans.find((item) => item.id === selectedPlanId) || plans[0]
  const selectedPlanSectors = selectedPlan ? (state.pmocSectors || []).filter((item) => item.planId === selectedPlan.id) : []
  const selectedPlanEquipment = selectedPlan ? (state.pmocEquipment || []).filter((item) => item.planId === selectedPlan.id) : []
  const selectedPlanSchedules = selectedPlan ? (state.pmocSchedules || []).filter((item) => item.planId === selectedPlan.id) : []
  const activeServices = state.serviceTypes.filter((item) => item.status === "Ativo" && serviceEnabledFor(item, "pmoc"))
  const checklistTasksForSelectedServices = state.serviceTypeChecklistItems
    .filter((item) => selectedServices.includes(item.serviceTypeId))
    .sort((a, b) => labels.serviceType(a.serviceTypeId).localeCompare(labels.serviceType(b.serviceTypeId)) || a.order - b.order)
  const planEquipmentEnvironmentIds = new Set(
    (state.clientEquipment || [])
      .filter((item) => item.status === "Ativo" && (!planForm.clientId || item.clientId === planForm.clientId))
      .map((item) => item.clientEnvironmentId)
  )
  const clientEnvironmentsForPlan = (state.clientEnvironments || [])
    .filter((item) => item.status === "Ativo" && (!planForm.clientId || item.clientId === planForm.clientId))
    .sort((a, b) => {
      const equipmentOrder = Number(planEquipmentEnvironmentIds.has(b.id)) - Number(planEquipmentEnvironmentIds.has(a.id))
      if (equipmentOrder !== 0) return equipmentOrder

      const aLabel = [a.name, a.floor, a.location].filter(Boolean).join(" - ")
      const bLabel = [b.name, b.floor, b.location].filter(Boolean).join(" - ")
      return aLabel.localeCompare(bLabel, "pt-BR", { numeric: true, sensitivity: "base" })
    })
  const clientEquipmentForPlan = (state.clientEquipment || [])
    .filter((item) => item.status === "Ativo" && (!planForm.clientId || item.clientId === planForm.clientId) && (!selectedPlanEnvironmentIds.length || selectedPlanEnvironmentIds.includes(item.clientEnvironmentId)))
    .sort((left, right) => compareAlphaNumeric([left.tag, left.name, left.capacity].filter(Boolean).join(" - "), [right.tag, right.name, right.capacity].filter(Boolean).join(" - ")))
  const filteredClientEnvironmentsForPlan = clientEnvironmentsForPlan.filter((environment) => {
    const query = normalizeClientImportKey(planEnvironmentSearch)
    if (!query) return true
    return normalizeClientImportKey([environment.name, environment.floor, environment.location].filter(Boolean).join(" ")).includes(query)
  })
  const filteredClientEquipmentForPlan = clientEquipmentForPlan.filter((equipment) => {
    const query = normalizeClientImportKey(planEquipmentSearch)
    if (!query) return true
    const environment = (state.clientEnvironments || []).find((item) => item.id === equipment.clientEnvironmentId)
    return normalizeClientImportKey([
      equipment.tag,
      equipment.name,
      equipment.brand,
      equipment.model,
      equipment.serialNumber,
      equipment.capacity,
      environment?.name,
      environment?.floor,
      environment?.location,
    ].filter(Boolean).join(" ")).includes(query)
  })
  const allFilteredPlanEnvironmentsSelected = Boolean(filteredClientEnvironmentsForPlan.length) && filteredClientEnvironmentsForPlan.every((item) => selectedPlanEnvironmentIds.includes(item.id))
  const allFilteredPlanEquipmentSelected = Boolean(filteredClientEquipmentForPlan.length) && filteredClientEquipmentForPlan.every((item) => selectedPlanEquipmentIds.includes(item.id))
  const equipmentPlan = plans.find((item) => item.id === equipmentForm.planId) || selectedPlan
  const clientEnvironmentsForEquipment = (state.clientEnvironments || []).filter((item) => item.status === "Ativo" && (!equipmentPlan?.clientId || item.clientId === equipmentPlan.clientId))
  const clientEquipmentForEquipment = (state.clientEquipment || []).filter((item) => item.status === "Ativo" && (!equipmentPlan?.clientId || item.clientId === equipmentPlan.clientId) && (!equipmentForm.clientEnvironmentId || item.clientEnvironmentId === equipmentForm.clientEnvironmentId))

  useEffect(() => {
    if (readOnly || !reportClientIds) return
    const availableIds = reportClientIds.split("|")
    setReportClientId((current) => availableIds.includes(current) ? current : availableIds[0])
  }, [readOnly, reportClientIds])

  function openPlanSheet() {
    setEditingPlanId("")
    const competency = today().slice(0, 7)
    const year = competency.slice(0, 4)
    setPlanForm({ clientId: "", workId: "__auto", name: "", frequency: "Mensal", competency, startMonth: String(new Date().getMonth() + 1), startYear: year, startDate: today(), endDate: `${year}-12-31`, scheduleDay: String(parseLocalDate(today()).getDate()), mainProviderId: "", status: "Ativo", paymentMethod: "", paymentType: "", paymentTerm: "", paymentDueDate: "", financialNotes: "", notes: "" })
    setEquipmentForm({ planId: "", sectorId: "", clientEnvironmentId: "", clientEquipmentId: "", tag: "", name: "", brand: "", model: "", serialNumber: "", capacity: "", location: "", status: "Ativo", notes: "" })
    setSelectedPlanEnvironmentIds([])
    setSelectedPlanEquipmentIds([])
    setPlanEnvironmentSearch("")
    setPlanEquipmentSearch("")
    setSelectedServices([])
    setSelectedChecklistTaskIds([])
    setServiceToAdd("")
    setSheet("plan")
  }

  function openEditPlanSheet(planId: string) {
    const plan = plans.find((item) => item.id === planId)
    if (!plan) return
    const serviceIds = Array.from(new Set((state.pmocEquipmentServices || []).filter((item) => item.planId === plan.id).map((item) => item.serviceTypeId)))
    const checklistIds = pmocChecklistIdsFromNotes(plan.notes)
    setEditingPlanId(plan.id)
    setPlanForm({
      clientId: plan.clientId,
      workId: plan.workId || "__auto",
      name: plan.name,
      frequency: plan.frequency,
      competency: `${plan.startYear || new Date().getFullYear()}-${String(plan.startMonth || 1).padStart(2, "0")}`,
      startMonth: String(plan.startMonth || 1),
      startYear: String(plan.startYear || new Date().getFullYear()),
      startDate: pmocPlanStartDate(plan),
      endDate: pmocPlanEndDate(plan),
      scheduleDay: String((plan as any).scheduleDay || parseLocalDate(pmocPlanStartDate(plan)).getDate()),
      mainProviderId: (plan as any).mainProviderId || "",
      status: plan.status,
      paymentMethod: (plan as any).paymentMethod || "",
      paymentType: (plan as any).paymentType || "",
      paymentTerm: (plan as any).paymentTerm || "",
      paymentDueDate: (plan as any).paymentDueDate || "",
      financialNotes: (plan as any).financialNotes || "",
      notes: cleanPmocMeta(plan.notes),
    })
    setEquipmentForm({ planId: plan.id, sectorId: "", clientEnvironmentId: "", clientEquipmentId: "", tag: "", name: "", brand: "", model: "", serialNumber: "", capacity: "", location: "", status: "Ativo", notes: "" })
    setSelectedPlanEnvironmentIds([])
    setSelectedPlanEquipmentIds([])
    setPlanEnvironmentSearch("")
    setPlanEquipmentSearch("")
    setSelectedServices(serviceIds)
    setSelectedChecklistTaskIds(checklistIds.length ? checklistIds : state.serviceTypeChecklistItems.filter((item) => serviceIds.includes(item.serviceTypeId)).map((item) => item.id))
    setServiceToAdd("")
    setSheet("plan")
  }

  function openSectorSheet() {
    setSectorForm({ planId: selectedPlan?.id || "", name: "", floor: "", status: "Ativo", notes: "" })
    setSheet("sector")
  }

  function openEquipmentSheet() {
    setEquipmentForm({ planId: selectedPlan?.id || "", sectorId: selectedPlanSectors[0]?.id || "", clientEnvironmentId: "", clientEquipmentId: "", tag: "", name: "", brand: "", model: "", serialNumber: "", capacity: "", location: "", status: "Ativo", notes: "" })
    setSelectedServices([])
    setServiceToAdd("")
    setSheet("equipment")
  }

  function selectEquipmentPlan(planId: string) {
    const plan = plans.find((item) => item.id === planId)
    const firstSector = (state.pmocSectors || []).find((sector) => sector.planId === planId)
    const firstEnvironment = (state.clientEnvironments || []).find((environment) => environment.status === "Ativo" && environment.clientId === plan?.clientId)
    setEquipmentForm({ ...equipmentForm, planId, sectorId: firstSector?.id || "", clientEnvironmentId: firstEnvironment?.id || "", clientEquipmentId: "", tag: "", name: "", brand: "", model: "", serialNumber: "", capacity: "", location: firstEnvironment ? [firstEnvironment.name, firstEnvironment.floor, firstEnvironment.location].filter(Boolean).join(" - ") : "", notes: equipmentForm.notes || "" })
  }

  function selectClientEnvironment(environmentId: string) {
    const environment = (state.clientEnvironments || []).find((item) => item.id === environmentId)
    const sector = (state.pmocSectors || []).find((item) => item.planId === equipmentForm.planId && item.name === environment?.name)
    setEquipmentForm({ ...equipmentForm, clientEnvironmentId: environmentId, clientEquipmentId: "", sectorId: sector?.id || "", location: environment ? [environment.name, environment.floor, environment.location].filter(Boolean).join(" - ") : equipmentForm.location })
  }

  function selectClientEquipment(equipmentId: string) {
    const equipment = (state.clientEquipment || []).find((item) => item.id === equipmentId)
    const environment = (state.clientEnvironments || []).find((item) => item.id === equipment?.clientEnvironmentId)
    setEquipmentForm({
      ...equipmentForm,
      clientEquipmentId: equipmentId,
      clientEnvironmentId: equipment?.clientEnvironmentId || equipmentForm.clientEnvironmentId,
      tag: equipment?.tag || equipmentForm.tag,
      name: equipment?.name || equipmentForm.name,
      brand: equipment?.brand || equipmentForm.brand,
      model: equipment?.model || equipmentForm.model,
      serialNumber: equipment?.serialNumber || equipmentForm.serialNumber,
      capacity: equipment?.capacity || equipmentForm.capacity,
      location: environment ? [environment.name, environment.floor, environment.location].filter(Boolean).join(" - ") : equipmentForm.location,
    })
  }

  function selectPlanClient(clientId: string) {
    setPlanForm({ ...planForm, clientId, workId: "__auto", name: planForm.name || `PMOC - ${labels.client(clientId)}` })
    setEquipmentForm({ planId: "", sectorId: "", clientEnvironmentId: "", clientEquipmentId: "", tag: "", name: "", brand: "", model: "", serialNumber: "", capacity: "", location: "", status: "Ativo", notes: "" })
    setSelectedPlanEnvironmentIds([])
    setSelectedPlanEquipmentIds([])
    setPlanEnvironmentSearch("")
    setPlanEquipmentSearch("")
  }

  function toggleAllPlanEnvironments(checked: boolean) {
    const environmentIds = filteredClientEnvironmentsForPlan.map((item) => item.id)
    setSelectedPlanEnvironmentIds(checked
      ? Array.from(new Set([...selectedPlanEnvironmentIds, ...environmentIds]))
      : selectedPlanEnvironmentIds.filter((id) => !environmentIds.includes(id)))
    if (!checked) {
      setSelectedPlanEquipmentIds(selectedPlanEquipmentIds.filter((equipmentId) => {
        const equipment = state.clientEquipment.find((item) => item.id === equipmentId)
        return !equipment || !environmentIds.includes(equipment.clientEnvironmentId)
      }))
    }
  }

  function toggleAllPlanEquipment(checked: boolean) {
    const equipmentIds = filteredClientEquipmentForPlan.map((item) => item.id)
    setSelectedPlanEquipmentIds(checked
      ? Array.from(new Set([...selectedPlanEquipmentIds, ...equipmentIds]))
      : selectedPlanEquipmentIds.filter((id) => !equipmentIds.includes(id)))
    if (checked) {
      setSelectedPlanEnvironmentIds(Array.from(new Set([...selectedPlanEnvironmentIds, ...filteredClientEquipmentForPlan.map((item) => item.clientEnvironmentId)])))
      const first = filteredClientEquipmentForPlan[0]
      if (first && !equipmentForm.name) selectPlanEquipment(first.id)
    }
  }

  function selectPlanEnvironment(environmentId: string) {
    const environment = (state.clientEnvironments || []).find((item) => item.id === environmentId)
    setEquipmentForm({ ...equipmentForm, clientEnvironmentId: environmentId, clientEquipmentId: "", sectorId: "", tag: "", name: "", brand: "", model: "", serialNumber: "", capacity: "", location: environment ? [environment.name, environment.floor, environment.location].filter(Boolean).join(" - ") : equipmentForm.location })
  }

  function selectPlanEquipment(equipmentId: string) {
    selectClientEquipment(equipmentId)
  }

  async function savePlan() {
    if (!requireFields([
      ["Cliente", planForm.clientId],
      ["Nome do plano", planForm.name || labels.client(planForm.clientId)],
      ["Data inicial", planForm.startDate],
      ["Data final", planForm.endDate],
      ...(!editingPlanId ? [["Competencia da OS", planForm.competency] as [string, string]] : []),
    ])) return
    const scheduleDay = Number(planForm.scheduleDay)
    if (!Number.isInteger(scheduleDay) || scheduleDay < 1 || scheduleDay > 31) {
      toast({ title: "Dia fixo invalido", description: "Informe um dia entre 1 e 31.", variant: "destructive" })
      return
    }
    if (!editingPlanId && !selectedPlanEquipmentIds.length && !equipmentForm.name) {
      toast({ title: "Equipamento obrigatorio", description: "Selecione pelo menos um equipamento ou preencha um equipamento manual.", variant: "destructive" })
      return
    }
    if (parseLocalDate(planForm.endDate) < parseLocalDate(planForm.startDate)) {
      toast({ title: "Data final invÃ¡lida", description: "A data final precisa ser maior ou igual Ã  data inicial.", variant: "destructive" })
      return
    }
    const [formStartYear, formStartMonth] = String(planForm.startDate).split("-").map(Number)
    const competencyValidation = pmocCompetencyValidation({
      frequency: planForm.frequency,
      startDate: planForm.startDate,
      endDate: planForm.endDate,
      startYear: formStartYear,
      startMonth: formStartMonth,
      scheduleDay,
    }, planForm.competency)
    const competencyDate = competencyValidation.scheduledDate
    if (!editingPlanId && !competencyValidation.valid) {
      toast({ title: "Competencia invalida", description: competencyValidation.reason, variant: "destructive" })
      return
    }
    if (!selectedServices.length) {
      toast({ title: "Servico obrigatorio", description: "Vincule pelo menos um servico PMOC ao equipamento.", variant: "destructive" })
      return
    }
    if (checklistTasksForSelectedServices.length && !selectedChecklistTaskIds.length) {
      toast({ title: "Checklist obrigatorio", description: "Selecione pelo menos um item de checklist para executar.", variant: "destructive" })
      return
    }
    const now = nowIso()
    if (editingPlanId) {
      const startDate = String(planForm.startDate || today())
      const [startYear, startMonth] = startDate.split("-").map(Number)
      if (!await commitConfirmed((current) => ({
        ...current,
        pmocPlans: (current.pmocPlans || []).map((item) => item.id === editingPlanId
          ? {
              ...item,
              clientId: planForm.clientId,
              workId: planForm.workId === "__auto" ? "" : planForm.workId,
              name: planForm.name || `PMOC - ${labels.client(planForm.clientId)}`,
              frequency: planForm.frequency,
              startMonth: startMonth || Number(planForm.startMonth || 1),
              startYear: startYear || Number(planForm.startYear || new Date().getFullYear()),
              startDate,
              endDate: String(planForm.endDate || `${startYear || new Date().getFullYear()}-12-31`),
              scheduleDay,
              mainProviderId: planForm.mainProviderId || "",
              status: planForm.status,
              paymentMethod: planForm.paymentMethod || "",
              paymentType: planForm.paymentType || "",
              paymentTerm: planForm.paymentTerm || "",
              paymentDueDate: planForm.paymentDueDate || "",
              financialNotes: planForm.financialNotes || "",
              notes: withPmocChecklistMeta(planForm.notes, selectedChecklistTaskIds),
              updatedAt: now,
            }
          : item),
        pmocSchedules: (current.pmocSchedules || []).map((schedule) => schedule.planId === editingPlanId
          ? { ...schedule, scheduledDate: isoDate(pmocDateForMonth(schedule.year * 12 + schedule.month - 1, scheduleDay)), updatedAt: now }
          : schedule),
        serviceOrders: current.serviceOrders.map((order) => {
          const schedule = (current.pmocSchedules || []).find((item) => item.planId === editingPlanId && item.serviceOrderId === order.id)
          if (!schedule || ["Finalizada", "Cancelada"].includes(order.status)) return order
          return { ...order, scheduledDate: isoDate(pmocDateForMonth(schedule.year * 12 + schedule.month - 1, scheduleDay)), mainProviderId: planForm.mainProviderId || "", updatedAt: now }
        }),
        auditLogs: appendAudit(current, "pmoc_plan", editingPlanId, "Editado", `Plano ${planForm.name} editado`),
      }))) return
      setSheet("")
      setEditingPlanId("")
      toast({ title: "Plano PMOC atualizado", description: "Dados do plano e checklist selecionado foram salvos." })
      return
    }
    const id = makeId("pmoc-plan")
    const competencyYear = Number(String(planForm.competency).slice(0, 4)) || new Date().getFullYear()
    const competencyMonth = Number(String(planForm.competency).slice(5, 7)) || 1
    const startDate = String(planForm.startDate)
    const [startYear, startMonth] = startDate.split("-").map(Number)
    const record = {
      id,
      clientId: planForm.clientId,
      workId: planForm.workId === "__auto" ? "" : planForm.workId,
      name: planForm.name || `PMOC - ${labels.client(planForm.clientId)}`,
      frequency: planForm.frequency,
      startMonth,
      startYear,
      startDate,
      endDate: String(planForm.endDate),
      scheduleDay,
      mainProviderId: planForm.mainProviderId || "",
      status: planForm.status,
      paymentMethod: planForm.paymentMethod || "",
      paymentType: planForm.paymentType || "",
      paymentTerm: planForm.paymentTerm || "",
      paymentDueDate: planForm.paymentDueDate || "",
      financialNotes: planForm.financialNotes || "",
      notes: withPmocChecklistMeta(planForm.notes, selectedChecklistTaskIds),
      createdAt: now,
      updatedAt: now,
    }
    const selectedClientEquipment = selectedPlanEquipmentIds
      .map((equipmentId) => (state.clientEquipment || []).find((item) => item.id === equipmentId))
      .filter(Boolean) as ClientEquipment[]
    const manualEquipment = !selectedClientEquipment.length ? [{ ...equipmentForm, id: "", clientEnvironmentId: equipmentForm.clientEnvironmentId || selectedPlanEnvironmentIds[0] || "", clientEquipmentId: "" }] : []
    const sourceEquipment: any[] = [...selectedClientEquipment, ...manualEquipment]
    const sectors = sourceEquipment.map((source) => {
      const selectedEnvironment = (state.clientEnvironments || []).find((item) => item.id === source.clientEnvironmentId)
      return {
        id: makeId("pmoc-sector"),
        planId: id,
        sourceEquipmentId: source.id || "",
        sourceEnvironmentId: source.clientEnvironmentId || "",
        name: selectedEnvironment?.name || equipmentForm.location || "Ambiente PMOC",
        floor: selectedEnvironment ? [selectedEnvironment.floor, selectedEnvironment.location].filter(Boolean).join(" - ") : "",
        status: "Ativo" as const,
        notes: selectedEnvironment?.notes || "Setor criado automaticamente pelo plano PMOC.",
        createdAt: now,
        updatedAt: now,
      }
    })
    const equipmentRecords = sourceEquipment.map((source, index) => {
      const sector = sectors[index]
      const selectedEnvironment = (state.clientEnvironments || []).find((item) => item.id === source.clientEnvironmentId)
      return { id: makeId("pmoc-eq"), planId: id, sectorId: sector.id, clientEnvironmentId: source.clientEnvironmentId || "", clientEquipmentId: source.id || source.clientEquipmentId || "", tag: (source as any).tag || equipmentForm.tag || "", name: source.name || equipmentForm.name, brand: source.brand || equipmentForm.brand || "", model: source.model || equipmentForm.model || "", serialNumber: source.serialNumber || equipmentForm.serialNumber || "", capacity: source.capacity || equipmentForm.capacity || "", location: selectedEnvironment ? [selectedEnvironment.name, selectedEnvironment.floor, selectedEnvironment.location].filter(Boolean).join(" - ") : equipmentForm.location, status: "Ativo" as const, notes: equipmentForm.notes, createdAt: now, updatedAt: now }
    })
    const links = equipmentRecords.flatMap((equipment) => selectedServices.map((serviceTypeId) => ({ id: makeId("pmoc-eq-service"), planId: id, equipmentId: equipment.id, serviceTypeId, createdAt: now })))
    const schedules = equipmentRecords.flatMap((equipment) => selectedServices.map((serviceTypeId) => ({
      id: makeId("pmoc-schedule"),
      planId: id,
      equipmentId: equipment.id,
      serviceTypeId,
      month: competencyMonth,
      year: competencyYear,
      scheduledDate: competencyDate,
      serviceOrderId: "",
      status: "Planejado" as const,
      createdAt: now,
      updatedAt: now,
    })))
    if (!await commitConfirmed((current) => {
      const withPlan = {
        ...current,
        pmocPlans: [record, ...(current.pmocPlans || [])],
        pmocSectors: [ ...sectors.map(({ sourceEquipmentId, sourceEnvironmentId, ...sector }) => sector), ...(current.pmocSectors || [])],
        pmocEquipment: [...equipmentRecords, ...(current.pmocEquipment || [])],
        pmocEquipmentServices: [...links, ...(current.pmocEquipmentServices || [])],
        pmocSchedules: [...schedules, ...(current.pmocSchedules || [])],
        auditLogs: appendAudit(current, "pmoc_plan", id, "Criado", `Plano ${record.name} criado com equipamento e servicos`),
      }
      return openPmocOrdersForSchedules(withPlan, id, new Set(schedules.map((schedule) => schedule.id))).state
    })) return
    setSelectedPlanId(id)
    setSheet("")
    toast({ title: "Plano PMOC salvo", description: `Plano ${String(planForm.frequency).toLowerCase()} criado e somente a OS de ${String(competencyMonth).padStart(2, "0")}/${competencyYear} foi aberta.` })
  }

  async function saveSector() {
    if (!requireFields([["Plano PMOC", sectorForm.planId], ["Setor", sectorForm.name]])) return
    const now = nowIso()
    const id = makeId("pmoc-sector")
    const record = { id, planId: sectorForm.planId, name: sectorForm.name, floor: sectorForm.floor, status: sectorForm.status, notes: sectorForm.notes, createdAt: now, updatedAt: now }
    if (!await commitConfirmed((current) => ({ ...current, pmocSectors: [record, ...(current.pmocSectors || [])], auditLogs: appendAudit(current, "pmoc_sector", id, "Criado", `Setor ${record.name} criado`) }))) return
    setSheet("")
    toast({ title: "Setor salvo", description: "Setor disponível para receber equipamentos." })
  }

  function addSelectedService() {
    if (!serviceToAdd || selectedServices.includes(serviceToAdd)) return
    setSelectedServices([...selectedServices, serviceToAdd])
    setSelectedChecklistTaskIds(Array.from(new Set([...selectedChecklistTaskIds, ...state.serviceTypeChecklistItems.filter((item) => item.serviceTypeId === serviceToAdd).map((item) => item.id)])))
    setServiceToAdd("")
  }

  function removeSelectedService(serviceTypeId: string) {
    const nextServices = selectedServices.filter((item) => item !== serviceTypeId)
    setSelectedServices(nextServices)
    setSelectedChecklistTaskIds(selectedChecklistTaskIds.filter((taskId) => {
      const task = state.serviceTypeChecklistItems.find((item) => item.id === taskId)
      return task && nextServices.includes(task.serviceTypeId)
    }))
  }

  function openPmocOrdersForSchedules(current: OperationalState, planId: string, onlyScheduleIds?: Set<string>) {
    let working = current
    const plan = working.pmocPlans.find((item) => item.id === planId)
    if (!plan) return { state: current, count: 0 }
    const ensured = ensurePmocWork(working, plan)
    working = ensured.state
    const pending = (working.pmocSchedules || []).filter((item) => item.planId === plan.id && !item.serviceOrderId && item.status === "Planejado" && (!onlyScheduleIds || onlyScheduleIds.has(item.id)))
    if (!pending.length) return { state: working, count: 0 }
    const selectedChecklistIds = pmocChecklistIdsFromNotes(plan.notes)
    const localLabels = names(working)
    const newOrders: ServiceOrder[] = []
    const newChecklist: ChecklistItem[] = []
    const newMaterials: ServiceOrderMaterial[] = []
    const now = nowIso()
    const pendingIds = new Set(pending.map((item) => item.id))
    const groups = Array.from(new Set(pending.map((item) => item.scheduledDate))).map((scheduledDate) => ({
      scheduledDate,
      schedules: pending.filter((item) => item.scheduledDate === scheduledDate),
    }))
    const generatedOrderBySchedule = new Map<string, string>()

    groups.forEach((group) => {
      const equipmentIds = Array.from(new Set(group.schedules.map((item) => item.equipmentId)))
      const equipment = equipmentIds.map((equipmentId) => working.pmocEquipment.find((item) => item.id === equipmentId)).filter(Boolean)
      const serviceTypeIds = Array.from(new Set(group.schedules.map((item) => item.serviceTypeId)))
      const clientEnvironmentIds = Array.from(new Set(equipment.map((item) => item?.clientEnvironmentId).filter(Boolean))) as string[]
      const clientEquipmentIds = Array.from(new Set(equipment.map((item) => item?.clientEquipmentId).filter(Boolean))) as string[]
      const firstEquipment = equipment[0]
      const sectors = Array.from(new Set(equipment.map((item) => working.pmocSectors.find((sector) => sector.id === item?.sectorId)?.name).filter(Boolean)))
      const competency = parseLocalDate(group.scheduledDate)
      const orderId = makeId("order")
      const order: ServiceOrder = {
        id: orderId,
        orderNumber: nextOrderNumber({ ...working, serviceOrders: [...newOrders, ...working.serviceOrders] }),
        orderType: "pmoc",
        serviceCategory: "Manutencao Preventiva",
        clientId: plan.clientId,
        workId: ensured.workId,
        clientEnvironmentId: firstEquipment?.clientEnvironmentId || "",
        clientEquipmentId: firstEquipment?.clientEquipmentId || "",
        workStructureId: "",
        floorId: "",
        environmentId: "",
        pointId: "",
        simpleService: true,
        serviceTypeId: serviceTypeIds[0] || "",
        priority: "Media" as any,
        description: `PMOC ${String(competency.getMonth() + 1).padStart(2, "0")}/${competency.getFullYear()} - ${equipment.length} equipamento(s)`,
        scheduledDate: group.scheduledDate,
        scheduledStartTime: "08:00",
        scheduledEndTime: "10:00",
        estimatedDuration: "2h",
        allowReschedule: true,
        scheduleNotes: `Setores: ${sectors.join(", ") || "-"} | Equipamentos: ${equipment.map((item) => item?.name).filter(Boolean).join(", ") || "-"}`,
        mainProviderId: (plan as any).mainProviderId || "",
        helperProviderId: "",
        supervisorId: "",
        vehicleId: "",
        initialKm: 0,
        finalKm: 0,
        totalAmount: 0,
        paymentMethod: (plan as any).paymentMethod || "",
        paymentType: (plan as any).paymentType || "",
        paymentTerm: (plan as any).paymentTerm || "",
        paymentDueDate: (plan as any).paymentDueDate || "",
        financialNotes: (plan as any).financialNotes || "",
        status: "Agendada",
        customerResponsibleName: "",
        customerResponsiblePhone: "",
        teamNotes: "",
        notes: [
          `Gerada automaticamente pelo PMOC ${plan.name}.`,
          `Competencia: ${String(competency.getMonth() + 1).padStart(2, "0")}/${competency.getFullYear()}.`,
          `Selecoes OS JSON: ${JSON.stringify({ clientEnvironmentIds, clientEquipmentIds, serviceTypeIds })}`,
        ].join("\n"),
        pauseReason: "",
        cancellationReason: "",
        partialReason: "",
        createdAt: now,
        updatedAt: now,
        finishedAt: "",
        cancelledAt: "",
      }
      newOrders.push(order)
      serviceTypeIds.forEach((serviceTypeId) => {
        const defaults = hydratePmocOrderFromType(working, orderId, serviceTypeId, selectedChecklistIds)
        newChecklist.push(...defaults.checklist)
        newMaterials.push(...defaults.materials)
      })
      group.schedules.forEach((schedule) => generatedOrderBySchedule.set(schedule.id, orderId))
    })
    const schedules = (working.pmocSchedules || []).map((schedule) => pendingIds.has(schedule.id)
      ? { ...schedule, serviceOrderId: generatedOrderBySchedule.get(schedule.id) || "", status: "OS aberta" as const, updatedAt: now }
      : schedule)
    return {
      count: newOrders.length,
      state: {
        ...working,
        pmocSchedules: schedules,
        serviceOrders: [...newOrders, ...working.serviceOrders],
        checklistItems: [...newChecklist, ...working.checklistItems],
        serviceOrderMaterials: [...newMaterials, ...working.serviceOrderMaterials],
        auditLogs: appendAudit(working, "pmoc_plan", plan.id, "OS geradas", `${newOrders.length} OS geradas pelo cronograma PMOC`),
      },
    }
  }

  async function saveEquipment() {
    if (!requireFields([["Plano PMOC", equipmentForm.planId], ["Equipamento", equipmentForm.name]])) return
    if (!selectedServices.length) {
      toast({ title: "Serviço obrigatório", description: "Vincule pelo menos um serviço preventivo ao equipamento.", variant: "destructive" })
      return
    }
    const plan = plans.find((item) => item.id === equipmentForm.planId)
    if (!plan) return
    const now = nowIso()
    const selectedEnvironment = (state.clientEnvironments || []).find((item) => item.id === equipmentForm.clientEnvironmentId)
    const existingSector = (state.pmocSectors || []).find((item) => item.planId === plan.id && item.id === equipmentForm.sectorId) || (state.pmocSectors || []).find((item) => item.planId === plan.id && selectedEnvironment && item.name === selectedEnvironment.name)
    const autoSector = existingSector ? null : {
      id: makeId("pmoc-sector"),
      planId: plan.id,
      name: selectedEnvironment?.name || equipmentForm.location || "Ambiente PMOC",
      floor: selectedEnvironment ? [selectedEnvironment.floor, selectedEnvironment.location].filter(Boolean).join(" - ") : "",
      status: "Ativo" as const,
      notes: selectedEnvironment?.notes || "Setor criado automaticamente pelo equipamento PMOC.",
      createdAt: now,
      updatedAt: now,
    }
    const sectorId = existingSector?.id || autoSector?.id || equipmentForm.sectorId
    if (!sectorId) {
      toast({ title: "Ambiente obrigatÃ³rio", description: "Selecione um ambiente do cliente ou um setor para vincular o equipamento.", variant: "destructive" })
      return
    }
    const equipmentId = makeId("pmoc-eq")
    const equipment = { id: equipmentId, planId: equipmentForm.planId, sectorId, clientEnvironmentId: equipmentForm.clientEnvironmentId || "", clientEquipmentId: equipmentForm.clientEquipmentId || "", tag: equipmentForm.tag, name: equipmentForm.name, brand: equipmentForm.brand, model: equipmentForm.model, serialNumber: equipmentForm.serialNumber, capacity: equipmentForm.capacity, location: equipmentForm.location, status: equipmentForm.status, notes: equipmentForm.notes, createdAt: now, updatedAt: now }
    const links = selectedServices.map((serviceTypeId) => ({ id: makeId("pmoc-eq-service"), planId: plan.id, equipmentId, serviceTypeId, createdAt: now }))
    if (!await commitConfirmed((current) => ({
      ...current,
      pmocSectors: autoSector ? [autoSector, ...(current.pmocSectors || [])] : current.pmocSectors,
      pmocEquipment: [equipment, ...(current.pmocEquipment || [])],
      pmocEquipmentServices: [...links, ...(current.pmocEquipmentServices || [])],
      auditLogs: appendAudit(current, "pmoc_equipment", equipmentId, "Criado", `Equipamento ${equipment.name} vinculado ao plano PMOC`),
    }))) return
    setSheet("")
    toast({ title: "Equipamento salvo", description: "O equipamento entrara nas proximas competencias geradas para este plano." })
  }

  async function archivePlan(planId: string) {
    const plan = plans.find((item) => item.id === planId)
    if (!plan) return
    if (!window.confirm(`Arquivar o PMOC "${plan.name}"? As OS vinculadas que ainda nao foram finalizadas serao canceladas.`)) return
    const now = nowIso()
    const relatedScheduleOrderIds = new Set((state.pmocSchedules || []).filter((item) => item.planId === planId && item.serviceOrderId).map((item) => item.serviceOrderId))
    if (!await commitConfirmed((current) => ({
      ...current,
      pmocPlans: (current.pmocPlans || []).map((item) => item.id === planId ? { ...item, status: "Arquivado", notes: `${cleanPmocMeta(item.notes)}\nArquivado em ${dateTime(now)}. OS pendentes canceladas automaticamente.`.trim(), updatedAt: now } as any : item),
      pmocSchedules: (current.pmocSchedules || []).map((item) => item.planId === planId && item.status !== "Concluído" ? { ...item, status: "Arquivado" as any, updatedAt: now } : item),
      serviceOrders: current.serviceOrders.map((order) => relatedScheduleOrderIds.has(order.id) && !["Finalizada", "Cancelada"].includes(order.status)
        ? { ...order, status: "Cancelada", cancellationReason: `PMOC arquivado: ${plan.name}`, cancelledAt: now, updatedAt: now }
        : order),
      auditLogs: appendAudit(current, "pmoc_plan", planId, "Arquivado", `Plano ${plan.name} arquivado e OS pendentes canceladas`),
    }))) return
    if (selectedPlanId === planId) setSelectedPlanId("")
    toast({ title: "PMOC arquivado", description: "O plano foi inativado e as OS pendentes vinculadas foram canceladas." })
  }

  async function generateOrders() {
    if (!selectedPlan) return
    if (!await commitConfirmed((current) => {
      let working = current
      const plan = working.pmocPlans.find((item) => item.id === selectedPlan.id)
      if (!plan) return current
      const ensured = ensurePmocWork(working, plan)
      working = ensured.state
      const pending = (working.pmocSchedules || []).filter((item) => item.planId === plan.id && !item.serviceOrderId && item.status === "Planejado")
      if (!pending.length) return working
      const selectedChecklistIds = pmocChecklistIdsFromNotes(plan.notes)
      const newOrders: ServiceOrder[] = []
      const newChecklist: ChecklistItem[] = []
      const newMaterials: ServiceOrderMaterial[] = []
      const now = nowIso()
      const schedules = (working.pmocSchedules || []).map((schedule) => {
        if (!pending.some((item) => item.id === schedule.id)) return schedule
        const equipment = working.pmocEquipment.find((item) => item.id === schedule.equipmentId)
        const sector = working.pmocSectors.find((item) => item.id === equipment?.sectorId)
        const serviceName = labels.serviceType(schedule.serviceTypeId)
        const orderId = makeId("order")
        const order: ServiceOrder = {
          id: orderId,
          orderNumber: nextOrderNumber({ ...working, serviceOrders: [...newOrders, ...working.serviceOrders] }),
          orderType: "pmoc",
          serviceCategory: "",
          clientId: plan.clientId,
          workId: ensured.workId,
          clientEnvironmentId: equipment?.clientEnvironmentId || "",
          clientEquipmentId: equipment?.clientEquipmentId || "",
          workStructureId: "",
          floorId: "",
          environmentId: "",
          pointId: "",
          simpleService: true,
          serviceTypeId: schedule.serviceTypeId,
          priority: "Media" as any,
          description: `PMOC - ${equipment?.name || "Equipamento"} - ${serviceName}`,
          scheduledDate: schedule.scheduledDate,
          scheduledStartTime: "08:00",
          scheduledEndTime: "10:00",
          estimatedDuration: "2h",
          allowReschedule: true,
          scheduleNotes: `Setor: ${sector?.name || "-"} | Equipamento: ${equipment?.name || "-"}`,
          mainProviderId: (plan as any).mainProviderId || "",
          helperProviderId: "",
          supervisorId: "",
          vehicleId: "",
          initialKm: 0,
          finalKm: 0,
          totalAmount: 0,
          paymentMethod: (plan as any).paymentMethod || "",
          paymentType: (plan as any).paymentType || "",
          paymentTerm: (plan as any).paymentTerm || "",
          paymentDueDate: (plan as any).paymentDueDate || "",
          financialNotes: (plan as any).financialNotes || "",
          status: "Agendada",
          customerResponsibleName: "",
          customerResponsiblePhone: "",
          teamNotes: "",
          notes: [
            `Gerada automaticamente pelo PMOC ${plan.name}.`,
            `Selecoes OS JSON: ${JSON.stringify({ clientEnvironmentIds: [equipment?.clientEnvironmentId || ""].filter(Boolean), clientEquipmentIds: [equipment?.clientEquipmentId || ""].filter(Boolean), serviceTypeIds: [schedule.serviceTypeId].filter(Boolean) })}`,
          ].join("\n"),
          pauseReason: "",
          cancellationReason: "",
          partialReason: "",
          createdAt: now,
          updatedAt: now,
          finishedAt: "",
          cancelledAt: "",
        }
        const defaults = hydratePmocOrderFromType(working, orderId, schedule.serviceTypeId, selectedChecklistIds)
        newOrders.push(order)
        newChecklist.push(...defaults.checklist)
        newMaterials.push(...defaults.materials)
        return { ...schedule, serviceOrderId: orderId, status: "OS aberta" as const, updatedAt: now }
      })
      return {
        ...working,
        pmocSchedules: schedules,
        serviceOrders: [...newOrders, ...working.serviceOrders],
        checklistItems: [...newChecklist, ...working.checklistItems],
        serviceOrderMaterials: [...newMaterials, ...working.serviceOrderMaterials],
        auditLogs: appendAudit(working, "pmoc_plan", plan.id, "OS geradas", `${newOrders.length} OS geradas pelo cronograma PMOC`),
      }
    })) return
    toast({ title: "OS do PMOC geradas", description: "As ordens planejadas foram abertas como Agendadas." })
  }

  async function generateCompetencyOrder() {
    if (!selectedPlan) return
    const validation = pmocCompetencyValidation(selectedPlan, generationCompetency)
    const scheduledDate = validation.scheduledDate
    if (!validation.valid) {
      toast({ title: "Competencia invalida", description: validation.reason, variant: "destructive" })
      return
    }
    const date = parseLocalDate(scheduledDate)
    const alreadyGenerated = selectedPlanSchedules.some((item) => item.year === date.getFullYear() && item.month === date.getMonth() + 1 && item.serviceOrderId)
    if (alreadyGenerated) {
      toast({ title: "Competencia ja gerada", description: `Ja existe uma OS para ${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}.`, variant: "destructive" })
      return
    }
    const planEquipment = (state.pmocEquipment || []).filter((item) => item.planId === selectedPlan.id && item.status === "Ativo")
    const planLinks = (state.pmocEquipmentServices || []).filter((item) => item.planId === selectedPlan.id && planEquipment.some((equipment) => equipment.id === item.equipmentId))
    if (!planLinks.length) {
      toast({ title: "Plano sem servicos", description: "Vincule equipamentos e servicos PMOC antes de gerar a OS.", variant: "destructive" })
      return
    }
    if (!await commitConfirmed((current) => {
      const plan = current.pmocPlans.find((item) => item.id === selectedPlan.id)
      if (!plan) return current
      const now = nowIso()
      const existing = (current.pmocSchedules || []).filter((item) => item.planId === plan.id && item.year === date.getFullYear() && item.month === date.getMonth() + 1)
      const existingKeys = new Set(existing.map((item) => `${item.equipmentId}:${item.serviceTypeId}`))
      const added = planLinks.filter((link) => !existingKeys.has(`${link.equipmentId}:${link.serviceTypeId}`)).map((link) => ({
        id: makeId("pmoc-schedule"),
        planId: plan.id,
        equipmentId: link.equipmentId,
        serviceTypeId: link.serviceTypeId,
        month: date.getMonth() + 1,
        year: date.getFullYear(),
        scheduledDate,
        serviceOrderId: "",
        status: "Planejado" as const,
        createdAt: now,
        updatedAt: now,
      }))
      const working = { ...current, pmocSchedules: [...added, ...(current.pmocSchedules || [])] }
      const scheduleIds = new Set([...existing, ...added].filter((item) => !item.serviceOrderId).map((item) => item.id))
      return openPmocOrdersForSchedules(working, plan.id, scheduleIds).state
    })) return
    toast({ title: "OS do PMOC gerada", description: `Foi aberta somente a OS da competencia ${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}.` })
  }

  function generateAnnualReport() {
    const [year, month] = reportReferenceMonth.split("-").map(Number)
    if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
      toast({ title: "Competência inválida", description: "Informe o mês e o ano de referência do relatório.", variant: "destructive" })
      return
    }
    const monthsBack = Number(reportMonthsBack)
    if (!Number.isInteger(monthsBack) || monthsBack < 0 || monthsBack > 48) {
      toast({ title: "Período inválido", description: "Selecione somente a competência ou até 48 meses retroativos.", variant: "destructive" })
      return
    }
    if (!reportScopeClientId || reportScopeClientId === "__sem_cliente__") {
      toast({ title: "Cliente obrigatório", description: "Selecione o cliente do relatório anual.", variant: "destructive" })
      return
    }
    if (!reportEquipmentCount) {
      toast({ title: "Sem dados para o relatório", description: "Não há planos e equipamentos PMOC para os filtros selecionados.", variant: "destructive" })
      return
    }
    const reportWindow = window.open("", "_blank")
    if (!reportWindow) {
      toast({ title: "Pop-up bloqueado", description: "Permita pop-ups para gerar e salvar o relatório em PDF.", variant: "destructive" })
      return
    }
    reportWindow.opener = null
    reportWindow.document.open()
    reportWindow.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Preparando relatório PMOC</title><style>body{font-family:Arial,sans-serif;display:grid;min-height:100vh;margin:0;place-items:center;background:#f8fafc;color:#1f2937}.box{text-align:center;padding:32px}.spinner{width:42px;height:42px;margin:0 auto 18px;border:4px solid #dbeafe;border-top-color:#2563eb;border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}</style></head><body><div class="box"><div class="spinner"></div><h2>Preparando relatório PMOC</h2><p>Processando equipamentos e serviços. Esta janela será atualizada automaticamente.</p></div></body></html>`)
    reportWindow.document.close()
    setIsGeneratingAnnualReport(true)

    window.setTimeout(() => {
      try {
        const annualReport = buildPmocAnnualReport(state, {
          clientId: reportScopeClientId,
          year,
          referenceMonth: reportReferenceMonth,
          monthsBack,
        })
        const equipmentCount = annualReport.clients.reduce((total, client) => total + client.plans.reduce((planTotal, plan) => planTotal + plan.equipment.length, 0), 0)
        if (!annualReport.clients.length || !equipmentCount) {
          reportWindow.document.open()
          reportWindow.document.write("<!doctype html><html lang=\"pt-BR\"><body style=\"font-family:Arial,sans-serif;padding:32px\"><h2>Sem dados para o relatório</h2><p>Não há equipamentos e serviços PMOC para os filtros selecionados.</p></body></html>")
          reportWindow.document.close()
          toast({ title: "Sem dados para o relatório", description: "Não há equipamentos e serviços PMOC para os filtros selecionados.", variant: "destructive" })
          return
        }
        const html = renderPmocAnnualReportHtml(annualReport)
        reportWindow.document.open()
        reportWindow.document.write(html)
        reportWindow.document.close()
      } catch (error) {
        reportWindow.document.open()
        reportWindow.document.write("<!doctype html><html lang=\"pt-BR\"><body style=\"font-family:Arial,sans-serif;padding:32px\"><h2>Não foi possível gerar o relatório</h2><p>Feche esta janela e tente novamente.</p></body></html>")
        reportWindow.document.close()
        toast({ title: "Erro ao gerar relatório", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" })
      } finally {
        setIsGeneratingAnnualReport(false)
      }
    }, 50)
  }

  return (
    <PageShell title="PMOC" description={readOnly ? "Consulte os planos, equipamentos, serviços e cronogramas vinculados ao seu cliente." : "Monte planos preventivos por periodicidade e gere somente a OS da competência escolhida."} actions={readOnly ? undefined : <><Button onClick={openPlanSheet}><Plus className="h-4 w-4" />Novo plano PMOC</Button><Button variant="outline" onClick={openSectorSheet} disabled={!selectedPlan}>Novo setor</Button><Button variant="outline" onClick={openEquipmentSheet} disabled={!selectedPlan}>Novo equipamento</Button></>}>
      {readOnly ? <AlertRow>Visualização exclusiva do cliente. Alterações cadastrais são feitas pela equipe M&amp;C.</AlertRow> : null}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList><TabsTrigger value="planos">Planos</TabsTrigger><TabsTrigger value="setores">Setores</TabsTrigger><TabsTrigger value="equipamentos">Equipamentos</TabsTrigger><TabsTrigger value="cronograma">Cronograma</TabsTrigger><TabsTrigger value="relatorio-anual">Relatório anual</TabsTrigger></TabsList>
        <TabsContent value="planos">
          <SectionCard title="Planos PMOC" description="Cada plano pertence a um cliente e define a frequência preventiva.">
            {!readOnly ? <div className="mb-4"><Button type="button" onClick={openPlanSheet}><Plus className="h-4 w-4" />Novo plano PMOC</Button></div> : null}
            <DataTable headers={["Plano", "Cliente", "Obra/Local", "Frequencia", "Dia fixo", "Equipe", "Data inicial", "Data final", "Setores", "Equipamentos", "OS abertas", "Status", "Acoes"]} empty={!plans.length}>
              {plans.map((item) => <TableRow key={item.id} className="cursor-pointer" onClick={() => setSelectedPlanId(item.id)}><TableCell className="font-medium">{item.name}</TableCell><TableCell>{labels.client(item.clientId)}</TableCell><TableCell>{item.workId ? labels.work(item.workId) : "Automático"}</TableCell><TableCell>{item.frequency}</TableCell><TableCell>Dia {(item as any).scheduleDay || parseLocalDate(pmocPlanStartDate(item)).getDate()}</TableCell><TableCell>{(item as any).mainProviderId ? labels.provider((item as any).mainProviderId) : "-"}</TableCell><TableCell>{formatDate(pmocPlanStartDate(item))}</TableCell><TableCell>{formatDate(pmocPlanEndDate(item))}</TableCell><TableCell>{(state.pmocSectors || []).filter((sector) => sector.planId === item.id).length}</TableCell><TableCell>{(state.pmocEquipment || []).filter((equipment) => equipment.planId === item.id).length}</TableCell><TableCell>{new Set((state.pmocSchedules || []).filter((schedule) => schedule.planId === item.id && schedule.serviceOrderId).map((schedule) => schedule.serviceOrderId)).size}</TableCell><TableCell><StatusBadge status={item.status} /></TableCell><TableCell>{readOnly ? <span className="text-sm text-muted-foreground">Somente leitura</span> : <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); openEditPlanSheet(item.id) }}>Editar</Button><Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); archivePlan(item.id) }}>Arquivar</Button></div>}</TableCell></TableRow>)}
            </DataTable>
          </SectionCard>
        </TabsContent>
        <TabsContent value="setores">
          <SectionCard title={`Setores${selectedPlan ? ` - ${selectedPlan.name}` : ""}`}>
            {!readOnly ? <div className="mb-4 space-y-2"><Button type="button" variant="outline" onClick={openSectorSheet} disabled={!selectedPlan}><Plus className="h-4 w-4" />Novo setor</Button>{!selectedPlan ? <p className="text-sm text-muted-foreground">Cadastre um plano PMOC antes de adicionar setores.</p> : null}</div> : null}
            <DataTable headers={["Setor", "Pavimento/Local", "Equipamentos", "Status", "Observações"]} empty={!selectedPlanSectors.length}>
              {selectedPlanSectors.map((sector) => <TableRow key={sector.id}><TableCell>{sector.name}</TableCell><TableCell>{sector.floor || "-"}</TableCell><TableCell>{selectedPlanEquipment.filter((equipment) => equipment.sectorId === sector.id).length}</TableCell><TableCell><StatusBadge status={sector.status} /></TableCell><TableCell>{sector.notes || "-"}</TableCell></TableRow>)}
            </DataTable>
          </SectionCard>
        </TabsContent>
        <TabsContent value="equipamentos">
          <SectionCard title={`Equipamentos${selectedPlan ? ` - ${selectedPlan.name}` : ""}`}>
            {!readOnly ? <div className="mb-4 space-y-2"><Button type="button" variant="outline" onClick={openEquipmentSheet} disabled={!selectedPlan}><Plus className="h-4 w-4" />Novo equipamento</Button>{!selectedPlan ? <p className="text-sm text-muted-foreground">Cadastre um plano PMOC antes de adicionar equipamentos.</p> : null}</div> : null}
            <DataTable headers={["Setor", "Tag", "Equipamento", "Marca/Modelo", "Capacidade", "Serviços vinculados", "Status", "QR"]} empty={!selectedPlanEquipment.length}>
              {selectedPlanEquipment.map((equipment) => {
                const linked = (state.pmocEquipmentServices || []).filter((item) => item.equipmentId === equipment.id).map((item) => labels.serviceType(item.serviceTypeId)).join(", ")
                const registeredEquipment = (state.clientEquipment || []).find((item) => item.id === equipment.clientEquipmentId)
                return <TableRow key={equipment.id}><TableCell>{selectedPlanSectors.find((sector) => sector.id === equipment.sectorId)?.name || "-"}</TableCell><TableCell>{equipment.tag || "-"}</TableCell><TableCell>{equipment.name}</TableCell><TableCell>{[equipment.brand, equipment.model].filter(Boolean).join(" / ") || "-"}</TableCell><TableCell>{equipment.capacity || "-"}</TableCell><TableCell>{linked || "-"}</TableCell><TableCell><StatusBadge status={equipment.status} /></TableCell><TableCell>{registeredEquipment ? <EquipmentQrDialog equipment={registeredEquipment} /> : "-"}</TableCell></TableRow>
              })}
            </DataTable>
          </SectionCard>
        </TabsContent>
        <TabsContent value="cronograma">
          {!readOnly ? <SectionCard title="Gerar OS por competência" description="Escolha um mês. O sistema abre uma única OS com todos os equipamentos e serviços do plano e impede duplicidade.">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-56"><TextField label="Competência" type="month" value={generationCompetency} onChange={setGenerationCompetency} /></div>
              <Button type="button" onClick={generateCompetencyOrder} disabled={!selectedPlan}>Gerar OS desta competência</Button>
            </div>
          </SectionCard> : null}
          <SectionCard title={`Cronograma preventivo${selectedPlan ? ` - ${selectedPlan.name}` : ""}`} description="Somente as competências geradas aparecem abaixo.">
            <DataTable headers={["Mês", "Data", "Setor", "Equipamento", "Serviço", "Status", "OS"]} empty={!selectedPlanSchedules.length}>
              {selectedPlanSchedules.sort((a, b) => a.year - b.year || a.month - b.month).map((schedule) => {
                const equipment = selectedPlanEquipment.find((item) => item.id === schedule.equipmentId)
                return <TableRow key={schedule.id}><TableCell>{pmocMonths.find((month) => month.value === schedule.month)?.label}/{schedule.year}</TableCell><TableCell>{formatDate(schedule.scheduledDate)}</TableCell><TableCell>{selectedPlanSectors.find((sector) => sector.id === equipment?.sectorId)?.name || "-"}</TableCell><TableCell>{equipment?.name || "-"}</TableCell><TableCell>{labels.serviceType(schedule.serviceTypeId)}</TableCell><TableCell><StatusBadge status={schedule.status} /></TableCell><TableCell>{schedule.serviceOrderId ? <Link className="text-primary underline" href={`/ordens-servico/${schedule.serviceOrderId}`}>{state.serviceOrders.find((order) => order.id === schedule.serviceOrderId)?.orderNumber || "Ver OS"}</Link> : "-"}</TableCell></TableRow>
              })}
            </DataTable>
          </SectionCard>
        </TabsContent>
        <TabsContent value="relatorio-anual">
          <SectionCard title="Relatório PMOC" description="Gere o documento completo com capa, relação de máquinas e checklists por equipamento. Cada atividade segue sua própria periodicidade.">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {!readOnly ? (
                <SelectField
                  label="Cliente"
                  value={reportClientId}
                  onChange={setReportClientId}
                  options={reportClients.map((client) => ({ value: client.id, label: client.name }))}
                />
              ) : (
                <div className="space-y-2"><Label>Cliente</Label><div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">{labels.client(user?.clientId || "")}</div></div>
              )}
              <TextField label="Competência de referência" type="month" value={reportReferenceMonth} onChange={setReportReferenceMonth} />
              <SelectField
                label="Período do relatório"
                value={reportMonthsBack}
                onChange={setReportMonthsBack}
                options={[
                  { value: "0", label: "Somente a competência atual" },
                  ...Array.from({ length: 48 }, (_, index) => ({ value: String(index + 1), label: `${index + 1} ${index === 0 ? "mês anterior" : "meses anteriores"} + competência` })),
                ]}
              />
            </div>
            <div className="my-4 grid gap-3 sm:grid-cols-3">
              {[
                ["Clientes", reportClientCount],
                ["Planos", reportScopedPlans.length],
                ["Equipamentos", reportEquipmentCount],
              ].map(([label, value]) => <div key={label} className="rounded-lg border bg-muted/20 p-4"><div className="text-sm text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-semibold">{value}</div></div>)}
            </div>
            {!reportEquipmentCount ? <AlertRow>Nenhum plano PMOC com equipamentos corresponde aos filtros selecionados.</AlertRow> : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" onClick={generateAnnualReport} disabled={!reportEquipmentCount || isGeneratingAnnualReport}><FileBarChart className="h-4 w-4" />{isGeneratingAnnualReport ? "Preparando relatório..." : "Gerar relatório anual / PDF"}</Button>
              <p className="text-sm text-muted-foreground">Escolha somente a competência atual ou inclua meses anteriores. Períodos longos são divididos em blocos legíveis no PDF.</p>
            </div>
          </SectionCard>
        </TabsContent>
      </Tabs>

      <FormSheet open={sheet === "plan"} onOpenChange={(open) => { if (!open) { setSheet(""); setEditingPlanId("") } }} title={editingPlanId ? "Editar Plano PMOC" : "Plano PMOC"} description={editingPlanId ? "Edite os dados do plano PMOC. Para encerrar um cadastro equivocado, use Arquivar na lista." : "Selecione o cliente e defina a frequencia para o cronograma preventivo."}>
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField label="Cliente" value={planForm.clientId} onChange={selectPlanClient} options={pmocClients.map((client) => ({ value: client.id, label: client.name }))} />
          <SelectField label="Obra/Local" value={planForm.workId} onChange={(value) => setPlanForm({ ...planForm, workId: value })} options={[{ value: "__auto", label: "Usar local do cliente ou criar PMOC automático" }, ...state.works.filter((work) => !planForm.clientId || work.clientId === planForm.clientId).map((work) => ({ value: work.id, label: work.name }))]} />
          <TextField label="Nome do plano" value={planForm.name} onChange={(value) => setPlanForm({ ...planForm, name: value })} />
          <SelectField label="Periodicidade" value={planForm.frequency} onChange={(value) => setPlanForm({ ...planForm, frequency: value })} options={["Mensal", "Bimestral", "Trimestral", "Anual"].map((value) => ({ value, label: value }))} />
          {!editingPlanId ? <TextField label="Competência da primeira OS" type="month" value={planForm.competency} onChange={(value) => {
            setPlanForm({ ...planForm, competency: value })
          }} /> : null}
          <TextField label="Dia fixo das OS" type="number" value={planForm.scheduleDay} onChange={(value) => setPlanForm({ ...planForm, scheduleDay: value })} placeholder="1 a 31; ajusta para o ultimo dia do mes" />
          <SelectField label="Equipe designada" value={planForm.mainProviderId || "__none"} onChange={(value) => setPlanForm({ ...planForm, mainProviderId: value === "__none" ? "" : value })} options={[{ value: "__none", label: "Sem equipe designada" }, ...pmocProviders.map((provider) => ({ value: provider.id, label: provider.fullName }))]} />
          <TextField label="Data inicial" type="date" value={planForm.startDate} onChange={(value) => setPlanForm({ ...planForm, startDate: value, startMonth: String(parseLocalDate(value).getMonth() + 1), startYear: String(parseLocalDate(value).getFullYear()) })} />
          <TextField label="Data final" type="date" value={planForm.endDate} onChange={(value) => setPlanForm({ ...planForm, endDate: value })} />
          <SelectField label="Status" value={planForm.status} onChange={(value) => setPlanForm({ ...planForm, status: value })} options={["Ativo", "Inativo"].map((value) => ({ value, label: value }))} />
          <TextField label="Equipamento" value={equipmentForm.name} onChange={(value) => setEquipmentForm({ ...equipmentForm, name: value })} placeholder="Ex.: Split 24.000 BTUs" />
          <TextField label="Capacidade" value={equipmentForm.capacity} onChange={(value) => setEquipmentForm({ ...equipmentForm, capacity: value })} placeholder="Ex.: 24.000 BTUs" />
        </div>
        <div className="grid gap-4 rounded-lg border p-3 md:grid-cols-2">
          <SelectField label="Forma de pagamento" value={planForm.paymentMethod || "nao-informado"} onChange={(value) => setPlanForm({ ...planForm, paymentMethod: value === "nao-informado" ? "" : value })} options={["nao-informado", "Pix", "Boleto", "Cartao de credito", "Cartao de debito", "Dinheiro", "Transferencia"].map((value) => ({ value, label: value === "nao-informado" ? "Nao informado" : value }))} />
          <SelectField label="Tipo de pagamento" value={planForm.paymentType || "nao-informado"} onChange={(value) => setPlanForm({ ...planForm, paymentType: value === "nao-informado" ? "" : value })} options={["nao-informado", "A vista", "Parcelado", "Entrada e saldo", "Faturado"].map((value) => ({ value, label: value === "nao-informado" ? "Nao informado" : value }))} />
          <TextField label="Prazo de pagamento" value={planForm.paymentTerm || ""} onChange={(value) => setPlanForm({ ...planForm, paymentTerm: value })} placeholder="Ex.: mensal, 30 dias, faturado" />
          <TextField label="Vencimento previsto" type="date" value={planForm.paymentDueDate || ""} onChange={(value) => setPlanForm({ ...planForm, paymentDueDate: value })} />
          <TextAreaField label="Instrucoes financeiras" value={planForm.financialNotes || ""} onChange={(value) => setPlanForm({ ...planForm, financialNotes: value })} />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2"><Label>Ambientes do cliente</Label><Button type="button" size="sm" variant="outline" disabled={!filteredClientEnvironmentsForPlan.length} onClick={() => toggleAllPlanEnvironments(!allFilteredPlanEnvironmentsSelected)}>{allFilteredPlanEnvironmentsSelected ? "Limpar visiveis" : "Selecionar visiveis"}</Button></div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={planEnvironmentSearch} onChange={(event) => setPlanEnvironmentSearch(event.target.value)} placeholder="Pesquisar ambiente, pavimento ou local" className="pl-9" />
            </div>
            {!clientEnvironmentsForPlan.length ? <p className="text-sm text-muted-foreground">Nenhum ambiente cadastrado para este cliente.</p> : null}
            {clientEnvironmentsForPlan.length && !filteredClientEnvironmentsForPlan.length ? <p className="text-sm text-muted-foreground">Nenhum ambiente encontrado para esta pesquisa.</p> : null}
            <div className="max-h-56 space-y-2 overflow-auto pr-1">
              {filteredClientEnvironmentsForPlan.map((environment) => {
                const checked = selectedPlanEnvironmentIds.includes(environment.id)
                return (
                  <label key={environment.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) => {
                        const next = value ? [...selectedPlanEnvironmentIds, environment.id] : selectedPlanEnvironmentIds.filter((id) => id !== environment.id)
                        setSelectedPlanEnvironmentIds(next)
                        setSelectedPlanEquipmentIds(selectedPlanEquipmentIds.filter((equipmentId) => {
                          const equipment = state.clientEquipment.find((item) => item.id === equipmentId)
                          return equipment && next.includes(equipment.clientEnvironmentId)
                        }))
                      }}
                    />
                    <span>{[environment.name, environment.floor, environment.location].filter(Boolean).join(" - ")}</span>
                  </label>
                )
              })}
            </div>
          </div>
          <div className="space-y-2 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2"><Label>Equipamentos/Maquinas</Label><Button type="button" size="sm" variant="outline" disabled={!filteredClientEquipmentForPlan.length} onClick={() => toggleAllPlanEquipment(!allFilteredPlanEquipmentSelected)}>{allFilteredPlanEquipmentSelected ? "Limpar visiveis" : "Selecionar visiveis"}</Button></div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={planEquipmentSearch} onChange={(event) => setPlanEquipmentSearch(event.target.value)} placeholder="Pesquisar TAG, equipamento ou capacidade" className="pl-9" />
            </div>
            {!clientEquipmentForPlan.length ? <p className="text-sm text-muted-foreground">Selecione ambientes para listar os equipamentos.</p> : null}
            {clientEquipmentForPlan.length && !filteredClientEquipmentForPlan.length ? <p className="text-sm text-muted-foreground">Nenhum equipamento encontrado para esta pesquisa.</p> : null}
            <div className="max-h-56 space-y-2 overflow-auto pr-1">
              {filteredClientEquipmentForPlan.map((equipment) => {
                const checked = selectedPlanEquipmentIds.includes(equipment.id)
                return (
                  <label key={equipment.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) => {
                        const next = value ? [...selectedPlanEquipmentIds, equipment.id] : selectedPlanEquipmentIds.filter((id) => id !== equipment.id)
                        setSelectedPlanEquipmentIds(next)
                        if (value && !selectedPlanEnvironmentIds.includes(equipment.clientEnvironmentId)) setSelectedPlanEnvironmentIds([...selectedPlanEnvironmentIds, equipment.clientEnvironmentId])
                        if (value && !equipmentForm.name) selectPlanEquipment(equipment.id)
                      }}
                    />
                    <span>{[equipment.tag, equipment.name, equipment.capacity].filter(Boolean).join(" - ")}</span>
                  </label>
                )
              })}
            </div>
          </div>
        </div>
        <div className="space-y-3 rounded-lg border p-3">
          <Label>Serviços vinculados</Label>
          {!activeServices.length ? <p className="text-sm text-muted-foreground">Nenhum serviço habilitado para PMOC na página Serviços.</p> : null}
          <div className="flex gap-2">
            <div className="flex-1">
              <SelectField label="Serviço" value={serviceToAdd} onChange={setServiceToAdd} options={activeServices.map((service) => ({ value: service.id, label: service.name }))} />
            </div>
            <Button className="mt-8" type="button" onClick={addSelectedService}>Adicionar</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {selectedServices.map((serviceId) => <Button key={serviceId} type="button" variant="outline" size="sm" onClick={() => removeSelectedService(serviceId)}>{labels.serviceType(serviceId)} x</Button>)}
          </div>
        </div>
        <TextAreaField label="Observações" value={planForm.notes} onChange={(value) => setPlanForm({ ...planForm, notes: value })} />
        <div className="space-y-3 rounded-lg border p-3">
          <div className="flex items-center justify-between gap-2">
            <Label>Itens de checklist que serao executados</Label>
            <Button type="button" size="sm" variant="outline" disabled={!checklistTasksForSelectedServices.length} onClick={() => {
              const ids = checklistTasksForSelectedServices.map((item) => item.id)
              const allSelected = ids.every((taskId) => selectedChecklistTaskIds.includes(taskId))
              setSelectedChecklistTaskIds(allSelected ? selectedChecklistTaskIds.filter((taskId) => !ids.includes(taskId)) : Array.from(new Set([...selectedChecklistTaskIds, ...ids])))
            }}>{checklistTasksForSelectedServices.length && checklistTasksForSelectedServices.every((item) => selectedChecklistTaskIds.includes(item.id)) ? "Limpar checklist" : "Selecionar checklist"}</Button>
          </div>
          {!selectedServices.length ? <p className="text-sm text-muted-foreground">Vincule um servico PMOC para listar o checklist padrao.</p> : null}
          {selectedServices.length && !checklistTasksForSelectedServices.length ? <p className="text-sm text-muted-foreground">Os servicos selecionados nao possuem checklist padrao cadastrado.</p> : null}
          <div className="grid gap-2 md:grid-cols-2">
            {checklistTasksForSelectedServices.map((task) => (
              <label key={task.id} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                <Checkbox checked={selectedChecklistTaskIds.includes(task.id)} onCheckedChange={(checked) => setSelectedChecklistTaskIds(checked ? Array.from(new Set([...selectedChecklistTaskIds, task.id])) : selectedChecklistTaskIds.filter((taskId) => taskId !== task.id))} />
                <span><strong>{labels.serviceType(task.serviceTypeId)}</strong><br />{task.taskName}</span>
              </label>
            ))}
          </div>
        </div>
        <SaveButton onClick={savePlan} disabled={saving || loading}>{saving ? "Salvando..." : editingPlanId ? "Salvar alteracoes" : "Salvar plano PMOC"}</SaveButton>
      </FormSheet>

      <FormSheet open={sheet === "sector"} onOpenChange={(open) => !open && setSheet("")} title="Setor do PMOC" description="Cadastre setores do cliente para organizar os equipamentos.">
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField label="Plano PMOC" value={sectorForm.planId} onChange={(value) => setSectorForm({ ...sectorForm, planId: value })} options={plans.map((item) => ({ value: item.id, label: `${item.name} - ${labels.client(item.clientId)}` }))} />
          <TextField label="Setor" value={sectorForm.name} onChange={(value) => setSectorForm({ ...sectorForm, name: value })} placeholder="Ex.: Recepção, Sala técnica, Escritório" />
          <TextField label="Pavimento/Local" value={sectorForm.floor} onChange={(value) => setSectorForm({ ...sectorForm, floor: value })} />
          <SelectField label="Status" value={sectorForm.status} onChange={(value) => setSectorForm({ ...sectorForm, status: value })} options={["Ativo", "Inativo"].map((value) => ({ value, label: value }))} />
        </div>
        <TextAreaField label="Observações" value={sectorForm.notes} onChange={(value) => setSectorForm({ ...sectorForm, notes: value })} />
        <SaveButton onClick={saveSector} disabled={saving || loading}>Salvar setor</SaveButton>
      </FormSheet>

      <FormSheet open={sheet === "equipment"} onOpenChange={(open) => !open && setSheet("")} title="Equipamento do PMOC" description="Cadastre o equipamento e vincule quantos serviços preventivos forem necessários.">
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField label="Plano PMOC" value={equipmentForm.planId} onChange={selectEquipmentPlan} options={plans.map((item) => ({ value: item.id, label: `${item.name} - ${labels.client(item.clientId)}` }))} />
          <SelectField label="Ambiente do cliente" value={equipmentForm.clientEnvironmentId} onChange={selectClientEnvironment} options={clientEnvironmentsForEquipment.map((environment) => ({ value: environment.id, label: [environment.name, environment.floor, environment.location].filter(Boolean).join(" - ") }))} />
          <SelectField label="Equipamento/Máquina" value={equipmentForm.clientEquipmentId} onChange={selectClientEquipment} options={clientEquipmentForEquipment.map((equipment) => ({ value: equipment.id, label: [equipment.tag, equipment.name, equipment.capacity].filter(Boolean).join(" - ") }))} />
          <SelectField label="Setor" value={equipmentForm.sectorId} onChange={(value) => setEquipmentForm({ ...equipmentForm, sectorId: value })} options={(state.pmocSectors || []).filter((sector) => sector.planId === equipmentForm.planId).map((sector) => ({ value: sector.id, label: sector.name }))} />
          <TextField label="Tag/Código" value={equipmentForm.tag} onChange={(value) => setEquipmentForm({ ...equipmentForm, tag: value })} />
          <TextField label="Equipamento" value={equipmentForm.name} onChange={(value) => setEquipmentForm({ ...equipmentForm, name: value })} placeholder="Ex.: Split 24.000 BTUs" />
          <TextField label="Marca" value={equipmentForm.brand} onChange={(value) => setEquipmentForm({ ...equipmentForm, brand: value })} />
          <TextField label="Modelo" value={equipmentForm.model} onChange={(value) => setEquipmentForm({ ...equipmentForm, model: value })} />
          <TextField label="Número de série" value={equipmentForm.serialNumber} onChange={(value) => setEquipmentForm({ ...equipmentForm, serialNumber: value })} />
          <TextField label="Capacidade" value={equipmentForm.capacity} onChange={(value) => setEquipmentForm({ ...equipmentForm, capacity: value })} placeholder="Ex.: 24.000 BTUs" />
          <TextField label="Localização" value={equipmentForm.location} onChange={(value) => setEquipmentForm({ ...equipmentForm, location: value })} />
          <SelectField label="Status" value={equipmentForm.status} onChange={(value) => setEquipmentForm({ ...equipmentForm, status: value })} options={["Ativo", "Inativo"].map((value) => ({ value, label: value }))} />
        </div>
        <div className="space-y-3 rounded-lg border p-3">
          <Label>Serviços vinculados</Label>
          {!activeServices.length ? <p className="text-sm text-muted-foreground">Nenhum serviço habilitado para PMOC na página Serviços.</p> : null}
          <div className="flex gap-2">
            <div className="flex-1">
              <SelectField label="Serviço" value={serviceToAdd} onChange={setServiceToAdd} options={activeServices.map((service) => ({ value: service.id, label: service.name }))} />
            </div>
            <Button className="mt-8" type="button" onClick={addSelectedService}>Adicionar</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {selectedServices.map((serviceId) => <Button key={serviceId} type="button" variant="outline" size="sm" onClick={() => setSelectedServices(selectedServices.filter((item) => item !== serviceId))}>{labels.serviceType(serviceId)} x</Button>)}
          </div>
        </div>
        <TextAreaField label="Observações" value={equipmentForm.notes} onChange={(value) => setEquipmentForm({ ...equipmentForm, notes: value })} />
        <SaveButton onClick={saveEquipment} disabled={saving || loading}>Salvar equipamento e cronograma</SaveButton>
      </FormSheet>
    </PageShell>
  )
}

type StockProductionStatus = "Aberto" | "Produção" | "Pronta para uso" | "Usada"

type StockProductionOrder = {
  id: string
  budgetWorkId: string
  budgetPointId: string
  kitId: string
  linkedServiceOrderId: string
  status: StockProductionStatus
  workName: string
  towerName: string
  floorName: string
  finalName: string
  environmentName: string
  pointName: string
  kitName: string
  infrastructureMeasure: string
  hasWelding: boolean | null
  guidePassage: boolean | null
  createdAt: string
}

const stockProductionStatuses: StockProductionStatus[] = ["Aberto", "Produção", "Pronta para uso", "Usada"]
const stockOrderBatchSize = 10
const stockRegistryBatchSize = 40

function emptyStockOrderCounts() {
  return Object.fromEntries(stockProductionStatuses.map((status) => [status, 0])) as Record<StockProductionStatus, number>
}

function stockProductionOrder(row: any): StockProductionOrder {
  return {
    id: row.id,
    budgetWorkId: row.budget_work_id,
    budgetPointId: row.budget_point_id,
    kitId: row.kit_id || "",
    linkedServiceOrderId: row.linked_service_order_id || "",
    status: row.status || "Aberto",
    workName: row.work_name || "",
    towerName: row.tower_name || "",
    floorName: row.floor_name || "",
    finalName: row.final_name || "",
    environmentName: row.environment_name || "",
    pointName: row.point_name || "",
    kitName: row.kit_name || "",
    infrastructureMeasure: row.infrastructure_measure || "",
    hasWelding: typeof row.has_welding === "boolean" ? row.has_welding : null,
    guidePassage: typeof row.guide_passage === "boolean" ? row.guide_passage : null,
    createdAt: row.created_at || "",
  }
}

export function StockPage() {
  const { state, commit } = useOperationalStore(undefined, { skipInitialLoad: true })
  const { requireFields, toast } = useCrudFeedback()
  const [supplierOptions, setSupplierOptions] = useState<Supplier[]>([])

  useEffect(() => {
    let active = true
    fetch("/api/suppliers", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : { suppliers: [] })
      .then((payload) => { if (active) setSupplierOptions(payload.suppliers || []) })
      .catch(() => undefined)
    return () => { active = false }
  }, [])
  const [tab, setTab] = useState("materiais")
  const [loadedStockTabs, setLoadedStockTabs] = useState<Record<string, boolean>>({})
  const [loadingStockTabs, setLoadingStockTabs] = useState<Record<string, boolean>>({})
  const [sheet, setSheet] = useState<"material" | "kit" | "">("")
  const [editingMaterialId, setEditingMaterialId] = useState("")
  const [editingKitId, setEditingKitId] = useState("")
  const [material, setMaterial] = useState<Record<string, any>>(emptyMaterialForm)
  const [kit, setKit] = useState<Record<string, any>>({ name: "", sizeMeters: "", description: "", unitValue: "0", quantityInStock: "0", status: "Ativo", notes: "" })
  const [kitItem, setKitItem] = useState({ materialId: "", quantity: "1" })
  const [kitItems, setKitItems] = useState<Array<{ materialId: string; quantity: number }>>([])
  const [materialRows, setMaterialRows] = useState<Material[]>([])
  const [materialCount, setMaterialCount] = useState(0)
  const [kitCount, setKitCount] = useState(0)
  const [loadingMoreRegistries, setLoadingMoreRegistries] = useState<"materiais" | "kits" | "">("")
  const [stockOrders, setStockOrders] = useState<StockProductionOrder[]>([])
  const [stockOrdersLoading, setStockOrdersLoading] = useState(false)
  const [stockOrdersSetupRequired, setStockOrdersSetupRequired] = useState(false)
  const [stockOrderSearch, setStockOrderSearch] = useState("")
  const [debouncedStockOrderSearch, setDebouncedStockOrderSearch] = useState("")
  const [stockOrderCounts, setStockOrderCounts] = useState<Record<StockProductionStatus, number>>(emptyStockOrderCounts)
  const [loadingMoreStockOrders, setLoadingMoreStockOrders] = useState<Partial<Record<StockProductionStatus, boolean>>>({})
  const [selectedStockOrderIds, setSelectedStockOrderIds] = useState<string[]>([])
  const kitMaterialOptions = state.materials.filter((item) => item.status === "Ativo" && item.composesKit)
  const { warehouses, error: warehousesError, reload: reloadWarehouses } = useWarehouses()
  const [allMaterials, setAllMaterials] = useState<Material[]>([])
  const [stockRefreshKey, setStockRefreshKey] = useState(0)
  const [movementSheet, setMovementSheet] = useState<{ open: boolean; preset?: Record<string, string> }>({ open: false })
  const [materialQuery, setMaterialQuery] = useState("")
  const warehouseName = (id?: string) => warehouses.find((item) => item.id === id)?.name || warehouses.find((item) => item.isDefault)?.name || "-"

  // Lista completa de itens (alertas, inventário, sugestão de compra) e saldos atualizados após movimentações.
  async function refreshStockData() {
    try {
      const response = await fetch("/api/estoque/materials", { cache: "no-store" })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
      const rows = (payload?.materials || []) as Material[]
      const byId = new Map(rows.map((row) => [row.id, row]))
      setAllMaterials(rows)
      setMaterialRows((current) => current.map((item) => byId.get(item.id) || item))
      commit((current) => ({ ...current, materials: current.materials.map((item) => byId.get(item.id) || item) }), { persist: false })
    } catch (error) {
      toast({ title: "Erro ao atualizar saldos", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" })
    }
  }

  useEffect(() => { void refreshStockData() }, [])

  function stockChanged() {
    setStockRefreshKey((current) => current + 1)
    void refreshStockData()
  }

  useEffect(() => {
    if (tab !== "materiais" && tab !== "kits") return
    if (loadedStockTabs[tab] || loadingStockTabs[tab]) return
    let active = true
    const load = async () => {
      setLoadingStockTabs((current) => ({ ...current, [tab]: true }))
      try {
        const endpoints = tab === "kits"
          ? ["/api/estoque/materials?kitOptions=1", `/api/estoque/kits?limit=${stockRegistryBatchSize}`]
          : [`/api/estoque/materials?limit=${stockRegistryBatchSize}`]
        const payloads = await Promise.all(endpoints.map(async (endpoint) => {
          const response = await fetch(endpoint, { cache: "no-store" })
          const payload = await response.json().catch(() => null)
          if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
          return payload
        }))
        if (!active) return
        const materialsPayload = payloads.find((payload) => Array.isArray(payload?.materials))
        const kitsPayload = payloads.find((payload) => Array.isArray(payload?.kits))
        if (tab === "materiais") {
          const rows = materialsPayload?.materials || []
          setMaterialRows(rows)
          setMaterialCount(Number(materialsPayload?.count || rows.length))
        } else {
          setKitCount(Number(kitsPayload?.count || kitsPayload?.kits?.length || 0))
        }
        commit((current) => {
          const incomingMaterials = materialsPayload?.materials || []
          const keepExistingMaterials = (tab === "kits" && loadedStockTabs.materiais) || (tab === "materiais" && loadedStockTabs.kits)
          const materials = keepExistingMaterials
            ? [...incomingMaterials, ...current.materials.filter((item) => !incomingMaterials.some((row: Material) => row.id === item.id))]
            : incomingMaterials
          return {
            ...current,
            materials,
            stockKits: kitsPayload?.kits || current.stockKits,
            stockKitItems: kitsPayload?.items || current.stockKitItems,
          }
        }, { persist: false })
        setLoadedStockTabs((current) => ({ ...current, [tab]: true }))
      } catch (error) {
        if (active) toast({ title: `Erro ao carregar ${tab === "kits" ? "kits" : "materiais"}`, description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" })
      } finally {
        if (active) setLoadingStockTabs((current) => ({ ...current, [tab]: false }))
      }
    }
    void load()
    return () => { active = false }
  }, [tab])

  async function loadMoreStockRegistries(kind: "materiais" | "kits") {
    if (loadingMoreRegistries) return
    setLoadingMoreRegistries(kind)
    try {
      const offset = kind === "materiais" ? materialRows.length : state.stockKits.length
      const endpoint = kind === "materiais"
        ? `/api/estoque/materials?offset=${offset}&limit=${stockRegistryBatchSize}`
        : `/api/estoque/kits?offset=${offset}&limit=${stockRegistryBatchSize}`
      const response = await fetch(endpoint, { cache: "no-store" })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
      if (kind === "materiais") {
        const rows = (payload?.materials || []) as Material[]
        setMaterialRows((current) => [...current, ...rows.filter((row) => !current.some((item) => item.id === row.id))])
        setMaterialCount(Number(payload?.count || 0))
        commit((current) => ({ ...current, materials: [...current.materials, ...rows.filter((row) => !current.materials.some((item) => item.id === row.id))] }), { persist: false })
      } else {
        const kits = payload?.kits || []
        const items = payload?.items || []
        setKitCount(Number(payload?.count || 0))
        commit((current) => ({
          ...current,
          stockKits: [...current.stockKits, ...kits.filter((row: { id: string }) => !current.stockKits.some((item) => item.id === row.id))],
          stockKitItems: [...current.stockKitItems, ...items.filter((row: { id: string }) => !current.stockKitItems.some((item) => item.id === row.id))],
        }), { persist: false })
      }
    } catch (error) {
      toast({ title: `Erro ao carregar mais ${kind === "materiais" ? "materiais" : "kits"}`, description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" })
    } finally {
      setLoadingMoreRegistries("")
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedStockOrderSearch(stockOrderSearch.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [stockOrderSearch])

  useEffect(() => {
    if (tab !== "stock-orders") return
    let active = true
    const load = async () => {
      setStockOrdersLoading(true)
      try {
        const params = new URLSearchParams({ limit: String(stockOrderBatchSize) })
        params.set("sync", "0")
        if (debouncedStockOrderSearch) params.set("search", debouncedStockOrderSearch)
        const response = await fetch(`/api/estoque/stock-orders?${params}`, { cache: "no-store" })
        const payload = await response.json().catch(() => null)
        if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
        if (!active) return
        const loadedOrders = (payload?.orders || []).map(stockProductionOrder)
        setStockOrders(loadedOrders)
        setStockOrderCounts({ ...emptyStockOrderCounts(), ...(payload?.counts || {}) })
        setSelectedStockOrderIds((current) => current.filter((id) => loadedOrders.some((order: StockProductionOrder) => order.id === id)))
        setStockOrdersSetupRequired(Boolean(payload?.setupRequired))
      } catch (error) {
        if (active) toast({ title: "Erro ao carregar OS de estoque", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" })
      } finally {
        if (active) setStockOrdersLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [tab, debouncedStockOrderSearch])

  async function loadMoreStockOrders(status: StockProductionStatus) {
    if (loadingMoreStockOrders[status]) return
    const offset = stockOrders.filter((order) => order.status === status).length
    setLoadingMoreStockOrders((current) => ({ ...current, [status]: true }))
    try {
      const params = new URLSearchParams({ status, offset: String(offset), limit: String(stockOrderBatchSize), sync: "0" })
      if (debouncedStockOrderSearch) params.set("search", debouncedStockOrderSearch)
      const response = await fetch(`/api/estoque/stock-orders?${params}`, { cache: "no-store" })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
      const loadedOrders = (payload?.orders || []).map(stockProductionOrder) as StockProductionOrder[]
      setStockOrders((current) => [...current, ...loadedOrders.filter((order) => !current.some((item) => item.id === order.id))])
      setStockOrderCounts((current) => ({ ...current, [status]: Number(payload?.count || 0) }))
    } catch (error) {
      toast({ title: "Erro ao carregar mais etiquetas", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" })
    } finally {
      setLoadingMoreStockOrders((current) => ({ ...current, [status]: false }))
    }
  }

  const filteredStockOrders = useMemo(() => {
    const search = stockOrderSearch.trim().toLocaleLowerCase("pt-BR")
    if (!search) return stockOrders
    return stockOrders.filter((order) => [order.workName, order.towerName, order.floorName, order.finalName, order.environmentName, order.pointName, order.kitName].some((value) => value.toLocaleLowerCase("pt-BR").includes(search)))
  }, [stockOrderSearch, stockOrders])

  const selectedStockOrders = useMemo(() => stockOrders.filter((order) => selectedStockOrderIds.includes(order.id)), [selectedStockOrderIds, stockOrders])
  const allVisibleStockOrdersSelected = Boolean(filteredStockOrders.length) && filteredStockOrders.every((order) => selectedStockOrderIds.includes(order.id))

  function toggleVisibleStockLabels() {
    const visibleIds = filteredStockOrders.map((order) => order.id)
    setSelectedStockOrderIds((current) => allVisibleStockOrdersSelected
      ? current.filter((id) => !visibleIds.includes(id))
      : Array.from(new Set([...current, ...visibleIds])))
  }

  async function updateStockOrder(id: string, changes: Partial<Pick<StockProductionOrder, "status" | "hasWelding" | "guidePassage">>) {
    const previous = stockOrders
    const previousStatus = stockOrders.find((order) => order.id === id)?.status
    setStockOrders((current) => current.map((order) => order.id === id ? { ...order, ...changes } : order))
    if (changes.status && previousStatus && changes.status !== previousStatus) {
      setStockOrderCounts((current) => ({
        ...current,
        [previousStatus]: Math.max(0, current[previousStatus] - 1),
        [changes.status!]: current[changes.status!] + 1,
      }))
    }
    try {
      const response = await fetch("/api/estoque/stock-orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...changes }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
      setStockOrders((current) => current.map((order) => order.id === id ? stockProductionOrder(payload.order) : order))
    } catch (error) {
      setStockOrders(previous)
      if (changes.status && previousStatus && changes.status !== previousStatus) {
        setStockOrderCounts((current) => ({
          ...current,
          [previousStatus]: current[previousStatus] + 1,
          [changes.status!]: Math.max(0, current[changes.status!] - 1),
        }))
      }
      toast({ title: "Erro ao atualizar OS de estoque", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" })
    }
  }

  function printStockLabels() {
    if (!selectedStockOrders.length) {
      toast({ title: "Selecione as etiquetas", description: "Marque pelo menos um ponto no Kanban antes de imprimir.", variant: "destructive" })
      return
    }
    const escapeHtml = (value: unknown) => String(value || "-").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character] || character))
    const check = (value: boolean | null, expected: boolean) => value === expected ? "X" : " "
    const labelHtml = (order: StockProductionOrder) => `
      <article class="label">
        <div class="work">${escapeHtml(order.workName)}</div>
        <div class="location">${escapeHtml(order.floorName)} - ${escapeHtml(order.towerName)}</div>
        ${order.finalName ? `<div class="final">${escapeHtml(order.finalName)}</div>` : ""}
        <div class="point">${escapeHtml([order.environmentName, order.pointName].filter(Boolean).join(" / "))}</div>
        <div class="row"><strong>KIT:</strong><span>${escapeHtml(order.kitName)}</span></div>
        <div class="row"><strong>MEDIDA:</strong><span>${escapeHtml(order.infrastructureMeasure)}</span></div>
        <div class="signature"><strong>ASS:</strong></div>
        <div class="choice"><strong>POSSUI SOLDA?</strong><span>SIM [${check(order.hasWelding, true)}] &nbsp; NÃO [${check(order.hasWelding, false)}]</span></div>
        <div class="choice"><strong>PASSAGEM DE GUIA?</strong><span>SIM [${check(order.guidePassage, true)}] &nbsp; NÃO [${check(order.guidePassage, false)}]</span></div>
      </article>`
    const pages = Array.from({ length: Math.ceil(selectedStockOrders.length / 4) }, (_, pageIndex) => {
      const labels = selectedStockOrders.slice(pageIndex * 4, pageIndex * 4 + 4).map(labelHtml).join("")
      return `<main class="sheet">${labels}</main>`
    }).join("")
    const printWindow = window.open("", "_blank")
    if (!printWindow) {
      toast({ title: "Impressão bloqueada", description: "Libere pop-ups para imprimir as etiquetas.", variant: "destructive" })
      return
    }
    printWindow.opener = null
    printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Etiquetas de estoque</title><style>
      @page{size:A4 portrait;margin:9mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#111}.sheet{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:repeat(2,minmax(0,1fr));gap:5mm;height:279mm;break-after:page;page-break-after:always}.sheet:last-of-type{break-after:auto;page-break-after:auto}.label{border:1.4px solid #222;break-inside:avoid;text-align:center;overflow:hidden;height:100%}.work,.final{background:#e52222;color:#fff;font-size:20px;font-weight:800;padding:9px 6px;text-transform:uppercase}.location{background:#f7c9b5;font-size:19px;font-weight:800;padding:9px 6px;text-transform:uppercase}.final{font-size:19px}.point{border-bottom:1px solid #222;font-size:18px;font-weight:700;min-height:44px;padding:10px;text-transform:uppercase}.row,.choice{display:grid;grid-template-columns:35% 65%;border-bottom:1px solid #222;min-height:36px;align-items:center;font-size:16px}.row strong,.choice strong{padding:8px;border-right:1px solid #222}.row span,.choice span{padding:8px;font-weight:700}.signature{height:46px;border-bottom:1px solid #222;text-align:left;padding:12px;font-size:16px}.choice{grid-template-columns:48% 52%;font-size:14px}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    </style></head><body>${pages}<script>window.onload=()=>window.print()<\/script></body></html>`)
    printWindow.document.close()
  }

  function close() {
    setSheet("")
    setEditingMaterialId("")
    setEditingKitId("")
    setMaterial(emptyMaterialForm)
    setKit({ name: "", sizeMeters: "", description: "", unitValue: "0", quantityInStock: "0", status: "Ativo", notes: "" })
    setKitItem({ materialId: "", quantity: "1" })
    setKitItems([])
  }

  function openNewMaterial() {
    close()
    setSheet("material")
  }

  function openNewKit() {
    close()
    setSheet("kit")
  }

  function editMaterial(item: Material) {
    setEditingMaterialId(item.id)
    setMaterial(materialFormFromItem(item))
    setSheet("material")
  }

  function editKit(item: NonNullable<OperationalState["stockKits"]>[number]) {
    const currentItems = state.stockKitItems.filter((kitItem) => kitItem.kitId === item.id).map((kitItem) => ({ materialId: kitItem.materialId, quantity: kitItem.quantity }))
    const sizeMeters = inferKitMeters(item.name, currentItems, state.materials)
    setEditingKitId(item.id)
    setKit({ name: item.name, sizeMeters: sizeMeters ? String(sizeMeters) : "", description: item.description || "", unitValue: String((item as any).unitValue ?? 0), quantityInStock: String((item as any).quantityInStock ?? 0), status: item.status, notes: item.notes || "" })
    setKitItems(currentItems)
    setSheet("kit")
  }

  function money(value: number) {
    return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
  }

  async function saveMaterial() {
    if (!requireFields([["Nome do material", material.name], ["Unidade", material.unit]])) return
    const existing = state.materials.find((item) => item.id === editingMaterialId) || materialRows.find((item) => item.id === editingMaterialId)
    const invalid = validateMaterialForm(material, [...state.materials, ...materialRows], existing?.id)
    if (invalid) {
      toast({ title: "Revise o cadastro", description: invalid, variant: "destructive" })
      return
    }
    let record = materialRecordFromForm(material, existing, existing?.id || makeId("mat"))
    try {
      const response = await fetch("/api/estoque/materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ material: record }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
      // Saldo inicial vira movimentação no servidor; usa o item como ficou gravado.
      if (payload?.material) record = { ...record, ...payload.material }
    } catch (error) {
      toast({ title: "Erro ao salvar material no banco", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" })
      return
    }
    commit((current) => ({ ...current, materials: existing ? current.materials.map((item) => item.id === record.id ? record : item) : [record, ...current.materials], auditLogs: appendAudit(current, "material", record.id, existing ? "Editado" : "Criado", `Material ${record.name} ${existing ? "editado" : "criado"}`) }), { persist: false })
    setMaterialRows((current) => existing ? current.map((item) => item.id === record.id ? record : item) : [record, ...current])
    if (!existing) setMaterialCount((current) => current + 1)
    if (!existing) stockChanged()
    toast({ title: "Material salvo", description: record.composesKit ? "Material disponível para kits." : "Material salvo fora dos kits." })
    close()
  }

  function recalculateKitItems(sizeValue = kit.sizeMeters, showFeedback = true, nameValue = kit.name) {
    const composition = calculateKitComposition(nameValue, sizeValue, state.materials, kitItems)
    const sizeMeters = composition.sizeMeters
    if (!sizeMeters) {
      if (showFeedback) toast({ title: "Tamanho obrigatorio", description: "Informe o tamanho do KIT em metros para calcular os materiais.", variant: "destructive" })
      return false
    }
    setKitItems(composition.items)
    if (showFeedback && composition.missingMaterials.length) {
      toast({ title: "Materiais nao encontrados", description: `Cadastre ou marque como Compoe Kit: ${composition.missingMaterials.join(", ")}.`, variant: "destructive" })
      return false
    }
    if (showFeedback) {
      const description = composition.completeDefinition
        ? `${composition.items.length} materiais calculados para um KIT de ${sizeMeters.toLocaleString("pt-BR")} m.`
        : `Quantidades recalculadas para um KIT de ${sizeMeters.toLocaleString("pt-BR")} m. Informe as duas bitolas no nome para montar a lista completa.`
      toast({ title: "Composicao recalculada", description })
    }
    return true
  }

  function changeKitSize(value: string) {
    setKit({ ...kit, sizeMeters: value })
    if (parseKitMeters(value)) recalculateKitItems(value, false, kit.name)
  }

  function changeKitName(value: string) {
    const definition = parseKitDefinition(value, kit.sizeMeters)
    const sizeMeters = kit.sizeMeters || (definition.sizeMeters ? String(definition.sizeMeters) : "")
    setKit({ ...kit, name: value, sizeMeters })
    if (definition.sizeMeters && definition.diameters.length >= 2) recalculateKitItems(sizeMeters, false, value)
  }

  function addKitItem() {
    const materialRecord = state.materials.find((item) => item.id === kitItem.materialId)
    const sizeMeters = parseKitMeters(kit.sizeMeters)
    const calculatedBySize = materialRecord ? kitMaterialRule(materialRecord.name) !== "manual" : false
    const quantity = materialRecord ? calculateKitMaterialQuantity(materialRecord.name, sizeMeters, Number(kitItem.quantity || 0)) : 0
    if (calculatedBySize && !sizeMeters) {
      toast({ title: "Tamanho obrigatorio", description: "Informe o tamanho do KIT antes de adicionar este material.", variant: "destructive" })
      return
    }
    if (!materialRecord || quantity <= 0) {
      toast({ title: "Item obrigatório", description: "Escolha um material e informe a quantidade.", variant: "destructive" })
      return
    }
    setKitItems(kitItems.some((item) => item.materialId === materialRecord.id)
      ? kitItems.map((item) => item.materialId === materialRecord.id ? { ...item, quantity } : item)
      : [...kitItems, { materialId: materialRecord.id, quantity }])
    setKitItem({ materialId: "", quantity: "1" })
  }

  async function saveKit() {
    if (!requireFields([["Nome do kit", kit.name]])) return
    const quantityInStock = Number(kit.quantityInStock || 0)
    if (!Number.isInteger(quantityInStock) || quantityInStock < 0) {
      toast({ title: "Quantidade inválida", description: "Informe uma quantidade inteira igual ou maior que zero.", variant: "destructive" })
      return
    }
    const composition = calculateKitComposition(kit.name, kit.sizeMeters, state.materials, kitItems)
    const sizeMeters = composition.sizeMeters
    if (composition.missingMaterials.length) {
      toast({ title: "Composicao incompleta", description: `Cadastre ou marque como Compoe Kit: ${composition.missingMaterials.join(", ")}.`, variant: "destructive" })
      return
    }
    const itemsToCalculate = composition.items
    const requiresSize = itemsToCalculate.some((item) => {
      const materialRecord = state.materials.find((row) => row.id === item.materialId)
      return materialRecord && kitMaterialRule(materialRecord.name) !== "manual"
    })
    if (requiresSize && !sizeMeters) {
      toast({ title: "Tamanho obrigatorio", description: "Informe o tamanho do KIT para calcular a composicao.", variant: "destructive" })
      return
    }
    const calculatedKitItems = itemsToCalculate.map((item) => {
      const materialRecord = state.materials.find((row) => row.id === item.materialId)
      return materialRecord ? { ...item, quantity: calculateKitMaterialQuantity(materialRecord.name, sizeMeters, item.quantity) } : item
    })
    const existingKit = state.stockKits.find((item) => item.id === editingKitId)
    const oldUsageByMaterial = existingKit ? state.stockKitItems.filter((item) => item.kitId === existingKit.id).reduce<Record<string, number>>((acc, item) => {
      acc[item.materialId] = (acc[item.materialId] || 0) + item.quantity
      return acc
    }, {}) : {}
    const usageByMaterial = calculatedKitItems.reduce<Record<string, number>>((acc, item) => {
      acc[item.materialId] = (acc[item.materialId] || 0) + item.quantity
      return acc
    }, {})
    const stockDeltas = Array.from(new Set([...Object.keys(usageByMaterial), ...Object.keys(oldUsageByMaterial)])).reduce<Record<string, number>>((acc, materialId) => {
      acc[materialId] = (usageByMaterial[materialId] || 0) - (oldUsageByMaterial[materialId] || 0)
      return acc
    }, {})
    const insufficient = Object.entries(stockDeltas).find(([materialId, quantity]) => {
      const materialRecord = state.materials.find((mat) => mat.id === materialId)
      return !materialRecord || quantity > materialStock(materialRecord)
    })
    if (insufficient) {
      const [materialId, quantity] = insufficient
      const materialRecord = state.materials.find((mat) => mat.id === materialId)
      toast({ title: "Saldo insuficiente", description: `${materialRecord?.name || "Material"} tem saldo ${materialRecord ? materialStock(materialRecord) : 0} ${materialRecord?.unit || ""} e o kit usa ${quantity}.`, variant: "destructive" })
      return
    }
    if (!calculatedKitItems.length) {
      toast({ title: "Kit sem itens", description: "Adicione pelo menos um material que compõe kit.", variant: "destructive" })
      return
    }
    const now = nowIso()
    const kitId = existingKit?.id || makeId("kit")
    const record: NonNullable<OperationalState["stockKits"]>[number] = { id: kitId, name: kit.name, description: kit.description, unitValue: Number(kit.unitValue || 0), quantityInStock, status: kit.status, notes: kit.notes, createdAt: existingKit?.createdAt || now, updatedAt: now }
    const items = calculatedKitItems.map((item) => {
      const materialRecord = state.materials.find((mat) => mat.id === item.materialId)
      return { id: makeId("kititem"), kitId, materialId: item.materialId, quantity: item.quantity, unit: materialRecord?.unit || "unidade" }
    })
    const stockChanges = Object.entries(stockDeltas).filter(([, quantity]) => quantity).map(([materialId, quantity]) => ({ materialId, quantity }))
    let nextMaterials = state.materials
    try {
      const response = await fetch("/api/estoque/kits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kit: record, items, stockChanges }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || `Erro ${response.status}`)
      const balances = new Map<string, any>((payload?.materials || []).map((row: any) => [row.id, row]))
      nextMaterials = state.materials.map((mat) => {
        const row = balances.get(mat.id)
        return row ? { ...mat, currentStock: Number(row.current_stock || 0), reservedStock: Number(row.reserved_stock || 0), averageCost: Number(row.average_cost || 0), updatedAt: now } : mat
      })
    } catch (error) {
      toast({ title: "Erro ao salvar kit no banco", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" })
      return
    }
    commit((current) => ({ ...current, materials: nextMaterials, stockKits: existingKit ? current.stockKits.map((item) => item.id === kitId ? record : item) : [record, ...current.stockKits], stockKitItems: [...items, ...current.stockKitItems.filter((item) => item.kitId !== kitId)], auditLogs: appendAudit(current, "stock_kit", kitId, existingKit ? "Editado" : "Criado", `Kit ${record.name} ${existingKit ? "editado" : "criado"} e materiais ajustados no estoque`) }), { persist: false })
    setMaterialRows((current) => current.map((item) => nextMaterials.find((row) => row.id === item.id) || item))
    if (!existingKit) setKitCount((current) => current + 1)
    setKit({ name: "", sizeMeters: "", description: "", unitValue: "0", quantityInStock: "0", status: "Ativo", notes: "" })
    toast({ title: "Kit salvo", description: "Composição gravada no estoque." })
    close()
  }

  function kitSummary(kitId: string) {
    const items = state.stockKitItems.filter((item) => item.kitId === kitId)
    return items.map((item) => {
      const materialRecord = state.materials.find((mat) => mat.id === item.materialId)
      return `${item.quantity} ${item.unit} - ${materialRecord?.name || "Material"}`
    }).join("; ") || "-"
  }

  function normalizeImportKey(value: string) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim()
  }

  function parseImportNumber(value: unknown) {
    const text = String(value ?? "").trim()
    const normalized = text.includes(",") && text.includes(".")
      ? text.replace(/\./g, "").replace(",", ".")
      : text.replace(",", ".")
    const clean = normalized.replace(/[^\d.-]/g, "")
    const parsed = Number(clean)
    return Number.isFinite(parsed) ? parsed : 0
  }

  function unitFromQuantityHeader(value: string) {
    const normalized = normalizeImportKey(value)
    if (normalized.includes("kg")) return "kg"
    if (normalized.includes("un") || normalized.includes("und") || normalized.includes("peca")) return "unidade"
    if (normalized.includes("m")) return "m"
    return "unidade"
  }

  async function importKitsFromSpreadsheet(file?: File | null) {
    if (!file) return
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<Array<string | number>>(sheet, { header: 1, defval: "", raw: false })
      const header = (rows[0] || []).map((cell) => String(cell || "").trim())
      const materialColumns = header
        .map((name, index) => ({ name, index }))
        .filter((column) => normalizeImportKey(column.name) === "material")
        .map((column) => ({ materialIndex: column.index, quantityIndex: column.index + 1, unit: unitFromQuantityHeader(header[column.index + 1] || "") }))
      if (!materialColumns.length) throw new Error("Nao encontrei colunas Material/Qtd na planilha.")

      const existingMaterials = new Map(state.materials.map((item) => [normalizeImportKey(item.name), item]))
      const importedMaterials = new Map<string, Material>()
      const importedKits = new Map<string, { name: string; status: "Ativo" | "Inativo"; items: Map<string, number>; units: Map<string, string> }>()
      const now = nowIso()

      rows.slice(1).forEach((row) => {
        const kitName = String(row[0] || "").trim()
        if (!kitName) return
        const statusText = normalizeImportKey(String(row[1] || "Ativo"))
        const status = statusText.includes("inativo") ? "Inativo" : "Ativo"
        const items = new Map<string, number>()
        const units = new Map<string, string>()

        materialColumns.forEach(({ materialIndex, quantityIndex, unit }) => {
          const materialName = String(row[materialIndex] || "").trim()
          const quantity = parseImportNumber(row[quantityIndex])
          if (!materialName || quantity <= 0) return
          const materialKey = normalizeImportKey(materialName)
          const existing = existingMaterials.get(materialKey) || importedMaterials.get(materialKey)
          const materialRecord: Material = existing || {
            id: makeId("mat"),
            name: materialName,
            category: "Kit",
            unit,
            internalCode: "",
            minimumStock: 0,
            currentStock: 0,
            composesKit: true,
            status: "Ativo",
            notes: "Importado da planilha de kits",
            createdAt: now,
            updatedAt: now,
          }
          importedMaterials.set(materialKey, { ...materialRecord, unit: materialRecord.unit || unit, composesKit: true, status: materialRecord.status || "Ativo", updatedAt: now })
          items.set(materialKey, (items.get(materialKey) || 0) + quantity)
          units.set(materialKey, materialRecord.unit || unit)
        })

        if (items.size) importedKits.set(normalizeImportKey(kitName), { name: kitName, status, items, units })
      })

      if (!importedKits.size) throw new Error("Nenhum kit valido foi encontrado na planilha.")
      const existingKitByName = new Map(state.stockKits.map((item) => [normalizeImportKey(item.name), item]))
      const materialList = Array.from(importedMaterials.values())
      let nextMaterials = [...state.materials]
      materialList.forEach((materialRecord) => {
        nextMaterials = nextMaterials.some((item) => item.id === materialRecord.id)
          ? nextMaterials.map((item) => item.id === materialRecord.id ? { ...item, ...materialRecord } : item)
          : [materialRecord, ...nextMaterials]
      })

      let nextKits = [...state.stockKits]
      let nextKitItems = [...state.stockKitItems]
      let savedKitCount = 0
      let savedItemCount = 0

      for (const [kitKey, importedKit] of importedKits) {
        const existingKit = existingKitByName.get(kitKey)
        const kitId = existingKit?.id || makeId("kit")
        const items = Array.from(importedKit.items.entries()).map(([materialKey, quantity]) => {
          const materialRecord = importedMaterials.get(materialKey) || existingMaterials.get(materialKey)
          return { id: makeId("kititem"), kitId, materialId: materialRecord!.id, quantity, unit: importedKit.units.get(materialKey) || materialRecord?.unit || "unidade" }
        })
        const kitRecord = { id: kitId, name: importedKit.name, description: "Importado da planilha de kits", unitValue: Number((existingKit as any)?.unitValue || 0), quantityInStock: Number((existingKit as any)?.quantityInStock || 0), status: importedKit.status, notes: `Importado de ${file.name}`, createdAt: existingKit?.createdAt || now, updatedAt: now }
        const response = await fetch("/api/estoque/kits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kit: kitRecord, items, materialUpdates: materialList }),
        })
        if (!response.ok) {
          const payload = await response.json().catch(() => null)
          throw new Error(payload?.error || `Erro ${response.status} ao salvar ${kitRecord.name}`)
        }
        nextKits = nextKits.some((item) => item.id === kitId) ? nextKits.map((item) => item.id === kitId ? kitRecord : item) : [kitRecord, ...nextKits]
        nextKitItems = [...items, ...nextKitItems.filter((item) => item.kitId !== kitId)]
        savedKitCount += 1
        savedItemCount += items.length
      }

      commit((current) => ({ ...current, materials: nextMaterials, stockKits: nextKits, stockKitItems: nextKitItems, auditLogs: appendAudit(current, "stock_kit", "importacao-kits", "Importacao", `${savedKitCount} kits e ${materialList.length} materiais importados`) }), { persist: false })
      setMaterialRows((current) => [...materialList, ...current.filter((item) => !materialList.some((row) => row.id === item.id))])
      setMaterialCount((current) => Math.max(current, nextMaterials.length))
      setKitCount((current) => Math.max(current, nextKits.length))
      setTab("kits")
      toast({ title: "Planilha importada", description: `${savedKitCount} kits, ${materialList.length} materiais e ${savedItemCount} vinculos salvos no estoque.` })
    } catch (error) {
      toast({ title: "Erro ao importar kits", description: error instanceof Error ? error.message : "Confira o arquivo e tente novamente.", variant: "destructive" })
    }
  }

  return (
    <PageShell
      title="Estoque"
      description="Controle de materiais, saldos e kits usados nas ordens de serviço."
      actions={<>
        {tab === "materiais" ? <Button onClick={openNewMaterial} disabled={loadingStockTabs.materiais}><Plus className="h-4 w-4" />Novo material</Button> : null}
        {tab === "kits" ? <><Label className={`inline-flex h-10 items-center rounded-md border px-3 text-sm font-medium ${loadingStockTabs.kits ? "pointer-events-none opacity-50" : "cursor-pointer"}`}><FileUp className="mr-2 h-4 w-4" />Importar kits<Input className="hidden" type="file" accept=".xlsx,.xls,.csv" disabled={loadingStockTabs.kits} onChange={(event) => importKitsFromSpreadsheet(event.target.files?.[0])} /></Label><Button variant="secondary" onClick={openNewKit} disabled={loadingStockTabs.kits}><Package className="h-4 w-4" />Novo kit</Button></> : null}
        {tab === "stock-orders" ? <Button onClick={printStockLabels} disabled={!selectedStockOrders.length}><Printer className="h-4 w-4" />Imprimir etiquetas ({selectedStockOrders.length})</Button> : null}
      </>}
    >
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap"><TabsTrigger value="materiais">Itens e saldos</TabsTrigger><TabsTrigger value="movimentacoes">Movimentações</TabsTrigger><TabsTrigger value="reservas">Reservas</TabsTrigger><TabsTrigger value="inventario">Inventário</TabsTrigger><TabsTrigger value="compras">Sugestão de compra</TabsTrigger><TabsTrigger value="depositos">Depósitos</TabsTrigger><TabsTrigger value="kits">Kit</TabsTrigger><TabsTrigger value="stock-orders">OS de estoque</TabsTrigger></TabsList>
        {warehousesError ? <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{warehousesError}</p> : null}
        <div className="mt-4"><StockAlertBanner materials={allMaterials} /></div>
        <TabsContent value="movimentacoes" className="mt-4"><MovementsTab materials={allMaterials} warehouses={warehouses} refreshKey={stockRefreshKey} onChanged={stockChanged} /></TabsContent>
        <TabsContent value="reservas" className="mt-4"><ReservationsTab materials={allMaterials} warehouses={warehouses} refreshKey={stockRefreshKey} onChanged={stockChanged} /></TabsContent>
        <TabsContent value="inventario" className="mt-4"><InventoryTab materials={allMaterials} warehouses={warehouses} onChanged={stockChanged} /></TabsContent>
        <TabsContent value="compras" className="mt-4"><PurchaseSuggestionTab materials={allMaterials} suppliers={supplierOptions} /></TabsContent>
        <TabsContent value="depositos" className="mt-4"><WarehousesTab warehouses={warehouses} reload={reloadWarehouses} /></TabsContent>
        <TabsContent value="materiais" className="mt-4">
          {loadingStockTabs.materiais ? <div className="py-10 text-center text-sm text-muted-foreground">Carregando materiais...</div> : <SectionCard title="Itens de estoque" description="Saldo físico, reservado e disponível por item. O saldo muda somente por movimentação.">
            <div className="mb-3 flex flex-wrap gap-2"><Input className="max-w-sm" placeholder="Buscar por nome, SKU, categoria ou localização" value={materialQuery} onChange={(event) => setMaterialQuery(event.target.value)} /><Button variant="outline" onClick={() => setMovementSheet({ open: true })}><Plus className="h-4 w-4" />Nova movimentação</Button></div>
            <DataTable headers={["SKU", "Item", "Categoria", "Un.", "Depósito", "Localização", "Físico", "Reservado", "Disponível", "Mín. / Máx.", "Ponto rep.", "Custo médio", "Último custo", "Status", "Ações"]} empty={!materialRows.length} stickyHeader viewportClassName="max-h-[35rem] overflow-auto overscroll-contain" tableClassName="min-w-[1320px]">
              {materialRows.filter((item) => [item.name, item.internalCode, item.category, item.location].join(" ").toLowerCase().includes(materialQuery.toLowerCase())).map((item) => <TableRow key={item.id} className={needsReplenishment(item) ? "bg-amber-500/10" : undefined}><TableCell className="font-mono">{item.internalCode || "-"}</TableCell><TableCell>{item.name}</TableCell><TableCell>{item.category || "-"}</TableCell><TableCell>{item.unit}</TableCell><TableCell>{warehouseName(item.warehouseId)}</TableCell><TableCell>{item.location || "-"}</TableCell><TableCell>{materialStock(item)}</TableCell><TableCell>{item.reservedStock || 0}</TableCell><TableCell className={materialAvailable(item) < 0 ? "font-semibold text-destructive" : "font-semibold"}>{Math.round(materialAvailable(item) * 1000) / 1000}</TableCell><TableCell>{item.minimumStock} / {item.maximumStock || "-"}</TableCell><TableCell>{item.reorderPoint || "-"}</TableCell><TableCell>{money(item.averageCost || 0)}</TableCell><TableCell>{money(item.lastPurchaseCost || 0)}</TableCell><TableCell><StatusBadge status={item.status} /></TableCell><TableCell className="space-x-1 whitespace-nowrap"><Button size="sm" variant="outline" onClick={() => editMaterial(item)}>Editar</Button><Button size="sm" variant="outline" onClick={() => setMovementSheet({ open: true, preset: { materialId: item.id } })}>Movimentar</Button></TableCell></TableRow>)}
            </DataTable>
            {materialRows.length < materialCount ? <div className="mt-4 flex justify-center"><Button type="button" variant="outline" disabled={loadingMoreRegistries === "materiais"} onClick={() => void loadMoreStockRegistries("materiais")}>{loadingMoreRegistries === "materiais" ? "Carregando..." : `Carregar mais (${Math.min(stockRegistryBatchSize, materialCount - materialRows.length)})`}</Button></div> : null}
          </SectionCard>}
        </TabsContent>
        <TabsContent value="kits" className="mt-4">
          {loadingStockTabs.kits ? <div className="py-10 text-center text-sm text-muted-foreground">Carregando kits...</div> : <SectionCard title="Kits" description="Crie kits a partir dos materiais marcados como Compõe Kit.">
            <DataTable headers={["Kit", "Quantidade em estoque", "Itens", "Valor do kit", "Composição", "Status", "Observações", "Ações"]} empty={!state.stockKits.length} stickyHeader viewportClassName="max-h-[35rem] overflow-auto overscroll-contain" tableClassName="min-w-[1180px]">
              {state.stockKits.map((item) => <TableRow key={item.id}><TableCell>{item.name}</TableCell><TableCell className="font-semibold">{Number((item as any).quantityInStock || 0)}</TableCell><TableCell>{state.stockKitItems.filter((kitItem) => kitItem.kitId === item.id).length}</TableCell><TableCell>{money(Number((item as any).unitValue || 0))}</TableCell><TableCell>{kitSummary(item.id)}</TableCell><TableCell><StatusBadge status={item.status} /></TableCell><TableCell>{item.notes || item.description || "-"}</TableCell><TableCell><Button size="sm" variant="outline" onClick={() => editKit(item)}>Editar</Button></TableCell></TableRow>)}
            </DataTable>
            {state.stockKits.length < kitCount ? <div className="mt-4 flex justify-center"><Button type="button" variant="outline" disabled={loadingMoreRegistries === "kits"} onClick={() => void loadMoreStockRegistries("kits")}>{loadingMoreRegistries === "kits" ? "Carregando..." : `Carregar mais (${Math.min(stockRegistryBatchSize, kitCount - state.stockKits.length)})`}</Button></div> : null}
          </SectionCard>}
        </TabsContent>
        <TabsContent value="stock-orders" className="mt-4 space-y-4">
          <div className="flex flex-col gap-3 border-b pb-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Produção de kits por ponto</h2>
              <p className="text-sm text-muted-foreground">Cada ponto do orçamento com kit gera uma OS de estoque e uma etiqueta própria.</p>
            </div>
            <div className="w-full space-y-2 md:max-w-sm">
              <Label htmlFor="stock-order-search">Pesquisar OS de estoque</Label>
              <div className="relative mt-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="stock-order-search" className="pl-9" value={stockOrderSearch} onChange={(event) => setStockOrderSearch(event.target.value)} placeholder="Obra, torre, ponto ou kit" />
              </div>
              <div className="flex items-center justify-between gap-2">
                <Button type="button" size="sm" variant="outline" disabled={!filteredStockOrders.length} onClick={toggleVisibleStockLabels}>{allVisibleStockOrdersSelected ? "Limpar visíveis" : "Selecionar visíveis"}</Button>
                <span className="text-xs font-medium text-muted-foreground">{selectedStockOrders.length} selecionada(s)</span>
              </div>
            </div>
          </div>
          {stockOrdersSetupRequired ? <AlertRow>Execute o script 156_add_stock_service_orders.sql no Supabase para ativar as OS de estoque.</AlertRow> : null}
          {stockOrdersLoading && !stockOrders.length ? <div className="py-10 text-center text-sm text-muted-foreground">Carregando OS de estoque...</div> : null}
          {!stockOrdersLoading && !filteredStockOrders.length && !stockOrdersSetupRequired ? <div className="rounded-md border border-dashed py-10 text-center text-sm text-muted-foreground">Nenhum ponto com kit encontrado. Salve um orçamento com kit vinculado ao ponto.</div> : null}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {stockProductionStatuses.map((status) => {
              const orders = filteredStockOrders.filter((order) => order.status === status)
              const totalOrders = stockOrderCounts[status]
              const hasMore = orders.length < totalOrders
              const tone = status === "Aberto" ? "border-blue-500 bg-blue-50/50" : status === "Produção" ? "border-orange-500 bg-orange-50/50" : status === "Pronta para uso" ? "border-emerald-500 bg-emerald-50/50" : "border-slate-500 bg-slate-50"
              return (
                <section key={status} className={`flex min-h-52 flex-col border-t-4 p-3 ${tone}`}>
                  <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">{status}</h3><Badge variant="secondary">{totalOrders}</Badge></div>
                  <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1" data-stock-kanban-scroll={status}>
                    {orders.map((order) => (
                      <article key={order.id} className={`space-y-3 rounded-md border bg-background p-3 shadow-sm ${selectedStockOrderIds.includes(order.id) ? "ring-2 ring-primary" : ""}`}>
                        <div className="flex items-start gap-2">
                          <Checkbox aria-label={`Selecionar etiqueta de ${order.pointName}`} checked={selectedStockOrderIds.includes(order.id)} onCheckedChange={(checked) => setSelectedStockOrderIds((current) => checked ? Array.from(new Set([...current, order.id])) : current.filter((id) => id !== order.id))} />
                          <div><p className="font-semibold leading-tight">{order.workName || "Obra"}</p><p className="mt-1 text-xs text-muted-foreground">{[order.floorName, order.towerName, order.finalName].filter(Boolean).join(" | ") || "Local não informado"}</p></div>
                        </div>
                        <div className="text-sm"><p><span className="font-medium">Ponto:</span> {order.pointName || "-"}</p>{order.environmentName ? <p><span className="font-medium">Ambiente:</span> {order.environmentName}</p> : null}<p><span className="font-medium">Kit:</span> {order.kitName || "-"}</p><p><span className="font-medium">Medida:</span> {order.infrastructureMeasure || "-"}</p></div>
                        <Select value={order.status} onValueChange={(value) => void updateStockOrder(order.id, { status: value as StockProductionStatus })}><SelectTrigger aria-label={`Status de ${order.pointName}`}><SelectValue /></SelectTrigger><SelectContent>{stockProductionStatuses.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select>
                        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                          <Select value={order.hasWelding === null ? "pendente" : order.hasWelding ? "sim" : "nao"} onValueChange={(value) => void updateStockOrder(order.id, { hasWelding: value === "pendente" ? null : value === "sim" })}><SelectTrigger aria-label="Possui solda"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pendente">Solda: definir</SelectItem><SelectItem value="sim">Solda: sim</SelectItem><SelectItem value="nao">Solda: não</SelectItem></SelectContent></Select>
                          <Select value={order.guidePassage === null ? "pendente" : order.guidePassage ? "sim" : "nao"} onValueChange={(value) => void updateStockOrder(order.id, { guidePassage: value === "pendente" ? null : value === "sim" })}><SelectTrigger aria-label="Passagem de guia"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pendente">Guia: definir</SelectItem><SelectItem value="sim">Guia: sim</SelectItem><SelectItem value="nao">Guia: não</SelectItem></SelectContent></Select>
                        </div>
                      </article>
                    ))}
                    {!orders.length ? <p className="py-8 text-center text-xs text-muted-foreground">Nenhuma OS neste status</p> : null}
                    {hasMore ? <Button type="button" variant="outline" className="w-full" disabled={loadingMoreStockOrders[status]} onClick={() => void loadMoreStockOrders(status)}>{loadingMoreStockOrders[status] ? "Carregando..." : `Carregar mais (${Math.min(stockOrderBatchSize, totalOrders - orders.length)})`}</Button> : null}
                  </div>
                </section>
              )
            })}
          </div>
        </TabsContent>
      </Tabs>

      <MovementSheet open={movementSheet.open} onOpenChange={(open) => setMovementSheet((current) => ({ ...current, open }))} materials={allMaterials} warehouses={warehouses} preset={movementSheet.preset} onSaved={stockChanged} />
      <FormSheet open={sheet === "material"} onOpenChange={(open) => !open && close()} title="Cadastro de Produto / Material">
        <MaterialFormFields material={material} setMaterial={setMaterial} suppliers={supplierOptions} existing={materialRows.find((item) => item.id === editingMaterialId) || state.materials.find((item) => item.id === editingMaterialId)} showStatus />
        <SaveButton onClick={saveMaterial}>Salvar material</SaveButton>
      </FormSheet>

      <FormSheet open={sheet === "kit"} onOpenChange={(open) => !open && close()} title="Cadastro de Kit">
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label="Nome do kit" value={kit.name} onChange={changeKitName} />
          <TextField label="Tamanho do KIT (m)" type="number" value={kit.sizeMeters} onChange={changeKitSize} />
          <TextField label="Valor do kit" type="number" value={kit.unitValue} onChange={(value) => setKit({ ...kit, unitValue: value })} />
          <TextField label="Quantidade de kits em estoque" type="number" value={kit.quantityInStock} onChange={(value) => setKit({ ...kit, quantityInStock: value })} />
          <SelectField label="Status" value={kit.status} onChange={(value) => setKit({ ...kit, status: value })} options={["Ativo", "Inativo"].map((value) => ({ value, label: value }))} />
          <div className="flex items-end"><Button type="button" variant="outline" onClick={() => recalculateKitItems()}>Calcular materiais do KIT</Button></div>
        </div>
        <TextAreaField label="Descrição do kit" value={kit.description} onChange={(value) => setKit({ ...kit, description: value })} />
        <div className="grid gap-3 rounded-md border p-3 md:grid-cols-[1fr_160px_auto]">
          <SelectField label="Material do kit" value={kitItem.materialId || "nenhum"} onChange={(value) => {
            const materialId = value === "nenhum" ? "" : value
            const materialRecord = state.materials.find((item) => item.id === materialId)
            const quantity = materialRecord ? calculateKitMaterialQuantity(materialRecord.name, parseKitMeters(kit.sizeMeters), Number(kitItem.quantity || 0)) : 1
            setKitItem({ materialId, quantity: String(quantity || 1) })
          }} options={[{ value: "nenhum", label: kitMaterialOptions.length ? "Selecione" : "Nenhum material marcado como Compõe Kit" }, ...kitMaterialOptions.map((item) => ({ value: item.id, label: `${item.name} - saldo ${materialStock(item)} ${item.unit}` }))]} />
          <TextField label={kitMaterialRule(state.materials.find((item) => item.id === kitItem.materialId)?.name || "") === "manual" ? "Quantidade" : "Quantidade calculada"} type="number" value={kitItem.quantity} onChange={(value) => setKitItem({ ...kitItem, quantity: value })} />
          <div className="flex items-end"><Button type="button" onClick={addKitItem}>Adicionar</Button></div>
        </div>
        <DataTable headers={["Material", "Regra", "Quantidade", "Unidade", "Ações"]} empty={!kitItems.length}>
          {kitItems.map((item, index) => {
            const materialRecord = state.materials.find((mat) => mat.id === item.materialId)
            return <TableRow key={`${item.materialId}-${index}`}><TableCell>{materialRecord?.name || "Material"}</TableCell><TableCell>{kitMaterialRuleLabel(materialRecord?.name || "")}</TableCell><TableCell>{item.quantity}</TableCell><TableCell>{materialRecord?.unit || "-"}</TableCell><TableCell><Button size="sm" variant="outline" onClick={() => setKitItems(kitItems.filter((_, rowIndex) => rowIndex !== index))}>Remover</Button></TableCell></TableRow>
          })}
        </DataTable>
        <TextAreaField label="Observações" value={kit.notes} onChange={(value) => setKit({ ...kit, notes: value })} />
        <SaveButton onClick={saveKit}>Salvar kit</SaveButton>
      </FormSheet>
    </PageShell>
  )
}

function EntityDetail({ state, detail, onClose, openSheet }: { state: OperationalState; detail: { type: "client" | "work" | "point"; id: string }; onClose: () => void; openSheet: (kind: SheetKind, preset?: Record<string, string>) => void }) {
  const n = names(state)
  const client = detail.type === "client" ? state.clients.find((item) => item.id === detail.id) : undefined
  const work = detail.type === "work" ? state.works.find((item) => item.id === detail.id) : undefined
  const point = detail.type === "point" ? state.workPoints.find((item) => item.id === detail.id) : undefined
  const pointEnvironment = point ? state.workEnvironments.find((item) => item.id === point.environmentId) : undefined
  const title = client?.name || work?.name || point?.pointName || "Detalhe"
  const relatedWorks = client ? state.works.filter((item) => item.clientId === client.id) : work ? [work] : []
  const relatedOrders = state.serviceOrders.filter((item) => (client ? item.clientId === client.id : point ? item.pointId === point.id : item.workId === work?.id))
  const clientEnvironments = client ? (state.clientEnvironments || []).filter((item) => item.clientId === client.id) : []
  const clientEquipment = client ? (state.clientEquipment || []).filter((item) => item.clientId === client.id) : []
  if (client) {
    return (
      <FormSheet open onOpenChange={(open) => !open && onClose()} title={title} description="Painel lateral com dados cadastrais, ordens de serviço e histórico.">
        <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => openSheet("order", { clientId: client.id })}>Criar OS</Button><Button size="sm" variant="outline" onClick={() => openSheet("clientEnvironment", { clientId: client.id })}>Novo ambiente</Button><Button size="sm" variant="outline" onClick={() => openSheet("clientEquipment", { clientId: client.id })}>Novo equipamento</Button></div>
        <Tabs defaultValue="dados">
          <TabsList className="flex flex-wrap"><TabsTrigger value="dados">Dados</TabsTrigger><TabsTrigger value="ambientes">Ambientes e equipamentos</TabsTrigger><TabsTrigger value="os">Ordens de servico</TabsTrigger><TabsTrigger value="historico">Historico</TabsTrigger></TabsList>
          {(client.serviceContexts || []).includes("pmoc") ? <DetailGrid rows={[["Valor mensal do PMOC", Number(client.monthlyPmocValue || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })]]} /> : null}
          <TabsContent value="dados"><DetailGrid rows={[["Tipo", client.type], ["Documento", client.document], ["Contato", client.mobile || client.phone], ["Endereço", fullAddress(client)], ["Status", <StatusBadge key="s" status={client.status} />], ["Observações", client.notes]]} /></TabsContent>
          <TabsContent value="ambientes" className="space-y-4">
            <DataTable headers={["Ambiente", "Tipo atividade", "Pavimento/Setor", "Ocupantes (total / fixos / flutuantes)", "Area climatizada", "Status", "Acoes"]} empty={!clientEnvironments.length}>
              {clientEnvironments.map((environment) => {
                return <TableRow key={environment.id}><TableCell>{environment.name}</TableCell><TableCell>{environment.activityType || "-"}</TableCell><TableCell>{environment.floor || "-"}</TableCell><TableCell>{`${Number(environment.occupantsTotal || 0)} / ${Number(environment.occupantsFixed || 0)} / ${Number(environment.occupantsFloating || 0)}`}</TableCell><TableCell>{Number(environment.airConditionedArea || 0) ? `${Number(environment.airConditionedArea).toLocaleString("pt-BR")} m²` : "-"}</TableCell><TableCell><StatusBadge status={environment.status} /></TableCell><TableCell className="space-x-1"><Button size="sm" variant="outline" onClick={() => openSheet("clientEnvironment", { id: environment.id })}>Editar</Button><Button size="sm" variant="outline" onClick={() => openSheet("clientEquipment", { clientId: client.id, clientEnvironmentId: environment.id })}>Equipamento</Button></TableCell></TableRow>
              })}
            </DataTable>
            <DataTable headers={["TAG", "Ambiente", "Equipamento", "Capacidade", "Nº de serie", "Tipo", "Marca/Modelo", "Status", "Acoes"]} empty={!clientEquipment.length}>
              {clientEquipment.map((equipment) => {
                const environment = clientEnvironments.find((item) => item.id === equipment.clientEnvironmentId)
                return <TableRow key={equipment.id}><TableCell>{equipment.tag || "-"}</TableCell><TableCell>{environment?.name || "-"}</TableCell><TableCell>{equipment.name}</TableCell><TableCell>{equipment.capacity || "-"}</TableCell><TableCell>{equipment.serialNumber || "-"}</TableCell><TableCell>{equipment.type || "-"}</TableCell><TableCell>{[equipment.brand, equipment.model].filter(Boolean).join(" / ") || "-"}</TableCell><TableCell><StatusBadge status={equipment.status} /></TableCell><TableCell><div className="flex gap-1"><EquipmentQrDialog equipment={equipment} /><Button size="sm" variant="outline" onClick={() => openSheet("clientEquipment", { id: equipment.id })}>Editar</Button></div></TableCell></TableRow>
              })}
            </DataTable>
          </TabsContent>
          <TabsContent value="os"><OrdersMiniTable state={state} orders={relatedOrders} /></TabsContent>
          <TabsContent value="historico"><AuditTable state={state} filter={[]} entityId={client.id} /></TabsContent>
        </Tabs>
      </FormSheet>
    )
  }
  return (
    <FormSheet open onOpenChange={(open) => !open && onClose()} title={title} description="Painel lateral com dados relacionados e historico.">
      <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => openSheet("order", { clientId: work?.clientId || "", workId: work?.id || point?.workId || "", pointId: point?.id || "" })}>Criar OS{point ? " para este ponto" : ""}</Button></div>
      <Tabs defaultValue="dados">
        <TabsList className="flex flex-wrap"><TabsTrigger value="dados">Dados</TabsTrigger><TabsTrigger value="obras">Obras/Locais</TabsTrigger><TabsTrigger value="pontos">Pontos</TabsTrigger><TabsTrigger value="os">Ordens de servico</TabsTrigger><TabsTrigger value="historico">Historico</TabsTrigger></TabsList>
        <TabsContent value="dados"><DetailGrid rows={point ? [["Cliente", n.client(state.works.find((item) => item.id === point.workId)?.clientId || "")], ["Obra/Local", n.work(point.workId)], ["Pavimento", pointEnvironment?.floor], ["Final", pointEnvironment?.final], ["Ambiente", pointEnvironment?.environmentName], ["Numero do ponto", point.pointNumber], ["Nome do ponto", point.pointName], ["Tipo de servico", n.serviceType(point.serviceTypeId)], ["Status", <StatusBadge key="s" status={point.status} />], ["Observacoes tecnicas", point.technicalNotes]] : client ? [["Tipo", client.type], ["Documento", client.document], ["Contato", client.mobile || client.phone], ["Endereco", fullAddress(client)], ["Status", <StatusBadge key="s" status={client.status} />], ["Observacoes", client.notes]] : [["Cliente", n.client(work?.clientId || "")], ["Numero", work?.uniqueNumber], ["Endereco", work ? fullAddress(work) : ""], ["Responsavel", work?.responsibleName], ["Status", <StatusBadge key="s" status={work?.status || ""} />], ["Observacoes", work?.notes]]} /></TabsContent>
        <TabsContent value="obras"><DataTable headers={["Numero", "Obra/Local", "Cidade", "Status", "OS"]} empty={!relatedWorks.length}>{relatedWorks.map((item) => <TableRow key={item.id}><TableCell>{item.uniqueNumber}</TableCell><TableCell>{item.name}</TableCell><TableCell>{item.city}</TableCell><TableCell><StatusBadge status={item.status} /></TableCell><TableCell>{state.serviceOrders.filter((order) => order.workId === item.id).length}</TableCell></TableRow>)}</DataTable></TabsContent>
        <TabsContent value="pontos"><DataTable headers={["Pavimento", "Final", "Ambiente", "Ponto", "Tipo", "OS"]} empty={!(work || point)}>{(work ? state.workPoints.filter((item) => item.workId === work.id) : point ? [point] : []).map((item) => { const env = state.workEnvironments.find((env) => env.id === item.environmentId); return <TableRow key={item.id}><TableCell>{env?.floor}</TableCell><TableCell>{env?.final}</TableCell><TableCell>{env?.environmentName}</TableCell><TableCell>{item.pointName}</TableCell><TableCell>{n.serviceType(item.serviceTypeId)}</TableCell><TableCell>{state.serviceOrders.filter((order) => order.pointId === item.id).length}</TableCell></TableRow> })}</DataTable></TabsContent>
        <TabsContent value="os"><OrdersMiniTable state={state} orders={relatedOrders} /></TabsContent>
        <TabsContent value="historico"><AuditTable state={state} filter={[]} entityId={detail.id} /></TabsContent>
      </Tabs>
    </FormSheet>
  )
}

export function ServiceOrdersPage() {
  const { state, commit } = useOperationalStore()
  const { user } = useAuth()
  const readOnlyClient = user?.role === "client"
  const canDeleteOrders = user?.role === "admin"
  const { toast } = useToast()
  const { sheet, setSheet, preset, openSheet } = useSheetWithPreset()
  const [tab, setTab] = useState("todas")
  const [query, setQuery] = useState("")
  const [calendarMode, setCalendarMode] = useState<"day" | "week">("day")
  const [calendarDate, setCalendarDate] = useState(today())
  const [calendarFilter, setCalendarFilter] = useState("todos")
  const n = names(state)
  const filtered = sortServiceOrdersByNewestScheduledDate(
    state.serviceOrders.filter((order) => [order.orderNumber, n.client(order.clientId), n.work(order.workId), n.serviceType(order.serviceTypeId), n.provider(order.mainProviderId), order.status].join(" ").toLowerCase().includes(query.toLowerCase())),
  )
  const delayed = filtered.filter((order) => order.scheduledDate < today() && !["Finalizada", "Cancelada"].includes(order.status))

  function updateStatus(order: ServiceOrder, status: string) {
    if (["Pausada", "Cancelada"].includes(status)) {
      const reason = window.prompt(`Informe o motivo para ${status}:`)
      if (!reason) return
      commit((current) => ({ ...current, serviceOrders: current.serviceOrders.map((item) => item.id === order.id ? { ...item, status: normalizeStatus(status), pauseReason: status === "Pausada" ? reason : item.pauseReason, cancellationReason: status === "Cancelada" ? reason : item.cancellationReason, cancelledAt: status === "Cancelada" ? nowIso() : item.cancelledAt, updatedAt: nowIso() } : item), auditLogs: appendAudit(current, "service_order", order.id, "Status", `${order.orderNumber} alterada para ${status}`) }))
      return
    }
    commit((current) => ({ ...current, serviceOrders: current.serviceOrders.map((item) => item.id === order.id ? { ...item, status: normalizeStatus(status), finishedAt: status === "Finalizada" ? nowIso() : item.finishedAt, updatedAt: nowIso() } : item), auditLogs: appendAudit(current, "service_order", order.id, "Status", `${order.orderNumber} alterada para ${status}`) }))
  }

  function duplicate(order: ServiceOrder) {
    const id = makeId("order")
    const copy = { ...order, id, orderNumber: nextOrderNumber(state), status: normalizeStatus("Criada"), createdAt: nowIso(), updatedAt: nowIso(), finishedAt: "", cancelledAt: "" }
    commit((current) => ({ ...current, serviceOrders: [copy, ...current.serviceOrders], auditLogs: appendAudit(current, "service_order", id, "Duplicada", `${copy.orderNumber} duplicada de ${order.orderNumber}`) }))
  }

  async function deleteOrder(order: ServiceOrder) {
    if (!canDeleteOrders) return
    if (!window.confirm(`Excluir definitivamente ${order.orderNumber}? Esta acao remove a OS, fotos, eventos e registros vinculados e nao pode ser desfeita.`)) return
    try {
      const response = await fetch(`/api/ordens-servico/${order.id}`, { method: "DELETE" })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || "Nao foi possivel excluir a OS.")
      commit((current) => ({
        ...current,
        serviceOrders: current.serviceOrders.filter((item) => item.id !== order.id),
        serviceOrderEvents: current.serviceOrderEvents.filter((item) => item.serviceOrderId !== order.id),
        checklistItems: current.checklistItems.filter((item) => item.serviceOrderId !== order.id),
        serviceOrderMaterials: current.serviceOrderMaterials.filter((item) => item.serviceOrderId !== order.id),
        serviceOrderFiles: current.serviceOrderFiles.filter((item) => item.serviceOrderId !== order.id),
        serviceOrderSignatures: current.serviceOrderSignatures.filter((item) => item.serviceOrderId !== order.id),
        vehicleChecklists: current.vehicleChecklists.filter((item) => item.serviceOrderId !== order.id),
        vehicleUsage: current.vehicleUsage.filter((item) => item.serviceOrderId !== order.id),
        pmocSchedules: current.pmocSchedules.map((item) => item.serviceOrderId === order.id ? { ...item, serviceOrderId: "", status: "Planejado" } : item),
        auditLogs: appendAudit(current, "service_order", order.id, "Excluida", `${order.orderNumber} excluida definitivamente`),
      }), { persist: false } as any)
      toast({ title: "OS excluida", description: `${order.orderNumber} nao aparecera mais no sistema.` })
    } catch (error) {
      toast({ title: "Erro ao excluir OS", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" })
    }
  }

  return (
    <PageShell title="Ordens de Servico" description={readOnlyClient ? "Consulte as ordens de servico vinculadas a sua empresa." : "Crie, acompanhe e execute ordens de servico com checklist, materiais e evidencias."} actions={readOnlyClient ? undefined : <><Button onClick={() => openSheet("order", { orderType: "obra" })}><Plus className="h-4 w-4" />Nova OS Obra</Button><Button variant="secondary" onClick={() => openSheet("order", { orderType: "pmoc" })}>Nova OS PMOC</Button><Button variant="secondary" onClick={() => openSheet("order", { orderType: "servicos" })}>Nova OS Servicos</Button><Button variant="outline" onClick={() => window.alert("Exportacao de OS simulada no MVP local.")}>Exportar OS</Button><Button variant="outline" onClick={() => window.print()}>Imprimir Relatorio</Button></>}>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList><TabsTrigger value="todas">Todas as OS</TabsTrigger>{!readOnlyClient ? <><TabsTrigger value="kanban">Kanban</TabsTrigger><TabsTrigger value="agenda">Agenda</TabsTrigger><TabsTrigger value="atrasadas">OS Atrasadas</TabsTrigger></> : null}</TabsList>
        <div className="my-4 grid gap-3 md:grid-cols-4"><Input placeholder="Filtrar por cliente, obra, status..." value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        <TabsContent value="todas"><OrdersTable state={state} orders={filtered} updateStatus={updateStatus} duplicate={duplicate} deleteOrder={deleteOrder} openSheet={openSheet} readOnly={readOnlyClient} canDelete={canDeleteOrders} /></TabsContent>
        <TabsContent value="kanban"><div className="grid gap-4 lg:grid-cols-4">{statusColumns.map((status) => <SectionCard key={status} title={status}><div className="space-y-3">{filtered.filter((order) => String(order.status).replace("Ã§Ã£", "ca").includes(status.replace("cao", "ca")) || order.status === status).map((order) => <div key={order.id} className="rounded-md border p-3"><div className="font-semibold">{order.orderNumber}</div><div className="text-sm text-muted-foreground">{n.client(order.clientId)} - {n.work(order.workId)}</div><Select value={order.status} onValueChange={(value) => updateStatus(order, value)}><SelectTrigger className="mt-3"><SelectValue /></SelectTrigger><SelectContent>{statusColumns.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div>)}</div></SectionCard>)}</div></TabsContent>
        <TabsContent value="agenda"><OrdersCalendar state={state} orders={filtered} mode={calendarMode} setMode={setCalendarMode} selectedDate={calendarDate} setSelectedDate={setCalendarDate} filter={calendarFilter} setFilter={setCalendarFilter} /></TabsContent>
        <TabsContent value="atrasadas"><OrdersMiniTable state={state} orders={delayed} /></TabsContent>
      </Tabs>
      {!readOnlyClient ? <QuickSheets state={state} commit={commit} sheet={sheet} setSheet={setSheet} preset={preset} /> : null}
    </PageShell>
  )
}

function OrdersTable({ state, orders, updateStatus, duplicate, deleteOrder, openSheet, readOnly = false, canDelete = false }: { state: OperationalState; orders: ServiceOrder[]; updateStatus: (order: ServiceOrder, status: string) => void; duplicate: (order: ServiceOrder) => void; deleteOrder: (order: ServiceOrder) => void; openSheet: (kind: SheetKind, values?: Record<string, string>) => void; readOnly?: boolean; canDelete?: boolean }) {
  const n = names(state)
  return (
    <SectionCard title="Todas as OS">
      <DataTable
        headers={["No OS", "Cliente", "Obra", "Tipo", "Data", "Valor", "Prestador", "Veiculo", "Status", "Acoes"]}
        empty={!orders.length}
        stickyHeader
        viewportClassName="max-h-[calc(100vh-18rem)] overflow-auto overscroll-contain"
        tableClassName="h-auto min-w-[1480px] [&_tbody_tr]:h-auto [&_td]:py-2.5"
      >
        {orders.map((order) => {
          const clientName = n.client(order.clientId)
          const workName = n.work(order.workId)
          const serviceName = n.serviceType(order.serviceTypeId)
          const providerName = n.provider(order.mainProviderId)

          return (
            <TableRow key={order.id}>
              <TableCell className="font-medium">{order.orderNumber}</TableCell>
              <TableCell className="max-w-52 truncate" title={clientName}>{clientName}</TableCell>
              <TableCell className="max-w-72 truncate" title={workName}>{workName}</TableCell>
              <TableCell className="max-w-56 truncate" title={serviceName}>{serviceName}</TableCell>
              <TableCell>{formatDate(order.scheduledDate)}</TableCell>
              <TableCell>{Number(order.totalAmount || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</TableCell>
              <TableCell className="max-w-48 truncate" title={providerName}>{providerName}</TableCell>
              <TableCell>{n.vehicle(order.vehicleId)}</TableCell>
              <TableCell><StatusBadge status={order.status} /></TableCell>
              <TableCell>
                <div className="flex flex-nowrap gap-1">
                  <Button asChild size="sm" variant="outline"><Link href={`/ordens-servico/${order.id}`}>Detalhes</Link></Button>
                  {!readOnly ? <>
                    <Button size="sm" variant="outline" onClick={() => openSheet("order", { id: order.id })}>Editar</Button>
                    <Button size="sm" variant="outline" onClick={() => duplicate(order)}>Duplicar</Button>
                    <Button size="sm" variant="outline" onClick={() => updateStatus(order, "Finalizada")}>Finalizar</Button>
                    {canDelete ? <Button size="sm" variant="destructive" onClick={() => deleteOrder(order)}>Excluir</Button> : null}
                  </> : null}
                </div>
              </TableCell>
            </TableRow>
          )
        })}
      </DataTable>
    </SectionCard>
  )
}

function orderPhotoSlots(orderType: ServiceOrderKind, executionPoints: OrderExecutionPoint[]) {
  const storableExecutionPoints = executionPoints.filter((point) => canStorePhotoScope(point.id))
  if (orderType === "obra" && storableExecutionPoints.length) {
    return storableExecutionPoints.flatMap((point) => REQUIRED_PHOTO_CATEGORIES.map((category) => ({
      category,
      equipmentId: point.id,
      label: `${category} - ${point.label}`,
      equipmentLabel: point.label,
      environment: `${point.local} | ${point.floor}`,
      required: true,
    })))
  }
  if (orderType !== "pmoc") return requiredOrderPhotos(orderType, executionPoints)
  return executionPoints.flatMap((point) => PHOTO_CATEGORIES.map((category) => ({
    category,
    equipmentId: point.id,
    label: `${category} - ${point.label}`,
    equipmentLabel: point.label,
    environment: point.environment,
    required: REQUIRED_PHOTO_CATEGORIES.includes(category),
  })))
}

function OrdersMiniTable({ state, orders }: { state: OperationalState; orders: ServiceOrder[] }) {
  const n = names(state)
  return <DataTable headers={["OS", "Cliente", "Obra", "Tipo", "Data", "Valor", "Status", "Acoes"]} empty={!orders.length}>{orders.map((order) => <TableRow key={order.id}><TableCell>{order.orderNumber}</TableCell><TableCell>{n.client(order.clientId)}</TableCell><TableCell>{n.work(order.workId)}</TableCell><TableCell>{n.serviceType(order.serviceTypeId)}</TableCell><TableCell>{formatDate(order.scheduledDate)}</TableCell><TableCell>{Number(order.totalAmount || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</TableCell><TableCell><StatusBadge status={order.status} /></TableCell><TableCell><Button asChild size="sm" variant="outline"><Link href={`/ordens-servico/${order.id}`}>Ver OS</Link></Button></TableCell></TableRow>)}</DataTable>
}

const calendarHours = Array.from({ length: 24 }, (_, index) => index)
const calendarDayNames = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"]

function localDateFromIso(value?: string) {
  const [year, month, day] = calendarDateKey(value).split("-").map(Number)
  return new Date(year || new Date().getFullYear(), (month || 1) - 1, day || 1, 12, 0, 0)
}

function calendarDateKey(value?: string) {
  const text = String(value || today()).trim()
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const br = text.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (br) return `${br[3]}-${br[2]}-${br[1]}`
  return today()
}

function isoFromLocalDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function addCalendarDays(value: string, days: number) {
  const date = localDateFromIso(value)
  date.setDate(date.getDate() + days)
  return isoFromLocalDate(date)
}

function startOfCalendarWeek(value: string) {
  const date = localDateFromIso(value)
  const offset = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - offset)
  return isoFromLocalDate(date)
}

function timeToMinutes(value?: string) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/)
  if (!match) return 8 * 60
  return Number(match[1]) * 60 + Number(match[2])
}

function timeFromDateTime(value?: string) {
  const match = String(value || "").match(/[T\s](\d{2}):(\d{2})/)
  return match ? `${match[1]}:${match[2]}` : ""
}

function calendarOrderStartTime(order: ServiceOrder) {
  return order.scheduledStartTime || timeFromDateTime(order.scheduledDate) || "08:00"
}

function calendarOrderEndTime(order: ServiceOrder) {
  return order.scheduledEndTime || ""
}

function calendarOrderKind(order: ServiceOrder) {
  if (order.orderType === "pmoc") return "pmoc"
  if (order.orderType === "servicos") return order.serviceCategory || "Servicos diversos"
  return "obra"
}

function calendarOrderLabel(order: ServiceOrder) {
  if (order.orderType === "pmoc") return "PMOC"
  if (order.orderType === "servicos") return serviceCategoryLabel(order.serviceCategory) || "Serviços diversos"
  return "Obra"
}

function calendarOrderColors(order: ServiceOrder) {
  const key = calendarOrderKind(order)
  if (key === "pmoc") return { background: "#22c55e", border: "#15803d", color: "#062e16" }
  if (key === "Instalacao") return { background: "#facc15", border: "#ca8a04", color: "#422006" }
  if (key === "Manutencao Preventiva") return { background: "#38bdf8", border: "#0284c7", color: "#082f49" }
  if (key === "Manutencao Corretiva") return { background: "#fb7185", border: "#e11d48", color: "#4c0519" }
  if (key === "Visita Tecnica") return { background: "#a78bfa", border: "#7c3aed", color: "#2e1065" }
  if (order.orderType === "servicos") return { background: "#f97316", border: "#c2410c", color: "#431407" }
  return { background: "#818cf8", border: "#4f46e5", color: "#111827" }
}

function calendarFilterMatch(order: ServiceOrder, filter: string) {
  if (filter === "todos") return true
  if (filter === "obra") return order.orderType === "obra"
  if (filter === "pmoc") return order.orderType === "pmoc"
  if (filter === "servicos") return order.orderType === "servicos"
  return order.orderType === "servicos" && order.serviceCategory === filter
}

function resolvedCalendarKind(state: OperationalState, order: ServiceOrder) {
  const work = state.works.find((item) => item.id === order.workId)
  const text = [order.orderType, order.serviceCategory, order.description, order.notes, work?.type, work?.name].join(" ").toLowerCase()
  if (order.orderType === "pmoc" || text.includes("pmoc")) return "pmoc"
  if (order.orderType === "servicos" || text.includes("servicos diversos") || text.includes("serviços diversos")) return order.serviceCategory || "Servicos diversos"
  return "obra"
}

function resolvedCalendarFilterMatch(state: OperationalState, order: ServiceOrder, filter: string) {
  const key = resolvedCalendarKind(state, order)
  if (filter === "todos") return true
  if (filter === "obra") return key === "obra"
  if (filter === "pmoc") return key === "pmoc"
  if (filter === "servicos") return key !== "obra" && key !== "pmoc"
  return key === filter
}

function resolvedCalendarOrderLabel(state: OperationalState, order: ServiceOrder) {
  const key = resolvedCalendarKind(state, order)
  if (key === "pmoc") return "PMOC"
  if (key !== "obra") return serviceCategoryLabel(order.serviceCategory) || "Serviços diversos"
  return "Obra"
}

function resolvedCalendarOrderColors(state: OperationalState, order: ServiceOrder) {
  const key = resolvedCalendarKind(state, order)
  if (key === "pmoc") return { background: "#22c55e", border: "#15803d", color: "#062e16" }
  if (key === "Instalacao") return { background: "#facc15", border: "#ca8a04", color: "#422006" }
  if (key === "Manutencao Preventiva") return { background: "#38bdf8", border: "#0284c7", color: "#082f49" }
  if (key === "Manutencao Corretiva") return { background: "#fb7185", border: "#e11d48", color: "#4c0519" }
  if (key === "Visita Tecnica") return { background: "#a78bfa", border: "#7c3aed", color: "#2e1065" }
  if (key === "Servicos diversos") return { background: "#f97316", border: "#c2410c", color: "#431407" }
  return { background: "#818cf8", border: "#4f46e5", color: "#111827" }
}

function OrdersCalendar({
  state,
  orders,
  mode,
  setMode,
  selectedDate,
  setSelectedDate,
  filter,
  setFilter,
}: {
  state: OperationalState
  orders: ServiceOrder[]
  mode: "day" | "week"
  setMode: (mode: "day" | "week") => void
  selectedDate: string
  setSelectedDate: (date: string) => void
  filter: string
  setFilter: (filter: string) => void
}) {
  const n = names(state)
  const weekStart = startOfCalendarWeek(selectedDate)
  const days = mode === "day" ? [selectedDate] : Array.from({ length: 7 }, (_, index) => addCalendarDays(weekStart, index))
  const filteredOrders = orders
    .filter((order) => order.scheduledDate && days.includes(calendarDateKey(order.scheduledDate)))
    .filter((order) => resolvedCalendarFilterMatch(state, order, filter))
    .sort((a, b) => `${calendarDateKey(a.scheduledDate)}${a.scheduledStartTime}`.localeCompare(`${calendarDateKey(b.scheduledDate)}${b.scheduledStartTime}`))
  const monthTitle = localDateFromIso(selectedDate).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
  const step = mode === "day" ? 1 : 7
  const filters = [
    { value: "todos", label: "Todos" },
    { value: "obra", label: "Obra" },
    { value: "pmoc", label: "PMOC" },
    { value: "servicos", label: "Serviços diversos" },
    ...diverseServiceCategoryOptions,
  ]

  function dayOrders(day: string) {
    return filteredOrders.filter((order) => calendarDateKey(order.scheduledDate) === day)
  }

  function eventStyle(order: ServiceOrder, index: number, total: number) {
    const start = Math.max(0, timeToMinutes(calendarOrderStartTime(order)))
    const endTime = calendarOrderEndTime(order)
    const rawEnd = endTime ? timeToMinutes(endTime) : start + 60
    const end = Math.min(24 * 60, Math.max(start + 45, rawEnd))
    const top = (start / 60) * 64
    const height = Math.max(38, ((end - start) / 60) * 64 - 4)
    const width = mode === "day" ? `${Math.max(18, 98 / Math.max(total, 1))}%` : "calc(100% - 8px)"
    const left = mode === "day" ? `${(index * 98) / Math.max(total, 1)}%` : "4px"
    return { top, height, width, left, ...resolvedCalendarOrderColors(state, order) }
  }

  return (
    <SectionCard title="Agenda de OS" description="Visualização por dia ou semana, com cores por tipo de OS e categoria dos serviços diversos.">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setSelectedDate(addCalendarDays(selectedDate, -step))}>Anterior</Button>
          <Button variant="outline" size="sm" onClick={() => setSelectedDate(today())}>Hoje</Button>
          <Button variant="outline" size="sm" onClick={() => setSelectedDate(addCalendarDays(selectedDate, step))}>Próximo</Button>
          <div className="ml-2 text-lg font-semibold capitalize">{monthTitle}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-[210px]"><SelectValue /></SelectTrigger>
            <SelectContent>{filters.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
          </Select>
          <div className="rounded-md border p-1">
            <Button size="sm" variant={mode === "day" ? "default" : "ghost"} onClick={() => setMode("day")}>Dia</Button>
            <Button size="sm" variant={mode === "week" ? "default" : "ghost"} onClick={() => setMode("week")}>Semana</Button>
          </div>
        </div>
      </div>
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        {filters.slice(1).map((item) => {
          const sample = { orderType: item.value === "obra" ? "obra" : item.value === "pmoc" ? "pmoc" : "servicos", serviceCategory: item.value } as ServiceOrder
          const colors = calendarOrderColors(sample)
          return <span key={item.value} className="inline-flex items-center gap-1 rounded-full border px-2 py-1"><span className="h-2.5 w-2.5 rounded-full" style={{ background: colors.background }} />{item.label}</span>
        })}
      </div>
      <div className="overflow-auto rounded-lg border bg-background">
        <div className="min-w-[760px]">
          <div className="grid border-b bg-muted/40" style={{ gridTemplateColumns: `72px repeat(${days.length}, minmax(0, 1fr))` }}>
            <div className="border-r p-3 text-xs font-medium text-muted-foreground">Hora</div>
            {days.map((day) => {
              const date = localDateFromIso(day)
              const isToday = day === today()
              return (
                <button key={day} className={`border-r p-3 text-left last:border-r-0 ${isToday ? "bg-primary/10" : ""}`} onClick={() => { setSelectedDate(day); setMode("day") }}>
                  <div className="text-xs uppercase text-muted-foreground">{calendarDayNames[date.getDay()]}</div>
                  <div className="text-xl font-semibold">{date.getDate()}</div>
                </button>
              )
            })}
          </div>
          <div className="grid" style={{ gridTemplateColumns: `72px repeat(${days.length}, minmax(0, 1fr))` }}>
            <div className="border-r">
              {calendarHours.map((hour) => <div key={hour} className="h-16 border-b px-3 pt-1 text-xs text-muted-foreground">{String(hour).padStart(2, "0")}:00</div>)}
            </div>
            {days.map((day) => {
              const items = dayOrders(day)
              return (
                <div key={day} className="relative border-r last:border-r-0" style={{ height: calendarHours.length * 64 }}>
                  {calendarHours.map((hour) => <div key={hour} className="h-16 border-b" />)}
                  {items.map((order, index) => {
                    const style = eventStyle(order, index, items.length)
                    return (
                      <Link
                        key={order.id}
                        href={`/ordens-servico/${order.id}`}
                        className="absolute overflow-hidden rounded-md border p-2 text-xs shadow-sm transition hover:brightness-95"
                        style={{ top: style.top, height: style.height, width: style.width, left: style.left, background: style.background, borderColor: style.border, color: style.color }}
                        title={`${order.orderNumber} - ${n.client(order.clientId)}`}
                      >
                        <div className="font-semibold leading-tight">{order.orderNumber} · {resolvedCalendarOrderLabel(state, order)}</div>
                        <div className="mt-1 line-clamp-2 font-medium">{n.client(order.clientId)}</div>
                        <div className="line-clamp-2 opacity-90">{order.description || n.serviceType(order.serviceTypeId)}</div>
                        <div className="mt-1 opacity-90">{calendarOrderStartTime(order)}{calendarOrderEndTime(order) ? ` - ${calendarOrderEndTime(order)}` : ""}</div>
                      </Link>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </SectionCard>
  )
}

export function OrderDetailPage({ id }: { id: string }) {
  const { user } = useAuth()
  const { state, commit, loading } = useOperationalStore(id)
  const order = state.serviceOrders.find((item) => item.id === id)
  const n = names(state)
  const { toast } = useToast()
  const [eventNote, setEventNote] = useState("")
  const [signature, setSignature] = useState({ name: "", document: "", text: "", rating: "5", notes: "" })
  const executionPoints = useMemo(() => order ? orderExecutionTree(state, order) : [], [state, order])
  const visibleNotes = order ? cleanOrderSelectionNotes(order.notes) || "-" : "-"
  useEffect(() => {
    let active = true
    async function refreshEvents() {
      try {
        const response = await fetch(`/api/ordens-servico/${id}/eventos`, { cache: "no-store" })
        if (!response.ok) return
        const payload = await response.json()
        if (!active || !Array.isArray(payload.events)) return
        const refreshedEvents = payload.events.map((event: ServiceOrderEvent) => ({ ...event, serviceOrderId: id }))
        commit((current) => ({
          ...current,
          serviceOrderEvents: [...refreshedEvents, ...current.serviceOrderEvents.filter((event) => event.serviceOrderId !== id)],
          serviceOrders: payload.order?.id
            ? current.serviceOrders.map((item) => item.id === id ? { ...item, status: payload.order.status || item.status, updatedAt: payload.order.updated_at || item.updatedAt, finishedAt: payload.order.finished_at || item.finishedAt } : item)
            : current.serviceOrders,
        }), { persist: false } as any)
      } catch {
        // Atualizacao silenciosa: a tela principal continua funcionando mesmo se a rede oscilar.
      }
    }
    refreshEvents()
    const timer = window.setInterval(refreshEvents, 2000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [id])
  if (loading) return <PageShell title="Carregando OS" description="Buscando os dados e as fotos no Supabase."><Button asChild variant="outline"><Link href="/ordens-servico">Voltar</Link></Button></PageShell>
  if (!order) return <PageShell title="OS nao encontrada" description="A ordem de servico nao foi encontrada ou nao pertence a empresa vinculada a este usuario."><Button asChild><Link href="/ordens-servico">Voltar</Link></Button></PageShell>
  const checklist = state.checklistItems.filter((item) => item.serviceOrderId === id)
  const files = state.serviceOrderFiles.filter((item) => item.serviceOrderId === id)
  const photoRequirements = requiredOrderPhotos(order.orderType || "obra", executionPoints)
  const photoSlots = orderPhotoSlots(order.orderType || "obra", executionPoints)
  const osPhotos = files.filter((file) => PHOTO_CATEGORIES.includes(file.category as OrderPhotoCategory))
  const allowsMultipleEvidence = order.orderType === "obra" || order.orderType === "servicos"
  const readOnlyClient = user?.role === "client"
  const events = state.serviceOrderEvents.filter((item) => item.serviceOrderId === id)
  const responsibleProvider = state.providers.find((provider) => provider.id === order.mainProviderId)
  const linkedWorkPoint = state.workPoints.find((point) => point.id === order.pointId)
  const infrastructureRows: Array<[string, React.ReactNode]> = order.orderType === "obra"
    ? [["Medida da Infra", linkedWorkPoint?.infrastructureMeasure || "-"], ["Confirmação da Medida", linkedWorkPoint?.measurementConfirmation || "-"]]
    : []

  function setChecklist(item: ChecklistItem, done: boolean) {
    commit((current) => ({ ...current, checklistItems: current.checklistItems.map((check) => check.id === item.id ? { ...check, status: done ? "Concluida" as any : "Pendente", completedAt: done ? nowIso() : "", updatedAt: nowIso() } : check), auditLogs: appendAudit(current, "service_order", id, "Checklist", `${item.taskName} atualizado`) }))
  }
  async function addEvent(stepName: string, status = order.status) {
    if (events.some((event) => event.stepName === stepName)) {
      toast({ title: "Etapa ja registrada", description: "Cada botao de execucao pode ser registrado apenas uma vez.", variant: "destructive" })
      return
    }
    if (stepName === "Finalizar servico") {
      if (!eventNote.trim()) {
        toast({ title: "Observacao obrigatoria", description: "Informe a observacao do evento antes de finalizar o servico.", variant: "destructive" })
        return
      }
      const missingPhotos = photoRequirements
        .filter((requirement) => !hasRequiredOrderPhoto(files, requirement.category, requirement.equipmentId, order.orderType || "obra"))
        .map((requirement) => requirement.label)
      if (missingPhotos.length) {
        toast({ title: "Fotos pendentes", description: `Envie as fotos obrigatorias: ${missingPhotos.join(", ")}.`, variant: "destructive" })
        return
      }
    }
    const timestamp = nowIso()
    const event = { id: makeId("event"), serviceOrderId: id, stepName, status, providerId: order.mainProviderId, eventDatetime: timestamp, latitude: "", longitude: "", notes: eventNote.trim(), fileId: "", createdAt: timestamp }
    try {
      await saveServiceOrderEvent({ orderId: id, event, status, finishedAt: stepName === "Finalizar servico" ? timestamp : "" })
    } catch (error) {
      toast({ title: "Erro ao registrar etapa", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" })
      return
    }
    commit((current) => ({ ...current, serviceOrderEvents: [event, ...current.serviceOrderEvents.filter((item) => item.id !== event.id)], serviceOrders: current.serviceOrders.map((item) => item.id === id ? { ...item, status, updatedAt: timestamp, finishedAt: stepName === "Finalizar servico" ? timestamp : item.finishedAt } : item), auditLogs: appendAudit(current, "service_order", id, "Execucao", `${stepName} registrado`) }), { persist: false } as any)
    setEventNote("")
  }
  async function resetExecution() {
    if (!window.confirm("Resetar esta OS? Todos os horarios e etapas de execucao serao apagados e o status voltara para Agendada.")) return
    const timestamp = nowIso()
    const resetStatus = normalizeStatus("Agendada")
    try {
      await resetServiceOrderExecution({ orderId: id, status: resetStatus })
    } catch (error) {
      toast({ title: "Erro ao resetar OS", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" })
      return
    }
    commit((current) => ({
      ...current,
      serviceOrderEvents: current.serviceOrderEvents.filter((event) => event.serviceOrderId !== id),
      serviceOrders: current.serviceOrders.map((item) => item.id === id ? { ...item, status: resetStatus, updatedAt: timestamp, finishedAt: "", cancelledAt: "", pauseReason: "", cancellationReason: "", partialReason: "" } : item),
      auditLogs: appendAudit(current, "service_order", id, "Reset execucao", `${order.orderNumber} voltou para Agendada`),
    }), { persist: false } as any)
    toast({ title: "OS resetada", description: "Horarios limpos e status retornou para Agendada." })
  }
  async function addFiles(category: OrderPhotoCategory, selectedFiles: File[], equipmentId = "") {
    if (!selectedFiles.length) return
    try {
      const filesToUpload = allowsMultipleEvidence ? selectedFiles : selectedFiles.slice(0, 1)
      const savedFiles: ServiceOrderFile[] = []
      for (const file of filesToUpload) {
        savedFiles.push(await uploadServiceOrderFile({ serviceOrderId: id, category, file, uploadedBy: order.mainProviderId, equipmentId, keepPrevious: allowsMultipleEvidence }))
      }
      const confirmedPhotos = await fetchServiceOrderPhotos(id)
      if (savedFiles.some((savedFile) => !confirmedPhotos.some((photo) => photo.id === savedFile.id))) throw new Error("Uma ou mais fotos nao foram confirmadas no banco. Tente novamente.")
      commit((current) => ({ ...current, serviceOrderFiles: [...confirmedPhotos, ...current.serviceOrderFiles.filter((item) => item.serviceOrderId !== id)], auditLogs: appendAudit(current, "service_order", id, "Evidencia", `${savedFiles.length} foto(s) salva(s)`) }), { persist: false } as any)
      toast({ title: "Fotos salvas", description: `${savedFiles.length} foto(s) vinculada(s) a OS.` })
    } catch (error) {
      toast({ title: "Erro ao salvar foto", description: error instanceof Error ? error.message : "Tente novamente.", variant: "destructive" })
    }
  }
  function saveSignature() {
    if (!signature.name) return
    commit((current) => ({ ...current, serviceOrderSignatures: [{ id: makeId("sign"), serviceOrderId: id, responsibleName: signature.name, responsibleDocument: signature.document, signatureText: signature.text, rating: signature.rating, customerNotes: signature.notes, createdAt: nowIso() }, ...current.serviceOrderSignatures], auditLogs: appendAudit(current, "service_order", id, "Aceite", `Aceite coletado de ${signature.name}`) }))
    toast({ title: "Aceite salvo" })
  }
  function generateReport(options: { hideTotalValue?: boolean } = {}) {
    const win = window.open("", "_blank")
    if (!win) {
      toast({ title: "Pop-up bloqueado", description: "Permita pop-ups para gerar o relatorio em PDF.", variant: "destructive" })
      return
    }
    const scheduledTime = [order.scheduledStartTime, order.scheduledEndTime].filter(Boolean).join(" - ") || "-"
    const savedSignature = state.serviceOrderSignatures.find((item) => item.serviceOrderId === id)
    const clientSignerName = savedSignature?.responsibleName || order.customerResponsibleName || "____________________________"
    const technicianName = n.provider(order.mainProviderId) === "-" ? "____________________________" : n.provider(order.mainProviderId)
    const technicalResponsibleName = n.provider(order.supervisorId) === "-" ? "____________________________" : n.provider(order.supervisorId)
    const reportLegalReference = order.orderType === "pmoc"
      ? PMOC_LEGAL_REFERENCE
      : "Portaria do Ministério da Saúde nº 3.523, de 28 de agosto de 1998."
    const generalRows: Array<[string, React.ReactNode]> = [["Cliente", n.client(order.clientId)], ["Obra/Local", n.work(order.workId)], ["Categoria", order.orderType === "servicos" ? serviceCategoryLabel(order.serviceCategory) : "-"], ["Data agendada", formatDate(order.scheduledDate)], ["Horario previsto", scheduledTime], ["OS criada em", dateTime(order.createdAt)], ["Conclusao", order.finishedAt ? dateTime(order.finishedAt) : "-"], ["Pavimento", n.floor(order.floorId)], ["Final/Ambiente", n.environment(order.environmentId)], ["Ponto", n.point(order.pointId)], ...infrastructureRows, ["Endereco", orderAddress(state, order)], ["Responsavel", responsibleProvider?.fullName || "-"], ["Telefone", responsibleProvider?.phone || "-"], ["Tipo", n.serviceType(order.serviceTypeId)], ["Prioridade", order.priority], ["Forma de pagamento", (order as any).paymentMethod || "-"], ["Tipo de pagamento", (order as any).paymentType || "-"], ["Prazo", (order as any).paymentTerm || "-"], ["Vencimento", formatDate((order as any).paymentDueDate)], ["Instrucoes financeiras", (order as any).financialNotes || "-"]]
    if (!options.hideTotalValue) generalRows.push(["Valor total", Number(order.totalAmount || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })])
    generalRows.push(["Descri\u00e7\u00e3o dos servi\u00e7os", order.description || "-"], ["Equipe", n.provider(order.mainProviderId)], ["Veiculo", n.vehicle(order.vehicleId)], ["Observacoes", visibleNotes])
    const rows = (items: Array<[string, React.ReactNode]>) => items.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join("")
    const eventRows = events.length
      ? events.map((event) => `<tr><td>${escapeHtml(dateTime(event.eventDatetime))}</td><td>${escapeHtml(eventStepLabel(event))}</td><td>${escapeHtml(event.status)}</td><td>${escapeHtml(n.provider(event.providerId))}</td><td>${escapeHtml(event.notes)}</td></tr>`).join("")
      : `<tr><td colspan="5">Nenhum registro encontrado.</td></tr>`
    const executionHtml = executionPoints.length
      ? executionPoints.map((point) => {
          const serviceRows = point.services.length
            ? point.services.map((service) => {
                return `<tr><td>${escapeHtml(service.name)}</td></tr>`
              }).join("")
            : `<tr><td>Nenhum servico cadastrado neste ponto.</td></tr>`
          const detail = serviceDetailEvent(events, point.id)?.notes || "-"
          return `<section><h3>${escapeHtml(point.label)}</h3><p>${escapeHtml(`${point.local} | ${point.floor} | ${point.final} | ${point.environment}`)}</p><p><strong>Detalhamento executado:</strong> ${escapeHtml(detail)}</p><table><thead><tr><th>Servico</th></tr></thead><tbody>${serviceRows}</tbody></table></section>`
        }).join("")
      : `<p>Nenhum ponto encontrado.</p>`
    const checklistRows = checklist.length
      ? checklist.map((item) => `<tr><td>${escapeHtml(item.taskName)}</td><td>${escapeHtml(item.required ? "Sim" : "Nao")}</td><td>${escapeHtml(item.status)}</td><td>${escapeHtml(n.provider(item.responsibleProviderId))}</td><td>${escapeHtml(item.requiresPhoto ? "Obrigatoria" : "-")}</td><td>${escapeHtml(item.notes)}</td></tr>`).join("")
      : `<tr><td colspan="6">Nenhum checklist encontrado.</td></tr>`
    const fileRows = osPhotos.length
      ? osPhotos.map((file) => {
          const caption = buildServiceOrderPhotoCaption({ orderType: order.orderType || "obra", notes: file.notes, points: executionPoints, equipment: state.clientEquipment })
          const description = [caption.title, ...caption.details].join(" | ")
          return `<tr><td>${escapeHtml(file.category)}</td><td>${escapeHtml(description)}</td><td>${escapeHtml(file.fileName)}</td><td>${escapeHtml(file.fileType)}</td><td>${escapeHtml(dateTime(file.createdAt))}</td><td>${file.fileUrl ? `<a href="${escapeHtml(file.fileUrl)}">Abrir arquivo</a>` : "-"}</td></tr>`
        }).join("")
      : `<tr><td colspan="6">Nenhuma evidencia encontrada.</td></tr>`
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Relatorio ${escapeHtml(order.orderNumber)}</title><style>
      @page{margin:13mm}body{font-family:Arial,sans-serif;color:#111827;font-size:11px;line-height:1.35}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:15px 0 6px;border-bottom:1px solid #d9e2ef;padding-bottom:5px;break-after:avoid-page}h3{font-size:13px;margin:11px 0 4px;break-after:avoid-page}.ordinance{font-weight:700;margin:3px 0 5px}.muted{color:#52637a;margin:0 0 12px}table{width:100%;border-collapse:collapse;margin:6px 0 10px}thead{display:table-header-group}tr{break-inside:avoid-page}th,td{border:1px solid #d9e2ef;padding:5px;text-align:left;vertical-align:top}td{white-space:pre-wrap;overflow-wrap:anywhere}th{background:#f4f7fb;font-weight:700}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.box{border:1px solid #d9e2ef;border-radius:6px;padding:8px}.box span{display:block;color:#52637a;font-size:10px;margin-bottom:3px}.box strong{font-size:12px}.signatures{margin-top:20px;break-inside:avoid-page}.signatures-law{text-align:center;margin-bottom:8px}.signature-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.signature-card{text-align:center;break-inside:avoid-page}.signature-space{height:55px}.signature-line{border-top:1px solid #111827;margin-bottom:6px}.signature-card strong,.signature-card span{display:block}.signature-card span{font-size:10px;margin-top:4px}.print-note{margin-top:18px;color:#52637a;font-size:10px}@media print{button{display:none}}
    </style></head><body>
      <h1>${escapeHtml(order.orderNumber)} - ${escapeHtml(n.client(order.clientId))}</h1>
      <p class="ordinance">${escapeHtml(reportLegalReference)}</p>
      <p class="muted">${escapeHtml(n.work(order.workId))} | ${escapeHtml(n.serviceType(order.serviceTypeId))} | Data: ${escapeHtml(formatDate(order.scheduledDate))} | Horario: ${escapeHtml(scheduledTime)} | Status: ${escapeHtml(order.status)}</p>
      <h2>Dados Gerais</h2>
      <table><tbody>${rows(generalRows)}</tbody></table>
      <h2>Execucao</h2>${executionHtml}
      <h2>Linha do Tempo</h2><table><thead><tr><th>Data/hora</th><th>Etapa</th><th>Status</th><th>Prestador</th><th>Observacao</th></tr></thead><tbody>${eventRows}</tbody></table>
      <h2>Checklist</h2><table><thead><tr><th>Tarefa</th><th>Obrigatoria</th><th>Status</th><th>Responsavel</th><th>Foto</th><th>Observacao</th></tr></thead><tbody>${checklistRows}</tbody></table>
      <h2>Fotos e Evidencias</h2><table><thead><tr><th>Categoria</th><th>Vinculo</th><th>Arquivo</th><th>Tipo</th><th>Data</th><th>Link</th></tr></thead><tbody>${fileRows}</tbody></table>
      <section class="signatures">
        <p class="ordinance signatures-law">${escapeHtml(reportLegalReference)}</p>
        <h2>Vistos e carimbos</h2>
        <div class="signature-grid">
          <div class="signature-card"><div class="signature-space"></div><div class="signature-line"></div><strong>Carimbo/Visto do Cliente</strong><span>Nome: ${escapeHtml(clientSignerName)}</span><span>Data: ____/____/______</span></div>
          <div class="signature-card"><div class="signature-space"></div><div class="signature-line"></div><strong>Visto do Tecnico</strong><span>Nome: ${escapeHtml(technicianName)}</span><span>Data: ____/____/______</span></div>
          <div class="signature-card"><div class="signature-space"></div><div class="signature-line"></div><strong>Visto do Responsavel Tecnico</strong><span>Nome: ${escapeHtml(technicalResponsibleName)}</span><span>Data: ____/____/______</span></div>
        </div>
      </section>
      <p class="print-note">Relatorio gerado em ${escapeHtml(dateTime(nowIso()))}.</p>
      <script>window.onload=function(){setTimeout(function(){window.print()},250)}</script>
    </body></html>`
    win.document.write(html)
    win.document.close()
  }

  return (
    <PageShell title={`${order.orderNumber} - ${n.client(order.clientId)}`} description={`${n.work(order.workId)} | ${n.serviceType(order.serviceTypeId)} | ${formatDate(order.scheduledDate)}`} actions={<><Button asChild variant="outline"><Link href="/ordens-servico">Voltar</Link></Button>{!readOnlyClient ? <><Button variant="outline" onClick={() => generateReport()}>Gerar Relatorio</Button><Button variant="outline" onClick={() => generateReport({ hideTotalValue: true })}>Gerar sem valor</Button><Button variant="destructive" onClick={resetExecution}>Resetar execucao</Button></> : null}<Badge variant="outline">{order.status}</Badge></>}>
      <Tabs defaultValue="dados">
        <TabsList className="flex flex-wrap"><TabsTrigger value="dados">Dados gerais</TabsTrigger><TabsTrigger value="execucao">Execucao</TabsTrigger><TabsTrigger value="checklist">Checklist</TabsTrigger><TabsTrigger value="fotos">Fotos e evidencias</TabsTrigger><TabsTrigger value="aceite">Assinatura e aceite</TabsTrigger><TabsTrigger value="historico">Historico</TabsTrigger></TabsList>
        <TabsContent value="dados"><SectionCard title="Dados gerais"><DetailGrid rows={[["Cliente", n.client(order.clientId)], ["Obra/Local", n.work(order.workId)], ["Categoria", order.orderType === "servicos" ? serviceCategoryLabel(order.serviceCategory) : "-"], ["Pavimento", n.floor(order.floorId)], ["Final/Ambiente", n.environment(order.environmentId)], ["Ponto", n.point(order.pointId)], ...infrastructureRows, ["Endereco", orderAddress(state, order)], ["Responsavel", responsibleProvider?.fullName || "-"], ["Telefone", responsibleProvider?.phone || "-"], ["Tipo", n.serviceType(order.serviceTypeId)], ["Prioridade", order.priority], ["Valor total", Number(order.totalAmount || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })], ["Forma de pagamento", (order as any).paymentMethod || "-"], ["Tipo de pagamento", (order as any).paymentType || "-"], ["Prazo", (order as any).paymentTerm || "-"], ["Vencimento", formatDate((order as any).paymentDueDate)], ["Instrucoes financeiras", (order as any).financialNotes || "-"], ["Equipe", n.provider(order.mainProviderId)], ["Veiculo", n.vehicle(order.vehicleId)], ["Descri\u00e7\u00e3o dos servi\u00e7os", order.description || "-"], ["Observacoes", visibleNotes]]} /></SectionCard></TabsContent>
        <TabsContent value="execucao"><SectionCard title="Linha do tempo">{!readOnlyClient ? <><TextAreaField label="Observacao do evento" value={eventNote} onChange={setEventNote} /><div className="my-3 flex flex-wrap gap-2">{fieldSteps.map(([label, status]) => {
          const done = events.some((event) => event.stepName === label)
          return <Button key={label} variant="outline" disabled={done} onClick={() => addEvent(label, normalizeStatus(status))}>{done ? `${label} registrado` : label}</Button>
        })}</div></> : null}
          <div className="mb-4 space-y-3 rounded-md border p-3">
            <h3 className="font-semibold">Pontos/equipamentos da execucao</h3>
            {executionPoints.map((point) => (
              <div key={point.id} className="rounded-md border p-3">
                <div className="font-medium">{point.label}</div>
                <div className="mt-1 text-sm text-muted-foreground">{point.local} | {point.floor} | {point.final} | {point.environment}</div>
                <div className="mt-3 rounded-md bg-muted/40 p-3 text-sm"><span className="font-medium">Detalhamento executado: </span>{serviceDetailEvent(events, point.id)?.notes || "-"}</div>
                <DataTable headers={["Servico"]} empty={!point.services.length}>
                  {point.services.map((service) => <TableRow key={`${point.id}-${service.id}`}><TableCell>{service.name}</TableCell></TableRow>)}
                </DataTable>
              </div>
            ))}
          </div>
          <DataTable headers={["Data/hora", "Etapa", "Status", "Prestador", "Observacao"]} empty={!events.length}>{events.map((event) => <TableRow key={event.id}><TableCell>{dateTime(event.eventDatetime)}</TableCell><TableCell>{eventStepLabel(event)}</TableCell><TableCell><StatusBadge status={event.status} /></TableCell><TableCell>{n.provider(event.providerId)}</TableCell><TableCell>{event.notes}</TableCell></TableRow>)}</DataTable></SectionCard></TabsContent>
        <TabsContent value="checklist"><SectionCard title="Checklist"><DataTable headers={["Tarefa", "Obrigatoria", "Status", "Responsavel", "Foto", "Observacao", ...(readOnlyClient ? [] : ["Acao"])]} empty={!checklist.length}>{checklist.map((item) => <TableRow key={item.id}><TableCell>{item.taskName}</TableCell><TableCell>{item.required ? "Sim" : "Nao"}</TableCell><TableCell><StatusBadge status={item.status} /></TableCell><TableCell>{n.provider(item.responsibleProviderId)}</TableCell><TableCell>{item.requiresPhoto ? "Obrigatoria" : "-"}</TableCell><TableCell>{item.notes}</TableCell>{!readOnlyClient ? <TableCell><Checkbox checked={String(item.status).includes("Conclu")} onCheckedChange={(checked) => setChecklist(item, Boolean(checked))} /></TableCell> : null}</TableRow>)}</DataTable></SectionCard></TabsContent>
        <TabsContent value="fotos"><SectionCard title="Fotos e evidencias da OS">
          {!readOnlyClient ? <div className="grid gap-3 md:grid-cols-2">
            {photoSlots.map((requirement) => {
              const photos = orderPhotoFiles(files, requirement.category, requirement.equipmentId)
              const key = `${requirement.category}:${requirement.equipmentId || "os"}`
              return <div key={key} className="rounded-md border p-3">
                <Label>{requirement.equipmentId ? `${requirement.category}: ${requirement.equipmentLabel}${"required" in requirement && !requirement.required ? " (opcional)" : ""}` : requirement.category}</Label>
                {requirement.environment ? <div className="mt-1 text-xs text-muted-foreground">{requirement.environment}</div> : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border bg-background px-4 text-sm font-medium shadow-sm hover:bg-accent">
                    <Camera className="h-4 w-4" />Tirar foto
                    <input className="sr-only" type="file" accept="image/*" capture="environment" onChange={(event) => {
                      const selected = Array.from(event.currentTarget.files || [])
                      event.currentTarget.value = ""
                      void addFiles(requirement.category, selected, requirement.equipmentId)
                    }} />
                  </label>
                  <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border bg-background px-4 text-sm font-medium shadow-sm hover:bg-accent">
                    <Images className="h-4 w-4" />{allowsMultipleEvidence ? "Escolher fotos" : "Escolher foto"}
                    <input className="sr-only" type="file" accept="image/*" multiple={allowsMultipleEvidence} onChange={(event) => {
                      const selected = Array.from(event.currentTarget.files || [])
                      event.currentTarget.value = ""
                      void addFiles(requirement.category, selected, requirement.equipmentId)
                    }} />
                  </label>
                </div>
                <div className="mt-2 text-sm text-muted-foreground">{photos.length ? `${photos.length} foto(s) confirmada(s) no banco` : "Nenhuma foto enviada"}</div>
              </div>
            })}
          </div> : null}
          {osPhotos.length ? <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {osPhotos.map((file) => {
              const caption = buildServiceOrderPhotoCaption({ orderType: order.orderType || "obra", notes: file.notes, points: executionPoints, equipment: state.clientEquipment })
              return <a key={`preview-${file.id}`} href={file.fileUrl} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-md border bg-background">
                <div className="aspect-[4/3] overflow-hidden bg-muted">
                  <img src={file.fileUrl} alt={`${file.category} - ${caption.title}`} className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]" />
                </div>
                <div className="p-3">
                  <div className="font-medium">{file.category}</div>
                  <div className="mt-2 text-sm font-medium">{caption.title}</div>
                  {caption.details.map((detail) => <div key={detail} className="mt-1 text-sm text-muted-foreground">{detail}</div>)}
                  <div className="mt-1 text-xs text-muted-foreground">{dateTime(file.createdAt)}</div>
                </div>
              </a>
            })}
          </div> : <p className="mb-4 text-sm text-muted-foreground">Nenhuma foto enviada nesta OS.</p>}
          <DataTable headers={["Categoria", "Vinculo da foto", "Arquivo", "Tipo", "Data", "Link"]} empty={!osPhotos.length}>{osPhotos.map((file) => {
            const caption = buildServiceOrderPhotoCaption({ orderType: order.orderType || "obra", notes: file.notes, points: executionPoints, equipment: state.clientEquipment })
            return <TableRow key={file.id}><TableCell>{file.category}</TableCell><TableCell><div className="font-medium">{caption.title}</div>{caption.details.map((detail) => <div key={detail} className="text-xs text-muted-foreground">{detail}</div>)}</TableCell><TableCell>{file.fileName}</TableCell><TableCell>{file.fileType}</TableCell><TableCell>{dateTime(file.createdAt)}</TableCell><TableCell>{file.fileUrl ? <a className="text-primary underline" href={file.fileUrl} target="_blank" rel="noreferrer">Abrir</a> : "-"}</TableCell></TableRow>
          })}</DataTable>
        </SectionCard></TabsContent>
        <TabsContent value="aceite"><SectionCard title="Assinatura e aceite">{readOnlyClient ? (() => {
          const saved = state.serviceOrderSignatures.find((item) => item.serviceOrderId === id)
          return saved ? <DetailGrid rows={[["Responsavel", saved.responsibleName], ["Documento", saved.responsibleDocument || "-"], ["Avaliacao", saved.rating || "-"], ["Observacao", saved.customerNotes || "-"], ["Registrado em", dateTime(saved.createdAt)]]} /> : <p className="text-sm text-muted-foreground">Nenhum aceite registrado nesta OS.</p>
        })() : <><div className="grid gap-4 md:grid-cols-2"><TextField label="Nome do responsavel" value={signature.name} onChange={(value) => setSignature({ ...signature, name: value })} /><TextField label="CPF/documento" value={signature.document} onChange={(value) => setSignature({ ...signature, document: value })} /><TextField label="Assinatura digital" value={signature.text} onChange={(value) => setSignature({ ...signature, text: value })} /><TextField label="Avaliacao" value={signature.rating} onChange={(value) => setSignature({ ...signature, rating: value })} /></div><TextAreaField label="Observacao do cliente" value={signature.notes} onChange={(value) => setSignature({ ...signature, notes: value })} /><SaveButton onClick={saveSignature}>Coletar assinatura</SaveButton></>}</SectionCard></TabsContent>
        <TabsContent value="historico"><AuditTable state={state} filter={["service_order"]} entityId={id} /></TabsContent>
      </Tabs>
    </PageShell>
  )
}

export function TeamProvidersPage() {
  const { state, commit } = useOperationalStore()
  const { sheet, setSheet, preset, openSheet } = useSheetWithPreset()
  const [query, setQuery] = useState("")
  const providers = state.providers.filter((item) => [item.fullName, item.role, item.status, item.city].join(" ").toLowerCase().includes(query.toLowerCase()))
  function deleteProvider(provider: Provider) {
    commit((current) => ({
      ...current,
      providers: current.providers.filter((item) => item.id !== provider.id),
      providerDocuments: current.providerDocuments.filter((item) => item.providerId !== provider.id),
      serviceOrders: current.serviceOrders.map((order) => ({
        ...order,
        mainProviderId: order.mainProviderId === provider.id ? "" : order.mainProviderId,
        helperProviderId: order.helperProviderId === provider.id ? "" : order.helperProviderId,
        supervisorId: order.supervisorId === provider.id ? "" : order.supervisorId,
        updatedAt: order.mainProviderId === provider.id || order.helperProviderId === provider.id || order.supervisorId === provider.id ? nowIso() : order.updatedAt,
      })),
      serviceOrderEvents: current.serviceOrderEvents.map((event) => event.providerId === provider.id ? { ...event, providerId: "" } : event),
      checklistItems: current.checklistItems.map((item) => item.responsibleProviderId === provider.id ? { ...item, responsibleProviderId: "", updatedAt: nowIso() } : item),
      vehicleUsage: current.vehicleUsage.map((usage) => usage.providerId === provider.id ? { ...usage, providerId: "" } : usage),
      vehicleChecklists: current.vehicleChecklists.map((checklist) => checklist.providerId === provider.id ? { ...checklist, providerId: "", updatedAt: nowIso() } : checklist),
      auditLogs: appendAudit(current, "provider", provider.id, "Excluido", `Prestador ${provider.fullName} excluido`),
    }))
  }
  return (
    <PageShell title="Equipe" description="Gerencie prestadores, agenda da equipe, historico e cargos." actions={<><Button onClick={() => openSheet("provider")}><Plus className="h-4 w-4" />Novo Prestador</Button><Button variant="outline" onClick={() => window.alert("Exportacao de prestadores simulada no MVP local.")}>Exportar lista</Button></>}>
      <Tabs defaultValue="prestadores">
        <TabsList><TabsTrigger value="prestadores">Prestadores</TabsTrigger><TabsTrigger value="agenda">Agenda da Equipe</TabsTrigger><TabsTrigger value="historico">Historico</TabsTrigger><TabsTrigger value="cargos">Cargos</TabsTrigger></TabsList>
        <Input className="my-4 max-w-md" placeholder="Filtrar por nome, cargo, status, cidade" value={query} onChange={(event) => setQuery(event.target.value)} />
        <TabsContent value="prestadores"><SectionCard title="Prestadores"><DataTable headers={["Nome", "Cargo", "Celular", "E-mail", "Status", "OS em andamento", "Acoes"]} empty={!providers.length}>{providers.map((provider) => <TableRow key={provider.id}><TableCell>{provider.fullName}</TableCell><TableCell>{provider.role}</TableCell><TableCell>{provider.phone}</TableCell><TableCell>{provider.email}</TableCell><TableCell><StatusBadge status={provider.status} /></TableCell><TableCell>{state.serviceOrders.filter((order) => order.mainProviderId === provider.id && String(order.status).includes("execu")).length}</TableCell><TableCell><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => openSheet("provider", { id: provider.id })}>Editar</Button><ConfirmInline label="Inativar" onConfirm={() => commit((current) => ({ ...current, providers: current.providers.map((item) => item.id === provider.id ? { ...item, status: "Inativo", updatedAt: nowIso() } : item), auditLogs: appendAudit(current, "provider", provider.id, "Inativado", `${provider.fullName} inativado`) }))} /><ConfirmInline label="Excluir" onConfirm={() => deleteProvider(provider)} /></div></TableCell></TableRow>)}</DataTable></SectionCard></TabsContent>
        <TabsContent value="agenda"><TeamAgenda state={state} /></TabsContent>
        <TabsContent value="historico"><TeamHistory state={state} /></TabsContent>
        <TabsContent value="cargos"><SectionCard title="Cargos operacionais"><DataTable headers={["Cargo", "Descricao", "Status", "Acoes"]}>{["Diretor", "Conselheira", "Instalador de ar-condicionado", "Auxiliar Administrativo", "Auxiliar de instalador", "Gerente Administrativo", "Limpeza", "Ajudante Geral"].map((role) => <TableRow key={role}><TableCell>{role}</TableCell><TableCell>Permissoes operacionais do cargo.</TableCell><TableCell><StatusBadge status="Ativo" /></TableCell><TableCell><Button size="sm" variant="outline" onClick={() => window.alert(`Edicao do cargo ${role} simulada no MVP local.`)}>Editar</Button></TableCell></TableRow>)}</DataTable></SectionCard></TabsContent>
      </Tabs>
      <QuickSheets state={state} commit={commit} sheet={sheet} setSheet={setSheet} preset={preset} />
    </PageShell>
  )
}

function TeamAgenda({ state }: { state: OperationalState }) {
  const n = names(state)
  return <SectionCard title="Agenda da Equipe"><DataTable headers={["Data", "Prestador", "OS", "Cliente", "Horario", "Status"]} empty={!state.serviceOrders.length}>{state.serviceOrders.map((order) => <TableRow key={order.id}><TableCell>{formatDate(order.scheduledDate)}</TableCell><TableCell>{n.provider(order.mainProviderId)}</TableCell><TableCell>{order.orderNumber}</TableCell><TableCell>{n.client(order.clientId)}</TableCell><TableCell>{order.scheduledStartTime}</TableCell><TableCell><StatusBadge status={order.status} /></TableCell></TableRow>)}</DataTable></SectionCard>
}

function TeamHistory({ state }: { state: OperationalState }) {
  return <SectionCard title="Produtividade por prestador"><DataTable headers={["Prestador", "OS finalizadas", "Tempo medio", "Atrasos", "Avaliacao"]}>{state.providers.map((provider) => <TableRow key={provider.id}><TableCell>{provider.fullName}</TableCell><TableCell>{state.serviceOrders.filter((order) => order.mainProviderId === provider.id && order.status === "Finalizada").length}</TableCell><TableCell>4h</TableCell><TableCell>{state.serviceOrders.filter((order) => order.mainProviderId === provider.id && order.scheduledDate < today() && order.status !== "Finalizada").length}</TableCell><TableCell>5.0</TableCell></TableRow>)}</DataTable></SectionCard>
}

function emptyVehicleChecklist(order?: ServiceOrder, vehicle?: Vehicle) {
  return {
    cleanlinessState: "",
    conservationState: "",
    frontRightTire: (vehicle?.frontRightTire || "Novo") as VehicleChecklist["frontRightTire"],
    frontLeftTire: (vehicle?.frontLeftTire || "Novo") as VehicleChecklist["frontLeftTire"],
    rearRightTire: (vehicle?.rearRightTire || "Novo") as VehicleChecklist["rearRightTire"],
    rearLeftTire: (vehicle?.rearLeftTire || "Novo") as VehicleChecklist["rearLeftTire"],
    mandatorySafetyItems: false,
    oilLevel: "",
    brakesTest: "",
    windshieldWipers: "",
    mirrors: "",
    lights: "",
    fuelLevel: "",
    notes: "",
    serviceOrderId: order?.id || "",
    vehicleId: order?.vehicleId || "",
    providerId: order?.mainProviderId || "",
  }
}

function VehicleChecklistForm({ state, commit, order, publicMode = false }: { state: OperationalState; commit: (updater: (state: OperationalState) => OperationalState) => void; order?: ServiceOrder; publicMode?: boolean }) {
  const n = names(state)
  const vehicle = order ? state.vehicles.find((item) => item.id === order.vehicleId) : undefined
  const existing = order ? state.vehicleChecklists.find((item) => item.serviceOrderId === order.id) : undefined
  const [form, setForm] = useState(() => existing || emptyVehicleChecklist(order, vehicle))

  useEffect(() => {
    setForm(existing || emptyVehicleChecklist(order, vehicle))
  }, [existing?.id, order?.id, vehicle?.id])

  if (!order) return <SectionCard title="Checklist do veiculo"><p className="text-sm text-muted-foreground">Nenhuma OS selecionada.</p></SectionCard>
  if (!order.vehicleId) return <SectionCard title="Checklist do veiculo"><AlertRow>Esta OS ainda nao tem veiculo vinculado. Vincule um veiculo na OS antes de enviar o checklist ao prestador.</AlertRow></SectionCard>

  function saveChecklist() {
    if (!order) return
    if (!form.cleanlinessState || !form.conservationState || !form.oilLevel || !form.brakesTest || !form.windshieldWipers || !form.mirrors || !form.lights || !form.fuelLevel) {
      window.alert("Preencha limpeza/conservacao, oleo, freios, limpador, retrovisores, luzes e combustivel.")
      return
    }
    const now = nowIso()
    const record: VehicleChecklist = {
      id: existing?.id || makeId("vcheck"),
      serviceOrderId: order.id,
      vehicleId: order.vehicleId,
      providerId: order.mainProviderId,
      cleanlinessState: form.cleanlinessState,
      conservationState: form.conservationState,
      frontRightTire: form.frontRightTire,
      frontLeftTire: form.frontLeftTire,
      rearRightTire: form.rearRightTire,
      rearLeftTire: form.rearLeftTire,
      mandatorySafetyItems: Boolean(form.mandatorySafetyItems),
      oilLevel: form.oilLevel,
      brakesTest: form.brakesTest,
      windshieldWipers: form.windshieldWipers,
      mirrors: form.mirrors,
      lights: form.lights,
      fuelLevel: form.fuelLevel,
      notes: form.notes,
      acceptedAt: existing?.acceptedAt || now,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    }
    commit((current) => ({
      ...current,
      vehicleChecklists: [record, ...current.vehicleChecklists.filter((item) => item.id !== record.id && item.serviceOrderId !== order.id)],
      auditLogs: appendAudit(current, "vehicle_checklist", record.id, existing ? "Atualizado" : "Criado", `Checklist do veiculo ${n.vehicle(order.vehicleId)} preenchido na ${order.orderNumber}`),
    }))
    window.alert("Checklist do veiculo salvo.")
  }

  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/campo/atendimento/${order.id}` : `/campo/atendimento/${order.id}`
  return (
    <SectionCard title="Checklist do veiculo" description="Preenchimento obrigatorio quando a OS for aceita pelo prestador.">
      <div className="mb-4 grid gap-3 rounded-md border p-3 text-sm md:grid-cols-2">
        <div><span className="text-muted-foreground">OS</span><div className="font-semibold">{order.orderNumber}</div></div>
        <div><span className="text-muted-foreground">Prestador</span><div className="font-semibold">{n.provider(order.mainProviderId)}</div></div>
        <div><span className="text-muted-foreground">Veiculo</span><div className="font-semibold">{n.vehicle(order.vehicleId)}</div></div>
        <div><span className="text-muted-foreground">Cliente</span><div className="font-semibold">{n.client(order.clientId)}</div></div>
      </div>
      {!publicMode ? <div className="mb-4 flex flex-wrap gap-2"><Button variant="secondary" onClick={() => navigator.clipboard?.writeText(shareUrl).then(() => window.alert("Link copiado."))}><Share2 className="h-4 w-4" />Compartilhar formulario completo</Button><Button asChild variant="outline"><Link href={shareUrl} target="_blank">Abrir formulario publico</Link></Button></div> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <TextAreaField label="Estado de limpeza" value={form.cleanlinessState} onChange={(value) => setForm({ ...form, cleanlinessState: value })} placeholder="Ex.: limpo, sujo, precisa lavar..." />
        <TextAreaField label="Estado de conservacao" value={form.conservationState} onChange={(value) => setForm({ ...form, conservationState: value })} placeholder="Ex.: sem avarias, amassado, risco lateral..." />
        <SelectField label="Pneu dianteiro direito" value={form.frontRightTire} onChange={(value) => setForm({ ...form, frontRightTire: value as any })} options={tireOptions.map((value) => ({ value, label: value }))} />
        <SelectField label="Pneu dianteiro esquerdo" value={form.frontLeftTire} onChange={(value) => setForm({ ...form, frontLeftTire: value as any })} options={tireOptions.map((value) => ({ value, label: value }))} />
        <SelectField label="Pneu traseiro direito" value={form.rearRightTire} onChange={(value) => setForm({ ...form, rearRightTire: value as any })} options={tireOptions.map((value) => ({ value, label: value }))} />
        <SelectField label="Pneu traseiro esquerdo" value={form.rearLeftTire} onChange={(value) => setForm({ ...form, rearLeftTire: value as any })} options={tireOptions.map((value) => ({ value, label: value }))} />
        <SelectField label="Nivel do oleo" value={form.oilLevel} onChange={(value) => setForm({ ...form, oilLevel: value })} options={["OK", "Baixo", "Solicitar verificacao"].map((value) => ({ value, label: value }))} />
        <SelectField label="Teste de freios" value={form.brakesTest} onChange={(value) => setForm({ ...form, brakesTest: value })} options={["OK", "Ruim", "Solicitar manutencao"].map((value) => ({ value, label: value }))} />
        <SelectField label="Limpador de parabrisa" value={form.windshieldWipers} onChange={(value) => setForm({ ...form, windshieldWipers: value })} options={["OK", "Ruim", "Solicitar troca"].map((value) => ({ value, label: value }))} />
        <SelectField label="Retrovisores" value={form.mirrors} onChange={(value) => setForm({ ...form, mirrors: value })} options={["OK", "Danificado", "Solicitar reparo"].map((value) => ({ value, label: value }))} />
        <SelectField label="Luzes" value={form.lights} onChange={(value) => setForm({ ...form, lights: value })} options={["OK", "Lampada queimada", "Solicitar reparo"].map((value) => ({ value, label: value }))} />
        <SelectField label="Nivel do combustivel" value={form.fuelLevel} onChange={(value) => setForm({ ...form, fuelLevel: value })} options={["Cheio", "3/4", "1/2", "1/4", "Reserva"].map((value) => ({ value, label: value }))} />
      </div>
      <label className="mt-4 flex items-center gap-2 rounded-md border p-3"><Checkbox checked={form.mandatorySafetyItems} onCheckedChange={(checked) => setForm({ ...form, mandatorySafetyItems: Boolean(checked) })} />Itens de seguranca obrigatorios conferidos</label>
      <TextAreaField label="Observacoes" value={form.notes} onChange={(value) => setForm({ ...form, notes: value })} />
      <div className="flex flex-wrap gap-2"><SaveButton onClick={saveChecklist}>Salvar checklist</SaveButton>{existing ? <Badge variant="outline">Preenchido em {formatDate(existing.acceptedAt.slice(0, 10))}</Badge> : null}</div>
    </SectionCard>
  )
}

function VehicleChecklistSummary({ state, order }: { state: OperationalState; order: ServiceOrder }) {
  const n = names(state)
  const checklist = state.vehicleChecklists.find((item) => item.serviceOrderId === order.id)
  if (!order.vehicleId) return <SectionCard title="Checklist do veiculo"><AlertRow>Esta OS nao tem veiculo vinculado.</AlertRow></SectionCard>
  if (!checklist) return <SectionCard title="Checklist do veiculo"><AlertRow>Checklist do veiculo ainda nao preenchido pelo prestador.</AlertRow></SectionCard>
  return (
    <SectionCard title="Checklist do veiculo" description={`Preenchido em ${dateTime(checklist.acceptedAt)} por ${n.provider(checklist.providerId)}`}>
      <DetailGrid rows={[
        ["Veiculo", n.vehicle(checklist.vehicleId)],
        ["Prestador", n.provider(checklist.providerId)],
        ["Estado de limpeza", checklist.cleanlinessState],
        ["Estado de conservacao", checklist.conservationState],
        ["Pneu dianteiro direito", checklist.frontRightTire],
        ["Pneu dianteiro esquerdo", checklist.frontLeftTire],
        ["Pneu traseiro direito", checklist.rearRightTire],
        ["Pneu traseiro esquerdo", checklist.rearLeftTire],
        ["Itens de seguranca", checklist.mandatorySafetyItems ? "Conferidos" : "Nao conferidos"],
        ["Nivel do oleo", checklist.oilLevel],
        ["Teste de freios", checklist.brakesTest],
        ["Limpador de parabrisa", checklist.windshieldWipers],
        ["Retrovisores", checklist.mirrors],
        ["Luzes", checklist.lights],
        ["Nivel do combustivel", checklist.fuelLevel],
        ["Observacoes", checklist.notes || "-"],
      ]} />
    </SectionCard>
  )
}

function FieldServiceForm({ state, commit, order, publicMode = false, onFinished }: { state: OperationalState; commit: (updater: (state: OperationalState) => OperationalState) => void; order?: ServiceOrder; publicMode?: boolean; onFinished?: () => void }) {
  const n = names(state)
  const files = order ? state.serviceOrderFiles.filter((item) => item.serviceOrderId === order.id) : []
  const orderEvents = order ? state.serviceOrderEvents.filter((event) => event.serviceOrderId === order.id) : []
  const executionPoints = useMemo(() => order ? orderExecutionTree(state, order) : [], [state, order])
  const [selectedExecutionPointId, setSelectedExecutionPointId] = useState("")
  const [selectedExecutionLocal, setSelectedExecutionLocal] = useState("")
  const [selectedExecutionFloor, setSelectedExecutionFloor] = useState("")
  const [selectedExecutionFinal, setSelectedExecutionFinal] = useState("")
  const [selectedExecutionEnvironment, setSelectedExecutionEnvironment] = useState("")
  const [serviceDetailDrafts, setServiceDetailDrafts] = useState<Record<string, string>>({})
  const [fieldEventNote, setFieldEventNote] = useState("")
  const [finished, setFinished] = useState(false)
  const [photoUploadStatus, setPhotoUploadStatus] = useState<Record<string, "idle" | "uploading" | "saved" | "error">>({})
  const [photoUploadError, setPhotoUploadError] = useState<Record<string, string>>({})
  const [showOrderTree, setShowOrderTree] = useState(false)
  const selectedExecutionPoint = executionPoints.find((point) => point.id === selectedExecutionPointId) || executionPoints[0]
  const serviceExecutionStarted = order ? orderEvents.some((event) => event.stepName === "Iniciar servico") : false
  const isPmocOrder = order?.orderType === "pmoc"
  const isDiverseServiceOrder = order?.orderType === "servicos" || order?.orderType === "pmoc"
  const allowsMultiplePhotos = order?.orderType === "obra" || order?.orderType === "servicos"
  const fieldPhotoRequirements = order ? requiredOrderPhotos(order.orderType || "obra", executionPoints) : []
  const fieldPhotoSlots = order ? orderPhotoSlots(order.orderType || "obra", executionPoints) : []
  const savedPhotoCount = files.filter((file) => PHOTO_CATEGORIES.includes(file.category as OrderPhotoCategory)).length
  const hasPhotoUploadInProgress = Object.values(photoUploadStatus).some((status) => status === "uploading")
  const hasSelectedPointPhotoSlots = fieldPhotoSlots.some((requirement) => requirement.equipmentId === selectedExecutionPoint?.id)
  const visibleFieldPhotoRequirements = isPmocOrder || (order?.orderType === "obra" && hasSelectedPointPhotoSlots)
    ? fieldPhotoSlots.filter((requirement) => requirement.equipmentId === selectedExecutionPoint?.id)
    : fieldPhotoSlots
  const selectedEquipmentPhotoCount = isPmocOrder && selectedExecutionPoint
    ? files.filter((file) => PHOTO_CATEGORIES.includes(file.category as OrderPhotoCategory) && file.notes === equipmentPhotoNote(selectedExecutionPoint.id)).length
    : savedPhotoCount
  const clientEnvironment = order ? state.clientEnvironments.find((item) => item.id === order.clientEnvironmentId) : undefined
  const clientEquipment = order ? state.clientEquipment.find((item) => item.id === order.clientEquipmentId) : undefined
  const selectedServiceNames = order ? serviceIdsForOrder(order).map((id) => names(state).serviceType(id)).filter((name) => name && name !== "-") : []
  useEffect(() => {
    if (!selectedExecutionPointId && executionPoints[0]?.id) setSelectedExecutionPointId(executionPoints[0].id)
    if (selectedExecutionPointId && executionPoints.length && !executionPoints.some((point) => point.id === selectedExecutionPointId)) setSelectedExecutionPointId(executionPoints[0].id)
  }, [selectedExecutionPointId, executionPoints])

  useEffect(() => {
    if (!selectedExecutionPoint) return
    setSelectedExecutionLocal(selectedExecutionPoint.local)
    setSelectedExecutionFloor(selectedExecutionPoint.floor)
    setSelectedExecutionFinal(selectedExecutionPoint.final)
    setSelectedExecutionEnvironment(selectedExecutionPoint.environment)
  }, [selectedExecutionPoint?.id])

  const uniqueExecutionOptions = (points: OrderExecutionPoint[], key: keyof Pick<OrderExecutionPoint, "local" | "floor" | "final" | "environment">) =>
    Array.from(new Set(points.map((point) => point[key]).filter(Boolean))).map((value) => ({ value, label: value }))

  const localFilteredPoints = selectedExecutionLocal ? executionPoints.filter((point) => point.local === selectedExecutionLocal) : executionPoints
  const floorFilteredPoints = selectedExecutionFloor ? localFilteredPoints.filter((point) => point.floor === selectedExecutionFloor) : localFilteredPoints
  const finalFilteredPoints = selectedExecutionFinal ? floorFilteredPoints.filter((point) => point.final === selectedExecutionFinal) : floorFilteredPoints
  const environmentFilteredPoints = selectedExecutionEnvironment ? finalFilteredPoints.filter((point) => point.environment === selectedExecutionEnvironment) : finalFilteredPoints

  function selectExecutionPoint(filters: Partial<Pick<OrderExecutionPoint, "local" | "floor" | "final" | "environment">>) {
    const next = executionPoints.find((point) =>
      (!filters.local || point.local === filters.local) &&
      (!filters.floor || point.floor === filters.floor) &&
      (!filters.final || point.final === filters.final) &&
      (!filters.environment || point.environment === filters.environment)
    )
    if (next) setSelectedExecutionPointId(next.id)
  }

  async function addStep(label: string, status: string) {
    if (!order) return
    if (state.serviceOrderEvents.some((event) => event.serviceOrderId === order.id && event.stepName === label)) {
      window.alert("Esta etapa ja foi registrada para esta OS.")
      return
    }
    let notes = ""
    if (label === "Pausar servico") {
      const reason = window.prompt("Informe o motivo da pausa:")
      if (!reason) return
      notes = reason
    }
    if (label === "Finalizar servico") {
      if (hasPhotoUploadInProgress) {
        window.alert("Aguarde o envio e a confirmacao das fotos antes de finalizar o servico.")
        return
      }
      const missingPhotos = fieldPhotoRequirements
        .filter((requirement) => !hasRequiredOrderPhoto(files, requirement.category, requirement.equipmentId, order.orderType || "obra"))
        .map((requirement) => requirement.label)
      if (missingPhotos.length) {
        window.alert(`Envie e aguarde o salvamento das fotos obrigatorias: ${missingPhotos.join(", ")}.`)
        return
      }
      if (!fieldEventNote.trim()) {
        window.alert("Informe a observacao do evento antes de finalizar o servico.")
        return
      }
      notes = fieldEventNote.trim()
    }
    const timestamp = nowIso()
    const event = { id: makeId("event"), serviceOrderId: order.id, stepName: label, status: normalizeStatus(status), providerId: order.mainProviderId, eventDatetime: timestamp, latitude: "", longitude: "", notes, fileId: "", createdAt: timestamp }
    try {
      await saveServiceOrderEvent({ orderId: order.id, event, status: normalizeStatus(status), finishedAt: label === "Finalizar servico" ? timestamp : "" })
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Erro ao registrar etapa no banco de dados.")
      return
    }
    commit((current) => ({ ...current, serviceOrderEvents: [event, ...current.serviceOrderEvents.filter((item) => item.id !== event.id)], serviceOrders: current.serviceOrders.map((item) => item.id === order.id ? { ...item, status: normalizeStatus(status), updatedAt: timestamp, finishedAt: label === "Finalizar servico" ? timestamp : item.finishedAt } : item), auditLogs: appendAudit(current, "service_order", order.id, "Campo", `${label} registrado`) }), { persist: false } as any)
    if (label === "Finalizar servico") {
      setFieldEventNote("")
      setFinished(true)
      window.alert("Serviço finalizado. Esta OS já está finalizada.")
      onFinished?.()
      if (publicMode) window.setTimeout(() => window.close(), 100)
    }
  }

  async function saveServiceDetail(point: OrderExecutionPoint) {
    if (!order) return
    const detail = String(serviceDetailDrafts[point.id] ?? serviceDetailEvent(orderEvents, point.id)?.notes ?? "").trim()
    if (!detail) {
      window.alert("Descreva o servico executado neste equipamento antes de salvar.")
      return
    }
    const timestamp = nowIso()
    const existing = serviceDetailEvent(orderEvents, point.id)
    const event = {
      id: existing?.id || makeId("event"),
      serviceOrderId: order.id,
      stepName: serviceDetailStep(point.id),
      status: order.status || normalizeStatus("Em execucao"),
      providerId: order.mainProviderId,
      eventDatetime: timestamp,
      latitude: "",
      longitude: "",
      notes: detail,
      fileId: "",
      createdAt: timestamp,
    }
    try {
      const payload = await saveServiceOrderEvent({ orderId: order.id, event, status: order.status || normalizeStatus("Em execucao"), upsert: true })
      const savedEvent = payload?.event ? { ...payload.event, serviceOrderId: order.id } : event
      commit((current) => ({
        ...current,
        serviceOrderEvents: [savedEvent, ...current.serviceOrderEvents.filter((item) => item.id !== savedEvent.id && !(item.serviceOrderId === order.id && item.stepName === event.stepName))],
        serviceOrders: current.serviceOrders.map((item) => item.id === order.id ? { ...item, updatedAt: timestamp } : item),
        auditLogs: appendAudit(current, "service_order", order.id, "Detalhamento", `${point.label}: detalhamento do servico salvo`),
      }), { persist: false } as any)
      window.alert("Detalhamento do servico salvo na OS.")
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Erro ao salvar detalhamento no banco de dados.")
    }
  }

  async function addFieldFiles(category: OrderPhotoCategory, selectedFiles: File[], equipmentId = "") {
    if (!order || !selectedFiles.length) return
    const uploadKey = `${category}:${equipmentId || "os"}`
    setPhotoUploadStatus((current) => ({ ...current, [uploadKey]: "uploading" }))
    setPhotoUploadError((current) => ({ ...current, [uploadKey]: "" }))
    try {
      const filesToUpload = allowsMultiplePhotos ? selectedFiles : selectedFiles.slice(0, 1)
      const savedFiles: ServiceOrderFile[] = []
      for (const file of filesToUpload) {
        savedFiles.push(await uploadServiceOrderFile({
          serviceOrderId: order.id,
          category,
          file,
          uploadedBy: order.mainProviderId,
          equipmentId,
          keepPrevious: allowsMultiplePhotos,
        }))
      }
      const confirmedPhotos = await fetchServiceOrderPhotos(order.id)
      if (savedFiles.some((savedFile) => !confirmedPhotos.some((photo) => photo.id === savedFile.id))) {
        throw new Error("Uma ou mais fotos foram enviadas, mas nao foram confirmadas no banco. Tente novamente.")
      }
      commit((current) => ({
        ...current,
        serviceOrderFiles: [...confirmedPhotos, ...current.serviceOrderFiles.filter((item) => item.serviceOrderId !== order.id)],
        auditLogs: appendAudit(current, "service_order", order.id, "Evidencia", `${savedFiles.length} foto(s) salva(s): ${savedFiles.map((file) => file.fileName).join(", ")}`),
      }), { persist: false } as any)
      setPhotoUploadStatus((current) => ({ ...current, [uploadKey]: "saved" }))
      window.alert(`${savedFiles.length} foto(s) salva(s) na OS.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao salvar foto no banco de dados."
      setPhotoUploadStatus((current) => ({ ...current, [uploadKey]: "error" }))
      setPhotoUploadError((current) => ({ ...current, [uploadKey]: message }))
      window.alert(message)
    }
  }

  if (!order) return null
  if (finished || order.status === "Finalizada") {
    return <SectionCard title="Serviço finalizado"><p className="text-sm text-muted-foreground">Esta OS já está finalizada.</p></SectionCard>
  }
  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/campo/atendimento/${order.id}` : `/campo/atendimento/${order.id}`
  const visibleNotes = cleanOrderSelectionNotes(order.notes) || "-"
  const responsibleProvider = state.providers.find((provider) => provider.id === order.mainProviderId)
  const detailRows: Array<[string, React.ReactNode]> = isDiverseServiceOrder
    ? [
        ["Cliente", n.client(order.clientId)],
        ["Ambiente", [clientEnvironment?.name, clientEnvironment?.floor].filter(Boolean).join(" - ") || "-"],
        ["Equipamento", [clientEquipment?.name, clientEquipment?.model].filter(Boolean).join(" - ") || "-"],
        ["Servicos", selectedServiceNames.join(", ") || n.serviceType(order.serviceTypeId)],
        ["Endereco", orderAddress(state, order)],
        ["Responsavel", responsibleProvider?.fullName || "-"],
        ["Telefone", responsibleProvider?.phone || "-"],
        ["Observacoes", visibleNotes],
      ]
    : [["Cliente", n.client(order.clientId)], ["Obra/Local", n.work(order.workId)], ["Pavimento", n.floor(order.floorId)], ["Final/Ambiente", n.environment(order.environmentId)], ["Ponto", n.point(order.pointId)], ["Tipo de Servico", n.serviceType(order.serviceTypeId)], ["Endereco", orderAddress(state, order)], ["Responsavel", responsibleProvider?.fullName || "-"], ["Telefone", responsibleProvider?.phone || "-"], ["Observacoes", visibleNotes]]
  return (
    <SectionCard title={`Atendimento ${order.orderNumber}`}>
      {!publicMode ? <div className="mb-4 flex flex-wrap gap-2"><Button variant="secondary" onClick={() => navigator.clipboard?.writeText(shareUrl).then(() => window.alert("Link copiado."))}><Share2 className="h-4 w-4" />Compartilhar formulario completo</Button><Button asChild variant="outline"><Link href={shareUrl} target="_blank">Abrir formulario publico</Link></Button></div> : null}
      <DetailGrid rows={detailRows} />
      {!isDiverseServiceOrder ? <div className="mt-4 rounded-md border">
        <button type="button" className="flex w-full items-center justify-between p-3 text-left" onClick={() => setShowOrderTree((current) => !current)} aria-expanded={showOrderTree}>
          <span className="font-semibold">Arvore da OS</span>
          {showOrderTree ? <ChevronDown className="h-5 w-5 text-muted-foreground" /> : <ChevronRight className="h-5 w-5 text-muted-foreground" />}
        </button>
        {showOrderTree ? (
          <div className="space-y-3 border-t p-3">
            {executionPoints.map((point) => (
              <div key={point.id} className="rounded-md border p-3">
                <div className="font-medium">{point.label}</div>
                <div className="mt-1 text-sm text-muted-foreground">{point.local} | {point.floor} | {point.final} | {point.environment}</div>
                <div className="mt-2 flex flex-wrap gap-2">{point.services.map((service) => <Badge key={`${point.id}-${service.id}`} variant="outline">{service.name}</Badge>)}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div> : null}
      <div className="mt-4 rounded-md border p-3">
        <SelectField
          label={isPmocOrder ? "Equipamento selecionado" : isDiverseServiceOrder ? "Ponto/equipamento selecionado para execucao" : "Ponto selecionado para execucao"}
          value={selectedExecutionPoint?.id || ""}
          onChange={setSelectedExecutionPointId}
          options={executionPoints.map((point) => ({ value: point.id, label: executionPointOptionLabel(point) }))}
        />
      </div>
      <div className="mt-4 space-y-6">
        <section className="space-y-4">
          <h3 className="font-semibold">Execucao</h3>
          <div className="mt-4 space-y-3">
            <TextAreaField label="Observacao do evento" value={fieldEventNote} onChange={setFieldEventNote} placeholder="Obrigatorio para finalizar o servico." />
            <div className="grid gap-2">{fieldSteps.map(([label, status]) => {
          const done = orderEvents.some((event) => event.stepName === label)
          return <Button key={label} size="lg" variant={label === "Finalizar servico" ? "default" : "secondary"} disabled={done} onClick={() => addStep(label, status)}>{done ? `${label} - registrado` : label}</Button>
            })}</div>
            <div className="space-y-3 rounded-md border p-3">
              <h3 className="font-semibold">{isPmocOrder ? "Fotos do equipamento selecionado" : order.orderType === "obra" ? "Fotos do ponto selecionado" : isDiverseServiceOrder ? "Fotos por equipamento" : "Fotos da execucao da OS"}</h3>
              <div className="text-sm text-muted-foreground">
                {isPmocOrder ? `Fotos deste equipamento: ${selectedEquipmentPhotoCount}/5. As fotos adicionais 1, 2 e 3 sao opcionais.` : `Fotos salvas: ${savedPhotoCount}.`} A foto inicial e a foto final devem estar confirmadas antes da finalizacao.
              </div>
              {isPmocOrder && !selectedExecutionPoint ? <div className="text-sm text-muted-foreground">Nenhum equipamento vinculado a esta OS PMOC.</div> : null}
              {visibleFieldPhotoRequirements.map(({ category, equipmentId, equipmentLabel, environment, ...requirement }) => {
                const uploadKey = `${category}:${equipmentId || "os"}`
                const photos = orderPhotoFiles(files, category, equipmentId)
                const status = photoUploadStatus[uploadKey]
                return (
                  <div key={uploadKey} className="space-y-2 rounded-md border p-3">
                    <Label>{equipmentId ? `${category}: ${equipmentLabel}${"required" in requirement && requirement.required === false ? " (opcional)" : ""}` : category}</Label>
                    {environment ? <div className="text-xs text-muted-foreground">{environment}</div> : null}
                    <div className="flex flex-wrap gap-2">
                      <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border bg-background px-4 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
                        <Camera className="h-4 w-4" />
                        Tirar foto
                        <input
                          className="sr-only"
                          type="file"
                          accept="image/*"
                          capture="environment"
                          disabled={status === "uploading"}
                          onChange={(event) => {
                            const selected = Array.from(event.currentTarget.files || [])
                            event.currentTarget.value = ""
                            void addFieldFiles(category, selected, equipmentId)
                          }}
                        />
                      </label>
                      <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border bg-background px-4 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
                        <Images className="h-4 w-4" />
                        {allowsMultiplePhotos ? "Escolher fotos" : "Escolher foto"}
                        <input
                          className="sr-only"
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                          multiple={allowsMultiplePhotos}
                          disabled={status === "uploading"}
                          onChange={(event) => {
                            const selected = Array.from(event.currentTarget.files || [])
                            event.currentTarget.value = ""
                            void addFieldFiles(category, selected, equipmentId)
                          }}
                        />
                      </label>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {status === "uploading" ? "Enviando e confirmando no banco..." : photos.length ? `${photos.length} foto(s) confirmada(s) no banco` : "Nenhuma foto salva"}
                    </div>
                    {photos.length ? <div className="flex flex-wrap gap-2">{photos.map((photo, index) => (
                      <a key={photo.id} className="text-sm text-primary underline" href={photo.fileUrl} target="_blank" rel="noreferrer">Abrir foto {index + 1}</a>
                    ))}</div> : null}
                    {photoUploadError[uploadKey] ? <div className="text-sm text-destructive">{photoUploadError[uploadKey]}</div> : null}
                  </div>
                )
              })}
            </div>
          </div>
          {serviceExecutionStarted ? (
            <div className="mt-5 space-y-3">
              <h3 className="font-semibold">Ponto em execucao</h3>
              {isDiverseServiceOrder ? (
                <div className="space-y-3">
                  {selectedExecutionPoint ? <div className="rounded-md border p-3">
                    <div className="font-medium">{selectedExecutionPoint.label}</div>
                    <div className="mt-1 text-sm text-muted-foreground">{selectedExecutionPoint.local} | {selectedExecutionPoint.environment}</div>
                    <div className="mt-2 flex flex-wrap gap-2">{selectedExecutionPoint.services.map((service) => <Badge key={`${selectedExecutionPoint.id}-${service.id}`} variant="outline">{service.name}</Badge>)}</div>
                  </div> : null}
                </div>
              ) : (
                <>
                  <div className="grid gap-3 md:grid-cols-2">
                    <SelectField
                      label="Torre/Local"
                      value={selectedExecutionLocal}
                      onChange={(value) => selectExecutionPoint({ local: value })}
                      options={uniqueExecutionOptions(executionPoints, "local")}
                    />
                    <SelectField
                      label="Pavimento"
                      value={selectedExecutionFloor}
                      onChange={(value) => selectExecutionPoint({ local: selectedExecutionLocal, floor: value })}
                      options={uniqueExecutionOptions(localFilteredPoints, "floor")}
                    />
                    <SelectField
                      label="Final"
                      value={selectedExecutionFinal}
                      onChange={(value) => selectExecutionPoint({ local: selectedExecutionLocal, floor: selectedExecutionFloor, final: value })}
                      options={uniqueExecutionOptions(floorFilteredPoints, "final")}
                    />
                    <SelectField
                      label="Ambiente"
                      value={selectedExecutionEnvironment}
                      onChange={(value) => selectExecutionPoint({ local: selectedExecutionLocal, floor: selectedExecutionFloor, final: selectedExecutionFinal, environment: value })}
                      options={uniqueExecutionOptions(finalFilteredPoints, "environment")}
                    />
                    <div className="md:col-span-2">
                      <SelectField
                        label="Ponto"
                        value={selectedExecutionPoint?.id || ""}
                        onChange={setSelectedExecutionPointId}
                        options={environmentFilteredPoints.map((point) => ({ value: point.id, label: point.label }))}
                      />
                    </div>
                  </div>
                  {selectedExecutionPoint ? <div className="rounded-md border p-3 text-sm text-muted-foreground">{selectedExecutionPoint.local} | {selectedExecutionPoint.floor} | {selectedExecutionPoint.final} | {selectedExecutionPoint.environment}</div> : null}
                </>
              )}
              {selectedExecutionPoint ? (
                <div className="rounded-md border p-3">
                  <div className="font-medium">Servicos do ponto/equipamento</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedExecutionPoint.services.length ? selectedExecutionPoint.services.map((service) => <Badge key={`${selectedExecutionPoint.id}-${service.id}`} variant="outline">{service.name}</Badge>) : <span className="text-sm text-muted-foreground">Nenhum servico cadastrado.</span>}
                  </div>
                </div>
              ) : null}
              {selectedExecutionPoint ? (
                <div className="rounded-md border p-3">
                  <TextAreaField
                    label="Detalhamento do servico executado neste equipamento"
                    value={serviceDetailDrafts[selectedExecutionPoint.id] ?? serviceDetailEvent(orderEvents, selectedExecutionPoint.id)?.notes ?? ""}
                    onChange={(value) => setServiceDetailDrafts((current) => ({ ...current, [selectedExecutionPoint.id]: value }))}
                    placeholder="Descreva o que foi executado neste equipamento/ponto."
                  />
                  <Button className="mt-3" type="button" onClick={() => saveServiceDetail(selectedExecutionPoint)}>Salvar detalhamento</Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </SectionCard>
  )
}

export function FieldOperationPage() {
  const { state, commit } = useOperationalStore(undefined, { allowClientWrite: true })
  const [selectedId, setSelectedId] = useState("")
  const [finishedOrderNumber, setFinishedOrderNumber] = useState("")
  const n = names(state)
  const availableOrders = sortServiceOrdersByNewestCreation(
    state.serviceOrders.filter((item) => !["Finalizada", "Cancelada"].includes(item.status)),
  )
  const order = availableOrders.find((item) => item.id === selectedId) || availableOrders[0]
  useEffect(() => {
    if (!finishedOrderNumber && !selectedId && availableOrders[0]?.id) setSelectedId(availableOrders[0].id)
  }, [availableOrders, finishedOrderNumber, selectedId])

  if (finishedOrderNumber) {
    return (
      <PageShell title="Operacao em Campo" description="">
        <div className="mx-auto max-w-xl">
          <SectionCard title="Serviço finalizado">
            <p className="text-sm text-muted-foreground">{finishedOrderNumber} já está finalizada.</p>
          </SectionCard>
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell title="Operacao em Campo" description="Tela simples e responsiva para o tecnico executar OS no celular.">
      <div className="mx-auto max-w-xl space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <MetricCard title="Hoje" value={state.serviceOrders.filter((item) => item.scheduledDate === today()).length} note="Servicos do dia" icon={CalendarDays} />
          <MetricCard title="Pendentes" value={state.serviceOrders.filter((item) => ["Criada", "Agendada"].includes(item.status)).length} note="A iniciar" icon={Clock3} />
          <MetricCard title="Em andamento" value={state.serviceOrders.filter((item) => String(item.status).includes("execu")).length} note="Em execucao" icon={Wrench} />
          <MetricCard title="Finalizados" value={state.serviceOrders.filter((item) => item.status === "Finalizada").length} note="Concluidos" icon={CheckCircle2} />
        </div>
        <SectionCard title="Servicos">
          <SearchableSelectField
            label="Selecionar OS"
            value={order?.id || "sem-os"}
            onChange={(value) => setSelectedId(value === "sem-os" ? "" : value)}
            options={[
              { value: "sem-os", label: availableOrders.length ? "Selecione uma OS" : "Nenhuma OS pendente" },
              ...availableOrders.map((item) => ({
                value: item.id,
                label: `${item.orderNumber} - ${n.client(item.clientId)} | ${n.work(item.workId)} | ${item.scheduledStartTime || "sem horario"} | ${item.status}`,
              })),
            ]}
            searchPlaceholder="Pesquisar por OS, cliente, obra ou status..."
            emptyLabel="Nenhuma OS encontrada."
          />
        </SectionCard>
        {order ? <FieldServiceForm state={state} commit={commit} order={order} onFinished={() => {
          setFinishedOrderNumber(order.orderNumber)
          setSelectedId("")
        }} /> : null}
      </div>
    </PageShell>
  )
}

export function VehicleChecklistPublicPage({ orderId }: { orderId: string }) {
  const { state, commit } = useOperationalStore(orderId, { allowClientWrite: true })
  const order = state.serviceOrders.find((item) => item.id === orderId)
  const n = names(state)
  return (
    <main className="min-h-screen bg-[#f4f8ff] px-4 py-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-950">Checklist do veiculo</h1>
          <p className="text-sm text-muted-foreground">Preencha antes de sair para executar a ordem de servico.</p>
        </div>
        {order ? <>
          <SectionCard title={`${order.orderNumber} - ${n.client(order.clientId)}`} description={`${n.work(order.workId)} | ${n.vehicle(order.vehicleId)} | ${formatDate(order.scheduledDate)}`}>
            <DetailGrid rows={[["Prestador", n.provider(order.mainProviderId)], ["Cliente", n.client(order.clientId)], ["Obra/Local", n.work(order.workId)], ["Ponto", n.point(order.pointId)], ["Tipo de Servico", n.serviceType(order.serviceTypeId)]]} />
          </SectionCard>
          <VehicleChecklistForm state={state} commit={commit} order={order} publicMode />
        </> : <SectionCard title="OS nao encontrada"><p className="text-sm text-muted-foreground">O link informado nao encontrou uma ordem de servico salva neste navegador.</p></SectionCard>}
      </div>
    </main>
  )
}

export function FieldServicePublicPage({ orderId }: { orderId: string }) {
  const { state, commit } = useOperationalStore(orderId, { allowClientWrite: true })
  const order = state.serviceOrders.find((item) => item.id === orderId)
  const n = names(state)
  return (
    <main className="min-h-screen bg-[#f4f8ff] px-4 py-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-950">Atendimento em campo</h1>
          <p className="text-sm text-muted-foreground">Formulario completo da ordem de servico para o prestador preencher pelo link.</p>
        </div>
        {order?.status === "Finalizada" ? (
          <SectionCard title="Serviço finalizado"><p className="text-sm text-muted-foreground">{order.orderNumber} já está finalizada.</p></SectionCard>
        ) : order ? <>
          <SectionCard title={`${order.orderNumber} - ${n.client(order.clientId)}`} description={`${n.work(order.workId)} | ${n.serviceType(order.serviceTypeId)} | ${formatDate(order.scheduledDate)}`}>
            <DetailGrid rows={[["Prestador", n.provider(order.mainProviderId)], ["Veiculo", n.vehicle(order.vehicleId)], ["Cliente", n.client(order.clientId)], ["Obra/Local", n.work(order.workId)], ["Ponto", n.point(order.pointId)], ["Status", order.status]]} />
          </SectionCard>
          <FieldServiceForm state={state} commit={commit} order={order} publicMode />
        </> : <SectionCard title="OS nao encontrada"><p className="text-sm text-muted-foreground">O link informado nao encontrou uma ordem de servico salva neste navegador.</p></SectionCard>}
      </div>
    </main>
  )
}

export function FleetPage() {
  const { state, commit } = useOperationalStore()
  const { sheet, setSheet, preset, openSheet } = useSheetWithPreset()
  const n = names(state)
  const [maintenance, setMaintenance] = useState({ vehicleId: "", type: "", date: today(), km: "0", cost: "0", description: "", nextMaintenance: "", attachmentName: "" })
  function saveMaintenance() {
    if (!maintenance.vehicleId) return
    if (maintenance.nextMaintenance && maintenance.nextMaintenance < maintenance.date) {
      window.alert("A data final da manutencao nao pode ser anterior ao inicio.")
      return
    }
    commit((current) => ({
      ...current,
      vehicleMaintenance: [{ id: makeId("maint"), vehicleId: maintenance.vehicleId, type: maintenance.type || "Manutencao", date: maintenance.date, km: Number(maintenance.km), cost: Number(maintenance.cost), description: maintenance.description, nextMaintenance: maintenance.nextMaintenance || maintenance.date, status: "Programada", attachmentName: maintenance.attachmentName }, ...current.vehicleMaintenance],
      auditLogs: appendAudit(current, "vehicle", maintenance.vehicleId, "Manutencao", `Manutencao programada de ${formatDate(maintenance.date)} ate ${formatDate(maintenance.nextMaintenance || maintenance.date)}`),
    }))
    setMaintenance({ vehicleId: "", type: "", date: today(), km: "0", cost: "0", description: "", nextMaintenance: "", attachmentName: "" })
  }
  return (
    <PageShell title="Frota" description="Controle de veiculos, uso da frota e manutencoes." actions={<><Button onClick={() => openSheet("vehicle")}><Plus className="h-4 w-4" />Novo Veiculo</Button><Button variant="outline" onClick={() => window.alert("Exportacao da frota simulada no MVP local.")}>Exportar lista</Button></>}>
      <Tabs defaultValue="veiculos">
        <TabsList><TabsTrigger value="veiculos">Veiculos</TabsTrigger><TabsTrigger value="uso">Uso da Frota</TabsTrigger><TabsTrigger value="manutencao">Manutencao</TabsTrigger></TabsList>
        <TabsContent value="veiculos"><SectionCard title="Veiculos"><DataTable headers={["Placa", "Modelo", "KM Atual", "Pneus dianteiros", "Pneus traseiros", "Ultima troca de oleo", "Status", "Acoes"]} empty={!state.vehicles.length}>{state.vehicles.map((vehicle) => <TableRow key={vehicle.id}><TableCell>{vehicle.plate}</TableCell><TableCell>{vehicle.model} / {vehicle.brand}</TableCell><TableCell>{vehicle.currentKm}</TableCell><TableCell>Dir: {(vehicle as any).frontRightTire || "Novo"}<br />Esq: {(vehicle as any).frontLeftTire || "Novo"}</TableCell><TableCell>Dir: {(vehicle as any).rearRightTire || "Novo"}<br />Esq: {(vehicle as any).rearLeftTire || "Novo"}</TableCell><TableCell>{(vehicle as any).lastOilChangeDate ? formatDate((vehicle as any).lastOilChangeDate) : "-"} / {(vehicle as any).lastOilChangeKm || 0} km</TableCell><TableCell><StatusBadge status={vehicle.status} /></TableCell><TableCell><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => openSheet("vehicle", { id: vehicle.id })}>Editar</Button><ConfirmInline label="Inativar" onConfirm={() => commit((current) => ({ ...current, vehicles: current.vehicles.map((item) => item.id === vehicle.id ? { ...item, status: "Inativo", updatedAt: nowIso() } : item) }))} /></div></TableCell></TableRow>)}</DataTable></SectionCard></TabsContent>
        <TabsContent value="uso"><SectionCard title="Uso da Frota"><DataTable headers={["Data", "Veiculo", "Prestador", "OS", "KM inicial", "KM final", "KM rodado"]} empty={!state.vehicleUsage.length}>{state.vehicleUsage.map((usage) => <TableRow key={usage.id}><TableCell>{formatDate(usage.date)}</TableCell><TableCell>{n.vehicle(usage.vehicleId)}</TableCell><TableCell>{n.provider(usage.providerId)}</TableCell><TableCell>{state.serviceOrders.find((order) => order.id === usage.serviceOrderId)?.orderNumber}</TableCell><TableCell>{usage.initialKm}</TableCell><TableCell>{usage.finalKm}</TableCell><TableCell>{Math.max(0, usage.finalKm - usage.initialKm)}</TableCell></TableRow>)}</DataTable></SectionCard></TabsContent>
        <TabsContent value="manutencao"><SectionCard title="Manutencoes"><div className="mb-4 grid gap-3 md:grid-cols-3"><SelectField label="Veiculo" value={maintenance.vehicleId || "nenhum"} onChange={(value) => setMaintenance({ ...maintenance, vehicleId: value === "nenhum" ? "" : value })} options={[{ value: "nenhum", label: "Selecione" }, ...state.vehicles.map((item) => ({ value: item.id, label: `${item.plate} - ${item.model}` }))]} /><TextField label="Tipo" value={maintenance.type} onChange={(value) => setMaintenance({ ...maintenance, type: value })} /><TextField label="Inicio da manutencao" type="date" value={maintenance.date} onChange={(value) => setMaintenance({ ...maintenance, date: value })} /><TextField label="Fim da manutencao" type="date" value={maintenance.nextMaintenance} onChange={(value) => setMaintenance({ ...maintenance, nextMaintenance: value })} /><TextField label="KM" type="number" value={maintenance.km} onChange={(value) => setMaintenance({ ...maintenance, km: value })} /><TextField label="Custo" type="number" value={maintenance.cost} onChange={(value) => setMaintenance({ ...maintenance, cost: value })} /><TextAreaField label="Descricao" value={maintenance.description} onChange={(value) => setMaintenance({ ...maintenance, description: value })} /><Button onClick={saveMaintenance}>Registrar manutencao</Button></div><DataTable headers={["Veiculo", "Tipo", "Inicio", "Fim", "KM", "Custo", "Status"]} empty={!state.vehicleMaintenance.length}>{state.vehicleMaintenance.map((item) => <TableRow key={item.id}><TableCell>{n.vehicle(item.vehicleId)}</TableCell><TableCell>{item.type}</TableCell><TableCell>{formatDate(item.date)}</TableCell><TableCell>{formatDate(item.nextMaintenance || item.date)}</TableCell><TableCell>{item.km}</TableCell><TableCell>{item.cost.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</TableCell><TableCell><StatusBadge status={item.status} /></TableCell></TableRow>)}</DataTable></SectionCard></TabsContent>
      </Tabs>
      <QuickSheets state={state} commit={commit} sheet={sheet} setSheet={setSheet} preset={preset} />
    </PageShell>
  )
}

export function ReportsPage() {
  const { state } = useOperationalStore()
  const [query, setQuery] = useState("")
  const filteredOrders = state.serviceOrders.filter((order) => [names(state).client(order.clientId), names(state).work(order.workId), order.status].join(" ").toLowerCase().includes(query.toLowerCase()))
  const delayed = filteredOrders.filter((order) => order.scheduledDate < today() && !["Finalizada", "Cancelada"].includes(order.status))
  const km = state.vehicleUsage.reduce((sum, item) => sum + Math.max(0, item.finalKm - item.initialKm), 0)
  return (
    <PageShell title="Relatorios" description="Indicadores calculados a partir dos cadastros e ordens salvos localmente.">
      <Input className="max-w-md" placeholder="Filtro geral por cliente, obra ou status" value={query} onChange={(event) => setQuery(event.target.value)} />
      <Tabs defaultValue="operacional">
        <TabsList className="mt-4 flex flex-wrap"><TabsTrigger value="operacional">Operacional</TabsTrigger><TabsTrigger value="clientes">Obras e Servicos</TabsTrigger><TabsTrigger value="equipe">Equipe</TabsTrigger><TabsTrigger value="frota">Frota</TabsTrigger><TabsTrigger value="materiais">Materiais</TabsTrigger></TabsList>
        <TabsContent value="operacional"><ReportMetrics items={[["OS criadas", filteredOrders.length], ["OS finalizadas", filteredOrders.filter((item) => item.status === "Finalizada").length], ["OS atrasadas", delayed.length], ["OS canceladas", filteredOrders.filter((item) => item.status === "Cancelada").length], ["Tempo medio", "4h"]]} /><OrdersMiniTable state={state} orders={filteredOrders} /></TabsContent>
        <TabsContent value="clientes"><ReportMetrics items={[["Clientes ativos", state.clients.filter((item) => item.status === "Ativo").length], ["Obras/Locais ativos", state.works.filter((item) => item.status === "Ativa").length], ["Pavimentos cadastrados", state.workFloors.length], ["Ambientes cadastrados", state.workEnvironments.length], ["Pontos cadastrados", state.workPoints.length]]} /><DataTable headers={["Cliente", "Obra/Local", "Pavimentos", "Ambientes", "Pontos", "OS abertas", "OS finalizadas"]}>{state.works.map((work) => <TableRow key={work.id}><TableCell>{names(state).client(work.clientId)}</TableCell><TableCell>{work.name}</TableCell><TableCell>{state.workFloors.filter((item) => item.workId === work.id).length}</TableCell><TableCell>{state.workEnvironments.filter((item) => item.workId === work.id).length}</TableCell><TableCell>{state.workPoints.filter((item) => item.workId === work.id).length}</TableCell><TableCell>{state.serviceOrders.filter((item) => item.workId === work.id && item.status !== "Finalizada").length}</TableCell><TableCell>{state.serviceOrders.filter((item) => item.workId === work.id && item.status === "Finalizada").length}</TableCell></TableRow>)}</DataTable></TabsContent>
        <TabsContent value="equipe"><TeamHistory state={state} /></TabsContent>
        <TabsContent value="frota"><ReportMetrics items={[["KM rodado", km], ["Veiculos em uso", state.vehicles.filter((item) => String(item.status).includes("uso")).length], ["Em manutencao", state.vehicles.filter((item) => String(item.status).includes("manuten")).length], ["Custo manutencao", state.vehicleMaintenance.reduce((sum, item) => sum + item.cost, 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })]]} /></TabsContent>
        <TabsContent value="materiais"><ReportMetrics items={[["Materiais cadastrados", state.materials.length], ["Materiais pendentes", state.serviceOrderMaterials.filter((item) => item.status === "Pendente").length], ["Devolvidos", state.serviceOrderMaterials.filter((item) => item.status === "Devolvido").length], ["Solicitacoes", state.serviceOrderMaterials.filter((item) => item.status === "Solicitado").length]]} /><DataTable headers={["Item", "Quantidade usada", "OS vinculadas", "Status"]}>{state.serviceOrderMaterials.map((item) => <TableRow key={item.id}><TableCell>{item.itemName}</TableCell><TableCell>{item.usedQuantity}</TableCell><TableCell>{state.serviceOrders.find((order) => order.id === item.serviceOrderId)?.orderNumber}</TableCell><TableCell><StatusBadge status={item.status} /></TableCell></TableRow>)}</DataTable></TabsContent>
      </Tabs>
    </PageShell>
  )
}

function ReportMetrics({ items }: { items: Array<[string, React.ReactNode]> }) {
  return <div className="my-4 grid gap-4 md:grid-cols-2 xl:grid-cols-5">{items.map(([title, value]) => <MetricCard key={title} title={title} value={value as any} note="Calculado do localStorage" icon={BarChart3} />)}</div>
}

export function SettingsPage() {
  const { state, commit } = useOperationalStore()
  const { user } = useAuth()
  const { sheet, setSheet, preset, openSheet } = useSheetWithPreset()
  return (
    <PageShell title="Configuracoes" description="Cadastros auxiliares, usuarios, permissoes e parametros do sistema.">
      <Tabs defaultValue={user?.role === "admin" ? "empresas" : "usuarios"}>
        <TabsList className="flex flex-wrap"><TabsTrigger value="usuarios">Usuarios e permissoes</TabsTrigger>{user?.role === "admin" && <TabsTrigger value="empresas">Empresas / CNPJs</TabsTrigger>}<TabsTrigger value="tipos">Tipos de servico</TabsTrigger><TabsTrigger value="checklists">Checklist padrao</TabsTrigger><TabsTrigger value="materiais">Materiais</TabsTrigger><TabsTrigger value="status">Status e etapas</TabsTrigger></TabsList>
        <TabsContent value="usuarios"><SectionCard title="Usuarios e permissoes"><Button className="mb-3" onClick={() => openSheet("user")}><Plus className="h-4 w-4" />Novo usuario</Button><DataTable headers={["Nome", "E-mail", "Perfil", "Empresa/Cliente", "Status", "Permissoes", "Acoes"]} empty={!state.systemUsers.length}>{state.systemUsers.map((user) => <TableRow key={user.id}><TableCell>{user.name}</TableCell><TableCell>{user.email}</TableCell><TableCell>{user.profile}</TableCell><TableCell>{user.clientId ? names(state).client(user.clientId) : "-"}</TableCell><TableCell><StatusBadge status={user.status} /></TableCell><TableCell>{user.permissions.map((permission) => pagePermissionLabels[permission as PagePermission] || permission).join(", ")}</TableCell><TableCell><Button size="sm" variant="outline" onClick={() => openSheet("user", { id: user.id })}>Editar</Button></TableCell></TableRow>)}</DataTable></SectionCard></TabsContent>
        <TabsContent value="tipos"><SectionCard title="Tipos de servico"><Button className="mb-3" onClick={() => openSheet("serviceType")}><Plus className="h-4 w-4" />Novo tipo de servico</Button><DataTable headers={["Tipo", "Kit", "Checklist", "Status"]} empty={!state.serviceTypes.length}>{state.serviceTypes.map((type) => <TableRow key={type.id}><TableCell>{type.name}</TableCell><TableCell>{state.stockKits.find((kit) => kit.id === type.kitId)?.name || "-"}</TableCell><TableCell>{state.serviceTypeChecklistItems.filter((item) => item.serviceTypeId === type.id).length}</TableCell><TableCell><StatusBadge status={type.status} /></TableCell></TableRow>)}</DataTable></SectionCard></TabsContent>
        <TabsContent value="checklists"><SectionCard title="Checklist padrao"><DataTable headers={["Nome do checklist", "Tipo de servico", "Obrigatoria", "Exige foto", "Ordem"]} empty={!state.serviceTypeChecklistItems.length}>{state.serviceTypeChecklistItems.map((item) => <TableRow key={item.id}><TableCell>{item.taskName}</TableCell><TableCell>{names(state).serviceType(item.serviceTypeId)}</TableCell><TableCell>{item.required ? "Sim" : "Nao"}</TableCell><TableCell>{item.requiresPhoto ? "Sim" : "Nao"}</TableCell><TableCell>{item.order}</TableCell></TableRow>)}</DataTable></SectionCard></TabsContent>
        <TabsContent value="materiais"><SectionCard title="Materiais"><Button className="mb-3" onClick={() => openSheet("material")}><Plus className="h-4 w-4" />Novo material</Button><DataTable headers={["Material", "SKU", "NCM", "Categoria", "Unidade", "Saldo atual", "Estoque minimo", "Status"]} empty={!state.materials.length}>{state.materials.map((item) => <TableRow key={item.id}><TableCell>{item.name}</TableCell><TableCell className="font-mono">{item.internalCode || "-"}</TableCell><TableCell className="font-mono">{item.ncm || "-"}</TableCell><TableCell>{item.category}</TableCell><TableCell>{item.unit}</TableCell><TableCell>{materialStock(item)}</TableCell><TableCell>{item.minimumStock}</TableCell><TableCell><StatusBadge status={item.status} /></TableCell></TableRow>)}</DataTable></SectionCard></TabsContent>
        <TabsContent value="status"><div className="grid gap-4 xl:grid-cols-2"><SectionCard title="Status da OS"><DataTable headers={["Nome", "Cor", "Ordem", "Final", "Exige motivo"]}>{state.statuses.map((item) => <TableRow key={item.id}><TableCell>{item.name}</TableCell><TableCell><span className="inline-block h-4 w-4 rounded-full" style={{ backgroundColor: item.color }} /></TableCell><TableCell>{item.order}</TableCell><TableCell>{item.finalStatus ? "Sim" : "Nao"}</TableCell><TableCell>{item.requiresReason ? "Sim" : "Nao"}</TableCell></TableRow>)}</DataTable></SectionCard><SectionCard title="Etapas da execucao"><DataTable headers={["Etapa", "Ordem", "Foto", "Localizacao", "Altera status"]}>{state.executionSteps.map((item) => <TableRow key={item.id}><TableCell>{item.name}</TableCell><TableCell>{item.order}</TableCell><TableCell>{item.requiresPhoto ? "Sim" : "Nao"}</TableCell><TableCell>{item.requiresLocation ? "Sim" : "Nao"}</TableCell><TableCell>{item.changesStatusTo}</TableCell></TableRow>)}</DataTable></SectionCard></div></TabsContent>
        {user?.role === "admin" && <TabsContent value="empresas"><SystemCompaniesManager /></TabsContent>}
      </Tabs>
      <QuickSheets state={state} commit={commit} sheet={sheet} setSheet={setSheet} preset={preset} />
    </PageShell>
  )
}

function AuditTable({ state, filter, entityId }: { state: OperationalState; filter: string[]; entityId?: string }) {
  const logs = state.auditLogs.filter((log) => (!filter.length || filter.includes(log.entityType)) && (!entityId || log.entityId === entityId))
  return <SectionCard title="Historico"><DataTable headers={["Data/hora", "Usuario", "Tipo de acao", "Entidade", "Descricao"]} empty={!logs.length}>{logs.map((log) => <TableRow key={log.id}><TableCell>{dateTime(log.createdAt)}</TableCell><TableCell>{log.userId}</TableCell><TableCell>{log.action}</TableCell><TableCell>{log.entityType}</TableCell><TableCell>{log.description}</TableCell></TableRow>)}</DataTable></SectionCard>
}


