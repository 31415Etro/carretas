"use client"

import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight, CalendarIcon } from "lucide-react"
import type { CalendarView } from "@/lib/types"
import { cn } from "@/lib/utils"

interface CalendarHeaderProps {
  currentDate: Date
  view: CalendarView
  onViewChange: (view: CalendarView) => void
  onPrevious: () => void
  onNext: () => void
  onToday: () => void
}

export function CalendarHeader({ currentDate, view, onViewChange, onPrevious, onNext, onToday }: CalendarHeaderProps) {
  const formatTitle = () => {
    const options: Intl.DateTimeFormatOptions =
      view === "month"
        ? { month: "long", year: "numeric" }
        : view === "week"
          ? { month: "short", day: "numeric", year: "numeric" }
          : { weekday: "long", month: "long", day: "numeric", year: "numeric" }

    return currentDate.toLocaleDateString("en-US", options)
  }

  return (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-4">
        <h2 className="text-2xl font-bold text-foreground">{formatTitle()}</h2>
        <Button variant="outline" size="sm" onClick={onToday} className="gap-2 bg-transparent">
          <CalendarIcon className="h-4 w-4" />
          Today
        </Button>
      </div>

      <div className="flex items-center gap-3">
        {/* Navigation */}
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={onPrevious}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={onNext}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* View Switcher */}
        <div className="flex items-center gap-1 p-1 bg-muted rounded-lg">
          {(["month", "week", "day"] as CalendarView[]).map((v) => (
            <Button
              key={v}
              variant="ghost"
              size="sm"
              onClick={() => onViewChange(v)}
              className={cn(
                "capitalize",
                view === v && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
              )}
            >
              {v}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}
