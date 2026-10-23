"use client"

import { useMemo, useState } from "react"

export type SortDirection = "asc" | "desc"
export type ColumnSortState = { keys: Array<string | null>; active: string; dir: SortDirection; onSort: (key: string) => void }

const empty = (value: unknown) => value === null || value === undefined || value === ""

/** Ordena por coluna ao clicar no título: 1º clique crescente, 2º decrescente, 3º volta à ordem original. Vazios ficam no fim. */
export function useColumnSort<T>(rows: T[], accessors: Record<string, (row: T) => string | number | null | undefined>) {
  const [active, setActive] = useState("")
  const [dir, setDir] = useState<SortDirection>("asc")
  const sorted = useMemo(() => {
    const read = accessors[active]
    if (!active || !read) return rows
    const sign = dir === "asc" ? 1 : -1
    return [...rows].sort((left, right) => {
      const a = read(left), b = read(right)
      if (empty(a) && empty(b)) return 0
      if (empty(a)) return 1
      if (empty(b)) return -1
      const result = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "pt-BR", { sensitivity: "base", numeric: true })
      return result * sign
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, active, dir])
  function onSort(key: string) {
    if (active !== key) { setActive(key); setDir("asc") }
    else if (dir === "asc") setDir("desc")
    else { setActive(""); setDir("asc") }
  }
  const sortState = (keys: Array<string | null>): ColumnSortState => ({ keys, active, dir, onSort })
  return { sorted, sortState }
}
