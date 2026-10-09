"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { Target, DollarSign, Users, CheckCircle2, TrendingUp } from "lucide-react"
import type { User, SalesTarget } from "@/lib/types"
import { getSalesTargetByUserAndYear, createSalesTarget, updateSalesTarget } from "@/lib/actions/sales-targets"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent } from "@/components/ui/card"

interface SalesTargetsDialogProps {
  user: User
  onClose: () => void
  onSuccess: () => void
}

const months = [
  { key: "jan", label: "Janeiro" },
  { key: "feb", label: "Fevereiro" },
  { key: "mar", label: "Março" },
  { key: "apr", label: "Abril" },
  { key: "may", label: "Maio" },
  { key: "jun", label: "Junho" },
  { key: "jul", label: "Julho" },
  { key: "aug", label: "Agosto" },
  { key: "sep", label: "Setembro" },
  { key: "oct", label: "Outubro" },
  { key: "nov", label: "Novembro" },
  { key: "dec", label: "Dezembro" },
]

export function SalesTargetsDialog({ user, onClose, onSuccess }: SalesTargetsDialogProps) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [loadingTarget, setLoadingTarget] = useState(false)
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [existingTarget, setExistingTarget] = useState<SalesTarget | null>(null)

  const [monthlyRevenue, setMonthlyRevenue] = useState<Record<string, string>>({})
  const [monthlyLeads, setMonthlyLeads] = useState<Record<string, string>>({})
  const [monthlyDeals, setMonthlyDeals] = useState<Record<string, string>>({})

  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i)

  useEffect(() => {
    loadTarget()
  }, [selectedYear])

  const loadTarget = async () => {
    try {
      setLoadingTarget(true)
      const target = await getSalesTargetByUserAndYear(user.id, selectedYear)

      if (target) {
        setExistingTarget(target)
        const revenueData: Record<string, string> = {}
        const leadsData: Record<string, string> = {}
        const dealsData: Record<string, string> = {}

        months.forEach(({ key }) => {
          revenueData[key] = String((target as any)[`revenue_${key}`] || 0)
          leadsData[key] = String((target as any)[`leads_${key}`] || 0)
          dealsData[key] = String((target as any)[`deals_${key}`] || 0)
        })

        setMonthlyRevenue(revenueData)
        setMonthlyLeads(leadsData)
        setMonthlyDeals(dealsData)
      } else {
        setExistingTarget(null)
        setMonthlyRevenue({})
        setMonthlyLeads({})
        setMonthlyDeals({})
      }
    } catch (error) {
      console.error("Error loading target:", error)
    } finally {
      setLoadingTarget(false)
    }
  }

  const calculateQuarterly = (data: Record<string, string>, quarter: number) => {
    const quarterMonths = months.slice((quarter - 1) * 3, quarter * 3)
    return quarterMonths.reduce((sum, { key }) => sum + (Number.parseFloat(data[key]) || 0), 0)
  }

  const calculateAnnual = (data: Record<string, string>) => {
    return months.reduce((sum, { key }) => sum + (Number.parseFloat(data[key]) || 0), 0)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      setLoading(true)

      const targetData: any = {}

      months.forEach(({ key }) => {
        targetData[`revenue_${key}`] = Number.parseFloat(monthlyRevenue[key]) || 0
        targetData[`leads_${key}`] = Number.parseInt(monthlyLeads[key]) || 0
        targetData[`deals_${key}`] = Number.parseInt(monthlyDeals[key]) || 0
      })

      // Calculate totals for legacy fields
      targetData.revenue_target = calculateAnnual(monthlyRevenue)
      targetData.leads_target = calculateAnnual(monthlyLeads)
      targetData.closed_deals_target = calculateAnnual(monthlyDeals)

      if (existingTarget) {
        await updateSalesTarget({
          id: existingTarget.id,
          ...targetData,
        })

        toast({
          title: "Meta atualizada",
          description: `Meta de ${selectedYear} atualizada com sucesso`,
        })
      } else {
        await createSalesTarget({
          user_id: user.id,
          year: selectedYear,
          ...targetData,
        })

        toast({
          title: "Meta criada",
          description: `Meta de ${selectedYear} criada com sucesso`,
        })
      }

      onSuccess()
      onClose()
    } catch (error) {
      console.error("Error saving target:", error)
      toast({
        title: "Erro",
        description: "Falha ao salvar meta",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            Metas de Vendas - {user.name}
          </DialogTitle>
          <DialogDescription>
            Configure as metas mensais de vendas. As metas trimestrais e anuais são calculadas automaticamente.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="year">Ano *</Label>
            <Select
              value={selectedYear.toString()}
              onValueChange={(value) => setSelectedYear(Number.parseInt(value))}
              disabled={loadingTarget}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((year) => (
                  <SelectItem key={year} value={year.toString()}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {loadingTarget ? (
            <div className="text-center py-8 text-muted-foreground">Carregando meta...</div>
          ) : (
            <Tabs defaultValue="revenue" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="revenue">
                  <DollarSign className="h-4 w-4 mr-2" />
                  Receita
                </TabsTrigger>
                <TabsTrigger value="leads">
                  <Users className="h-4 w-4 mr-2" />
                  Leads
                </TabsTrigger>
                <TabsTrigger value="deals">
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Negócios
                </TabsTrigger>
              </TabsList>

              <TabsContent value="revenue" className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {months.map(({ key, label }) => (
                    <div key={key} className="space-y-2">
                      <Label htmlFor={`revenue_${key}`}>{label}</Label>
                      <Input
                        id={`revenue_${key}`}
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={monthlyRevenue[key] || ""}
                        onChange={(e) => setMonthlyRevenue({ ...monthlyRevenue, [key]: e.target.value })}
                      />
                    </div>
                  ))}
                </div>

                <div className="space-y-4 pt-6 border-t">
                  <h3 className="text-sm font-medium text-muted-foreground">Resumo Trimestral e Anual</h3>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {[1, 2, 3, 4].map((q) => (
                      <Card key={q}>
                        <CardContent className="pt-6">
                          <div className="space-y-2">
                            <p className="text-sm font-medium text-muted-foreground">
                              Q{q} {selectedYear}
                            </p>
                            <p className="text-2xl font-bold tabular-nums">
                              {calculateQuarterly(monthlyRevenue, q).toLocaleString("pt-BR", {
                                style: "currency",
                                currency: "BRL",
                              })}
                            </p>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                  <Card className="bg-primary/5 border-primary/20">
                    <CardContent className="pt-6">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <TrendingUp className="h-4 w-4 text-primary" />
                          <p className="text-sm font-semibold text-primary">Meta Anual {selectedYear}</p>
                        </div>
                        <p className="text-3xl font-bold text-primary tabular-nums">
                          {calculateAnnual(monthlyRevenue).toLocaleString("pt-BR", {
                            style: "currency",
                            currency: "BRL",
                          })}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="leads" className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {months.map(({ key, label }) => (
                    <div key={key} className="space-y-2">
                      <Label htmlFor={`leads_${key}`}>{label}</Label>
                      <Input
                        id={`leads_${key}`}
                        type="number"
                        min="0"
                        placeholder="0"
                        value={monthlyLeads[key] || ""}
                        onChange={(e) => setMonthlyLeads({ ...monthlyLeads, [key]: e.target.value })}
                      />
                    </div>
                  ))}
                </div>

                <div className="space-y-4 pt-6 border-t">
                  <h3 className="text-sm font-medium text-muted-foreground">Resumo Trimestral e Anual</h3>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {[1, 2, 3, 4].map((q) => (
                      <Card key={q}>
                        <CardContent className="pt-6">
                          <div className="space-y-2">
                            <p className="text-sm font-medium text-muted-foreground">
                              Q{q} {selectedYear}
                            </p>
                            <p className="text-2xl font-bold tabular-nums">
                              {calculateQuarterly(monthlyLeads, q).toLocaleString("pt-BR")} leads
                            </p>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                  <Card className="bg-primary/5 border-primary/20">
                    <CardContent className="pt-6">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <TrendingUp className="h-4 w-4 text-primary" />
                          <p className="text-sm font-semibold text-primary">Meta Anual {selectedYear}</p>
                        </div>
                        <p className="text-3xl font-bold text-primary tabular-nums">
                          {calculateAnnual(monthlyLeads).toLocaleString("pt-BR")} leads
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="deals" className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {months.map(({ key, label }) => (
                    <div key={key} className="space-y-2">
                      <Label htmlFor={`deals_${key}`}>{label}</Label>
                      <Input
                        id={`deals_${key}`}
                        type="number"
                        min="0"
                        placeholder="0"
                        value={monthlyDeals[key] || ""}
                        onChange={(e) => setMonthlyDeals({ ...monthlyDeals, [key]: e.target.value })}
                      />
                    </div>
                  ))}
                </div>

                <div className="space-y-4 pt-6 border-t">
                  <h3 className="text-sm font-medium text-muted-foreground">Resumo Trimestral e Anual</h3>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {[1, 2, 3, 4].map((q) => (
                      <Card key={q}>
                        <CardContent className="pt-6">
                          <div className="space-y-2">
                            <p className="text-sm font-medium text-muted-foreground">
                              Q{q} {selectedYear}
                            </p>
                            <p className="text-2xl font-bold tabular-nums">
                              {calculateQuarterly(monthlyDeals, q).toLocaleString("pt-BR")} negócios
                            </p>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                  <Card className="bg-primary/5 border-primary/20">
                    <CardContent className="pt-6">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <TrendingUp className="h-4 w-4 text-primary" />
                          <p className="text-sm font-semibold text-primary">Meta Anual {selectedYear}</p>
                        </div>
                        <p className="text-3xl font-bold text-primary tabular-nums">
                          {calculateAnnual(monthlyDeals).toLocaleString("pt-BR")} negócios
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>
            </Tabs>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading || loadingTarget}>
              {loading ? "Salvando..." : existingTarget ? "Atualizar Meta" : "Criar Meta"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
