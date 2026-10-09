import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const BUCKET = "whatsapp-budget-files"
const serviceTypes = ["instalacao", "corretiva", "preventiva"] as const
type WhatsappServiceType = (typeof serviceTypes)[number]

function safeName(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "arquivo"
}

async function ensureBucket(supabase: ReturnType<typeof createAdminClient>) {
  const { data } = await supabase.storage.getBucket(BUCKET)
  if (data) return
  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: 25 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"],
  })
  if (error && !String(error.message || "").toLowerCase().includes("already exists")) throw error
}

function normalizeServiceType(value: unknown): WhatsappServiceType | "" {
  const text = String(value || "").trim().toLowerCase()
  if (["instalacao", "instalação", "instalation", "installation"].includes(text)) return "instalacao"
  if (["corretiva", "manutencao corretiva", "manutenção corretiva", "corrective"].includes(text)) return "corretiva"
  if (["preventiva", "limpeza", "manutencao preventiva", "manutenção preventiva", "preventive"].includes(text)) return "preventiva"
  return ""
}

function parseJson(value: unknown, fallback: any = {}) {
  if (!value) return fallback
  if (typeof value === "object") return value
  try {
    return JSON.parse(String(value))
  } catch {
    return fallback
  }
}

function pick(source: Record<string, any>, ...keys: string[]) {
  for (const key of keys) {
    const value = source?.[key]
    if (value !== undefined && value !== null && String(value).trim() !== "") return value
  }
  return ""
}

function asText(value: unknown) {
  return value === undefined || value === null ? "" : String(value).trim()
}

function asNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return null
  const normalized = String(value).replace(/[^\d,.-]/g, "").replace(",", ".")
  const number = Number(normalized)
  return Number.isFinite(number) ? number : null
}

function asBoolean(value: unknown) {
  if (value === undefined || value === null || value === "") return null
  if (typeof value === "boolean") return value
  const text = String(value).trim().toLowerCase()
  if (["sim", "true", "1", "yes", "s"].includes(text)) return true
  if (["nao", "não", "false", "0", "no", "n"].includes(text)) return false
  return null
}

function sanitizeRawPayload(payload: any) {
  const raw = payload?.rawPayload && typeof payload.rawPayload === "object" ? payload.rawPayload : payload
  const copy = { ...(raw || {}) }
  if (Array.isArray(copy.photos)) {
    copy.photos = copy.photos.map((photo: any) => ({
      url: photo?.url || photo?.fileUrl || "",
      fileName: photo?.fileName || photo?.name || "",
      fileType: photo?.fileType || photo?.mimeType || "",
      caption: photo?.caption || "",
      hasBase64: Boolean(photo?.base64 || photo?.data),
    }))
  }
  return copy
}

function rowToClient(row: any) {
  return {
    id: row.id,
    serviceType: row.service_type,
    customerName: row.customer_name || "",
    customerPhone: row.customer_phone || "",
    customerDocument: row.customer_document || "",
    customerEmail: row.customer_email || "",
    address: row.address || "",
    city: row.city || "",
    state: row.state || "",
    source: row.source || "whatsapp",
    status: row.status || "Novo",
    rawPayload: row.raw_payload || {},
    agentNotes: row.agent_notes || "",
    internalNotes: row.internal_notes || "",
    equipmentCapacity: row.equipment_capacity || "",
    propertyType: row.property_type || "",
    apartmentFloor: row.apartment_floor || "",
    hasTechnicalArea: row.has_technical_area || "",
    hasGuardrail: row.has_guardrail || "",
    houseFloor: row.house_floor || "",
    ceilingHeight: row.ceiling_height || "",
    hasInfrastructure: row.has_infrastructure || "",
    installationType: row.installation_type || "",
    infrastructureMetersIncluded: row.infrastructure_meters_included,
    additionalInfrastructureMeterValue: row.additional_infrastructure_meter_value,
    commandCableMeterValue: row.command_cable_meter_value,
    equipmentUsed: row.equipment_used,
    brand: row.brand || "",
    losesExtendedWarrantyNotice: row.loses_extended_warranty_notice,
    warrantyNotice: row.warranty_notice || "",
    issueDescription: row.issue_description || "",
    errorCode: row.error_code || "",
    correctiveBrand: row.corrective_brand || "",
    correctiveCapacity: row.corrective_capacity || "",
    correctiveEnvironment: row.corrective_environment || "",
    contractCustomer: row.contract_customer,
    schedulePriority: row.schedule_priority || "",
    technicalVisitFee: row.technical_visit_fee,
    acceptedExtendedSchedule: row.accepted_extended_schedule,
    equipmentQuantity: row.equipment_quantity,
    preventiveCapacities: row.preventive_capacities || "",
    preventiveCeilingHeight: row.preventive_ceiling_height || "",
    condenserAccess: row.condenser_access || "",
    wantsUninstall: row.wants_uninstall,
    needsCleaningCertificate: row.needs_cleaning_certificate,
    needsArt: row.needs_art,
    artValue: row.art_value,
    preventiveNotes: row.preventive_notes || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    photos: (row.photos || row.whatsapp_budget_request_photos || []).map((photo: any) => ({
      id: photo.id,
      requestId: photo.request_id,
      fileUrl: photo.file_url,
      fileName: photo.file_name || "",
      fileType: photo.file_type || "",
      caption: photo.caption || "",
      createdAt: photo.created_at,
    })),
  }
}

