import { Suspense } from "react"
import { ReconciliationPage } from "@/components/finance/reconciliation-page"

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ReconciliationPage />
    </Suspense>
  )
}
