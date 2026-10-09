"use client"
import { format, isSameDay, isValid } from "date-fns"
import { ptBR } from "date-fns/locale"
import { CalendarIcon, CheckCircle2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import type { Meeting, Task } from "@/lib/types"

interface DayViewProps {
  currentDate: Date
  meetings: Meeting[]
  tasks: Task[]
  onMeetingClick?: (meeting: Meeting) => void
  onTaskClick?: (task: Task) => void
}

export function DayView({ currentDate, meetings, tasks, onMeetingClick, onTaskClick }: DayViewProps) {
  const router = useRouter()
  const safeSelectedDate = isValid(currentDate) ? currentDate : new Date()

  const hours = Array.from({ length: 14 }, (_, i) => i + 7) // 7 AM to 8 PM

  const handleTaskClick = (task: any) => {
    if (task.lead_id) {
      router.push(`/kanban/closer?leadId=${task.lead_id}`)
    } else if (onTaskClick) {
      onTaskClick(task)
    }
  }

  const getTasksForHour = (hour: number) => {
    return tasks.filter((task) => {
      if (!task.due_date) return false

      const taskDate = new Date(task.due_date)

      // Check if task is on the same day
      if (!isSameDay(taskDate, safeSelectedDate)) return false

      const taskHour = taskDate.getHours()

      console.log("[v0] Checking task for hour", hour, {
        taskTitle: task.title || task.description,
        taskDueDate: task.due_date,
        taskHour,
        matches: taskHour === hour,
      })

      return taskHour === hour
    })
  }

  const getMeetingsForHour = (hour: number) => {
    return meetings.filter((meeting) => {
      if (!meeting.startTime) return false

      const meetingDate = new Date(meeting.startTime)

      if (!isSameDay(meetingDate, safeSelectedDate)) return false

      const meetingHour = meetingDate.getHours()
      return meetingHour === hour
    })
  }

  const allDayTasks = tasks.filter((task) => {
    if (!task.due_date) return false

    const taskDate = new Date(task.due_date)

    if (!isSameDay(taskDate, safeSelectedDate)) return false

    // All-day tasks have time set to 00:00
    const hours = taskDate.getHours()
    const minutes = taskDate.getMinutes()
    return hours === 0 && minutes === 0
  })

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-center p-4 border-b border-border bg-card">
        <h2 className="text-lg font-semibold">
          {format(safeSelectedDate, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })}
        </h2>
      </div>

      {/* All-day tasks section */}
      {allDayTasks.length > 0 && (
        <div className="p-4 border-b border-border bg-muted/30">
          <h3 className="text-sm font-semibold mb-2">Tarefas do Dia (Sem Horário Específico)</h3>
          <div className="space-y-2">
            {allDayTasks.map((task) => (
              <Card
                key={task.id}
                className="p-3 bg-card cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => handleTaskClick(task)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <p className="text-sm font-medium">{task.title || task.description}</p>
                    {task.title && task.description && (
                      <p className="text-xs text-muted-foreground mt-1">{task.description}</p>
                    )}
                  </div>
                  <Badge variant={task.status === "completed" ? "default" : "secondary"} className="shrink-0">
                    {task.status === "completed" ? "Concluída" : "Pendente"}
                  </Badge>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Time Grid */}
      <div className="flex-1 overflow-auto">
        <div className="min-w-[600px]">
          {hours.map((hour) => {
            const hourMeetings = getMeetingsForHour(hour)
            const hourTasks = getTasksForHour(hour)

            return (
              <div key={hour} className="flex border-b border-border min-h-[80px]">
                {/* Time Label */}
                <div className="w-20 p-2 text-sm text-muted-foreground border-r border-border flex items-start">
                  {format(new Date().setHours(hour, 0, 0, 0), "HH:mm")}
                </div>

                {/* Content */}
                <div className="flex-1 p-2 space-y-2">
                  {hourMeetings.map((meeting) => (
                    <Card
                      key={meeting.id}
                      className="p-3 bg-blue-50 dark:bg-blue-950/20 border-l-4 border-l-blue-500 cursor-pointer hover:shadow-md transition-shadow"
                      onClick={() => onMeetingClick?.(meeting)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <CalendarIcon className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                            <p className="text-sm font-medium">{meeting.title}</p>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {format(new Date(meeting.startTime), "HH:mm", { locale: ptBR })}
                            {meeting.leadName && ` - ${meeting.leadName}`}
                          </p>
                          {meeting.description && (
                            <p className="text-xs text-muted-foreground mt-1">{meeting.description}</p>
                          )}
                        </div>
                        <Badge variant="outline" className="shrink-0">
                          Reunião
                        </Badge>
                      </div>
                    </Card>
                  ))}

                  {hourTasks.map((task) => (
                    <Card
                      key={task.id}
                      className="p-3 bg-amber-50 dark:bg-amber-950/20 border-l-4 border-l-amber-500 cursor-pointer hover:shadow-md transition-shadow"
                      onClick={() => handleTaskClick(task)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <CheckCircle2
                              className={`h-4 w-4 ${task.status === "completed" ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}
                            />
                            <p className="text-sm font-medium">{task.title || task.description}</p>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {format(new Date(task.due_date), "HH:mm", { locale: ptBR })}
                          </p>
                          {task.title && task.description && (
                            <p className="text-xs text-muted-foreground mt-1">{task.description}</p>
                          )}
                        </div>
                        <Badge
                          variant={task.status === "completed" ? "default" : "secondary"}
                          className={task.status === "completed" ? "bg-green-600" : ""}
                        >
                          {task.status === "completed" ? "Concluída" : "Pendente"}
                        </Badge>
                      </div>
                    </Card>
                  ))}

                  {/* Empty state when no events */}
                  {hourMeetings.length === 0 && hourTasks.length === 0 && (
                    <div className="h-full flex items-center justify-center text-muted-foreground/50 text-xs">
                      Sem eventos
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
