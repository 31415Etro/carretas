"use client"

import type React from "react"
import { type Lead, type LeadStatus, statusConfig } from "@/lib/types"
import { LeadCard } from "./lead-card"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"

interface KanbanColumnProps {
  status: LeadStatus
  leads: Lead[]
  onScheduleMeeting: (leadId: string) => void
  onDragStart: (lead: Lead) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent, status: LeadStatus) => void
  isDraggingOver?: boolean
  onRefresh?: () => Promise<void>
  disableDrag?: boolean
}

const CARDS_PER_PAGE = 10

export function KanbanColumn({
  status,
  leads,
  onScheduleMeeting,
  onDragStart,
  onDragOver,
  onDrop,
  isDraggingOver,
  onRefresh,
  disableDrag = false,
}: KanbanColumnProps) {
  const config = statusConfig[status]

  return (
    <div className="flex flex-col min-w-[320px] max-w-[320px]">
      {/* Column Header */}
      <div className="flex items-center justify-between mb-4 px-1">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full" style={{ backgroundColor: config.color }} />
          <h3 className="font-semibold text-foreground">{config.label}</h3>
          <span className="text-sm text-muted-foreground">({leads.length})</span>
        </div>
      </div>

      {/* Column Content with Scroll */}
      <ScrollArea
        className={cn(
          "rounded-lg bg-muted/30 border-2 border-dashed border-transparent transition-all h-[calc(100vh-260px)]",
          isDraggingOver && !disableDrag && "border-primary bg-primary/5",
        )}
        onDragOver={onDragOver}
        onDrop={(e) => onDrop(e, status)}
      >
        <div className="space-y-3 p-3">
          {leads.map((lead) => (
            <div key={lead.id} draggable={!disableDrag} onDragStart={() => onDragStart(lead)}>
              <LeadCard lead={lead} onScheduleMeeting={onScheduleMeeting} onRefresh={onRefresh} />
            </div>
          ))}

          {leads.length === 0 && (
            <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
              Nenhum lead neste status
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
