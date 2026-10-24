import { Suspense } from "react"
import { InternalStockPage } from "@/components/stock/internal-stock-page"

export default function Page() {
  return <Suspense fallback={null}><InternalStockPage /></Suspense>
}
