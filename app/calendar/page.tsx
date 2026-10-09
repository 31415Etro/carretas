"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { PageLayout } from "@/components/page-layout"
import { CalendarHeader } from "@/components/calendar/calendar-header"
import { MonthView } from "@/components/calendar/month-view"
import { WeekView } from "@/components/calendar/week-view"
import { DayView } from "@/components/calendar/day-view"
import type { Meeting, CalendarView } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Plus, RefreshCw } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { getTasksForCurrentUser, toggleTaskCompletion, deleteTask } from "@/lib/actions/tasks"
import { LeadDetailsDialog } from "@/components/kanban/lead-details-dialog"
import { getLeadById } from "@/lib/actions/leads"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

const mockMeetings: Meeting[] = [
  {
    id: "1",
    title: "Discovery Call - Tech Solutions",
    description: "Initial discovery call with João Silva",
    startTime: new Date(2025, 0, 14, 14, 0),
    endTime: new Date(2025, 0, 14, 15, 0),
    leadId: "1",
    leadName: "João Silva",
    attendees: ["maria@nexo.com", "joao@techsolutions.com"],
    status: "scheduled",
    videoLink: "https://meet.google.com/abc-defg-hij",
    reminders: [1440, 60],
  },
  {
    id: "2",
    title: "Follow-up - Digital Marketing Co",
    startTime: new Date(2025, 0, 15, 10, 0),
    endTime: new Date(2025, 0, 15, 10, 30),
    leadId: "2",
    leadName: "Ana Costa",
    attendees: ["carlos@nexo.com"],
    status: "scheduled",
    reminders: [1440, 60],
  },
  {
    id: "3",
    title: "Proposal Presentation - Enterprise Corp",
    startTime: new Date(2025, 0, 16, 11, 0),
    endTime: new Date(2025, 0, 16, 12, 0),
    leadId: "5",
    leadName: "Roberto Alves",
    attendees: ["julia@nexo.com", "roberto@enterprise.com"],
    status: "completed",
    videoLink: "https://meet.google.com/xyz-abcd-efg",
    reminders: [1440, 60],
  },
  {
    id: "4",
    title: "Negotiation Meeting - Global Services",
    startTime: new Date(2025, 0, 13, 15, 0),
    endTime: new Date(2025, 0, 13, 16, 0),
    leadId: "6",
    leadName: "Fernanda Lima",
    attendees: ["ricardo@nexo.com"],
    status: "rescheduled",
    reminders: [1440, 60],
  },
]

