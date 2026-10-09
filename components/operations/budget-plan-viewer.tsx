"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Image as ImageIcon, Loader2, MapPin, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"

export type BudgetPlanRecord = {
  id: string
  workId: string
  towerId: string
  name: string
  fileUrl: string
  fileName: string
  storagePath: string
  pageCount: number
  createdAt: string
}

export type BudgetPlanPlacement = {
  id: string
  planId: string
  pointId: string
  pageNumber: number
  x: number
  y: number
}

export type BudgetPlanPointOption = { id: string; label: string; detail: string }
export type BudgetPlanPhoto = { id: string; pointId: string; fileUrl: string; fileName: string; category: string; createdAt: string }

type Props = {
  plan: BudgetPlanRecord
  placements: BudgetPlanPlacement[]
  points: BudgetPlanPointOption[]
  photos: BudgetPlanPhoto[]
  selectedPointId: string
  onSelectPoint: (pointId: string) => void
  onPlace: (pointId: string, pageNumber: number, x: number, y: number) => void
  onRemove: (placement: BudgetPlanPlacement) => void
}

export function BudgetPlanViewer({ plan, placements, points, photos, selectedPointId, onSelectPoint, onPlace, onRemove }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null)
  const [pdf, setPdf] = useState<any>(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })
  const [evidenceIndex, setEvidenceIndex] = useState(0)

  const pointById = useMemo(() => new Map(points.map((point) => [point.id, point])), [points])
  const placementByPoint = useMemo(() => new Map(placements.map((placement) => [placement.pointId, placement])), [placements])
  const evidence = useMemo(() => photos
    .filter((photo) => placementByPoint.has(photo.pointId))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))), [photos, placementByPoint])
  const activeEvidence = evidence.length ? evidence[Math.min(evidenceIndex, evidence.length - 1)] : undefined

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError("")
    setPdf(null)
    setPageNumber(1)
    ;(async () => {
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
        if (!pdfjs.GlobalWorkerOptions.workerSrc) {
          pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString()
        }
        const response = await fetch(plan.fileUrl)
        if (!response.ok) throw new Error("Nao foi possivel baixar a planta.")
        const document = await pdfjs.getDocument({ data: new Uint8Array(await response.arrayBuffer()) }).promise
        if (!cancelled) setPdf(document)
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Nao foi possivel abrir a planta.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      renderTaskRef.current?.cancel()
    }
  }, [plan.id, plan.fileUrl])

  useEffect(() => {
    if (!pdf || !canvasRef.current) return
    let cancelled = false
    ;(async () => {
      try {
        const page = await pdf.getPage(pageNumber)
        const baseViewport = page.getViewport({ scale: 1 })
        const availableWidth = Math.max(320, Math.min(stageRef.current?.parentElement?.clientWidth || 1100, 1100))
        const scale = availableWidth / baseViewport.width
        const viewport = page.getViewport({ scale })
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
        const canvas = canvasRef.current
        if (!canvas || cancelled) return
        canvas.width = Math.floor(viewport.width * pixelRatio)
        canvas.height = Math.floor(viewport.height * pixelRatio)
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`
        const context = canvas.getContext("2d")
        if (!context) return
        renderTaskRef.current?.cancel()
        const task = page.render({ canvasContext: context, viewport, transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0] })
        renderTaskRef.current = task
        await task.promise
        if (!cancelled) setStageSize({ width: viewport.width, height: viewport.height })
      } catch (reason: any) {
        if (reason?.name !== "RenderingCancelledException" && !cancelled) setError("Nao foi possivel renderizar esta pagina da planta.")
      }
    })()
    return () => {
      cancelled = true
      renderTaskRef.current?.cancel()
    }
  }, [pdf, pageNumber])

  useEffect(() => {
    if (!activeEvidence) return
    const placement = placementByPoint.get(activeEvidence.pointId)
    if (placement && placement.pageNumber !== pageNumber) setPageNumber(placement.pageNumber)
  }, [activeEvidence, pageNumber, placementByPoint])

  const totalPages = Number(pdf?.numPages || plan.pageCount || 1)
  const visiblePlacements = placements.filter((placement) => placement.pageNumber === pageNumber)

  function movePage(direction: number) {
    setPageNumber((current) => Math.min(totalPages, Math.max(1, current + direction)))
  }

  function moveEvidence(direction: number) {
    if (!evidence.length) return
    setEvidenceIndex((current) => (current + direction + evidence.length) % evidence.length)
  }

  function placePoint(event: React.MouseEvent<HTMLDivElement>) {
    if (!selectedPointId || !stageRef.current) return
    const rect = stageRef.current.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
    onPlace(selectedPointId, pageNumber, x, y)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 p-2">
        <div className="flex items-center gap-1">
          <Button type="button" size="icon" variant="outline" disabled={pageNumber <= 1} onClick={() => movePage(-1)} title="Pagina anterior"><ChevronLeft className="h-4 w-4" /></Button>
          <span className="min-w-28 text-center text-sm font-medium">Pagina {pageNumber} de {totalPages}</span>
          <Button type="button" size="icon" variant="outline" disabled={pageNumber >= totalPages} onClick={() => movePage(1)} title="Proxima pagina"><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <div className="flex items-center gap-1">
          <Button type="button" size="icon" variant="outline" disabled={!evidence.length} onClick={() => moveEvidence(-1)} title="Foto anterior"><ChevronLeft className="h-4 w-4" /></Button>
          <span className="min-w-32 text-center text-sm"><ImageIcon className="mr-1 inline h-4 w-4" />{evidence.length ? `Foto ${evidenceIndex + 1} de ${evidence.length}` : "Sem fotos de OS"}</span>
          <Button type="button" size="icon" variant="outline" disabled={!evidence.length} onClick={() => moveEvidence(1)} title="Proxima foto"><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="overflow-auto rounded-md border bg-slate-100 p-2">
        {loading ? <div className="flex min-h-80 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />Abrindo planta...</div> : null}
        {error ? <div className="flex min-h-80 items-center justify-center p-6 text-sm text-destructive">{error}</div> : null}
        {!loading && !error ? (
          <div
            ref={stageRef}
            className={`relative mx-auto bg-white shadow-sm ${selectedPointId ? "cursor-crosshair" : "cursor-default"}`}
            style={{ width: stageSize.width || "100%", height: stageSize.height || 480 }}
            onClick={placePoint}
          >
            <canvas ref={canvasRef} className="block" />
            {visiblePlacements.map((placement) => {
              const point = pointById.get(placement.pointId)
              const currentPhoto = activeEvidence?.pointId === placement.pointId ? activeEvidence : undefined
              return (
                <button
                  type="button"
                  key={placement.id}
                  className={`absolute z-10 -translate-x-1/2 -translate-y-1/2 text-left ${currentPhoto ? "w-32" : "max-w-36"}`}
                  style={{ left: `${placement.x * 100}%`, top: `${placement.y * 100}%` }}
                  title={point?.detail || point?.label}
                  onClick={(event) => { event.stopPropagation(); onSelectPoint(placement.pointId) }}
                >
                  {currentPhoto ? (
                    <span className="block overflow-hidden rounded-md border-2 border-primary bg-background shadow-lg">
                      <img src={currentPhoto.fileUrl} alt={currentPhoto.fileName} className="h-24 w-full object-cover" />
                      <span className="block truncate px-2 py-1 text-[10px] font-semibold">{point?.label || "Ponto"} - {currentPhoto.category}</span>
                    </span>
                  ) : (
                    <span className={`inline-flex items-center gap-1 rounded-full border-2 bg-background px-2 py-1 text-[10px] font-semibold shadow-md ${selectedPointId === placement.pointId ? "border-primary text-primary" : "border-slate-700"}`}><MapPin className="h-3.5 w-3.5" /><span className="max-w-24 truncate">{point?.label || "Ponto"}</span></span>
                  )}
                </button>
              )
            })}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>{selectedPointId ? "Clique na planta para posicionar ou reposicionar o ponto selecionado." : "Selecione torre, pavimento e ponto para marcar a planta."}</span>
        {selectedPointId && placementByPoint.get(selectedPointId) ? <Button type="button" size="sm" variant="outline" onClick={() => onRemove(placementByPoint.get(selectedPointId)!)}><Trash2 className="h-4 w-4" />Remover marcacao</Button> : null}
      </div>
    </div>
  )
}
