"use client"

import { PageLayout } from "@/components/page-layout"
import { AnalyticsFilterBar } from "@/components/dashboard/analytics-filter-bar"
import { RevenueChart } from "@/components/dashboard/revenue-chart"
import { PipelineChart } from "@/components/dashboard/pipeline-chart"
import { useState } from "react"

export default function AnalyticsPage() {
  const [currentFilters, setCurrentFilters] = useState<{
    project: string
    location: string[]
  }>({
    project: "all-projects",
    location: [],
  })

  const handleApplyFilters = (filters: { project: string; location: string[] }) => {
    console.log("[v0] Analytics: Filters applied:", JSON.stringify(filters, null, 2))
    setCurrentFilters(filters)
  }

  const chartFilters = {
    location: currentFilters.location.length > 0 ? currentFilters.location : undefined,
    projectId: currentFilters.project !== "all-projects" ? currentFilters.project : undefined,
  }

  console.log("[v0] Analytics: Converted filters for charts:", JSON.stringify(chartFilters, null, 2))

  return (
    <PageLayout>
      <div className="mb-8">
        <h2 className="text-3xl font-bold text-foreground">Analytics</h2>
        <p className="text-muted-foreground mt-1">Deep dive into your sales performance</p>
      </div>

      <AnalyticsFilterBar onApply={handleApplyFilters} />

      <div className="space-y-6">
        <PipelineChart />
        <RevenueChart filters={chartFilters} />
      </div>
    </PageLayout>
  )
}
