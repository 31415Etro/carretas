"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import { isCurrentUserAdmin } from "@/lib/server-authorization"

export interface LeadInput {
  name: string
  company: string
  company_id?: string
  email?: string
  phone?: string
  cpf_cnpj?: string
  proposal_name?: string
  location: string
  follow_up_date?: string
  meeting_date?: string
  meeting_link?: string
  meeting_attendees?: string[]
  status: string
  sd_sub_status?: string | null
  sdr_id?: string
  closer_id?: string
  sd_id?: string
  linkedin_url?: string
  instagram_url?: string
  deal_value?: number
  closed_date?: string | null
  notes?: string
  referred_by?: string
  project_id?: string
  lead_source?: string
  referral_name?: string
  referral_commission?: number
  project_code?: string
  franchise_id?: string
  value?: number
  sale_date?: string
  cep?: string
  street?: string
  number?: string
  complement?: string
  neighborhood?: string
  city?: string
  state?: string
  // Lead scoring fields - new weighted criteria system (0-5 values)
  score_autoridade?: number
  score_dor_urgencia?: number
  score_business_case?: number
  score_aderencia_tecnica?: number
  score_diferenciacao?: number
  score_gestao_riscos?: number
  score_cronograma?: number
  score_modelo_comercial?: number
  score_patrocinador?: number
}

async function generateProjectCode(supabase: any): Promise<string> {
  const year = new Date().getFullYear().toString().slice(-2) // Get last 2 digits of year (e.g., "26")
  
  // Generate a random 6-digit number
  const randomNumber = Math.floor(100000 + Math.random() * 900000) // Generates number between 100000-999999
  
  // Format: BHT{year}.{random} - e.g., BHT26.123456
  const code = `BHT${year}.${randomNumber}`
  
  // Check if code already exists (unlikely but possible)
  const { data: existing } = await supabase
    .from("leads")
    .select("id")
    .eq("project_code", code)
    .single()
  
  // If code exists, recursively generate a new one
  if (existing) {
    return generateProjectCode(supabase)
  }
  
  return code
}