export default function CalendarPage() {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [view, setView] = useState<CalendarView>("month")
  const [tasks, setTasks] = useState<any[]>([])
  const [loadingTasks, setLoadingTasks] = useState(true)
  const [selectedLead, setSelectedLead] = useState<any>(null)
  const [showLeadDialog, setShowLeadDialog] = useState(false)
  const [loadingLead, setLoadingLead] = useState(false)
  const [selectedTask, setSelectedTask] = useState<any>(null)
  const [showTaskDialog, setShowTaskDialog] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const { toast } = useToast()
  const router = useRouter()

  const fetchTasks = useCallback(async () => {
    try {
      setLoadingTasks(true)
      const userTasks = await getTasksForCurrentUser()
      console.log("[v0] Calendar - Tasks fetched:", userTasks?.length || 0)
      setTasks(userTasks || [])
    } catch (error) {
      console.error("[v0] Error fetching tasks:", error)
      if (error instanceof Error && !error.message.includes("tasks")) {
        toast({
          title: "Erro",
          description: "Falha ao carregar tarefas",
          variant: "destructive",
        })
      }
    } finally {
      setLoadingTasks(false)
    }
  }, [toast])

  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await fetchTasks()
    setIsRefreshing(false)
    toast({
      title: "Atualizado",
      description: "Tarefas atualizadas com sucesso.",
    })
  }

  const handlePrevious = () => {
    const newDate = new Date(currentDate)
    if (view === "month") {
      newDate.setMonth(currentDate.getMonth() - 1)
    } else if (view === "week") {
      newDate.setDate(currentDate.getDate() - 7)
    } else {
      newDate.setDate(currentDate.getDate() - 1)
    }
    setCurrentDate(newDate)
  }

  const handleNext = () => {
    const newDate = new Date(currentDate)
    if (view === "month") {
      newDate.setMonth(currentDate.getMonth() + 1)
    } else if (view === "week") {
      newDate.setDate(currentDate.getDate() + 7)
    } else {
      newDate.setDate(currentDate.getDate() + 1)
    }
    setCurrentDate(newDate)
  }

  const handleToday = () => {
    setCurrentDate(new Date())
  }

  const handleMeetingClick = (meeting: Meeting) => {
    toast({
      title: meeting.title,
      description: `${new Date(meeting.startTime).toLocaleString()} - ${meeting.leadName || "No lead assigned"}`,
    })
  }

  const handleTaskClick = async (task: any) => {
    setSelectedTask(task)
    setShowTaskDialog(true)
  }

  const handleOpenLead = async () => {
    if (!selectedTask?.lead_id) {
      toast({
        title: "Erro",
        description: "Esta tarefa não está associada a um lead.",
        variant: "destructive",
      })
      return
    }

    setLoadingLead(true)
    try {
      const { data: lead, error } = await getLeadById(selectedTask.lead_id)

      if (error || !lead) {
        toast({
          title: "Erro",
          description: "Não foi possível carregar o lead",
          variant: "destructive",
        })
        return
      }

      setSelectedLead(lead)
      setShowTaskDialog(false)
      setShowLeadDialog(true)
    } catch (error) {
      console.error("[v0] Error fetching lead:", error)
      toast({
        title: "Erro",
        description: "Erro ao carregar o lead",
        variant: "destructive",
      })
    } finally {
      setLoadingLead(false)
    }
  }

  const handleToggleTaskCompletion = async () => {
    if (!selectedTask) return

    try {
      await toggleTaskCompletion(selectedTask.id, !selectedTask.completed)

      // Update local state
      setTasks(tasks.map((t) => (t.id === selectedTask.id ? { ...t, completed: !t.completed } : t)))

      setShowTaskDialog(false)
      toast({
        title: selectedTask.completed ? "Tarefa reaberta" : "Tarefa concluída",
        description: selectedTask.completed
          ? "A tarefa foi marcada como pendente."
          : "A tarefa foi marcada como concluída.",
      })
    } catch (error) {
      console.error("[v0] Error toggling task:", error)
      toast({
        title: "Erro",
        description: "Não foi possível atualizar a tarefa.",
        variant: "destructive",
      })
    }
  }

  const handleDeleteTask = async () => {
    if (!selectedTask) return

    try {
      await deleteTask(selectedTask.id)

      // Remove from local state
      setTasks(tasks.filter((t) => t.id !== selectedTask.id))

      setShowTaskDialog(false)
      toast({
        title: "Tarefa excluída",
        description: "A tarefa foi removida com sucesso.",
      })
    } catch (error) {
      console.error("[v0] Error deleting task:", error)
      toast({
        title: "Erro",
        description: "Não foi possível excluir a tarefa.",
        variant: "destructive",
      })
    }
  }

  const handleScheduleMeeting = () => {
    toast({
      title: "Schedule Meeting",
      description: "Meeting scheduling modal would open here",
    })
  }

  const handleDateClick = (date: Date) => {
    setCurrentDate(date)
    setView("day")
    toast({
      title: "Visualizando Dia",
      description: `${date.toLocaleDateString("pt-BR", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })}`,
    })
  }

  const handleLeadDialogClose = (open: boolean) => {
    setShowLeadDialog(open)
    if (!open) {
      // Refresh tasks when lead dialog closes (in case tasks were modified)
      fetchTasks()
    }
  }

  return (
    <PageLayout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-3xl font-bold text-foreground">Agenda</h2>
          <p className="text-muted-foreground mt-1">
            Gerencie suas reuniões e tarefas
            {tasks.length > 0 && ` • ${tasks.length} tarefa(s)`}
          </p>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={handleRefresh} disabled={isRefreshing} className="gap-2 bg-transparent">
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button onClick={handleScheduleMeeting} className="gap-2 bg-primary hover:bg-primary-600">
            <Plus className="h-4 w-4" />
            Agendar Reunião
          </Button>
        </div>
      </div>

      <CalendarHeader
        currentDate={currentDate}
        view={view}
        onViewChange={setView}
        onPrevious={handlePrevious}
        onNext={handleNext}
        onToday={handleToday}
      />

      {loadingTasks ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground">Carregando tarefas...</div>
        </div>
      ) : (
        <>
          {view === "month" && (
            <MonthView
              currentDate={currentDate}
              meetings={mockMeetings}
              tasks={tasks}
              onMeetingClick={handleMeetingClick}
              onTaskClick={handleTaskClick}
              onDateClick={handleDateClick}
            />
          )}
          {view === "week" && (
            <WeekView
              currentDate={currentDate}
              meetings={mockMeetings}
              tasks={tasks}
              onMeetingClick={handleMeetingClick}
              onTaskClick={handleTaskClick}
            />
          )}
          {view === "day" && (
            <DayView
              currentDate={currentDate}
              meetings={mockMeetings}
              tasks={tasks}
              onMeetingClick={handleMeetingClick}
              onTaskClick={handleTaskClick}
            />
          )}
        </>
      )}

      <AlertDialog open={showTaskDialog} onOpenChange={setShowTaskDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{selectedTask?.description || "Tarefa"}</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedTask?.due_date && (
                <span className="block mb-2">Data: {new Date(selectedTask.due_date).toLocaleString("pt-BR")}</span>
              )}
              {selectedTask?.leads?.name && (
                <span className="block mb-2">
                  Lead: {selectedTask.leads.name}
                  {selectedTask.leads.company && ` - ${selectedTask.leads.company}`}
                </span>
              )}
              <span className="block">Status: {selectedTask?.completed ? "✅ Concluída" : "⏳ Pendente"}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel>Fechar</AlertDialogCancel>
            <Button variant="outline" onClick={handleOpenLead} disabled={loadingLead || !selectedTask?.lead_id}>
              {loadingLead ? "Carregando..." : "Abrir Lead"}
            </Button>
            <Button variant={selectedTask?.completed ? "outline" : "default"} onClick={handleToggleTaskCompletion}>
              {selectedTask?.completed ? "Reabrir Tarefa" : "Marcar como Concluída"}
            </Button>
            <Button variant="destructive" onClick={handleDeleteTask}>
              Excluir Tarefa
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {selectedLead && (
        <LeadDetailsDialog lead={selectedLead} open={showLeadDialog} onOpenChange={handleLeadDialogClose} />
      )}
    </PageLayout>
  )
}
