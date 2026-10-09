"use server"

import type { Project } from "../types"
import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import { isCurrentUserAdmin } from "@/lib/server-authorization"

export async function createProject(input: {
  name: string
  status?: string
  cep?: string
  street?: string
  number?: string
  complement?: string
  neighborhood?: string
  city?: string
  state?: string
  totalValue?: number
}): Promise<{ data?: Project; error?: string }> {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return { error: "Unauthorized" }
    }

    const insertData: any = {
      name: input.name,
      status: input.status || "active",
      cep: input.cep || null,
      street: input.street || null,
      number: input.number || null,
      complement: input.complement || null,
      neighborhood: input.neighborhood || null,
      city: input.city || null,
      state: input.state || null,
      total_value: input.totalValue || 0,
      created_by: user.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await supabase.from("projects").insert(insertData).select().single()

    if (error) {
      console.error("[v0] Error creating project:", error)
      return { error: error.message }
    }

    const project: Project = {
      id: data.id,
      name: data.name,
      status: data.status,
      totalValue: data.total_value,
      createdBy: data.created_by,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      cep: data.cep,
      street: data.street,
      number: data.number,
      complement: data.complement,
      neighborhood: data.neighborhood,
      city: data.city,
      state: data.state,
      latitude: data.latitude,
      longitude: data.longitude,
    }

    revalidatePath("/projects")

    return { data: project }
  } catch (error: any) {
    console.error("[v0] Error in createProject:", error)
    return { error: error.message }
  }
}

export async function updateProject(
  id: string,
  input: Partial<{
    name: string
    status: string
    cep: string
    street: string
    number: string
    complement: string
    neighborhood: string
    city: string
    state: string
    totalValue: number
  }>,
): Promise<{ data?: Project; error?: string }> {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return { error: "Unauthorized" }
    }

    const updateData: { [key: string]: any } = {
      updated_at: new Date().toISOString(),
    }

    if (input.name !== undefined) updateData.name = input.name
    if (input.status !== undefined) updateData.status = input.status
    if (input.cep !== undefined) updateData.cep = input.cep
    if (input.street !== undefined) updateData.street = input.street
    if (input.number !== undefined) updateData.number = input.number
    if (input.complement !== undefined) updateData.complement = input.complement
    if (input.neighborhood !== undefined) updateData.neighborhood = input.neighborhood
    if (input.city !== undefined) updateData.city = input.city
    if (input.state !== undefined) updateData.state = input.state
    if (input.totalValue !== undefined) updateData.total_value = input.totalValue

    const { data, error } = await supabase.from("projects").update(updateData).eq("id", id).select().single()

    if (error) {
      console.error("[v0] Error updating project:", error)
      return { error: error.message }
    }

    const project: Project = {
      id: data.id,
      name: data.name,
      status: data.status,
      totalValue: data.total_value,
      createdBy: data.created_by,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      cep: data.cep,
      street: data.street,
      number: data.number,
      complement: data.complement,
      neighborhood: data.neighborhood,
      city: data.city,
      state: data.state,
      latitude: data.latitude,
      longitude: data.longitude,
    }

    revalidatePath("/projects")

    return { data: project }
  } catch (error: any) {
    console.error("[v0] Error in updateProject:", error)
    return { error: error.message }
  }
}

export async function getProjects(): Promise<{ data: Project[] | null; error: string | null }> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.from("projects").select("*").order("created_at", { ascending: false })

    if (error) {
      console.error("[v0] Error fetching projects:", error)
      return { data: null, error: error.message }
    }

    const projects: Project[] = (data || []).map((project: any) => ({
      id: project.id,
      name: project.name,
      status: project.status,
      totalValue: project.total_value,
      createdBy: project.created_by,
      createdAt: project.created_at,
      updatedAt: project.updated_at,
      projectCode: project.project_code, // Map project_code from database
      // Address fields
      cep: project.cep,
      street: project.street,
      number: project.number,
      complement: project.complement,
      neighborhood: project.neighborhood,
      city: project.city,
      state: project.state,
      // Cached coordinates
      latitude: project.latitude,
      longitude: project.longitude,
    }))

    return { data: projects, error: null }
  } catch (error: any) {
    console.error("[v0] Error in getProjects:", error)
    return { data: null, error: error.message }
  }
}

