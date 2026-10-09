"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import { isCurrentUserAdmin } from "@/lib/server-authorization"

export interface Company {
  id: string
  name: string
  cnpj?: string
  email?: string
  phone?: string
  website?: string
  cep?: string
  street?: string
  number?: string
  complement?: string
  neighborhood?: string
  city?: string
  state?: string
  industry?: string
  size?: string
  notes?: string
  createdBy?: string
  createdAt?: string
  updatedAt?: string
  leadsCount?: number
}

export async function getCompanies(): Promise<{ data: Company[] | null; error: string | null }> {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return { data: null, error: "Usuário não autenticado" }
    }

    const { data, error } = await supabase
      .from("companies")
      .select("*, leads(count)")
      .order("name", { ascending: true })

    if (error) {
      console.error("[v0] Error fetching companies:", error)
      return { data: null, error: error.message }
    }

    const companies: Company[] = (data || []).map((company: any) => ({
      id: company.id,
      name: company.name,
      cnpj: company.cnpj,
      email: company.email,
      phone: company.phone,
      website: company.website,
      cep: company.cep,
      street: company.street,
      number: company.number,
      complement: company.complement,
      neighborhood: company.neighborhood,
      city: company.city,
      state: company.state,
      industry: company.industry,
      size: company.size,
      notes: company.notes,
      createdBy: company.created_by,
      createdAt: company.created_at,
      updatedAt: company.updated_at,
      leadsCount: company.leads?.[0]?.count || 0,
    }))

    return { data: companies, error: null }
  } catch (error: any) {
    console.error("[v0] Error in getCompanies:", error)
    return { data: null, error: error.message }
  }
}

export async function getCompanyById(id: string): Promise<{ data: Company | null; error: string | null }> {
  try {
    const supabase = await createClient()

    const { data, error } = await supabase.from("companies").select("*").eq("id", id).single()

    if (error) {
      return { data: null, error: error.message }
    }

    const company: Company = {
      id: data.id,
      name: data.name,
      cnpj: data.cnpj,
      email: data.email,
      phone: data.phone,
      website: data.website,
      cep: data.cep,
      street: data.street,
      number: data.number,
      complement: data.complement,
      neighborhood: data.neighborhood,
      city: data.city,
      state: data.state,
      industry: data.industry,
      size: data.size,
      notes: data.notes,
      createdBy: data.created_by,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    }

    return { data: company, error: null }
  } catch (error: any) {
    return { data: null, error: error.message }
  }
}

export async function createCompany(
  companyData: Partial<Company>,
): Promise<{ data: Company | null; error: string | null }> {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return { data: null, error: "Usuário não autenticado" }
    }

    const { data, error } = await supabase
      .from("companies")
      .insert({
        name: companyData.name,
        cnpj: companyData.cnpj,
        email: companyData.email,
        phone: companyData.phone,
        website: companyData.website,
        cep: companyData.cep,
        street: companyData.street,
        number: companyData.number,
        complement: companyData.complement,
        neighborhood: companyData.neighborhood,
        city: companyData.city,
        state: companyData.state,
        industry: companyData.industry,
        size: companyData.size,
        notes: companyData.notes,
        created_by: user.id,
      })
      .select()
      .single()

    if (error) {
      console.error("[v0] Error creating company:", error)
      return { data: null, error: error.message }
    }

    revalidatePath("/empresas")

    return {
      data: {
        id: data.id,
        name: data.name,
        cnpj: data.cnpj,
        email: data.email,
        phone: data.phone,
        website: data.website,
        cep: data.cep,
        street: data.street,
        number: data.number,
        complement: data.complement,
        neighborhood: data.neighborhood,
        city: data.city,
        state: data.state,
        industry: data.industry,
        size: data.size,
        notes: data.notes,
        createdBy: data.created_by,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      },
      error: null,
    }
  } catch (error: any) {
    console.error("[v0] Error in createCompany:", error)
    return { data: null, error: error.message }
  }
}

export async function updateCompany(
  id: string,
  companyData: Partial<Company>,
): Promise<{ data: Company | null; error: string | null }> {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return { data: null, error: "Usuário não autenticado" }
    }

    const { data, error } = await supabase
      .from("companies")
      .update({
        name: companyData.name,
        cnpj: companyData.cnpj,
        email: companyData.email,
        phone: companyData.phone,
        website: companyData.website,
        cep: companyData.cep,
        street: companyData.street,
        number: companyData.number,
        complement: companyData.complement,
        neighborhood: companyData.neighborhood,
        city: companyData.city,
        state: companyData.state,
        industry: companyData.industry,
        size: companyData.size,
        notes: companyData.notes,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single()

    if (error) {
      console.error("[v0] Error updating company:", error)
      return { data: null, error: error.message }
    }

    revalidatePath("/empresas")

    return {
      data: {
        id: data.id,
        name: data.name,
        cnpj: data.cnpj,
        email: data.email,
        phone: data.phone,
        website: data.website,
        cep: data.cep,
        street: data.street,
        number: data.number,
        complement: data.complement,
        neighborhood: data.neighborhood,
        city: data.city,
        state: data.state,
        industry: data.industry,
        size: data.size,
        notes: data.notes,
        createdBy: data.created_by,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      },
      error: null,
    }
  } catch (error: any) {
    console.error("[v0] Error in updateCompany:", error)
    return { data: null, error: error.message }
  }
}

export async function deleteCompany(id: string): Promise<{ success: boolean; error: string | null }> {
  try {
    if (!(await isCurrentUserAdmin())) return { success: false, error: "Somente administradores podem excluir registros" }
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return { success: false, error: "Usuário não autenticado" }
    }

    // First, unlink all leads from this company
    await supabase.from("leads").update({ company_id: null }).eq("company_id", id)

    const { error } = await supabase.from("companies").delete().eq("id", id)

    if (error) {
      console.error("[v0] Error deleting company:", error)
      return { success: false, error: error.message }
    }

    revalidatePath("/empresas")

    return { success: true, error: null }
  } catch (error: any) {
    console.error("[v0] Error in deleteCompany:", error)
    return { success: false, error: error.message }
  }
}

export async function linkLeadToCompany(
  leadId: string,
  companyId: string | null,
): Promise<{ success: boolean; error: string | null }> {
  try {
    const supabase = await createClient()

    const { error } = await supabase.from("leads").update({ company_id: companyId }).eq("id", leadId)

    if (error) {
      console.error("[v0] Error linking lead to company:", error)
      return { success: false, error: error.message }
    }

    revalidatePath("/empresas")
    revalidatePath("/leads")

    return { success: true, error: null }
  } catch (error: any) {
    console.error("[v0] Error in linkLeadToCompany:", error)
    return { success: false, error: error.message }
  }
}
