"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import {
  X,
  User,
  Mail,
  Phone,
  Linkedin,
  Instagram,
  CalendarIcon,
  DollarSign,
  FileText,
  Users,
  Video,
  Sparkles,
  UserPlus,
  Trash2,
  CheckCircle2,
  Loader2,
  MapPin,
  Plus,
  Building2,
} from "lucide-react"
import type { Lead, LeadStatus, SDSubStatus } from "@/lib/types"
import { statusConfig } from "@/lib/types"
import { sdSubStatusConfig } from "@/lib/sd-substatus-config"
import { createLead, updateLead, getClients } from "@/lib/actions/leads"
import { createTask, deleteTask, getTasksByLeadId, toggleTaskCompletion } from "@/lib/actions/tasks"
import { getAllUsers } from "@/lib/actions/users" // Import getAllUsers instead of just getUsersByRole
import { getProjects, getProjectByCnpj } from "@/lib/actions/projects" // Add import for getProjectByCnpj
import { getCompanies, type Company } from "@/lib/actions/companies" // Import getCompanies and Company type
import { useToast } from "@/components/ui/use-toast" // Import useToast
import {
  type FrameCatalogItem,
  type SizeCatalogItem,
  type CanvasCatalogItem,
  formatCurrency,
  getCatalogState,
} from "@/lib/catalog-storage"

interface LeadFormProps {
  onSubmit: (data: Lead) => void
  onClose?: () => void // Made onClose optional
  initialData?: Partial<Lead>
}

