export type LeadStatus =
  | "em_atendimento"
  | "follow_up"
  | "reuniao_agendada"
  | "reuniao_remarcada"
  | "nao_realizada"
  | "sem_atendimento"
  | "outbound"
  | "reuniao_realizada"
  | "em_negociacao"
  | "fechado"
  | "perdido"
  | "reuniao_marcada"
  | "no_show"
  | "visita"
  | "dados_cliente"
  | "projeto_orcamento"
  | "revisao"
  | "kickoff"
  | "fila_espera"
  | "programacao_time"
  | "aguardando_informacoes"
  | "sem_pendencias"
  | "projetos_ganhos"
  | "perdidos_cancelados"
  | "cliente"
  | "desenvolvimento_proposta"
  | "negociacao"
  | "ganho"
  | "perdido_cliente"
  | "hold"

export type SDSubStatus =
  | "analise_dados"
  | "elaboracao_layout"
  | "preparando_pc_fpv"
  | "elaborando_proposta"

export interface Lead {
  id: string
  name: string
  company: string
  email?: string
  phone?: string
  cpfCnpj?: string
  proposalName?: string
  location: string
  nextFollowUp?: string
  meetingDate?: string
  meetingLink?: string
  meetingAttendees?: string[]
  status: LeadStatus
  sdSubStatus?: SDSubStatus // Added SD sub-status field
  assignedSDR?: string
  assignedCloser?: string
  assignedSD?: string // Added SD responsible field
  projectId?: string
  linkedin?: string
  instagram?: string
  value?: number
  saleDate?: string
  notes?: string
  createdAt: string
  referredBy?: string
  tasks?: LeadTask[]
  comments?: Comment[]
  leadSource?: LeadSource
  referralName?: string
  referralCommission?: number
  projectCode?: string // Added project code field
  // Lead scoring fields
  scoreMql?: boolean
  scoreOportunidadeValidada?: boolean
  scorePropostaTecnica?: boolean
  scorePropostaComercial?: boolean
  scoreNegociacao?: boolean
  scoreFechado?: boolean
  totalScore?: number // Calculated automatically (0-100)
}

export type LeadSource = "linkedin" | "whatsapp" | "indicacao" | "feira" | "trafego_pago"

export interface LeadTask {
  id: string
  description: string
  dueDate: string
  completed: boolean
  createdAt: string
}

export interface Comment {
  id: string
  lead_id: string
  user_id: string
  user_name: string
  content: string
  created_at: string
  updated_at: string
}

