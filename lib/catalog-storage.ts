"use client"

export interface FrameCatalogItem {
  id: string
  name: string
  description?: string
  price: number
  imageUrl?: string
  createdAt: string
}

export interface SizeCatalogItem {
  id: string
  name: string
  height: number
  width: number
  price: number
  createdAt: string
}

export interface CanvasCatalogItem {
  id: string
  name: string
  description?: string
  price: number
  createdAt: string
}

export interface ProductCatalogState {
  frames: FrameCatalogItem[]
  sizes: SizeCatalogItem[]
  canvases: CanvasCatalogItem[]
}

const STORAGE_KEY = "dexoquadros.product-catalog"

const emptyState: ProductCatalogState = {
  frames: [],
  sizes: [],
  canvases: [],
}

export function getCatalogState(): ProductCatalogState {
  if (typeof window === "undefined") return emptyState

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyState

    const parsed = JSON.parse(raw)
    return {
      frames: Array.isArray(parsed?.frames) ? parsed.frames : [],
      sizes: Array.isArray(parsed?.sizes) ? parsed.sizes : [],
      canvases: Array.isArray(parsed?.canvases) ? parsed.canvases : [],
    }
  } catch {
    return emptyState
  }
}

export function saveCatalogState(state: ProductCatalogState) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  window.dispatchEvent(new CustomEvent("catalog-updated"))
}

export function makeCatalogId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value || 0)
}