export async function createLead(input: LeadInput) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: "Unauthorized" }
  }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()

  const userRole = profile?.role || "user"

  let sdrId = input.sdr_id && input.sdr_id.trim() !== "" ? input.sdr_id : undefined
  let closerId = input.closer_id && input.closer_id.trim() !== "" ? input.closer_id : undefined
  let sdId = input.sd_id && input.sd_id.trim() !== "" ? input.sd_id : undefined

  if (userRole === "sdr" && !sdrId) {
    sdrId = user.id
  }

  if (userRole === "closer" && !closerId) {
    closerId = user.id
  }

  if (userRole === "sd" && !sdId) {
    sdId = user.id
  }

  // Project code is NOT auto-generated on lead creation
  // It will be generated automatically when the lead is assigned to a Closer via updateLead
  let projectCode = input.project_code

  let autoCreatedProjectId = input.project_id
  if (input.company && input.cpf_cnpj && input.company.trim() !== "" && input.cpf_cnpj.trim() !== "") {
    try {
      // First, check if a project already exists with this CNPJ by checking existing leads
      const { data: existingLeadsWithCNPJ } = await supabase
        .from("leads")
        .select("project_id, cpf_cnpj")
        .eq("cpf_cnpj", input.cpf_cnpj)
        .not("project_id", "is", null)
        .limit(1)
        .single()

      if (existingLeadsWithCNPJ && existingLeadsWithCNPJ.project_id) {
        // Project already exists for this CNPJ - reuse it
        autoCreatedProjectId = existingLeadsWithCNPJ.project_id
        console.log(
          "[v0] createLead - Found existing project:",
          existingLeadsWithCNPJ.project_id,
          "for CNPJ:",
          input.cpf_cnpj,
        )
      } else {
        // No existing project - create a new one
        const projectData = {
          name: input.company,
          status: "completed",
          total_value: input.deal_value || 0,
          cep: input.cep || null,
          street: input.street || null,
          number: input.number || null,
          complement: input.complement || null,
          neighborhood: input.neighborhood || null,
          city: input.city || null,
          state: input.state || null,
          created_by: user.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }

        const { data: newProject, error: projectError } = await supabase
          .from("projects")
          .insert(projectData)
          .select()
          .single()

        if (!projectError && newProject) {
          autoCreatedProjectId = newProject.id
          console.log("[v0] createLead - Auto-created new project:", newProject.id, "for company:", input.company)
        } else if (projectError) {
          console.error("[v0] createLead - Error auto-creating project:", projectError)
        }
      }
    } catch (err) {
      console.error("[v0] createLead - Exception checking/creating project:", err)
    }
  }

  // Use the generated project code
  let generatedProjectCode = projectCode

  const insertData: any = {
    name: input.name,
    company: input.company,
    company_id: input.company_id || null,
    email: input.email,
    phone: input.phone,
    cpf_cnpj: input.cpf_cnpj,
    proposal_name: input.proposal_name,
    location: input.location,
    follow_up_date: input.follow_up_date && input.follow_up_date.trim() !== "" ? input.follow_up_date : undefined,
    meeting_date: input.meeting_date && input.meeting_date.trim() !== "" ? input.meeting_date : undefined,
    meeting_link: input.meeting_link && input.meeting_link.trim() !== "" ? input.meeting_link : undefined,
    status: input.status,
    // DEBUG: Verificar se o status está chegando corretamente
    // Log status value before inserting
    ...(console.log("[v0] createLead - status being saved:", input.status) as any),
    sd_sub_status: input.sd_sub_status || null,
    sdr_id: sdrId,
    closer_id: closerId,
    sd_id: sdId,
    linkedin_url: input.linkedin_url,
    instagram_url: input.instagram_url,
    deal_value: input.deal_value,
    closed_date: input.closed_date,
    notes: input.notes,
    referred_by: input.referred_by && input.referred_by.trim() !== "" ? input.referred_by : undefined,
    project_id: autoCreatedProjectId && autoCreatedProjectId.trim() !== "" ? autoCreatedProjectId : undefined,
    lead_source: input.lead_source && input.lead_source.trim() !== "" ? input.lead_source : undefined,
    referral_name: input.referral_name && input.referral_name.trim() !== "" ? input.referral_name : undefined,
    referral_commission: input.referral_commission,
    project_code: generatedProjectCode,
    franchise_id: input.franchise_id,
    value: input.value,
    sale_date: input.sale_date,
    cep: input.cep || null,
    street: input.street || null,
    number: input.number || null,
    complement: input.complement || null,
    neighborhood: input.neighborhood || null,
    city: input.city || null,
    state: input.state || null,
    // Lead scoring fields - new weighted criteria system
    score_autoridade: input.score_autoridade || 0,
    score_dor_urgencia: input.score_dor_urgencia || 0,
    score_business_case: input.score_business_case || 0,
    score_aderencia_tecnica: input.score_aderencia_tecnica || 0,
    score_diferenciacao: input.score_diferenciacao || 0,
    score_gestao_riscos: input.score_gestao_riscos || 0,
    score_cronograma: input.score_cronograma || 0,
    score_modelo_comercial: input.score_modelo_comercial || 0,
    score_patrocinador: input.score_patrocinador || 0,
    // Value breakdown fields
    value_parts: input.value_parts || 0,
    value_services: input.value_services || 0,
    value_maintenance_contracts: input.value_maintenance_contracts || 0,
    value_equipment_sales: input.value_equipment_sales || 0,
    value_projects: input.value_projects || 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    created_by: user.id,
  }

  if (input.meeting_attendees && input.meeting_attendees.length > 0) {
    insertData.meeting_attendees = input.meeting_attendees
  }

  const { data, error } = await supabase.from("leads").insert(insertData).select().single()

  if (error) {
    console.error("Error creating lead:", error)
    return { error: error.message }
  }

  revalidatePath("/leads")
  revalidatePath("/kanban/sdr")
  revalidatePath("/kanban/closer")
  revalidatePath("/clients")
  revalidatePath("/calendar")
  revalidatePath("/sd")
  revalidatePath("/projects") // Revalidate projects page

  return { data }
}