export const statusConfig: Record<LeadStatus, { label: string; color: string; bgColor: string; description: string }> =
  {
    em_atendimento: {
      label: "LEAD",
      color: "#2563EB",
      bgColor: "#DBEAFE",
      description: "Lead is currently being attended to",
    },
    follow_up: {
      label: "Automações",
      color: "#6366F1",
      bgColor: "#E0E7FF",
      description: "Requires follow-up contact",
    },
    reuniao_agendada: {
      label: "Reunião",
      color: "#9333EA",
      bgColor: "#F3E8FF",
      description: "Meeting has been scheduled",
    },
    reuniao_remarcada: {
      label: "Ligação (Follow-up)",
      color: "#0EA5E9",
      bgColor: "#E0F2FE",
      description: "Follow-up call needed",
    },
    nao_realizada: {
      label: "Ligação",
      color: "#DC2626",
      bgColor: "#FEE2E2",
      description: "Meeting did not take place",
    },
    sem_atendimento: {
      label: "Ligação 2 (Follow-up)",
      color: "#64748B",
      bgColor: "#F1F5F9",
      description: "No response from lead",
    },
    outbound: {
      label: "Agenda Reunião",
      color: "#0891B2",
      bgColor: "#CFFAFE",
      description: "Outbound prospecting",
    },
    visita: {
      label: "Visita",
      color: "#8B5CF6",
      bgColor: "#EDE9FE",
      description: "Client visit scheduled or completed",
    },
    reuniao_realizada: {
      label: "Reunião Realizada",
      color: "#16A34A",
      bgColor: "#DCFCE7",
      description: "Meeting completed successfully",
    },
    dados_cliente: {
      label: "Dados do cliente",
      color: "#06B6D4",
      bgColor: "#CFFAFE",
      description: "Collecting client information",
    },
    em_negociacao: {
      label: "Em Negociação",
      color: "#F59E0B",
      bgColor: "#FEF3C7",
      description: "Currently in negotiation phase",
    },
    projeto_orcamento: {
      label: "Projeto e Orçamento",
      color: "#3B82F6",
      bgColor: "#DBEAFE",
      description: "Project and budget preparation",
    },
    revisao: {
      label: "Revisão",
      color: "#A855F7",
      bgColor: "#F3E8FF",
      description: "Under review",
    },
    perdido: {
      label: "Perdido",
      color: "#DC2626",
      bgColor: "#FEE2E2",
      description: "Deal lost",
    },
    fechado: {
      label: "Ganho",
      color: "#10B981",
      bgColor: "#D1FAE5",
      description: "Deal closed successfully",
    },
    kickoff: {
      label: "Kick-off",
      color: "#0D9488",
      bgColor: "#CCFBF1",
      description: "Project kick-off",
    },
    reuniao_marcada: {
      label: "Reunião Marcada",
      color: "#0EA5E9",
      bgColor: "#E0F2FE",
      description: "Meeting has been scheduled",
    },
    no_show: {
      label: "No-show",
      color: "#EF4444",
      bgColor: "#FEE2E2",
      description: "Lead did not attend scheduled meeting",
    },
    fila_espera: {
      label: "Fila de espera",
      color: "#94A3B8",
      bgColor: "#F1F5F9",
      description: "Waiting in queue for processing",
    },
    programacao_time: {
      label: "Programação do Time",
      color: "#3B82F6",
      bgColor: "#DBEAFE",
      description: "Being assigned to team for development",
    },
    aguardando_informacoes: {
      label: "Aguardando Informações",
      color: "#F59E0B",
      bgColor: "#FEF3C7",
      description: "Waiting for additional information",
    },
    sem_pendencias: {
      label: "Sem Pendências",
      color: "#10B981",
      bgColor: "#D1FAE5",
      description: "No pending issues, ready to proceed",
    },
    projetos_ganhos: {
      label: "Projetos Ganhos",
      color: "#059669",
      bgColor: "#CCFBF1",
      description: "Successfully won projects",
    },
    perdidos_cancelados: {
      label: "Perdidos/Cancelados/No Go",
      color: "#DC2626",
      bgColor: "#FEE2E2",
      description: "Lost, cancelled, or rejected projects",
    },
    cliente: {
      label: "Cliente",
      color: "#0891B2",
      bgColor: "#CFFAFE",
      description: "New client in the pipeline",
    },
    desenvolvimento_proposta: {
      label: "Desenvolvimento da proposta",
      color: "#3B82F6",
      bgColor: "#DBEAFE",
      description: "Developing proposal for client",
    },
    negociacao: {
      label: "Negociação",
      color: "#F59E0B",
      bgColor: "#FEF3C7",
      description: "In negotiation with client",
    },
    ganho: {
      label: "Ganho",
      color: "#10B981",
      bgColor: "#D1FAE5",
      description: "Deal won successfully",
    },
    perdido_cliente: {
      label: "Perdido",
      color: "#DC2626",
      bgColor: "#FEE2E2",
      description: "Deal lost",
    },
    hold: {
      label: "Hold",
      color: "#64748B",
      bgColor: "#F1F5F9",
      description: "Deal on hold temporarily",
    },
  }

export interface Meeting {
  id: string
  title: string
  description?: string
  startTime: Date
  endTime: Date
  leadId?: string
  leadName?: string
  attendees: string[]
  status: "scheduled" | "completed" | "rescheduled" | "cancelled"
  videoLink?: string
  reminders: number[]
}

export type UserRole = "admin" | "sdr" | "closer" | "representative" | "manager" | "sd" | "client" | "user"

export type PagePermission =
  | "dashboard"
  | "dashboard_obras"
  | "painel_ambientes"
  | "clientes_obras"
  | "ordens_servico"
  | "equipe_prestadores"
  | "operacao_campo"
  | "frota"
  | "estoque"
  | "financeiro"
  | "comercial"
  | "pmoc"
  | "orcamento"
  | "contratos"
  | "relatorios"
  | "configuracoes"
  | "users"
  | "pastas_projetos"

export const systemPagePermissions: PagePermission[] = [
  "dashboard",
  "dashboard_obras",
  "painel_ambientes",
  "clientes_obras",
  "ordens_servico",
  "equipe_prestadores",
  "operacao_campo",
  "frota",
  "estoque",
  "financeiro",
  "comercial",
  "pmoc",
  "orcamento",
  "contratos",
  "relatorios",
  "configuracoes",
  "users",
]

