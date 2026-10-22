import { RawMaterialDetailPage } from "@/components/raw-materials/raw-material-detail-page"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <RawMaterialDetailPage id={id} />
}