export async function updateLead(id: string, input: Partial<LeadInput>) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return { error: "Unauthorized" }
    }

    // Use admin client to bypass RLS for update operations
    const { createClient: createServiceClient } = await import("@supabase/supabase-js")
    const adminClient = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const { data: currentLead } = await adminClient.from("leads").select("project_code, company").eq("id", id).single()

    const updateData: { [key: string]: any } = {}

  if (input.name !== undefined) updateData.name = input.name
  if (input.company !== undefined) updateData.company = input.company
  if (input.company_id !== undefined) updateData.company_id = input.company_id || null
  if (input.email !== undefined) updateData.email = input.email
  if (input.phone !== undefined) updateData.phone = input.phone
  if (input.cpf_cnpj !== undefined) updateData.cpf_cnpj = input.cpf_cnpj
  if (input.proposal_name !== undefined) updateData.proposal_name = input.proposal_name
  if (input.location !== undefined) updateData.location = input.location
  if (input.status !== undefined) updateData.status = input.status
  if (input.sd_sub_status !== undefined) updateData.sd_sub_status = input.sd_sub_status || null
  if (input.linkedin_url !== undefined) updateData.linkedin_url = input.linkedin_url
  if (input.instagram_url !== undefined) updateData.instagram_url = input.instagram_url
  if (input.deal_value !== undefined) updateData.deal_value = input.deal_value
    if (input.notes !== undefined) updateData.notes = input.notes
    
    // Lead scoring fields - new weighted criteria system
    if (input.score_autoridade !== undefined) updateData.score_autoridade = input.score_autoridade
    if (input.score_dor_urgencia !== undefined) updateData.score_dor_urgencia = input.score_dor_urgencia
    if (input.score_business_case !== undefined) updateData.score_business_case = input.score_business_case
    if (input.score_aderencia_tecnica !== undefined) updateData.score_aderencia_tecnica = input.score_aderencia_tecnica
    if (input.score_diferenciacao !== undefined) updateData.score_diferenciacao = input.score_diferenciacao
    if (input.score_gestao_riscos !== undefined) updateData.score_gestao_riscos = input.score_gestao_riscos
    if (input.score_cronograma !== undefined) updateData.score_cronograma = input.score_cronograma
    if (input.score_modelo_comercial !== undefined) updateData.score_modelo_comercial = input.score_modelo_comercial
    if (input.score_patrocinador !== undefined) updateData.score_patrocinador = input.score_patrocinador

    // Value breakdown fields
    if (input.value_parts !== undefined) updateData.value_parts = input.value_parts || 0
    if (input.value_services !== undefined) updateData.value_services = input.value_services || 0
    if (input.value_maintenance_contracts !== undefined) updateData.value_maintenance_contracts = input.value_maintenance_contracts || 0
    if (input.value_equipment_sales !== undefined) updateData.value_equipment_sales = input.value_equipment_sales || 0
    if (input.value_projects !== undefined) updateData.value_projects = input.value_projects || 0

    if (input.lead_source !== undefined) {
      updateData.lead_source = input.lead_source && input.lead_source.trim() !== "" ? input.lead_source : null
    }
    if (input.referral_name !== undefined) {
      updateData.referral_name = input.referral_name && input.referral_name.trim() !== "" ? input.referral_name : null
    }
    if (input.referral_commission !== undefined) {
      updateData.referral_commission = input.referral_commission
    }

    if (input.closed_date !== undefined) {
    updateData.closed_date = input.closed_date
  }

    if (input.meeting_link !== undefined) {
      updateData.meeting_link = input.meeting_link && input.meeting_link.trim() !== "" ? input.meeting_link : null
    }

    if (input.meeting_attendees !== undefined && Array.isArray(input.meeting_attendees)) {
      const attendees = input.meeting_attendees.filter((email) => email && email.trim() !== "")
      if (attendees.length > 0) {
        updateData.meeting_attendees = attendees
      }
    }

    if (input.follow_up_date !== undefined) {
      updateData.follow_up_date =
        input.follow_up_date && input.follow_up_date.trim() !== "" ? input.follow_up_date : null
    }
    if (input.meeting_date !== undefined) {
      updateData.meeting_date = input.meeting_date && input.meeting_date.trim() !== "" ? input.meeting_date : null
    }

    if (input.sdr_id !== undefined) {
      updateData.sdr_id = input.sdr_id && input.sdr_id.trim() !== "" ? input.sdr_id : null
    }
    if (input.closer_id !== undefined) {
      updateData.closer_id = input.closer_id && input.closer_id.trim() !== "" ? input.closer_id : null
    }
    if (input.sd_id !== undefined) {
      updateData.sd_id = input.sd_id && input.sd_id.trim() !== "" ? input.sd_id : null
    }
    if (input.referred_by !== undefined) {
      updateData.referred_by = input.referred_by && input.referred_by.trim() !== "" ? input.referred_by : null
    }
    if (input.project_id !== undefined) {
      updateData.project_id = input.project_id && input.project_id.trim() !== "" ? input.project_id : null
    }
    if (input.franchise_id !== undefined) {
      updateData.franchise_id = input.franchise_id && input.franchise_id.trim() !== "" ? input.franchise_id : null
    }
    if (input.value !== undefined) {
      updateData.value = input.value
    }
    if (input.sale_date !== undefined) {
      updateData.sale_date = input.sale_date
    }

    if (input.cep !== undefined) {
      updateData.cep = input.cep && input.cep.trim() !== "" ? input.cep : null
    }
    if (input.street !== undefined) {
      updateData.street = input.street && input.street.trim() !== "" ? input.street : null
    }
    if (input.number !== undefined) {
      updateData.number = input.number && input.number.trim() !== "" ? input.number : null
    }
    if (input.complement !== undefined) {
      updateData.complement = input.complement && input.complement.trim() !== "" ? input.complement : null
    }
    if (input.neighborhood !== undefined) {
      updateData.neighborhood = input.neighborhood && input.neighborhood.trim() !== "" ? input.neighborhood : null
    }
    if (input.city !== undefined) {
      updateData.city = input.city && input.city.trim() !== "" ? input.city : null
    }
    if (input.state !== undefined) {
      updateData.state = input.state && input.state.trim() !== "" ? input.state : null
    }

    // Auto-generate project code when assigning to a Closer (if no code exists)
    const isBeingAssignedToCloser = input.closer_id && input.closer_id.trim() !== "" && input.closer_id !== "none"
    const currentlyHasNoCloser = !currentLead?.project_code
    
  if (isBeingAssignedToCloser && currentlyHasNoCloser) {
    updateData.project_code = await generateProjectCode(adminClient)
  }
    
    // Allow manual override of project_code ONLY if a non-null/non-empty value is provided
    // Don't override if input.project_code is null or undefined (preserve auto-generated code)
    if (input.project_code !== undefined && input.project_code !== null && input.project_code.trim() !== "") {
      updateData.project_code = input.project_code
    }

    updateData.updated_at = new Date().toISOString()

    const { data, error } = await adminClient.from("leads").update(updateData).eq("id", id).select().single()

    if (error) {
      return { error: `Erro ao atualizar: ${error.message}` }
    }

    revalidatePath("/leads")
    revalidatePath("/kanban/sdr")
    revalidatePath("/kanban/closer")
    revalidatePath("/clients")
    revalidatePath("/calendar")
    revalidatePath("/sd")
    revalidatePath("/projects") // Revalidate projects page

    return { data }
  } catch (err: any) {
    console.error("Unexpected error updating lead:", err.message)
    return { error: `Erro inesperado: ${err.message}` }
  }
}

