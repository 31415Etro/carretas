"use client"

import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar, User, MapPin, X } from "lucide-react"
import { useState, useEffect } from "react"
import { getUsers } from "@/lib/actions/users"
import { getProjects } from "@/lib/actions/projects"
import { getLeadLocations } from "@/lib/actions/leads"
import { useAuth } from "@/lib/auth-context"

export interface FilterState {
  period: string
  userId: string
  project: string
  location: string[]
}

interface FilterBarProps {
  onApply: (filters: FilterState) => void
}

export function FilterBar({ onApply }: FilterBarProps) {
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"

  const [filters, setFilters] = useState<FilterState>({
    period: "last-30",
    userId: "all-users",
    project: "all-projects",
    location: [],
  })

  const [users, setUsers] = useState<Array<{ id: string; full_name?: string }>>([])
  const [projects, setProjects] = useState<Array<{ id: string; name: string; projectCode?: string }>>([]) // Updated type to include projectCode
  const [locations, setLocations] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function loadFilterData() {
      try {
        setIsLoading(true)
        const [usersData, projectsData, leadLocations] = await Promise.all([
          getUsers(),
          getProjects(),
          getLeadLocations(),
        ])

        const usersList = usersData?.data || []
        setUsers(usersList)

        const projectsList = projectsData?.data || []
        setProjects(projectsList)

        setLocations(leadLocations)
      } catch (error) {
        console.error("[v0] Error loading filter data:", error)
      } finally {
        setIsLoading(false)
      }
    }

    loadFilterData()
  }, [])

  const handleLocationToggle = (location: string) => {
    setFilters((prev) => {
      const newLocations = prev.location.includes(location)
        ? prev.location.filter((loc) => loc !== location)
        : [...prev.location, location]

      return { ...prev, location: newLocations }
    })
  }

  const handleClearLocations = () => {
    setFilters((prev) => ({ ...prev, location: [] }))
  }

  const handleApply = () => {
    onApply(filters)
  }

  return (
    <div className="flex items-center gap-3 p-4 bg-card border border-border rounded-lg shadow-[var(--shadow-soft)] mb-6 flex-wrap">
      <div className="flex items-center gap-2">
        <Calendar className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">Filters:</span>
      </div>

      <Select value={filters.period} onValueChange={(value) => setFilters({ ...filters, period: value })}>
        <SelectTrigger className="w-[180px] bg-background">
          <SelectValue placeholder="Período" />
        </SelectTrigger>
            <SelectContent sortItems>
          <SelectItem value="last-7">Últimos 7 dias</SelectItem>
          <SelectItem value="last-30">Últimos 30 dias</SelectItem>
          <SelectItem value="this-month">Este mês</SelectItem>
          <SelectItem value="last-month">Mês passado</SelectItem>
          <SelectItem value="this-quarter">Este trimestre</SelectItem>
          <SelectItem value="this-year">Este ano</SelectItem>
        </SelectContent>
      </Select>

      {isAdmin && (
        <Select
          value={filters.userId}
          onValueChange={(value) => setFilters({ ...filters, userId: value })}
          disabled={isLoading || users.length === 0}
        >
          <SelectTrigger className="w-[180px] bg-background">
            <User className="h-4 w-4 mr-2" />
            <SelectValue placeholder={isLoading ? "Carregando..." : "Usuário"} />
          </SelectTrigger>
            <SelectContent sortItems>
            <SelectItem value="all-users">Todos Usuários</SelectItem>
            {users.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.full_name || "Sem nome"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Select
        value={filters.project}
        onValueChange={(value) => setFilters({ ...filters, project: value })}
        disabled={isLoading}
      >
        <SelectTrigger className="w-[200px] bg-background">
          <SelectValue placeholder={isLoading ? "Carregando..." : "Projeto"} />
        </SelectTrigger>
        <SelectContent sortItems>
          <SelectItem value="all-projects">Todos Projetos</SelectItem>
          {projects.map((project) => (
            <SelectItem key={project.id} value={project.id}>
              {project.projectCode ? `${project.projectCode} - ${project.name}` : project.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-[220px] justify-between bg-background" disabled={isLoading}>
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              <span className="text-sm">
                {filters.location.length === 0
                  ? "Todas Localizações"
                  : filters.location.length === 1
                    ? filters.location[0]
                    : `${filters.location.length} selecionadas`}
              </span>
            </div>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[250px] p-3" align="start">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">Localização</h4>
              {filters.location.length > 0 && (
                <Button variant="ghost" size="sm" onClick={handleClearLocations} className="h-6 px-2 text-xs">
                  <X className="h-3 w-3 mr-1" />
                  Limpar
                </Button>
              )}
            </div>

            {isLoading ? (
              <div className="text-sm text-muted-foreground py-2">Carregando...</div>
            ) : locations.length === 0 ? (
              <div className="text-sm text-muted-foreground py-2">Nenhuma localização encontrada</div>
            ) : (
              <div className="max-h-[300px] overflow-y-auto space-y-2">
                {locations.map((location) => (
                  <div key={location} className="flex items-center space-x-2">
                    <Checkbox
                      id={`location-${location}`}
                      checked={filters.location.includes(location)}
                      onCheckedChange={() => handleLocationToggle(location)}
                    />
                    <label
                      htmlFor={`location-${location}`}
                      className="text-sm font-normal leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                    >
                      {location}
                    </label>
                  </div>
                ))}
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>

      <Button onClick={handleApply} className="ml-auto bg-primary hover:bg-primary-600">
        Aplicar Filtros
      </Button>
    </div>
  )
}
