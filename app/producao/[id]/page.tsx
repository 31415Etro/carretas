import { ProductionDetailPage } from "@/components/production/production-detail-page"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ProductionDetailPage id={id} />
}
