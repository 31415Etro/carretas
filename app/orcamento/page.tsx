"use client"

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import * as XLSX from "xlsx"
import { ArrowLeft, ArrowRight, Building2, CheckCircle2, ChevronDown, ChevronRight, Copy, FileText, FileUp, Folder, MapPin, Plus, Trash2 } from "lucide-react"
import { PageShell, SectionCard } from "@/components/operations/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { useOperationalStore } from "@/components/operations/shared"
import { BudgetPlanViewer, type BudgetPlanPhoto, type BudgetPlanPlacement, type BudgetPlanPointOption, type BudgetPlanRecord } from "@/components/operations/budget-plan-viewer"
import { createClient as createBrowserSupabaseClient } from "@/lib/supabase/client"
import { sortAlphaNumeric } from "@/lib/utils"

type BudgetWork = { id: string; name: string; client: string; clientId?: string; notes: string; createdAt: string }
type BudgetTower = { id: string; workId: string; name: string; description: string }
type BudgetFloor = { id: string; towerId: string; name: string; level: string }
type BudgetType = { id: string; floorId: string; name: string; description: string }
type BudgetEnvironment = { id: string; typeId: string; name: string; pointsQuantity: number; notes: string }
type BudgetPointService = { id: string; name: string }
type BudgetPoint = { id: string; environmentId: string; name: string; number: number; serviceType: string; serviceTypeId?: string; serviceTypes?: BudgetPointService[]; kitId?: string; kitName?: string; infrastructureMeasure?: string; measurementConfirmation?: string; specifications?: string; notes: string }
type PointFormState = { quantity: string; name: string; serviceTypeId: string; services: BudgetPointService[]; kitId: string; infrastructureMeasure: string; measurementConfirmation: string; specifications: string; notes: string }
type BudgetKind = "obra" | "pmoc" | "servicos"
type FloorVisualCategory = "auto" | "garagem" | "terreo" | "lazer" | "tipo" | "tecnico" | "cobertura" | "reservatorio" | "personalizado"
type NodeKind = "root" | "work" | "tower" | "floor" | "type" | "environment" | "point"
type SelectedNode = { kind: NodeKind; id: string }
type SheetMode = "new" | "existing"
type BudgetPageView = "orcamentos" | "whatsapp"
type BudgetEditorMode = "guided" | "tree"
type GuidedStep = "work" | "towers" | "floors" | "types" | "environments" | "points" | "details"

type WhatsappBudgetPhoto = {
  id: string
  requestId: string
  fileUrl: string
  fileName: string
  fileType: string
  caption: string
  createdAt: string
}

type WhatsappBudgetRequest = {
  id: string
  serviceType: "instalacao" | "corretiva" | "preventiva"
  customerName: string
  customerPhone: string
  customerDocument: string
  customerEmail: string
  address: string
  city: string
  state: string
  source: string
  status: string
  agentNotes: string
  internalNotes: string
  equipmentCapacity: string
  propertyType: string
  apartmentFloor: string
  hasTechnicalArea: string
  hasGuardrail: string
  houseFloor: string
  ceilingHeight: string
  hasInfrastructure: string
  installationType: string
  infrastructureMetersIncluded: number | null
  additionalInfrastructureMeterValue: number | null
  commandCableMeterValue: number | null
  equipmentUsed: boolean | null
  brand: string
  losesExtendedWarrantyNotice: boolean | null
  warrantyNotice: string
  issueDescription: string
  errorCode: string
  correctiveBrand: string
  correctiveCapacity: string
  correctiveEnvironment: string
  contractCustomer: boolean | null
  schedulePriority: string
  technicalVisitFee: number | null
  acceptedExtendedSchedule: boolean | null
  equipmentQuantity: number | null
  preventiveCapacities: string
  preventiveCeilingHeight: string
  condenserAccess: string
  wantsUninstall: boolean | null
  needsCleaningCertificate: boolean | null
  needsArt: boolean | null
  artValue: number | null
  preventiveNotes: string
  createdAt: string
  updatedAt: string
  photos: WhatsappBudgetPhoto[]
}

type BudgetState = {
  works: BudgetWork[]
  towers: BudgetTower[]
  floors: BudgetFloor[]
  types: BudgetType[]
  environments: BudgetEnvironment[]
  points: BudgetPoint[]
  plans: BudgetPlanRecord[]
  planPlacements: BudgetPlanPlacement[]
}

const initialState: BudgetState = {
  works: [],
  towers: [],
  floors: [],
  types: [],
  environments: [],
  points: [],
  plans: [],
  planPlacements: [],
}

const budgetKindLabels: Record<BudgetKind, string> = {
  obra: "Obra",
  pmoc: "PMOC",
  servicos: "Serviços diversos",
}

const budgetFrequencies = ["Mensal", "Trimestral", "Semestral", "Anual"]

const guidedSteps: Array<{ id: GuidedStep; label: string; question: string }> = [
  { id: "work", label: "Obra", question: "Qual cliente e qual obra serão cadastrados?" },
  { id: "towers", label: "Torres", question: "Quantas torres deseja criar nesta obra?" },
  { id: "floors", label: "Pavimentos", question: "Quantos pavimentos ou níveis deseja criar nas torres selecionadas?" },
  { id: "types", label: "Finais", question: "Quantos finais deseja criar nos pavimentos selecionados?" },
  { id: "environments", label: "Ambientes", question: "Quantos ambientes deseja criar nos finais selecionados?" },
  { id: "points", label: "Pontos", question: "Quantos pontos deseja criar nos ambientes selecionados?" },
  { id: "details", label: "Configuração", question: "Quais serviços, kit e medida de infraestrutura pertencem a cada ponto?" },
]

const floorVisualCategories: Array<{ value: FloorVisualCategory; label: string }> = [
  { value: "auto", label: "Automático pelo nome" },
  { value: "garagem", label: "Garagem" },
  { value: "terreo", label: "Térreo" },
  { value: "lazer", label: "Lazer" },
  { value: "tipo", label: "Pavimento tipo" },
  { value: "tecnico", label: "Técnico" },
  { value: "cobertura", label: "Cobertura" },
  { value: "reservatorio", label: "Reservatório" },
  { value: "personalizado", label: "Personalizado" },
]

const floorCategoryLabels: Record<Exclude<FloorVisualCategory, "auto">, string> = {
  garagem: "Garagem",
  terreo: "Térreo",
  lazer: "Lazer",
  tipo: "Pavimento tipo",
  tecnico: "Técnico",
  cobertura: "Cobertura",
  reservatorio: "Reservatório",
  personalizado: "Personalizado",
}

function parseFloorVisualMeta(value?: string) {
  const raw = String(value || "")
  const category = raw.match(/__visual_category:([^\n]+)/)?.[1] as FloorVisualCategory | undefined
  const encodedLabel = raw.match(/__visual_label:([^\n]+)/)?.[1] || ""
  let customLabel = ""
  try {
    customLabel = encodedLabel ? decodeURIComponent(encodedLabel) : ""
  } catch {
    customLabel = encodedLabel
  }
  return {
    level: raw.replace(/\n?__visual_(category|label):[^\n]+/g, "").trim(),
    category: floorVisualCategories.some((item) => item.value === category) ? category || "auto" : "auto",
    customLabel,
  }
}

function serializeFloorVisualMeta(level: string, category: FloorVisualCategory, customLabel: string) {
  const meta = category === "auto" ? [] : [`__visual_category:${category}`]
  if (category === "personalizado" && customLabel.trim()) meta.push(`__visual_label:${encodeURIComponent(customLabel.trim())}`)
  return [level.trim(), ...meta].filter(Boolean).join("\n")
}

function inferFloorCategory(floor: BudgetFloor): Exclude<FloorVisualCategory, "auto"> {
  const configured = parseFloorVisualMeta(floor.level).category
  if (configured !== "auto") return configured
  const name = normalizeImportKey(floor.name)
  if (/garagem|subsolo|estacionamento|g\s*\d/.test(name)) return "garagem"
  if (/terreo|recepcao|hall/.test(name)) return "terreo"
  if (/lazer|pilotis|mezanino/.test(name)) return "lazer"
  if (/tecnico|barrilete|maquinas/.test(name)) return "tecnico"
  if (/cobertura|duplex|atico/.test(name)) return "cobertura"
  if (/reservatorio|caixa d agua/.test(name)) return "reservatorio"
  return "tipo"
}

function floorOrderValue(floor: BudgetFloor) {
  const category = inferFloorCategory(floor)
  const meta = parseFloorVisualMeta(floor.level)
  const number = Number(String(meta.level || floor.name).match(/-?\d+(?:[,.]\d+)?/)?.[0]?.replace(",", ".") || 0)
  const base = { garagem: -200, terreo: 0, lazer: 40, personalizado: 80, tipo: 100, tecnico: 100, cobertura: 800, reservatorio: 1000 }[category]
  return base + number
}

const budgetTreeCopy: Record<BudgetKind, { root: string; rootDetail: string; treeTitle: string; treeDescription: string; rootHint: string }> = {
  obra: {
    root: "Orçamentos de obra",
    rootDetail: "Clique para cadastrar uma nova obra",
    treeTitle: "Árvore do orçamento de obra",
    treeDescription: "Obra > Torre > Pavimento > Final > Ambiente > Pontos.",
    rootHint: "Crie uma obra para iniciar a cascata.",
  },
  pmoc: {
    root: "Orçamentos PMOC",
    rootDetail: "Clique para cadastrar um plano PMOC",
    treeTitle: "Árvore do orçamento PMOC",
    treeDescription: "Cliente > Setor > Equipamento > Serviços e frequência.",
    rootHint: "Crie um plano PMOC para iniciar a cascata.",
  },
  servicos: {
    root: "Serviços diversos",
    rootDetail: "Clique para cadastrar serviços diversos",
    treeTitle: "Árvore de serviços diversos",
    treeDescription: "Cliente > Serviços selecionados.",
    rootHint: "Crie um orçamento de serviços diversos para iniciar.",
  },
}

function getBudgetKind(work?: BudgetWork): BudgetKind {
  const match = String(work?.notes || "").match(/__budget_kind:(obra|pmoc|servicos)/)
  return (match?.[1] as BudgetKind) || "obra"
}

function getBudgetMeta(notes: string | undefined, key: string) {
  return String(notes || "").match(new RegExp(`__budget_${key}:([^\\n]+)`))?.[1]?.trim() || ""
}

function stripBudgetMeta(notes?: string) {
  return String(notes || "").replace(/\n?__budget_[a-z_]+:[^\n]+/g, "").trim()
}

function withBudgetMeta(notes: string, kind: BudgetKind, extra: Record<string, string> = {}) {
  const meta = [`__budget_kind:${kind}`, ...Object.entries(extra).filter(([, value]) => value).map(([key, value]) => `__budget_${key}:${value}`)]
  return `${stripBudgetMeta(notes)}\n${meta.join("\n")}`.trim()
}

function serviceOrderFilePointId(notes?: string) {
  return String(notes || "").match(/(?:^|\n)point_id:([^\n]+)/)?.[1]?.trim() || ""
}

function syncEnvironmentPointCounts(state: BudgetState): BudgetState {
  return {
    ...state,
    environments: state.environments.map((environment) => ({
      ...environment,
      pointsQuantity: state.points.filter((point) => point.environmentId === environment.id).length,
    })),
  }
}

function createId(prefix: string) {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function normalizeImportKey(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[ºª°]/g, "")
    .replace(/[\s_.,;:/\\|()[\]{}-]+/g, " ")
    .trim()
}

function compactImportKey(value: unknown) {
  return normalizeImportKey(value).replace(/\s+/g, "")
}

function textCell(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim()
}

function splitImportedServiceName(name: string) {
  const normalized = normalizeImportKey(name)
  if (!normalized) return []
  if (normalized.includes("quebra") && normalized.includes("limpeza") && normalized.includes("interna")) return ["Quebra interna", "Limpeza"]
  if (normalized.includes("quebra") && normalized.includes("limpeza") && normalized.includes("externa")) return ["Quebra externa", "Limpeza"]
  if (normalized.includes("instalacao") && normalized.includes("fixacao") && normalized.includes("infra")) return ["Instalação de infra", "Fixação de infra"]
  return [name]
}

function Field({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string | number; onChange: (value: string) => void; placeholder?: string; type?: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input type={type} value={value} placeholder={placeholder || label} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}

function EmptyRow({ colSpan }: { colSpan: number }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-8 text-center text-muted-foreground">
        Nenhum registro encontrado.
      </TableCell>
    </TableRow>
  )
}

const whatsappServiceLabels: Record<WhatsappBudgetRequest["serviceType"], string> = {
  instalacao: "Instalação",
  corretiva: "Manutenção corretiva",
  preventiva: "Manutenção preventiva",
}

function formatMaybeDate(value?: string) {
  if (!value) return "-"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("pt-BR")
}

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined) return "-"
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

function boolText(value: boolean | null | undefined) {
  if (value === true) return "Sim"
  if (value === false) return "Não"
  return "-"
}

function InfoField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border bg-background p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold">{value || "-"}</p>
    </div>
  )
}

