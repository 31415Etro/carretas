import { Suspense } from "react"
import { CentralProductionPage } from "@/components/production/central-page"

export default function Page() {
  return <Suspense fallback={null}><CentralProductionPage /></Suspense>
}
