"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Filter, RotateCcw } from "lucide-react"
import type { LeadStatus } from "@/lib/types"
import { statusConfig } from "@/lib/types"

export interface LeadFilters {
  searchQuery?: string
  status?: LeadStatus[]
  assignedSDR?: string[]
  assignedCloser?: string[]
  valueRange?: {
    min: number | null
    max: number | null
  }
  hasFollowUp?: boolean
  hasMeeting?: boolean
  location?: string
  source?: string[]
}

interface AdvancedFilterDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onApplyFilters: (filters: LeadFilters) => void
  currentFilters: LeadFilters
  availableUsers?: { id: string; name: string }[]
}

export function AdvancedFilterDialog({
  open,
  onOpenChange,
  onApplyFilters,
  currentFilters,
  availableUsers = [],
}: AdvancedFilterDialogProps) {
  const [filters, setFilters] = useState<LeadFilters>(currentFilters)
  const [activeFilterCount, setActiveFilterCount] = useState(0)

  useEffect(() => {
    setFilters(currentFilters)
  }, [currentFilters])

  useEffect(() => {
    let count = 0
    if (filters.searchQuery) count++
    if (filters.status && filters.status.length > 0) count++
    if (filters.assignedSDR && filters.assignedSDR.length > 0) count++
    if (filters.assignedCloser && filters.assignedCloser.length > 0) count++
    if (filters.valueRange?.min !== null || filters.valueRange?.max !== null) count++
    if (filters.hasFollowUp !== undefined) count++
    if (filters.hasMeeting !== undefined) count++
    if (filters.location) count++
    if (filters.source && filters.source.length > 0) count++
    setActiveFilterCount(count)
  }, [filters])

  const handleStatusToggle = (status: LeadStatus) => {
    const currentStatuses = filters.status || []
    const newStatuses = currentStatuses.includes(status)
      ? currentStatuses.filter((s) => s !== status)
      : [...currentStatuses, status]
    setFilters({ ...filters, status: newStatuses })
  }

  const handleUserToggle = (userId: string, type: "sdr" | "closer") => {
    if (type === "sdr") {
      const currentUsers = filters.assignedSDR || []
      const newUsers = currentUsers.includes(userId)
        ? currentUsers.filter((u) => u !== userId)
        : [...currentUsers, userId]
      setFilters({ ...filters, assignedSDR: newUsers })
    } else {
      const currentUsers = filters.assignedCloser || []
      const newUsers = currentUsers.includes(userId)
        ? currentUsers.filter((u) => u !== userId)
        : [...currentUsers, userId]
      setFilters({ ...filters, assignedCloser: newUsers })
    }
  }

  const handleSourceToggle = (source: string) => {
    const currentSources = filters.source || []
    const newSources = currentSources.includes(source)
      ? currentSources.filter((s) => s !== source)
      : [...currentSources, source]
    setFilters({ ...filters, source: newSources })
  }

  const handleReset = () => {
    setFilters({})
  }

  const handleApply = () => {
    onApplyFilters(filters)
    onOpenChange(false)
  }

  const allStatuses: LeadStatus[] = [
    "novo",
    "em_atendimento",
    "follow_up",
    "outbound",
    "em_negociacao",
    "fechado",
    "perdido",
    "fila_espera",
    "programacao_time",
    "aguardando_informacoes",
    "sem_pendencias",
    "projetos_ganhos",
    "perdidos_cancelados",
  ]

  const leadSources = ["Inbound", "Outbound", "Indicação", "Parceria", "Marketing", "Cold Call", "LinkedIn", "Website"]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[85vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filtros Avançados
            {activeFilterCount > 0 && (
              <Badge variant="secondary" className="ml-2">
                {activeFilterCount} {activeFilterCount === 1 ? "filtro" : "filtros"} ativo
                {activeFilterCount > 1 ? "s" : ""}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>Configure os filtros para encontrar leads específicos</DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 h-[calc(85vh-160px)] overflow-y-auto">
          <div className="space-y-6 py-4 pr-4">
            {/* Search Query */}
            <div className="space-y-2">
              <Label htmlFor="search">Busca por texto</Label>
              <Input
                id="search"
                placeholder="Nome, empresa, localização..."
                value={filters.searchQuery || ""}
                onChange={(e) => setFilters({ ...filters, searchQuery: e.target.value })}
              />
            </div>

            {/* Status Filter */}
            <div className="space-y-3">
              <Label>Status</Label>
              <div className="grid grid-cols-2 gap-2">
                {allStatuses.map((status) => (
                  <div key={status} className="flex items-center space-x-2">
                    <Checkbox
                      id={`status-${status}`}
                      checked={filters.status?.includes(status) || false}
                      onCheckedChange={() => handleStatusToggle(status)}
                    />
                    <Label htmlFor={`status-${status}`} className="text-sm font-normal cursor-pointer">
                      {statusConfig[status]?.label || status}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            {/* Assigned Users */}
            {availableUsers.length > 0 && (
              <>
                <div className="space-y-3">
                  <Label>Atribuído para SDR</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {availableUsers.map((user) => (
                      <div key={user.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={`sdr-${user.id}`}
                          checked={filters.assignedSDR?.includes(user.id) || false}
                          onCheckedChange={() => handleUserToggle(user.id, "sdr")}
                        />
                        <Label htmlFor={`sdr-${user.id}`} className="text-sm font-normal cursor-pointer">
                          {user.name}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <Label>Atribuído para Closer</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {availableUsers.map((user) => (
                      <div key={user.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={`closer-${user.id}`}
                          checked={filters.assignedCloser?.includes(user.id) || false}
                          onCheckedChange={() => handleUserToggle(user.id, "closer")}
                        />
                        <Label htmlFor={`closer-${user.id}`} className="text-sm font-normal cursor-pointer">
                          {user.name}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Value Range */}
            <div className="space-y-3">
              <Label>Faixa de Valor (R$)</Label>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="value-min" className="text-xs text-muted-foreground">
                    Valor Mínimo
                  </Label>
                  <Input
                    id="value-min"
                    type="number"
                    placeholder="0"
                    value={filters.valueRange?.min || ""}
                    onChange={(e) =>
                      setFilters({
                        ...filters,
                        valueRange: {
                          ...filters.valueRange,
                          min: e.target.value ? Number(e.target.value) : null,
                          max: filters.valueRange?.max || null,
                        },
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="value-max" className="text-xs text-muted-foreground">
                    Valor Máximo
                  </Label>
                  <Input
                    id="value-max"
                    type="number"
                    placeholder="∞"
                    value={filters.valueRange?.max || ""}
                    onChange={(e) =>
                      setFilters({
                        ...filters,
                        valueRange: {
                          ...filters.valueRange,
                          max: e.target.value ? Number(e.target.value) : null,
                          min: filters.valueRange?.min || null,
                        },
                      })
                    }
                  />
                </div>
              </div>
            </div>

            {/* Location */}
            <div className="space-y-2">
              <Label htmlFor="location">Localização</Label>
              <Input
                id="location"
                placeholder="Cidade, Estado..."
                value={filters.location || ""}
                onChange={(e) => setFilters({ ...filters, location: e.target.value })}
              />
            </div>

            {/* Lead Source */}
            <div className="space-y-3">
              <Label>Fonte do Lead</Label>
              <div className="grid grid-cols-2 gap-2">
                {leadSources.map((source) => (
                  <div key={source} className="flex items-center space-x-2">
                    <Checkbox
                      id={`source-${source}`}
                      checked={filters.source?.includes(source) || false}
                      onCheckedChange={() => handleSourceToggle(source)}
                    />
                    <Label htmlFor={`source-${source}`} className="text-sm font-normal cursor-pointer">
                      {source}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            {/* Boolean Filters */}
            <div className="space-y-3">
              <Label>Outros Filtros</Label>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="has-follow-up"
                    checked={filters.hasFollowUp || false}
                    onCheckedChange={(checked) => setFilters({ ...filters, hasFollowUp: checked as boolean })}
                  />
                  <Label htmlFor="has-follow-up" className="text-sm font-normal cursor-pointer">
                    Possui follow-up agendado
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="has-meeting"
                    checked={filters.hasMeeting || false}
                    onCheckedChange={(checked) => setFilters({ ...filters, hasMeeting: checked as boolean })}
                  />
                  <Label htmlFor="has-meeting" className="text-sm font-normal cursor-pointer">
                    Possui reunião agendada
                  </Label>
                </div>
              </div>
            </div>
          </div>
        </ScrollArea>

        <div className="flex items-center justify-between pt-4 border-t flex-shrink-0">
          <Button variant="outline" onClick={handleReset} className="gap-2 bg-transparent">
            <RotateCcw className="h-4 w-4" />
            Limpar Filtros
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={handleApply} className="gap-2">
              <Filter className="h-4 w-4" />
              Aplicar Filtros
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
