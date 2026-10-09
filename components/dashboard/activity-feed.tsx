"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Calendar, DollarSign, UserPlus, MessageSquare, FileText } from "lucide-react"
import { useEffect, useState } from "react"
import { getRecentActivities, type Activity } from "@/lib/actions/activities"
import { createClient } from "@/lib/supabase/client"

const activityConfig = {
  "deal-closed": { icon: DollarSign, color: "#16A34A" },
  "lead-created": { icon: UserPlus, color: "#F59E0B" },
  "meeting-scheduled": { icon: Calendar, color: "#0EA5E9" },
  "comment-added": { icon: MessageSquare, color: "#8B5CF6" },
  "payment-received": { icon: DollarSign, color: "#16A34A" },
  "interaction-logged": { icon: FileText, color: "#2563EB" },
}

export function ActivityFeed() {
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const hasSupabaseEnv = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    async function loadActivities() {
      try {
        const data = await getRecentActivities(10)
        setActivities(data)
      } catch (error) {
        console.error("[v0] Error loading activities:", error)
      } finally {
        setLoading(false)
      }
    }

    loadActivities()

    if (!hasSupabaseEnv) {
      return
    }

    let supabase: ReturnType<typeof createClient> | null = null
    try {
      supabase = createClient()
    } catch {
      return
    }

    // Subscribe to changes in leads, comments, and interactions
    const channel = supabase
      .channel("activities-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => {
        loadActivities()
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "comments" }, () => {
        loadActivities()
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "interactions" }, () => {
        loadActivities()
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, () => {
        loadActivities()
      })
      .subscribe()

    // Cleanup subscription on unmount
    return () => {
      supabase?.removeChannel(channel)
    }
  }, [])

  return (
    <Card className="bg-card border-border shadow-[var(--shadow-soft)]">
      <CardHeader>
        <CardTitle>Atividades Recentes</CardTitle>
        <CardDescription>Últimas atualizações da equipe</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-sm text-muted-foreground text-center py-8">Carregando atividades...</div>
        ) : activities.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">Nenhuma atividade recente</div>
        ) : (
          <div className="space-y-4">
            {activities.map((activity) => {
              const config = activityConfig[activity.type]
              const Icon = config.icon
              return (
                <div key={activity.id} className="flex items-start gap-3">
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-full flex-shrink-0"
                    style={{ backgroundColor: `${config.color}15` }}
                  >
                    <Icon className="h-4 w-4" style={{ color: config.color }} />
                  </div>

                  <div className="flex-1 space-y-1">
                    <p className="text-sm text-foreground leading-tight">
                      <span className="font-semibold">{activity.userName}</span> {activity.description}
                      {activity.value && <span className="font-semibold text-success"> {activity.value}</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">{activity.time}</p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
