"use client"

import type { Meeting } from "@/lib/types"
import { cn } from "@/lib/utils"
import { CheckCircle2, RefreshCw, CheckSquare, Square } from "lucide-react"

interface MonthViewProps {
  currentDate: Date
  meetings: Meeting[]
  tasks?: any[]
  onMeetingClick: (meeting: Meeting) => void
  onTaskClick?: (task: any) => void
  onDateClick?: (date: Date) => void // Added callback for date clicks
}

export function MonthView({
  currentDate,
  meetings,
  tasks = [],
  onMeetingClick,
  onTaskClick,
  onDateClick,
}: MonthViewProps) {
  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  // Get first day of month and total days
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const daysInPrevMonth = new Date(year, month, 0).getDate()

  // Build calendar grid
  const days: (Date | null)[] = []

  // Previous month days
  for (let i = firstDay - 1; i >= 0; i--) {
    days.push(new Date(year, month - 1, daysInPrevMonth - i))
  }

  // Current month days
  for (let i = 1; i <= daysInMonth; i++) {
    days.push(new Date(year, month, i))
  }

  // Next month days to fill grid
  const remainingDays = 42 - days.length
  for (let i = 1; i <= remainingDays; i++) {
    days.push(new Date(year, month + 1, i))
  }

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
      const taskDate = new Date(task.due_date)
      return (
        taskDate.getDate() === date.getDate() &&
        taskDate.getMonth() === date.getMonth() &&
        taskDate.getFullYear() === date.getFullYear()
      )
    })
  }

  const isToday = (date: Date) => {
    const today = new Date()
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    )
  }

  const isCurrentMonth = (date: Date) => {
    return date.getMonth() === month
  }

  return (
    <div className="bg-card border border-border rounded-lg shadow-[var(--shadow-soft)] overflow-hidden">
      {/* Weekday headers */}
      <div className="grid grid-cols-7 border-b border-border bg-muted/50">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
          <div key={day} className="p-3 text-center text-sm font-semibold text-muted-foreground">
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7">
        {days.map((date, index) => {
          if (!date) return null
          const dayMeetings = getMeetingsForDay(date)
          const dayTasks = getTasksForDay(date)
          const isCurrent = isCurrentMonth(date)
          const today = isToday(date)

          return (
            <div
              key={index}
              className={cn(
                "min-h-[120px] border-r border-b border-border p-2",
                !isCurrent && "bg-muted/20",
                index % 7 === 6 && "border-r-0",
              )}
            >
              <button
                onClick={() => onDateClick?.(date)}
                className={cn(
                  "inline-flex items-center justify-center h-7 w-7 rounded-full text-sm font-medium mb-1 transition-colors",
                  today && "bg-primary text-primary-foreground hover:bg-primary/90",
                  !today && isCurrent && "text-foreground hover:bg-muted",
                  !isCurrent && "text-muted-foreground hover:bg-muted/50",
                )}
              >
                {date.getDate()}
              </button>

              <div className="space-y-1">
                {dayMeetings.slice(0, 2).map((meeting) => (
                  <button
                    key={meeting.id}
                    onClick={() => onMeetingClick(meeting)}
                    className="w-full text-left px-2 py-1 rounded text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors truncate flex items-center gap-1"
                  >
                    {meeting.status === "completed" && <CheckCircle2 className="h-3 w-3 flex-shrink-0" />}
                    {meeting.status === "rescheduled" && <RefreshCw className="h-3 w-3 flex-shrink-0" />}
                    <span className="truncate">
                      {new Date(meeting.startTime).toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                      })}{" "}
                      {meeting.title}
                    </span>
                  </button>
                ))}

                {dayTasks.slice(0, 3 - dayMeetings.length).map((task) => (
                  <button
                    key={task.id}
                    onClick={() => onTaskClick?.(task)}
                    className="w-full text-left px-2 py-1 rounded text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-900 dark:text-amber-100 border border-amber-200 dark:border-amber-800 hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors truncate flex items-center gap-1 cursor-pointer"
                  >
                    {task.completed ? (
                      <CheckSquare className="h-3 w-3 flex-shrink-0" />
                    ) : (
                      <Square className="h-3 w-3 flex-shrink-0" />
                    )}
                    <span className="truncate">{task.description}</span>
                  </button>
                ))}

                {dayMeetings.length + dayTasks.length > 3 && (
                  <div className="text-xs text-muted-foreground px-2">
                    +{dayMeetings.length + dayTasks.length - 3} more
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