export async function getProjectsWithCachedCoordinates(): Promise<Project[]> {
  try {
    const { data: projects, error } = await getProjects()

    if (error || !projects) {
      console.error("[v0] Error fetching projects:", error)
      return []
    }

    // Only return projects that already have cached coordinates
    const projectsWithCoords = projects.filter(
      (p) => p.latitude && p.longitude && p.latitude !== 0 && p.longitude !== 0,
    )

    console.log(
      `[v0] Returning ${projectsWithCoords.length} projects with cached coordinates out of ${projects.length} total`,
    )

    return projectsWithCoords
  } catch (error) {
    console.error("[v0] Error in getProjectsWithCachedCoordinates:", error)
    return []
  }
}

export async function geocodeSingleProject(projectId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient()

    const { data: project, error: fetchError } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .single()

    if (fetchError || !project) {
      return { success: false, error: "Projeto não encontrado" }
    }

    // Skip if already has coordinates
    if (project.latitude && project.longitude) {
      return { success: true }
    }

    // Skip if address is incomplete
    if (!project.street || !project.city || !project.state) {
      return { success: false, error: "Endereço incompleto" }
    }

    const address = `${project.street}${project.number ? `, ${project.number}` : ""}, ${project.neighborhood || ""}, ${project.city}, ${project.state}, ${project.cep || ""}`

    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${process.env.GOOGLE_MAPS_API_KEY}`,
    )

    if (!response.ok) {
      return { success: false, error: `HTTP error ${response.status}` }
    }

    const data = await response.json()

    if (data.status === "OK" && data.results && data.results.length > 0) {
      const location = data.results[0].geometry.location

      await supabase
        .from("projects")
        .update({
          latitude: location.lat,
          longitude: location.lng,
        })
        .eq("id", projectId)

      revalidatePath("/projects")
      return { success: true }
    } else if (data.status === "OVER_QUERY_LIMIT" || data.status === "OVER_DAILY_LIMIT") {
      return { success: false, error: "Limite de requisições atingido. Tente novamente em alguns minutos." }
    }

    return { success: false, error: `Geocoding falhou: ${data.status}` }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function getGoogleMapsApiKey(): Promise<string> {
  return process.env.GOOGLE_MAPS_API_KEY || ""
}

export async function getProjectsWithoutCoordinates(): Promise<Project[]> {
  try {
    const { data: projects, error } = await getProjects()

    if (error || !projects) {
      return []
    }

    return projects.filter(
      (p) => (!p.latitude || !p.longitude || p.latitude === 0 || p.longitude === 0) && p.street && p.city && p.state,
    )
  } catch (error) {
    return []
  }
}

// Keep the old function name for compatibility but use cached version
export async function getProjectsWithCoordinates(): Promise<Project[]> {
  return getProjectsWithCachedCoordinates()
}

export async function getProjectByCnpj(cnpj: string): Promise<{ data?: Project; error?: string }> {
  try {
    const supabase = await createClient()

    const { data: leads, error: leadsError } = await supabase
      .from("leads")
      .select("project_id")
      .eq("cpf_cnpj", cnpj)
      .not("project_id", "is", null)
      .limit(1)

    if (leadsError) {
      console.error("[v0] Error searching leads by CNPJ:", leadsError)
      return { error: leadsError.message }
    }

    if (!leads || leads.length === 0) {
      return { data: undefined }
    }

    // Get the project details
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("*")
      .eq("id", leads[0].project_id)
      .single()

    if (projectError) {
      console.error("[v0] Error fetching project:", projectError)
      return { error: projectError.message }
    }

    const mappedProject: Project = {
      id: project.id,
      name: project.name,
      status: project.status,
      totalValue: project.total_value,
      createdBy: project.created_by,
      createdAt: project.created_at,
      updatedAt: project.updated_at,
      projectCode: project.project_code, // Map project_code from database
      cep: project.cep,
      street: project.street,
      number: project.number,
      complement: project.complement,
      neighborhood: project.neighborhood,
      city: project.city,
      state: project.state,
      latitude: project.latitude,
      longitude: project.longitude,
    }

    return { data: mappedProject }
  } catch (error: any) {
    console.error("[v0] Error in getProjectByCnpj:", error)
    return { error: error.message }
  }
}

export async function deleteProject(projectId: string): Promise<{ error?: string }> {
  try {
    if (!(await isCurrentUserAdmin())) return { error: "Somente administradores podem excluir registros" }
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return { error: "Unauthorized" }
    }

    console.log("[v0] Deleting project:", projectId)

    const { error } = await supabase.from("projects").delete().eq("id", projectId)

    if (error) {
      console.error("[v0] Error deleting project:", error)
      return { error: error.message }
    }

    console.log("[v0] Project deleted successfully:", projectId)

    revalidatePath("/projects")
    revalidatePath("/dashboard")

    return {}
  } catch (error: any) {
    console.error("[v0] Error deleting project:", error)
    return { error: error.message || "Failed to delete project" }
  }
}
