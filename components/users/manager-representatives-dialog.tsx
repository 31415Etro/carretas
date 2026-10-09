"use client"

import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Loader2, Users, UserCheck } from "lucide-react"
import type { User } from "@/lib/types"
import { useToast } from "@/hooks/use-toast"

interface ManagerRepresentativesDialogProps {
  manager: User
  onClose: () => void
  onSuccess: () => void
}

export function ManagerRepresentativesDialog({ manager, onClose, onSuccess }: ManagerRepresentativesDialogProps) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [representatives, setRepresentatives] = useState<User[]>([])
  const [selectedReps, setSelectedReps] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetchRepresentatives()
  }, [manager.id])

  const fetchRepresentatives = async () => {
    try {
      setLoading(true)
      const response = await fetch("/api/users")
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch users")
      }

      // Filter only representatives
      const reps = (data.users || []).filter((user: User) => user.role === "representative")
      setRepresentatives(reps)

      // Select representatives that are already assigned to this manager
      const assigned = new Set(reps.filter((rep: User) => rep.managerId === manager.id).map((rep: User) => rep.id))
      setSelectedReps(assigned)
    } catch (error) {
      console.error("[v0] Error fetching representatives:", error)
      toast({
        title: "Erro",
        description: "Falha ao carregar representantes",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const handleToggleRep = (repId: string) => {
    const newSelected = new Set(selectedReps)
    if (newSelected.has(repId)) {
      newSelected.delete(repId)
    } else {
      newSelected.add(repId)
    }
    setSelectedReps(newSelected)
  }

  const handleSave = async () => {
    try {
      setSaving(true)

      // Update all representatives
      const updatePromises = representatives.map(async (rep) => {
        const shouldBeAssigned = selectedReps.has(rep.id)
        const isCurrentlyAssigned = rep.managerId === manager.id

        // Only update if there's a change
        if (shouldBeAssigned !== isCurrentlyAssigned) {
          const response = await fetch(`/api/users/${rep.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              manager_id: shouldBeAssigned ? manager.id : null,
            }),
          })

          if (!response.ok) {
            const data = await response.json()
            throw new Error(data.error || "Failed to update representative")
          }
        }
      })

      await Promise.all(updatePromises)

      toast({
        title: "Sucesso",
        description: `Representantes do gerente ${manager.name} atualizados com sucesso`,
      })

      onSuccess()
      onClose()
    } catch (error) {
      console.error("[v0] Error updating representatives:", error)
      toast({
        title: "Erro",
        description: "Falha ao atualizar representantes",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-orange-500" />
            <DialogTitle>Gerenciar Representantes</DialogTitle>
          </div>
          <DialogDescription>
            Selecione os representantes que respondem ao gerente <strong>{manager.name}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
              <p className="text-sm text-muted-foreground">Carregando representantes...</p>
            </div>
          ) : representatives.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Users className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-semibold mb-2">Nenhum representante encontrado</h3>
              <p className="text-sm text-muted-foreground">
                Crie usuários com o role "Representante" para atribuí-los a este gerente
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {representatives.map((rep) => (
                <div
                  key={rep.id}
                  className="flex items-center justify-between p-4 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3 flex-1">
                    <Checkbox
                      id={`rep-${rep.id}`}
                      checked={selectedReps.has(rep.id)}
                      onCheckedChange={() => handleToggleRep(rep.id)}
                    />
                    <Label htmlFor={`rep-${rep.id}`} className="flex-1 cursor-pointer">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium text-foreground">{rep.name}</div>
                          <div className="text-sm text-muted-foreground">{rep.email}</div>
                        </div>
                        {selectedReps.has(rep.id) && (
                          <Badge variant="outline" className="bg-green-100 text-green-700 border-green-200">
                            <UserCheck className="h-3 w-3 mr-1" />
                            Atribuído
                          </Badge>
                        )}
                      </div>
                    </Label>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <div className="flex items-center justify-between w-full">
            <div className="text-sm text-muted-foreground">
              {selectedReps.size} de {representatives.length} representante(s) selecionado(s)
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose} disabled={saving}>
                Cancelar
              </Button>
              <Button onClick={handleSave} disabled={saving || loading}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Salvar
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
