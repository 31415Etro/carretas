"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts"
import { useEffect, useState, useRef } from "react"
import { createClient } from "@/lib/supabase/client"

type Project = {
  id: string
  name: string
  total_value: number
}

interface RevenueChartProps {
  filters?: {
    period: string
    userId: string
    project: string
  }
}

export function RevenueChart({ filters }: RevenueChartProps = {}) {
  const [chartData, setChartData] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const loadTimeoutRef = useRef<NodeJS.Timeout>()

  useEffect(() => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current)
    }

    loadTimeoutRef.current = setTimeout(() => {
      loadProjectsData()
    }, 300)

    return () => {
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current)
      }
    }
  }, [filters])

  async function loadProjectsData() {
    try {
      const hasSupabaseEnv = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      if (!hasSupabaseEnv) {
        setChartData([])
        return
      }

      const supabase = createClient()

      console.log("[v0] RevenueChart - Loading with filters:", filters)

      let projectsQuery = supabase.from("projects").select("id, name, total_value").order("name", { ascending: true })

      if (filters?.project && filters.project !== "all-projects") {
        projectsQuery = projectsQuery.eq("id", filters.project)
      }

      const { data: projects, error: projectsError } = await projectsQuery

      if (projectsError) {
        console.error("[v0] Error loading projects:", projectsError.message)
        setIsLoading(false)
        return
      }

      if (!projects || projects.length === 0) {
        setChartData([])
        setIsLoading(false)
        return
      }

      let startDate: Date | null = null
      if (filters?.period) {
        const now = new Date()
        switch (filters.period) {
          case "last-7":
            startDate = new Date(now.setDate(now.getDate() - 7))
            break
          case "last-30":
            startDate = new Date(now.setDate(now.getDate() - 30))
            break
          case "last-90":
            startDate = new Date(now.setDate(now.getDate() - 90))
            break
          case "this-month":
            startDate = new Date(now.getFullYear(), now.getMonth(), 1)
            break
          case "last-month":
            startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
            break
          case "this-year":
            startDate = new Date(now.getFullYear(), 0, 1)
            break
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 100))

      const projectIds = projects.map((p) => p.id)
      let leadsQuery = supabase
        .from("leads")
        .select("project_id, deal_value")
        .eq("status", "fechado")
        .in("project_id", projectIds)

      if (filters?.userId && filters.userId !== "all-users") {
        leadsQuery = leadsQuery.eq("closer_id", filters.userId)
      }

      if (startDate) {
        leadsQuery = leadsQuery.gte("updated_at", startDate.toISOString())
      }

      const { data: allClosedLeads, error: leadsError } = await leadsQuery

      if (leadsError) {
        console.error("[v0] Error loading closed leads:", leadsError)
        setChartData([])
        setIsLoading(false)
        return
      }

      const revenueByProject: Record<string, number> = {}
      allClosedLeads?.forEach((lead) => {
        const projectId = lead.project_id
        if (projectId) {
          revenueByProject[projectId] = (revenueByProject[projectId] || 0) + (Number(lead.deal_value) || 0)
        }
      })

      const projectsWithRevenue = projects.map((project) => {
        const closedRevenue = revenueByProject[project.id] || 0

        const displayName = project.name

        return {
          name: displayName,
          "Valor Total": project.total_value,
          "Valor Fechado": closedRevenue,
        }
      })

      console.log("[v0] Loaded chart data:", projectsWithRevenue.length, "projects")
      setChartData(projectsWithRevenue)
    } catch (error) {
      console.error("[v0] Failed to load projects data:", error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Card className="bg-card border-border shadow-[var(--shadow-soft)]">
      <CardHeader>
        <CardTitle>Projetos por Valor</CardTitle>
        <CardDescription>
          Valor Total (vermelho) vs Valor Fechado (azul) por projeto
          {filters &&
            ((filters.project && filters.project !== "all-projects") ||
              (filters.userId && filters.userId !== "all-users")) &&
            " (Filtros aplicados)"}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-2 sm:px-6">
        {isLoading ? (
          <div className="h-[300px] sm:h-[350px] flex items-center justify-center text-muted-foreground">
            Carregando projetos...
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-[300px] sm:h-[350px] flex items-center justify-center text-muted-foreground">
            Nenhum projeto cadastrado
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300} className="sm:h-[350px]">
            <BarChart data={chartData} margin={{ top: 20, right: 10, left: 0, bottom: 80 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis
                dataKey="name"
                stroke="#64748B"
                fontSize={9}
                className="sm:text-xs"
                tickLine={false}
                axisLine={false}
                angle={-45}
                textAnchor="end"
                height={80}
                interval={0}
              />
              <YAxis
                stroke="#64748B"
                fontSize={10}
                className="sm:text-xs"
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => `R$ ${(value / 1000).toFixed(0)}K`}
                width={50}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#FFFFFF",
                  border: "1px solid #E2E8F0",
                  borderRadius: "8px",
                  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
                }}
                formatter={(value: number) => `R$ ${value.toLocaleString("pt-BR")}`}
                labelStyle={{ color: "#0F172A", fontWeight: 600 }}
              />
              <Legend wrapperStyle={{ paddingTop: "20px" }} />
              <Bar dataKey="Valor Total" fill="#EF4444" radius={[8, 8, 0, 0]} />
              <Bar dataKey="Valor Fechado" fill="#3B82F6" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
