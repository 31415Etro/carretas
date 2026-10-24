import { Suspense } from "react"
import { ProductionHubPage } from "@/components/production/production-hub-page"

export default function Page() {
  return <Suspense fallback={null}><ProductionHubPage /></Suspense>
}