export interface User {
  id: string
  name: string
  email: string
  phone?: string
  role: UserRole
  permissions: PagePermission[]
  createdAt: string
  createdBy: string
  active: boolean
  managerId?: string | null
  clientId?: string | null
  client?: {
    id: string
    name: string
  } | null
  manager?: {
    full_name: string
    email: string
  } | null
}

export const pagePermissionLabels: Record<PagePermission, string> = {
  dashboard: "Dashboard",
  dashboard_obras: "Dashboard de Obra",
  painel_ambientes: "Painel de Ambientes",
  clientes_obras: "Clientes, Fornecedores e Produtos / Serviços",
  ordens_servico: "Ordens de Serviço",
  equipe_prestadores: "Equipe e Prestadores",
  operacao_campo: "Operação em Campo",
  frota: "Frota",
  estoque: "Estoque",
  financeiro: "Financeiro",
  comercial: "Comercial",
  pmoc: "PMOC",
  orcamento: "Orçamento",
  contratos: "Contratos",
  relatorios: "Relatórios",
  configuracoes: "Configurações",
  users: "Users Management",
  pastas_projetos: "Pastas de Projetos", // Added label for project folders
}

export type CalendarView = "month" | "week" | "day"

export interface MessageTemplate {
  id: string
  userId: string
  title: string
  content: string
  category: "whatsapp" | "instagram" | "email" | "other"
  variables: string[]
  createdAt: string
  updatedAt: string
}

export const templateVariables = [
  { key: "name", label: "Nome do Lead", example: "João Silva" },
  { key: "company", label: "Empresa", example: "Acme Corp" },
  { key: "email", label: "E-mail", example: "joao@acme.com" },
  { key: "phone", label: "Telefone", example: "(11) 99999-9999" },
  { key: "location", label: "Localidade", example: "São Paulo, SP" },
  { key: "value", label: "Valor", example: "R$ 10.000" },
  { key: "linkedin", label: "LinkedIn", example: "linkedin.com/in/joao" },
  { key: "instagram", label: "Instagram", example: "@joaosilva" },
  { key: "sdr", label: "SDR Responsável", example: "Maria Santos" },
  { key: "closer", label: "Closer Responsável", example: "Pedro Costa" },
  { key: "sd", label: "SD Responsável", example: "Ana Oliveira" }, // Added SD responsible label
  { key: "date", label: "Data da Reunião", example: "15/01/2025" },
  { key: "time", label: "Horário", example: "14:00" },
  { key: "product", label: "Produto", example: "Sistema CRM" },
]

export interface Project {
  id: string
  name: string
  status?: string
  projectCode?: string // Added projectCode field to match database project_code column
  value_goal: number
  total_value: number
  minimum_value: number
  lead_goal: number
  closing_goal: number
  cep?: string
  street?: string
  number?: string
  complement?: string
  neighborhood?: string
  city?: string
  state?: string
  latitude?: number // Added latitude field
  longitude?: number // Added longitude field
  created_at: string
  updated_at: string
  created_by: string
  creator?: {
    full_name: string
  }
}

export interface SalesTarget {
  id: string
  user_id: string
  year: number
  revenue_jan: number
  revenue_feb: number
  revenue_mar: number
  revenue_apr: number
  revenue_may: number
  revenue_jun: number
  revenue_jul: number
  revenue_aug: number
  revenue_sep: number
  revenue_oct: number
  revenue_nov: number
  revenue_dec: number
  leads_jan: number
  leads_feb: number
  leads_mar: number
  leads_apr: number
  leads_may: number
  leads_jun: number
  leads_jul: number
  leads_aug: number
  leads_sep: number
  leads_oct: number
  leads_nov: number
  leads_dec: number
  deals_jan: number
  deals_feb: number
  deals_mar: number
  deals_apr: number
  deals_may: number
  deals_jun: number
  deals_jul: number
  deals_aug: number
  deals_sep: number
  deals_oct: number
  deals_nov: number
  deals_dec: number
  revenue_target: number
  leads_target: number
  closed_deals_target: number
  created_at: string
  updated_at: string
  created_by: string
  user?: {
    full_name: string
    email: string
    role: UserRole
  }
}