function buildRequestRow(payload: any) {
  const answers = parseJson(payload.answers, {})
  const customer = parseJson(payload.customer, {})
  const addressPayload = parseJson(payload.address, {})
  const serviceType = normalizeServiceType(payload.serviceType || payload.tipo || payload.tipoServico || answers.serviceType || answers.tipoServico)

  if (!serviceType) throw new Error("Tipo de atendimento invalido. Use instalacao, corretiva ou preventiva.")

  const brand = asText(pick(answers, "brand", "marca"))
  const warrantyBrands = ["carrier", "philco", "lg", "midea", "samsung"]
  const losesExtendedWarrantyNotice = brand ? warrantyBrands.includes(brand.toLowerCase()) : null

  return {
    service_type: serviceType,
    customer_name: asText(payload.customerName || customer.name || customer.nome),
    customer_phone: asText(payload.customerPhone || customer.phone || customer.telefone || customer.whatsapp),
    customer_document: asText(payload.customerDocument || customer.document || customer.documento),
    customer_email: asText(payload.customerEmail || customer.email),
    address: asText(payload.addressText || addressPayload.address || addressPayload.endereco || payload.endereco),
    city: asText(payload.city || addressPayload.city || addressPayload.cidade),
    state: asText(payload.state || addressPayload.state || addressPayload.uf || addressPayload.estado),
    source: asText(payload.source || payload.origem || "whatsapp") || "whatsapp",
    status: asText(payload.status || "Novo") || "Novo",
    raw_payload: sanitizeRawPayload(payload),
    agent_notes: asText(payload.agentNotes || payload.observacoesAgente || payload.notes),
    internal_notes: asText(payload.internalNotes),
    equipment_capacity: asText(pick(answers, "equipmentCapacity", "capacidadeEquipamento", "capacidade")),
    property_type: asText(pick(answers, "propertyType", "tipoImovel", "imovel")),
    apartment_floor: asText(pick(answers, "apartmentFloor", "andarApartamento", "andar")),
    has_technical_area: asText(pick(answers, "hasTechnicalArea", "areaTecnica")),
    has_guardrail: asText(pick(answers, "hasGuardrail", "guardaCorpo")),
    house_floor: asText(pick(answers, "houseFloor", "pisoCasa", "terreoOuSegundoPiso")),
    ceiling_height: asText(pick(answers, "ceilingHeight", "peDireito", "alturaPeDireito")),
    has_infrastructure: asText(pick(answers, "hasInfrastructure", "temInfraestrutura", "infraestrutura")),
    installation_type: asText(pick(answers, "installationType", "tipoInstalacao", "furoAFuro")),
    infrastructure_meters_included: asNumber(pick(answers, "infrastructureMetersIncluded", "metrosInfraInclusos")),
    additional_infrastructure_meter_value: asNumber(pick(answers, "additionalInfrastructureMeterValue", "valorMetroInfraAdicional")),
    command_cable_meter_value: asNumber(pick(answers, "commandCableMeterValue", "valorMetroCaboComando")) ?? 2,
    equipment_used: asBoolean(pick(answers, "equipmentUsed", "equipamentoUsado", "usado")),
    brand,
    loses_extended_warranty_notice: losesExtendedWarrantyNotice,
    warranty_notice: losesExtendedWarrantyNotice === true ? "Marca sem autorizada para garantia estendida: Carrier, Philco, LG, Midea ou Samsung." : "",
    issue_description: asText(pick(answers, "issueDescription", "problema", "descricaoProblema")),
    error_code: asText(pick(answers, "errorCode", "codigoErro")),
    corrective_brand: asText(pick(answers, "correctiveBrand", "marcaCorretiva", "marca")),
    corrective_capacity: asText(pick(answers, "correctiveCapacity", "capacidadeCorretiva", "capacidade")),
    corrective_environment: asText(pick(answers, "correctiveEnvironment", "ambienteCorretiva", "ambiente")),
    contract_customer: asBoolean(pick(answers, "contractCustomer", "clienteContrato")),
    schedule_priority: asText(pick(answers, "schedulePriority", "prioridadeAgenda", "prazoAgenda")),
    technical_visit_fee: asNumber(pick(answers, "technicalVisitFee", "taxaVisita")),
    accepted_extended_schedule: asBoolean(pick(answers, "acceptedExtendedSchedule", "aceitouPrazoEstendido")),
    equipment_quantity: asNumber(pick(answers, "equipmentQuantity", "quantidadeEquipamentos", "quantidade")) as number | null,
    preventive_capacities: asText(pick(answers, "preventiveCapacities", "capacidades", "capacidadePreventiva")),
    preventive_ceiling_height: asText(pick(answers, "preventiveCeilingHeight", "peDireitoPreventiva", "peDireito")),
    condenser_access: asText(pick(answers, "condenserAccess", "acessoCondensadoras", "condensadorasFacilAcesso")),
    wants_uninstall: asBoolean(pick(answers, "wantsUninstall", "querDesinstalacao", "desinstalacao")),
    needs_cleaning_certificate: asBoolean(pick(answers, "needsCleaningCertificate", "certificadoLimpeza")),
    needs_art: asBoolean(pick(answers, "needsArt", "art")),
    art_value: asNumber(pick(answers, "artValue", "valorArt")),
    preventive_notes: asText(pick(answers, "preventiveNotes", "observacoesPreventiva")),
  }
}

