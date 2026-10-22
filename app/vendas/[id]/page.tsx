import { SalesDetailPage } from "@/components/sales/sales-detail-page"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <SalesDetailPage id={id} />
}
