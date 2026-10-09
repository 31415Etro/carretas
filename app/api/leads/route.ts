import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  try {
    const adminClient = createAdminClient()

    // Get user from Authorization header token (sent from client)
    let authUserId: string | null = null
    let userRole = "admin" // Default to admin if auth fails
    let managerId: string | null = null

    const authHeader = request.headers.get("Authorization")
    const token = authHeader?.replace("Bearer ", "")

    if (token) {
      const { data: { user } } = await adminClient.auth.getUser(token)

      if (user) {
        authUserId = user.id
        const { data: profile } = await adminClient
          .from("profiles")
          .select("role, manager_id")
          .eq("id", user.id)
          .single()

        userRole = profile?.role || "user"
        managerId = profile?.manager_id || null
      }
    }

    // Build query using admin client to bypass any RLS issues
    // Sem limite para garantir que todos os leads sejam retornados
    let query = adminClient
      .from("leads")
      .select("*")
      .order("created_at", { ascending: false })

    // Filter based on role - APENAS admin vê TUDO
    if (userRole === "admin") {
      // Admin vê todos os leads sem filtro
    } else if (authUserId && userRole === "sdr") {
      // SDR vê leads onde está atribuído como sdr OU leads que criou
      query = query.or(`sdr_id.eq.${authUserId},created_by.eq.${authUserId}`)
    } else if (authUserId && userRole === "closer") {
      // Closer vê leads onde está atribuído como closer OU leads que criou
      query = query.or(`closer_id.eq.${authUserId},created_by.eq.${authUserId}`)
    } else if (authUserId && userRole === "sd") {
      // SD vê leads onde está atribuído como sd OU leads que criou
      query = query.or(`sd_id.eq.${authUserId},created_by.eq.${authUserId}`)
    } else if (authUserId && (userRole === "manager" || userRole === "gerente")) {
      // Gerente vê: leads que criou + leads atribuídos a ele + leads da sua equipe
      const { data: teamMembers } = await adminClient
        .from("profiles")
        .select("id")
        .eq("manager_id", authUserId)

      // IDs: o próprio gerente + todos os membros da equipe
      const allIds = [authUserId, ...(teamMembers?.map((tm: any) => tm.id) || [])]
      const idList = allIds.join(",")

      query = query.or(
        `created_by.in.(${idList}),sdr_id.in.(${idList}),closer_id.in.(${idList}),sd_id.in.(${idList})`
      )
    } else if (authUserId && (userRole === "representative" || userRole === "representante")) {
      // Representante vê apenas seus próprios leads (criados por ele ou atribuídos a ele)
      query = query.or(`created_by.eq.${authUserId},sdr_id.eq.${authUserId},closer_id.eq.${authUserId},sd_id.eq.${authUserId}`)
    } else if (authUserId) {
      // Qualquer outro role - vê apenas seus leads
      query = query.or(`created_by.eq.${authUserId},sdr_id.eq.${authUserId},closer_id.eq.${authUserId},sd_id.eq.${authUserId}`)
    }

    const { data: allLeads, error } = await query

    if (error) {
      return NextResponse.json({ data: [], error: error.message })
    }

    if (!allLeads || allLeads.length === 0) {
      return NextResponse.json({ data: [] })
    }

    // Get project info
    const projectIds = [...new Set(allLeads.filter((l: any) => l.project_id).map((l: any) => l.project_id))]
    let projectMap = new Map()
    if (projectIds.length > 0) {
      const { data: projects } = await adminClient.from("projects").select("id, name").in("id", projectIds)
      projectMap = new Map(projects?.map((p: any) => [p.id, { id: p.id, name: p.name }]) || [])
    }

    // Get user info
    const userIds = [...new Set(allLeads.flatMap((l: any) => [l.sdr_id, l.closer_id, l.sd_id].filter(Boolean)))]
    let profileMap = new Map()
    if (userIds.length > 0) {
      const { data: profiles } = await adminClient.from("profiles").select("id, full_name").in("id", userIds)
      profileMap = new Map(profiles?.map((p: any) => [p.id, p.full_name]) || [])
    }

    // Remove duplicatas pelo ID antes de mapear
    const uniqueLeads = Array.from(
      new Map(allLeads.map((lead: any) => [lead.id, lead])).values()
    )

    const mappedData = uniqueLeads.map((lead: any) => ({
      ...lead,
      projectId: lead.project_id,
      project: lead.project_id ? projectMap.get(lead.project_id) || null : null,
      sdr: lead.sdr_id ? { full_name: profileMap.get(lead.sdr_id) || null } : null,
      closer: lead.closer_id ? { full_name: profileMap.get(lead.closer_id) || null } : null,
      sd: lead.sd_id ? { full_name: profileMap.get(lead.sd_id) || null } : null,
    }))

    return NextResponse.json({ data: mappedData })
  } catch (err: any) {
    console.error("Leads API error:", err?.message)
    return NextResponse.json({ data: [], error: "Failed to load leads" })
  }
}