export async function deleteLead(id: string) {
  if (!(await isCurrentUserAdmin())) return { error: "Somente administradores podem excluir registros" }
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: "Unauthorized" }
  }

  const { error } = await supabase.from("leads").delete().eq("id", id)

  if (error) {
    console.error("Error deleting lead:", error)
    return { error: error.message }
  }

  revalidatePath("/leads")
  revalidatePath("/kanban/sdr")
  revalidatePath("/kanban/closer")
  revalidatePath("/clients")
  revalidatePath("/calendar")
  revalidatePath("/sd") // Revalidate SD page

  return { success: true }
}

export async function getLeads() {
  const supabase = await createClient()

  const { data: leads, error: leadsError } = await supabase
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false })

  if (leadsError) {
    console.error("Error fetching leads:", leadsError)
    return []
  }

  const projectIds = new Set<string>()
  leads?.forEach((lead: any) => {
    if (lead.project_id) projectIds.add(lead.project_id)
  })

  let projectMap = new Map()
  if (projectIds.size > 0) {
    const { data: projects } = await supabase.from("projects").select("id, name").in("id", Array.from(projectIds))
    projectMap = new Map(projects?.map((p: any) => [p.id, { id: p.id, name: p.name }]) || [])
  }

  const userIds = new Set<string>()
  leads?.forEach((lead: any) => {
    if (lead.sdr_id) userIds.add(lead.sdr_id)
    if (lead.closer_id) userIds.add(lead.closer_id)
    if (lead.sd_id) userIds.add(lead.sd_id)
  })

  const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", Array.from(userIds))

  const profileMap = new Map(profiles?.map((p: any) => [p.id, p.full_name]) || [])

  const mappedData = leads?.map((lead: any) => ({
    ...lead,
    projectId: lead.project_id,
    project: lead.project_id ? projectMap.get(lead.project_id) || null : null,
    sdr: lead.sdr_id ? { full_name: profileMap.get(lead.sdr_id) || null } : null,
    closer: lead.closer_id ? { full_name: profileMap.get(lead.closer_id) || null } : null,
    sd: lead.sd_id ? { full_name: profileMap.get(lead.sd_id) || null } : null,
  }))

  return mappedData || []
}

