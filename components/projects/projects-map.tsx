"use client"

import { useEffect, useState, useCallback } from "react"
import { GoogleMap, LoadScript, Marker, InfoWindow } from "@react-google-maps/api"
import {
  getProjectsWithCachedCoordinates,
  getProjectsWithoutCoordinates,
  geocodeSingleProject,
  getGoogleMapsApiKey,
} from "@/lib/actions/projects"
import type { Project } from "@/lib/types"
import { Loader2, MapPin, RefreshCw, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"

interface ProjectWithCoordinates extends Project {
  lat?: number
  lng?: number
}

const mapContainerStyle = {
  width: "100%",
  height: "100%",
}

// Centro do Brasil como padrão
const defaultCenter = {
  lat: -14.235004,
  lng: -51.92528,
}

export function ProjectsMap() {
  const [projects, setProjects] = useState<ProjectWithCoordinates[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedProject, setSelectedProject] = useState<ProjectWithCoordinates | null>(null)
  const [mapCenter, setMapCenter] = useState(defaultCenter)
  const [mapZoom, setMapZoom] = useState(4)

  const [apiKey, setApiKey] = useState<string>("")
  const [pendingCount, setPendingCount] = useState(0)
  const [isGeocoding, setIsGeocoding] = useState(false)
  const [geocodeProgress, setGeocodeProgress] = useState(0)
  const [geocodeError, setGeocodeError] = useState<string | null>(null)

  const loadProjects = useCallback(async () => {
    setLoading(true)
    try {
      const [projectsWithCoords, projectsWithoutCoords, key] = await Promise.all([
        getProjectsWithCachedCoordinates(),
        getProjectsWithoutCoordinates(),
        getGoogleMapsApiKey(),
      ])

      const mappedProjects = projectsWithCoords.map((p) => ({
        ...p,
        lat: p.latitude || 0,
        lng: p.longitude || 0,
      }))

      setProjects(mappedProjects)
      setPendingCount(projectsWithoutCoords.length)
      setApiKey(key)

      if (mappedProjects.length > 0 && mappedProjects[0].lat && mappedProjects[0].lng) {
        setMapCenter({ lat: mappedProjects[0].lat, lng: mappedProjects[0].lng })
        setMapZoom(6)
      }
    } catch (error) {
      console.error("Error loading projects:", error)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  const handleGeocodeAll = async () => {
    setIsGeocoding(true)
    setGeocodeError(null)
    setGeocodeProgress(0)

    try {
      const pendingProjects = await getProjectsWithoutCoordinates()
      const total = pendingProjects.length

      for (let i = 0; i < pendingProjects.length; i++) {
        const project = pendingProjects[i]
        const result = await geocodeSingleProject(project.id)

        if (!result.success && result.error?.includes("Limite")) {
          setGeocodeError(result.error)
          break
        }

        setGeocodeProgress(Math.round(((i + 1) / total) * 100))

        // Wait 1.5 seconds between requests to avoid rate limiting
        if (i < pendingProjects.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1500))
        }
      }

      // Reload projects after geocoding
      await loadProjects()
    } catch (error: any) {
      setGeocodeError(error.message || "Erro ao geocodificar projetos")
    }

    setIsGeocoding(false)
  }

  // Determinar cor do marcador baseado no status
  const getMarkerIcon = (status?: string) => {
    const statusLower = status?.toLowerCase()
    if (statusLower === "concluido" || statusLower === "concluído" || statusLower === "completed") {
      return "http://maps.google.com/mapfiles/ms/icons/orange-dot.png"
    }
    return "http://maps.google.com/mapfiles/ms/icons/blue-dot.png"
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Carregando projetos...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-full">
      {pendingCount > 0 && (
        <div className="absolute top-2 left-2 z-10 bg-background/95 backdrop-blur-sm rounded-lg border p-3 shadow-lg max-w-xs">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-medium">{pendingCount} projetos sem localização</span>
          </div>

          {isGeocoding ? (
            <div className="space-y-2">
              <Progress value={geocodeProgress} className="h-2" />
              <p className="text-xs text-muted-foreground">Geocodificando... {geocodeProgress}%</p>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={handleGeocodeAll} className="w-full bg-transparent">
              <RefreshCw className="h-3 w-3 mr-2" />
              Localizar no mapa
            </Button>
          )}

          {geocodeError && <p className="text-xs text-destructive mt-2">{geocodeError}</p>}
        </div>
      )}

      {projects.length === 0 && pendingCount === 0 ? (
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center gap-3 text-center">
            <MapPin className="h-12 w-12 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium text-foreground mb-1">Nenhum projeto com endereço completo</p>
              <p className="text-xs text-muted-foreground">
                Adicione endereços completos (CEP, rua, cidade, estado) aos projetos para visualizá-los no mapa
              </p>
            </div>
          </div>
        </div>
      ) : (
      <LoadScript googleMapsApiKey={apiKey}>
          <GoogleMap
            mapContainerStyle={mapContainerStyle}
            center={mapCenter}
            zoom={mapZoom}
            options={{
              streetViewControl: false,
              mapTypeControl: true,
              fullscreenControl: true,
            }}
          >
            {projects.map((project) => {
              if (!project.lat || !project.lng) return null

              return (
                <Marker
                  key={project.id}
                  position={{ lat: project.lat, lng: project.lng }}
                  icon={getMarkerIcon(project.status)}
                  onClick={() => setSelectedProject(project)}
                  title={project.name}
                />
              )
            })}

            {selectedProject && selectedProject.lat && selectedProject.lng && (
              <InfoWindow
                position={{ lat: selectedProject.lat, lng: selectedProject.lng }}
                onCloseClick={() => setSelectedProject(null)}
              >
                <div className="p-2 max-w-xs">
                  <h3 className="font-semibold text-sm mb-1">{selectedProject.name}</h3>
                  <div className="space-y-1 text-xs">
                    <p>
                      <span className="font-medium">Status:</span>{" "}
                      <span
                        className={`px-2 py-0.5 rounded ${
                          selectedProject.status?.toLowerCase() === "concluido" ||
                          selectedProject.status?.toLowerCase() === "concluído"
                            ? "bg-orange-100 text-orange-700"
                            : "bg-blue-100 text-blue-700"
                        }`}
                      >
                        {selectedProject.status || "Ativo"}
                      </span>
                    </p>
                    <p>
                      <span className="font-medium">Endereço:</span>{" "}
                      {`${selectedProject.street}, ${selectedProject.number || "s/n"}`}
                    </p>
                    <p>{`${selectedProject.neighborhood || ""}, ${selectedProject.city} - ${selectedProject.state}`}</p>
                    <p>
                      <span className="font-medium">CEP:</span> {selectedProject.cep}
                    </p>
                    {selectedProject.totalValue && (
                      <p>
                        <span className="font-medium">Valor:</span> R${" "}
                        {Number(selectedProject.totalValue).toLocaleString("pt-BR", {
                          minimumFractionDigits: 2,
                        })}
                      </p>
                    )}
                  </div>
                </div>
              </InfoWindow>
            )}
          </GoogleMap>
        </LoadScript>
      )}
    </div>
  )
}
