"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ComposedChart, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts"
import { useEffect, useState } from "react"
import { getProjects } from "@/lib/actions/projects"

interface ProjectData {
  name: string
  subscriptionCount: number
  pendingSubscriptions: number
  trendLineValue: number
  salesClosingDate: string
  franchiseLocation: string
  projectName: string
  endDate: string
}

export function PipelineChart() {
  const [projectData, setProjectData] = useState<ProjectData[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const { data } = await getProjects()

        if (data && data.length > 0) {
          const sortedData = [...data].sort((a: any, b: any) => {
            const dateA = a.start_date ? new Date(a.start_date).getTime() : 0
            const dateB = b.start_date ? new Date(b.start_date).getTime() : 0
            return dateA - dateB
          })

          // For now, returning empty data since subscription fields are removed
          setProjectData([])
        } else {
          setProjectData([])
        }
      } catch (error) {
        console.error("[v0] Error fetching projects:", error)
        setProjectData([])
      } finally {
        setLoading(false)
      }
    }

    fetchProjects()
  }, [])

  if (loading) {
    return (
      <Card className="bg-card border-border shadow-[var(--shadow-soft)]">
        <CardHeader>
          <CardTitle>Farol de Vendas</CardTitle>
          <CardDescription>Carregando dados dos projetos...</CardDescription>
        </CardHeader>
        <CardContent className="h-[400px] flex items-center justify-center">
          <p className="text-muted-foreground">Carregando...</p>
        </CardContent>
      </Card>
    )
  }

  if (projectData.length === 0) {
    return (
      <Card className="bg-card border-border shadow-[var(--shadow-soft)]">
        <CardHeader>
          <CardTitle>Farol de Vendas</CardTitle>
          <CardDescription>Nenhum projeto encontrado</CardDescription>
        </CardHeader>
        <CardContent className="h-[400px] flex items-center justify-center">
          <p className="text-muted-foreground">Adicione projetos para visualizar o gráfico</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="bg-card border-border shadow-[var(--shadow-soft)]">
      <CardHeader>
        <CardTitle>Farol de Vendas</CardTitle>
        <CardDescription>Quantidade de assinaturas e pendências por projeto</CardDescription>
      </CardHeader>
      <CardContent className="px-2 sm:px-6">
        <ResponsiveContainer width="100%" height={400} className="md:h-[450px]">
          <ComposedChart
            data={projectData}
            margin={{
              top: 20,
              right: 10,
              left: 0,
              bottom: 80,
            }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
            <XAxis
              dataKey="name"
              stroke="#475569"
              fontSize={9}
              className="sm:text-[11px]"
              tickLine={false}
              axisLine={false}
              angle={-45}
              textAnchor="end"
              height={80}
              interval={0}
            />
            <YAxis
              stroke="#475569"
              fontSize={10}
              className="sm:text-xs"
              tickLine={false}
              axisLine={false}
              domain={[0, "auto"]}
              width={40}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#FFFFFF",
                border: "1px solid #E2E8F0",
                borderRadius: "8px",
                boxShadow: "0 8px 24px rgba(2, 6, 23, 0.06)",
              }}
              labelStyle={{ color: "#0F172A", fontWeight: 600, marginBottom: 8 }}
              content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null

                const data = payload[0].payload

                return (
                  <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-lg max-w-[280px]">
                    <p className="text-foreground font-semibold text-sm mb-2 break-words">{data.projectName}</p>
                    <p className="text-muted-foreground text-xs mb-1">{data.franchiseLocation}</p>
                    <p className="text-muted-foreground text-xs mb-2">Encerramento: {data.salesClosingDate}</p>
                    <p className="text-red-500 text-sm mb-1">Pendentes: {data.pendingSubscriptions}</p>
                    <p className="text-green-500 text-sm">Assinaturas: {data.subscriptionCount}</p>
                  </div>
                )
              }}
            />
            <Legend
              wrapperStyle={{ paddingTop: "10px" }}
              iconType="rect"
              iconSize={10}
              formatter={(value) => {
                const labels: Record<string, string> = {
                  subscriptionCount: "ASSINATURAS",
                  pendingSubscriptions: "PENDENTES",
                  trendLineValue: "ENCERRAMENTO",
                }
                return (
                  <span style={{ color: "#475569", fontSize: "10px", fontWeight: 600 }}>{labels[value] || value}</span>
                )
              }}
            />
            {/* Removed subscription-based chart data - this chart will need to be refactored with different metrics */}
          </ComposedChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
