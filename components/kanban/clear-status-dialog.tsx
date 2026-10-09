"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import type { LeadStatus } from "@/lib/types"
import { statusConfig } from "@/lib/types"
import { AlertCircle } from "lucide-react"

interface ClearStatusDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  statuses: LeadStatus[]
  onConfirm: (status: LeadStatus) => void
  leadCounts: Record<LeadStatus, number>
}

export function ClearStatusDialog({ open, onOpenChange, statuses, onConfirm, leadCounts }: ClearStatusDialogProps) {
  const [selectedStatus, setSelectedStatus] = useState<LeadStatus | null>(null)

  const handleConfirm = () => {
    if (selectedStatus) {
      onConfirm(selectedStatus)
      setSelectedStatus(null)
      onOpenChange(false)
    }
  }

  const handleCancel = () => {
    setSelectedStatus(null)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Clean Status</DialogTitle>
          <DialogDescription>
            Selecione o status que deseja limpar. Os leads serão removidos desta visualização, mas permanecerão em "My
            Leads".
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <RadioGroup value={selectedStatus || ""} onValueChange={(value) => setSelectedStatus(value as LeadStatus)}>
            <div className="space-y-3">
              {statuses.map((status) => {
                const count = leadCounts[status] || 0
                const config = statusConfig[status]

                return (
                  <div
                    key={status}
                    className="flex items-center space-x-3 rounded-lg border border-border p-3 hover:bg-accent/50 transition-colors"
                  >
                    <RadioGroupItem value={status} id={status} />
                    <Label htmlFor={status} className="flex-1 cursor-pointer flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: config.color }} />
                        <span className="font-medium">{config.label}</span>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {count} {count === 1 ? "lead" : "leads"}
                      </span>
                    </Label>
                  </div>
                )
              })}
            </div>
          </RadioGroup>

          {selectedStatus && leadCounts[selectedStatus] > 0 && (
            <div className="mt-4 flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 p-3">
              <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-800 dark:text-amber-200">
                <p className="font-medium">Atenção!</p>
                <p className="mt-1">
                  {leadCounts[selectedStatus]}{" "}
                  {leadCounts[selectedStatus] === 1 ? "lead será removido" : "leads serão removidos"} desta visualização
                  e movido para "My Leads".
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Cancelar
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!selectedStatus || leadCounts[selectedStatus!] === 0}
            className="bg-primary hover:bg-primary-600"
          >
            Clean Status
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
