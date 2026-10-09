"use client"

import { useState, useEffect } from "react"
import { PageLayout } from "@/components/page-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import {
  Plus,
  Copy,
  Edit,
  Trash2,
  Search,
  MessageSquare,
  Instagram,
  Mail,
  MoreHorizontal,
  User,
  Loader2,
} from "lucide-react"
import { type MessageTemplate, type Lead, templateVariables } from "@/lib/types"
import { useAuth } from "@/lib/auth-context"
import {
  createMessageTemplate,
  deleteMessageTemplate,
  getMessageTemplates,
  updateMessageTemplate,
} from "@/lib/actions/message-templates"
import { getLeads, getClients } from "@/lib/actions/leads"

export default function MessagesPage() {
  const { user } = useAuth()
  const { toast } = useToast()

  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [leads, setLeads] = useState<Lead[]>([])
  const [leadsLoading, setLeadsLoading] = useState(true)

  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [showDialog, setShowDialog] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<MessageTemplate | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [filterCategory, setFilterCategory] = useState<string>("all")

  const [formData, setFormData] = useState({
    title: "",
    content: "",
    category: "whatsapp" as MessageTemplate["category"],
  })

  useEffect(() => {
    const fetchLeadsAndClients = async () => {
      try {
        setLeadsLoading(true)
        const [leadsData, clientsData] = await Promise.all([getLeads(), getClients()])

        const allContacts = [...leadsData, ...clientsData]
        setLeads(allContacts)
      } catch (error) {
        console.error("[v0] Error loading leads and clients:", error)
        toast({ title: "Erro", description: "Falha ao carregar leads e clientes", variant: "destructive" })
      } finally {
        setLeadsLoading(false)
      }
    }

    fetchLeadsAndClients()
  }, [toast])

  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        setLoading(true)
        const data = await getMessageTemplates()
        setTemplates(data)
      } catch (error) {
        console.error("[v0] Error loading templates:", error)
        toast({ title: "Erro", description: "Falha ao carregar mensagens", variant: "destructive" })
      } finally {
        setLoading(false)
      }
    }

    fetchTemplates()
  }, [toast])

  const handleOpenDialog = (template?: MessageTemplate) => {
    if (template) {
      setEditingTemplate(template)
      setFormData({
        title: template.title,
        content: template.content,
        category: template.category,
      })
    } else {
      setEditingTemplate(null)
      setFormData({ title: "", content: "", category: "whatsapp" })
    }
    setShowDialog(true)
  }

  const handleSaveTemplate = async () => {
    if (!formData.title.trim() || !formData.content.trim()) {
      toast({ title: "Erro", description: "Preencha título e conteúdo", variant: "destructive" })
      return
    }

    const variables = extractVariables(formData.content)

    try {
      setIsSubmitting(true)

      if (editingTemplate) {
        const updated = await updateMessageTemplate(
          editingTemplate.id,
          formData.title,
          formData.content,
          formData.category,
          variables,
        )
        setTemplates((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
        toast({ title: "Sucesso!", description: "Mensagem atualizada com sucesso." })
      } else {
        const created = await createMessageTemplate(formData.title, formData.content, formData.category, variables)
        setTemplates((prev) => [...prev, created])
        toast({ title: "Sucesso!", description: "Mensagem criada com sucesso." })
      }

      setShowDialog(false)
    } catch (error) {
      console.error("[v0] Error saving template:", error)
      toast({ title: "Erro", description: "Falha ao salvar mensagem", variant: "destructive" })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeleteTemplate = async (id: string) => {
    try {
      await deleteMessageTemplate(id)
      setTemplates((prev) => prev.filter((t) => t.id !== id))
      toast({ title: "Sucesso!", description: "Mensagem excluída com sucesso." })
    } catch (error) {
      console.error("[v0] Error deleting template:", error)
      toast({ title: "Erro", description: "Falha ao excluir mensagem", variant: "destructive" })
    }
  }

  const handleCopyTemplate = (template: MessageTemplate) => {
    const previewValues = getPreviewValues()
    let content = template.content

    template.variables.forEach((variable) => {
      const value = previewValues[variable] || `{${variable}}`
      content = content.replace(new RegExp(`\\{${variable}\\}`, "g"), value)
    })

    navigator.clipboard.writeText(content)
    toast({
      title: "Copiado!",
      description: selectedLead
        ? `Mensagem copiada com dados de ${selectedLead.name}`
        : "Mensagem copiada para a área de transferência.",
    })
  }

  const extractVariables = (content: string): string[] => {
    const matches = content.match(/\{([^}]+)\}/g)
    if (!matches) return []
    return [...new Set(matches.map((m) => m.slice(1, -1)))]
  }

  const insertVariable = (variable: string) => {
    setFormData((prev) => ({
      ...prev,
      content: prev.content + `{${variable}}`,
    }))
  }

  const renderPreview = (template: MessageTemplate) => {
    const previewValues = getPreviewValues()
    let preview = template.content

    template.variables.forEach((variable) => {
      const value = previewValues[variable] || `{${variable}}`
      preview = preview.replace(new RegExp(`\\{${variable}\\}`, "g"), value)
    })
    return preview
  }

  const filteredTemplates = templates.filter((template) => {
    const matchesSearch =
      template.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      template.content.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCategory = filterCategory === "all" || template.category === filterCategory
    return matchesSearch && matchesCategory
  })

  const getCategoryIcon = (category: MessageTemplate["category"]) => {
    switch (category) {
      case "whatsapp":
        return <MessageSquare className="h-4 w-4" />
      case "instagram":
        return <Instagram className="h-4 w-4" />
      case "email":
        return <Mail className="h-4 w-4" />
      default:
        return <MoreHorizontal className="h-4 w-4" />
    }
  }

  const getCategoryColor = (category: MessageTemplate["category"]) => {
    switch (category) {
      case "whatsapp":
        return "bg-green-100 text-green-700 border-green-200"
      case "instagram":
        return "bg-pink-100 text-pink-700 border-pink-200"
      case "email":
        return "bg-blue-100 text-blue-700 border-blue-200"
      default:
        return "bg-gray-100 text-gray-700 border-gray-200"
    }
  }

  const getPreviewValues = (): Record<string, string> => {
    if (selectedLead) {
      return {
        name: selectedLead.name,
        company: selectedLead.company,
        email: selectedLead.email || "",
        phone: selectedLead.phone || "",
        location: selectedLead.location,
        value: selectedLead.value ? `R$ ${selectedLead.value.toLocaleString("pt-BR")}` : "",
        linkedin: selectedLead.linkedin || "",
        instagram: selectedLead.instagram || "",
        sdr: selectedLead.assignedSDR || "",
        closer: selectedLead.assignedCloser || "",
        date: selectedLead.meetingDate ? new Date(selectedLead.meetingDate).toLocaleDateString("pt-BR") : "",
        time: selectedLead.meetingDate
          ? new Date(selectedLead.meetingDate).toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
            })
          : "",
        product: "Sistema CRM",
      }
    }

    return {
      name: "João Silva",
      company: "Dexo CRM",
      email: "joao@exemplo.com",
      phone: "(11) 99999-9999",
      location: "São Paulo, SP",
      value: "R$ 10.000",
      linkedin: "linkedin.com/in/joao",
      instagram: "@joaosilva",
      sdr: "Maria Santos",
      closer: "Pedro Costa",
      date: "15/01/2025",
      time: "14:00",
      product: "Sistema CRM",
    }
  }

  return (
    <PageLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-balance">Mensagens Pré-Prontas</h1>
            <p className="text-muted-foreground mt-1">
              Crie e gerencie suas mensagens personalizadas para WhatsApp, Instagram e mais
            </p>
          </div>
          <Button onClick={() => handleOpenDialog()} className="gap-2" disabled={loading || leadsLoading}>
            <Plus className="h-4 w-4" />
            Nova Mensagem
          </Button>
        </div>

        {leadsLoading || loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            <div className="space-y-4">
              {/* Filters */}
              <Card className="p-4 bg-gradient-to-r from-primary/5 to-primary/10 border-primary/20">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <User className="h-5 w-5 text-primary" />
                    <span>Selecione um Lead para personalizar as mensagens:</span>
                  </div>
                  <Select
                    value={selectedLead?.id || "none"}
                    onValueChange={(value) => {
                      const lead = leads.find((l) => l.id === value)
                      setSelectedLead(lead || null)
                    }}
                    disabled={leadsLoading}
                  >
                    <SelectTrigger className="w-80 bg-white">
                      <SelectValue placeholder={leadsLoading ? "Carregando..." : "Escolher lead cadastrado..."} />
                    </SelectTrigger>
                <SelectContent sortItems>
                      <SelectItem value="none">
                        <span className="text-muted-foreground">Nenhum lead selecionado</span>
                      </SelectItem>
                      {leads.map((lead) => (
                        <SelectItem key={lead.id} value={lead.id}>
                          <div className="flex flex-col py-1">
                            <span className="font-medium">{lead.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {lead.company} • {lead.location}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </Card>

              <div className="flex gap-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar mensagens..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>

                <Select value={filterCategory} onValueChange={setFilterCategory}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Categoria" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="instagram">Instagram</SelectItem>
                    <SelectItem value="email">E-mail</SelectItem>
                    <SelectItem value="other">Outros</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {selectedLead && (
              <Card className="p-5 bg-primary/5 border-primary/30 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-full bg-primary/20 flex items-center justify-center ring-2 ring-primary/30">
                      <User className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <p className="font-semibold text-base text-foreground">Lead Selecionado</p>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        <span className="font-medium text-foreground">{selectedLead.name}</span> •{" "}
                        {selectedLead.company} • {selectedLead.location}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        As variáveis serão preenchidas automaticamente com os dados deste lead
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedLead(null)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    Limpar Seleção
                  </Button>
                </div>
              </Card>
            )}

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredTemplates.map((template) => (
                <Card key={template.id} className="p-6 hover:shadow-lg transition-shadow">
                  <div className="space-y-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="font-semibold text-lg mb-2">{template.title}</h3>
                        <Badge className={getCategoryColor(template.category)} variant="outline">
                          <span className="flex items-center gap-1">
                            {getCategoryIcon(template.category)}
                            {template.category}
                          </span>
                        </Badge>
                      </div>
                    </div>

                    <div className="bg-muted/50 rounded-lg p-3 text-sm text-muted-foreground min-h-[100px]">
                      {renderPreview(template)}
                    </div>

                    {template.variables.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {template.variables.map((variable) => (
                          <Badge key={variable} variant="secondary" className="text-xs">
                            {variable}
                          </Badge>
                        ))}
                      </div>
                    )}

                    <div className="flex gap-2 pt-2 border-t">
                      <Button
                        onClick={() => handleCopyTemplate(template)}
                        variant="default"
                        size="sm"
                        className="flex-1 gap-2"
                      >
                        <Copy className="h-4 w-4" />
                        Copiar
                      </Button>
                      <Button onClick={() => handleOpenDialog(template)} variant="outline" size="sm">
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        onClick={() => handleDeleteTemplate(template.id)}
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            {filteredTemplates.length === 0 && (
              <div className="text-center py-12">
                <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">Nenhuma mensagem encontrada</h3>
                <p className="text-muted-foreground mb-4">
                  {searchQuery || filterCategory !== "all"
                    ? "Tente ajustar os filtros de busca"
                    : "Comece criando sua primeira mensagem pré-pronta"}
                </p>
              </div>
            )}
          </>
        )}

        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingTemplate ? "Editar Mensagem" : "Nova Mensagem"}</DialogTitle>
            </DialogHeader>

            <div className="space-y-6 py-4">
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="title">Título da Mensagem</Label>
                  <Input
                    id="title"
                    placeholder="Ex: Primeira Abordagem"
                    value={formData.title}
                    onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="category">Categoria</Label>
                  <Select
                    value={formData.category}
                    onValueChange={(value) =>
                      setFormData((prev) => ({ ...prev, category: value as MessageTemplate["category"] }))
                    }
                  >
                    <SelectTrigger id="category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="whatsapp">WhatsApp</SelectItem>
                      <SelectItem value="instagram">Instagram</SelectItem>
                      <SelectItem value="email">E-mail</SelectItem>
                      <SelectItem value="other">Outros</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="content">Conteúdo da Mensagem</Label>
                <Textarea
                  id="content"
                  placeholder="Digite sua mensagem aqui... Use {variavel} para inserir variáveis"
                  value={formData.content}
                  onChange={(e) => setFormData((prev) => ({ ...prev, content: e.target.value }))}
                  rows={6}
                  className="resize-none"
                />
                <p className="text-xs text-muted-foreground">
                  Use variáveis como {"{name}"}, {"{company}"}, {"{value}"} para personalizar
                </p>
              </div>

              <div className="space-y-2">
                <Label>Variáveis Disponíveis</Label>
                <div className="flex flex-wrap gap-2">
                  {templateVariables.map((variable) => (
                    <Button
                      key={variable.key}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => insertVariable(variable.key)}
                      className="gap-2"
                    >
                      <Plus className="h-3 w-3" />
                      {variable.label}
                    </Button>
                  ))}
                </div>
              </div>

              {formData.content && (
                <div className="space-y-2">
                  <Label>Preview</Label>
                  <div className="bg-muted/50 rounded-lg p-4 text-sm">
                    {renderPreview({
                      ...formData,
                      id: "",
                      userId: "",
                      variables: extractVariables(formData.content),
                      createdAt: "",
                      updatedAt: "",
                    })}
                  </div>
                  {selectedLead && (
                    <p className="text-xs text-muted-foreground">
                      Preview usando dados de: <span className="font-medium">{selectedLead.name}</span>
                    </p>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button type="button" variant="outline" onClick={() => setShowDialog(false)} disabled={isSubmitting}>
                  Cancelar
                </Button>
                <Button onClick={handleSaveTemplate} disabled={isSubmitting} className="flex-1">
                  {isSubmitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  {isSubmitting ? "Salvando..." : "Salvar Mensagem"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </PageLayout>
  )
}