export async function getLeadsByStatus(status: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("status", status)
    .order("created_at", { ascending: false })

  if (error) {
    console.error("[v0] Error fetching leads by status:", error)
    return { error: error.message, data: [] }
  }

  const mappedData = data?.map((lead: any) => ({
    ...lead,
    projectId: lead.project_id,
  }))

  return { data: mappedData || [] }
}

export async function getLeadsByUser() {
  try {
    const supabase = await createClient()

    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser()

    if (!authUser) {
      return { error: "Unauthorized", data: [] }
    }

    const { data: profile } = await supabase.from("profiles").select("role, manager_id").eq("id", authUser.id).single()

    const userRole = profile?.role || "user"

    // Single query - no pagination loop. Admins and representatives see all leads.
    let query = supabase
      .from("leads")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1000)

    if (userRole === "sdr") {
      query = query.eq("sdr_id", authUser.id)
    } else if (userRole === "closer") {
      query = query.eq("closer_id", authUser.id)
    } else if (userRole === "sd") {
      query = query.eq("sd_id", authUser.id)
    } else if (userRole === "manager") {
      const { data: teamMembers } = await supabase.from("profiles").select("id").eq("manager_id", authUser.id)

      if (teamMembers && teamMembers.length > 0) {
        const teamMemberIds = teamMembers.map((tm: any) => tm.id)
        query = query.or(`sdr_id.in.(${teamMemberIds.join(",")}),closer_id.in.(${teamMemberIds.join(",")}),sd_id.in.(${teamMemberIds.join(",")})`)
      } else {
        return { data: [] }
      }
    }
    // admin, representative, user -> no filter, see all leads

    const { data: allLeads, error } = await query

    if (error) {
      return { error: error.message, data: [] }
    }

    if (!allLeads || allLeads.length === 0) {
      return { data: [] }
    }

    // Get project info
    const projectIds = [...new Set(allLeads.filter((l: any) => l.project_id).map((l: any) => l.project_id))]
    let projectMap = new Map()
    if (projectIds.length > 0) {
      const { data: projects } = await supabase.from("projects").select("id, name").in("id", projectIds)
      projectMap = new Map(projects?.map((p: any) => [p.id, { id: p.id, name: p.name }]) || [])
    }

    // Get user info
    const userIds = [...new Set(allLeads.flatMap((l: any) => [l.sdr_id, l.closer_id, l.sd_id].filter(Boolean)))]
    let profileMap = new Map()
    if (userIds.length > 0) {
      const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", userIds)
      profileMap = new Map(profiles?.map((p: any) => [p.id, p.full_name]) || [])
    }

    const mappedData = allLeads.map((lead: any) => ({
      ...lead,
      projectId: lead.project_id,
      project: lead.project_id ? projectMap.get(lead.project_id) || null : null,
      sdr: lead.sdr_id ? { full_name: profileMap.get(lead.sdr_id) || null } : null,
      closer: lead.closer_id ? { full_name: profileMap.get(lead.closer_id) || null } : null,
      sd: lead.sd_id ? { full_name: profileMap.get(lead.sd_id) || null } : null,
    }))

    return { data: mappedData }
  } catch (err: any) {
    return { error: err?.message || "Failed to load leads", data: [] }
  }
}

