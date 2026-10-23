"use client"

import { useMemo } from "react"
import { drawingDims, renderTrailerSvg } from "@/lib/trailer-drawing"

/** Desenho paramétrico (3 vistas + cotas) da configuração. Mostrado como imagem SVG (sem HTML injetado). */
export function TrailerDrawingView({ product, params, grade, revision, geometry, finish, accessories, className = "" }: {
  product: string; params: Record<string, unknown>; grade: "ilustrativo" | "validado"; revision?: string | null; geometry?: Record<string, number> | null; finish?: string | null; accessories?: string[]; className?: string
}) {
  const svg = useMemo(() => {
    const dims = drawingDims(params)
    return dims ? renderTrailerSvg({ product, revision, grade, dims, geometry, finish, accessories }) : null
  }, [product, params, grade, revision, geometry, finish, accessories])
  if (!svg) return <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">Informe comprimento, largura e altura para ver o desenho.</p>
  return <img className={`w-full rounded-md border bg-white ${className}`} alt={`Desenho de ${product}`} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} />
}
