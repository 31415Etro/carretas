"use client"

import { type Lead, statusConfig, type Comment } from "@/lib/types"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import {
  Building2,
  Mail,
  Phone,
  MapPin,
  Linkedin,
  Instagram,
  Calendar,
  DollarSign,
  Users,
  CreditCard,
  Clock,
  Edit,
  UserCheck,
  CalendarClock,
  CheckCircle2,
  Circle,
  ListTodo,
  MessageSquare,
  Send,
  BadgeCheck,
  ArrowRight,
  FolderCog as FolderCode,
} from "lucide-react"
import { useEffect, useState } from "react"
import { getTasksByLeadId, toggleTaskCompletion } from "@/lib/actions/tasks"
import { getCommentsByLeadId, createComment } from "@/lib/actions/comments"
import { updateLead } from "@/lib/actions/leads"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"

interface LeadDetailsDialogProps {
  lead: Lead | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onEdit?: (lead: Lead) => void
}

export function LeadDetailsDialog({ lead, open, onOpenChange, onEdit }: LeadDetailsDialogProps) {
  const [tasks, setTasks] = useState<any[]>([])
  const [loadingTasks, setLoadingTasks] = useState(false)
  const [comments, setComments] = useState<Comment[]>([])
  const [loadingComments, setLoadingComments] = useState(false)
  const [newComment, setNewComment] = useState("")
  const [submittingComment, setSubmittingComment] = useState(false)
  const [togglingTaskId, setTogglingTaskId] = useState<string | null>(null)
  const [isMarkingSold, setIsMarkingSold] = useState(false)
  const [isSendingToSD, setIsSendingToSD] = useState(false)
  const { toast } = useToast()



  useEffect(() => {
    if (open && lead?.id) {
      setLoadingTasks(true)
      setLoadingComments(true)

      getTasksByLeadId(lead.id)
        .then((data) => setTasks(data || []))
        .catch((error) => console.error("Error loading tasks:", error))
        .finally(() => setLoadingTasks(false))

      getCommentsByLeadId(lead.id)
        .then((data) => setComments(data || []))
        .catch((error) => console.error("Error loading comments:", error))
        .finally(() => setLoadingComments(false))
    }
  }, [open, lead?.id])

  const handleSubmitComment = async () => {
    if (!newComment.trim() || !lead?.id) return

    setSubmittingComment(true)
    try {
      await createComment({
        lead_id: lead.id,
        content: newComment.trim(),
      })

      const updatedComments = await getCommentsByLeadId(lead.id)
      setComments(updatedComments || [])
      setNewComment("")

      toast({
        title: "Comentário adicionado",
        description: "Seu comentário foi salvo com sucesso.",
      })
    } catch (error) {
      console.error("Error submitting comment:", error)
      toast({
        title: "Erro",
        description: "Não foi possível adicionar o comentário.",
        variant: "destructive",
      })
    } finally {
      setSubmittingComment(false)
    }
  }

  const handleToggleTask = async (taskId: string, currentCompleted: boolean) => {
    setTogglingTaskId(taskId)
    try {
      await toggleTaskCompletion(taskId, !currentCompleted)

      // Refresh tasks list
      if (lead?.id) {
        const updatedTasks = await getTasksByLeadId(lead.id)
        setTasks(updatedTasks || [])
      }

      toast({
        title: !currentCompleted ? "Tarefa concluída" : "Tarefa reaberta",
        description: !currentCompleted ? "A tarefa foi marcada como concluída." : "A tarefa foi reaberta.",
      })
    } catch (error) {
      console.error("Error toggling task:", error)
      toast({
        title: "Erro",
        description: "Não foi possível atualizar a tarefa.",
        variant: "destructive",
      })
    } finally {
      setTogglingTaskId(null)
    }
  }

  const handleMarkAsSold = async () => {
    if (!lead?.id) return

    setIsMarkingSold(true)
    try {
      const { error } = await updateLead(lead.id, {
        status: "fechado",
      })

      if (error) {
        toast({
          title: "Erro",
          description: error,
          variant: "destructive",
        })
        return
      }

      toast({
        title: "Lead vendido!",
        description: "O lead foi marcado como fechado e movido para Clients.",
      })

      // Close dialog and refresh page to show updated kanban
      onOpenChange(false)
      window.location.reload()
    } catch (error) {
      console.error("Error marking lead as sold:", error)
      toast({
        title: "Erro",
        description: "Não foi possível marcar o lead como vendido.",
        variant: "destructive",
      })
    } finally {
      setIsMarkingSold(false)
    }
  }

  const handleSendToSD = async () => {
    if (!lead?.id) return

    setIsSendingToSD(true)
    try {
      const { error } = await updateLead(lead.id, {
        status: "fila_espera",
      })

      if (error) {
        toast({
          title: "Erro",
          description: error,
          variant: "destructive",
        })
        return
      }

      toast({
        title: "Lead enviado para SD!",
        description: "O lead foi movido para a Fila de espera do SD e um código de projeto foi gerado.",
      })

      onOpenChange(false)
      window.location.reload()
    } catch (error) {
      console.error("Error sending lead to SD:", error)
      toast({
        title: "Erro",
        description: "Não foi possível enviar o lead para SD.",
        variant: "destructive",
      })
    } finally {
      setIsSendingToSD(false)
    }
  }

  if (!lead) return null

  const status = statusConfig[lead.status]

  const InfoRow = ({
    icon: Icon,
    label,
    value,
    href,
  }: {
    icon: any
    label: string
    value?: string | null
    href?: string
  }) => {
    if (!value) return null

    const content = (
      <div className="flex items-start gap-3 p-3 rounded-lg bg-surface/50 hover:bg-surface transition-colors">
        <div className="mt-0.5">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-muted-foreground mb-0.5">{label}</p>
          <p className="text-sm text-foreground break-words">{value}</p>
        </div>
      </div>
    )

    if (href) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="block">
          {content}
        </a>
      )
    }

    return content
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <DialogTitle className="text-2xl font-bold text-foreground mb-2">{lead.name}</DialogTitle>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  className="border-0 font-medium"
                  style={{
                    backgroundColor: status.bgColor,
                    color: status.color,
                  }}
                >
                  {status.label}
                </Badge>
                {(lead as any).project_code && (
                  <Badge variant="outline" className="gap-1 bg-purple-500/10 text-purple-600 border-purple-500/20">
                    <FolderCode className="h-3 w-3" />
                    {(lead as any).project_code}
                  </Badge>
                )}
                {lead.value && (
                  <Badge variant="outline" className="gap-1">
                    <DollarSign className="h-3 w-3" />
                    R$ {lead.value.toLocaleString("pt-BR")}
                  </Badge>
                )}
                {lead.createdAt && !isNaN(new Date(lead.createdAt).getTime()) && (
                  <Badge variant="outline" className="gap-1 text-muted-foreground">
                    <CalendarClock className="h-3 w-3" />
                    Criado em {format(new Date(lead.createdAt), "dd/MM/yyyy", { locale: ptBR })}
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {lead.status !== "sd_queue" &&
                lead.status !== "sd_programming" &&
                lead.status !== "sd_waiting" &&
                lead.status !== "sd_ready" &&
                lead.status !== "sd_won" &&
                lead.status !== "sd_lost" && (
                  <Button
                    onClick={handleSendToSD}
                    disabled={isSendingToSD}
                    size="sm"
                    variant="outline"
                    className="gap-2 border-purple-500/20 text-purple-600 hover:bg-purple-500 hover:text-white bg-transparent"
                  >
                    <ArrowRight className="h-4 w-4" />
                    {isSendingToSD ? "Enviando..." : "Enviar para SD"}
                  </Button>
                )}
              {lead.status !== "fechado" && (
                <Button
                  onClick={handleMarkAsSold}
                  disabled={isMarkingSold}
                  size="sm"
                  className="gap-2 bg-success hover:bg-success/90 text-white"
                >
                  <BadgeCheck className="h-4 w-4" />
                  {isMarkingSold ? "Processando..." : "Vendido"}
                </Button>
              )}
              {onEdit && (
                <Button variant="outline" size="sm" onClick={() => onEdit(lead)} className="gap-2">
                  <Edit className="h-4 w-4" />
                  Editar
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6 mt-6">
          {/* Basic Information */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              Informações Básicas
            </h3>
            <div className="grid gap-3 md:grid-cols-2">
              <InfoRow icon={Building2} label="Empresa" value={lead.company} />
              <InfoRow icon={MapPin} label="Local da Franquia" value={lead.location} />
              <InfoRow icon={Mail} label="Email" value={lead.email} />
              <InfoRow icon={Phone} label="Telefone" value={lead.phone} />
              <InfoRow icon={CreditCard} label="CPF/CNPJ" value={lead.cpfCnpj} />
            </div>
          </div>

          <Separator />

          {/* Social Media */}
          {(lead.linkedin || lead.instagram) && (
            <>
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  Redes Sociais
                </h3>
                <div className="grid gap-3 md:grid-cols-2">
                  <InfoRow icon={Linkedin} label="LinkedIn" value={lead.linkedin} href={lead.linkedin || undefined} />
                  <InfoRow
                    icon={Instagram}
                    label="Instagram"
                    value={lead.instagram}
                    href={lead.instagram || undefined}
                  />
                </div>
              </div>
              <Separator />
            </>
          )}

          {lead.referredBy && (
            <>
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <UserCheck className="h-4 w-4 text-primary" />
                  Indicação
                </h3>
                <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                  <p className="text-sm text-foreground">
                    <span className="font-medium">Indicado por:</span> {lead.referredBy}
                  </p>
                </div>
              </div>
              <Separator />
            </>
          )}

          {/* Schedule & Assignment */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-primary" />
              Informações da Reunião
            </h3>
            <div className="grid gap-3 md:grid-cols-2">
              {(lead as any).meeting_date && !isNaN(new Date((lead as any).meeting_date).getTime()) ? (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-surface/50">
                  <div className="mt-0.5">
                    <Calendar className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-muted-foreground mb-0.5">Data de Reunião</p>
                    <p className="text-sm text-foreground">
                      {format(new Date((lead as any).meeting_date), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-surface/50">
                  <div className="mt-0.5">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-muted-foreground mb-0.5">Data de Reunião</p>
                    <p className="text-sm text-muted-foreground italic">Não definida</p>
                  </div>
                </div>
              )}

              {(lead as any).meeting_link ? (
                <a href={(lead as any).meeting_link} target="_blank" rel="noopener noreferrer" className="block">
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-surface/50 hover:bg-surface transition-colors">
                    <div className="mt-0.5">
                      <Calendar className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-muted-foreground mb-0.5">Link da Reunião</p>
                      <p className="text-sm text-foreground break-words underline">{(lead as any).meeting_link}</p>
                    </div>
                  </div>
                </a>
              ) : (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-surface/50">
                  <div className="mt-0.5">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-muted-foreground mb-0.5">Link da Reunião</p>
                    <p className="text-sm text-muted-foreground italic">Não definido</p>
                  </div>
                </div>
              )}

              <InfoRow icon={Clock} label="Data de Acompanhamento" value={(lead as any).follow_up_date} />

              {(lead as any).meeting_attendees && (lead as any).meeting_attendees.length > 0 && (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-surface/50">
                  <div className="mt-0.5">
                    <Users className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-muted-foreground mb-0.5">Participantes</p>
                    <div className="space-y-1">
                      {(lead as any).meeting_attendees.map((attendee: string, index: number) => (
                        <p key={index} className="text-sm text-foreground">
                          {attendee}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Assigned Team */}
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {lead.assignedSDR && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-surface/50">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="bg-primary/10 text-primary">
                      {lead.assignedSDR
                        .split(" ")
                        .map((n) => n[0])
                        .join("")}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">SDR Atribuído</p>
                    <p className="text-sm font-medium text-foreground">{lead.assignedSDR}</p>
                  </div>
                </div>
              )}
              {lead.assignedCloser && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-surface/50">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="bg-success/10 text-success">
                      {lead.assignedCloser
                        .split(" ")
                        .map((n) => n[0])
                        .join("")}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Closer Atribuído</p>
                    <p className="text-sm font-medium text-foreground">{lead.assignedCloser}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Tasks Section */}
          <Separator />
          {tasks.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <ListTodo className="h-4 w-4 text-primary" />
                Tarefas ({tasks.filter((t) => t.completed).length}/{tasks.length} concluídas)
              </h3>

              <div className="space-y-2">
                {tasks.map((task) => (
                  <div
                    key={task.id}
                    className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                      task.completed ? "bg-success/5 border-success/20" : "bg-surface/50 border-border hover:bg-surface"
                    }`}
                  >
                    <button
                      onClick={() => handleToggleTask(task.id, task.completed)}
                      disabled={togglingTaskId === task.id}
                      className="mt-0.5 hover:scale-110 transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
                      aria-label={task.completed ? "Marcar como pendente" : "Marcar como concluída"}
                    >
                      {task.completed ? (
                        <CheckCircle2 className="h-5 w-5 text-success" />
                      ) : (
                        <Circle className="h-5 w-5 text-muted-foreground hover:text-primary" />
                      )}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-sm ${
                          task.completed ? "line-through text-muted-foreground" : "text-foreground"
                        }`}
                      >
                        {task.description}
                      </p>
                      <div className="flex items-center gap-3 mt-1">
                        {task.due_date && !isNaN(new Date(task.due_date).getTime()) && (
                          <p className="text-xs text-muted-foreground">
                            Vencimento: {format(new Date(task.due_date), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                          </p>
                        )}
                        {task.created_at && !isNaN(new Date(task.created_at).getTime()) && (
                          <p className="text-xs text-muted-foreground">
                            Criada em: {format(new Date(task.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Comments Section */}
          <Separator />
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              Comentários
            </h3>

            {/* Add new comment */}
            <div className="mb-4 space-y-2">
              <Textarea
                placeholder="Adicionar um novo comentário..."
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                className="min-h-[80px] resize-none"
              />
              <div className="flex justify-end">
                <Button
                  onClick={handleSubmitComment}
                  disabled={!newComment.trim() || submittingComment}
                  size="sm"
                  className="gap-2"
                >
                  <Send className="h-4 w-4" />
                  {submittingComment ? "Enviando..." : "Adicionar Comentário"}
                </Button>
              </div>
            </div>

            {/* Comments list */}
            {loadingComments ? (
              <div className="text-center py-8 text-muted-foreground">
                <p className="text-sm">Carregando comentários...</p>
              </div>
            ) : comments.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p className="text-sm">Nenhum comentário ainda</p>
                <p className="text-xs mt-1">Seja o primeiro a adicionar um comentário</p>
              </div>
            ) : (
              <div className="space-y-3">
                {comments.map((comment) => (
                  <div key={comment.id} className="flex gap-3 p-3 rounded-lg bg-surface/50">
                    <Avatar className="h-8 w-8 flex-shrink-0">
                      <AvatarFallback className="bg-primary/10 text-primary text-xs">
                        {comment.user_name
                          ? comment.user_name
                              .split(" ")
                              .map((n) => n[0])
                              .join("")
                          : "?"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2 mb-1">
                        <p className="text-sm font-medium text-foreground">
                          {comment.user_name || "Usuário desconhecido"}
                        </p>
                        {comment.created_at && !isNaN(new Date(comment.created_at).getTime()) && (
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(comment.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-foreground whitespace-pre-wrap break-words">{comment.content}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Activities Section */}
          <Separator />
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">Atividades</h3>
            {/* Placeholder for activities section */}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
