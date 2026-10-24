import { Suspense } from "react"
import { JourneyPage } from "@/components/commercial/journey-page"

export default async function Page({ params }: { params: Promise<{ opportunityId: string }> }) {
  const { opportunityId } = await params
  return <Suspense fallback={null}><JourneyPage opportunityId={opportunityId} /></Suspense>
}