export function LeadForm({ initialData, onClose, onSubmit }: LeadFormProps) {
  const { toast } = useToast() // Initialize useToast

  const formatDateTimeLocal = (isoString?: string): string => {
    if (!isoString) return ""
    try {
      // Remove timezone and seconds for datetime-local input format
      return isoString.slice(0, 16)
    } catch {
      return ""
    }
  }

  // Calculate lead scoring based on pipeline stage checkboxes
  const calculateScore = (data: Partial<Lead>): number => {
    let score = 0
    if (data.scoreMql) score += 17
    if (data.scoreOportunidadeValidada) score += 17
    if (data.scorePropostaTecnica) score += 17
    if (data.scorePropostaComercial) score += 17
    if (data.scoreNegociacao) score += 16
    if (data.scoreFechado) score += 16
    return score
  }

  // New weighted scoring system with 9 criteria
  const calculateWeightedScore = (data: Partial<Lead>): number => {
    // Weights sum to 100: autoridade=20, dor=15, business=15, aderencia=10, diferenciacao=10, riscos=10, cronograma=8, comercial=7, patrocinador=5
    const score = (
      ((data as any).scoreAutoridade || 0) * 20 +
      ((data as any).scoreDorUrgencia || 0) * 15 +
      ((data as any).scoreBusinessCase || 0) * 15 +
      ((data as any).scoreAderenciaTecnica || 0) * 10 +
      ((data as any).scoreDiferenciacao || 0) * 10 +
      ((data as any).scoreGestaoRiscos || 0) * 10 +
      ((data as any).scoreCronograma || 0) * 8 +
      ((data as any).scoreModeloComercial || 0) * 7 +
      ((data as any).scorePatrocinador || 0) * 5
    ) / 5
    return Math.round(score)
  }

  const getScoreClassification = (score: number): { label: string; color: string; bgColor: string } => {
    if (score >= 80) return { label: "QUENTE", color: "#DC2626", bgColor: "#FEE2E2" }
    if (score >= 60) return { label: "MORNA", color: "#F59E0B", bgColor: "#FEF3C7" }
    if (score >= 40) return { label: "FRIA", color: "#3B82F6", bgColor: "#DBEAFE" }
    return { label: "DESCARTAR", color: "#6B7280", bgColor: "#F3F4F6" }
  }

  const [formData, setFormData] = useState<Lead>({
    id: initialData?.id,
    name: initialData?.name || "",
    company: initialData?.company || "",
    valueParts: initialData?.valueParts || (initialData as any)?.value_parts || 0,
    valueServices: initialData?.valueServices || (initialData as any)?.value_services || 0,
    valueContracts: initialData?.valueContracts || (initialData as any)?.value_maintenance_contracts || 0,
    valueEquipment: initialData?.valueEquipment || (initialData as any)?.value_equipment_sales || 0,
    valueProjects: initialData?.valueProjects || (initialData as any)?.value_projects || 0,
    companyId: initialData?.companyId || undefined, // Added companyId
    email: initialData?.email || "",
    phone: initialData?.phone || "",
    cpfCnpj: initialData?.cpfCnpj || "",
    proposalName: (initialData as any)?.proposal_name || (initialData as any)?.proposalName || "",
    location: initialData?.location || "",
    nextFollowUp: formatDateTimeLocal(initialData?.nextFollowUp),
    meetingDate: formatDateTimeLocal(initialData?.nextFollowUp), // Corrected from nextFollowUp
    meetingLink: initialData?.meetingLink || "",
    status: initialData?.status || "em_atendimento",
    sdSubStatus: initialData?.sdSubStatus || (initialData as any)?.sd_sub_status || undefined,
    linkedin: initialData?.linkedin || "",
    instagram: initialData?.instagram || "",
    value: initialData?.value || undefined,
    saleDate: formatDateTimeLocal(initialData?.saleDate),
    notes: initialData?.notes || "",
    referredBy: initialData?.referredBy || "",
    assignedSDR: initialData?.assignedSDR || (initialData as any)?.sdr_id || "none",
    assignedCloser: initialData?.assignedCloser || (initialData as any)?.closer_id || "none",
    assignedSD: initialData?.assignedSD || (initialData as any)?.sd_id || "none",
    projectId: initialData?.projectId || "none",
    leadSource: initialData?.leadSource || undefined,
    referralName: initialData?.referralName || "",
    referralCommission: initialData?.referralCommission || undefined,
    projectCode: initialData?.projectCode || (initialData as any)?.project_code || "",
    productMode: (initialData as any)?.productMode || "",
    productName: (initialData as any)?.productName || "",
    frameModel: (initialData as any)?.frameModel || "",
    canvasType: (initialData as any)?.canvasType || "",
    imageReference: (initialData as any)?.imageReference || "",
    priceTableName: (initialData as any)?.priceTableName || "",
    paymentMethod: (initialData as any)?.paymentMethod || "",
    orientation: (initialData as any)?.orientation || "",
    sizePresetId: (initialData as any)?.sizePresetId || "",
    productWidth: (initialData as any)?.productWidth || "",
    productHeight: (initialData as any)?.productHeight || "",
    // Lead scoring fields - new weighted criteria system
    scoreAutoridade: (initialData as any)?.score_autoridade || 0,
    scoreDorUrgencia: (initialData as any)?.score_dor_urgencia || 0,
    scoreBusinessCase: (initialData as any)?.score_business_case || 0,
    scoreAderenciaTecnica: (initialData as any)?.score_aderencia_tecnica || 0,
    scoreDiferenciacao: (initialData as any)?.score_diferenciacao || 0,
    scoreGestaoRiscos: (initialData as any)?.score_gestao_riscos || 0,
    scoreCronograma: (initialData as any)?.score_cronograma || 0,
    scoreModeloComercial: (initialData as any)?.score_modelo_comercial || 0,
    scorePatrocinador: (initialData as any)?.score_patrocinador || 0,
    totalScore: (initialData as any)?.total_score || 0,
  } as any)

  const [addressData, setAddressData] = useState({
    cep: (initialData as any)?.cep || "",
    street: (initialData as any)?.street || "",
    number: (initialData as any)?.number || "",
    complement: (initialData as any)?.complement || "",
    neighborhood: (initialData as any)?.neighborhood || "",
    city: (initialData as any)?.city || "",
    state: (initialData as any)?.state || "",
  })
  const [isLoadingCep, setIsLoadingCep] = useState(false)

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [clients, setClients] = useState<any[]>([])
  const [projects, setProjects] = useState<any[]>([])
  const [allUsers, setAllUsers] = useState<any[]>([])
  const [companies, setCompanies] = useState<Company[]>([]) // Added companies state
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isMarkingAsSold, setIsMarkingAsSold] = useState(false)
  const [newTaskDescription, setNewTaskDescription] = useState("")
  const [newTaskDateTime, setNewTaskDateTime] = useState("")
  const [tasks, setTasks] = useState<any[]>([])
  const [isLoadingTasks, setIsLoadingTasks] = useState(false)
  const [tasksTableExists, setTasksTableExists] = useState(true)
  const [frameCatalog, setFrameCatalog] = useState<FrameCatalogItem[]>([])
  const [sizeCatalog, setSizeCatalog] = useState<SizeCatalogItem[]>([])
  const [canvasCatalog, setCanvasCatalog] = useState<CanvasCatalogItem[]>([])

  const [meetingAttendees, setMeetingAttendees] = useState<string[]>(initialData?.meetingAttendees || [])
  const [newAttendeeEmail, setNewAttendeeEmail] = useState("") // Declare newAttendeeEmail variable

  useEffect(() => {
    const loadCatalog = () => {
      const state = getCatalogState()
      setFrameCatalog(state.frames)
      setSizeCatalog(state.sizes)
      setCanvasCatalog(state.canvases)
    }

    loadCatalog()
    window.addEventListener("storage", loadCatalog)
    window.addEventListener("catalog-updated", loadCatalog)
    return () => {
      window.removeEventListener("storage", loadCatalog)
      window.removeEventListener("catalog-updated", loadCatalog)
    }
  }, [])

  useEffect(() => {
    async function checkCnpjForExistingProject() {
      const cleanCnpj = formData.cpfCnpj?.replace(/\D/g, "")

      // Only search if CNPJ has 14 digits and company field is empty
      if (cleanCnpj && cleanCnpj.length === 14 && !formData.company) {
        try {
          console.log("[v0] Searching for project with CNPJ:", cleanCnpj)
          const { data: existingProject } = await getProjectByCnpj(cleanCnpj)

          if (existingProject) {
            console.log("[v0] Found existing project:", existingProject.name)
            setFormData((prev) => ({
              ...prev,
              company: existingProject.name,
            }))

            toast({
              title: "Empresa encontrada!",
              description: `O nome "${existingProject.name}" foi preenchido automaticamente.`,
            })
          }
        } catch (error) {
          console.error("[v0] Error checking CNPJ:", error)
        }
      }
    }

    checkCnpjForExistingProject()
  }, [formData.cpfCnpj, toast])

  const handleChange = (field: string, value: any) => {
    if (field === "leadSource" && value !== "indicacao") {
      setFormData((prev) => ({
        ...prev,
        [field]: value,
        referralName: "",
        referralCommission: undefined,
      }))
      return
    }
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const updateSuggestedProductValue = (nextData: Record<string, any>) => {
    const selectedFrame = frameCatalog.find((item) => item.id === nextData.frameModel)
    const selectedSize = sizeCatalog.find((item) => item.id === nextData.sizePresetId)
    const selectedCanvas = canvasCatalog.find((item) => item.id === nextData.canvasType)
    const total = (selectedFrame?.price || 0) + (selectedSize?.price || 0) + (selectedCanvas?.price || 0)

    return {
      ...nextData,
      value: total > 0 ? total : nextData.value,
      priceTableName:
        total > 0 && !nextData.priceTableName
          ? "Composição automática do cadastro"
          : nextData.priceTableName,
    }
  }

  const handleFrameCatalogChange = (value: string) => {
    setFormData((prev) => updateSuggestedProductValue({ ...prev, frameModel: value === "none" ? "" : value }) as any)
  }

  const handleCanvasCatalogChange = (value: string) => {
    setFormData((prev) => updateSuggestedProductValue({ ...prev, canvasType: value === "none" ? "" : value }) as any)
  }

  const handleSizeCatalogChange = (value: string) => {
    const selectedSize = sizeCatalog.find((item) => item.id === value)
    setFormData((prev) =>
      updateSuggestedProductValue({
        ...prev,
        sizePresetId: value === "none" ? "" : value,
        productHeight: value === "none" ? "" : String(selectedSize?.height || ""),
        productWidth: value === "none" ? "" : String(selectedSize?.width || ""),
      }) as any,
    )
  }

  const handleCepChange = async (cep: string) => {
    const cleanCep = cep.replace(/\D/g, "")
    setAddressData({ ...addressData, cep: cleanCep })

    if (cleanCep.length === 8) {
      setIsLoadingCep(true)
      try {
        const response = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`)
        const data = await response.json()

        if (data.erro) {
          toast({
            title: "CEP não encontrado",
            description: "Verifique o CEP digitado e tente novamente.",
            variant: "destructive",
          })
          setIsLoadingCep(false)
          return
        }

        setAddressData((prev) => ({
          ...prev,
          street: data.logradouro || "",
          neighborhood: data.bairro || "",
          city: data.localidade || "",
          state: data.uf || "",
          complement: data.complemento || prev.complement,
        }))

        // Update location field with city and state
        setFormData((prev) => ({
          ...prev,
          location: `${data.localidade}, ${data.uf}`,
        }))

        toast({
          title: "Endereço encontrado!",
          description: "Os campos foram preenchidos automaticamente.",
        })
      } catch (error) {
        console.error("[v0] Error fetching CEP:", error)
        toast({
          title: "Erro ao buscar CEP",
          description: "Não foi possível buscar o endereço. Preencha manualmente.",
          variant: "destructive",
        })
      } finally {
        setIsLoadingCep(false)
      }
    }
  }

  const handleClose = (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }
    if (typeof onClose === "function") {
      onClose()
    }
  }

  useEffect(() => {
    async function fetchClients() {
      const { data } = await getClients()
      setClients(data || [])
    }
    fetchClients()
  }, [])

  useEffect(() => {
    async function fetchCompanies() {
      try {
        const { data } = await getCompanies()
        if (data) setCompanies(data)
      } catch {}
    }
    fetchCompanies()
  }, [])

  useEffect(() => {
    async function fetchProjects() {
      const { data } = await getProjects()
      setProjects(data || [])
    }
    fetchProjects()
  }, [])

  useEffect(() => {
    async function fetchUsers() {
      const users = await getAllUsers()
      setAllUsers(users)
    }
    fetchUsers()
  }, [])

  useEffect(() => {
    async function fetchTasks() {
      if (initialData?.id) {
        setIsLoadingTasks(true)
        try {
          const leadTasks = await getTasksByLeadId(initialData.id)
          setTasks(leadTasks || [])
          setTasksTableExists(true)
        } catch (error: any) {
          console.error("[v0] Error fetching tasks:", error)
          if (error?.message?.includes("tasks") && error?.message?.includes("schema cache")) {
            setTasksTableExists(false)
          }
        } finally {
          setIsLoadingTasks(false)
        }
      }
    }
    fetchTasks()
  }, [initialData?.id])

  useEffect(() => {
    if (initialData) {
      setFormData({
        id: initialData.id,
        name: initialData.name || "",
        company: initialData.company || "", // Ensure company is set
        companyId: initialData.companyId || undefined, // Ensure companyId is set
        email: initialData.email || "",
        phone: initialData.phone || "",
        cpfCnpj: initialData.cpfCnpj || "",
        proposalName: (initialData as any)?.proposal_name || (initialData as any)?.proposalName || "",
        location: initialData.location || "",
        projectId: initialData.projectId || "none",
        assignedSDR: initialData.assignedSDR || (initialData as any)?.sdr_id || "none", // Use sdr_id if assignedSDR is not present
        assignedCloser: initialData.assignedCloser || (initialData as any)?.closer_id || "none", // Use closer_id if assignedCloser is not present
        assignedSD: initialData.assignedSD || (initialData as any)?.sd_id || "none", // Use sd_id if assignedSD is not present
        status: initialData.status || "em_atendimento",
        sdSubStatus: initialData.sdSubStatus || (initialData as any)?.sd_sub_status || undefined,
        value: initialData.value,
        valueParts: initialData.valueParts || (initialData as any)?.value_parts || 0,
        valueServices: initialData.valueServices || (initialData as any)?.value_services || 0,
        valueContracts: initialData.valueContracts || (initialData as any)?.value_maintenance_contracts || 0,
        valueEquipment: initialData.valueEquipment || (initialData as any)?.value_equipment_sales || 0,
        valueProjects: initialData.valueProjects || (initialData as any)?.value_projects || 0,
        meetingDate: formatDateTimeLocal(initialData.meetingDate),
        meetingLink: initialData.meetingLink || "",
        nextFollowUp: formatDateTimeLocal(initialData.nextFollowUp),
        linkedin: initialData.linkedin || "", // Ensure linkedin is set
        instagram: initialData.instagram || "",
        saleDate: formatDateTimeLocal(initialData.saleDate),
        notes: initialData.notes || "",
        referredBy: initialData.referredBy || "none",
        leadSource: initialData.leadSource || undefined,
        referralName: initialData.referralName || "",
        referralCommission: initialData.referralCommission || undefined,
        projectCode: initialData.projectCode || (initialData as any)?.project_code || "", // Set projectCode
        productMode: (initialData as any)?.productMode || "",
        productName: (initialData as any)?.productName || "",
        frameModel: (initialData as any)?.frameModel || "",
        canvasType: (initialData as any)?.canvasType || "",
        imageReference: (initialData as any)?.imageReference || "",
        priceTableName: (initialData as any)?.priceTableName || "",
        paymentMethod: (initialData as any)?.paymentMethod || "",
        orientation: (initialData as any)?.orientation || "",
        sizePresetId: (initialData as any)?.sizePresetId || "",
        productWidth: (initialData as any)?.productWidth || "",
        productHeight: (initialData as any)?.productHeight || "",
        // Lead scoring fields - new weighted criteria system
        scoreAutoridade: (initialData as any)?.score_autoridade || 0,
        scoreDorUrgencia: (initialData as any)?.score_dor_urgencia || 0,
        scoreBusinessCase: (initialData as any)?.score_business_case || 0,
        scoreAderenciaTecnica: (initialData as any)?.score_aderencia_tecnica || 0,
        scoreDiferenciacao: (initialData as any)?.score_diferenciacao || 0,
        scoreGestaoRiscos: (initialData as any)?.score_gestao_riscos || 0,
        scoreCronograma: (initialData as any)?.score_cronograma || 0,
        scoreModeloComercial: (initialData as any)?.score_modelo_comercial || 0,
        scorePatrocinador: (initialData as any)?.score_patrocinador || 0,
        totalScore: (initialData as any)?.total_score || 0,
      } as any)

      setAddressData({
        cep: (initialData as any)?.cep || "",
        street: (initialData as any)?.street || "",
        number: (initialData as any)?.number || "",
        complement: (initialData as any)?.complement || "",
        neighborhood: (initialData as any)?.neighborhood || "",
        city: (initialData as any)?.city || "",
        state: (initialData as any)?.state || "",
      })

      if (initialData.meetingAttendees) {
        setMeetingAttendees(initialData.meetingAttendees)
      }
    }
  }, [initialData])

  const validateForm = () => {
    const newErrors: Record<string, string> = {}

    if (formData.email && !formData.email.includes("@")) {
      newErrors.email = "Please enter a valid email address"
    }

    if (formData.linkedin && !formData.linkedin.includes("linkedin.com")) {
      newErrors.linkedin = "Please enter a valid LinkedIn URL"
    }

    if (formData.instagram && !formData.instagram.includes("instagram.com")) {
      newErrors.instagram = "Please enter a valid Instagram URL"
    }

    if (formData.status === "fechado" && !formData.saleDate) {
      newErrors.saleDate = "Data da venda é obrigatória quando o status é Ganho"
    }

    // Add validation for referral fields
    if (formData.leadSource === "indicacao") {
      if (!formData.referralName) {
        newErrors.referralName = "O nome de quem indicou é obrigatório"
      }
      if (formData.referralCommission === undefined || formData.referralCommission === null) {
        newErrors.referralCommission = "A comissão de indicação é obrigatória"
      } else if (formData.referralCommission < 0 || formData.referralCommission > 100) {
        newErrors.referralCommission = "A comissão deve estar entre 0% e 100%"
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleAddAttendee = () => {
    const email = newAttendeeEmail.trim()
    if (!email) return

    // Validate email format
    if (!email.includes("@") || !email.includes(".")) {
      alert("Por favor, insira um email válido")
      return
    }

    // Check for duplicates
    if (meetingAttendees.includes(email)) {
      alert("Este email já foi adicionado")
      return
    }

    setMeetingAttendees([...meetingAttendees, email])
    setNewAttendeeEmail("")
  }

  const handleRemoveAttendee = (email: string) => {
    setMeetingAttendees(meetingAttendees.filter((e) => e !== email))
  }

  const handleAddTask = async () => {
    if (!newTaskDescription.trim()) {
      toast({
        title: "Erro",
        description: "Por favor, digite uma descrição para a tarefa.",
        variant: "destructive",
      })
      return
    }

    if (!newTaskDateTime) {
      toast({
        title: "Erro",
        description: "Por favor, selecione uma data e hora para a tarefa.",
        variant: "destructive",
      })
      return
    }

    if (tasks.length >= 30) {
      toast({
        title: "Limite atingido",
        description: "Você pode adicionar no máximo 30 tarefas por lead.",
        variant: "destructive",
      })
      return
    }

    if (initialData?.id) {
      try {
        console.log("[v0] Creating task for lead:", initialData.id)
        const newTask = await createTask({
          lead_id: initialData.id,
          description: newTaskDescription.trim(),
          due_date: new Date(newTaskDateTime).toISOString(),
          completed: false,
        })

        if (newTask) {
          setTasks([...tasks, newTask])
          setNewTaskDescription("")
          setNewTaskDateTime("")

          toast({
            title: "Tarefa criada!",
            description: "A tarefa foi adicionada e aparecerá na Agenda.",
          })
        }
      } catch (error: any) {
        console.error("[v0] Error creating task:", error)

        if (error?.message?.includes("table not found") || error?.message?.includes("Tasks table")) {
          toast({
            title: "Tabela de tarefas não encontrada",
            description: "Execute o script 009_create_tasks_table_v2.sql no Supabase.",
            variant: "destructive",
          })
          setTasksTableExists(false)
        } else {
          toast({
            title: "Erro ao criar tarefa",
            description: error?.message || "Tente novamente.",
            variant: "destructive",
          })
        }
      }
    } else {
      const tempTask = {
        id: `temp-${Date.now()}-${Math.floor(Math.random() * 1000000)}`,
        description: newTaskDescription.trim(),
        due_date: new Date(newTaskDateTime).toISOString(),
        completed: false,
        isTemp: true,
      }
      setTasks([...tasks, tempTask])
      setNewTaskDescription("")
      setNewTaskDateTime("")

      toast({
        title: "Tarefa adicionada",
        description: "A tarefa será salva quando você criar o lead.",
      })
    }
  }

  const handleToggleTask = async (taskId: string) => {
    const task = tasks.find((t) => t?.id === taskId)
    if (!task) {
      console.error("[v0] Task not found:", taskId)
      return
    }

    if (task.isTemp) {
      setTasks(tasks.map((t) => (t?.id === taskId ? { ...t, completed: !t.completed } : t)))
    } else {
      try {
        await toggleTaskCompletion(taskId, !task.completed)
        setTasks(tasks.map((t) => (t?.id === taskId ? { ...t, completed: !t.completed } : t)))
      } catch (error) {
        console.error("[v0] Error toggling task:", error)
        alert("Erro ao atualizar tarefa. Tente novamente.")
      }
    }
  }

  const handleRemoveTask = async (taskId: string) => {
    const task = tasks.find((t) => t?.id === taskId)
    if (!task) {
      console.error("[v0] Task not found:", taskId)
      return
    }

    if (task.isTemp) {
      setTasks(tasks.filter((t) => t?.id !== taskId))
    } else {
      try {
        await deleteTask(taskId)
        setTasks(tasks.filter((t) => t?.id !== taskId))
      } catch (error) {
        console.error("[v0] Error deleting task:", error)
        alert("Erro ao deletar tarefa. Tente novamente.")
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validateForm()) return

    setIsSubmitting(true)

    try {
      const cleanedAttendees = meetingAttendees.filter((email) => email && email.trim() !== "")

      let closedDateValue = null
      if (formData.saleDate && formData.saleDate.trim() !== "") {
        try {
          const dateObj = new Date(formData.saleDate)
          if (!isNaN(dateObj.getTime())) {
            closedDateValue = dateObj.toISOString()
          }
        } catch {}
      }

    const leadInput = {
      name: formData.name,
      company: formData.company,
      company_id: formData.companyId,
      email: formData.email,
      phone: formData.phone,
      cpf_cnpj: formData.cpfCnpj,
      proposal_name: formData.proposalName || null,
      location: formData.location,
      follow_up_date: formData.nextFollowUp || null,
      meeting_date: formData.meetingDate || null,
      meeting_link: formData.meetingLink || null,
      meeting_attendees: cleanedAttendees,
      status: formData.status,
      sd_sub_status: formData.sdSubStatus || null,
      linkedin_url: formData.linkedin || null,
      instagram_url: formData.instagram || null,
      deal_value: formData.value === undefined || formData.value === null ? null : formData.value,
      closed_date: closedDateValue,
      score_autoridade: (formData as any).scoreAutoridade || 0,
      score_dor_urgencia: (formData as any).scoreDorUrgencia || 0,
      score_business_case: (formData as any).scoreBusinessCase || 0,
      score_aderencia_tecnica: (formData as any).scoreAderenciaTecnica || 0,
      score_diferenciacao: (formData as any).scoreDiferenciacao || 0,
      score_gestao_riscos: (formData as any).scoreGestaoRiscos || 0,
      score_cronograma: (formData as any).scoreCronograma || 0,
      score_modelo_comercial: (formData as any).scoreModeloComercial || 0,
      score_patrocinador: (formData as any).scorePatrocinador || 0,
        value_parts: formData.valueParts || 0,
        value_services: formData.valueServices || 0,
        value_maintenance_contracts: formData.valueContracts || 0,
        value_equipment_sales: formData.valueEquipment || 0,
        value_projects: formData.valueProjects || 0,
        notes: formData.notes,
        referred_by: formData.referredBy === "none" ? null : formData.referredBy || null,
        sdr_id: formData.assignedSDR === "none" ? null : formData.assignedSDR || null,
        closer_id: formData.assignedCloser === "none" ? null : formData.assignedCloser || null,
        sd_id: formData.assignedSD === "none" ? null : formData.assignedSD || null,
        project_id: formData.projectId === "none" ? null : formData.projectId || null,
        lead_source: formData.leadSource || null,
        referral_name: formData.referralName || null,
        referral_commission: formData.referralCommission || null,
        project_code: formData.projectCode || null,
        cep: addressData.cep || null,
        street: addressData.street || null,
        number: addressData.number || null,
        complement: addressData.complement || null,
        neighborhood: addressData.neighborhood || null,
        city: addressData.city || null,
        state: addressData.state || null,
      }

      if (formData.id) {
        console.log("[v0] Updating existing lead:", formData.id)

        const result = await updateLead(formData.id, leadInput)

        if (result.error) {
          console.error("[v0] ❌ Error updating lead:", result.error)
          toast({
            title: "Erro ao atualizar lead",
            description: result.error,
            variant: "destructive",
          })
          setIsSubmitting(false)
          if (onClose) onClose() // Close form even on error
          return
        }

        toast({ title: "Lead atualizado", description: "As informações do lead foram atualizadas com sucesso" })
        onSubmit(result.data)
      } else {
        console.log("[v0] Creating new lead with status:", leadInput.status)
        const result = await createLead(leadInput)

        if (result.error || !result.data) {
          toast({ title: "Erro ao criar lead", description: result.error, variant: "destructive" })
          setIsSubmitting(false)
          if (onClose) onClose()
          return
        }

        const tempTasks = tasks.filter((t) => t.isTemp)
        if (tempTasks.length > 0) {
          for (const task of tempTasks) {
            try {
              await createTask({ lead_id: result.data.id, description: task.description, due_date: task.due_date, completed: task.completed })
            } catch {}
          }
        }

        toast({ title: "Lead criado", description: "O novo lead foi criado com sucesso" })
        onSubmit(result.data)
      }
    } catch (error: any) {
      toast({ title: "Erro inesperado", description: error?.message || "Erro ao salvar lead", variant: "destructive" })
    } finally {
      setIsSubmitting(false)
      if (onClose) onClose()
    }
  }

  const handleSendToCloser = async () => {
    if (!formData.assignedCloser || formData.assignedCloser === "none") {
      alert("⚠️ Por favor, selecione um Closer responsável antes de enviar.")
      return
    }

    if (!formData.meetingDate) {
      alert("⚠️ Por favor, defina uma data de reunião antes de enviar para o Closer.")
      return
    }

    if (!validateForm()) return

    setIsSubmitting(true)

    try {
      const cleanedAttendees = meetingAttendees.filter((email) => email && email.trim() !== "")

      const leadInput = {
        name: formData.name,
        company: formData.company, // Use company from formData
        company_id: formData.companyId, // Include company_id
        email: formData.email,
        phone: formData.phone,
        cpf_cnpj: formData.cpfCnpj,
        location: formData.location,
        follow_up_date: formData.nextFollowUp || null,
        meeting_date: formData.meetingDate || null,
        meeting_link: formData.meetingLink || null,
        meeting_attendees: cleanedAttendees,
        status: "reuniao_agendada", // Set status to "Reunião Agendada"
        linkedin_url: formData.linkedin || null,
        instagram_url: formData.instagram || null,
        deal_value: formData.value === undefined || formData.value === null ? null : formData.value,
        notes: formData.notes,
        referred_by: formData.referredBy === "none" ? null : formData.referredBy || null,
        sdr_id: formData.assignedSDR === "none" ? null : formData.assignedSDR || null,
        closer_id: formData.assignedCloser === "none" ? null : formData.assignedCloser || null,
        project_id: formData.projectId === "none" ? null : formData.projectId || null,
        lead_source: formData.leadSource || null,
        referral_name: formData.referralName || null,
        referral_commission: formData.referralCommission || null,
        project_code: formData.projectCode || null, // Include projectCode
        cep: addressData.cep || null,
        street: addressData.street || null,
        number: addressData.number || null,
        complement: addressData.complement || null,
        neighborhood: addressData.neighborhood || null,
        city: addressData.city || null,
        state: addressData.state || null,
      }

      console.log("[v0] Sending to Closer with leadInput:", JSON.stringify(leadInput, null, 2))

      if (formData.id) {
        const result = await updateLead(formData.id, leadInput)

        if (result.error) {
          console.error("[v0] Error sending to Closer:", result.error)
          alert(`Erro ao enviar para o Closer:\n\n${result.error}\n\nVerifique o console para mais detalhes.`)
          setIsSubmitting(false)
          return
        }

        console.log("[v0] Lead sent to Closer successfully")
        alert("✅ Lead enviado para o Closer com sucesso!\n\nStatus: Reunião Agendada")
        onSubmit({ ...formData, status: "reuniao_agendada", ...result.data }) // Submit the updated data
      } else {
        // If it's a new lead, create it first
        const result = await createLead(leadInput)

        if (result.error || !result.data) {
          console.error("[v0] Error creating lead:", result.error)
          alert(`Erro ao criar lead:\n\n${result.error}\n\nVerifique o console para mais detalhes.`)
          setIsSubmitting(false)
          return
        }

        console.log("[v0] Lead created and sent to Closer successfully:", result.data.id)

        // Create tasks for the new lead
        const tempTasks = tasks.filter((t) => t.isTemp)
        if (tempTasks.length > 0) {
          console.log("[v0] Creating", tempTasks.length, "tasks for new lead")
          for (const task of tempTasks) {
            try {
              await createTask({
                lead_id: result.data.id,
                description: task.description,
                due_date: task.due_date,
                completed: task.completed,
              })
            } catch (error) {
              console.error("[v0] Error creating task:", error)
            }
          }
        }

        alert("✅ Lead criado e enviado para o Closer com sucesso!\n\nStatus: Reunião Agendada")
        onSubmit({ ...formData, status: "reuniao_agendada", ...result.data }) // Submit the created data
      }
    } catch (error: any) {
      console.error("[v0] Unexpected error sending to Closer:", error)
      alert(
        `❌ Erro inesperado ao enviar para o Closer:\n\n${error?.message || error}\n\nVerifique o console para mais detalhes.`,
      )
    } finally {
      setIsSubmitting(false)
      console.log("[v0] Send to Closer complete")
    }
  }

  const handleSendToSDR = async () => {
    // Validate required fields
    if (!formData.assignedSDR || formData.assignedSDR === "none") {
      alert("⚠️ Por favor, selecione um SDR responsável antes de enviar.")
      return
    }

    if (!validateForm()) return

    setIsSubmitting(true)
    console.log("[v0] Sending lead to SDR with No-show status...")

    try {
      const cleanedAttendees = meetingAttendees.filter((email) => email && email.trim() !== "")

      const leadInput = {
        name: formData.name,
        company: formData.company, // Use company from formData
        company_id: formData.companyId, // Include company_id
        email: formData.email,
        phone: formData.phone,
        cpf_cnpj: formData.cpfCnpj,
        location: formData.location,
        follow_up_date: formData.nextFollowUp || null,
        meeting_date: formData.meetingDate || null,
        meeting_link: formData.meetingLink || null,
        meeting_attendees: cleanedAttendees,
        status: "no_show", // Set status to "No-show"
        linkedin_url: formData.linkedin || null,
        instagram_url: formData.instagram || null,
        deal_value: formData.value === undefined || formData.value === null ? null : formData.value,
        notes: formData.notes,
        referred_by: formData.referredBy === "none" ? null : formData.referredBy || null,
        sdr_id: formData.assignedSDR === "none" ? null : formData.assignedSDR || null,
        closer_id: formData.assignedCloser === "none" ? null : formData.assignedCloser || null,
        project_id: formData.projectId === "none" ? null : formData.projectId || null,
        lead_source: formData.leadSource || null,
        referral_name: formData.referralName || null,
        referral_commission: formData.referralCommission || null,
        project_code: formData.projectCode || null, // Include projectCode
        cep: addressData.cep || null,
        street: addressData.street || null,
        number: addressData.number || null,
        complement: addressData.complement || null,
        neighborhood: addressData.neighborhood || null,
        city: addressData.city || null,
        state: addressData.state || null,
      }

      console.log("[v0] Sending to SDR with leadInput:", JSON.stringify(leadInput, null, 2))

      if (formData.id) {
        const result = await updateLead(formData.id, leadInput)

        if (result.error) {
          console.error("[v0] Error sending to SDR:", result.error)
          alert(`Erro ao enviar para o SDR:\n\n${result.error}\n\nVerifique o console para mais detalhes.`)
          setIsSubmitting(false)
          return
        }

        console.log("[v0] Lead sent to SDR successfully")
        alert("✅ Lead enviado para o SDR com sucesso!\n\nStatus: No-show")
        onSubmit({ ...formData, status: "no_show", ...result.data }) // Submit the updated data
      } else {
        // If it's a new lead, create it first
        const result = await createLead(leadInput)

        if (result.error || !result.data) {
          console.error("[v0] Error creating lead:", result.error)
          alert(`Erro ao criar lead:\n\n${result.error}\n\nVerifique o console para mais detalhes.`)
          setIsSubmitting(false)
          return
        }

        console.log("[v0] Lead created and sent to SDR successfully:", result.data.id)

        // Create tasks for the new lead
        const tempTasks = tasks.filter((t) => t.isTemp)
        if (tempTasks.length > 0) {
          console.log("[v0] Creating", tempTasks.length, "tasks for new lead")
          for (const task of tempTasks) {
            try {
              await createTask({
                lead_id: result.data.id,
                description: task.description,
                due_date: task.due_date,
                completed: task.completed,
              })
            } catch (error) {
              console.error("[v0] Error creating task:", error)
            }
          }
        }

        alert("✅ Lead criado e enviado para o SDR com sucesso!\n\nStatus: No-show")
        onSubmit({ ...formData, status: "no_show", ...result.data }) // Submit the created data
      }
    } catch (error: any) {
      console.error("[v0] Unexpected error sending to SDR:", error)
      alert(
        `❌ Erro inesperado ao enviar para o SDR:\n\n${error?.message || error}\n\nVerifique o console para mais detalhes.`,
      )
    } finally {
      setIsSubmitting(false)
      console.log("[v0] Send to SDR complete")
    }
  }

  const handleSendToSD = async () => {
    if (!validateForm()) return

    setIsSubmitting(true)
    console.log("[v0] Sending lead to SD queue...")

    try {
      const cleanedAttendees = meetingAttendees.filter((email) => email && email.trim() !== "")

      const leadInput = {
        name: formData.name,
        company: formData.company,
        company_id: formData.companyId, // Include company_id
        email: formData.email,
        phone: formData.phone,
        cpf_cnpj: formData.cpfCnpj,
        location: formData.location,
        follow_up_date: formData.nextFollowUp || null,
        meeting_date: formData.meetingDate || null,
        meeting_link: formData.meetingLink || null,
        meeting_attendees: cleanedAttendees,
        status: "fila_espera" as LeadStatus, // Set status to SD Queue (Fila de Espera)
        linkedin_url: formData.linkedin || null,
        instagram_url: formData.instagram || null,
        deal_value: formData.value === undefined || formData.value === null ? null : formData.value,
        notes: formData.notes,
        referred_by: formData.referredBy === "none" ? null : formData.referredBy || null,
        sdr_id: formData.assignedSDR === "none" ? null : formData.assignedSDR || null,
        closer_id: formData.assignedCloser === "none" ? null : formData.assignedCloser || null,
        project_id: formData.projectId === "none" ? null : formData.projectId || null,
        lead_source: formData.leadSource || null,
        referral_name: formData.referralName || null,
        referral_commission: formData.referralCommission || null,
        project_code: formData.projectCode || null, // Include projectCode
        cep: addressData.cep || null,
        street: addressData.street || null,
        number: addressData.number || null,
        complement: addressData.complement || null,
        neighborhood: addressData.neighborhood || null,
        city: addressData.city || null,
        state: addressData.state || null,
      }

      console.log("[v0] Sending to SD with leadInput:", JSON.stringify(leadInput, null, 2))

      if (formData.id) {
        const result = await updateLead(formData.id, leadInput)

        if (result.error) {
          console.error("[v0] Error sending to SD:", result.error)
          if (result.error.includes("leads_status_check") || result.error.includes("constraint")) {
            alert(
              "❌ Erro: O status SD ainda não foi configurado no banco de dados!\n\n" +
                "Por favor, execute o script SQL:\n" +
                "scripts/017_add_sd_statuses.sql\n\n" +
                "Este script adiciona os status do SD ao banco de dados.",
            )
          } else {
            alert(`Erro ao enviar para SD:\n\n${result.error}\n\nVerifique o console para mais detalhes.`)
          }
          setIsSubmitting(false)
          return
        }

        console.log("[v0] Lead sent to SD successfully")
        toast({
          title: "Lead enviado para SD",
          description: "O lead foi movido para a Fila de Espera do SD",
        })
        onSubmit({ ...formData, status: "fila_espera", ...result.data }) // Submit the updated data
      } else {
        const result = await createLead(leadInput)

        if (result.error || !result.data) {
          console.error("[v0] Error creating lead:", result.error)
          if (result.error?.includes("leads_status_check") || result.error?.includes("constraint")) {
            alert(
              "❌ Erro: O status SD ainda não foi configurado no banco de dados!\n\n" +
                "Por favor, execute o script SQL:\n" +
                "scripts/017_add_sd_statuses.sql\n\n" +
                "Este script adiciona os status do SD ao banco de dados.",
            )
          } else {
            alert(`Erro ao criar lead:\n\n${result.error}\n\nVerifique o console para mais detalhes.`)
          }
          setIsSubmitting(false)
          return
        }

        console.log("[v0] Lead created and sent to SD successfully:", result.data.id)

        const tempTasks = tasks.filter((t) => t.isTemp)
        if (tempTasks.length > 0) {
          console.log("[v0] Creating", tempTasks.length, "tasks for new lead")
          for (const task of tempTasks) {
            try {
              await createTask({
                lead_id: result.data.id,
                description: task.description,
                due_date: task.due_date,
                completed: task.completed,
              })
            } catch (error) {
              console.error("[v0] Error creating task:", error)
            }
          }
        }

        toast({
          title: "Lead criado e enviado para SD",
          description: "O lead foi criado e movido para a Fila de Espera do SD",
        })
        onSubmit({ ...formData, status: "fila_espera", ...result.data }) // Submit the created data
      }
    } catch (error: any) {
      console.error("[v0] Unexpected error sending to SD:", error)
      alert(
        `❌ Erro inesperado ao enviar para SD:\n\n${error?.message || error}\n\nVerifique o console para mais detalhes.`,
      )
    } finally {
      setIsSubmitting(false)
      console.log("[v0] Send to SD complete")
    }
  }

  const handleMarkAsSold = async () => {
    if (!initialData?.id) return

    if (!confirm("Marcar este lead como vendido e enviar para Clientes?")) {
      return
    }

    setIsMarkingAsSold(true)

    try {
      const { error } = await updateLead(initialData.id, { status: "cliente" })

      if (error) {
        toast({
          title: "❌ Erro",
          description: "Não foi possível marcar como vendido. Tente novamente.",
          variant: "destructive",
        })
        setIsMarkingAsSold(false)
      } else {
        // Show success toast
        toast({
          title: "🎉 Lead Vendido!",
          description: "O lead foi movido para a página de Clientes com sucesso!",
          duration: 3000,
        })

        // Call onSubmit to trigger parent component refresh
        onSubmit({ ...formData, status: "cliente" })

        // Close the form
        if (typeof onClose === "function") {
          onClose()
        }

        setIsMarkingAsSold(false)
      }
    } catch (error: any) {
      console.error("[v0] Error marking as sold:", error)
      toast({
        title: "❌ Erro",
        description: error?.message || "Erro ao marcar como vendido",
        variant: "destructive",
      })
      setIsMarkingAsSold(false)
    }
  }

  const generateMeetingLink = () => {
    if (!formData.meetingDate) {
      alert("Por favor, selecione uma data para a reunião primeiro.")
      return
    }

    const meetingDateTime = new Date(formData.meetingDate)
    const endDateTime = new Date(meetingDateTime.getTime() + 60 * 60 * 1000) // 1 hour later

    // Format dates for Google Calendar (YYYYMMDDTHHMMSSZ)
    const formatGoogleDate = (date: Date) => {
      return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z"
    }

    const startDate = formatGoogleDate(meetingDateTime)
    const endDate = formatGoogleDate(endDateTime)

    const title = encodeURIComponent(`Reunião - ${formData.company || formData.name}`)
    const details = encodeURIComponent(
      `Reunião com ${formData.name}\n` +
        `Empresa: ${formData.company}\n` + // Include company in details
        `Email: ${formData.email}\n` +
        `Telefone: ${formData.phone}\n\n` +
        `Link desta reunião será gerado automaticamente pelo Google Meet.`,
    )
    const location = encodeURIComponent("Google Meet")

    let attendeesParam = ""
    const allAttendees = [formData.email, ...meetingAttendees].filter((email) => email && email.trim())
    allAttendees.forEach((email) => {
      attendeesParam += `&add=${encodeURIComponent(email)}`
    })

    const googleCalendarUrl =
      `https://calendar.google.com/calendar/render?action=TEMPLATE` +
      `&text=${title}` +
      `&dates=${startDate}/${endDate}` +
      `&details=${details}` +
      `&location=${location}` +
      attendeesParam +
      `&add_conferencing=hangoutsMeet`

    // Open Google Calendar in new tab
    window.open(googleCalendarUrl, "_blank")

    // Show instructions
    alert(
      "📅 Google Calendar foi aberto em uma nova aba!\n\n" +
        "✅ O Google Meet será adicionado automaticamente ao evento.\n" +
        `✅ ${allAttendees.length} convidado(s) serão adicionados ao evento.\n\n` +
        "📋 Após criar o evento:\n" +
        "1. Copie o link do Google Meet do evento criado\n" +
        '2. Cole o link no campo "Link da Reunião" abaixo\n' +
        "3. Salve o lead",
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      {isMarkingAsSold && (
        <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center bg-black/80 backdrop-blur-md">
          <div className="flex flex-col items-center gap-4 animate-in zoom-in-95 fade-in duration-300">
            <div className="relative">
              <div className="w-20 h-20 border-4 border-green-500/20 rounded-full animate-pulse" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="w-10 h-10 text-green-500 animate-spin" />
              </div>
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-xl font-bold text-white">Processando Venda...</h3>
              <p className="text-sm text-white/70">Movendo lead para Clientes</p>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white border border-border rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden m-4 animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-6 border-b border-border bg-gradient-to-r from-primary/5 to-primary/10">
          <div>
            <h2 className="text-2xl font-bold text-foreground tracking-tight">
              {initialData?.id ? "Editar Lead" : "Novo Lead"} {/* Updated to check initialData.id */}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">Preencha as informações do lead abaixo</p>
          </div>
          <Button variant="ghost" size="icon" onClick={(e) => handleClose(e)} type="button" className="hover:bg-primary/10">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto max-h-[calc(90vh-140px)]">
          <div className="p-6 space-y-8">
            {/* Informações Básicas */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b border-border/50">
                <User className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-semibold text-foreground">Informações Básicas</h3>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-sm font-medium">
                    Contato
                  </Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => handleChange("name", e.target.value)}
                      placeholder="João Silva ou Tech Solutions Ltda"
                      className="pl-10 h-11"
                    />
                  </div>
                </div>

                {/* Campo Empresa */}
                <div className="space-y-2">
                  <Label htmlFor="company" className="text-sm font-medium text-foreground flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    Empresa
                  </Label>
                  <Select
                    value={formData.company || "none"}
                  onValueChange={(value) => {
                    console.log("[v0] Company select onChange triggered with value:", value)
                    if (value === "none") {
                      handleChange("company", "")
                      setFormData((prev) => ({ ...prev, companyId: undefined, cpfCnpj: "" }))
                      setAddressData({
                        cep: "",
                        street: "",
                        number: "",
                        complement: "",
                        neighborhood: "",
                        city: "",
                        state: "",
                      })
                    } else if (value === "custom") {
                      // User wants to type a custom company name
                      handleChange("company", "")
                      setFormData((prev) => ({ ...prev, companyId: undefined, cpfCnpj: "" }))
                      setAddressData({
                        cep: "",
                        street: "",
                        number: "",
                        complement: "",
                        neighborhood: "",
                        city: "",
                        state: "",
                      })
                    } else {
                      // Find the company to also set company_id, cpfCnpj, and address
                      const selectedCompany = companies.find((c) => c.name === value)

                      if (selectedCompany) {
                        console.log("[v0] Selected company found:", selectedCompany)
                        
                        // Auto-fill CNPJ and location
                        setFormData((prev) => ({
                          ...prev,
                          company: value,
                          companyId: selectedCompany.id,
                          cpfCnpj: selectedCompany.cnpj || prev.cpfCnpj,
                          location: selectedCompany.city && selectedCompany.state 
                            ? `${selectedCompany.city}, ${selectedCompany.state}`
                            : prev.location,
                        }))

                        // Auto-fill address fields
                        setAddressData({
                          cep: selectedCompany.cep || "",
                          street: selectedCompany.street || "",
                          number: selectedCompany.number || "",
                          complement: selectedCompany.complement || "",
                          neighborhood: selectedCompany.neighborhood || "",
                          city: selectedCompany.city || "",
                          state: selectedCompany.state || "",
                        })

                        // Show toast notification
                        const fieldsAutoFilled = []
                        if (selectedCompany.cnpj) fieldsAutoFilled.push("CNPJ")
                        if (selectedCompany.cep || selectedCompany.street) fieldsAutoFilled.push("endereço")

                        if (fieldsAutoFilled.length > 0) {
                          toast({
                            title: "Dados preenchidos automaticamente",
                            description: `${fieldsAutoFilled.join(" e ")} da empresa ${selectedCompany.name} foram adicionados.`,
                          })
                        }
                      } else {
                        // Fallback if company not found (shouldn't happen with this logic)
                        setFormData((prev) => ({ ...prev, companyId: undefined }))
                      }
                    }
                  }}
                  >
                    <SelectTrigger className="bg-background border-border text-foreground h-11">
                      <SelectValue placeholder="Selecione uma empresa" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[300px]" sortItems>
                      <SelectItem value="none">Nenhuma empresa</SelectItem>
                      {companies.length > 0 && (
                        <>
                          {companies.map((company) => (
                            <SelectItem key={company.id} value={company.name}>
                              <div className="flex flex-col">
                                <span>{company.name}</span>
                                {company.cnpj && (
                                  <span className="text-xs text-muted-foreground">CNPJ: {company.cnpj}</span>
                                )}
                              </div>
                            </SelectItem>
                          ))}
                        </>
                      )}
                    </SelectContent>
                  </Select>
                  {companies.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      Nenhuma empresa cadastrada. Cadastre empresas na página "Empresas".
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cpfCnpj" className="text-sm font-medium">
                    CPF ou CNPJ
                  </Label>
                  <div className="relative">
                    <FileText className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="cpfCnpj"
                      value={formData.cpfCnpj}
                      onChange={(e) => handleChange("cpfCnpj", e.target.value)}
                      placeholder="000.000.000-00 ou 00.000.000/0000-00"
                      className="pl-10 h-11"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="proposalName" className="text-sm font-medium">
                    Nome da Proposta
                  </Label>
                  <div className="relative">
                    <FileText className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="proposalName"
                      value={formData.proposalName}
                      onChange={(e) => handleChange("proposalName", e.target.value)}
                      placeholder="Digite o nome da proposta"
                      className="pl-10 h-11"
                    />
                  </div>
                </div>

                {/* Franchise selection field removed */}

                {/* ADDED ADDRESS SECTION START */}
                <div className="md:col-span-2 space-y-4 p-4 bg-muted/30 rounded-lg border border-border">
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    Endereço
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Digite o CEP para preencher automaticamente. O endereço será usado na página de Leads.
                  </p>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="cep" className="text-sm font-medium">
                        CEP
                      </Label>
                      <div className="relative">
                        <Input
                          id="cep"
                          value={addressData.cep}
                          onChange={(e) => handleCepChange(e.target.value)}
                          placeholder="00000-000"
                          maxLength={8}
                          className="h-11"
                          disabled={isLoadingCep}
                        />
                        {isLoadingCep && (
                          <div className="absolute right-3 top-1/2 -translate-y-1/2">
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="number" className="text-sm font-medium">
                        Número
                      </Label>
                      <Input
                        id="number"
                        value={addressData.number}
                        onChange={(e) => setAddressData({ ...addressData, number: e.target.value })}
                        placeholder="123"
                        className="h-11"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="street" className="text-sm font-medium">
                      Logradouro (Rua/Avenida)
                    </Label>
                    <Input
                      id="street"
                      value={addressData.street}
                      onChange={(e) => setAddressData({ ...addressData, street: e.target.value })}
                      placeholder="Rua das Flores"
                      className="h-11"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="complement" className="text-sm font-medium">
                      Complemento
                    </Label>
                    <Input
                      id="complement"
                      value={addressData.complement}
                      onChange={(e) => setAddressData({ ...addressData, complement: e.target.value })}
                      placeholder="Sala 101, Bloco A"
                      className="h-11"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="neighborhood" className="text-sm font-medium">
                      Bairro
                    </Label>
                    <Input
                      id="neighborhood"
                      value={addressData.neighborhood}
                      onChange={(e) => setAddressData({ ...addressData, neighborhood: e.target.value })}
                      placeholder="Centro"
                      className="h-11"
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="city" className="text-sm font-medium">
                        Cidade
                      </Label>
                      <Input
                        id="city"
                        value={addressData.city}
                        onChange={(e) => setAddressData({ ...addressData, city: e.target.value })}
                        placeholder="São Paulo"
                        className="h-11"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="state" className="text-sm font-medium">
                        Estado (UF)
                      </Label>
                      <Input
                        id="state"
                        value={addressData.state}
                        onChange={(e) => setAddressData({ ...addressData, state: e.target.value.toUpperCase() })}
                        placeholder="SP"
                        maxLength={2}
                        className="h-11"
                      />
                    </div>
                  </div>
                </div>
                {/* ADDED ADDRESS SECTION END */}

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="referredBy" className="text-sm font-medium">
                    Indicação <span className="text-muted-foreground font-normal">(Opcional)</span>
                  </Label>
                  <Select
                    value={formData.referredBy || "none"}
                    onValueChange={(value) => handleChange("referredBy", value)}
                  >
                    <SelectTrigger id="referredBy" className="h-11">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <SelectValue placeholder="Selecionar cliente que indicou este lead" />
                      </div>
                    </SelectTrigger>
                    <SelectContent sortItems>
                      <SelectItem value="none">Nenhum indicação</SelectItem>
                      {clients.map((client) => (
                        <SelectItem key={client.id} value={client.id}>
                          {client.name} - {client.company}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Selecione um cliente cadastrado que indicou este lead</p>{" "}
                  {/* Added help text */}
                </div>
              </div>
            </div>

            {/* Contato */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b border-border/50">
                <Mail className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-semibold text-foreground">Contato</h3>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm font-medium">
                    Email
                  </Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      value={formData.email}
                      onChange={(e) => handleChange("email", e.target.value)}
                      className={`pl-10 h-11 ${errors.email ? "border-destructive focus-visible:ring-destructive" : ""}`}
                      placeholder="contato@empresa.com"
                    />
                  </div>
                  {errors.email && (
                    <p className="text-xs text-destructive flex items-center gap-1 mt-1">{errors.email}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone" className="text-sm font-medium">
                    Telefone
                  </Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="phone"
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => handleChange("phone", e.target.value)}
                      placeholder="(11) 98765-4321"
                      className="pl-10 h-11"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="linkedin" className="text-sm font-medium">
                    LinkedIn
                  </Label>
                  <div className="relative">
                    <Linkedin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="linkedin"
                      type="url"
                      value={formData.linkedin}
                      onChange={(e) => handleChange("linkedin", e.target.value)}
                      className={`pl-10 h-11 ${errors.linkedin ? "border-destructive focus-visible:ring-destructive" : ""}`}
                      placeholder="https://linkedin.com/in/..."
                    />
                  </div>
                  {errors.linkedin && (
                    <p className="text-xs text-destructive flex items-center gap-1 mt-1">{errors.linkedin}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="instagram" className="text-sm font-medium">
                    Instagram
                  </Label>
                  <div className="relative">
                    <Instagram className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="instagram"
                      type="url"
                      value={formData.instagram}
                      onChange={(e) => handleChange("instagram", e.target.value)}
                      className={`pl-10 h-11 ${errors.instagram ? "border-destructive focus-visible:ring-destructive" : ""}`}
                      placeholder="https://instagram.com/..."
                    />
                  </div>
                  {errors.instagram && (
                    <p className="text-xs text-destructive flex items-center gap-1 mt-1">{errors.instagram}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Agendamento & Atribuição */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b border-border/50">
                <CalendarIcon className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-semibold text-foreground">Agendamento & Atribuição</h3>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="leadSource" className="text-sm font-medium">
                    Origem do Lead
                  </Label>
                  <Select
                    value={formData.leadSource || ""}
                    onValueChange={(value) => handleChange("leadSource", value)}
                  >
                    <SelectTrigger id="leadSource" className="h-11">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <SelectValue placeholder="Selecione a origem" />
                      </div>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="linkedin">LinkedIn</SelectItem>
                      <SelectItem value="whatsapp">WhatsApp</SelectItem>
                      <SelectItem value="indicacao">Indicação</SelectItem>
                      <SelectItem value="feira">Feira</SelectItem>
                      <SelectItem value="trafego_pago">Tráfego Pago</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="nextFollowUp" className="text-sm font-medium">
                    Data de Acompanhamento
                  </Label>
                  <div className="relative">
                    <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="nextFollowUp"
                      type="datetime-local"
                      value={formData.nextFollowUp || ""}
                      onChange={(e) => handleChange("nextFollowUp", e.target.value)}
                      className="pl-10 h-11"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="meetingDate" className="text-sm font-medium">
                    Data de Reunião
                  </Label>
                  <div className="relative">
                    <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="meetingDate"
                      type="datetime-local"
                      value={formData.meetingDate || ""}
                      onChange={(e) => handleChange("meetingDate", e.target.value)}
                      className="pl-10 h-11"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="status" className="text-sm font-medium">
                    Status
                  </Label>
                  <Select
                    value={formData.status}
                    onValueChange={(value) => handleChange("status", value as LeadStatus)}
                  >
                    <SelectTrigger id="status" className="h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="em_atendimento">{statusConfig.em_atendimento.label}</SelectItem>
                      <SelectItem value="follow_up">{statusConfig.follow_up.label}</SelectItem>
                      <SelectItem value="reuniao_agendada">{statusConfig.reuniao_agendada.label}</SelectItem>
                      <SelectItem value="reuniao_remarcada">{statusConfig.reuniao_remarcada.label}</SelectItem>
                      <SelectItem value="nao_realizada">{statusConfig.nao_realizada.label}</SelectItem>
                      <SelectItem value="sem_atendimento">{statusConfig.sem_atendimento.label}</SelectItem>
                      <SelectItem value="outbound">{statusConfig.outbound.label}</SelectItem>
                      <SelectItem value="reuniao_realizada">{statusConfig.reuniao_realizada.label}</SelectItem>
                      <SelectItem value="em_negociacao">{statusConfig.em_negociacao.label}</SelectItem>
                      <SelectItem value="fechado">{statusConfig.fechado.label}</SelectItem>
                      <SelectItem value="perdido">{statusConfig.perdido.label}</SelectItem>
                      <SelectItem value="no_show">{statusConfig.no_show.label}</SelectItem>
                      <SelectItem value="fila_espera">Fila de Espera SD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* SD Sub-status field - only shown for SD-related statuses */}
                {(formData.status === "fila_espera" || 
                  formData.status === "programacao_time" || 
                  formData.status === "aguardando_informacoes" || 
                  formData.status === "sem_pendencias") && (
                  <div className="space-y-2">
                    <Label htmlFor="sdSubStatus" className="text-sm font-medium">
                      Sub-status SD
                    </Label>
                    <Select
                      value={formData.sdSubStatus || "none"}
                      onValueChange={(value) => handleChange("sdSubStatus", value === "none" ? undefined : (value as SDSubStatus))}
                    >
                      <SelectTrigger id="sdSubStatus" className="h-11">
                        <SelectValue placeholder="Selecione o sub-status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Nenhum</SelectItem>
                        <SelectItem value="analise_dados">{sdSubStatusConfig.analise_dados.label}</SelectItem>
                        <SelectItem value="elaboracao_layout">{sdSubStatusConfig.elaboracao_layout.label}</SelectItem>
                        <SelectItem value="preparando_pc_fpv">{sdSubStatusConfig.preparando_pc_fpv.label}</SelectItem>
                        <SelectItem value="elaborando_proposta">{sdSubStatusConfig.elaborando_proposta.label}</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Selecione o sub-status específico para acompanhamento no SD
                    </p>
                  </div>
                )}

                <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold text-foreground">Estrutura do Produto</h3>
                    <p className="text-xs text-muted-foreground">
                      Configure o quadro personalizado ou selecione um quadro pronto para venda direta.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="productMode" className="text-sm font-medium">
                        Tipo de Produto
                      </Label>
                      <Select
                        value={(formData as any).productMode || "none"}
                        onValueChange={(value) => handleChange("productMode", value === "none" ? "" : value)}
                      >
                        <SelectTrigger id="productMode" className="h-11">
                          <SelectValue placeholder="Selecione o tipo" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Selecione</SelectItem>
                          <SelectItem value="quadro_personalizado">Criar quadro novo</SelectItem>
                          <SelectItem value="quadro_pronto">Quadro pronto</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="productName" className="text-sm font-medium">
                        Produto
                      </Label>
                      <Input
                        id="productName"
                        type="text"
                        value={(formData as any).productName || ""}
                        onChange={(e) => handleChange("productName", e.target.value)}
                        placeholder="Ex: Quadro personalizado sala principal"
                        className="h-11"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="sizePresetId" className="text-sm font-medium">
                        Tamanho Cadastrado
                      </Label>
                      <Select
                        value={(formData as any).sizePresetId || "none"}
                        onValueChange={handleSizeCatalogChange}
                      >
                        <SelectTrigger id="sizePresetId" className="h-11">
                          <SelectValue placeholder="Selecione altura e largura" />
                        </SelectTrigger>
                        <SelectContent sortItems>
                          <SelectItem value="none">Selecione</SelectItem>
                          {sizeCatalog.map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.name} • {item.height}x{item.width} • {formatCurrency(item.price)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="productHeight" className="text-sm font-medium">
                        Altura
                      </Label>
                      <Input
                        id="productHeight"
                        type="number"
                        min="0"
                        step="0.01"
                        value={(formData as any).productHeight || ""}
                        onChange={(e) => handleChange("productHeight", e.target.value)}
                        placeholder="Ex: 120"
                        className="h-11"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="productWidth" className="text-sm font-medium">
                        Largura
                      </Label>
                      <Input
                        id="productWidth"
                        type="number"
                        min="0"
                        step="0.01"
                        value={(formData as any).productWidth || ""}
                        onChange={(e) => handleChange("productWidth", e.target.value)}
                        placeholder="Ex: 80"
                        className="h-11"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="orientation" className="text-sm font-medium">
                        PosiÃ§Ã£o
                      </Label>
                      <Select
                        value={(formData as any).orientation || "none"}
                        onValueChange={(value) => handleChange("orientation", value === "none" ? "" : value)}
                      >
                        <SelectTrigger id="orientation" className="h-11">
                          <SelectValue placeholder="Selecione a posiÃ§Ã£o" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Selecione</SelectItem>
                          <SelectItem value="vertical">Vertical</SelectItem>
                          <SelectItem value="horizontal">Horizontal</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="frameModel" className="text-sm font-medium">
                        Moldura
                      </Label>
                      <Select
                        value={(formData as any).frameModel || "none"}
                        onValueChange={handleFrameCatalogChange}
                      >
                        <SelectTrigger id="frameModel" className="h-11">
                          <SelectValue placeholder="Selecione a moldura cadastrada" />
                        </SelectTrigger>
                        <SelectContent sortItems>
                          <SelectItem value="none">Selecione</SelectItem>
                          {frameCatalog.map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.name} • {formatCurrency(item.price)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="canvasType" className="text-sm font-medium">
                        Tela
                      </Label>
                      <Select
                        value={(formData as any).canvasType || "none"}
                        onValueChange={handleCanvasCatalogChange}
                      >
                        <SelectTrigger id="canvasType" className="h-11">
                          <SelectValue placeholder="Selecione a tela cadastrada" />
                        </SelectTrigger>
                        <SelectContent sortItems>
                          <SelectItem value="none">Selecione</SelectItem>
                          {canvasCatalog.map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.name} • {formatCurrency(item.price)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="priceTableName" className="text-sm font-medium">
                        Tabela de PreÃ§o
                      </Label>
                      <Input
                        id="priceTableName"
                        type="text"
                        value={(formData as any).priceTableName || ""}
                        onChange={(e) => handleChange("priceTableName", e.target.value)}
                        placeholder="Tabela atribuÃ­da ao produto"
                        className="h-11"
                      />
                    </div>

                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="imageReference" className="text-sm font-medium">
                        Imagem
                      </Label>
                      <Input
                        id="imageReference"
                        type="text"
                        value={(formData as any).imageReference || ""}
                        onChange={(e) => handleChange("imageReference", e.target.value)}
                        placeholder="ReferÃªncia da imagem, link ou nome do arquivo"
                        className="h-11"
                      />
                    </div>

                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="paymentMethod" className="text-sm font-medium">
                        MÃ©todo de Pagamento
                      </Label>
                      <Input
                        id="paymentMethod"
                        type="text"
                        value={(formData as any).paymentMethod || ""}
                        onChange={(e) => handleChange("paymentMethod", e.target.value)}
                        placeholder="Definir depois"
                        className="h-11"
                      />
                      <p className="text-xs text-muted-foreground">
                        O site pode seguir com quadros personalizados ou quadros prontos; o pagamento fica em definiÃ§Ã£o.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Value Breakdown Fields */}
                <div className="hidden space-y-4 p-4 border rounded-lg bg-muted/30">
                  <h3 className="text-sm font-semibold text-foreground">Detalhamento de Valores</h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="valueParts" className="text-sm font-medium">
                        Valor de Peças
                      </Label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="valueParts"
                          type="number"
                          value={formData.valueParts || ""}
                          onChange={(e) => {
                            const value = Number(e.target.value) || 0
                            handleChange("valueParts", value)
                            // Auto-calculate total
                            const total = value + (formData.valueServices || 0) + (formData.valueContracts || 0) + (formData.valueEquipment || 0) + (formData.valueProjects || 0)
                            handleChange("value", total)
                          }}
                          placeholder="0"
                          className="pl-10 h-11"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="valueServices" className="text-sm font-medium">
                        Valor de Serviços Avulsos
                      </Label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="valueServices"
                          type="number"
                          value={formData.valueServices || ""}
                          onChange={(e) => {
                            const value = Number(e.target.value) || 0
                            handleChange("valueServices", value)
                            // Auto-calculate total
                            const total = (formData.valueParts || 0) + value + (formData.valueContracts || 0) + (formData.valueEquipment || 0) + (formData.valueProjects || 0)
                            handleChange("value", total)
                          }}
                          placeholder="0"
                          className="pl-10 h-11"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="valueContracts" className="text-sm font-medium">
                        Valor de Contratos de Manutenção
                      </Label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="valueContracts"
                          type="number"
                          value={formData.valueContracts || ""}
                          onChange={(e) => {
                            const value = Number(e.target.value) || 0
                            handleChange("valueContracts", value)
                            // Auto-calculate total
                            const total = (formData.valueParts || 0) + (formData.valueServices || 0) + value + (formData.valueEquipment || 0) + (formData.valueProjects || 0)
                            handleChange("value", total)
                          }}
                          placeholder="0"
                          className="pl-10 h-11"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="valueEquipment" className="text-sm font-medium">
                        Valor de Vendas de Equipamentos
                      </Label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="valueEquipment"
                          type="number"
                          value={formData.valueEquipment || ""}
                          onChange={(e) => {
                            const value = Number(e.target.value) || 0
                            handleChange("valueEquipment", value)
                            // Auto-calculate total
                            const total = (formData.valueParts || 0) + (formData.valueServices || 0) + (formData.valueContracts || 0) + value + (formData.valueProjects || 0)
                            handleChange("value", total)
                          }}
                          placeholder="0"
                          className="pl-10 h-11"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="valueProjects" className="text-sm font-medium">
                        Valor de Projetos
                      </Label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="valueProjects"
                          type="number"
                          value={formData.valueProjects || ""}
                          onChange={(e) => {
                            const value = Number(e.target.value) || 0
                            handleChange("valueProjects", value)
                            // Auto-calculate total
                            const total = (formData.valueParts || 0) + (formData.valueServices || 0) + (formData.valueContracts || 0) + (formData.valueEquipment || 0) + value
                            handleChange("value", total)
                          }}
                          placeholder="0"
                          className="pl-10 h-11"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="value" className="text-sm font-medium">
                    Valor do Pedido
                  </Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="value"
                      type="number"
                      value={formData.value || ""}
                      onChange={(e) => handleChange("value", Number(e.target.value))}
                      placeholder="0"
                      className="pl-10 h-11 bg-muted/50 font-semibold"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">Preencha conforme a tabela de preço atribuída ao produto.</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="saleDate" className="text-sm font-medium">
                    Data da Venda
                  </Label>
                  <div className="relative">
                    <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="saleDate"
                      type="datetime-local"
                      value={formData.saleDate || ""}
                      onChange={(e) => handleChange("saleDate", e.target.value)}
                      className={`pl-10 h-11 ${errors.saleDate ? "border-destructive focus-visible:ring-destructive" : ""}`}
                      disabled={formData.status !== "fechado"} // Disable if not in "fechado" status
                    />
                  </div>
                  {errors.saleDate && (
                    <p className="text-xs text-destructive flex items-center gap-1 mt-1">{errors.saleDate}</p>
                  )}
                </div>

                {/* NEW: Project Code Input */}
                <div className="space-y-2">
                  <Label htmlFor="projectCode" className="text-sm font-medium">
                    Referência Interna do Pedido
                  </Label>
                  <div className="relative">
                    <FileText className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="projectCode"
                      type="text"
                      value={formData.projectCode}
                      onChange={(e) => handleChange("projectCode", e.target.value)}
                      placeholder="Ex: BHT2626.123456"
                      className="pl-10 h-11"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">Use esse campo para um código interno do pedido ou da produção.</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sdr" className="hidden text-sm font-medium">
                    SDR Responsável
                  </Label>
                  <Select
                    value={formData.assignedSDR || "none"}
                    onValueChange={(value) => handleChange("assignedSDR", value)}
                  >
                    <SelectTrigger id="sdr" className="hidden h-11">
                      <SelectValue placeholder="Selecionar SDR" />
                    </SelectTrigger>
                    <SelectContent sortItems>
                      <SelectItem value="none">Nenhum</SelectItem>
                      {allUsers.map((user) => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="hidden text-xs text-muted-foreground">Selecione o SDR responsável por este lead</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="closer" className="text-sm font-medium">
                    Closer Responsável
                  </Label>
                  <Select
                    value={formData.assignedCloser || "none"}
                    onValueChange={(value) => handleChange("assignedCloser", value)}
                  >
                    <SelectTrigger id="closer" className="h-11">
                      <SelectValue placeholder="Selecionar Closer" />
                    </SelectTrigger>
                    <SelectContent sortItems>
                      <SelectItem value="none">Nenhum</SelectItem>
                      {allUsers.map((user) => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Selecione o Closer responsável por este lead</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sd" className="hidden text-sm font-medium">
                    SD Responsável
                  </Label>
                  <Select
                    value={formData.assignedSD || "none"}
                    onValueChange={(value) => handleChange("assignedSD", value)}
                  >
                    <SelectTrigger id="sd" className="hidden h-11">
                      <SelectValue placeholder="Selecionar SD" />
                    </SelectTrigger>
                    <SelectContent sortItems>
                      <SelectItem value="none">Nenhum</SelectItem>
                      {allUsers.map((user) => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="hidden text-xs text-muted-foreground">Selecione o SD responsável por este lead</p>
                </div>
              </div>

              {formData.leadSource === "indicacao" && (
                <div className="grid gap-4 md:grid-cols-2 p-4 bg-muted/30 rounded-lg border border-border">
                  <div className="space-y-2">
                    <Label htmlFor="referralName" className="text-sm font-medium">
                      Nome de Quem Indicou *
                    </Label>
                    <Input
                      id="referralName"
                      type="text"
                      placeholder="Nome completo"
                      value={formData.referralName || ""}
                      onChange={(e) => handleChange("referralName", e.target.value)}
                      className="w-full"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="referralCommission" className="text-sm font-medium">
                      Porcentagem de Comissão (%) *
                    </Label>
                    <Input
                      id="referralCommission"
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      placeholder="Ex: 10.5"
                      value={formData.referralCommission || ""}
                      onChange={(e) =>
                        handleChange(
                          "referralCommission",
                          e.target.value ? Number.parseFloat(e.target.value) : undefined,
                        )
                      }
                      className="w-full"
                      required
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Contato & Endereço */}

            {/* Lead Scoring Section - Weighted Criteria System */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b border-border/50">
                <Sparkles className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-semibold text-foreground">Qualificação do Lead</h3>
                <div className="ml-auto flex items-center gap-3">
                  <div 
                    className="px-3 py-1 rounded-full text-xs font-bold"
                    style={{
                      backgroundColor: getScoreClassification((formData as any).totalScore || 0).bgColor,
                      color: getScoreClassification((formData as any).totalScore || 0).color
                    }}
                  >
                    {getScoreClassification((formData as any).totalScore || 0).label}
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-2xl font-bold text-primary">{(formData as any).totalScore || 0}</span>
                    <span className="text-sm text-muted-foreground">/100</span>
                  </div>
                </div>
              </div>

              <div className="grid gap-2 p-4 bg-muted/30 rounded-lg border border-border">
                {/* 1. Autoridade de decisão (Peso 20%) */}
                <div className="flex items-center justify-between p-3 bg-card rounded-md border border-border">
                  <div className="flex-1">
                    <Label className="text-sm font-medium">1. Autoridade de decisão mapeada</Label>
                    <p className="text-xs text-muted-foreground">Peso: 20%</p>
                  </div>
                  <Select
                    value={String((formData as any).scoreAutoridade || 0)}
                    onValueChange={(value) => {
                      const newData = { ...formData, scoreAutoridade: Number(value) }
                      setFormData({ ...newData, totalScore: calculateWeightedScore(newData) } as any)
                    }}
                  >
                    <SelectTrigger className="w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">0 - Desconhecido</SelectItem>
                      <SelectItem value="1">1 - Influenciadores</SelectItem>
                      <SelectItem value="2">2 - Identificado</SelectItem>
                      <SelectItem value="3">3 - Sem acesso</SelectItem>
                      <SelectItem value="4">4 - Acesso indireto</SelectItem>
                      <SelectItem value="5">5 - Engajado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* 2. Dor estratégica / urgência (Peso 15%) */}
                <div className="flex items-center justify-between p-3 bg-card rounded-md border border-border">
                  <div className="flex-1">
                    <Label className="text-sm font-medium">2. Dor estratégica / urgência</Label>
                    <p className="text-xs text-muted-foreground">Peso: 15%</p>
                  </div>
                  <Select
                    value={String((formData as any).scoreDorUrgencia || 0)}
                    onValueChange={(value) => {
                      const newData = { ...formData, scoreDorUrgencia: Number(value) }
                      setFormData({ ...newData, totalScore: calculateWeightedScore(newData) } as any)
                    }}
                  >
                    <SelectTrigger className="w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">0 - Nice to have</SelectItem>
                      <SelectItem value="1">1 - Sem dor</SelectItem>
                      <SelectItem value="2">2 - Dor leve</SelectItem>
                      <SelectItem value="3">3 - Sem urgência</SelectItem>
                      <SelectItem value="4">4 - Dor clara</SelectItem>
                      <SelectItem value="5">5 - Dor crítica</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* 3. Business case financeiro (Peso 15%) */}
                <div className="flex items-center justify-between p-3 bg-card rounded-md border border-border">
                  <div className="flex-1">
                    <Label className="text-sm font-medium">3. Business case financeiro</Label>
                    <p className="text-xs text-muted-foreground">Peso: 15%</p>
                  </div>
                  <Select
                    value={String((formData as any).scoreBusinessCase || 0)}
                    onValueChange={(value) => {
                      const newData = { ...formData, scoreBusinessCase: Number(value) }
                      setFormData({ ...newData, totalScore: calculateWeightedScore(newData) } as any)
                    }}
                  >
                    <SelectTrigger className="w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">0 - Não existe</SelectItem>
                      <SelectItem value="1">1 - Intuitivo</SelectItem>
                      <SelectItem value="2">2 - Não quant.</SelectItem>
                      <SelectItem value="3">3 - Parcial</SelectItem>
                      <SelectItem value="4">4 - ROI claro</SelectItem>
                      <SelectItem value="5">5 - Validado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* 4. Aderência técnica (Peso 10%) */}
                <div className="flex items-center justify-between p-3 bg-card rounded-md border border-border">
                  <div className="flex-1">
                    <Label className="text-sm font-medium">4. Aderência técnica da solução</Label>
                    <p className="text-xs text-muted-foreground">Peso: 10%</p>
                  </div>
                  <Select
                    value={String((formData as any).scoreAderenciaTecnica || 0)}
                    onValueChange={(value) => {
                      const newData = { ...formData, scoreAderenciaTecnica: Number(value) }
                      setFormData({ ...newData, totalScore: calculateWeightedScore(newData) } as any)
                    }}
                  >
                    <SelectTrigger className="w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">0 - Não atende</SelectItem>
                      <SelectItem value="1">1 - Gaps altos</SelectItem>
                      <SelectItem value="2">2 - Muitos gaps</SelectItem>
                      <SelectItem value="3">3 - Principais</SelectItem>
                      <SelectItem value="4">4 - Totalmente</SelectItem>
                      <SelectItem value="5">5 - Ganho extra</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* 5. Diferenciação vs concorrência (Peso 10%) */}
                <div className="flex items-center justify-between p-3 bg-card rounded-md border border-border">
                  <div className="flex-1">
                    <Label className="text-sm font-medium">5. Diferenciação vs concorrência</Label>
                    <p className="text-xs text-muted-foreground">Peso: 10%</p>
                  </div>
                  <Select
                    value={String((formData as any).scoreDiferenciacao || 0)}
                    onValueChange={(value) => {
                      const newData = { ...formData, scoreDiferenciacao: Number(value) }
                      setFormData({ ...newData, totalScore: calculateWeightedScore(newData) } as any)
                    }}
                  >
                    <SelectTrigger className="w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">0 - Commodity</SelectItem>
                      <SelectItem value="1">1 - Pouco dif.</SelectItem>
                      <SelectItem value="2">2 - Poucos dif.</SelectItem>
                      <SelectItem value="3">3 - Percebidos</SelectItem>
                      <SelectItem value="4">4 - Valorizados</SelectItem>
                      <SelectItem value="5">5 - Referência</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* 6. Gestão de riscos (Peso 10%) */}
                <div className="flex items-center justify-between p-3 bg-card rounded-md border border-border">
                  <div className="flex-1">
                    <Label className="text-sm font-medium">6. Gestão de riscos clara</Label>
                    <p className="text-xs text-muted-foreground">Peso: 10%</p>
                  </div>
                  <Select
                    value={String((formData as any).scoreGestaoRiscos || 0)}
                    onValueChange={(value) => {
                      const newData = { ...formData, scoreGestaoRiscos: Number(value) }
                      setFormData({ ...newData, totalScore: calculateWeightedScore(newData) } as any)
                    }}
                  >
                    <SelectTrigger className="w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">0 - Desconhecido</SelectItem>
                      <SelectItem value="1">1 - Sem plano</SelectItem>
                      <SelectItem value="2">2 - Altos</SelectItem>
                      <SelectItem value="3">3 - Mapeados</SelectItem>
                      <SelectItem value="4">4 - Mitigados</SelectItem>
                      <SelectItem value="5">5 - Confiante</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* 7. Cronograma e timing (Peso 8%) */}
                <div className="flex items-center justify-between p-3 bg-card rounded-md border border-border">
                  <div className="flex-1">
                    <Label className="text-sm font-medium">7. Cronograma e timing</Label>
                    <p className="text-xs text-muted-foreground">Peso: 8%</p>
                  </div>
                  <Select
                    value={String((formData as any).scoreCronograma || 0)}
                    onValueChange={(value) => {
                      const newData = { ...formData, scoreCronograma: Number(value) }
                      setFormData({ ...newData, totalScore: calculateWeightedScore(newData) } as any)
                    }}
                  >
                    <SelectTrigger className="w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">0 - Sem prazo</SelectItem>
                      <SelectItem value="1">1 - Indefinido</SelectItem>
                      <SelectItem value="2">2 - Incerto</SelectItem>
                      <SelectItem value="3">3 - Definida</SelectItem>
                      <SelectItem value="4">4 - Data clara</SelectItem>
                      <SelectItem value="5">5 - Crítico</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* 8. Modelo comercial / contrato (Peso 7%) */}
                <div className="flex items-center justify-between p-3 bg-card rounded-md border border-border">
                  <div className="flex-1">
                    <Label className="text-sm font-medium">8. Modelo comercial / contrato</Label>
                    <p className="text-xs text-muted-foreground">Peso: 7%</p>
                  </div>
                  <Select
                    value={String((formData as any).scoreModeloComercial || 0)}
                    onValueChange={(value) => {
                      const newData = { ...formData, scoreModeloComercial: Number(value) }
                      setFormData({ ...newData, totalScore: calculateWeightedScore(newData) } as any)
                    }}
                  >
                    <SelectTrigger className="w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">0 - Inviável</SelectItem>
                      <SelectItem value="1">1 - Restrições</SelectItem>
                      <SelectItem value="2">2 - Muitas rest.</SelectItem>
                      <SelectItem value="3">3 - Com ajustes</SelectItem>
                      <SelectItem value="4">4 - Bem aceito</SelectItem>
                      <SelectItem value="5">5 - Acordado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* 9. Patrocinador interno (Peso 5%) */}
                <div className="flex items-center justify-between p-3 bg-card rounded-md border border-border">
                  <div className="flex-1">
                    <Label className="text-sm font-medium">9. Patrocinador interno</Label>
                    <p className="text-xs text-muted-foreground">Peso: 5%</p>
                  </div>
                  <Select
                    value={String((formData as any).scorePatrocinador || 0)}
                    onValueChange={(value) => {
                      const newData = { ...formData, scorePatrocinador: Number(value) }
                      setFormData({ ...newData, totalScore: calculateWeightedScore(newData) } as any)
                    }}
                  >
                    <SelectTrigger className="w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">0 - Inexistente</SelectItem>
                      <SelectItem value="1">1 - Muito fraco</SelectItem>
                      <SelectItem value="2">2 - Fraco</SelectItem>
                      <SelectItem value="3">3 - Informal</SelectItem>
                      <SelectItem value="4">4 - Defensor</SelectItem>
                      <SelectItem value="5">5 - Sponsor</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Score Interpretation Guide */}
              <div className="flex flex-wrap gap-2 text-xs">
                <div className="flex items-center gap-1 px-2 py-1 rounded" style={{ backgroundColor: "#FEE2E2", color: "#DC2626" }}>
                  80-100: QUENTE
                </div>
                <div className="flex items-center gap-1 px-2 py-1 rounded" style={{ backgroundColor: "#FEF3C7", color: "#F59E0B" }}>
                  60-79: MORNA
                </div>
                <div className="flex items-center gap-1 px-2 py-1 rounded" style={{ backgroundColor: "#DBEAFE", color: "#3B82F6" }}>
                  40-59: FRIA
                </div>
                <div className="flex items-center gap-1 px-2 py-1 rounded" style={{ backgroundColor: "#F3F4F6", color: "#6B7280" }}>
                  {"<"}40: DESCARTAR
                </div>
              </div>
            </div>

            {/* Informações da Reunião */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b border-border/50">
                <Video className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-semibold text-foreground">Informações da Reunião</h3>
              </div>

              <div className="space-y-4">
                {" "}
                {/* Combined grid with meeting info */}
                {formData.email && (
                  <div className="p-3 bg-primary/5 rounded-lg border border-primary/20">
                    <p className="text-xs text-muted-foreground mb-2">Convidado principal (automático):</p>
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 text-primary rounded-full text-sm w-fit">
                      <Mail className="h-3 w-3" />
                      <span>{formData.email}</span>
                    </div>
                  </div>
                )}
                {meetingAttendees.length > 0 && (
                  <div className="flex flex-wrap gap-2 p-3 bg-muted/30 rounded-lg border border-border">
                    {meetingAttendees.map((email) => (
                      <div
                        key={email}
                        className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 text-primary rounded-full text-sm"
                      >
                        <Mail className="h-3 w-3" />
                        <span>{email}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveAttendee(email)}
                          className="hover:bg-primary/20 rounded-full p-0.5 transition-colors"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <Input
                    type="email"
                    placeholder="Adicionar outro convidado (opcional)"
                    value={newAttendeeEmail}
                    onChange={(e) => setNewAttendeeEmail(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        handleAddAttendee()
                      }
                    }}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleAddAttendee}
                    className="shrink-0 gap-2 bg-transparent"
                  >
                    <UserPlus className="h-4 w-4" />
                    Adicionar
                  </Button>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="meetingLink" className="text-sm font-medium flex items-center gap-2">
                    <Video className="h-4 w-4" />
                    Link da Reunião (Google Meet)
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="meetingLink"
                      type="text"
                      placeholder="https://meet.google.com/xxx-xxxx-xxx"
                      value={formData.meetingLink || ""}
                      onChange={(e) => handleChange("meetingLink", e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="default"
                      onClick={generateMeetingLink}
                      className="bg-primary hover:bg-primary/90"
                      title="Criar evento no Google Calendar com Google Meet"
                    >
                      <Sparkles className="h-4 w-4" />
                      Criar no Google
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Clique em "Criar no Google" para abrir o Google Calendar. O Google Meet será adicionado
                    automaticamente. Após criar o evento, copie o link do Meet e cole aqui.
                  </p>
                </div>
              </div>
            </div>

            {/* Detalhes Adicionais */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b border-border/50">
                <FileText className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-semibold text-foreground">Detalhes Adicionais</h3>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes" className="text-sm font-medium">
                  Comentários
                </Label>
                <Textarea
                  id="notes"
                  value={formData.notes || ""}
                  onChange={(e) => handleChange("notes", e.target.value)}
                  placeholder="Informações adicionais sobre o lead, histórico de conversas, observações importantes..."
                  rows={4}
                  className="resize-none"
                />
                <p className="text-xs text-muted-foreground">Adicione qualquer informação relevante sobre este lead</p>{" "}
                {/* Added help text */}
              </div>

              {/* Tasks Section */}
              <div className="space-y-4 pt-4">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium flex items-center gap-2">
                    <CalendarIcon className="h-4 w-4 text-primary" /> {/* Changed icon to CalendarIcon */}
                    Tarefas ({tasks.length}/30)
                  </Label>
                  {isLoadingTasks && <span className="text-xs text-muted-foreground">Carregando...</span>}
                </div>

                {!tasksTableExists && (
                  <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <p className="text-sm text-yellow-800">
                      ⚠️ A tabela de tarefas ainda não foi criada. Execute o script{" "}
                      <code className="bg-yellow-100 px-1 py-0.5 rounded">009_create_tasks_table_v2.sql</code> no
                      Supabase.
                    </p>
                  </div>
                )}

                {tasks.length > 0 && (
                  <div className="space-y-2 max-h-[300px] overflow-y-auto border border-border rounded-lg p-3">
                    {tasks.map((task) => (
                      <div
                        key={task.id}
                        className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors"
                      >
                        <Checkbox
                          checked={task.completed}
                          onCheckedChange={() => handleToggleTask(task.id)}
                          className="mt-1"
                        />
                        <div className="flex-1 min-w-0">
                          <p
                            className={`text-sm ${task.completed ? "line-through text-muted-foreground" : "text-foreground"}`}
                          >
                            {task.description}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {new Date(task.due_date).toLocaleDateString("pt-BR", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                            })}{" "}
                            às{" "}
                            {new Date(task.due_date).toLocaleTimeString("pt-BR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveTask(task.id)}
                          className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-4 w-4" /> {/* Changed icon to Trash2 */}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-3 border border-border rounded-lg p-4 bg-muted/20">
                  <Label className="text-sm font-medium">Adicionar Nova Tarefa</Label>
                  <div className="space-y-3">
                    <Input
                      value={newTaskDescription}
                      onChange={(e) => setNewTaskDescription(e.target.value)}
                      placeholder="Descrição da tarefa..."
                      className="h-10"
                      maxLength={200}
                    />
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <Input
                          type="datetime-local"
                          value={newTaskDateTime}
                          onChange={(e) => setNewTaskDateTime(e.target.value)}
                          className="h-10"
                        />
                      </div>
                      <Button
                        type="button"
                        onClick={handleAddTask}
                        disabled={tasks.length >= 30 || !newTaskDescription.trim() || !newTaskDateTime}
                        className="gap-2 h-10"
                      >
                        <Plus className="h-4 w-4" /> {/* Changed icon to Plus */}
                        Adicionar
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {" "}
                    {/* Added help text */}
                    As tarefas aparecerão no calendário na data e horário marcados
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 p-6 border-t border-border bg-gradient-to-r from-primary/5 to-primary/10">
            {initialData && (
              <Button
                type="button"
                onClick={handleMarkAsSold}
                disabled={isMarkingAsSold || isSubmitting}
                className="bg-green-600 hover:bg-green-700 text-white min-w-[140px] h-11 shadow-lg shadow-green-600/20 transition-all duration-200"
              >
                {isMarkingAsSold ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Processando...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Vendido
                  </>
                )}
              </Button>
            )}
            <Button
              type="button"
              onClick={handleSendToSD}
              className="hidden bg-purple-600 hover:bg-purple-700 min-w-[160px] h-11 shadow-lg shadow-purple-600/20"
              disabled={isSubmitting || isMarkingAsSold}
            >
              {isSubmitting ? "Enviando..." : "Enviar para SD"}
            </Button>
            <Button
              type="button"
              onClick={handleSendToCloser}
              className="bg-purple-600 hover:bg-purple-700 min-w-[180px] h-11 shadow-lg shadow-purple-600/20"
              disabled={isSubmitting || isMarkingAsSold}
            >
              {isSubmitting ? "Enviando..." : "Enviar para o Closer"}
            </Button>
            <Button
              type="button"
              onClick={handleSendToSDR}
              className="hidden bg-orange-600 hover:bg-orange-700 min-w-[180px] h-11 shadow-lg shadow-orange-600/20"
              disabled={isSubmitting || isMarkingAsSold}
            >
              {isSubmitting ? "Enviando..." : "Enviar para SDR"}
            </Button>
            <Button
              type="submit"
              className="bg-primary hover:bg-primary-600 min-w-[120px] h-11 shadow-lg shadow-primary/20"
              disabled={isSubmitting || isMarkingAsSold}
            >
              {isSubmitting ? "Salvando..." : initialData?.id ? "Salvar Alterações" : "Criar Lead"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