async function parseRequest(request: Request) {
  const contentType = request.headers.get("content-type") || ""
  if (!contentType.includes("multipart/form-data")) {
    const payload = await request.json()
    return { payload, files: [] as File[] }
  }

  const formData = await request.formData()
  const payload: Record<string, any> = {}
  const files: File[] = []

  for (const [key, value] of formData.entries()) {
    if (value instanceof File) {
      files.push(value)
    } else if (["answers", "customer", "address", "photos", "rawPayload"].includes(key)) {
      payload[key] = parseJson(value, key === "photos" ? [] : {})
    } else {
      payload[key] = value
    }
  }

  return { payload, files }
}

async function uploadFile(supabase: ReturnType<typeof createAdminClient>, requestId: string, file: File) {
  const id = crypto.randomUUID()
  const fileName = safeName(file.name || "foto-whatsapp.jpg")
  const path = `${requestId}/${id}-${fileName}`
  const buffer = Buffer.from(await file.arrayBuffer())
  const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  })
  if (error) throw error
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return { file_url: data.publicUrl, file_name: fileName, file_type: file.type || "file", caption: "" }
}

async function uploadBase64(supabase: ReturnType<typeof createAdminClient>, requestId: string, photo: any) {
  const base64 = String(photo.base64 || photo.data || "")
  const match = base64.match(/^data:([^;]+);base64,(.+)$/)
  const contentType = photo.fileType || photo.mimeType || match?.[1] || "image/jpeg"
  const data = match?.[2] || base64
  const id = crypto.randomUUID()
  const fileName = safeName(photo.fileName || photo.name || `${id}.jpg`)
  const path = `${requestId}/${id}-${fileName}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, Buffer.from(data, "base64"), {
    contentType,
    upsert: false,
  })
  if (error) throw error
  const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
  return { file_url: publicUrl, file_name: fileName, file_type: contentType, caption: asText(photo.caption) }
}

export async function GET() {
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from("whatsapp_budget_requests")
      .select("*, photos:whatsapp_budget_request_photos(*)")
      .order("created_at", { ascending: false })

    if (error) throw error
    return NextResponse.json({ requests: (data || []).map(rowToClient) })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao carregar atendimentos do Whatsapp."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { payload, files } = await parseRequest(request)
    const supabase = createAdminClient()
    await ensureBucket(supabase)

    const row = buildRequestRow(payload)
    const { data: created, error } = await supabase.from("whatsapp_budget_requests").insert(row).select("*").single()
    if (error) throw error

    const photoRows: any[] = []
    for (const file of files) {
      if (file.size > 0) photoRows.push({ request_id: created.id, ...(await uploadFile(supabase, created.id, file)) })
    }

    const photos = Array.isArray(payload.photos) ? payload.photos : []
    for (const photo of photos) {
      if (photo?.url || photo?.fileUrl) {
        photoRows.push({
          request_id: created.id,
          file_url: String(photo.url || photo.fileUrl),
          file_name: asText(photo.fileName || photo.name),
          file_type: asText(photo.fileType || photo.mimeType || "image"),
          caption: asText(photo.caption),
        })
      } else if (photo?.base64 || photo?.data) {
        photoRows.push({ request_id: created.id, ...(await uploadBase64(supabase, created.id, photo)) })
      }
    }

    let createdPhotos: any[] = []
    if (photoRows.length) {
      const insertPhotos = await supabase.from("whatsapp_budget_request_photos").insert(photoRows).select("*")
      if (insertPhotos.error) throw insertPhotos.error
      createdPhotos = insertPhotos.data || []
    }

    return NextResponse.json({ request: rowToClient({ ...created, photos: createdPhotos }) }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao salvar atendimento do Whatsapp."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
