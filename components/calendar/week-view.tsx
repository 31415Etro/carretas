"use client"

import type { Meeting } from "@/lib/types"
import { cn } from "@/lib/utils"
import { CheckCircle2, RefreshCw } from "lucide-react"
import { format } from "date-fns"

interface WeekViewProps {
  currentDate: Date
  meetings: Meeting[]
  tasks?: any[]
  onMeetingClick: (meeting: Meeting) => void
  onTaskClick?: (task: any) => void
}

export function WeekView({ currentDate, meetings, tasks = [], onMeetingClick, onTaskClick }: WeekViewProps) {
  // Get start of week (Sunday)
  const startOfWeek = new Date(currentDate)
  startOfWeek.setDate(currentDate.getDate() - currentDate.getDay())

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(startOfWeek)
    date.setDate(startOfWeek.getDate() + i)
    return date
  })

  const hours = Array.from({ length: 24 }, (_, i) => i)

  const getMeetingsForDay = (date: Date) => {
    return meetings.filter((meeting) => {
      const meetingDate = new Date(meeting.startTime)
      return (
        meetingDate.getDate() === date.getDate() &&
        meetingDate.getMonth() === date.getMonth() &&
        meetingDate.getFullYear() === date.getFullYear()
      )
    })
  }

  const getTasksForDay = (date: Date) => {
    return tasks.filter((task) => {
      if (!task.due_date) return false

      const taskDate = new Date(task.due_date)

      console.log("[v0] Week view - checking task", {
        taskTitle: task.title || task.description,
        taskDueDate: task.due_date,
        taskDateLocal: taskDate.toLocaleString(),
        taskHour: taskDate.getHours(),
        taskMinute: taskDate.getMinutes(),
        checkingDay: date.toLocaleDateString(),
        isSameDay: isSameDay(taskDate, date),
      })

      return isSameDay(taskDate, date)
    })
  }

  const isSameDay = (first: Date, second: Date) => {
    return (
      first.getDate() === second.getDate() &&
      first.getMonth() === second.getMonth() &&
      first.getFullYear() === second.getFullYear()
    )
  }

  const isToday = (date: Date) => {
    const today = new Date()
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    )
  }

  return (
    <div className="bg-card border border-border rounded-lg shadow-[var(--shadow-soft)] overflow-hidden">
      {/* Day headers */}
      <div className="grid grid-cols-8 border-b border-border bg-muted/50 sticky top-0">
        <div className="p-3 border-r border-border" />
        {weekDays.map((date, index) => {
          const today = isToday(date)
          return (
            <div key={index} className="p-3 text-center border-r border-border last:border-r-0">
              <div className="text-xs text-muted-foreground font-medium">
                {date.toLocaleDateString("en-US", { weekday: "short" })}
              </div>
              <div className={cn("text-lg font-semibold mt-1", today ? "text-primary" : "text-foreground")}>
                {date.getDate()}
              </div>
            </div>
          )
        })}
      </div>

      {/* Time grid */}
      <div className="overflow-auto max-h-[600px]">
        <div className="grid grid-cols-8">
          {hours.map((hour) => (
            <>
              <div
                key={`hour-${hour}`}
                className="p-2 border-r border-b border-border text-xs text-muted-foreground text-right"
              >
                {hour === 0 ? "12 AM" : hour < 12 ? `${hour} AM` : hour === 12 ? "12 PM" : `${hour - 12} PM`}
              </div>
              {weekDays.map((date, dayIndex) => {
                const dayMeetings = getMeetingsForDay(date).filter((meeting) => {
                  const meetingHour = new Date(meeting.startTime).getHours()
                  return meetingHour === hour
                })

                const dayTasks = getTasksForDay(date)

                return (
                  <div
                    key={`${hour}-${dayIndex}`}
                    className="min-h-[60px] border-r border-b border-border p-1 last:border-r-0"
                  >
                    {dayMeetings.map((meeting) => (
                      <button
                        key={meeting.id}
                        onClick={() => onMeetingClick(meeting)}
                        className="w-full text-left px-2 py-1 rounded text-xs bg-primary text-primary-foreground hover:bg-primary-600 transition-colors mb-1 flex items-center gap-1"
                      >
                        {meeting.status === "completed" && <CheckCircle2 className="h-3 w-3 flex-shrink-0" />}
                        {meeting.status === "rescheduled" && <RefreshCw className="h-3 w-3 flex-shrink-0" />}
                        <span className="truncate">{meeting.title}</span>
                      </button>
                    ))}

                    {dayTasks.map((task) => (
                      <button
                        key={task.id}
                        onClick={() => onTaskClick?.(task)}
                        className="w-full text-left px-2 py-1 rounded text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-900 dark:text-amber-100 border border-amber-200 dark:border-amber-800 hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors mb-1 flex items-center gap-1 cursor-pointer"
                      >
                        <CheckCircle2
                          className={`h-3 w-3 shrink-0 ${task.status === "completed" ? "text-green-600" : "text-amber-600"}`}
                        />
                        <span className="truncate flex-1">{task.title || task.description}</span>
                        {task.due_date && (
                          <span className="text-xs opacity-70 shrink-0">
                            {format(new Date(task.due_date), "HH:mm")}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )
              })}
            </>
          ))}
        </div>
      </div>
    </div>
  )
}
