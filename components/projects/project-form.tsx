"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { X, MapPin, Loader2, User, Building2, Mail, Phone } from "lucide-react"
import { createProject, updateProject } from "@/lib/actions/projects"
import { getLeadsByProjectId } from "@/lib/actions/leads"
import { useToast } from "@/hooks/use-toast"
import type { Project, Lead } from "@/lib/types"

interface ProjectFormProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  project?: Project
}

export function ProjectForm({ open, onClose, onSuccess, project }: ProjectFormProps) {
  const { toast } = useToast()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoadingCep, setIsLoadingCep] = useState(false)
  const [isLoadingLead, setIsLoadingLead] = useState(false)
  const [associatedLeads, setAssociatedLeads] = useState<Lead[]>([])
  const [formData, setFormData] = useState({
    name: project?.name || "",
    status: project?.status || "active",
    total_value: project?.total_value || 0,
    cep: project?.cep || "",
    street: project?.street || "",
    number: project?.number || "",
    complement: project?.complement || "",
    neighborhood: project?.neighborhood || "",
    city: project?.city || "",
    state: project?.state || "",
  })

  useEffect(() => {
    if (project) {
      console.log("[v0] ProjectForm: Loading project data:", project)
      setFormData({
        name: project.name || "",
        status: project.status || "active",
        total_value: project.total_value || 0,
        cep: project.cep || "",
        street: project.street || "",
        number: project.number || "",
        complement: project.complement || "",
        neighborhood: project.neighborhood || "",
        city: project.city || "",
        state: project.state || "",
      })
      fetchAssociatedLead(project.id)
    } else {
      console.log("[v0] ProjectForm: Resetting form for new project")
      setFormData({
        name: "",
        status: "active",
        total_value: 0,
        cep: "",
        street: "",
        number: "",
        complement: "",
        neighborhood: "",
        city: "",
        state: "",
      })
      setAssociatedLeads([])
    }
  }, [project, open])

  const fetchAssociatedLead = async (projectId: string) => {
    setIsLoadingLead(true)
    try {
      console.log("[v0] ProjectForm: Fetching leads for project:", projectId)
      const { data, error } = await getLeadsByProjectId(projectId)
      if (error) {
        console.error("[v0] Error fetching associated leads:", error)
      } else if (data && data.length > 0) {
        setAssociatedLeads(data)
        console.log("[v0] Associated leads loaded:", data.length, "lead(s)")
      } else {
        console.log("[v0] No leads found for project:", projectId)
        setAssociatedLeads([])
      }
    } catch (error) {
      console.error("[v0] Exception fetching associated leads:", error)
    } finally {
      setIsLoadingLead(false)
    }
  }

  const handleCepChange = async (cep: string) => {
    const cleanCep = cep.replace(/\D/g, "")
    setFormData({ ...formData, cep: cleanCep })

    if (cleanCep.length === 8) {
      setIsLoadingCep(true)
      try {
        const response = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`)
        const data = await response.json()

        if (data.erro) {
          toast({
            title: "CEP não encontrado",
            description: "Verifique o CEP digitado e tente novamente.",
            variant: "destructive",
          })
          setIsLoadingCep(false)
          return
        }

        setFormData((prev) => ({
          ...prev,
          street: data.logradouro || "",
          neighborhood: data.bairro || "",
          city: data.localidade || "",
          state: data.uf || "",
          complement: data.complemento || prev.complement,
        }))

        toast({
          title: "Endereço encontrado!",
          description: "Os campos foram preenchidos automaticamente.",
        })
      } catch (error) {
        console.error("[v0] Error fetching CEP:", error)
        toast({
          title: "Erro ao buscar CEP",
          description: "Não foi possível buscar o endereço. Preencha manualmente.",
          variant: "destructive",
        })
      } finally {
        setIsLoadingCep(false)
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      const submitData: any = {
        name: formData.name,
        status: formData.status,
        total_value: formData.total_value,
        cep: formData.cep || null,
        street: formData.street || null,
        number: formData.number || null,
        complement: formData.complement || null,
        neighborhood: formData.neighborhood || null,
        city: formData.city || null,
        state: formData.state || null,
      }

      console.log("[v0] ProjectForm: Submitting data:", JSON.stringify(submitData, null, 2))

      const result = project ? await updateProject(project.id, submitData) : await createProject(submitData)

      console.log("[v0] ProjectForm: Result:", result)

      if (result.error) {
        console.log("[v0] ProjectForm: Error in result:", result.error)
        toast({
          title: "Erro ao salvar projeto",
          description: result.error,
          variant: "destructive",
        })
      } else {
        toast({
          title: project ? "Projeto atualizado!" : "Projeto criado!",
          description: `O projeto "${formData.name}" foi ${project ? "atualizado" : "criado"} com sucesso.`,
        })
        onSuccess()
        onClose()
        console.log("[v0] ProjectForm: Callbacks completed")
      }
    } catch (error) {
      console.error("[v0] ProjectForm: Error submitting:", error)
      toast({
        title: "Erro inesperado",
        description: "Ocorreu um erro ao salvar o projeto.",
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-2xl font-bold">{project ? "Editar Projeto" : "Novo Projeto"}</DialogTitle>
            <Button variant="ghost" size="icon" onClick={onClose} className="hover:bg-primary/10">
              <X className="h-5 w-5" />
            </Button>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 pt-4">
          {project && (
            <div className="space-y-4 p-4 bg-primary/5 rounded-lg border border-primary/20">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <User className="h-4 w-4" />
                Leads Associados {associatedLeads.length > 0 && `(${associatedLeads.length})`}
              </h3>

              {isLoadingLead ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">Carregando informações dos leads...</span>
                </div>
              ) : associatedLeads.length > 0 ? (
                <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2">
                  {associatedLeads.map((lead, index) => (
                    <div key={lead.id} className="p-3 bg-background rounded-lg border border-border">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-primary">Lead #{index + 1}</span>
                        {lead.status && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">
                            {lead.status.replace("_", " ")}
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">Nome do Contato</p>
                          <p className="text-sm font-medium text-foreground flex items-center gap-2">
                            <User className="h-3 w-3" />
                            {lead.name}
                          </p>
                        </div>

                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">Empresa</p>
                          <p className="text-sm font-medium text-foreground flex items-center gap-2">
                            <Building2 className="h-3 w-3" />
                            {lead.company}
                          </p>
                        </div>

                        {lead.email && (
                          <div className="space-y-1">
                            <p className="text-xs text-muted-foreground">E-mail</p>
                            <p className="text-sm font-medium text-foreground flex items-center gap-2 break-all">
                              <Mail className="h-3 w-3 flex-shrink-0" />
                              {lead.email}
                            </p>
                          </div>
                        )}

                        {lead.phone && (
                          <div className="space-y-1">
                            <p className="text-xs text-muted-foreground">Telefone</p>
                            <p className="text-sm font-medium text-foreground flex items-center gap-2">
                              <Phone className="h-3 w-3" />
                              {lead.phone}
                            </p>
                          </div>
                        )}

                        {lead.cpfCnpj && (
                          <div className="space-y-1 col-span-2">
                            <p className="text-xs text-muted-foreground">CPF/CNPJ</p>
                            <p className="text-sm font-medium text-foreground">{lead.cpfCnpj}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum lead associado a este projeto</p>
              )}
            </div>
          )}

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name" className="text-sm font-medium">
                Nome do Projeto *
              </Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Ex: Campanha Black Friday 2025"
                required
                className="h-11"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="status" className="text-sm font-medium">
                Status *
              </Label>
              <Select value={formData.status} onValueChange={(value) => setFormData({ ...formData, status: value })}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Selecione o status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Ativo</SelectItem>
                  <SelectItem value="completed">Concluído</SelectItem>
                  <SelectItem value="on_hold">Em Espera</SelectItem>
                  <SelectItem value="cancelled">Cancelado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="total_value" className="text-sm font-medium">
                Valor Total (R$)
              </Label>
              <Input
                id="total_value"
                type="number"
                min="0"
                step="0.01"
                value={formData.total_value}
                onChange={(e) => setFormData({ ...formData, total_value: Number.parseFloat(e.target.value) || 0 })}
                placeholder="0.00"
                className="h-11"
              />
            </div>

            <div className="space-y-4 p-4 bg-muted/30 rounded-lg border border-border">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Endereço do Projeto
              </h3>
              <p className="text-xs text-muted-foreground">
                O endereço será utilizado para geolocalização, análises regionais e documentação. Digite o CEP para
                preencher automaticamente os campos de endereço.
              </p>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="cep" className="text-sm font-medium">
                    CEP
                  </Label>
                  <div className="relative">
                    <Input
                      id="cep"
                      value={formData.cep}
                      onChange={(e) => handleCepChange(e.target.value)}
                      placeholder="00000-000"
                      maxLength={8}
                      className="h-11"
                      disabled={isLoadingCep}
                    />
                    {isLoadingCep && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">Apenas números</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="number" className="text-sm font-medium">
                    Número
                  </Label>
                  <Input
                    id="number"
                    value={formData.number}
                    onChange={(e) => setFormData({ ...formData, number: e.target.value })}
                    placeholder="123"
                    className="h-11"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="street" className="text-sm font-medium">
                  Logradouro (Rua/Avenida)
                </Label>
                <Input
                  id="street"
                  value={formData.street}
                  onChange={(e) => setFormData({ ...formData, street: e.target.value })}
                  placeholder="Rua das Flores"
                  className="h-11"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="complement" className="text-sm font-medium">
                  Complemento
                </Label>
                <Input
                  id="complement"
                  value={formData.complement}
                  onChange={(e) => setFormData({ ...formData, complement: e.target.value })}
                  placeholder="Sala 101, Bloco A"
                  className="h-11"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="neighborhood" className="text-sm font-medium">
                  Bairro
                </Label>
                <Input
                  id="neighborhood"
                  value={formData.neighborhood}
                  onChange={(e) => setFormData({ ...formData, neighborhood: e.target.value })}
                  placeholder="Centro"
                  className="h-11"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="city" className="text-sm font-medium">
                    Cidade
                  </Label>
                  <Input
                    id="city"
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    placeholder="São Paulo"
                    className="h-11"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="state" className="text-sm font-medium">
                    Estado (UF)
                  </Label>
                  <Input
                    id="state"
                    value={formData.state}
                    onChange={(e) => setFormData({ ...formData, state: e.target.value.toUpperCase() })}
                    placeholder="SP"
                    maxLength={2}
                    className="h-11"
                  />
                  <p className="text-xs text-muted-foreground">Sigla do estado (ex: SP, RJ, MG)</p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Salvando..." : project ? "Atualizar Projeto" : "Criar Projeto"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
