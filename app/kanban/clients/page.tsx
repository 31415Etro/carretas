"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { PageLayout } from "@/components/page-layout"
import { KanbanColumn } from "@/components/kanban/kanban-column"
import { LeadForm } from "@/components/leads/lead-form"
import { ClearStatusDialog } from "@/components/kanban/clear-status-dialog"
import type { Lead, LeadStatus } from "@/lib/types"
import { statusConfig } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Plus, Filter, Eraser, RefreshCw, TrendingUp } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { updateLead, clearLeadsByStatus } from "@/lib/actions/leads"
import { fetchLeadsFromAPI } from "@/hooks/use-leads"
import { useAuth } from "@/lib/auth-context"

const clientStatuses: LeadStatus[] = [
  "cliente", // Cliente
  "desenvolvimento_proposta", // Desenvolvimento da proposta
  "negociacao", // Negociação
  "ganho", // Ganho
  "perdido_cliente", // Perdido
  "hold", // Hold
]

export default function ClientsKanbanPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [draggedLead, setDraggedLead] = useState<Lead | null>(null)
  const [dragOverColumn, setDragOverColumn] = useState<LeadStatus | null>(null)
  const [showLeadForm, setShowLeadForm] = useState(false)
  const [showClearDialog, setShowClearDialog] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [editingLead, setEditingLead] = useState<Lead | null>(null)
  const { toast } = useToast()
  const { user } = useAuth()

  const fetchLeads = async () => {
    try {
      const { data, error } = await fetchLeadsFromAPI()

      if (error) {
        toast({
          title: "Erro ao carregar clientes",
          description: error,
          variant: "destructive",
        })
        return []
      }

      return (data || []).filter((lead: any) => clientStatuses.includes(lead.status))
    } catch (err) {
      toast({
        title: "Erro ao carregar clientes",
        description: "Erro inesperado ao buscar clientes",
        variant: "destructive",
      })
      return []
    }
  }

  useEffect(() => {
    async function loadInitialData() {
      setIsLoading(true)
      const clientLeads = await fetchLeads()
      setLeads(clientLeads)
      setIsLoading(false)
    }
    loadInitialData()
  }, [])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    const clientLeads = await fetchLeads()
    setLeads(clientLeads)
    setIsRefreshing(false)
    toast({
      title: "Atualizado",
      description: "Clientes atualizados com sucesso",
    })
  }

  const handleDragStart = (lead: Lead) => {
    setDraggedLead(lead)
  }

  const handleDragOver = (e: React.DragEvent, status: LeadStatus) => {
    e.preventDefault()
    setDragOverColumn(status)
  }

  const handleDrop = async (e: React.DragEvent, newStatus: LeadStatus) => {
    e.preventDefault()
    e.stopPropagation()

    if (!draggedLead) return

    if (draggedLead.status === newStatus) {
      setDraggedLead(null)
      setDragOverColumn(null)
      return
    }

    const { error } = await updateLead(draggedLead.id, { status: newStatus })

    if (error) {
      toast({
        title: "Erro ao atualizar cliente",
        description: error,
        variant: "destructive",
      })
    } else {
      const clientLeads = await fetchLeads()
      setLeads(clientLeads)

      toast({
        title: "Cliente Atualizado",
        description: `${draggedLead.name} movido para ${statusConfig[newStatus].label}`,
      })
    }

    setDraggedLead(null)
    setDragOverColumn(null)
  }

  const handleScheduleMeeting = (leadId: string) => {
    toast({
      title: "Agendar Reunião",
      description: "Funcionalidade de agendamento em desenvolvimento",
    })
  }

  const handleCreateLead = async () => {
    setShowLeadForm(false)
    setEditingLead(null)
    const clientLeads = await fetchLeads()
    setLeads(clientLeads)
  }

  const handleCancelLeadForm = () => {
    setShowLeadForm(false)
    setEditingLead(null)
  }

  const handleAddNewLead = () => {
    setEditingLead(null)
    setShowLeadForm(true)
  }

  const getLeadsByStatus = (status: LeadStatus) => {
    return leads.filter((lead) => lead.status === status)
  }

  const getLeadCounts = () => {
    const counts: Record<LeadStatus, number> = {} as Record<LeadStatus, number>
    clientStatuses.forEach((status) => {
      counts[status] = getLeadsByStatus(status).length
    })
    return counts
  }

  const handleClearStatus = async (status: LeadStatus) => {
    const leadsToMove = leads.filter((lead) => lead.status === status)

    const { error } = await clearLeadsByStatus(status)

    if (error) {
      toast({
        title: "Erro ao limpar status",
        description: error,
        variant: "destructive",
      })
    } else {
      const clientLeads = await fetchLeads()
      setLeads(clientLeads)

      toast({
        title: "Status Limpo",
        description: `${leadsToMove.length} ${leadsToMove.length === 1 ? "cliente foi movido" : "clientes foram movidos"} para "My Leads"`,
      })
    }
  }

  const handleLeadRefresh = async () => {
    const clientLeads = await fetchLeads()
    setLeads(clientLeads)
  }

  // Calculate metrics
  const totalValue = leads.filter((lead) => lead.status === "ganho").reduce((sum, lead) => sum + (lead.value || 0), 0)

  const wonCount = leads.filter((lead) => lead.status === "ganho").length
  const negotiationCount = leads.filter((lead) => lead.status === "negociacao").length

  if (isLoading) {
    return (
      <PageLayout>
        <div className="flex items-center justify-center h-[calc(100vh-200px)]">
          <div className="text-center space-y-4">
            <div className="h-12 w-12 mx-auto rounded-full border-4 border-primary border-t-transparent animate-spin" />
            <div>
              <p className="text-muted-foreground">Carregando pipeline de clientes...</p>
              <p className="text-xs text-muted-foreground mt-2">Se demorar muito, verifique sua conexão</p>
            </div>
          </div>
        </div>
      </PageLayout>
    )
  }

  return (
    <PageLayout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-3xl font-bold text-foreground">Pipeline de Clientes</h2>
          <p className="text-muted-foreground mt-1">
            Gerencie propostas e negociações • {wonCount} ganhos • {negotiationCount} em negociação
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" className="gap-2 bg-transparent" onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button variant="outline" className="gap-2 bg-transparent">
            <Filter className="h-4 w-4" />
            Filtrar
          </Button>
          <Button variant="outline" className="gap-2 bg-transparent" onClick={() => setShowClearDialog(true)}>
            <Eraser className="h-4 w-4" />
            Limpar
          </Button>
          <Button className="gap-2 bg-primary hover:bg-primary-600" onClick={handleAddNewLead}>
            <Plus className="h-4 w-4" />
            Adicionar Cliente
          </Button>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <TrendingUp className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total de Clientes</p>
              <p className="text-2xl font-bold text-foreground">{leads.length}</p>
            </div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-success/10 rounded-lg">
              <TrendingUp className="h-5 w-5 text-success" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Receita Total</p>
              <p className="text-2xl font-bold text-success">
                {new Intl.NumberFormat("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                }).format(totalValue)}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-warning/10 rounded-lg">
              <TrendingUp className="h-5 w-5 text-warning" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Ticket Médio</p>
              <p className="text-2xl font-bold text-foreground">
                {new Intl.NumberFormat("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                }).format(wonCount > 0 ? totalValue / wonCount : 0)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {leads.length === 0 && (
        <div className="text-center py-12 border-2 border-dashed border-border rounded-lg">
          <p className="text-muted-foreground mb-4">Nenhum cliente encontrado no pipeline</p>
          <Button onClick={handleAddNewLead}>
            <Plus className="h-4 w-4 mr-2" />
            Adicionar Primeiro Cliente
          </Button>
        </div>
      )}

      {leads.length > 0 && (
        <div className="flex gap-6 overflow-x-auto pb-4">
          {clientStatuses.map((status) => (
            <KanbanColumn
              key={status}
              status={status}
              leads={getLeadsByStatus(status)}
              onScheduleMeeting={handleScheduleMeeting}
              onDragStart={handleDragStart}
              onDragOver={(e) => handleDragOver(e, status)}
              onDrop={(e) => handleDrop(e, status)}
              isDraggingOver={dragOverColumn === status}
              onRefresh={handleLeadRefresh}
            />
          ))}
        </div>
      )}

      {showLeadForm && (
        <LeadForm
          onSubmit={handleCreateLead}
          onClose={handleCancelLeadForm}
          initialData={
            editingLead
              ? {
                  id: editingLead.id,
                  name: editingLead.name,
                  company: editingLead.company,
                  email: editingLead.email,
                  phone: editingLead.phone,
                  cpfCnpj: (editingLead as any).cpf_cnpj,
                  location: editingLead.location,
                  nextFollowUp: (editingLead as any).follow_up_date,
                  meetingDate: (editingLead as any).meeting_date,
                  meetingLink: (editingLead as any).meeting_link,
                  meetingAttendees: (editingLead as any).meeting_attendees,
                  status: editingLead.status,
                  assignedSDR: (editingLead as any).sdr_id,
                  assignedCloser: (editingLead as any).closer_id,
                  linkedin: (editingLead as any).linkedin_url,
                  instagram: (editingLead as any).instagram_url,
                  value: (editingLead as any).deal_value,
                  notes: editingLead.notes,
                  referredBy: (editingLead as any).referred_by,
                }
              : { status: "cliente" }
          }
        />
      )}

      <ClearStatusDialog
        open={showClearDialog}
        onOpenChange={setShowClearDialog}
        statuses={clientStatuses}
        onConfirm={handleClearStatus}
        leadCounts={getLeadCounts()}
      />
    </PageLayout>
  )
}