export async function getClients() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("status", "fechado")
    .order("closed_date", { ascending: false })

  if (error) {
    return []
  }

  const projectIds = new Set<string>()
  data?.forEach((lead: any) => {
    if (lead.project_id) projectIds.add(lead.project_id)
  })

  let projectMap = new Map()
  if (projectIds.size > 0) {
    const { data: projects } = await supabase
      .from("projects")
      .select(`
        id,
        name,
        responsible_id,
        responsible:profiles!projects_responsible_id_fkey(id, full_name)
      `)
      .in("id", Array.from(projectIds))

    projectMap = new Map(projects?.map((p: any) => [p.id, p]) || [])
  }

  const closerIds = new Set<string>()
  data?.forEach((lead: any) => {
    if (lead.closer_id) closerIds.add(lead.closer_id)
  })

  let closerMap = new Map()
  if (closerIds.size > 0) {
    const { data: closers } = await supabase.from("profiles").select("id, full_name").in("id", Array.from(closerIds))

    closerMap = new Map(closers?.map((c: any) => [c.id, c.full_name]) || [])
  }

  const mappedData = data?.map((lead: any) => {
    const project = lead.project_id ? projectMap.get(lead.project_id) : null
    return {
      ...lead,
      projectId: lead.project_id,
      project: project,
      projectCloser: project?.responsible?.full_name || null,
      assignedCloser: lead.closer_id ? closerMap.get(lead.closer_id) || null : null,
    }
  })

  return mappedData || []
}

export async function clearLeadsByStatus(status: string) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: "Unauthorized" }
  }

  const { error } = await supabase
    .from("leads")
    .update({
      status: "em_atendimento",
      updated_at: new Date().toISOString(),
    })
    .eq("status", status)

  if (error) {
    console.error("Error clearing leads:", error)
    return { error: error.message }
  }

  revalidatePath("/leads")
  revalidatePath("/kanban/sdr")
  revalidatePath("/kanban/closer")
  revalidatePath("/sd") // Revalidate SD page

  return { success: true }
}

