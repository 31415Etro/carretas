"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { TrendingUp, Loader2 } from "lucide-react"
import { getTopPerformers, type TopPerformer } from "@/lib/actions/dashboard"

export function TopPerformers() {
  const [performers, setPerformers] = useState<TopPerformer[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadPerformers()
  }, [])

  const loadPerformers = async () => {
    try {
      setLoading(true)
      const data = await getTopPerformers(4)
      setPerformers(data)
    } catch (error) {
      console.error("[v0] Error loading top performers:", error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="bg-card border-border shadow-[var(--shadow-soft)]">
      <CardHeader>
        <CardTitle>Top Performers</CardTitle>
        <CardDescription>Melhores vendedores do mês</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : performers.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">Nenhuma venda registrada ainda</div>
        ) : (
          <div className="space-y-4">
            {performers.map((performer, index) => (
              <div key={performer.id} className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm flex-shrink-0">
                  {index + 1}
                </div>

                <Avatar className="h-10 w-10">
                  <AvatarFallback
                    className={
                      performer.role === "closer" ? "bg-success/10 text-success" : "bg-primary/10 text-primary"
                    }
                  >
                    {performer.name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")}
                  </AvatarFallback>
                </Avatar>

                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">{performer.name}</p>
                    <Badge variant="outline" className="text-xs capitalize">
                      {performer.role}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {performer.deals} {performer.deals === 1 ? "venda" : "vendas"} • R${" "}
                    {(performer.revenue / 1000).toFixed(1)}K
                  </p>
                </div>

                <div className="flex items-center gap-1 text-success text-sm font-medium">
                  <TrendingUp className="h-3.5 w-3.5" />
                  {performer.conversionRate}%
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
