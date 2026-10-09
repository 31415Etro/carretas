"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { PageLayout } from "@/components/page-layout"
import { KanbanColumn } from "@/components/kanban/kanban-column"
import { ClearStatusDialog } from "@/components/kanban/clear-status-dialog"
import { LeadForm } from "@/components/leads/lead-form"
import type { Lead, LeadStatus } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Plus, Filter, Eraser } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { updateLead, clearLeadsByStatus } from "@/lib/actions/leads"
import { fetchLeadsFromAPI } from "@/hooks/use-leads"
import { statusConfig } from "@/lib/types"

const closerStatuses: LeadStatus[] = [
  "reuniao_agendada",
  "reuniao_remarcada",
  "reuniao_marcada",
  "reuniao_realizada",
  "visita",
  "dados_cliente",
  "projeto_orcamento",
  "em_negociacao",
  "revisao",
  "perdido",
  "fechado",
  "kickoff",
]

export default function CloserKanbanPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [draggedLead, setDraggedLead] = useState<Lead | null>(null)
  const [dragOverColumn, setDragOverColumn] = useState<LeadStatus | null>(null)
  const [showClearDialog, setShowClearDialog] = useState(false)
  const [showLeadForm, setShowLeadForm] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const { toast } = useToast()

  const fetchLeads = async () => {
    const { data, error } = await fetchLeadsFromAPI()
    if (error) {
      toast({
        title: "Erro ao carregar leads",
        description: error,
        variant: "destructive",
      })
      return []
    }

    // Filtra apenas por status do closer - cada lead aparece individualmente
    const filteredLeads = (data || []).filter((lead: any) => closerStatuses.includes(lead.status))
    return filteredLeads
  }

  useEffect(() => {
    async function loadInitialData() {
      setIsLoading(true)
      const closerLeads = await fetchLeads()
      setLeads(closerLeads)
      setIsLoading(false)
    }
    loadInitialData()
  }, [])

  const handleLeadRefresh = async () => {
    const closerLeads = await fetchLeads()
    setLeads(closerLeads)
  }

  const handleCreateLead = async () => {
    setShowLeadForm(false)
    await handleLeadRefresh()
    toast({
      title: "Lead criado",
      description: "O lead foi adicionado à coluna Reunião Agendada.",
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
    if (!draggedLead) return

    const { error } = await updateLead(String(draggedLead.id), { status: String(newStatus) })

    if (error) {
      toast({ title: "Erro ao atualizar lead", description: error, variant: "destructive" })
    } else {
      await handleLeadRefresh()
      toast({
        title: "Lead Atualizado",
        description: `${draggedLead.name} movido para ${statusConfig[newStatus].label}`,
      })
    }

    setDraggedLead(null)
    setDragOverColumn(null)
  }

  const getLeadsByStatus = (status: LeadStatus) => leads.filter((lead) => lead.status === status)

  const getLeadCounts = () => {
    const counts: Record<LeadStatus, number> = {} as Record<LeadStatus, number>
    closerStatuses.forEach((status) => {
      counts[status] = getLeadsByStatus(status).length
    })
    return counts
  }

  const handleClearStatus = async (status: LeadStatus) => {
    const leadsToMove = leads.filter((lead) => lead.status === status)
    const { error } = await clearLeadsByStatus(status)

    if (error) {
      toast({ title: "Erro ao limpar status", description: error, variant: "destructive" })
    } else {
      setLeads((prev) => prev.filter((lead) => lead.status !== status))
      toast({
        title: "Status Limpo",
        description: `${leadsToMove.length} ${leadsToMove.length === 1 ? "lead foi movido" : "leads foram movidos"} para "My Leads"`,
      })
    }
  }

  const totalValue = leads.reduce((sum, lead) => sum + (lead.value || 0), 0)

  if (isLoading) {
    return (
      <PageLayout>
        <div className="flex items-center justify-center h-[calc(100vh-200px)]">
          <div className="text-center space-y-3">
            <div className="h-12 w-12 mx-auto rounded-full border-4 border-primary border-t-transparent animate-spin" />
            <p className="text-muted-foreground">Carregando leads...</p>
          </div>
        </div>
      </PageLayout>
    )
  }

  return (
    <PageLayout>
      {showLeadForm && (
        <LeadForm
          onSubmit={handleCreateLead}
          onClose={() => setShowLeadForm(false)}
          initialData={{ status: "reuniao_agendada" } as any}
        />
      )}

      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-3xl font-bold text-foreground">Closer Kanban Board</h2>
          <p className="text-muted-foreground mt-1">
            Gerencie negociações e reuniões • Valor Total:{" "}
            {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(totalValue)}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" className="gap-2 bg-transparent">
            <Filter className="h-4 w-4" />
            Filtrar
          </Button>
          <Button variant="outline" className="gap-2 bg-transparent" onClick={() => setShowClearDialog(true)}>
            <Eraser className="h-4 w-4" />
            Limpar
          </Button>
          <Button className="gap-2 bg-primary hover:bg-primary/90" onClick={() => setShowLeadForm(true)}>
            <Plus className="h-4 w-4" />
            Novo Lead
          </Button>
        </div>
      </div>

      <div className="flex gap-6 overflow-x-auto pb-4">
        {closerStatuses.map((status) => (
          <KanbanColumn
            key={status}
            status={status}
            leads={getLeadsByStatus(status)}
            onScheduleMeeting={() => {}}
            onDragStart={handleDragStart}
            onDragOver={(e) => handleDragOver(e, status)}
            onDrop={(e, status) => handleDrop(e, status)}
            isDraggingOver={dragOverColumn === status}
            onRefresh={handleLeadRefresh}
          />
        ))}
      </div>

      <ClearStatusDialog
        open={showClearDialog}
        onOpenChange={setShowClearDialog}
        statuses={closerStatuses}
        onConfirm={handleClearStatus}
        leadCounts={getLeadCounts()}
      />
    </PageLayout>
  )
}