export async function getLeadById(id: string) {
  const supabase = await createClient()

  const { data: lead, error } = await supabase.from("leads").select("*").eq("id", id).single()

  if (error) {
    console.error("[v0] Error fetching lead:", error)
    return { error: error.message, data: null }
  }

  let project = null
  if (lead.project_id) {
    const { data: projectData } = await supabase.from("projects").select("id, name").eq("id", lead.project_id).single()
    project = projectData
  }

  const userIds = []
  if (lead.sdr_id) userIds.push(lead.sdr_id)
  if (lead.closer_id) userIds.push(lead.closer_id)
  if (lead.sd_id) userIds.push(lead.sd_id)

  let profileMap = new Map()
  if (userIds.length > 0) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", userIds)

    profileMap = new Map(profiles?.map((p: any) => [p.id, p.full_name]) || [])
  }

  const mappedData = {
    ...lead,
    projectId: lead.project_id,
    project: project,
    sdr: lead.sdr_id ? { full_name: profileMap.get(lead.sdr_id) || null } : null,
    closer: lead.closer_id ? { full_name: profileMap.get(lead.closer_id) || null } : null,
    sd: lead.sd_id ? { full_name: profileMap.get(lead.sd_id) || null } : null,
  }

  return { data: mappedData }
}

export async function getLeadLocations() {
  const supabase = await createClient()

  const { data: leads, error } = await supabase
    .from("leads")
    .select("location")
    .not("location", "is", null)
    .not("location", "eq", "")

  if (error) {
    console.error("[v0] Error fetching lead locations:", error)
    return []
  }

  const uniqueLocations = Array.from(
    new Set(leads?.map((lead: any) => lead.location).filter((loc): loc is string => Boolean(loc))),
  ).sort()

  console.log("[v0] Unique lead locations found:", uniqueLocations)

  return uniqueLocations
}

export async function getLeadsWithProjectCode() {
  const supabase = await createClient()

  console.log("[v0] getLeadsWithProjectCode: Starting query...")

  const { data: leads, error } = await supabase
    .from("leads")
    .select("*")
    .not("project_code", "is", null)
    .order("created_at", { ascending: false })

  if (error) {
    console.error("[v0] Error fetching leads with project code:", error)
    return []
  }

  console.log("[v0] getLeadsWithProjectCode: Found", leads?.length || 0, "leads with project_code")

  // Also check all leads to see if any have project_code
  const { data: allLeads } = await supabase.from("leads").select("id, company, project_code, status")
  console.log("[v0] getLeadsWithProjectCode: All leads in database:", allLeads)

  // Fetch related users (SDR, Closer, SD)
  const userIds = new Set<string>()
  leads?.forEach((lead: any) => {
    if (lead.sdr_id) userIds.add(lead.sdr_id)
    if (lead.closer_id) userIds.add(lead.closer_id)
    if (lead.sd_id) userIds.add(lead.sd_id)
  })

  let profileMap = new Map()
  if (userIds.size > 0) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", Array.from(userIds))

    profileMap = new Map(profiles?.map((p: any) => [p.id, p.full_name]) || [])
  }

  // Fetch project data
  const projectIds = new Set<string>()
  leads?.forEach((lead: any) => {
    if (lead.project_id) projectIds.add(lead.project_id)
  })

  let projectMap = new Map()
  if (projectIds.size > 0) {
    const { data: projects } = await supabase.from("projects").select("id, name").in("id", Array.from(projectIds))
    projectMap = new Map(projects?.map((p: any) => [p.id, { id: p.id, name: p.name }]) || [])
  }

  const mappedData = leads?.map((lead: any) => ({
    id: lead.id,
    name: lead.name,
    company: lead.company,
    email: lead.email,
    phone: lead.phone,
    cpfCnpj: lead.cpf_cnpj,
    location: lead.location,
    followUpDate: lead.follow_up_date,
    meetingDate: lead.meeting_date,
    meetingLink: lead.meeting_link,
    meetingAttendees: lead.meeting_attendees || [],
    status: lead.status,
    projectId: lead.project_id,
    notes: lead.notes,
    referredBy: lead.referred_by,
    tasks: [],
    franchiseId: lead.franchise_id,
    createdAt: lead.created_at,
    updatedAt: lead.updated_at,
    value: lead.value,
    saleDate: lead.sale_date,
    linkedin: lead.linkedin_url,
    instagram: lead.instagram_url,
    leadSource: lead.lead_source,
    referralName: lead.referral_name,
    referralCommission: lead.referral_commission,
    projectCode: lead.project_code, // Added project_code mapping
    project: lead.project_id ? projectMap.get(lead.project_id) || null : null,
    sdr: lead.sdr_id ? { full_name: profileMap.get(lead.sdr_id) || null } : null,
    closer: lead.closer_id ? { full_name: profileMap.get(lead.closer_id) || null } : null,
    sd: lead.sd_id ? { full_name: profileMap.get(lead.sd_id) || null } : null,
  }))

  return mappedData || []
}