function WhatsappDetail({ request }: { request?: WhatsappBudgetRequest }) {
  if (!request) {
    return (
      <SectionCard title="Detalhes do Whatsapp" description="Selecione um atendimento para ver os campos recebidos do agente.">
        <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">Nenhum atendimento selecionado.</div>
      </SectionCard>
    )
  }

  const installationFields = (
    <>
      <InfoField label="Capacidade do equipamento" value={request.equipmentCapacity} />
      <InfoField label="Casa, apartamento ou sala comercial" value={request.propertyType} />
      <InfoField label="Andar do apartamento" value={request.apartmentFloor} />
      <InfoField label="Área técnica" value={request.hasTechnicalArea} />
      <InfoField label="Guarda corpo" value={request.hasGuardrail} />
      <InfoField label="Térreo ou segundo piso" value={request.houseFloor} />
      <InfoField label="Altura do pé direito" value={request.ceilingHeight} />
      <InfoField label="Infraestrutura existente" value={request.hasInfrastructure} />
      <InfoField label="Tipo de instalação" value={request.installationType} />
      <InfoField label="Metro de infra incluso" value={request.infrastructureMetersIncluded ?? "-"} />
      <InfoField label="Valor metro adicional de infra" value={formatMoney(request.additionalInfrastructureMeterValue)} />
      <InfoField label="Valor metro cabo de comando" value={formatMoney(request.commandCableMeterValue)} />
      <InfoField label="Equipamento usado" value={boolText(request.equipmentUsed)} />
      <InfoField label="Marca" value={request.brand} />
      <InfoField label="Aviso de garantia estendida" value={request.warrantyNotice || boolText(request.losesExtendedWarrantyNotice)} />
    </>
  )

  const correctiveFields = (
    <>
      <InfoField label="Problema informado" value={request.issueDescription} />
      <InfoField label="Código de erro" value={request.errorCode} />
      <InfoField label="Marca" value={request.correctiveBrand || request.brand} />
      <InfoField label="Capacidade" value={request.correctiveCapacity} />
      <InfoField label="Ambiente" value={request.correctiveEnvironment} />
      <InfoField label="Cliente de contrato" value={boolText(request.contractCustomer)} />
      <InfoField label="Prazo/prioridade de agenda" value={request.schedulePriority} />
      <InfoField label="Taxa de visita técnica" value={formatMoney(request.technicalVisitFee)} />
      <InfoField label="Aceitou agenda estendida" value={boolText(request.acceptedExtendedSchedule)} />
    </>
  )

  const preventiveFields = (
    <>
      <InfoField label="Quantidade de equipamentos" value={request.equipmentQuantity ?? "-"} />
      <InfoField label="Capacidades" value={request.preventiveCapacities} />
      <InfoField label="Altura do pé direito" value={request.preventiveCeilingHeight || request.ceilingHeight} />
      <InfoField label="Acesso às condensadoras" value={request.condenserAccess} />
      <InfoField label="Solicitou desinstalação" value={boolText(request.wantsUninstall)} />
      <InfoField label="Certificado de limpeza" value={boolText(request.needsCleaningCertificate)} />
      <InfoField label="Precisa de ART" value={boolText(request.needsArt)} />
      <InfoField label="Valor da ART" value={formatMoney(request.artValue)} />
      <InfoField label="Observações preventiva" value={request.preventiveNotes} />
    </>
  )

  return (
    <SectionCard title="Detalhes do Whatsapp" description="Campos recebidos do agente para o atendimento selecionado.">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <InfoField label="Cliente" value={request.customerName} />
        <InfoField label="Telefone" value={request.customerPhone} />
        <InfoField label="Tipo" value={whatsappServiceLabels[request.serviceType]} />
        <InfoField label="Documento" value={request.customerDocument} />
        <InfoField label="Email" value={request.customerEmail} />
        <InfoField label="Status" value={request.status} />
        <InfoField label="Endereço" value={request.address} />
        <InfoField label="Cidade" value={request.city} />
        <InfoField label="Estado" value={request.state} />
        {request.serviceType === "instalacao" ? installationFields : null}
        {request.serviceType === "corretiva" ? correctiveFields : null}
        {request.serviceType === "preventiva" ? preventiveFields : null}
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <InfoField label="Observações do agente" value={request.agentNotes} />
        <InfoField label="Observações internas" value={request.internalNotes} />
      </div>
      <div className="mt-5">
        <h3 className="mb-3 font-semibold">Fotos recebidas</h3>
        {request.photos.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">Nenhuma foto recebida.</div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {request.photos.map((photo) => (
              <a key={photo.id} href={photo.fileUrl} target="_blank" rel="noreferrer" className="overflow-hidden rounded-xl border bg-background">
                <img src={photo.fileUrl} alt={photo.caption || photo.fileName || "Foto do atendimento"} className="h-40 w-full object-cover" />
                <div className="p-3 text-sm">
                  <p className="truncate font-medium">{photo.caption || photo.fileName || "Foto"}</p>
                  <p className="text-xs text-muted-foreground">{formatMaybeDate(photo.createdAt)}</p>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </SectionCard>
  )
}

function WhatsappPanel({
  requests,
  selectedRequest,
  loading,
  onSelect,
}: {
  requests: WhatsappBudgetRequest[]
  selectedRequest?: WhatsappBudgetRequest
  loading: boolean
  onSelect: (id: string) => void
}) {
  const totals = requests.reduce(
    (acc, request) => {
      acc[request.serviceType] += 1
      return acc
    },
    { instalacao: 0, corretiva: 0, preventiva: 0 },
  )

  return (
    <>
      <SectionCard title="Whatsapp" description="Atendimentos enviados pelo agente de IA do Whatsapp para orçamento.">
        <div className="mb-4 flex flex-wrap gap-2">
          <Badge variant="outline">{loading ? "Carregando..." : `${requests.length} atendimentos`}</Badge>
          <Badge variant="outline">{totals.instalacao} instalações</Badge>
          <Badge variant="outline">{totals.corretiva} corretivas</Badge>
          <Badge variant="outline">{totals.preventiva} preventivas</Badge>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Fotos</TableHead>
                <TableHead>Recebido em</TableHead>
                <TableHead>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.length === 0 ? (
                <EmptyRow colSpan={7} />
              ) : requests.map((request) => (
                <TableRow key={request.id} className={selectedRequest?.id === request.id ? "bg-muted/50" : ""}>
                  <TableCell className="font-medium">{request.customerName || "-"}</TableCell>
                  <TableCell>{request.customerPhone || "-"}</TableCell>
                  <TableCell>{whatsappServiceLabels[request.serviceType]}</TableCell>
                  <TableCell><Badge variant="outline">{request.status || "Novo"}</Badge></TableCell>
                  <TableCell>{request.photos.length}</TableCell>
                  <TableCell>{formatMaybeDate(request.createdAt)}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" onClick={() => onSelect(request.id)}>
                      Ver
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </SectionCard>
      <WhatsappDetail request={selectedRequest} />
    </>
  )
}

function TreeItem({
  id,
  label,
  detail,
  level,
  active,
  expanded,
  hasChildren,
  kind = "folder",
  onSelect,
  onToggle,
  children,
}: {
  id: string
  label: string
  detail?: string
  level: number
  active: boolean
  expanded?: boolean
  hasChildren?: boolean
  kind?: "folder" | "file"
  onSelect: () => void
  onToggle?: () => void
  children?: ReactNode
}) {
  return (
    <div>
      <div
        className={`group flex min-h-10 items-center gap-2 rounded-lg px-2 py-2 text-sm transition ${active ? "bg-muted text-foreground" : "hover:bg-muted/70"}`}
        style={{ paddingLeft: 8 + level * 24 }}
      >
        <button
          type="button"
          className="flex h-5 w-5 items-center justify-center text-muted-foreground"
          onClick={(event) => {
            event.stopPropagation()
            onToggle?.()
          }}
        >
          {hasChildren ? expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" /> : <span className="h-4 w-4" />}
        </button>
        {kind === "folder" ? <Folder className="h-5 w-5 text-muted-foreground" /> : <FileText className="h-5 w-5 text-muted-foreground" />}
        <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-base font-medium">{label}</span>
          {detail ? <span className="block truncate text-xs text-muted-foreground">{detail}</span> : null}
        </button>
      </div>
      {expanded ? children : null}
    </div>
  )
}

export default function OrcamentoPage() {
  const { state: operationalState } = useOperationalStore()
  const [pageView, setPageView] = useState<BudgetPageView>("orcamentos")
  const [state, setState] = useState<BudgetState>(initialState)
  const [whatsappRequests, setWhatsappRequests] = useState<WhatsappBudgetRequest[]>([])
  const [selectedWhatsappId, setSelectedWhatsappId] = useState("")
  const [loadingWhatsapp, setLoadingWhatsapp] = useState(false)
  const [open, setOpen] = useState(false)
  const [sheetMode, setSheetMode] = useState<SheetMode>("new")
  const [activeWorkId, setActiveWorkId] = useState("")
  const [budgetKind, setBudgetKind] = useState<BudgetKind>("obra")
  const [editorMode, setEditorMode] = useState<BudgetEditorMode>("guided")
  const [guidedStep, setGuidedStep] = useState<GuidedStep>("work")
  const [guidedSelectedIds, setGuidedSelectedIds] = useState<string[]>([])
  const [guidedQuantity, setGuidedQuantity] = useState("1")
  const [guidedBaseName, setGuidedBaseName] = useState("")
  const [guidedPointId, setGuidedPointId] = useState("")
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ root: true })
  const [selected, setSelected] = useState<SelectedNode>({ kind: "root", id: "root" })
  const [workForm, setWorkForm] = useState({ clientId: "", client: "", name: "", notes: "", clientEnvironmentId: "", clientEquipmentId: "" })
  const [towerForm, setTowerForm] = useState({ name: "", description: "" })
  const [floorForm, setFloorForm] = useState<{ name: string; level: string; visualCategory: FloorVisualCategory; visualLabel: string }>({ name: "", level: "", visualCategory: "auto", visualLabel: "" })
  const [typeForm, setTypeForm] = useState({ name: "", description: "" })
  const [environmentForm, setEnvironmentForm] = useState({ name: "", notes: "" })
  const [pointForm, setPointForm] = useState<PointFormState>({ quantity: "1", name: "", serviceTypeId: "", services: [], kitId: "", infrastructureMeasure: "", measurementConfirmation: "", specifications: "", notes: "" })
  const [pmocServiceForm, setPmocServiceForm] = useState({ serviceTypeId: "", frequency: "Mensal", notes: "" })
  const [diverseServiceForm, setDiverseServiceForm] = useState({ serviceTypeId: "", frequency: "Único", notes: "" })
  const [savedAt, setSavedAt] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [importingBudget, setImportingBudget] = useState(false)
  const [uploadingPlan, setUploadingPlan] = useState(false)
  const [activePlanId, setActivePlanId] = useState("")
  const [planTowerId, setPlanTowerId] = useState("")
  const [planFloorId, setPlanFloorId] = useState("")
  const [planPointId, setPlanPointId] = useState("")
  const budgetImportInputRef = useRef<HTMLInputElement | null>(null)
  const planInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    loadBudgets()
  }, [])

  useEffect(() => {
    if (pageView === "whatsapp") loadWhatsappRequests()
  }, [pageView])

  useEffect(() => {
    const plans = state.plans.filter((plan) => plan.workId === activeWorkId)
    if (!plans.some((plan) => plan.id === activePlanId)) setActivePlanId(plans[0]?.id || "")
  }, [activeWorkId, activePlanId, state.plans])

  async function loadBudgets() {
    try {
      setLoading(true)
      const response = await fetch("/api/budget-contracts", { cache: "no-store" })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Erro ao carregar orçamentos.")
      setState({ ...initialState, ...(data.budget || {}) })
      setSelected({ kind: "root", id: "root" })
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Erro ao carregar orçamentos.")
    } finally {
      setLoading(false)
    }
  }

  async function loadWhatsappRequests() {
    try {
      setLoadingWhatsapp(true)
      const response = await fetch("/api/orcamento/whatsapp", { cache: "no-store" })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Erro ao carregar atendimentos do Whatsapp.")
      const requests = data.requests || []
      setWhatsappRequests(requests)
      setSelectedWhatsappId((current) => current || requests[0]?.id || "")
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Erro ao carregar atendimentos do Whatsapp.")
    } finally {
      setLoadingWhatsapp(false)
    }
  }

  async function persistBudget(nextState: BudgetState) {
    setSaving(true)
    try {
      const response = await fetch("/api/budget-contracts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ budget: nextState }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || "Erro ao salvar orçamento.")
      setSavedAt(new Date().toLocaleString("pt-BR"))
    } finally {
      setSaving(false)
    }
  }

  async function attachPlan(file?: File | null) {
    if (!file || !activeWork) return
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      window.alert("Selecione um arquivo PDF.")
      return
    }
    if (file.size > 50 * 1024 * 1024) {
      window.alert("O PDF deve ter no maximo 50 MB.")
      return
    }
    setUploadingPlan(true)
    try {
      let pageCount = 1
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
        if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString()
        const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
        pageCount = document.numPages || 1
        await document.destroy()
      } catch {
        pageCount = 1
      }
      const prepareResponse = await fetch("/api/budget-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "prepare", workId: activeWork.id, towerId: planTowerId, fileName: file.name, fileSize: file.size }),
      })
      const prepared = await prepareResponse.json().catch(() => ({}))
      if (!prepareResponse.ok) throw new Error(prepared.error || "Erro ao preparar o envio da planta.")

      const upload = prepared.upload
      const supabase = createBrowserSupabaseClient()
      const { error: uploadError } = await supabase.storage.from("budget-plans").uploadToSignedUrl(upload.storagePath, upload.token, file, { contentType: "application/pdf", upsert: false })
      if (uploadError) throw new Error(`Erro ao enviar PDF para o Supabase: ${uploadError.message}`)

      const finalizeResponse = await fetch("/api/budget-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "finalize", id: upload.id, storagePath: upload.storagePath, fileName: upload.fileName, workId: activeWork.id, towerId: planTowerId, name: file.name.replace(/\.pdf$/i, ""), pageCount }),
      })
      const finalized = await finalizeResponse.json().catch(() => ({}))
      if (!finalizeResponse.ok) throw new Error(finalized.error || "Erro ao registrar a planta no orcamento.")
      const plan = finalized.plan as BudgetPlanRecord
      setState((current) => ({ ...current, plans: [plan, ...current.plans] }))
      setActivePlanId(plan.id)
      setSavedAt(new Date().toLocaleString("pt-BR"))
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Erro ao anexar planta.")
    } finally {
      setUploadingPlan(false)
      if (planInputRef.current) planInputRef.current.value = ""
    }
  }

  async function placePlanPoint(pointId: string, pageNumber: number, x: number, y: number) {
    if (!activePlanId) return
    try {
      const current = state.planPlacements.find((placement) => placement.planId === activePlanId && placement.pointId === pointId)
      const response = await fetch("/api/budget-plans", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: current?.id, planId: activePlanId, pointId, pageNumber, x, y }) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || "Erro ao salvar posicao do ponto.")
      const placement = data.placement as BudgetPlanPlacement
      setState((currentState) => ({ ...currentState, planPlacements: [placement, ...currentState.planPlacements.filter((item) => !(item.planId === placement.planId && item.pointId === placement.pointId))] }))
      setSavedAt(new Date().toLocaleString("pt-BR"))
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Erro ao salvar posicao do ponto.")
    }
  }

  async function removePlanPlacement(placement: BudgetPlanPlacement) {
    try {
      const response = await fetch(`/api/budget-plans?placementId=${encodeURIComponent(placement.id)}`, { method: "DELETE" })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || "Erro ao remover marcacao.")
      setState((current) => ({ ...current, planPlacements: current.planPlacements.filter((item) => item.id !== placement.id) }))
      setSavedAt(new Date().toLocaleString("pt-BR"))
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Erro ao remover marcacao.")
    }
  }

  async function deletePlan(plan: BudgetPlanRecord) {
    if (!window.confirm(`Excluir a planta ${plan.name}?`)) return
    try {
      const response = await fetch(`/api/budget-plans?planId=${encodeURIComponent(plan.id)}`, { method: "DELETE" })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || "Erro ao excluir planta.")
      setState((current) => ({ ...current, plans: current.plans.filter((item) => item.id !== plan.id), planPlacements: current.planPlacements.filter((item) => item.planId !== plan.id) }))
      setActivePlanId("")
      setSavedAt(new Date().toLocaleString("pt-BR"))
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Erro ao excluir planta.")
    }
  }

  function serviceAvailableForObra(service: any) {
    const contexts = Array.isArray(service?.enabledContexts) && service.enabledContexts.length ? service.enabledContexts : ["obra"]
    return contexts.includes("obra")
  }

  function findImportedService(name: string) {
    const candidates = registeredServiceTypes.filter((service: any) => serviceAvailableForObra(service))
    const normalized = normalizeImportKey(name)
    const compact = compactImportKey(name)
    return candidates.find((service) => normalizeImportKey(service.name) === normalized)
      || candidates.find((service) => compactImportKey(service.name) === compact)
      || candidates.find((service) => {
        const serviceKey = normalizeImportKey(service.name)
        return serviceKey && (normalized.includes(serviceKey) || serviceKey.includes(normalized))
      })
  }

  function findImportedKit(name: string) {
    const normalized = normalizeImportKey(name)
    const compact = compactImportKey(name)
    const kitNumber = String(name || "").match(/kit\s*([0-9]+(?:[,.][0-9]+)?)/i)?.[1]?.replace(".", ",")
    return availableStockKits.find((kit) => normalizeImportKey(kit.name) === normalized)
      || availableStockKits.find((kit) => compactImportKey(kit.name) === compact)
      || (kitNumber ? availableStockKits.find((kit) => {
        const kitName = normalizeImportKey(kit.name)
        return kitName === `kit ${kitNumber}` || kitName.startsWith(`kit ${kitNumber} `) || kitName.includes(`kit ${kitNumber} `)
      }) : undefined)
  }

  async function importBudgetSpreadsheet(file?: File | null) {
    if (!file) return
    setImportingBudget(true)
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      if (!sheet) throw new Error("A planilha não possui abas.")
      const rows = XLSX.utils.sheet_to_json<Array<string | number>>(sheet, { header: 1, defval: "", raw: false })
      const header = (rows[0] || []).map((cell) => textCell(cell))
      const body = rows.slice(1).filter((row) => row.some((cell) => textCell(cell)))
      const col = (name: string) => header.findIndex((item) => normalizeImportKey(item) === normalizeImportKey(name))
      const serviceColumns = header
        .map((name, index) => ({ name, index }))
        .filter((item) => normalizeImportKey(item.name) === "tipo de servico")
        .map((item) => item.index)
      const clientCol = col("Cliente")
      const workCol = col("Obra")
      const towerCol = col("Torre")
      const floorCol = col("Pavimento")
      const finalCol = col("Final")
      const environmentCol = col("Ambiente")
      const pointCol = col("Ponto")
      const kitCol = col("Kit")
      const required = [
        ["Cliente", clientCol],
        ["Obra", workCol],
        ["Torre", towerCol],
        ["Pavimento", floorCol],
        ["Final", finalCol],
        ["Ambiente", environmentCol],
        ["Ponto", pointCol],
      ]
      const missingColumns = required.filter(([, index]) => Number(index) < 0).map(([name]) => name)
      if (missingColumns.length) throw new Error(`Colunas não encontradas: ${missingColumns.join(", ")}.`)

      const next: BudgetState = {
        works: [...state.works],
        towers: [...state.towers],
        floors: [...state.floors],
        types: [...state.types],
        environments: [...state.environments],
        points: [...state.points],
        plans: [...state.plans],
        planPlacements: [...state.planPlacements],
      }
      const workMap = new Map(next.works.map((item) => [normalizeImportKey(`${item.client}|${item.name}`), item]))
      const towerMap = new Map(next.towers.map((item) => [normalizeImportKey(`${item.workId}|${item.name}`), item]))
      const floorMap = new Map(next.floors.map((item) => [normalizeImportKey(`${item.towerId}|${item.name}`), item]))
      const typeMap = new Map(next.types.map((item) => [normalizeImportKey(`${item.floorId}|${item.name}`), item]))
      const environmentMap = new Map(next.environments.map((item) => [normalizeImportKey(`${item.typeId}|${item.name}`), item]))
      const pointMap = new Map(next.points.map((item) => [normalizeImportKey(`${item.environmentId}|${item.name}`), item]))
      const unmatchedServices = new Set<string>()
      const unmatchedKits = new Set<string>()
      let importedRows = 0

      body.forEach((row) => {
        const client = textCell(row[clientCol])
        const workName = textCell(row[workCol])
        const towerName = textCell(row[towerCol])
        const floorName = textCell(row[floorCol])
        const finalName = textCell(row[finalCol])
        const environmentName = textCell(row[environmentCol])
        const pointName = textCell(row[pointCol])
        if (!client || !workName || !towerName || !floorName || !finalName || !environmentName || !pointName) return

        const clientRecord = registeredClients.find((item) => normalizeImportKey(item.name) === normalizeImportKey(client))
          || registeredClients.find((item) => normalizeImportKey(item.tradeName) === normalizeImportKey(client) || normalizeImportKey(item.corporateName) === normalizeImportKey(client))
        const workKey = normalizeImportKey(`${client}|${workName}`)
        let work = workMap.get(workKey)
        if (!work) {
          work = { id: createId("budget-work-import"), clientId: clientRecord?.id || "", client, name: workName, notes: withBudgetMeta("Importado por planilha.", "obra"), createdAt: new Date().toISOString() }
          next.works.push(work)
          workMap.set(workKey, work)
        }

        const towerKey = normalizeImportKey(`${work.id}|${towerName}`)
        let tower = towerMap.get(towerKey)
        if (!tower) {
          tower = { id: createId("budget-tower-import"), workId: work.id, name: towerName, description: "" }
          next.towers.push(tower)
          towerMap.set(towerKey, tower)
        }

        const floorKey = normalizeImportKey(`${tower.id}|${floorName}`)
        let floor = floorMap.get(floorKey)
        if (!floor) {
          floor = { id: createId("budget-floor-import"), towerId: tower.id, name: floorName, level: "" }
          next.floors.push(floor)
          floorMap.set(floorKey, floor)
        }

        const typeKey = normalizeImportKey(`${floor.id}|${finalName}`)
        let type = typeMap.get(typeKey)
        if (!type) {
          type = { id: createId("budget-final-import"), floorId: floor.id, name: finalName, description: "" }
          next.types.push(type)
          typeMap.set(typeKey, type)
        }

        const environmentKey = normalizeImportKey(`${type.id}|${environmentName}`)
        let environment = environmentMap.get(environmentKey)
        if (!environment) {
          environment = { id: createId("budget-env-import"), typeId: type.id, name: environmentName, pointsQuantity: 0, notes: "" }
          next.environments.push(environment)
          environmentMap.set(environmentKey, environment)
        }

        const services = serviceColumns
          .flatMap((index) => splitImportedServiceName(textCell(row[index])))
          .map((name) => ({ name, service: findImportedService(name) }))
          .filter((item) => {
            if (!item.name) return false
            if (!item.service) unmatchedServices.add(item.name)
            return Boolean(item.service)
          })
          .map((item) => ({ id: item.service!.id, name: item.service!.name }))
        const uniqueServices = Array.from(new Map(services.map((service) => [service.id, service])).values())
        const kitName = kitCol >= 0 ? textCell(row[kitCol]) : ""
        const kit = kitName ? findImportedKit(kitName) : undefined
        if (kitName && !kit) unmatchedKits.add(kitName)
        const pointKey = normalizeImportKey(`${environment.id}|${pointName}`)
        const existingPoint = pointMap.get(pointKey)
        const pointServices = uniqueServices.length ? uniqueServices : existingPoint?.serviceTypes || []
        const pointNumber = existingPoint?.number || next.points.filter((point) => point.environmentId === environment!.id).length + 1
        const pointData: BudgetPoint = {
          id: existingPoint?.id || createId("budget-point-import"),
          environmentId: environment.id,
          name: pointName,
          number: pointNumber,
          serviceType: pointServices.map((service) => service.name).join("; "),
          serviceTypeId: pointServices[0]?.id || "",
          serviceTypes: pointServices,
          kitId: kit?.id || existingPoint?.kitId || "",
          kitName: kit?.name || kitName || existingPoint?.kitName || "",
          infrastructureMeasure: existingPoint?.infrastructureMeasure || "",
          measurementConfirmation: existingPoint?.measurementConfirmation || "",
          specifications: existingPoint?.specifications || "",
          notes: existingPoint?.notes || "",
        }
        if (existingPoint) {
          Object.assign(existingPoint, pointData)
        } else {
          next.points.push(pointData)
          pointMap.set(pointKey, pointData)
        }
        importedRows += 1
      })

      const synced = syncEnvironmentPointCounts(next)
      await persistBudget(synced)
      setState(synced)
      setSelected({ kind: "root", id: "root" })
      setExpanded({ root: true })
      const warning = [
        unmatchedServices.size ? `Serviços não encontrados: ${Array.from(unmatchedServices).slice(0, 12).join(", ")}${unmatchedServices.size > 12 ? "..." : ""}` : "",
        unmatchedKits.size ? `Kits não encontrados: ${Array.from(unmatchedKits).slice(0, 12).join(", ")}${unmatchedKits.size > 12 ? "..." : ""}` : "",
      ].filter(Boolean).join("\n")
      window.alert(`Importação concluída: ${importedRows} linhas processadas, ${synced.works.length} orçamento(s), ${synced.points.length} ponto(s).\n${warning}`)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Erro ao importar orçamento.")
    } finally {
      setImportingBudget(false)
      if (budgetImportInputRef.current) budgetImportInputRef.current.value = ""
    }
  }

  const selectedWork = selected.kind === "work" ? state.works.find((item) => item.id === selected.id) : undefined
  const selectedTower = selected.kind === "tower" ? state.towers.find((item) => item.id === selected.id) : undefined
  const selectedFloor = selected.kind === "floor" ? state.floors.find((item) => item.id === selected.id) : undefined
  const selectedType = selected.kind === "type" ? state.types.find((item) => item.id === selected.id) : undefined
  const selectedEnvironment = selected.kind === "environment" ? state.environments.find((item) => item.id === selected.id) : undefined
  const selectedPoint = selected.kind === "point" ? state.points.find((item) => item.id === selected.id) : undefined
  const registeredClients = sortAlphaNumeric(operationalState.clients.filter((client) => client.status !== "Inativo"), (client) => client.name)
  const registeredServiceTypes = sortAlphaNumeric(operationalState.serviceTypes.filter((service) => service.status === "Ativo"), (service) => service.name)
  const registeredClientEnvironments = sortAlphaNumeric((operationalState.clientEnvironments || []).filter((environment) => environment.status === "Ativo" && (!workForm.clientId || environment.clientId === workForm.clientId)), (environment) => `${environment.name} ${environment.floor || ""}`)
  const registeredClientEquipment = sortAlphaNumeric((operationalState.clientEquipment || []).filter((equipment) => equipment.status === "Ativo" && (!workForm.clientId || equipment.clientId === workForm.clientId) && (!workForm.clientEnvironmentId || equipment.clientEnvironmentId === workForm.clientEnvironmentId)), (equipment) => `${equipment.name} ${equipment.model || ""}`)
  const availableStockKits = sortAlphaNumeric(operationalState.stockKits.filter((kit) => kit.status === "Ativo"), (kit) => kit.name)

  const allPoints = useMemo(() => state.points, [state.points])
  const activeWork = activeWorkId ? state.works.find((work) => work.id === activeWorkId) : undefined
  const activeBudgetKind = selected.kind === "root" ? budgetKind : getBudgetKind(activeWork || selectedWork)
  const currentEditorKind = activeWork ? getBudgetKind(activeWork) : budgetKind
  const useGuidedEditor = currentEditorKind === "obra" && editorMode === "guided"
  const selectedWhatsappRequest = whatsappRequests.find((request) => request.id === selectedWhatsappId) || whatsappRequests[0]

  function resetForms() {
    setWorkForm({ clientId: "", client: "", name: "", notes: "", clientEnvironmentId: "", clientEquipmentId: "" })
    setTowerForm({ name: "", description: "" })
    setFloorForm({ name: "", level: "", visualCategory: "auto", visualLabel: "" })
    setTypeForm({ name: "", description: "" })
    setEnvironmentForm({ name: "", notes: "" })
    setPointForm({ quantity: "1", name: "", serviceTypeId: "", services: [], kitId: "", infrastructureMeasure: "", measurementConfirmation: "", specifications: "", notes: "" })
    setPmocServiceForm({ serviceTypeId: "", frequency: "Mensal", notes: "" })
    setDiverseServiceForm({ serviceTypeId: "", frequency: "Único", notes: "" })
  }

  function openNewBudget() {
    setSheetMode("new")
    setActiveWorkId("")
    setBudgetKind("obra")
    setEditorMode("guided")
    setGuidedStep("work")
    setGuidedSelectedIds([])
    setGuidedQuantity("1")
    setGuidedBaseName("")
    setGuidedPointId("")
    setSelected({ kind: "root", id: "root" })
    setExpanded({ root: true })
    setSavedAt("")
    setActivePlanId("")
    setPlanTowerId("")
    setPlanFloorId("")
    setPlanPointId("")
    resetForms()
    setOpen(true)
  }

  function openExistingBudget(workId: string, requestedMode: BudgetEditorMode = "guided") {
    const work = state.works.find((item) => item.id === workId)
    setSheetMode("existing")
    setActiveWorkId(workId)
    setBudgetKind(getBudgetKind(work))
    setEditorMode(getBudgetKind(work) === "obra" ? requestedMode : "tree")
    setGuidedStep(getBudgetKind(work) === "obra" ? "towers" : "work")
    setGuidedSelectedIds([])
    setGuidedQuantity("1")
    setGuidedBaseName("")
    setGuidedPointId("")
    setSelected({ kind: "work", id: workId })
    setExpanded((current) => ({ ...current, root: true, [workId]: true }))
    setSavedAt("")
    const firstTower = state.towers.find((tower) => tower.workId === workId)
    const firstFloor = state.floors.find((floor) => floor.towerId === firstTower?.id)
    setActivePlanId(state.plans.find((plan) => plan.workId === workId)?.id || "")
    setPlanTowerId(firstTower?.id || "")
    setPlanFloorId(firstFloor?.id || "")
    setPlanPointId("")
    resetForms()
    if (work) {
      setWorkForm({ clientId: work.clientId || "", client: work.client || "", name: work.name || "", notes: stripBudgetMeta(work.notes || ""), clientEnvironmentId: getBudgetMeta(work.notes, "client_environment_id"), clientEquipmentId: getBudgetMeta(work.notes, "client_equipment_id") })
    }
    setOpen(true)
  }

  function toggle(id: string) {
    setExpanded((current) => ({ ...current, [id]: !current[id] }))
  }

  function loadNodeForm(node: SelectedNode) {
    if (node.kind === "root") {
      resetForms()
      return
    }
    if (node.kind === "work") {
      const item = state.works.find((work) => work.id === node.id)
      if (item) {
        setBudgetKind(getBudgetKind(item))
        setWorkForm({ clientId: item.clientId || "", client: item.client || "", name: item.name || "", notes: stripBudgetMeta(item.notes || ""), clientEnvironmentId: getBudgetMeta(item.notes, "client_environment_id"), clientEquipmentId: getBudgetMeta(item.notes, "client_equipment_id") })
      }
      return
    }
    if (node.kind === "tower") {
      const item = state.towers.find((tower) => tower.id === node.id)
      if (item) setTowerForm({ name: item.name || "", description: item.description || "" })
      return
    }
    if (node.kind === "floor") {
      const item = state.floors.find((floor) => floor.id === node.id)
      if (item) {
        const visual = parseFloorVisualMeta(item.level)
        setFloorForm({ name: item.name || "", level: visual.level, visualCategory: visual.category, visualLabel: visual.customLabel })
      }
      return
    }
    if (node.kind === "type") {
      const item = state.types.find((type) => type.id === node.id)
      if (item) setTypeForm({ name: item.name || "", description: item.description || "" })
      return
    }
    if (node.kind === "environment") {
      const item = state.environments.find((environment) => environment.id === node.id)
      if (item) setEnvironmentForm({ name: item.name || "", notes: item.notes || "" })
      return
    }
    if (node.kind === "point") {
      const item = state.points.find((point) => point.id === node.id)
      if (item) {
        const services = item.serviceTypes?.length
          ? item.serviceTypes
          : item.serviceType
            ? item.serviceType.split(";").map((name) => ({ id: name.trim(), name: name.trim() })).filter((service) => service.name)
            : []
        setPointForm({
          quantity: "1",
          name: item.name || "",
          serviceTypeId: "",
          services,
          kitId: item.kitId || "",
          infrastructureMeasure: item.infrastructureMeasure || "",
          measurementConfirmation: item.measurementConfirmation || "",
          specifications: item.specifications || "",
          notes: item.notes || "",
        })
      }
    }
  }

  function openNode(node: SelectedNode) {
    setSelected(node)
    loadNodeForm(node)
    setExpanded((current) => ({ ...current, [node.id]: true }))
  }

  function changeBudgetKind(kind: BudgetKind) {
    setBudgetKind(kind)
    setEditorMode(kind === "obra" ? "guided" : "tree")
    setGuidedStep("work")
    setGuidedSelectedIds([])
    if (selected.kind === "root") {
      setActiveWorkId("")
      resetForms()
      setExpanded({ root: true })
    }
  }

  function addWork() {
    const selectedClient = registeredClients.find((client) => client.id === workForm.clientId)
    if (!selectedClient) {
      window.alert("Selecione um cliente cadastrado.")
      return ""
    }
    if (!workForm.name.trim()) {
      window.alert(`Informe o nome do orçamento de ${budgetKindLabels[budgetKind]}.`)
      return ""
    }
    if (budgetKind === "servicos" && !workForm.clientEnvironmentId) {
      window.alert("Selecione o ambiente do cliente.")
      return ""
    }
    if (budgetKind === "servicos" && !workForm.clientEquipmentId) {
      window.alert("Selecione o equipamento/máquina.")
      return ""
    }
    const work = { id: createId("work"), name: workForm.name.trim(), clientId: selectedClient.id, client: selectedClient.name, notes: withBudgetMeta(workForm.notes, budgetKind, { client_environment_id: workForm.clientEnvironmentId, client_equipment_id: workForm.clientEquipmentId }), createdAt: new Date().toISOString() }
    setState((current) => ({ ...current, works: [work, ...current.works] }))
    setActiveWorkId(work.id)
    setExpanded((current) => ({ ...current, root: true, [work.id]: true }))
    setSelected({ kind: "work", id: work.id })
    setWorkForm({ clientId: "", client: "", name: "", notes: "", clientEnvironmentId: "", clientEquipmentId: "" })
    return work.id
  }

  function addTower() {
    if (selected.kind !== "work") return window.alert("Clique em uma obra para cadastrar torres.")
    const kind = getBudgetKind(selectedWork)
    if (!towerForm.name.trim()) return window.alert(kind === "pmoc" ? "Informe o setor." : "Informe o nome da torre.")
    const tower = { id: createId("tower"), workId: selected.id, name: towerForm.name.trim(), description: towerForm.description.trim() }
    setState((current) => ({ ...current, towers: [tower, ...current.towers] }))
    setExpanded((current) => ({ ...current, [selected.id]: true, [tower.id]: true }))
    setSelected({ kind: "tower", id: tower.id })
    setTowerForm({ name: "", description: "" })
  }

  function addDiverseService() {
    if (selected.kind !== "work") return window.alert("Clique no orçamento para adicionar serviços.")
    const service = registeredServiceTypes.find((item) => item.id === diverseServiceForm.serviceTypeId)
    if (!service) return window.alert("Selecione um serviço cadastrado.")
    const item = {
      id: createId("diverse-service"),
      workId: selected.id,
      name: service.name,
      description: `${diverseServiceForm.frequency}${diverseServiceForm.notes ? ` | ${diverseServiceForm.notes}` : ""}`,
    }
    setState((current) => ({ ...current, towers: [item, ...current.towers] }))
    setExpanded((current) => ({ ...current, [selected.id]: true }))
    setDiverseServiceForm({ serviceTypeId: "", frequency: "Único", notes: "" })
  }

  function addFloor() {
    if (selected.kind !== "tower") return window.alert("Clique em uma torre para cadastrar pavimentos.")
    const work = state.works.find((item) => item.id === selectedTower?.workId)
    const kind = getBudgetKind(work)
    if (!floorForm.name.trim()) return window.alert(kind === "pmoc" ? "Informe o equipamento." : "Informe o pavimento.")
    const floor = { id: createId("floor"), towerId: selected.id, name: floorForm.name.trim(), level: serializeFloorVisualMeta(floorForm.level, floorForm.visualCategory, floorForm.visualLabel) }
    setState((current) => ({ ...current, floors: [floor, ...current.floors] }))
    setExpanded((current) => ({ ...current, [selected.id]: true, [floor.id]: true }))
    setSelected({ kind: "floor", id: floor.id })
    setFloorForm({ name: "", level: "", visualCategory: "auto", visualLabel: "" })
  }

  function addPmocService() {
    if (selected.kind !== "floor") return window.alert("Clique em um equipamento para vincular serviços.")
    const service = registeredServiceTypes.find((item) => item.id === pmocServiceForm.serviceTypeId)
    if (!service) return window.alert("Selecione um serviço cadastrado.")
    const serviceNode = {
      id: createId("pmoc-service"),
      floorId: selected.id,
      name: service.name,
      description: `${pmocServiceForm.frequency}${pmocServiceForm.notes ? ` | ${pmocServiceForm.notes}` : ""}`,
    }
    setState((current) => ({ ...current, types: [serviceNode, ...current.types] }))
    setExpanded((current) => ({ ...current, [selected.id]: true, [serviceNode.id]: true }))
    setSelected({ kind: "type", id: serviceNode.id })
    setPmocServiceForm({ serviceTypeId: "", frequency: "Mensal", notes: "" })
  }

  function addType() {
    if (selected.kind !== "floor") return window.alert("Clique em um pavimento para cadastrar finais.")
    if (!typeForm.name.trim()) return window.alert("Informe o final.")
    const type = { id: createId("type"), floorId: selected.id, name: typeForm.name.trim(), description: typeForm.description.trim() }
    setState((current) => ({ ...current, types: [type, ...current.types] }))
    setExpanded((current) => ({ ...current, [selected.id]: true, [type.id]: true }))
    setSelected({ kind: "type", id: type.id })
    setTypeForm({ name: "", description: "" })
  }

  function addEnvironment() {
    if (selected.kind !== "type") return window.alert("Clique em um final para cadastrar ambientes.")
    if (!environmentForm.name.trim()) return window.alert("Informe o ambiente.")
    const environment = { id: createId("env"), typeId: selected.id, name: environmentForm.name.trim(), pointsQuantity: 0, notes: environmentForm.notes.trim() }
    setState((current) => ({ ...current, environments: [environment, ...current.environments] }))
    setExpanded((current) => ({ ...current, [selected.id]: true, [environment.id]: true }))
    setSelected({ kind: "environment", id: environment.id })
    setEnvironmentForm({ name: "", notes: "" })
  }

  async function addPoints() {
    if (selected.kind !== "environment") return window.alert("Clique em um ambiente para cadastrar pontos.")
    const quantity = Math.max(1, Number(pointForm.quantity) || 1)
    if (!pointForm.services.length) return window.alert("Adicione pelo menos um serviço ao ponto.")
    const currentPoints = state.points.filter((point) => point.environmentId === selected.id)
    const environment = state.environments.find((item) => item.id === selected.id)
    const selectedKit = availableStockKits.find((kit) => kit.id === pointForm.kitId)
    const serviceNames = pointForm.services.map((service) => service.name)
    const createdPoints = Array.from({ length: quantity }).map((_, index) => {
      const number = currentPoints.length + index + 1
      return {
        id: createId(`point-${number}`),
        environmentId: selected.id,
        name: pointForm.name.trim() ? `${pointForm.name.trim()} ${number}` : `Ponto ${number}`,
        number,
        serviceType: serviceNames.join("; "),
        serviceTypeId: pointForm.services[0]?.id || "",
        serviceTypes: pointForm.services,
        kitId: selectedKit?.id || "",
        kitName: selectedKit?.name || "",
        infrastructureMeasure: pointForm.infrastructureMeasure.trim(),
        measurementConfirmation: pointForm.measurementConfirmation.trim(),
        specifications: pointForm.specifications.trim(),
        notes: pointForm.notes.trim(),
      }
    })
    const nextState = syncEnvironmentPointCounts({
      ...state,
      points: [...state.points, ...createdPoints],
    })
    try {
      await persistBudget(nextState)
      setState(nextState)
      setExpanded((current) => ({ ...current, [selected.id]: true }))
      setPointForm({ quantity: "1", name: "", serviceTypeId: "", services: [], kitId: "", infrastructureMeasure: "", measurementConfirmation: "", specifications: "", notes: "" })
      window.alert(`${createdPoints.length} ponto(s) salvo(s) no banco de dados.`)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Erro ao salvar os pontos no banco de dados.")
    }
  }

  function addServiceToPoint() {
    const service = registeredServiceTypes.find((item) => item.id === pointForm.serviceTypeId)
    if (!service) return window.alert("Selecione um serviço cadastrado.")
    setPointForm((current) => ({
      ...current,
      serviceTypeId: "",
      services: [...current.services, { id: service.id, name: service.name }],
    }))
  }

  function removeServiceFromPoint(index: number) {
    setPointForm((current) => ({
      ...current,
      services: current.services.filter((_, itemIndex) => itemIndex !== index),
    }))
  }

  function pointWithForm(point: BudgetPoint, form: PointFormState) {
    const selectedKit = availableStockKits.find((kit) => kit.id === form.kitId)
    return {
      ...point,
      name: form.name.trim(),
      serviceType: form.services.map((service) => service.name).join("; "),
      serviceTypeId: form.services[0]?.id || "",
      serviceTypes: form.services,
      kitId: selectedKit?.id || "",
      kitName: selectedKit?.name || "",
      infrastructureMeasure: form.infrastructureMeasure.trim(),
      measurementConfirmation: form.measurementConfirmation.trim(),
      specifications: form.specifications.trim(),
      notes: form.notes.trim(),
    }
  }

  async function updateSelectedNode() {
    if (selected.kind === "root") return
    if (selected.kind === "work") {
      const selectedClient = registeredClients.find((client) => client.id === workForm.clientId)
      if (!selectedClient) return window.alert("Selecione um cliente cadastrado.")
      if (!workForm.name.trim()) return window.alert("Informe o nome da obra/orçamento.")
      setState((current) => ({
        ...current,
        works: current.works.map((item) => item.id === selected.id
          ? { ...item, clientId: selectedClient.id, client: selectedClient.name, name: workForm.name.trim(), notes: withBudgetMeta(workForm.notes, getBudgetKind(item), { client_environment_id: workForm.clientEnvironmentId, client_equipment_id: workForm.clientEquipmentId }) }
          : item),
      }))
      return
    }
    if (selected.kind === "tower") {
      if (!towerForm.name.trim()) return window.alert("Informe o nome.")
      setState((current) => ({
        ...current,
        towers: current.towers.map((item) => item.id === selected.id ? { ...item, name: towerForm.name.trim(), description: towerForm.description.trim() } : item),
      }))
      return
    }
    if (selected.kind === "floor") {
      if (!floorForm.name.trim()) return window.alert("Informe o nome.")
      setState((current) => ({
        ...current,
        floors: current.floors.map((item) => item.id === selected.id ? { ...item, name: floorForm.name.trim(), level: serializeFloorVisualMeta(floorForm.level, floorForm.visualCategory, floorForm.visualLabel) } : item),
      }))
      return
    }
    if (selected.kind === "type") {
      if (!typeForm.name.trim()) return window.alert("Informe o nome.")
      setState((current) => ({
        ...current,
        types: current.types.map((item) => item.id === selected.id ? { ...item, name: typeForm.name.trim(), description: typeForm.description.trim() } : item),
      }))
      return
    }
    if (selected.kind === "environment") {
      if (!environmentForm.name.trim()) return window.alert("Informe o ambiente.")
      setState((current) => ({
        ...current,
        environments: current.environments.map((item) => item.id === selected.id ? { ...item, name: environmentForm.name.trim(), notes: environmentForm.notes.trim() } : item),
      }))
      return
    }
    if (selected.kind === "point") {
      if (!pointForm.name.trim()) return window.alert("Informe o nome do ponto.")
      if (!pointForm.services.length) return window.alert("Adicione pelo menos um serviço ao ponto.")
      const pointExists = state.points.some((item) => item.id === selected.id)
      if (!pointExists) return window.alert("Ponto não encontrado. Reabra o orçamento e tente novamente.")
      const nextState = syncEnvironmentPointCounts({
        ...state,
        points: state.points.map((item) => item.id === selected.id ? pointWithForm(item, pointForm) : item),
      })
      try {
        await persistBudget(nextState)
        setState(nextState)
        window.alert("Ponto salvo no banco de dados.")
      } catch (error) {
        window.alert(error instanceof Error ? error.message : "Erro ao salvar o ponto no banco de dados.")
      }
    }
  }

  function collectSubtree(current: BudgetState, node: SelectedNode) {
    const workIds = new Set<string>()
    const towerIds = new Set<string>()
    const floorIds = new Set<string>()
    const typeIds = new Set<string>()
    const environmentIds = new Set<string>()
    const pointIds = new Set<string>()

    const addWork = (id: string) => {
      workIds.add(id)
      current.towers.filter((item) => item.workId === id).forEach((item) => addTower(item.id))
    }
    const addTower = (id: string) => {
      towerIds.add(id)
      current.floors.filter((item) => item.towerId === id).forEach((item) => addFloor(item.id))
    }
    const addFloor = (id: string) => {
      floorIds.add(id)
      current.types.filter((item) => item.floorId === id).forEach((item) => addType(item.id))
    }
    const addType = (id: string) => {
      typeIds.add(id)
      current.environments.filter((item) => item.typeId === id).forEach((item) => addEnvironment(item.id))
    }
    const addEnvironment = (id: string) => {
      environmentIds.add(id)
      current.points.filter((item) => item.environmentId === id).forEach((item) => pointIds.add(item.id))
    }

    if (node.kind === "work") addWork(node.id)
    if (node.kind === "tower") addTower(node.id)
    if (node.kind === "floor") addFloor(node.id)
    if (node.kind === "type") addType(node.id)
    if (node.kind === "environment") addEnvironment(node.id)
    if (node.kind === "point") pointIds.add(node.id)

    return { workIds, towerIds, floorIds, typeIds, environmentIds, pointIds }
  }

  function duplicateSelectedNode() {
    if (selected.kind === "root") return window.alert("Selecione uma obra, torre, pavimento, final, ambiente ou ponto para duplicar.")

    let nextSelection: SelectedNode | null = null
    const now = new Date().toISOString()

    setState((current) => {
      const sets = collectSubtree(current, selected)
      const idMap = new Map<string, string>()
      const remember = (id: string, prefix: string) => {
        if (!idMap.has(id)) idMap.set(id, createId(prefix))
        return idMap.get(id) || id
      }
      const copied = (value: string) => value || "Item"

      ;[...sets.workIds].forEach((id) => remember(id, "work-copy"))
      ;[...sets.towerIds].forEach((id) => remember(id, "tower-copy"))
      ;[...sets.floorIds].forEach((id) => remember(id, "floor-copy"))
      ;[...sets.typeIds].forEach((id) => remember(id, "final-copy"))
      ;[...sets.environmentIds].forEach((id) => remember(id, "env-copy"))
      ;[...sets.pointIds].forEach((id) => remember(id, "point-copy"))

      const duplicatedWorks = current.works
        .filter((item) => sets.workIds.has(item.id))
        .map((item) => ({ ...item, id: idMap.get(item.id) || item.id, name: copied(item.name), createdAt: now }))
      const duplicatedTowers = current.towers
        .filter((item) => sets.towerIds.has(item.id))
        .map((item) => ({ ...item, id: idMap.get(item.id) || item.id, workId: idMap.get(item.workId) || item.workId, name: copied(item.name) }))
      const duplicatedFloors = current.floors
        .filter((item) => sets.floorIds.has(item.id))
        .map((item) => ({ ...item, id: idMap.get(item.id) || item.id, towerId: idMap.get(item.towerId) || item.towerId, name: copied(item.name) }))
      const duplicatedTypes = current.types
        .filter((item) => sets.typeIds.has(item.id))
        .map((item) => ({ ...item, id: idMap.get(item.id) || item.id, floorId: idMap.get(item.floorId) || item.floorId, name: copied(item.name) }))
      const duplicatedEnvironments = current.environments
        .filter((item) => sets.environmentIds.has(item.id))
        .map((item) => ({ ...item, id: idMap.get(item.id) || item.id, typeId: idMap.get(item.typeId) || item.typeId, name: copied(item.name) }))
      const duplicatedPoints = current.points
        .filter((item) => sets.pointIds.has(item.id))
        .map((item) => {
          const environmentId = idMap.get(item.environmentId) || item.environmentId
          const sameEnvironment = selected.kind === "point"
          const nextNumber = sameEnvironment
            ? Math.max(0, ...current.points.filter((point) => point.environmentId === environmentId).map((point) => point.number || 0)) + 1
            : item.number
          return { ...item, id: idMap.get(item.id) || item.id, environmentId, number: nextNumber, name: copied(item.name) }
        })

      const selectedCopyId = idMap.get(selected.id)
      if (selectedCopyId) nextSelection = { kind: selected.kind, id: selectedCopyId }

      return syncEnvironmentPointCounts({
        works: [...duplicatedWorks, ...current.works],
        towers: [...duplicatedTowers, ...current.towers],
        floors: [...duplicatedFloors, ...current.floors],
        types: [...duplicatedTypes, ...current.types],
        environments: [...duplicatedEnvironments, ...current.environments],
        points: [...duplicatedPoints, ...current.points],
        plans: current.plans,
        planPlacements: current.planPlacements,
      })
    })

    if (nextSelection) {
      const selectionAfterDuplicate = nextSelection as SelectedNode
      setSelected(selectionAfterDuplicate)
      setExpanded((current) => ({ ...current, [selectionAfterDuplicate.id]: true, root: true }))
      if (selectionAfterDuplicate.kind === "work") setActiveWorkId(selectionAfterDuplicate.id)
    }
  }

  async function deleteSelectedNode() {
    if (selected.kind === "root") return window.alert("Selecione o item que deseja apagar.")
    if (!window.confirm(`Apagar "${selectedTitle()}" e tudo que estiver dentro dele?`)) return

    const sets = collectSubtree(state, selected)
    const removedPlanIds = new Set(state.plans.filter((plan) => sets.workIds.has(plan.workId) || sets.towerIds.has(plan.towerId)).map((plan) => plan.id))
    const nextState = syncEnvironmentPointCounts({
      works: state.works.filter((item) => !sets.workIds.has(item.id)),
      towers: state.towers.filter((item) => !sets.towerIds.has(item.id)),
      floors: state.floors.filter((item) => !sets.floorIds.has(item.id)),
      types: state.types.filter((item) => !sets.typeIds.has(item.id)),
      environments: state.environments.filter((item) => !sets.environmentIds.has(item.id)),
      points: state.points.filter((item) => !sets.pointIds.has(item.id)),
      plans: state.plans.filter((plan) => !removedPlanIds.has(plan.id)),
      planPlacements: state.planPlacements.filter((placement) => !removedPlanIds.has(placement.planId) && !sets.pointIds.has(placement.pointId)),
    })

    setState(nextState)
    setSelected({ kind: "root", id: "root" })
    if (selected.kind === "work" && activeWorkId === selected.id) setActiveWorkId("")
    try {
      await persistBudget(nextState)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Erro ao salvar exclusão do orçamento.")
    }
  }

  function guidedWorkNodes(source: BudgetState = state) {
    const workId = activeWorkId
    const towers = source.towers.filter((tower) => tower.workId === workId)
    const towerIds = new Set(towers.map((tower) => tower.id))
    const floors = source.floors.filter((floor) => towerIds.has(floor.towerId))
    const floorIds = new Set(floors.map((floor) => floor.id))
    const types = source.types.filter((type) => floorIds.has(type.floorId))
    const typeIds = new Set(types.map((type) => type.id))
    const environments = source.environments.filter((environment) => typeIds.has(environment.typeId))
    const environmentIds = new Set(environments.map((environment) => environment.id))
    const points = source.points.filter((point) => environmentIds.has(point.environmentId))
    return { towers, floors, types, environments, points }
  }

  function guidedName(baseName: string, quantity: number, position: number, existingNames: string[]) {
    const base = baseName.trim()
    if (quantity === 1 && !existingNames.some((name) => normalizeImportKey(name) === normalizeImportKey(base))) return base
    return `${base} ${position}`
  }

  function toggleGuidedParent(id: string) {
    setGuidedSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  function changeGuidedStep(step: GuidedStep) {
    setGuidedStep(step)
    setGuidedSelectedIds([])
    setGuidedQuantity("1")
    setGuidedBaseName("")
    if (step === "work" && activeWorkId) openNode({ kind: "work", id: activeWorkId })
    if (step === "details") {
      const firstPoint = guidedWorkNodes().points[0]
      if (firstPoint) {
        setGuidedPointId(firstPoint.id)
        openNode({ kind: "point", id: firstPoint.id })
      }
    }
  }

  function guidedCreateWork() {
    const workId = addWork()
    if (!workId) return
    setGuidedStep("towers")
    setGuidedSelectedIds([])
  }

  function generateGuidedLevel() {
    if (!activeWorkId) return window.alert("Cadastre os dados da obra antes de gerar a estrutura.")
    const quantity = Math.min(200, Math.max(1, Number(guidedQuantity) || 1))
    const defaultNames: Partial<Record<GuidedStep, string>> = {
      towers: "Torre",
      floors: "Pavimento",
      types: "Final",
      environments: "Ambiente",
      points: "Ponto",
    }
    const baseName = guidedBaseName.trim() || defaultNames[guidedStep] || "Item"
    const parentIds = guidedStep === "towers" ? [activeWorkId] : guidedSelectedIds
    if (!parentIds.length) return window.alert("Selecione pelo menos um item onde a nova estrutura será criada.")

    setState((current) => {
      const next: BudgetState = {
        ...current,
        works: [...current.works],
        towers: [...current.towers],
        floors: [...current.floors],
        types: [...current.types],
        environments: [...current.environments],
        points: [...current.points],
        plans: [...current.plans],
        planPlacements: [...current.planPlacements],
      }

      parentIds.forEach((parentId) => {
        if (guidedStep === "towers") {
          const existing = next.towers.filter((item) => item.workId === parentId)
          const existingNames = existing.map((item) => item.name)
          Array.from({ length: quantity }).forEach((_, index) => {
            const position = existing.length + index + 1
            next.towers.push({ id: createId("tower"), workId: parentId, name: guidedName(baseName, quantity, position, existingNames), description: "" })
          })
        }
        if (guidedStep === "floors") {
          const existing = next.floors.filter((item) => item.towerId === parentId)
          const existingNames = existing.map((item) => item.name)
          Array.from({ length: quantity }).forEach((_, index) => {
            const position = existing.length + index + 1
            next.floors.push({ id: createId("floor"), towerId: parentId, name: guidedName(baseName, quantity, position, existingNames), level: String(position) })
          })
        }
        if (guidedStep === "types") {
          const existing = next.types.filter((item) => item.floorId === parentId)
          const existingNames = existing.map((item) => item.name)
          Array.from({ length: quantity }).forEach((_, index) => {
            const position = existing.length + index + 1
            next.types.push({ id: createId("type"), floorId: parentId, name: guidedName(baseName, quantity, position, existingNames), description: "" })
          })
        }
        if (guidedStep === "environments") {
          const existing = next.environments.filter((item) => item.typeId === parentId)
          const existingNames = existing.map((item) => item.name)
          Array.from({ length: quantity }).forEach((_, index) => {
            const position = existing.length + index + 1
            next.environments.push({ id: createId("env"), typeId: parentId, name: guidedName(baseName, quantity, position, existingNames), pointsQuantity: 0, notes: "" })
          })
        }
        if (guidedStep === "points") {
          const existing = next.points.filter((item) => item.environmentId === parentId)
          const existingNames = existing.map((item) => item.name)
          Array.from({ length: quantity }).forEach((_, index) => {
            const position = existing.length + index + 1
            next.points.push({
              id: createId("point"),
              environmentId: parentId,
              name: guidedName(baseName, quantity, position, existingNames),
              number: position,
              serviceType: "",
              serviceTypeId: "",
              serviceTypes: [],
              kitId: "",
              kitName: "",
              infrastructureMeasure: "",
              measurementConfirmation: "",
              specifications: "",
              notes: "",
            })
          })
        }
      })
      return syncEnvironmentPointCounts(next)
    })
  }

  function selectGuidedPoint(pointId: string) {
    setGuidedPointId(pointId)
    openNode({ kind: "point", id: pointId })
  }

  function toggleGuidedService(service: { id: string; name: string }) {
    setPointForm((current) => ({
      ...current,
      services: current.services.some((item) => item.id === service.id)
        ? current.services.filter((item) => item.id !== service.id)
        : [...current.services, { id: service.id, name: service.name }],
    }))
  }

  async function finishGuidedBudget() {
    let nextState = state
    if (guidedPointId && pointForm.name.trim() && pointForm.services.length) {
      nextState = syncEnvironmentPointCounts({
        ...state,
        points: state.points.map((point) => point.id === guidedPointId ? pointWithForm(point, pointForm) : point),
      })
    }
    const nodes = guidedWorkNodes(nextState)
    const missingPoint = nodes.points.find((point) => !(point.serviceTypes?.length || point.serviceType.trim()))
    if (!nodes.points.length) return window.alert("Crie pelo menos um ponto antes de concluir o orçamento.")
    if (missingPoint) {
      selectGuidedPoint(missingPoint.id)
      return window.alert(`Configure pelo menos um serviço no ponto "${missingPoint.name}".`)
    }
    try {
      await persistBudget(nextState)
      setState(nextState)
      window.alert("Orçamento salvo no banco de dados.")
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Erro ao salvar orçamento.")
    }
  }

  async function saveBudget() {
    try {
      await persistBudget(state)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Erro ao salvar orçamento.")
    }
  }

  function selectedTitle() {
    const kind = activeBudgetKind
    if (selected.kind === "root") return `Cadastrar ${budgetKindLabels[budgetKind]}`
    if (selected.kind === "work") return `${budgetKindLabels[getBudgetKind(selectedWork)]}: ${selectedWork?.name || ""}`
    if (selected.kind === "tower") return kind === "pmoc" ? `Setor: ${selectedTower?.name || ""}` : kind === "servicos" ? `Serviço: ${selectedTower?.name || ""}` : `Torre: ${selectedTower?.name || ""}`
    if (selected.kind === "floor") return kind === "pmoc" ? `Equipamento: ${selectedFloor?.name || ""}` : `Pavimento: ${selectedFloor?.name || ""}`
    if (selected.kind === "type") return kind === "pmoc" ? `Serviço: ${selectedType?.name || ""}` : `Final: ${selectedType?.name || ""}`
    if (selected.kind === "environment") return `Ambiente: ${selectedEnvironment?.name || ""}`
    return `Ponto: ${selectedPoint?.name || ""}`
  }

  function floorVisualFields() {
    return (
      <>
        <div className="space-y-2">
          <Label>Tipo no desenho da torre</Label>
          <Select value={floorForm.visualCategory} onValueChange={(value) => setFloorForm((current) => ({ ...current, visualCategory: value as FloorVisualCategory, visualLabel: value === "personalizado" ? current.visualLabel : "" }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {floorVisualCategories.map((category) => <SelectItem key={category.value} value={category.value}>{category.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Usado somente para ordenar e identificar este pavimento no esquema visual.</p>
        </div>
        {floorForm.visualCategory === "personalizado" ? (
          <Field label="Nome da categoria no desenho" value={floorForm.visualLabel} onChange={(value) => setFloorForm((current) => ({ ...current, visualLabel: value }))} placeholder="Ex.: Rooftop, lojas, administração" />
        ) : null}
      </>
    )
  }

  function editSelectedPanel() {
    if (selected.kind === "root") return null
    const kind = activeBudgetKind
    return (
      <div className="mb-5 rounded-xl border bg-muted/20 p-4">
        <div className="mb-4">
          <p className="font-semibold">Editar item selecionado</p>
          <p className="text-sm text-muted-foreground">Altere os dados abaixo e depois clique em salvar alterações do item.</p>
        </div>
        <div className="grid gap-4">
          {selected.kind === "work" ? (
            <>
              <div className="space-y-2">
                <Label>Cliente</Label>
                <Select value={workForm.clientId || "nenhum"} onValueChange={(value) => {
                  const client = registeredClients.find((item) => item.id === value)
                  setWorkForm((current) => ({ ...current, clientId: value === "nenhum" ? "" : value, client: client?.name || "", clientEnvironmentId: "", clientEquipmentId: "" }))
                }}>
                  <SelectTrigger><SelectValue placeholder="Selecione um cliente" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nenhum">Selecione um cliente</SelectItem>
                    {registeredClients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Field label={kind === "obra" ? "Nome da obra" : kind === "pmoc" ? "Nome do plano PMOC" : "Nome do orçamento"} value={workForm.name} onChange={(value) => setWorkForm((current) => ({ ...current, name: value }))} />
              <div className="space-y-2"><Label>Observações</Label><Textarea value={workForm.notes} rows={4} onChange={(event) => setWorkForm((current) => ({ ...current, notes: event.target.value }))} /></div>
            </>
          ) : null}
          {selected.kind === "tower" ? (
            <>
              <Field label={kind === "pmoc" ? "Setor" : kind === "servicos" ? "Serviço" : "Torre"} value={towerForm.name} onChange={(value) => setTowerForm((current) => ({ ...current, name: value }))} />
              <Field label="Descrição" value={towerForm.description} onChange={(value) => setTowerForm((current) => ({ ...current, description: value }))} />
            </>
          ) : null}
          {selected.kind === "floor" ? (
            <>
              <Field label={kind === "pmoc" ? "Equipamento" : "Pavimento"} value={floorForm.name} onChange={(value) => setFloorForm((current) => ({ ...current, name: value }))} />
              <Field label="Número/nível" value={floorForm.level} onChange={(value) => setFloorForm((current) => ({ ...current, level: value }))} />
              {kind === "obra" ? floorVisualFields() : null}
            </>
          ) : null}
          {selected.kind === "type" ? (
            <>
              <Field label={kind === "pmoc" ? "Serviço" : "Final"} value={typeForm.name} onChange={(value) => setTypeForm((current) => ({ ...current, name: value }))} />
              <Field label="Descrição" value={typeForm.description} onChange={(value) => setTypeForm((current) => ({ ...current, description: value }))} />
            </>
          ) : null}
          {selected.kind === "environment" ? (
            <>
              <Field label="Ambiente" value={environmentForm.name} onChange={(value) => setEnvironmentForm((current) => ({ ...current, name: value }))} />
              <div className="space-y-2"><Label>Observações</Label><Textarea value={environmentForm.notes} rows={4} onChange={(event) => setEnvironmentForm((current) => ({ ...current, notes: event.target.value }))} /></div>
            </>
          ) : null}
          {selected.kind === "point" ? (
            <>
              <Field label="Nome do ponto" value={pointForm.name} onChange={(value) => setPointForm((current) => ({ ...current, name: value }))} />
              <div className="space-y-2">
                <Label>Serviços do ponto</Label>
                <div className="flex gap-2">
                  <Select value={pointForm.serviceTypeId || "nenhum"} onValueChange={(value) => setPointForm((current) => ({ ...current, serviceTypeId: value === "nenhum" ? "" : value }))}>
                    <SelectTrigger><SelectValue placeholder="Selecione um serviço" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="nenhum">Selecione um serviço</SelectItem>
                      {registeredServiceTypes.map((service) => <SelectItem key={service.id} value={service.id}>{service.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="secondary" onClick={addServiceToPoint}>Adicionar</Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {pointForm.services.map((service, index) => (
                    <Badge key={`${service.id}-${index}`} variant="outline" className="gap-2">
                      {service.name}
                      <button type="button" onClick={() => removeServiceFromPoint(index)}>remover</button>
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Kit disponível</Label>
                <Select value={pointForm.kitId || "sem-kit"} onValueChange={(value) => setPointForm((current) => ({ ...current, kitId: value === "sem-kit" ? "" : value }))}>
                  <SelectTrigger><SelectValue placeholder="Selecione um kit" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sem-kit">Sem kit vinculado</SelectItem>
                    {availableStockKits.map((kit) => <SelectItem key={kit.id} value={kit.id}>{kit.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Field label="Medida da Infra" value={pointForm.infrastructureMeasure} placeholder="Ex.: 12,5 m" onChange={(value) => setPointForm((current) => ({ ...current, infrastructureMeasure: value }))} />
              <Field label="Confirmação da Medida" value={pointForm.measurementConfirmation} placeholder="Ex.: Confirmada em vistoria" onChange={(value) => setPointForm((current) => ({ ...current, measurementConfirmation: value }))} />
              <div className="space-y-2"><Label>Especificações</Label><Textarea value={pointForm.specifications} rows={3} onChange={(event) => setPointForm((current) => ({ ...current, specifications: event.target.value }))} /></div>
              <div className="space-y-2"><Label>Observações</Label><Textarea value={pointForm.notes} rows={3} onChange={(event) => setPointForm((current) => ({ ...current, notes: event.target.value }))} /></div>
            </>
          ) : null}
          <Button type="button" variant="secondary" onClick={updateSelectedNode}>Salvar alterações do item</Button>
        </div>
      </div>
    )
  }

  function formPanel() {
    if (selected.kind === "root") {
      return (
        <>
          <div className="space-y-2">
            <Label>Tipo de orçamento</Label>
            <Select value={budgetKind} onValueChange={(value) => changeBudgetKind(value as BudgetKind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="obra">Orçamento de obra</SelectItem>
                <SelectItem value="pmoc">Orçamento PMOC</SelectItem>
                <SelectItem value="servicos">Serviços diversos</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Cliente</Label>
            <Select value={workForm.clientId || "nenhum"} onValueChange={(value) => {
              const client = registeredClients.find((item) => item.id === value)
              setWorkForm((current) => ({ ...current, clientId: value === "nenhum" ? "" : value, client: client?.name || "", clientEnvironmentId: "", clientEquipmentId: "" }))
            }}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um cliente cadastrado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="nenhum">{registeredClients.length ? "Selecione um cliente" : "Nenhum cliente cadastrado"}</SelectItem>
                {registeredClients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.name} {client.document ? `- ${client.document}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {budgetKind === "servicos" ? (
            <>
              <div className="space-y-2">
                <Label>Ambiente</Label>
                <Select value={workForm.clientEnvironmentId || "nenhum"} onValueChange={(value) => setWorkForm((current) => ({ ...current, clientEnvironmentId: value === "nenhum" ? "" : value, clientEquipmentId: "" }))}>
                  <SelectTrigger><SelectValue placeholder="Selecione o ambiente" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nenhum">{registeredClientEnvironments.length ? "Selecione um ambiente" : "Nenhum ambiente cadastrado"}</SelectItem>
                    {registeredClientEnvironments.map((environment) => <SelectItem key={environment.id} value={environment.id}>{[environment.name, environment.floor].filter(Boolean).join(" - ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Equipamento/Máquina</Label>
                <Select value={workForm.clientEquipmentId || "nenhum"} onValueChange={(value) => setWorkForm((current) => ({ ...current, clientEquipmentId: value === "nenhum" ? "" : value }))}>
                  <SelectTrigger><SelectValue placeholder="Selecione o equipamento" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nenhum">{registeredClientEquipment.length ? "Selecione um equipamento" : "Nenhum equipamento cadastrado"}</SelectItem>
                    {registeredClientEquipment.map((equipment) => <SelectItem key={equipment.id} value={equipment.id}>{[equipment.name, equipment.model].filter(Boolean).join(" - ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : null}
          <Field label={budgetKind === "obra" ? "Nome da obra" : budgetKind === "pmoc" ? "Nome do plano PMOC" : "Nome do orçamento"} value={workForm.name} onChange={(value) => setWorkForm((current) => ({ ...current, name: value }))} />
          <div className="space-y-2"><Label>Observações</Label><Textarea value={workForm.notes} rows={5} onChange={(event) => setWorkForm((current) => ({ ...current, notes: event.target.value }))} /></div>
          <Button onClick={addWork}>Salvar {budgetKindLabels[budgetKind]}</Button>
        </>
      )
    }

    if (selected.kind === "work") {
      const kind = getBudgetKind(selectedWork)
      if (kind === "servicos") {
        return (
          <>
            <p className="text-sm text-muted-foreground">Adicione quantos serviços diversos quiser para este cliente.</p>
            <div className="space-y-2">
              <Label>Serviço</Label>
              <Select value={diverseServiceForm.serviceTypeId || "nenhum"} onValueChange={(value) => setDiverseServiceForm((current) => ({ ...current, serviceTypeId: value === "nenhum" ? "" : value }))}>
                <SelectTrigger><SelectValue placeholder="Selecione um serviço" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="nenhum">{registeredServiceTypes.length ? "Selecione um serviço" : "Nenhum serviço cadastrado"}</SelectItem>
                  {registeredServiceTypes.map((service) => <SelectItem key={service.id} value={service.id}>{service.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Field label="Recorrência" value={diverseServiceForm.frequency} onChange={(value) => setDiverseServiceForm((current) => ({ ...current, frequency: value }))} placeholder="Único, mensal, visita avulsa..." />
            <div className="space-y-2"><Label>Observações</Label><Textarea value={diverseServiceForm.notes} rows={5} onChange={(event) => setDiverseServiceForm((current) => ({ ...current, notes: event.target.value }))} /></div>
            <Button onClick={addDiverseService}>Adicionar serviço</Button>
          </>
        )
      }
      return (
        <>
          <p className="text-sm text-muted-foreground">{kind === "pmoc" ? "Cadastre setores dentro deste plano PMOC." : "Cadastre torres dentro desta obra."}</p>
          <Field label={kind === "pmoc" ? "Setor" : "Nome da torre"} value={towerForm.name} onChange={(value) => setTowerForm((current) => ({ ...current, name: value }))} />
          <Field label="Descrição" value={towerForm.description} onChange={(value) => setTowerForm((current) => ({ ...current, description: value }))} />
          <Button onClick={addTower}>Adicionar {kind === "pmoc" ? "setor" : "torre"}</Button>
        </>
      )
    }

    if (selected.kind === "tower") {
      const work = state.works.find((item) => item.id === selectedTower?.workId)
      const kind = getBudgetKind(work)
      if (kind === "servicos") {
        return (
          <div className="rounded-xl border bg-muted/20 p-4 text-sm">
            <p className="font-semibold">{selectedTower?.name}</p>
            <p className="mt-1 text-muted-foreground">{selectedTower?.description || "Serviço diverso vinculado ao cliente."}</p>
          </div>
        )
      }
      return (
        <>
          <p className="text-sm text-muted-foreground">{kind === "pmoc" ? "Cadastre equipamentos dentro deste setor." : "Cadastre pavimentos dentro desta torre."}</p>
          <Field label={kind === "pmoc" ? "Equipamento" : "Pavimento"} value={floorForm.name} onChange={(value) => setFloorForm((current) => ({ ...current, name: value }))} />
          <Field label="Número/nível" value={floorForm.level} onChange={(value) => setFloorForm((current) => ({ ...current, level: value }))} />
          {kind === "obra" ? floorVisualFields() : null}
          <Button onClick={addFloor}>Adicionar {kind === "pmoc" ? "equipamento" : "pavimento"}</Button>
        </>
      )
    }

    if (selected.kind === "floor") {
      const tower = state.towers.find((item) => item.id === selectedFloor?.towerId)
      const work = state.works.find((item) => item.id === tower?.workId)
      const kind = getBudgetKind(work)
      if (kind === "pmoc") {
        return (
          <>
            <p className="text-sm text-muted-foreground">Vincule serviços preventivos ao equipamento e defina de quanto em quanto tempo serão realizados.</p>
            <div className="space-y-2">
              <Label>Serviço</Label>
              <Select value={pmocServiceForm.serviceTypeId || "nenhum"} onValueChange={(value) => setPmocServiceForm((current) => ({ ...current, serviceTypeId: value === "nenhum" ? "" : value }))}>
                <SelectTrigger><SelectValue placeholder="Selecione um serviço" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="nenhum">{registeredServiceTypes.length ? "Selecione um serviço" : "Nenhum serviço cadastrado"}</SelectItem>
                  {registeredServiceTypes.map((service) => <SelectItem key={service.id} value={service.id}>{service.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Frequência</Label>
              <Select value={pmocServiceForm.frequency} onValueChange={(value) => setPmocServiceForm((current) => ({ ...current, frequency: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{budgetFrequencies.map((frequency) => <SelectItem key={frequency} value={frequency}>{frequency}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Observações</Label><Textarea value={pmocServiceForm.notes} rows={5} onChange={(event) => setPmocServiceForm((current) => ({ ...current, notes: event.target.value }))} /></div>
            <Button onClick={addPmocService}>Vincular serviço</Button>
          </>
        )
      }
      return (
        <>
          <p className="text-sm text-muted-foreground">Cadastre finais dentro deste pavimento.</p>
          <Field label="Final" value={typeForm.name} onChange={(value) => setTypeForm((current) => ({ ...current, name: value }))} />
          <Field label="Descrição" value={typeForm.description} onChange={(value) => setTypeForm((current) => ({ ...current, description: value }))} />
          <Button onClick={addType}>Adicionar final</Button>
        </>
      )
    }

    if (selected.kind === "type") {
      const floor = state.floors.find((item) => item.id === selectedType?.floorId)
      const tower = state.towers.find((item) => item.id === floor?.towerId)
      const work = state.works.find((item) => item.id === tower?.workId)
      if (getBudgetKind(work) === "pmoc") {
        return (
          <div className="rounded-xl border bg-muted/20 p-4 text-sm">
            <p className="font-semibold">{selectedType?.name || "Serviço"}</p>
            <p className="mt-1 text-muted-foreground">Frequência e observações: {selectedType?.description || "-"}</p>
          </div>
        )
      }
      return (
        <>
          <p className="text-sm text-muted-foreground">Cadastre ambientes dentro deste final.</p>
          <Field label="Ambiente" value={environmentForm.name} onChange={(value) => setEnvironmentForm((current) => ({ ...current, name: value }))} />
          <div className="space-y-2"><Label>Observações</Label><Textarea value={environmentForm.notes} rows={5} onChange={(event) => setEnvironmentForm((current) => ({ ...current, notes: event.target.value }))} /></div>
          <Button onClick={addEnvironment}>Adicionar ambiente</Button>
        </>
      )
    }

    if (selected.kind === "environment") {
      return (
        <>
          <p className="text-sm text-muted-foreground">Cadastre pontos dentro deste ambiente.</p>
          <Field label="Quantidade de pontos" type="number" value={pointForm.quantity} onChange={(value) => setPointForm((current) => ({ ...current, quantity: value }))} />
          <Field label="Nome base do ponto" value={pointForm.name} placeholder="Ex.: Evaporadora" onChange={(value) => setPointForm((current) => ({ ...current, name: value }))} />
          <div className="space-y-2"><Label>Observações técnicas</Label><Textarea value={pointForm.notes} rows={5} onChange={(event) => setPointForm((current) => ({ ...current, notes: event.target.value }))} /></div>
          <div className="space-y-2">
            <Label>Serviço do ponto</Label>
            <div className="flex gap-2">
              <Select value={pointForm.serviceTypeId || "nenhum"} onValueChange={(value) => setPointForm((current) => ({ ...current, serviceTypeId: value === "nenhum" ? "" : value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um serviço cadastrado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nenhum">{registeredServiceTypes.length ? "Selecione um serviço" : "Nenhum serviço cadastrado"}</SelectItem>
                  {registeredServiceTypes.map((service) => (
                    <SelectItem key={service.id} value={service.id}>
                      {service.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" variant="secondary" onClick={addServiceToPoint}>
                Adicionar
              </Button>
            </div>
          </div>
          <div className="rounded-xl border bg-muted/20 p-3">
            <p className="text-sm font-medium">Serviços adicionados</p>
            {pointForm.services.length ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {pointForm.services.map((service, index) => (
                  <Badge key={`${service.id}-${index}`} variant="outline" className="gap-2">
                    {service.name}
                    <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => removeServiceFromPoint(index)}>
                      remover
                    </button>
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">Nenhum serviço adicionado. Você pode adicionar vários, inclusive repetidos.</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Kit disponível</Label>
            <Select value={pointForm.kitId || "sem-kit"} onValueChange={(value) => setPointForm((current) => ({ ...current, kitId: value === "sem-kit" ? "" : value }))}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um kit cadastrado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sem-kit">{availableStockKits.length ? "Sem kit vinculado" : "Nenhum kit disponível"}</SelectItem>
                {availableStockKits.map((kit) => (
                  <SelectItem key={kit.id} value={kit.id}>
                    {kit.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Field label="Medida da Infra" value={pointForm.infrastructureMeasure} placeholder="Ex.: 12,5 m" onChange={(value) => setPointForm((current) => ({ ...current, infrastructureMeasure: value }))} />
          <Field label="Confirmação da Medida" value={pointForm.measurementConfirmation} placeholder="Ex.: Confirmada em vistoria" onChange={(value) => setPointForm((current) => ({ ...current, measurementConfirmation: value }))} />
          <div className="space-y-2">
            <Label>Especificações</Label>
            <Textarea value={pointForm.specifications} rows={4} onChange={(event) => setPointForm((current) => ({ ...current, specifications: event.target.value }))} />
          </div>
          <Button onClick={addPoints} disabled={saving}>{saving ? "Salvando pontos..." : "Adicionar pontos"}</Button>
        </>
      )
    }

    if (selected.kind === "point") {
      return (
        <div className="rounded-xl border bg-muted/20 p-4 text-sm">
          <p className="font-semibold">{selectedPoint?.name || "Ponto"}</p>
          <p className="mt-1 text-muted-foreground">
            Este é o último nível da cascata. Use a árvore para voltar ao ambiente, final, pavimento, torre ou obra.
          </p>
          <div className="mt-4 grid gap-2">
            <div className="flex justify-between gap-4">
              <span>Tipo de serviço</span>
              <strong>{selectedPoint?.serviceType || "-"}</strong>
            </div>
            <div className="grid gap-1">
              <span>Serviços do ponto</span>
              <div className="flex flex-wrap gap-2">
                {(selectedPoint?.serviceTypes?.length ? selectedPoint.serviceTypes : selectedPoint?.serviceType ? selectedPoint.serviceType.split(";").map((name) => ({ id: name.trim(), name: name.trim() })).filter((item) => item.name) : []).map((service, index) => (
                  <Badge key={`${service.id}-${index}`} variant="outline">{service.name}</Badge>
                ))}
              </div>
            </div>
            <div className="flex justify-between gap-4">
              <span>Número do ponto</span>
              <strong>{selectedPoint?.number || "-"}</strong>
            </div>
            <div className="flex justify-between gap-4">
              <span>Kit</span>
              <strong>{selectedPoint?.kitName || "-"}</strong>
            </div>
            <div className="flex justify-between gap-4">
              <span>Medida da Infra</span>
              <strong>{selectedPoint?.infrastructureMeasure || "-"}</strong>
            </div>
            <div className="flex justify-between gap-4">
              <span>Confirmação da Medida</span>
              <strong>{selectedPoint?.measurementConfirmation || "-"}</strong>
            </div>
            <div className="grid gap-1">
              <span>Especificações</span>
              <strong className="whitespace-pre-wrap">{selectedPoint?.specifications || "-"}</strong>
            </div>
          </div>
        </div>
      )
    }

    return <p className="text-sm text-muted-foreground">Selecione um item da árvore.</p>
  }

  function renderTree() {
    const treeKind = activeWork ? getBudgetKind(activeWork) : budgetKind
    const copy = budgetTreeCopy[treeKind]
    const visibleWorks =
      sheetMode === "new"
        ? activeWorkId
          ? state.works.filter((work) => work.id === activeWorkId)
          : []
        : activeWorkId
          ? state.works.filter((work) => work.id === activeWorkId)
          : state.works.filter((work) => getBudgetKind(work) === treeKind)

    return (
      <TreeItem id="root" label={copy.root} detail={copy.rootDetail} level={0} active={selected.kind === "root"} expanded={expanded.root} hasChildren onSelect={() => openNode({ kind: "root", id: "root" })} onToggle={() => toggle("root")}>
        {visibleWorks.map((work) => {
          const workTowers = state.towers.filter((tower) => tower.workId === work.id)
          return (
            <TreeItem key={work.id} id={work.id} label={work.name} detail={work.client || "Cliente não informado"} level={1} active={selected.kind === "work" && selected.id === work.id} expanded={expanded[work.id]} hasChildren={workTowers.length > 0} onSelect={() => openNode({ kind: "work", id: work.id })} onToggle={() => toggle(work.id)}>
              {workTowers.map((tower) => {
                const towerFloors = state.floors.filter((floor) => floor.towerId === tower.id)
                return (
                  <TreeItem key={tower.id} id={tower.id} label={tower.name} detail={tower.description} level={2} active={selected.kind === "tower" && selected.id === tower.id} expanded={expanded[tower.id]} hasChildren={towerFloors.length > 0} onSelect={() => openNode({ kind: "tower", id: tower.id })} onToggle={() => toggle(tower.id)}>
                    {towerFloors.map((floor) => {
                      const floorTypes = state.types.filter((type) => type.floorId === floor.id)
                      return (
                        <TreeItem key={floor.id} id={floor.id} label={floor.name} detail={parseFloorVisualMeta(floor.level).level ? `Nível ${parseFloorVisualMeta(floor.level).level}` : undefined} level={3} active={selected.kind === "floor" && selected.id === floor.id} expanded={expanded[floor.id]} hasChildren={floorTypes.length > 0} onSelect={() => openNode({ kind: "floor", id: floor.id })} onToggle={() => toggle(floor.id)}>
                          {floorTypes.map((type) => {
                            const typeEnvironments = state.environments.filter((environment) => environment.typeId === type.id)
                            return (
                              <TreeItem key={type.id} id={type.id} label={type.name} detail={type.description} level={4} active={selected.kind === "type" && selected.id === type.id} expanded={expanded[type.id]} hasChildren={typeEnvironments.length > 0} onSelect={() => openNode({ kind: "type", id: type.id })} onToggle={() => toggle(type.id)}>
                                {typeEnvironments.map((environment) => {
                                  const environmentPoints = state.points.filter((point) => point.environmentId === environment.id)
                                  return (
                                    <TreeItem key={environment.id} id={environment.id} label={environment.name} detail={`${environmentPoints.length} pontos`} level={5} active={selected.kind === "environment" && selected.id === environment.id} expanded={expanded[environment.id]} hasChildren={environmentPoints.length > 0} onSelect={() => openNode({ kind: "environment", id: environment.id })} onToggle={() => toggle(environment.id)}>
                                      {environmentPoints.map((point) => (
                                        <TreeItem key={point.id} id={point.id} label={point.name} detail={point.kitName ? `${point.serviceType || "Sem serviço"} | ${point.kitName}` : point.serviceType || "Sem serviço"} level={6} kind="file" active={selected.kind === "point" && selected.id === point.id} onSelect={() => openNode({ kind: "point", id: point.id })} />
                                      ))}
                                    </TreeItem>
                                  )
                                })}
                              </TreeItem>
                            )
                          })}
                        </TreeItem>
                      )
                    })}
                  </TreeItem>
                )
              })}
            </TreeItem>
          )
        })}
      </TreeItem>
    )
  }

  function renderGuidedBuilder() {
    const nodes = guidedWorkNodes()
    const currentStepIndex = guidedSteps.findIndex((step) => step.id === guidedStep)
    const towerById = new Map(nodes.towers.map((item) => [item.id, item]))
    const floorById = new Map(nodes.floors.map((item) => [item.id, item]))
    const typeById = new Map(nodes.types.map((item) => [item.id, item]))
    const environmentById = new Map(nodes.environments.map((item) => [item.id, item]))
    const parentOptions: Array<{ id: string; label: string; detail: string }> = guidedStep === "floors"
      ? nodes.towers.map((tower) => ({ id: tower.id, label: tower.name, detail: "Torre" }))
      : guidedStep === "types"
        ? nodes.floors.map((floor) => ({ id: floor.id, label: floor.name, detail: towerById.get(floor.towerId)?.name || "Torre" }))
        : guidedStep === "environments"
          ? nodes.types.map((type) => {
              const floor = floorById.get(type.floorId)
              return { id: type.id, label: type.name, detail: [towerById.get(floor?.towerId || "")?.name, floor?.name].filter(Boolean).join(" | ") }
            })
          : guidedStep === "points"
            ? nodes.environments.map((environment) => {
                const type = typeById.get(environment.typeId)
                const floor = floorById.get(type?.floorId || "")
                return { id: environment.id, label: environment.name, detail: [towerById.get(floor?.towerId || "")?.name, floor?.name, type?.name].filter(Boolean).join(" | ") }
              })
            : []
    const configuredPointCount = nodes.points.filter((point) => (
      point.serviceTypes?.length
      || point.serviceType.trim()
      || (point.id === guidedPointId && pointForm.services.length)
    )).length
    const levelCount = {
      work: activeWorkId ? 1 : 0,
      towers: nodes.towers.length,
      floors: nodes.floors.length,
      types: nodes.types.length,
      environments: nodes.environments.length,
      points: nodes.points.length,
      details: configuredPointCount,
    }[guidedStep]
    const canContinue = guidedStep === "details" ? levelCount === nodes.points.length && nodes.points.length > 0 : levelCount > 0
    const activeStep = guidedSteps[currentStepIndex]
    const selectedAll = parentOptions.length > 0 && parentOptions.every((item) => guidedSelectedIds.includes(item.id))
    const selectedGuidedPoint = nodes.points.find((point) => point.id === guidedPointId)
    const selectedEnvironmentForPoint = environmentById.get(selectedGuidedPoint?.environmentId || "")
    const selectedTypeForPoint = typeById.get(selectedEnvironmentForPoint?.typeId || "")
    const selectedFloorForPoint = floorById.get(selectedTypeForPoint?.floorId || "")
    const selectedTowerForPoint = towerById.get(selectedFloorForPoint?.towerId || "")

    return (
      <div className="mt-5 space-y-5">
        <div className="overflow-x-auto border-y py-3">
          <div className="flex min-w-max items-center gap-2" aria-label="Etapas do cadastro guiado">
            {guidedSteps.map((step, index) => {
              const complete = index < currentStepIndex || (index === currentStepIndex && canContinue)
              return (
                <Button key={step.id} type="button" size="sm" variant={guidedStep === step.id ? "default" : "outline"} onClick={() => changeGuidedStep(step.id)}>
                  {complete ? <CheckCircle2 className="h-4 w-4" /> : <span className="flex h-4 w-4 items-center justify-center rounded-full border text-[10px]">{index + 1}</span>}
                  {step.label}
                </Button>
              )
            })}
          </div>
        </div>

        <section className="border-y py-5">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase text-primary">Etapa {currentStepIndex + 1} de {guidedSteps.length}</p>
              <h3 className="mt-1 text-xl font-semibold">{activeStep.question}</h3>
              <p className="mt-1 text-sm text-muted-foreground">Estrutura baseada no Esqueleto Lógico: Obra &gt; Torre &gt; Pavimento/Nível &gt; Final &gt; Ambiente &gt; Ponto.</p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">{nodes.towers.length} torres</Badge>
              <Badge variant="outline">{nodes.floors.length} pavimentos</Badge>
              <Badge variant="outline">{nodes.types.length} finais</Badge>
              <Badge variant="outline">{nodes.environments.length} ambientes</Badge>
              <Badge variant="outline">{nodes.points.length} pontos</Badge>
            </div>
          </div>

          {guidedStep === "work" ? (
            activeWorkId ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-2"><Label>Cliente</Label><div className="flex h-10 items-center rounded-md border bg-muted/30 px-3 text-sm font-medium">{activeWork?.client || "Cliente"}</div></div>
                <Field label="Nome da obra" value={workForm.name} onChange={(value) => setWorkForm((current) => ({ ...current, name: value }))} />
                <div className="space-y-2 lg:col-span-2"><Label>Observações</Label><Textarea value={workForm.notes} rows={4} onChange={(event) => setWorkForm((current) => ({ ...current, notes: event.target.value }))} /></div>
                <Button type="button" variant="secondary" className="w-fit" onClick={updateSelectedNode}>Salvar dados da obra</Button>
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <Label>Cliente</Label>
                  <Select value={workForm.clientId || "nenhum"} onValueChange={(value) => {
                    const client = registeredClients.find((item) => item.id === value)
                    setWorkForm((current) => ({ ...current, clientId: value === "nenhum" ? "" : value, client: client?.name || "" }))
                  }}>
                    <SelectTrigger><SelectValue placeholder="Selecione um cliente" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="nenhum">Selecione um cliente</SelectItem>
                      {registeredClients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Field label="Nome da obra" value={workForm.name} onChange={(value) => setWorkForm((current) => ({ ...current, name: value }))} />
                <div className="space-y-2 lg:col-span-2"><Label>Observações</Label><Textarea value={workForm.notes} rows={4} onChange={(event) => setWorkForm((current) => ({ ...current, notes: event.target.value }))} /></div>
                <Button type="button" className="w-fit" onClick={guidedCreateWork}>Criar obra e continuar</Button>
              </div>
            )
          ) : guidedStep === "details" ? (
            <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <Label>Pontos da obra</Label>
                  <span className="text-xs text-muted-foreground">{levelCount}/{nodes.points.length} configurados</span>
                </div>
                <div className="max-h-[560px] space-y-2 overflow-y-auto pr-2">
                  {nodes.points.map((point) => {
                    const configured = Boolean(point.serviceTypes?.length || point.serviceType.trim())
                    const environment = environmentById.get(point.environmentId)
                    return (
                      <button key={point.id} type="button" onClick={() => selectGuidedPoint(point.id)} className={`flex w-full items-start justify-between gap-3 rounded-md border p-3 text-left ${guidedPointId === point.id ? "border-primary bg-primary/5" : "hover:bg-muted/40"}`}>
                        <span className="min-w-0"><span className="block truncate text-sm font-semibold">{point.name}</span><span className="block truncate text-xs text-muted-foreground">{environment?.name || "Ambiente"}</span></span>
                        <span className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${configured ? "bg-emerald-500" : "bg-amber-400"}`} />
                      </button>
                    )
                  })}
                </div>
              </div>
              {selectedGuidedPoint ? (
                <div className="space-y-5 border-l pl-5">
                  <div><h4 className="font-semibold">{selectedGuidedPoint.name}</h4><p className="text-xs text-muted-foreground">{[selectedTowerForPoint?.name, selectedFloorForPoint?.name, selectedTypeForPoint?.name, selectedEnvironmentForPoint?.name].filter(Boolean).join(" | ")}</p></div>
                  <Field label="Nome do ponto" value={pointForm.name} onChange={(value) => setPointForm((current) => ({ ...current, name: value }))} />
                  <div className="space-y-2">
                    <Label>Serviços deste ponto</Label>
                    <div className="grid max-h-52 gap-2 overflow-y-auto rounded-md border p-3 sm:grid-cols-2">
                      {registeredServiceTypes.map((service) => {
                        const checked = pointForm.services.some((item) => item.id === service.id)
                        return <label key={service.id} className="flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm hover:bg-muted/40"><Checkbox checked={checked} onCheckedChange={() => toggleGuidedService(service)} /><span>{service.name}</span></label>
                      })}
                    </div>
                  </div>
                  <div className="space-y-2"><Label>Kit do ponto</Label><Select value={pointForm.kitId || "sem-kit"} onValueChange={(value) => setPointForm((current) => ({ ...current, kitId: value === "sem-kit" ? "" : value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="sem-kit">Sem kit vinculado</SelectItem>{availableStockKits.map((kit) => <SelectItem key={kit.id} value={kit.id}>{kit.name}</SelectItem>)}</SelectContent></Select></div>
                  <div className="grid gap-4 sm:grid-cols-2"><Field label="Medida da Infra" value={pointForm.infrastructureMeasure} placeholder="Ex.: 12,5 m" onChange={(value) => setPointForm((current) => ({ ...current, infrastructureMeasure: value }))} /><Field label="Confirmação da Medida" value={pointForm.measurementConfirmation} placeholder="Ex.: Confirmada em vistoria" onChange={(value) => setPointForm((current) => ({ ...current, measurementConfirmation: value }))} /></div>
                  <div className="space-y-2"><Label>Especificações</Label><Textarea value={pointForm.specifications} rows={3} onChange={(event) => setPointForm((current) => ({ ...current, specifications: event.target.value }))} /></div>
                  <div className="space-y-2"><Label>Observações técnicas</Label><Textarea value={pointForm.notes} rows={3} onChange={(event) => setPointForm((current) => ({ ...current, notes: event.target.value }))} /></div>
                  <Button type="button" onClick={updateSelectedNode} disabled={saving}>{saving ? "Salvando ponto..." : "Salvar configuração do ponto"}</Button>
                </div>
              ) : <div className="flex min-h-52 items-center justify-center border-l text-sm text-muted-foreground">Selecione um ponto para configurar.</div>}
            </div>
          ) : (
            <div className="grid gap-5 xl:grid-cols-[minmax(300px,0.9fr)_minmax(360px,1.1fr)]">
              {guidedStep !== "towers" ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3"><Label>Onde deseja criar?</Label><Button type="button" size="sm" variant="outline" onClick={() => setGuidedSelectedIds(selectedAll ? [] : parentOptions.map((item) => item.id))}>{selectedAll ? "Limpar seleção" : "Selecionar todos"}</Button></div>
                  <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border p-3">
                    {parentOptions.map((item) => <label key={item.id} className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-muted/40"><Checkbox checked={guidedSelectedIds.includes(item.id)} onCheckedChange={() => toggleGuidedParent(item.id)} /><span className="min-w-0"><span className="block truncate text-sm font-semibold">{item.label}</span><span className="block truncate text-xs text-muted-foreground">{item.detail}</span></span></label>)}
                    {!parentOptions.length ? <p className="py-8 text-center text-sm text-muted-foreground">Conclua a etapa anterior primeiro.</p> : null}
                  </div>
                </div>
              ) : <div className="flex min-h-40 items-center justify-center rounded-md border border-dashed p-5 text-center text-sm text-muted-foreground">As torres serão criadas dentro de <strong className="ml-1 text-foreground">{activeWork?.name || "esta obra"}</strong>.</div>}
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2"><Field label="Quantidade" type="number" value={guidedQuantity} onChange={setGuidedQuantity} /><Field label="Nome base" value={guidedBaseName} placeholder={{ towers: "Torre", floors: "Pavimento", types: "Final", environments: "Ambiente", points: "Ponto" }[guidedStep] || "Item"} onChange={setGuidedBaseName} /></div>
                <div className="rounded-md border bg-muted/20 p-4 text-sm"><p className="font-semibold">Como será criado</p><p className="mt-1 text-muted-foreground">A quantidade informada será repetida dentro de cada item selecionado. Para nomes diferentes, gere um grupo por vez usando outro nome base.</p></div>
                <Button type="button" onClick={generateGuidedLevel}><Plus className="h-4 w-4" />Gerar estrutura</Button>
                <p className="text-sm text-muted-foreground">Ja cadastrados nesta etapa: <strong className="text-foreground">{levelCount}</strong></p>
              </div>
            </div>
          )}
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button type="button" variant="outline" disabled={currentStepIndex === 0} onClick={() => changeGuidedStep(guidedSteps[Math.max(0, currentStepIndex - 1)].id)}><ArrowLeft className="h-4 w-4" />Anterior</Button>
          {guidedStep === "details" ? <Button type="button" disabled={!canContinue || saving} onClick={finishGuidedBudget}><CheckCircle2 className="h-4 w-4" />{saving ? "Salvando..." : "Concluir e salvar orçamento"}</Button> : <Button type="button" disabled={!canContinue} onClick={() => changeGuidedStep(guidedSteps[Math.min(guidedSteps.length - 1, currentStepIndex + 1)].id)}>Próximo<ArrowRight className="h-4 w-4" /></Button>}
        </div>
      </div>
    )
  }

  function renderTowerOverview() {
    if (!activeWork || getBudgetKind(activeWork) !== "obra") return null
    const towers = state.towers.filter((tower) => tower.workId === activeWork.id)
    const floorWidth: Record<Exclude<FloorVisualCategory, "auto">, string> = {
      garagem: "w-full",
      terreo: "w-[94%]",
      lazer: "w-[86%]",
      personalizado: "w-[80%]",
      tipo: "w-[76%]",
      tecnico: "w-[72%]",
      cobertura: "w-[62%]",
      reservatorio: "w-[42%]",
    }
    const floorTone: Record<Exclude<FloorVisualCategory, "auto">, string> = {
      garagem: "border-slate-500 border-l-slate-600 bg-slate-100",
      terreo: "border-slate-500 border-l-emerald-500 bg-emerald-50",
      lazer: "border-slate-500 border-l-cyan-500 bg-cyan-50",
      personalizado: "border-slate-500 border-l-violet-500 bg-violet-50",
      tipo: "border-slate-500 border-l-blue-500 bg-white",
      tecnico: "border-slate-500 border-l-amber-500 bg-amber-50",
      cobertura: "border-slate-500 border-l-orange-500 bg-orange-50",
      reservatorio: "border-slate-500 border-l-sky-500 bg-sky-50",
    }

    return (
      <div className="mt-6 border-y py-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              <h3 className="font-semibold">Esquema de pavimentos por torre</h3>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Pavimentos ordenados de cima para baixo. Clique em um andar ou ponto para abrir seu cadastro.</p>
          </div>
          <Badge variant="outline">{towers.length} {towers.length === 1 ? "torre" : "torres"}</Badge>
        </div>

        {towers.length ? (
          <div className="grid items-start gap-5 md:grid-cols-2 2xl:grid-cols-3">
            {towers.map((tower) => {
              const floors = state.floors.filter((floor) => floor.towerId === tower.id).sort((a, b) => floorOrderValue(b) - floorOrderValue(a))
              return (
                <div key={tower.id} className="mx-auto w-full max-w-[460px] overflow-hidden rounded-lg border bg-background shadow-sm">
                  <button type="button" className="flex w-full items-center justify-between gap-3 border-b px-3 py-2.5 text-left hover:bg-muted/50" onClick={() => openNode({ kind: "tower", id: tower.id })}>
                    <span>
                      <span className="block font-semibold">{tower.name}</span>
                      <span className="block text-xs text-muted-foreground">{floors.length} {floors.length === 1 ? "pavimento" : "pavimentos"}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                  {floors.length ? (
                    <div className="max-h-[560px] overflow-auto px-3 py-4">
                      <div className="min-w-[360px]">
                        <div className="ml-[105px] flex flex-col items-center" aria-hidden="true">
                          <div className="h-4 w-9 border-x border-t border-slate-500 bg-slate-100" />
                          <div className="h-3 w-20 border-x border-t border-slate-500 bg-slate-50" />
                        </div>
                        {floors.map((floor) => {
                          const category = inferFloorCategory(floor)
                          const meta = parseFloorVisualMeta(floor.level)
                          const categoryLabel = category === "personalizado" && meta.customLabel ? meta.customLabel : floorCategoryLabels[category]
                          const floorTypes = state.types.filter((type) => type.floorId === floor.id)
                          const typeIds = new Set(floorTypes.map((type) => type.id))
                          const environments = state.environments.filter((environment) => typeIds.has(environment.typeId))
                          const environmentIds = new Set(environments.map((environment) => environment.id))
                          const points = state.points.filter((point) => environmentIds.has(point.environmentId))
                          return (
                            <div key={floor.id} className="grid grid-cols-[105px_minmax(255px,1fr)] items-stretch">
                              <button type="button" className="group flex min-h-9 flex-col items-end justify-center border-r px-2 py-1 text-right hover:bg-muted/50" onClick={() => openNode({ kind: "floor", id: floor.id })} title={`${floor.name} · ${categoryLabel}${meta.level ? ` · nível ${meta.level}` : ""}`}>
                                <span className="block max-w-[95px] truncate text-xs font-semibold group-hover:text-primary">{floor.name}</span>
                                <span className="block max-w-[95px] truncate text-[10px] text-muted-foreground">{categoryLabel}{meta.level ? ` · ${meta.level}` : ""}</span>
                              </button>
                              <div className="flex justify-center">
                                <div className={`${floorWidth[category]} ${floorTone[category]} flex min-h-9 items-center border border-l-[3px] px-1.5 py-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]`}>
                                  <div className="flex min-w-0 flex-1 flex-wrap items-center justify-center gap-1">
                                    {points.length ? points.map((point) => {
                                      const environment = environments.find((item) => item.id === point.environmentId)
                                      const final = floorTypes.find((item) => item.id === environment?.typeId)
                                      return (
                                        <button
                                          key={point.id}
                                          type="button"
                                          title={[final?.name, environment?.name, point.serviceType].filter(Boolean).join(" · ")}
                                          className={`inline-flex max-w-[108px] items-center gap-0.5 rounded-sm border bg-background/90 px-1 py-0.5 text-[10px] shadow-sm hover:border-primary hover:text-primary ${selected.kind === "point" && selected.id === point.id ? "border-primary text-primary" : ""}`}
                                          onClick={() => openNode({ kind: "point", id: point.id })}
                                        >
                                          <MapPin className="h-3 w-3 shrink-0" />
                                          <span className="truncate">{point.name}</span>
                                        </button>
                                      )
                                    }) : <span className="text-[10px] text-muted-foreground">Sem pontos</span>}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                        <div className="ml-[105px] flex flex-col items-center" aria-hidden="true">
                          <div className="h-3 w-full max-w-[255px] border-x border-b border-slate-600 bg-slate-200" />
                          <div className="h-1.5 w-full max-w-[285px] bg-slate-600" />
                        </div>
                        <div className="ml-[105px] pt-2 text-center text-[10px] font-semibold uppercase text-muted-foreground">{tower.name}</div>
                      </div>
                    </div>
                  ) : <p className="p-4 text-sm text-muted-foreground">Cadastre os pavimentos desta torre para gerar o desenho.</p>}
                </div>
              )
            })}
          </div>
        ) : <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">Cadastre uma torre e seus pavimentos para gerar o esquema visual.</p>}
      </div>
    )
  }

  function renderPlanOverview() {
    if (!activeWork || getBudgetKind(activeWork) !== "obra") return null
    const plans = sortAlphaNumeric(state.plans.filter((plan) => plan.workId === activeWork.id), (plan) => plan.name)
    const activePlan = plans.find((plan) => plan.id === activePlanId) || plans[0]
    const towers = sortAlphaNumeric(state.towers.filter((tower) => tower.workId === activeWork.id), (tower) => tower.name)
    const selectedTowerId = planTowerId || activePlan?.towerId || towers[0]?.id || ""
    const floors = sortAlphaNumeric(state.floors.filter((floor) => floor.towerId === selectedTowerId), (floor) => floor.name)
    const selectedFloorId = floors.some((floor) => floor.id === planFloorId) ? planFloorId : floors[0]?.id || ""
    const floorTypeIds = new Set(state.types.filter((type) => type.floorId === selectedFloorId).map((type) => type.id))
    const floorEnvironmentIds = new Set(state.environments.filter((environment) => floorTypeIds.has(environment.typeId)).map((environment) => environment.id))
    const floorPoints = sortAlphaNumeric(state.points.filter((point) => floorEnvironmentIds.has(point.environmentId)), (point) => point.name)
    const workFloorIds = new Set(state.floors.filter((floor) => towers.some((tower) => tower.id === floor.towerId)).map((floor) => floor.id))
    const workTypeIds = new Set(state.types.filter((type) => workFloorIds.has(type.floorId)).map((type) => type.id))
    const workEnvironmentIds = new Set(state.environments.filter((environment) => workTypeIds.has(environment.typeId)).map((environment) => environment.id))
    const workPoints = state.points.filter((point) => workEnvironmentIds.has(point.environmentId))
    const pointOptions: BudgetPlanPointOption[] = workPoints.map((point) => {
      const environment = state.environments.find((item) => item.id === point.environmentId)
      const type = state.types.find((item) => item.id === environment?.typeId)
      const floor = state.floors.find((item) => item.id === type?.floorId)
      const tower = state.towers.find((item) => item.id === floor?.towerId)
      return { id: point.id, label: point.name, detail: [tower?.name, floor?.name, type?.name, environment?.name].filter(Boolean).join(" | ") }
    })
    const workPointIds = new Set(workPoints.map((point) => point.id))
    const photos: BudgetPlanPhoto[] = (operationalState.serviceOrderFiles || [])
      .map((file) => ({ id: file.id, pointId: serviceOrderFilePointId(file.notes), fileUrl: file.fileUrl || "", fileName: file.fileName, category: file.category, createdAt: file.createdAt }))
      .filter((file) => workPointIds.has(file.pointId) && Boolean(file.fileUrl) && (file.category.startsWith("Foto") || /image/i.test(operationalState.serviceOrderFiles.find((item) => item.id === file.id)?.fileType || "")))

    return (
      <div className="mt-6 border-y py-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold">Planta da obra e evidencias por ponto</h3>
            <p className="mt-1 text-sm text-muted-foreground">Anexe a planta, selecione torre, pavimento e ponto e clique no desenho. As fotos das OS aparecem automaticamente na posicao marcada.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Input ref={planInputRef} className="hidden" type="file" accept="application/pdf,.pdf" onChange={(event) => attachPlan(event.target.files?.[0])} />
            <Button type="button" variant="outline" disabled={uploadingPlan || !activeWork} onClick={() => planInputRef.current?.click()}><FileUp className="h-4 w-4" />{uploadingPlan ? "Enviando planta..." : "Anexar planta em PDF"}</Button>
            {activePlan ? <Button type="button" variant="destructive" onClick={() => deletePlan(activePlan)}><Trash2 className="h-4 w-4" />Excluir planta</Button> : null}
          </div>
        </div>

        {plans.length ? (
          <div className="space-y-4">
            <div className="grid gap-3 lg:grid-cols-4">
              <div className="space-y-1.5"><Label>Planta</Label><Select value={activePlan?.id || ""} onValueChange={setActivePlanId}><SelectTrigger><SelectValue placeholder="Selecione a planta" /></SelectTrigger><SelectContent>{plans.map((plan) => <SelectItem key={plan.id} value={plan.id}>{plan.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1.5"><Label>Torre</Label><Select value={selectedTowerId} onValueChange={(value) => { const firstFloor = state.floors.filter((floor) => floor.towerId === value).sort((a, b) => floorOrderValue(b) - floorOrderValue(a))[0]; setPlanTowerId(value); setPlanFloorId(firstFloor?.id || ""); setPlanPointId("") }}><SelectTrigger><SelectValue placeholder="Selecione a torre" /></SelectTrigger><SelectContent>{towers.map((tower) => <SelectItem key={tower.id} value={tower.id}>{tower.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1.5"><Label>Pavimento</Label><Select value={selectedFloorId} onValueChange={(value) => { setPlanFloorId(value); setPlanPointId("") }}><SelectTrigger><SelectValue placeholder="Selecione o pavimento" /></SelectTrigger><SelectContent>{floors.map((floor) => <SelectItem key={floor.id} value={floor.id}>{floor.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1.5"><Label>Ponto</Label><Select value={floorPoints.some((point) => point.id === planPointId) ? planPointId : ""} onValueChange={setPlanPointId}><SelectTrigger><SelectValue placeholder="Selecione o ponto" /></SelectTrigger><SelectContent>{floorPoints.map((point) => <SelectItem key={point.id} value={point.id}>{point.name}</SelectItem>)}</SelectContent></Select></div>
            </div>
            {activePlan ? <BudgetPlanViewer plan={activePlan} placements={state.planPlacements.filter((placement) => placement.planId === activePlan.id)} points={pointOptions} photos={photos} selectedPointId={planPointId} onSelectPoint={setPlanPointId} onPlace={placePlanPoint} onRemove={removePlanPlacement} /> : null}
          </div>
        ) : (
          <button type="button" className="flex min-h-40 w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed text-sm text-muted-foreground hover:border-primary hover:text-primary" onClick={() => planInputRef.current?.click()}><FileUp className="h-6 w-6" /><span>Anexar a primeira planta desta obra</span><span className="text-xs">PDF de ate 50 MB</span></button>
        )}
      </div>
    )
  }

  return (
    <PageShell
      title="Orçamento"
      description="Abra o formulário de orçamento para cadastrar a obra e expandir a árvore em cascata."
      actions={
        <div className="flex flex-wrap gap-2">
          <Button variant={pageView === "orcamentos" ? "default" : "outline"} onClick={() => setPageView("orcamentos")}>
            Orçamentos
          </Button>
          <Button variant={pageView === "whatsapp" ? "default" : "outline"} onClick={() => setPageView("whatsapp")}>
            Whatsapp
          </Button>
          {pageView === "orcamentos" ? (
            <>
              <Input ref={budgetImportInputRef} className="hidden" type="file" accept=".xlsx,.xls,.csv" onChange={(event) => importBudgetSpreadsheet(event.target.files?.[0])} />
              <Button variant="outline" disabled={importingBudget || saving} onClick={() => budgetImportInputRef.current?.click()}>
                <FileUp className="h-4 w-4" />
                {importingBudget ? "Importando..." : "Importar planilha"}
              </Button>
              <Button onClick={openNewBudget}><Plus className="h-4 w-4" />Orçamento</Button>
            </>
          ) : (
            <Button variant="outline" onClick={loadWhatsappRequests} disabled={loadingWhatsapp}>
              {loadingWhatsapp ? "Atualizando..." : "Atualizar"}
            </Button>
          )}
        </div>
      }
    >
      {pageView === "whatsapp" ? (
        <WhatsappPanel
          requests={whatsappRequests}
          selectedRequest={selectedWhatsappRequest}
          loading={loadingWhatsapp}
          onSelect={setSelectedWhatsappId}
        />
      ) : (
        <>
      <SectionCard title="Orçamentos" description="A estrutura é cadastrada em uma única gaveta, no formato de árvore expansível.">
        <div className="mb-4 flex flex-wrap gap-2">
          <Badge variant="outline">{loading ? "Carregando..." : `${state.works.length} obras`}</Badge>
          <Badge variant="outline">{state.towers.length} torres</Badge>
          <Badge variant="outline">{state.floors.length} pavimentos</Badge>
          <Badge variant="outline">{state.environments.length} ambientes</Badge>
          <Badge variant="outline">{state.points.length} pontos</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={openNewBudget}>
            Novo orçamento
          </Button>
        </div>
        <div className="mt-5 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Obra</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Torres</TableHead>
                <TableHead>Pontos</TableHead>
                <TableHead>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.works.length === 0 ? (
                <EmptyRow colSpan={5} />
              ) : (
                state.works.map((work) => {
                  const workTowers = state.towers.filter((tower) => tower.workId === work.id)
                  const towerIds = new Set(workTowers.map((tower) => tower.id))
                  const workFloors = state.floors.filter((floor) => towerIds.has(floor.towerId))
                  const floorIds = new Set(workFloors.map((floor) => floor.id))
                  const workTypes = state.types.filter((type) => floorIds.has(type.floorId))
                  const typeIds = new Set(workTypes.map((type) => type.id))
                  const workEnvironments = state.environments.filter((environment) => typeIds.has(environment.typeId))
                  const environmentIds = new Set(workEnvironments.map((environment) => environment.id))
                  const workPoints = state.points.filter((point) => environmentIds.has(point.environmentId))

                  return (
                    <TableRow key={work.id}>
                      <TableCell className="font-medium">{work.name}</TableCell>
                      <TableCell>{work.client || "-"}</TableCell>
                      <TableCell>{workTowers.length}</TableCell>
                      <TableCell>{workPoints.length}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="secondary" onClick={() => openExistingBudget(work.id, "guided")}>
                            Editar
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => openExistingBudget(work.id, "tree")}>
                            Abrir árvore
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </SectionCard>

      <SectionCard title="Pontos cadastrados" description="Resumo final dos pontos gerados dentro dos ambientes.">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Obra</TableHead>
              <TableHead>Torre</TableHead>
              <TableHead>Pavimento</TableHead>
              <TableHead>Final</TableHead>
              <TableHead>Ambiente</TableHead>
              <TableHead>Ponto</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {allPoints.length === 0 ? <EmptyRow colSpan={6} /> : allPoints.map((point) => {
              const environment = state.environments.find((item) => item.id === point.environmentId)
              const type = state.types.find((item) => item.id === environment?.typeId)
              const floor = state.floors.find((item) => item.id === type?.floorId)
              const tower = state.towers.find((item) => item.id === floor?.towerId)
              const work = state.works.find((item) => item.id === tower?.workId)
              return (
                <TableRow key={point.id}>
                  <TableCell>{work?.name || "-"}</TableCell>
                  <TableCell>{tower?.name || "-"}</TableCell>
                  <TableCell>{floor?.name || "-"}</TableCell>
                  <TableCell>{type?.name || "-"}</TableCell>
                  <TableCell>{environment?.name || "-"}</TableCell>
                  <TableCell className="font-medium">{point.name}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </SectionCard>
        </>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[92vw]">
          <SheetHeader>
            <SheetTitle>{sheetMode === "new" ? "Novo orçamento" : `Orçamento${activeWork ? `: ${activeWork.name}` : ""}`}</SheetTitle>
            <SheetDescription>Cadastre tudo no mesmo formulário. Clique em um item da árvore para abrir o próximo cadastro.</SheetDescription>
          </SheetHeader>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/20 p-4">
            <div>
              <p className="font-semibold">Salvar orçamento no sistema</p>
              <p className="text-sm text-muted-foreground">
                Depois de montar a cascata, confirme o cadastro para deixar o orçamento salvo.
              </p>
              {savedAt ? <p className="mt-1 text-sm font-medium text-emerald-700">Salvo em {savedAt}</p> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={saveBudget} disabled={saving}>{saving ? "Salvando..." : "Salvar orçamento"}</Button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background p-3">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
              <p className="min-w-0 break-words text-sm text-muted-foreground">
                Item selecionado: <span className="font-semibold text-foreground">{selectedTitle()}</span>
              </p>
              {selected.kind === "root" ? (
                <div className="flex items-center gap-2">
                  <Label className="text-sm text-muted-foreground">Tipo</Label>
                  <Select value={budgetKind} onValueChange={(value) => changeBudgetKind(value as BudgetKind)}>
                    <SelectTrigger className="h-10 w-[240px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="obra">Orçamento de obra</SelectItem>
                      <SelectItem value="pmoc">Orçamento PMOC</SelectItem>
                      <SelectItem value="servicos">Serviços diversos</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {currentEditorKind === "obra" ? (
                <div className="flex rounded-md border p-1">
                  <Button type="button" size="sm" variant={editorMode === "guided" ? "default" : "ghost"} onClick={() => setEditorMode("guided")}>Cadastro guiado</Button>
                  <Button type="button" size="sm" variant={editorMode === "tree" ? "default" : "ghost"} onClick={() => setEditorMode("tree")}>Editar árvore</Button>
                </div>
              ) : null}
              {!useGuidedEditor ? (
                <>
                  <Button type="button" variant="outline" onClick={duplicateSelectedNode} disabled={selected.kind === "root"}>
                    <Copy className="h-4 w-4" />
                    Duplicar item
                  </Button>
                  <Button type="button" variant="destructive" onClick={deleteSelectedNode} disabled={selected.kind === "root"}>
                    <Trash2 className="h-4 w-4" />
                    Apagar item
                  </Button>
                </>
              ) : null}
            </div>
          </div>

          {useGuidedEditor ? renderGuidedBuilder() : (
            <>
              {renderTowerOverview()}
              {renderPlanOverview()}

              <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(420px,560px)_minmax(360px,1fr)]">
                <div className="rounded-xl border bg-muted/20 p-4">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold">{budgetTreeCopy[activeWork ? getBudgetKind(activeWork) : budgetKind].treeTitle}</h3>
                      <p className="text-sm text-muted-foreground">{budgetTreeCopy[activeWork ? getBudgetKind(activeWork) : budgetKind].treeDescription}</p>
                    </div>
                    <Button size="sm" variant="secondary" onClick={openNewBudget}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="max-h-[72vh] overflow-y-auto pr-2">{renderTree()}</div>
                </div>

                <div className="rounded-xl border p-5">
                  <div className="mb-5">
                    <h3 className="text-lg font-semibold">{selectedTitle()}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {selected.kind === "root" ? budgetTreeCopy[budgetKind].rootHint : "O formulário abaixo cadastra o próximo nível dentro do item selecionado."}
                    </p>
                  </div>
                  {editSelectedPanel()}
                  <div className="grid gap-4">{formPanel()}</div>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </PageShell>
  )
}


