"use client"

import type React from "react"
import { memo } from "react"
import { Calendar, Linkedin, Instagram, MapPin, Building2 } from "lucide-react"

import type { Lead } from "@/lib/types"
import { statusConfig } from "@/lib/types"
import { sdSubStatusConfig } from "@/lib/sd-substatus-config"
import { Card } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { useState } from "react"
import { LeadDetailsDialog } from "./lead-details-dialog"
import { LeadForm, type LeadFormData } from "@/components/leads/lead-form"
import { useToast } from "@/hooks/use-toast"

interface LeadCardProps {
  lead: Lead
  onScheduleMeeting: (leadId: string) => void
  isDragging?: boolean
  onRefresh?: () => Promise<void> // Added refresh callback
}

export const LeadCard = memo(function LeadCard({ lead, onScheduleMeeting, onRefresh }: LeadCardProps) {
  const status = statusConfig[lead.status]
  const [showDetails, setShowDetails] = useState(false)
  const [showEditForm, setShowEditForm] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false)
  const { toast } = useToast()

  const ensureHttps = (url: string) => {
    if (!url) return url
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return url
    }
    return `https://${url}`
  }

  const handleEdit = (leadToEdit: Lead) => {
    setShowDetails(false)
    setShowEditForm(true)
  }

  const handleFormSubmit = async (data: LeadFormData) => {
    setShowEditForm(false)

    if (onRefresh) {
      await onRefresh()
    }

    toast({
      title: "Lead atualizado!",
      description: "As informações do lead foram atualizadas com sucesso.",
    })
  }

  const getInitialFormData = (): LeadFormData => {
    const formData = {
      id: lead.id,
      name: lead.name || "",
      company: lead.company || "",
      email: lead.email || "",
      phone: lead.phone || "",
      cpfCnpj: (lead as any).cpf_cnpj || "",
      proposalName: (lead as any).proposal_name || "",
      location: lead.location || "",
      nextFollowUp: (lead as any).follow_up_date || "",
      meetingDate: (lead as any).meeting_date || "",
      meetingLink: (lead as any).meeting_link || "",
      meetingAttendees: (lead as any).meeting_attendees || [],
      referredBy: (lead as any).referred_by || "none",
      status: lead.status || "em_atendimento",
      sdSubStatus: (lead as any).sd_sub_status || undefined,
      assignedSDR: (lead as any).sdr_id || "none",
      assignedCloser: (lead as any).closer_id || "none",
      assignedSD: (lead as any).sd_id || "none",
      linkedin: (lead as any).linkedin_url || "",
      instagram: (lead as any).instagram_url || "",
      value: (lead as any).deal_value || 0,
      valueParts: (lead as any).value_parts || 0,
      valueServices: (lead as any).value_services || 0,
      valueContracts: (lead as any).value_maintenance_contracts || 0,
      valueEquipment: (lead as any).value_equipment_sales || 0,
      valueProjects: (lead as any).value_projects || 0,
      saleDate: (lead as any).closed_date || "",
      notes: lead.notes || "",
      projectId: (lead as any).project_id || "none",
      leadSource: (lead as any).lead_source || undefined,
      referralName: (lead as any).referral_name || "",
      referralCommission: (lead as any).referral_commission || undefined,
      projectCode: (lead as any).project_code || "",
      // Address fields
      cep: (lead as any).cep || "",
      street: (lead as any).street || "",
      number: (lead as any).number || "",
      complement: (lead as any).complement || "",
      neighborhood: (lead as any).neighborhood || "",
      city: (lead as any).city || "",
      state: (lead as any).state || "",
      // Lead scoring fields - new weighted criteria system
      score_autoridade: (lead as any).score_autoridade || 0,
      score_dor_urgencia: (lead as any).score_dor_urgencia || 0,
      score_business_case: (lead as any).score_business_case || 0,
      score_aderencia_tecnica: (lead as any).score_aderencia_tecnica || 0,
      score_diferenciacao: (lead as any).score_diferenciacao || 0,
      score_gestao_riscos: (lead as any).score_gestao_riscos || 0,
      score_cronograma: (lead as any).score_cronograma || 0,
      score_modelo_comercial: (lead as any).score_modelo_comercial || 0,
      score_patrocinador: (lead as any).score_patrocinador || 0,
      total_score: (lead as any).total_score || 0,
    }

    return formData
  }

  const handleSocialLinkClick = (e: React.MouseEvent, url: string) => {
    e.preventDefault()
    e.stopPropagation()
    window.open(ensureHttps(url), "_blank", "noopener,noreferrer")
  }

  const handleCardClick = () => {
    if (!isDragging) {
      setShowDetails(true)
    }
  }

  return (
    <>
      <Card
        onClick={handleCardClick}
        onMouseDown={() => setIsDragging(false)}
        onDragStart={() => setIsDragging(true)}
        onDragEnd={() => {
          setTimeout(() => setIsDragging(false), 100)
        }}
        className={cn(
          "p-1.5 bg-card border-border shadow-[var(--shadow-soft)] hover:shadow-md transition-all cursor-pointer",
          "select-none", // Prevent text selection during drag
        )}
        style={{
          borderLeft: `4px solid ${status.color}`,
        }}
      >
        {(lead as any).project && (
          <div className="mb-1 px-1 py-0.5 bg-muted/50 rounded border border-border/50">
            <p className="text-xs font-medium text-muted-foreground">
              Empresa: <span className="text-foreground">{(lead as any).project.name}</span>
            </p>
          </div>
        )}

        {/* Header */}
        <div className="flex items-start justify-between mb-1">
          <div className="flex-1">
            <div className="flex items-center gap-1 mb-1 flex-wrap">
              {(lead as any).project_code && (
                <span className="text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                  {(lead as any).project_code}
                </span>
              )}
              {(lead as any).sd_sub_status && (
                <span 
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                  style={{
                    backgroundColor: sdSubStatusConfig[(lead as any).sd_sub_status]?.bgColor || "#F1F5F9",
                    color: sdSubStatusConfig[(lead as any).sd_sub_status]?.color || "#64748B"
                  }}
                >
                  {sdSubStatusConfig[(lead as any).sd_sub_status]?.label || (lead as any).sd_sub_status}
                </span>
              )}
              {(lead as any).total_score !== undefined && (lead as any).total_score !== null && (
                <span 
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5"
                  style={{
                    backgroundColor: (lead as any).total_score >= 80 ? "#DCFCE7" : 
                                   (lead as any).total_score >= 50 ? "#FEF3C7" : "#FEE2E2",
                    color: (lead as any).total_score >= 80 ? "#16A34A" : 
                           (lead as any).total_score >= 50 ? "#F59E0B" : "#DC2626"
                  }}
                >
                  {/* Sparkles icon is used here */}
                  {(lead as any).total_score}
                </span>
              )}
            </div>
            <div className="space-y-1">
              {(lead as any).proposal_name && (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-primary">📋 {(lead as any).proposal_name}</span>
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <Building2 className="h-4 w-4 text-primary" />
                <h3 className="font-bold text-foreground text-base leading-tight">{lead.company}</h3>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 pl-5.5">{lead.name}</p>
              {(lead as any).deal_value && (lead as any).deal_value > 0 && (
                <div className="flex items-center gap-1.5 pl-5.5">
                  <span className="text-xs font-bold text-green-600">
                    💰 R$ {Number((lead as any).deal_value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              )}
            </div>
          </div>
          <Badge
            className="ml-2 border-0 font-medium text-[10px] px-1.5 py-0.5"
            style={{
              backgroundColor: status.bgColor,
              color: status.color,
            }}
          >
            {status.label}
          </Badge>
        </div>

        {/* Body */}
        <div className="space-y-0.5 mb-1">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3" />
            <span>{lead.location}</span>
          </div>

          {(lead as any).follow_up_date && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" />
              <span>Next: {(lead as any).follow_up_date}</span>
            </div>
          )}

          {/* Assignees */}
          <div className="flex items-center gap-1.5 pt-0.5 flex-wrap">
            {(lead as any).sdr_id && (lead as any).sdr && (
              <div className="flex items-center gap-1.5">
                <Avatar className="h-6 w-6">
                  <AvatarFallback className="text-[10px] bg-blue-100 text-blue-700">
                    {(lead as any).sdr.full_name?.substring(0, 2).toUpperCase() || "SD"}
                  </AvatarFallback>
                </Avatar>
                <span className="text-xs text-muted-foreground">{(lead as any).sdr.full_name || "SDR"}</span>
              </div>
            )}
            {(lead as any).closer_id && (lead as any).closer && (
              <div className="flex items-center gap-1.5">
                <Avatar className="h-6 w-6">
                  <AvatarFallback className="text-[10px] bg-green-100 text-green-700">
                    {(lead as any).closer.full_name?.substring(0, 2).toUpperCase() || "CL"}
                  </AvatarFallback>
                </Avatar>
                <span className="text-xs text-muted-foreground">{(lead as any).closer.full_name || "Closer"}</span>
              </div>
            )}
            {(lead as any).sd_id && (lead as any).sd && (
              <div className="flex items-center gap-1.5">
                <Avatar className="h-6 w-6">
                  <AvatarFallback className="text-[10px] bg-yellow-100 text-yellow-700">
                    {(lead as any).sd.full_name?.substring(0, 2).toUpperCase() || "SD"}
                  </AvatarFallback>
                </Avatar>
                <span className="text-xs text-muted-foreground">{(lead as any).sd.full_name || "SD"}</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-1 border-t border-border">
          <div className="flex items-center gap-2">
            {(lead as any).linkedin_url && (
              <button
                type="button"
                onClick={(e) => handleSocialLinkClick(e, (lead as any).linkedin_url!)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground"
              >
                <Linkedin className="h-3.5 w-3.5" />
                <span className="text-xs font-medium">LinkedIn</span>
              </button>
            )}
            {(lead as any).instagram_url && (
              <button
                type="button"
                onClick={(e) => handleSocialLinkClick(e, (lead as any).instagram_url!)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-pink-100 text-pink-600 hover:bg-pink-200 transition-colors cursor-pointer"
              >
                <Instagram className="h-3.5 w-3.5" />
                <span className="text-xs font-medium">Instagram</span>
              </button>
            )}
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation()
              onScheduleMeeting(lead.id)
            }}
            className="h-7 text-xs border-primary/20 text-primary hover:bg-primary hover:text-primary-foreground"
          >
            Schedule
          </Button>
        </div>
      </Card>

      <LeadDetailsDialog lead={lead} open={showDetails} onOpenChange={setShowDetails} onEdit={handleEdit} />

      {showEditForm && (
        <LeadForm
          initialData={getInitialFormData()}
          onSubmit={handleFormSubmit}
          onCancel={() => setShowEditForm(false)}
        />
      )}
    </>
  )
})