export async function generateMissingProjectCodes() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: "Unauthorized" }
  }

  // Find leads that are in SD status but don't have a project_code
  const { data: leadsWithoutCode, error: fetchError } = await supabase
    .from("leads")
    .select("id, company, status, project_code")
    .or(
      "status.eq.fila_espera,status.eq.em_analise,status.eq.proposta,status.eq.negociacao_sd,status.eq.fechado_sd,status.eq.projetos_ganhos",
    )
    .is("project_code", null)

  if (fetchError) {
    console.error("[v0] Error fetching leads without code:", fetchError)
    return { error: fetchError.message }
  }

  console.log("[v0] generateMissingProjectCodes: Found", leadsWithoutCode?.length || 0, "leads without project_code")

  if (!leadsWithoutCode || leadsWithoutCode.length === 0) {
    return { updated: 0 }
  }

  let updated = 0
  for (const lead of leadsWithoutCode) {
    const projectCode = await generateProjectCode(supabase, lead.company || "Empresa")

    const { error: updateError } = await supabase.from("leads").update({ project_code: projectCode }).eq("id", lead.id)

    if (!updateError) {
      updated++
      console.log("[v0] Generated project_code for lead:", lead.company, "->", projectCode)
    }
  }

  revalidatePath("/sd")

  return { updated }
}

export async function getLeadsByProjectId(projectId: string) {
  const supabase = await createClient()

  console.log("[v0] getLeadsByProjectId - Fetching leads for project:", projectId)

  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })

  if (error) {
    console.error("[v0] Error fetching leads by project:", error)
    return { error: error.message, data: [] }
  }

  console.log(`[v0] getLeadsByProjectId - Found ${data?.length || 0} leads for project ${projectId}`)

  // Map database fields to frontend format
  const mappedData = data?.map((lead: any) => ({
    id: lead.id,
    name: lead.name,
    company: lead.company,
    email: lead.email,
    phone: lead.phone,
    cpfCnpj: lead.cpf_cnpj,
    location: lead.location,
    nextFollowUp: lead.follow_up_date,
    meetingDate: lead.meeting_date,
    meetingLink: lead.meeting_link,
    meetingAttendees: lead.meeting_attendees,
    status: lead.status,
    assignedSDR: lead.sdr_id,
    assignedCloser: lead.closer_id,
    assignedSD: lead.sd_id,
    projectId: lead.project_id,
    linkedin: lead.linkedin_url,
    instagram: lead.instagram_url,
    value: lead.deal_value,
    saleDate: lead.closed_date,
    notes: lead.notes,
    createdAt: lead.created_at,
    referredBy: lead.referred_by,
    leadSource: lead.lead_source,
    referralName: lead.referral_name,
    referralCommission: lead.referral_commission,
    projectCode: lead.project_code,
  }))

  return { data: mappedData || [] }
}
